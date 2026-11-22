// e2e: `gel grade` on recorded real repos and live click maps (e2e/cases.json, written by `node e2e/record.mjs`).
// Each case becomes a repo on disk, the real CLI runs on it, and its grade must be the one expected. Grades with no
// real example are made-up cases that say why; e2e/README.md lists which grades have real examples, and this test
// fails when that table stops matching the cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { GRADES, CHECKS } from "../lib/grades.mjs";
import { coverage } from "../e2e/coverage.mjs";

const root = join(import.meta.dirname, "..");
const gel = join(root, "bin", "gel.mjs");
const cases = JSON.parse(readFileSync(join(root, "e2e", "cases.json"), "utf8"));
const sources = JSON.parse(readFileSync(join(root, "e2e", "sources.json"), "utf8")).cases;

function repo(c) {
  const d = mkdtempSync(join(tmpdir(), `e2e-${c.id}-`));
  mkdirSync(join(d, "docs"), { recursive: true });
  writeFileSync(join(d, "docs", "gel.json"), JSON.stringify(c.cfg));
  for (const [f, text] of Object.entries(c.files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), text); }
  return d;
}

for (const c of cases) {
  test(`${c.real ? "real" : "made up"} ${c.check} ${c.id}: ${c.expect ?? "no grade"}`, () => {
    const res = spawnSync(process.execPath, [gel, "grade", "--root", repo(c), "--now", `${c.recordedAt}T12:00:00Z`, "--json"], { encoding: "utf8" });
    const got = JSON.parse(res.stdout)[c.check];
    assert.equal(got.grade, c.expect, `${c.id}: ${JSON.stringify(got)}`);
    assert.equal(res.status, Object.values(JSON.parse(res.stdout)).some((g) => g.grade === "bad") ? 1 : 0);
  });
}

test("cases.json is what record.mjs wrote from sources.json (same cases, same order, same expectations)", () => {
  assert.deepEqual(cases.map((c) => [c.id, c.check, c.expect, c.real]), sources.map((c) => [c.id, c.check, c.expect, c.real]));
});

test("every real case names its source and date; every made-up case says why", () => {
  for (const c of cases) {
    if (c.real) {
      assert.ok([c.source].flat().every((s) => /^https:\/\//.test(s)), `${c.id} has no https source`);
      assert.match(c.recordedAt, /^\d{4}-\d{2}-\d{2}$/);
    } else assert.ok(typeof c.why === "string" && c.why.length > 10, `${c.id} must say why it is made up`);
  }
});

test("every grade of every check has a case", () => {
  for (const check of CHECKS) for (const g of GRADES) assert.ok(cases.some((c) => c.check === check && c.expect === g), `${check} has no "${g}" case`);
});

test("e2e/README.md shows which grades have a real example", () => {
  const readme = readFileSync(join(root, "e2e", "README.md"), "utf8");
  assert.ok(readme.includes(coverage(cases)), "e2e/README.md is out of date: run node e2e/record.mjs");
});
