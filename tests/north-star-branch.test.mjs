// The scheduled north-star workflow publishes each measurement to the north-star branch; the guard must judge the
// newest number, whether it was committed or only published by a run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { newerResult } from "../lib/north-star-branch.mjs";

const gel = join(import.meta.dirname, "..", "bin", "gel.mjs");
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
const gelRun = (args, env = {}) => spawnSync(process.execPath, [gel, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ...env } });

// a repo with a bare origin, whose measure prints whatever bench/value holds
function repo(committed) {
  const root = mkdtempSync(join(tmpdir(), "nsb-"));
  const origin = join(root, "origin.git"), d = join(root, "work");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["clone", "-q", origin, d], { stdio: "ignore" });
  mkdirSync(join(d, "bench")); mkdirSync(join(d, "docs"));
  writeFileSync(join(d, "bench", "README.md"), "how\n");
  writeFileSync(join(d, "bench", "value"), "2.5");
  writeFileSync(join(d, "bench", "m.mjs"), `import { readFileSync } from "node:fs"; console.log(JSON.stringify({ value: Number(readFileSync("bench/value", "utf8")), baseline: 26.1, unit: "s" }))\n`);
  writeFileSync(join(d, "docs", "gel.json"), JSON.stringify({ mode: "block", guards: { "north-star": "block" }, north_star: { metric: "first start to healthy", baseline: "Docker Compose", target: { ratio: 8, better: "lower" }, result: "bench/north-star.json", evidence: "bench/README.md", measure: "node bench/m.mjs" } }));
  if (committed) writeFileSync(join(d, "bench", "north-star.json"), JSON.stringify(committed));
  git(d, "add", "-A"); git(d, "commit", "-qm", "init"); git(d, "push", "-q", "origin", "HEAD");
  return d;
}

test("newerResult keeps the later measuredAt, and the committed file on a tie or a bad date", () => {
  const a = JSON.stringify({ measuredAt: "2026-11-01T00:00:00Z" }), b = JSON.stringify({ measuredAt: "2026-11-20T00:00:00Z" });
  assert.equal(newerResult(a, b), b);
  assert.equal(newerResult(b, a), b);
  assert.equal(newerResult(a, a), a);
  assert.equal(newerResult(a, "{}"), a);
  assert.equal(newerResult(null, b), b);
  assert.equal(newerResult(a, null), a);
});

test("--measure --publish pushes the result and a history line to the north-star branch, with the run link", () => {
  const d = repo(null);
  const env = { GITHUB_RUN_ID: "42", GITHUB_REPOSITORY: "o/r", GITHUB_SERVER_URL: "https://github.com", GITHUB_SHA: "abc" };
  assert.equal(gelRun(["north-star", "--root", d, "--measure", "--publish"], env).status, 0);
  writeFileSync(join(d, "bench", "value"), "3");
  assert.equal(gelRun(["north-star", "--root", d, "--measure", "--publish"], env).status, 0);
  const r = JSON.parse(git(d, "show", "origin/north-star:bench/north-star.json"));
  assert.equal(r.value, 3);
  assert.equal(r.run, "https://github.com/o/r/actions/runs/42");
  assert.equal(r.commit, "abc");
  const history = git(d, "show", "origin/north-star:history.jsonl").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(history.map((h) => h.value), [2.5, 3]);
  // the working branch is untouched: still on its own commit, the branch has two commits of its own
  assert.equal(git(d, "rev-list", "--count", "origin/north-star").trim(), "2");
  assert.equal(git(d, "rev-parse", "--abbrev-ref", "HEAD").trim() !== "north-star", true);
});

test("gel run judges the branch result when it is newer than the committed one", () => {
  // committed: an old, missed number; published by a run: a fresh, met one
  const d = repo({ value: 20, baseline: 26.1, unit: "s", measuredAt: "2026-11-01T00:00:00Z" });
  assert.notEqual(gelRun(["run", "--root", d]).status, 0, "the committed number misses the target");
  gelRun(["north-star", "--root", d, "--measure", "--publish"]);
  git(d, "checkout", "-q", "--", "bench/north-star.json"); // drop the local copy: only the branch has the new number
  assert.equal(JSON.parse(readFileSync(join(d, "bench", "north-star.json"), "utf8")).value, 20);
  const ok = gelRun(["run", "--root", d]);
  assert.equal(ok.status, 0, ok.stdout);
});

test("gel run finds a result that exists only on the north-star branch", () => {
  const d = repo(null);
  gelRun(["north-star", "--root", d, "--measure", "--publish"]);
  execFileSync("rm", [join(d, "bench", "north-star.json")]);
  const ok = gelRun(["run", "--root", d]);
  assert.equal(ok.status, 0, ok.stdout);
});
