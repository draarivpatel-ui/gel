// `gel verify` and `gel perf`: the two collectors that run the project's own commands. The guards (change-verified,
// perf-budget) only judge what these write into the ctx file, so the guards stay offline and browser-safe.
// The commands come from docs/gel.json, which is lane C (a person approves it), and they run on the pull request's own
// checkout like any CI step: use them under `pull_request`, never `pull_request_target`.
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { diffChanges, baseReader } from "./diff.mjs";
import { isSourceFile } from "../guards/tests-with-change/index.mjs";

export function sh(cmd, root, timeoutS = 600, env = {}) {
  const r = spawnSync("/bin/sh", ["-c", cmd], { cwd: root, encoding: "utf8", timeout: timeoutS * 1000, maxBuffer: 1 << 26, env: { ...process.env, ...env } });
  const timedOut = r.error?.code === "ETIMEDOUT";
  return { cmd, exit: timedOut ? 124 : (r.status ?? 1), timedOut, stdout: r.stdout ?? "", tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter(Boolean).slice(-15).join("\n") };
}
const brief = ({ stdout, ...rest }) => rest;

// git is looked up in fixed system directories, not through PATH (Sonar S4036)
const GIT = ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"].find((f) => existsSync(f)) ?? "/usr/bin/git";
function dirtyFiles(root) {
  try { return new Set(execFileSync(GIT, ["status", "--porcelain", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean).map((l) => l.slice(3))); } catch { return null; }
}

// Install, build, test; then, for each changed source file, put it back to its base version and run the tests again.
// A test run that still passes means no test notices the change.
export function verify({ root, cfg, base, log = () => {} }) {
  const v = cfg.verify ?? {};
  const t = v.timeout_s ?? 600;
  const out = { ran: true, startedAt: new Date().toISOString() };
  const dirty = dirtyFiles(root);
  for (const step of ["install", "build", "test"]) {
    if (!v[step]) continue;
    log(`verify: ${step}: ${v[step]}`);
    out[step] = brief(sh(v[step], root, t));
    if (out[step].exit !== 0 && step !== "test") return out; // nothing after a failed install or build means anything
  }
  out.revert = [];
  if (v.revert_check === false || !v.test || out.test?.exit !== 0) return out;
  const changes = diffChanges(root, base);
  const readBase = baseReader(root, base);
  if (!changes || !readBase) return out;
  const targets = changes.filter((c) => (c.status === "M" || c.status === "A") && isSourceFile(c.file, v.source ? { source: v.source } : cfg.tests_with_change));
  const max = v.max_revert_files ?? 5;
  targets.forEach((c, i) => {
    if (i >= max) { out.revert.push({ file: c.file, skipped: `more than ${max} changed files (max_revert_files)` }); return; }
    if (dirty === null || dirty.has(c.file)) { out.revert.push({ file: c.file, skipped: "the file has uncommitted changes" }); return; }
    const path = join(root, c.file);
    const was = existsSync(path) ? readFileSync(path) : null;
    const before = c.status === "M" ? readBase(c.file) : null;
    if (c.status === "M" && before === null) { out.revert.push({ file: c.file, skipped: "no base version" }); return; }
    try {
      if (c.status === "M") writeFileSync(path, before); else rmSync(path, { force: true });
      log(`verify: revert ${c.file}`);
      const r = sh(v.test, root, t);
      out.revert.push({ file: c.file, caught: r.exit !== 0 });
    } finally {
      if (was === null) rmSync(path, { force: true }); else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, was); }
    }
  });
  return out;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// last line of the command's output: a number, or JSON with "value" (and an optional "unit")
export function parseMeasure(stdout) {
  const last = String(stdout).trim().split("\n").filter(Boolean).at(-1) ?? "";
  try { const j = JSON.parse(last); if (typeof j === "number") return { value: j }; if (typeof j?.value === "number") return { value: j.value, unit: j.unit }; } catch { /* not JSON */ }
  return null;
}

export function perf({ root, cfg, log = () => {} }) {
  const p = cfg.perf_budget ?? {};
  const n = Math.max(1, p.runs ?? 3);
  const values = [];
  let unit, last;
  for (let i = 0; i < n; i++) {
    log(`perf: run ${i + 1}/${n}: ${p.command}`);
    last = sh(p.command, root, p.timeout_s ?? 600);
    const m = last.exit === 0 ? parseMeasure(last.stdout) : null;
    if (!m) return { value: null, exit: last.exit || 1, tail: last.tail, command: p.command, runs: values };
    values.push(m.value); unit = m.unit ?? unit;
  }
  return { value: median(values), unit, exit: 0, command: p.command, runs: values };
}

export function mergeCtx(file, key, value) {
  const ctx = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  ctx[key] = value;
  writeFileSync(file, JSON.stringify(ctx));
}
