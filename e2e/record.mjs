#!/usr/bin/env node
// node e2e/record.mjs [--date 2026-11-22]: reads e2e/sources.json, fetches every real source, writes e2e/cases.json.
//   file:   the file at the latest commit of the repo's default branch (pinned by commit in cases.json). "excerpt":
//           "ice-tables" keeps only the ICE tables (third-party repos: a short excerpt, with its source and license note)
//   clicks: the live answers of a site's /api/clicks, kept the way `gel click-map` keeps them
// Cases with real: false are built from what sources.json says, and keep their "why". Needs network (GITHUB_TOKEN in the environment raises the GitHub rate limit).
// The suite (tests/e2e.test.mjs) reads only e2e/cases.json: it never touches the network.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toEntry } from "../lib/click-map.mjs";
import { iceTables } from "../guards/ice-score/index.mjs";
import { QUESTIONS } from "../guards/product-brief/index.mjs";
import { coverage } from "./coverage.mjs";

const dir = import.meta.dirname;
const args = process.argv.slice(2);
const date = args.includes("--date") ? args[args.indexOf("--date") + 1] : new Date().toISOString().slice(0, 10);
// GitHub's REST API with fetch (GITHUB_TOKEN raises the rate limit; public repos need none)
async function gh(path) {
  const headers = { accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const r = await fetch(`https://api.github.com/${path}`, { headers });
  if (!r.ok) throw new Error(`GitHub ${path}: HTTP ${r.status}`);
  return r.json();
}

async function fetchFile({ repo, path, excerpt }) {
  const [c] = await gh(`repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`);
  const blob = await gh(`repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${c.sha}`);
  let text = Buffer.from(blob.content, "base64").toString("utf8");
  if (excerpt === "ice-tables") {
    const lines = text.split("\n");
    const parts = iceTables(text).filter((t) => t.rows.length).map((t) => {
      let end = t.line + 1;
      while (end < lines.length && /^\s*\|.*\|\s*$/.test(lines[end])) end++;
      return lines.slice(t.line - 1, end).join("\n");
    });
    text = `<!-- ICE tables from https://github.com/${repo}/blob/${c.sha}/${path} -->\n\n${parts.join("\n\n")}\n`;
  }
  return { source: `https://github.com/${repo}/blob/${c.sha.slice(0, 12)}/${path}`, committed: c.commit.committer.date.slice(0, 10), text };
}

// a made-up brief whose numbers meet `met` of the six targets; answers from the Flisk planner of 2026-11-13
const ANSWERS = {
  what: ["an agentic local runtime that starts a whole stack with one command", "seconds from first start to healthy", 30, "lower"],
  who: ["teams of five to ten developers", "teams that pay each month", 10],
  why: ["their stack takes a day to start on a new laptop", "hours saved per new developer", 4],
  how: ["reads service.json files and generates the local config", "services started without hand-written config", 10],
  where: ["on the developer's own laptop, from npm", "weekly npm downloads", 500],
  when: ["the first day a developer joins the team", "days until the first paying team", 14, "lower"],
};
function briefRepo({ met, ageDays = 0 }) {
  const brief = {}, result = {};
  const at = new Date(Date.parse(date) - ageDays * 86400000).toISOString().slice(0, 10);
  QUESTIONS.forEach((q, n) => {
    const [answer, metric, target, better] = ANSWERS[q];
    brief[q] = { answer, metric, target, ...(better ? { better } : {}) };
    const hit = n < met;
    const value = better === "lower" ? (hit ? target / 2 : target * 2) : (hit ? target * 2 : target / 2);
    result[q] = { value, measuredAt: at, source: "docs/numbers.md" };
  });
  return { cfg: { brief }, files: { "docs/brief.json": JSON.stringify(result, null, 1) + "\n", "docs/numbers.md": "# Numbers\n\nMade up for the e2e suite.\n" } };
}

const { cases } = JSON.parse(readFileSync(join(dir, "sources.json"), "utf8"));
const out = [];
for (const c of cases) {
  const { file, clicks, entries, brief, ...rest } = c;
  let cfg = c.cfg ?? {}, files = c.files ?? {}, source = null, recordedAt = date;
  if (file) {
    const f = await fetchFile(file);
    source = f.source;
    if (file.path === "docs/gel.json") cfg = JSON.parse(f.text);
    else files = { [file.path]: f.text };
  }
  if (clicks) {
    const got = [];
    for (const url of clicks) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      got.push(toEntry(await r.json(), url));
    }
    source = clicks;
    files = { "docs/click-map.json": JSON.stringify({ measuredAt: `${date}T12:00:00Z`, entries: got }, null, 1) + "\n" };
  }
  if (entries) files = { "docs/click-map.json": JSON.stringify({ measuredAt: `${date}T12:00:00Z`, entries }, null, 1) + "\n" };
  if (brief) ({ cfg, files } = briefRepo(brief));
  out.push({ ...rest, ...(source ? { source } : {}), recordedAt, cfg, files });
  console.log(`${c.real ? "real" : "made up"}  ${c.check.padEnd(14)} ${c.id}`);
}
writeFileSync(join(dir, "cases.json"), JSON.stringify(out, null, 1) + "\n");
const readme = readFileSync(join(dir, "README.md"), "utf8");
writeFileSync(join(dir, "README.md"), readme.replace(/<!-- coverage -->[\s\S]*<!-- \/coverage -->/, `<!-- coverage -->\n${coverage(out)}\n<!-- /coverage -->`));
console.log(`${out.length} cases -> e2e/cases.json`);
