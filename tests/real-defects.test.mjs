// The four guards that look for real defects (checks-green, deploy-delivered, change-verified, perf-budget) and the
// collectors behind them: a fake GitHub for gel-ctx, and a real git repo with a failing fixture for `gel verify` and `gel perf`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { collectChecks, collectDeployRuns } from "../lib/ctx-collect.mjs";
import { verify, perf, parseMeasure } from "../lib/verify.mjs";
import { diffChanges } from "../lib/diff.mjs";
import { loadGuard } from "../lib/guards.mjs";

for (const g of ["checks-green", "deploy-delivered", "change-verified", "perf-budget"]) {
  test(`${g} imports nothing from node`, () => {
    assert.doesNotMatch(readFileSync(new URL(`../guards/${g}/index.mjs`, import.meta.url), "utf8"), /\bfrom\s+["']node:/);
  });
}

// ---- gel-ctx against a fake GitHub
const fake = (routes) => async (path) => { const k = Object.keys(routes).find((r) => path.startsWith(r)); const v = k ? routes[k] : null; return typeof v === "function" ? v(path) : v; };

test("collectChecks waits for a slow check (SonarCloud) and then reports its failure", async () => {
  let polls = 0;
  const get = fake({
    "/repos/o/r/commits/abc/check-runs": () => (++polls < 3
      ? { check_runs: [{ name: "GEL guards", status: "in_progress" }, { name: "SonarCloud Code Analysis", status: "in_progress" }] }
      : { check_runs: [{ name: "GEL guards", status: "in_progress" }, { name: "SonarCloud Code Analysis", status: "completed", conclusion: "failure", output: { title: "Quality Gate failed", summary: "Project doesn't exist" } }] }),
    "/repos/o/r/commits/abc/status": { statuses: [] },
  });
  const ctx = await collectChecks(get, { repo: "o/r", sha: "abc", pollMs: 0, sleep: async () => {} });
  assert.equal(polls, 3);
  assert.equal(ctx.checksSettled, true);
  assert.deepEqual(ctx.checkRuns.map((c) => c.name), ["SonarCloud Code Analysis"]); // not our own job
  const g = await loadGuard("checks-green");
  const res = await g.run({ ctx, cfg: {}, files: [] });
  assert.equal(res.pass, false);
  assert.match(res.findings[0].message, /SonarCloud Code Analysis: failure/);
  assert.match(res.findings[0].message, /misconfigured/);
});

test("collectChecks gives up after the wait and says the check is still running", async () => {
  let t = 0;
  const get = fake({ "/repos/o/r/commits/abc/check-runs": { check_runs: [{ name: "slow", status: "queued" }] }, "/repos/o/r/commits/abc/status": { statuses: [] } });
  const ctx = await collectChecks(get, { repo: "o/r", sha: "abc", waitS: 5, now: () => (t += 3000), sleep: async () => {} });
  assert.equal(ctx.checksSettled, false);
  assert.deepEqual(ctx.pendingChecks, ["slow"]);
  assert.equal((await (await loadGuard("checks-green")).run({ ctx, cfg: {}, files: [] })).pass, false);
});

test("collectChecks does not wait for a check the repo ignores", async () => {
  const get = fake({ "/repos/o/r/commits/abc/check-runs": { check_runs: [{ name: "merge-gate", status: "queued" }] }, "/repos/o/r/commits/abc/status": { statuses: [] } });
  const ctx = await collectChecks(get, { repo: "o/r", sha: "abc", ignore: ["merge-gate"], waitS: 0 });
  assert.equal(ctx.checksSettled, true);
});

test("collectChecks waits for and reports failures on later GitHub pages", async () => {
  const completed = Array.from({ length: 100 }, (_, i) => ({ name: `test ${i}`, status: "completed", conclusion: "success" }));
  let waited = false;
  const get = fake({
    "/repos/o/r/commits/abc/check-runs": (path) => {
      const page = new URL(path, "https://api.github.com").searchParams.get("page");
      const check_runs = page === "2"
        ? [waited ? { name: "last test", status: "completed", conclusion: "failure" } : { name: "last test", status: "queued" }]
        : completed;
      return { total_count: 101, check_runs };
    },
    "/repos/o/r/commits/abc/status": { statuses: [] },
  });
  const ctx = await collectChecks(get, { repo: "o/r", sha: "abc", sleep: async () => { waited = true; } });
  assert.equal(ctx.checkRuns.length, 101);
  assert.equal(waited, true);
  assert.equal(ctx.checksSettled, true);
  const result = await (await loadGuard("checks-green")).run({ ctx, cfg: {}, files: [] });
  assert.equal(result.pass, false);
  assert.match(result.findings[0].message, /last test: failure/);
});

test("collectDeployRuns reads the latest deploy run of each workflow with its steps", async () => {
  const get = fake({
    "/repos/o/r/actions/runs/7/jobs": { jobs: [{ name: "deploy", conclusion: "success", steps: [{ name: "Deploy", conclusion: "skipped" }] }] },
    "/repos/o/r/actions/runs?": { workflow_runs: [
      { id: 7, workflow_id: 1, name: "Deploy", path: ".github/workflows/deploy.yml", event: "push", conclusion: "success", html_url: "u" },
      { id: 6, workflow_id: 1, name: "Deploy", event: "push", conclusion: "failure" },
      { id: 5, workflow_id: 2, name: "CI", event: "push", conclusion: "success" },
    ] },
  });
  const runs = await collectDeployRuns(get, { repo: "o/r", branch: "main" });
  assert.equal(runs.length, 1);
  const res = await (await loadGuard("deploy-delivered")).run({ ctx: { deployRuns: runs }, cfg: {}, files: [] });
  assert.equal(res.pass, false);
  assert.match(res.findings[0].message, /nothing was deployed/);
});

// ---- gel verify on a real git repo
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" });
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "gel-verify-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t"); git(root, "config", "user.name", "t");
  const put = (m) => { for (const [f, b] of Object.entries(m)) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), b); } };
  put(files);
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  const base = git(root, "rev-parse", "HEAD").trim();
  return { root, base, put, commit: (m) => { git(root, "add", "-A"); git(root, "commit", "-qm", m); } };
}
const SRC = "export const price = (n) => n * 2;\n";
const TEST_THAT_CHECKS = 'import { price } from "../src/price.mjs";\nimport assert from "node:assert";\nassert.equal(price(2), 6);\n'; // fails on base (4), passes on the change (6)
const TEST_THAT_DOES_NOT = 'import "../src/price.mjs";\n'; // loads the file, asserts nothing
const CFG = { verify: { test: "node tests/price.test.mjs", source: ["src/**"] } };

test("verify: a change that a test really checks is caught when reverted", () => {
  const r = repo({ "src/price.mjs": SRC, "tests/price.test.mjs": TEST_THAT_DOES_NOT });
  try {
    r.put({ "src/price.mjs": "export const price = (n) => n * 3;\n", "tests/price.test.mjs": TEST_THAT_CHECKS });
    r.commit("change");
    const out = verify({ root: r.root, cfg: CFG, base: r.base });
    assert.equal(out.test.exit, 0);
    assert.deepEqual(out.revert.map((x) => [x.file, x.caught]), [["src/price.mjs", true]]);
    assert.equal(readFileSync(join(r.root, "src/price.mjs"), "utf8"), "export const price = (n) => n * 3;\n", "the file is put back");
    assert.equal(git(r.root, "status", "--porcelain").trim(), "");
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("verify FAILING FIXTURE: tests that never check the change still pass when it is reverted, and the guard says so", async () => {
  const r = repo({ "src/price.mjs": SRC, "tests/price.test.mjs": TEST_THAT_DOES_NOT });
  try {
    r.put({ "src/price.mjs": "export const price = (n) => n * 3;\n", "tests/price.test.mjs": TEST_THAT_DOES_NOT + "// touched\n" });
    r.commit("change with a test that asserts nothing");
    const out = verify({ root: r.root, cfg: CFG, base: r.base });
    assert.equal(out.test.exit, 0);
    assert.equal(out.revert[0].caught, false);
    const res = await (await loadGuard("change-verified")).run({ ctx: { verify: out }, cfg: CFG, changes: diffChanges(r.root, r.base), files: [] });
    assert.equal(res.pass, false);
    assert.match(res.findings[0].message, /no test exercises this change/);
    assert.equal(res.findings[0].file, "src/price.mjs");
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("verify: a red test or build is reported with its output tail and stops later steps", () => {
  const r = repo({ "src/price.mjs": SRC, "tests/price.test.mjs": TEST_THAT_CHECKS });
  try {
    r.put({ "src/price.mjs": "export const price = (n) => n * 3;\n" });
    r.commit("c");
    const bad = verify({ root: r.root, cfg: { verify: { build: "echo boom >&2; exit 3", test: "node tests/price.test.mjs" } }, base: r.base });
    assert.equal(bad.build.exit, 3);
    assert.match(bad.build.tail, /boom/);
    assert.equal(bad.test, undefined);
    const red = verify({ root: r.root, cfg: { verify: { test: "exit 1" } }, base: r.base });
    assert.equal(red.test.exit, 1);
    assert.deepEqual(red.revert, []); // no revert check on a red run
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("verify: a file with uncommitted edits is skipped, never overwritten", () => {
  const r = repo({ "src/price.mjs": SRC, "tests/price.test.mjs": TEST_THAT_CHECKS });
  try {
    r.put({ "src/price.mjs": "export const price = (n) => n * 3;\n" });
    r.commit("c");
    r.put({ "src/price.mjs": "export const price = (n) => n * 3; // local edit\n" });
    const out = verify({ root: r.root, cfg: CFG, base: r.base });
    assert.match(out.revert[0].skipped, /uncommitted/);
    assert.match(readFileSync(join(r.root, "src/price.mjs"), "utf8"), /local edit/);
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("verify: a new file is reverted by deleting it, and comes back", () => {
  const r = repo({ "src/price.mjs": SRC, "tests/t.mjs": "import 'node:fs'; import('../src/extra.mjs');\n" });
  try {
    r.put({ "src/extra.mjs": "export const x = 1;\n" });
    r.commit("add");
    const out = verify({ root: r.root, cfg: { verify: { test: "node tests/t.mjs", source: ["src/**"] } }, base: r.base });
    assert.deepEqual(out.revert.map((x) => [x.file, x.caught]), [["src/extra.mjs", true]]); // the import fails without it
    assert.equal(readFileSync(join(r.root, "src/extra.mjs"), "utf8"), "export const x = 1;\n");
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

// ---- gel perf
test("parseMeasure reads a bare number or JSON on the last line", () => {
  assert.deepEqual(parseMeasure("warming up\n12.5\n"), { value: 12.5 });
  assert.deepEqual(parseMeasure('x\n{"value": 3, "unit": "s"}'), { value: 3, unit: "s" });
  assert.equal(parseMeasure("no number here"), null);
});

test("perf takes the median of the runs and fails on a command with no number; a slow result fails the guard", async () => {
  const r = repo({ "src/a.mjs": "1\n" });
  try {
    r.put({ "bench.mjs": 'import { readFileSync, writeFileSync, existsSync } from "node:fs"; const n = existsSync("n") ? +readFileSync("n") : 0; writeFileSync("n", String(n + 1)); console.log(JSON.stringify({ value: [10, 30, 20][n % 3], unit: "s" }));\n' });
    const cfg = { perf_budget: { command: "node bench.mjs", runs: 3, baseline: "bench/perf-baseline.json" } };
    const m = perf({ root: r.root, cfg });
    assert.equal(m.value, 20);
    assert.deepEqual(m.runs, [10, 30, 20]);
    assert.equal(perf({ root: r.root, cfg: { perf_budget: { command: "echo hi", runs: 1 } } }).value, null);
    const g = await loadGuard("perf-budget");
    const files = { "bench/perf-baseline.json": '{"value": 10, "unit": "s"}' };
    const res = await g.run({ ctx: { perf: m }, cfg, files: [], changes: [{ status: "M", file: "src/a.mjs" }], read: (f) => files[f] ?? null });
    assert.equal(res.pass, false);
    assert.match(res.findings[0].message, /slower by 100%: 20s against a baseline of 10s/);
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("the CLI: gel verify and gel perf write into the ctx file, and gel run judges them", () => {
  const r = repo({ "src/price.mjs": SRC, "tests/price.test.mjs": TEST_THAT_DOES_NOT, "docs/gel.json": JSON.stringify({ mode: "block", guards: { "change-verified": "block" }, verify: CFG.verify }) });
  try {
    r.put({ "src/price.mjs": "export const price = (n) => n * 3;\n" });
    r.commit("change");
    const gel = new URL("../bin/gel.mjs", import.meta.url).pathname;
    const ctx = join(r.root, "ctx.json");
    execFileSync("node", [gel, "verify", "--root", r.root, "--base", r.base, "--ctx", ctx], { stdio: "pipe" });
    assert.equal(JSON.parse(readFileSync(ctx, "utf8")).verify.revert[0].caught, false);
    let code = 0, out = "";
    try { execFileSync("node", [gel, "run", "--root", r.root, "--base", r.base, "--ctx", ctx], { encoding: "utf8", stdio: "pipe" }); } catch (e) { code = e.status; out = e.stdout; }
    assert.equal(code, 1);
    assert.match(out, /no test exercises this change/);
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});
