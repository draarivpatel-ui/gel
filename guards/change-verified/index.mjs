// No node imports here: this file also runs in a browser. It judges what `gel verify` measured (ctx.verify); it never runs code.
// "The change was built, tested and exercised." tests-with-change only asks that a test FILE changed. This guard asks whether
// the project's own build and tests really ran green on the pull request, and whether a test notices the change at all: `gel verify`
// puts each changed source file back to its base version and runs the tests again. If they still pass, nothing tests that change.
// Opt in with docs/gel.json:
//   "verify": { "install": "bun install --frozen-lockfile", "build": "bun run build", "test": "node --test scripts/*.test.mjs",
//               "source": ["src/**"], "max_revert_files": 5, "timeout_s": 600 }
// ctx.verify: { ran, install, build, test: { cmd, exit, tail }, revert: [{ file, caught, skipped? }] }
import { isSourceFile } from "../tests-with-change/index.mjs";

export const name = "change-verified";

// a green test command that ran nothing proves nothing (a wrong path, a filter that matched no test)
const NO_TESTS = /\bno tests? (?:found|ran|were run|to run)\b|\bran 0 tests?\b|\b0 tests? (?:passed|ran|run)\b|collected 0 items|\b0 passing\b|\bnothing to test\b|\btests?\s+0\b/i;

export function run({ ctx = {}, cfg = {}, changes }) {
  const v = cfg.verify;
  if (!v || !(v.build || v.test)) return { pass: true, findings: [] };
  if (!changes) return { pass: true, findings: [] }; // a push scan has no change to judge
  const touched = changes.filter((x) => x.status !== "D");
  const src = touched.filter((x) => isSourceFile(x.file, v.source ? { source: v.source } : cfg.tests_with_change));
  if (!src.length && !ctx.verify) return { pass: true, findings: [] };
  const findings = [];
  const add = (file, message) => findings.push({ file, line: 0, message });
  const r = ctx.verify;
  if (!r || !r.ran) {
    add("(verify)", `product code changed (${src.slice(0, 3).map((x) => x.file).join(", ")}) but \`gel verify\` did not run, so the build and the tests were not checked by GEL`);
    return { pass: false, findings };
  }
  for (const step of ["install", "build", "test"]) {
    const s = r[step];
    if (s && s.exit !== 0) add("(verify)", `${step} \`${s.cmd}\` ${s.timedOut ? "timed out" : `exited ${s.exit}`}${s.tail ? `: ${String(s.tail).trim().split("\n").slice(-2).join(" | ").slice(0, 200)}` : ""}`);
  }
  if (r.test?.exit === 0 && NO_TESTS.test(r.test.tail ?? "")) add("(verify)", `test \`${r.test.cmd}\` exited 0 but ran no tests`);
  if (v.test && !r.test) add("(verify)", "a test command is configured but it did not run");
  if (v.build && !r.build) add("(verify)", "a build command is configured but it did not run");
  for (const c of r.revert ?? []) {
    if (c.skipped) continue;
    if (c.caught === false) add(c.file, "the tests still pass with this file put back to its base version: no test exercises this change");
  }
  return { pass: findings.length === 0, findings };
}
