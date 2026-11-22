// product-brief: a product answers what, who, why, how, where and when, each with a measured number behind it.
// The guard only speaks to a repo that declared a brief or a north star, and it judges the whole repo on a pull request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../lib/config.mjs";
import { loadGuard } from "../lib/guards.mjs";
import { QUESTIONS, met } from "../guards/product-brief/index.mjs";

const gel = join(import.meta.dirname, "..", "bin", "gel.mjs");
const today = new Date().toISOString().slice(0, 10);
const BRIEF = Object.fromEntries(QUESTIONS.map((q, i) => [q, { answer: `the ${q} answer of this product number ${i}`, metric: `measured ${q} number`, target: 10 }]));
const NUMBERS = Object.fromEntries(QUESTIONS.map((q, i) => [q, { value: i * 5, measuredAt: today, source: "bench/README.md" }]));
const NS = { metric: "first start to healthy", baseline: "Docker Compose", target: { ratio: 8, better: "lower" }, result: "bench/north-star.json", evidence: "bench/README.md" };

function repo(cfg, numbers) {
  const d = mkdtempSync(join(tmpdir(), "brief-"));
  mkdirSync(join(d, "bench")); writeFileSync(join(d, "bench", "README.md"), "how\n");
  mkdirSync(join(d, "docs"));
  if (cfg) writeFileSync(join(d, "docs", "gel.json"), JSON.stringify(cfg));
  if (numbers) writeFileSync(join(d, "docs", "brief.json"), JSON.stringify(numbers));
  return d;
}
const gelRun = (args) => spawnSync(process.execPath, [gel, ...args], { encoding: "utf8" });

test("the guard file has no node import, so it can run in a browser", () => {
  const src = readFileSync(new URL("../guards/product-brief/index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^\s*import\b/m);
});

test("quiet without docs/gel.json, and for a repo that named neither a brief nor a north star", async () => {
  const guard = await loadGuard("product-brief");
  for (const d of [repo(null), repo({ status: "active" })]) {
    assert.equal((await guard.run({ root: d, files: ["bench/README.md"], ctx: {}, cfg: loadConfig(d) })).pass, true);
  }
});

test("a repo that names a north star is asked for its brief", async () => {
  const guard = await loadGuard("product-brief");
  const d = repo({ north_star: NS });
  const res = await guard.run({ root: d, files: ["bench/README.md", "docs/gel.json"], ctx: {}, cfg: loadConfig(d) });
  assert.equal(res.pass, false);
  assert.match(res.findings[0].message, /no "brief"/);
});

test("met: higher is the default, lower is for time and cost", () => {
  assert.equal(met(10, 10), true);
  assert.equal(met(9, 10), false);
  assert.equal(met(9, 10, "lower"), true);
  assert.equal(met(11, 10, "lower"), false);
});

test("gel brief prints the six rows, exits 0 when every answer has a fresh number and 1 when one is missing", () => {
  const ok = gelRun(["brief", "--root", repo({ brief: BRIEF }, NUMBERS), "--json"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const out = JSON.parse(ok.stdout);
  assert.equal(out.of, 6);
  assert.equal(out.met, 4); // values 0, 5, 10, 15, 20, 25 against a target of 10
  assert.deepEqual(out.rows.map((r) => r.question), QUESTIONS);

  const { when, ...five } = NUMBERS;
  const bad = gelRun(["brief", "--root", repo({ brief: BRIEF }, five)]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /when: no measured number/);
  assert.match(bad.stdout, /NOT MEASURED/);

  assert.equal(gelRun(["brief", "--root", repo({ status: "active" })]).status, 2);
});

test("in block mode gel run fails on a brief with an unbacked answer, and passes when a target is simply not met yet", () => {
  const cfg = { mode: "block", guards: { "product-brief": "block" }, status: "active", owner: "t", brief: BRIEF };
  const { who, ...five } = NUMBERS;
  assert.notEqual(gelRun(["run", "--root", repo(cfg, five)]).status, 0);
  const honest = repo(cfg, { ...NUMBERS, who: { ...NUMBERS.who, value: 0 } });
  const res = gelRun(["run", "--root", honest]);
  assert.match(res.stdout, /\| product-brief \| block \| pass \|/, res.stdout);
});

test("on a pull request that touches an unrelated file the numbers and their sources are still found", () => {
  const d = repo({ mode: "block", guards: { "product-brief": "block" }, brief: BRIEF }, NUMBERS);
  const git = (...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" });
  git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").stdout.trim();
  git("checkout", "-q", "-b", "change");
  writeFileSync(join(d, "notes.txt"), "hi\n"); git("add", "-A"); git("commit", "-qm", "c");
  const res = gelRun(["run", "--root", d, "--base", base]);
  assert.match(res.stdout, /\| product-brief \| block \| pass \|/, res.stdout);
});
