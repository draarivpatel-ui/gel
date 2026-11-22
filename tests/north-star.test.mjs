import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const gel = join(import.meta.dirname, "..", "bin", "gel.mjs");
function repo(value) {
  const d = mkdtempSync(join(tmpdir(), "ns-"));
  mkdirSync(join(d, "bench"));
  writeFileSync(join(d, "bench", "README.md"), "how\n");
  writeFileSync(join(d, "bench", "m.mjs"), `console.log(JSON.stringify({ value: ${value}, baseline: 26.1, unit: "s" }))\n`);
  mkdirSync(join(d, "docs"), { recursive: true }); writeFileSync(join(d, "docs", "gel.json"), JSON.stringify({ mode: "block", guards: { "north-star": "block" }, north_star: { metric: "first start to healthy", baseline: "Docker Compose", target: { ratio: 8, better: "lower" }, result: "bench/north-star.json", evidence: "bench/README.md", measure: "node bench/m.mjs" } }));
  return d;
}
const gelRun = (args) => spawnSync(process.execPath, [gel, ...args], { encoding: "utf8" });

test("gel north-star --measure exits 1 when the target is missed, 0 when met", () => {
  assert.equal(gelRun(["north-star", "--root", repo(8.7), "--measure"]).status, 1);
  assert.equal(gelRun(["north-star", "--root", repo(2.5), "--measure"]).status, 0);
});

test("in block mode gel run fails on a missed north star", () => {
  const d = repo(8.7);
  gelRun(["north-star", "--root", d, "--measure"]);
  assert.notEqual(gelRun(["run", "--root", d]).status, 0);
  const ok = repo(2.5);
  gelRun(["north-star", "--root", ok, "--measure"]);
  assert.equal(gelRun(["run", "--root", ok]).status, 0, gelRun(["run", "--root", ok]).stdout);
});

test("on a pull request that touches an unrelated file the result and evidence files are still found", () => {
  const d = repo(2.5);
  gelRun(["north-star", "--root", d, "--measure"]);
  const git = (...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").stdout.trim();
  writeFileSync(join(d, "other.txt"), "x\n");
  git("add", "-A");
  git("commit", "-qm", "unrelated change");
  const r = gelRun(["run", "--root", d, "--base", base]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("a measure that exits non-zero with a number that meets the target: published, but the run is not green", () => {
  const d = repo(2.5);
  writeFileSync(join(d, "bench", "m.mjs"), `console.log(JSON.stringify({ value: 2.5, baseline: 26.1, unit: "s", problem: "the page scrolls sideways" })); process.exit(1)\n`);
  const r = gelRun(["north-star", "--root", d, "--measure"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /the measure exited 1: the page scrolls sideways/);
  assert.match(readFileSync(join(d, "bench", "north-star.json"), "utf8"), /"value": 2.5/);
});

test("a measure that finds nothing says why: its problem is printed, exit 2", () => {
  const d = repo(2.5);
  writeFileSync(join(d, "bench", "m.mjs"), `console.log(JSON.stringify({ value: null, problem: "no button a visitor can press (Start: covered by div.cookie)" })); process.exit(2)\n`);
  const r = gelRun(["north-star", "--root", d, "--measure"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /covered by div\.cookie/);
});
