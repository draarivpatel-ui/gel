import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { plan, apply, warnings, promoteMarkdown } from "../lib/promote.mjs";

const gel = join(import.meta.dirname, "..", "bin", "gel.mjs");
const rep = (...gs) => ({ guards: gs.map(([guard, action]) => ({ guard, advice: { action, why: "w" } })) });

test("promote advice on a report guard proposes block; demote on a block guard proposes report", () => {
  const raw = { guards: { b: "block" } };
  assert.deepEqual(plan(rep(["a", "promote"], ["b", "demote"]), raw).map((c) => [c.guard, c.from, c.to]), [["a", "report", "block"], ["b", "block", "report"]]);
});

test("hold, keep, and no-op advice propose nothing", () => {
  assert.deepEqual(plan(rep(["a", "hold"], ["b", "keep"], ["c", "promote"], ["d", "demote"]), { guards: { c: "block" } }), []);
});

test("apply changes only the named guards and keeps the rest of the file", () => {
  const out = apply({ mode: "block", north_star: { x: 1 }, guards: { a: "report", z: "block" } }, [{ guard: "a", to: "block" }]);
  assert.deepEqual(out, { mode: "block", north_star: { x: 1 }, guards: { a: "block", z: "block" } });
});

test("a promotion under mode report carries a warning", () => {
  const ch = [{ guard: "a", from: "report", to: "block", why: "w" }];
  assert.equal(warnings({}, ch).length, 1);
  assert.equal(warnings({ mode: "block" }, ch).length, 0);
  assert.match(promoteMarkdown(ch, warnings({}, ch)), /lane C/);
  assert.match(promoteMarkdown([]), /No guard should change/);
});

test("gel promote --write edits docs/gel.json from records and labels", () => {
  const d = mkdtempSync(join(tmpdir(), "promo-"));
  mkdirSync(join(d, "docs"));
  writeFileSync(join(d, "docs", "gel.json"), JSON.stringify({ mode: "block", guards: { "secret-scan": "report" } }));
  const rec = (i) => JSON.stringify({ repo: "o/r", sha: "s" + i, lane: "B", needsPerson: false, ms: 40, blocked: [], results: [{ guard: "secret-scan", level: "report", pass: i >= 5, findings: i < 5 ? 1 : 0, top: i < 5 ? [{ file: `src/k${i}.js`, line: 3, message: "AWS key" }] : [] }] });
  writeFileSync(join(d, "r.jsonl"), Array.from({ length: 20 }, (_, i) => rec(i)).join("\n") + "\n");
  writeFileSync(join(d, "labels.json"), JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ guard: "secret-scan", file: `src/k${i}.js`, line: 3, verdict: "real" }))));
  const r = spawnSync(process.execPath, [gel, "promote", join(d, "r.jsonl"), "--labels", join(d, "labels.json"), "--root", d, "--write"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /secret-scan/);
  assert.equal(JSON.parse(readFileSync(join(d, "docs", "gel.json"), "utf8")).guards["secret-scan"], "block");
});
