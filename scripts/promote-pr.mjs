// Weekly: gather this repo's recent `gel-record` artifacts, run `gel promote --write`, and open one PR when a
// guard should change level. GEL only proposes: the PR edits docs/gel.json (lane C), so a person approves it.
//
//   node scripts/promote-pr.mjs [--repo owner/name] [--runs 50] [--wip 1] [--dry-run]
// Needs GH_TOKEN (actions: read to download records; contents and pull requests: write to open the PR).
// The PR is opened only when GEL_PROMOTE_PR=1; otherwise it reports what it would do.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isPaused, budget } from "../lib/brakes.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const REPO = opt("repo", process.env.GITHUB_REPOSITORY || "flisk-sh/gel");
const RUNS = Number(opt("runs", 50));
const WIP = Number(opt("wip", 1));
const BRANCH = "gel/promote-guards";
const dry = args.includes("--dry-run") || process.env.GEL_PROMOTE_PR !== "1";
const sh = (cmd, a, o = {}) => execFileSync(cmd, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 27, ...o });
const log = (s) => { console.log(s); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };

log(`## GEL promote PR${dry ? " (dry run: GEL_PROMOTE_PR is not 1 or --dry-run)" : ""}`);
if (isPaused(process.env.GEL_PAUSE)) { log("Paused: GEL_PAUSE is set, nothing was done."); process.exit(0); }
const open = Number(sh("gh", ["pr", "list", "-R", REPO, "--head", BRANCH, "--state", "open", "--json", "url", "-q", "length"]).trim());
const { allow, why } = budget({ max: 1, wip: WIP, open });
if (!allow) { log(`Stopped by the brake: ${why}.`); process.exit(0); }

const arts = JSON.parse(sh("gh", ["api", `repos/${REPO}/actions/artifacts?name=gel-record&per_page=${Math.min(RUNS, 100)}`, "-q", "[.artifacts[]|select(.expired|not)|.id]"]));
const dir = mkdtempSync(join(tmpdir(), "gel-promote-"));
const lines = [];
for (const id of arts.slice(0, RUNS)) {
  try {
    const d = join(dir, String(id));
    writeFileSync(join(dir, `${id}.zip`), sh("gh", ["api", `repos/${REPO}/actions/artifacts/${id}/zip`], { encoding: "buffer" }));
    sh("unzip", ["-q", "-o", join(dir, `${id}.zip`), "-d", d]);
    for (const f of readdirSync(d)) lines.push(readFileSync(join(d, f), "utf8").trim());
  } catch (e) { log(`- artifact ${id}: skipped (${String(e.stderr || e.message).split("\n")[0]})`); }
}
const records = join(dir, "all.jsonl");
writeFileSync(records, lines.filter(Boolean).join("\n") + "\n");
log(`${lines.filter(Boolean).length} run records from ${arts.length} artifacts`);

const out = JSON.parse(sh("node", [join(here, "bin", "gel.mjs"), "promote", records, "--labels", join(here, "docs", "gel-labels.json"), "--root", here, ...(dry ? [] : ["--write"]), "--json"]));
for (const w of out.warnings) log(`> ${w}`);
if (!out.changes.length) { log("No guard should change level."); process.exit(0); }
for (const c of out.changes) log(`- ${c.guard}: ${c.from} -> ${c.to} (${c.why})`);
if (dry) { log("Dry run: nothing written, no PR opened."); process.exit(0); }

const g = (...a) => sh("git", ["-C", here, ...a]);
g("checkout", "-q", "-b", BRANCH);
g("add", "--", "docs/gel.json");
g("-c", "user.name=GEL promote", "-c", "user.email=noreply@flisk.sh", "commit", "-q", "-s", "-m", `chore(gel): change level of ${out.changes.map((c) => c.guard).join(", ")}\n\nProposed by the GEL promote loop (scripts/promote-pr.mjs) from gel metrics advice.`);
g("push", "-q", "origin", BRANCH);
const body = `Proposed by the [GEL promote loop](https://github.com/flisk-sh/gel/blob/main/scripts/promote-pr.mjs) from \`gel metrics\`:\n\n| guard | from | to | why |\n|---|---|---|---|\n${out.changes.map((c) => `| ${c.guard} | ${c.from} | **${c.to}** | ${c.why} |`).join("\n")}\n\nEditing \`docs/gel.json\` is lane C: a person approves. Close it to keep the level as it is.`;
log(`Opened ${sh("gh", ["pr", "create", "-R", REPO, "--head", BRANCH, "--title", `chore(gel): change level of ${out.changes.map((c) => c.guard).join(", ")}`, "--body", body]).trim()}`);
