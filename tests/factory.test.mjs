import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { touchPoints, factory, fromGh } from "../lib/factory.mjs";

const gel = join(import.meta.dirname, "..", "bin", "gel.mjs");
const human = { login: "alex" };
const pr = (x = {}) => ({ number: 1, headRef: "feat/x", createdAt: "2026-11-01T00:00:00Z", mergedAt: "2026-11-01T02:00:00Z", author: human, mergedBy: human, autoMerge: false, reviews: [], comments: [], commits: [], ...x });

test("a hand-opened, hand-merged PR is two touch points", () => {
  assert.equal(touchPoints(pr()).total, 2);
});

test("a loop PR that auto-merges is zero touch points", () => {
  const t = touchPoints(pr({ headRef: "gel/fix-pinned-actions", autoMerge: true, mergedBy: { login: "github-actions[bot]" } }));
  assert.equal(t.total, 0);
});

test("a loop PR a person reviews, fixes up and merges costs each of those", () => {
  const t = touchPoints(pr({ headRef: "gel/fix-pinned-actions", reviews: [{ login: "alex" }, { login: "copilot-pull-request-reviewer[bot]" }], comments: [{ login: "alex" }], commits: [{ at: "2026-11-01T01:00:00Z", logins: ["alex"] }, { at: "2026-10-31T23:00:00Z", logins: ["alex"] }] }));
  assert.deepEqual(t, { opened: 0, reviews: 1, comments: 1, commits: 1, merge: 1, total: 4 });
});

test("factory summarises touch points, zero-touch share and lead time; unmerged PRs are ignored", () => {
  const zero = pr({ number: 2, headRef: "gel/x", autoMerge: true, mergedBy: { login: "bot[bot]" }, mergedAt: "2026-11-01T01:00:00Z" });
  const r = factory([pr(), zero, pr({ number: 3, mergedAt: null })]);
  assert.equal(r.merged, 2);
  assert.equal(r.touchPerPr, 1);
  assert.equal(r.zeroTouch, 0.5);
  assert.equal(r.loopShare, 0.5);
  assert.equal(r.leadHoursP50, 1);
  assert.equal(factory([]).touchPerPr, null);
});

test("fromGh maps gh's json shape", () => {
  const g = fromGh({ number: 9, headRefName: "gel/x", createdAt: "a", mergedAt: "b", author: { login: "u", is_bot: false }, mergedBy: { login: "u" }, autoMergeRequest: { enabledBy: {} }, reviews: [{ author: { login: "r" } }], comments: [], commits: [{ committedDate: "c", authors: [{ login: "u" }] }] });
  assert.equal(g.autoMerge, true);
  assert.equal(g.headRef, "gel/x");
  assert.equal(g.reviews[0].login, "r");
  assert.deepEqual(g.commits[0].logins, ["u"]);
});

test("gel factory reads a file and prints the table", () => {
  const f = join(mkdtempSync(join(tmpdir(), "fac-")), "prs.json");
  writeFileSync(f, JSON.stringify([pr()]));
  const r = spawnSync(process.execPath, [gel, "factory", f], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /touch points per PR/);
  assert.equal(JSON.parse(spawnSync(process.execPath, [gel, "factory", f, "--json"], { encoding: "utf8" }).stdout).touchPerPr, 2);
});
