import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { isPaused, budget } from "../lib/brakes.mjs";

test("kill switch reads common on values and nothing else", () => {
  for (const v of ["1", "true", "TRUE", " yes ", "on", "pause", "paused"]) assert.equal(isPaused(v), true, v);
  for (const v of ["", "0", "false", "no", undefined, null, "off"]) assert.equal(isPaused(v), false, String(v));
});

test("budget never exceeds max or the room under the cap", () => {
  assert.equal(budget({ max: 5, wip: 3, open: 0 }).allow, 3);
  assert.equal(budget({ max: 2, wip: 3, open: 0 }).allow, 2);
  assert.equal(budget({ max: 5, wip: 3, open: 2 }).allow, 1);
});

test("budget is zero at or over the cap and says why", () => {
  const b = budget({ max: 5, wip: 3, open: 3 });
  assert.equal(b.allow, 0);
  assert.match(b.why, /3 loop PRs are open, the cap is 3/);
  assert.equal(budget({ max: 5, wip: 3, open: 7 }).allow, 0);
});

test("flywheel with GEL_PAUSE set exits 0 before it fetches or clones anything", () => {
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "flywheel.mjs"), "--dry-run", "--data", "http://127.0.0.1:9/none"], { encoding: "utf8", env: { ...process.env, GEL_PAUSE: "1" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Paused/);
});
