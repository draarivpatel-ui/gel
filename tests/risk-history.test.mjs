// risk-history: a pure score from git history, browser-safe, deterministic, and silent when it cannot judge.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectHistory } from "../lib/history.mjs";

const m = await import("../guards/risk-history/index.mjs");
const now = "2026-11-23T12:00:00Z";

test("risk-history imports nothing from node", () => {
  const src = readFileSync(new URL("../guards/risk-history/index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\bfrom\s+["']node:/);
});

test("scoreFile is deterministic and lists where each point came from", () => {
  const h = { changes: 10, fixes: 4, reverts: 1, lastAt: "2026-11-20T00:00:00Z" };
  const a = m.scoreFile(h, { now: Date.parse(now), hasTest: false });
  assert.deepEqual(a, m.scoreFile(h, { now: Date.parse(now), hasTest: false }));
  assert.equal(a.score, a.parts.fixes + a.parts.recent + a.parts.churn + a.parts.untested);
  assert.equal(a.parts.fixes, 36); // (4 + 2*1) / 10 of 60
});

test("a test in the pull request lowers the score by the untested weight", () => {
  const h = { changes: 10, fixes: 4, reverts: 1, lastAt: "2020-01-01T00:00:00Z" };
  const without = m.scoreFile(h, { now: Date.parse(now), hasTest: false }).score;
  assert.equal(without - m.scoreFile(h, { now: Date.parse(now), hasTest: true }).score, 10);
});

test("a shallow clone, a push scan and a young repo all pass without a finding", () => {
  const files = { "a.ts": { changes: 9, fixes: 9, reverts: 3, lastAt: now } };
  const changes = [{ status: "M", file: "a.ts" }];
  for (const [ch, history] of [[changes, { shallow: true, commits: 0, files }], [null, { shallow: false, commits: 99, files }], [changes, { shallow: false, commits: 3, files }], [changes, undefined]]) {
    assert.deepEqual(m.run({ changes: ch, ctx: { now, history }, cfg: {} }), { pass: true, findings: [] });
  }
});

test("collectHistory counts fixes and reverts from commit subjects, and a shallow clone says so", () => {
  const d = mkdtempSync(join(tmpdir(), "rh-"));
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, stdio: "ignore" });
  git("init", "-q");
  mkdirSync(join(d, "src"));
  for (const [i, subject] of ["feat: add a", "fix: a crashes", "Revert \"fix: a crashes (#2)\""].entries()) {
    writeFileSync(join(d, "src", "a.ts"), `v${i}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", subject);
  }
  const h = collectHistory(d);
  assert.equal(h.shallow, false);
  assert.equal(h.commits, 3);
  assert.deepEqual([h.files["src/a.ts"].changes, h.files["src/a.ts"].fixes, h.files["src/a.ts"].reverts], [3, 1, 1]);
  assert.equal(collectHistory(join(d, "nope")).shallow, true);
});
