// No node imports here: this file also runs in a browser. It judges what `gel perf` measured (ctx.perf) against a baseline
// committed in the repo; it never runs code. "The change made the thing slower (or bigger)": a named benchmark command prints a
// number, `gel perf` takes the median of a few runs, and this guard fails when it is worse than the baseline by more than the tolerance.
// docs/gel.json:
//   "perf_budget": { "command": "node bench/shrink.mjs", "baseline": "bench/perf-baseline.json", "better": "lower",
//                    "tolerance": 0.1, "runs": 3, "paths": ["src/**"] }
// baseline file: { "value": 4.2, "unit": "s", "measuredAt": "2026-11-23" }   (`gel perf --update-baseline` writes it)
// ctx.perf: { value, unit, runs: [..], exit, tail }
import { matchAny } from "../../lib/glob.mjs";
import { isSourceFile } from "../tests-with-change/index.mjs";

export const name = "perf-budget";

export function run({ ctx = {}, cfg = {}, changes, read }) {
  const p = cfg.perf_budget;
  if (!p?.command) return { pass: true, findings: [] };
  const f = (message, file = "(perf)") => ({ pass: false, findings: [{ file, line: 0, message }] });
  const raw = read?.(p.baseline ?? "bench/perf-baseline.json");
  let base = null;
  try { base = raw ? JSON.parse(raw) : null; } catch { return f(`${p.baseline ?? "bench/perf-baseline.json"} is not valid JSON`); }
  if (!base || !(typeof base.value === "number" && base.value > 0)) return f(`no baseline: ${p.baseline ?? "bench/perf-baseline.json"} must hold {"value": <number>}. Create it with: gel perf --update-baseline`);
  if (!changes && !ctx.perf) return { pass: true, findings: [] };
  const paths = p.paths;
  const relevant = !changes || (changes ?? []).some((x) => x.status !== "D" && (paths ? matchAny(paths, x.file) : isSourceFile(x.file, cfg.tests_with_change)));
  const m = ctx.perf;
  if (!m) return relevant ? f(`code changed but \`gel perf\` did not run, so "${p.command}" was not measured`) : { pass: true, findings: [] };
  if (m.exit !== 0 || typeof m.value !== "number" || !Number.isFinite(m.value)) return f(`\`${p.command}\` ${m.exit !== 0 ? `exited ${m.exit}` : "printed no number"}${m.tail ? `: ${String(m.tail).trim().split("\n").slice(-2).join(" | ").slice(0, 200)}` : ""}`);
  const tol = typeof p.tolerance === "number" ? p.tolerance : 0.1;
  const lower = (p.better ?? "lower") === "lower";
  const worse = lower ? m.value > base.value * (1 + tol) : m.value < base.value * (1 - tol);
  if (!worse) return { pass: true, findings: [] };
  const pct = Math.round(Math.abs(m.value / base.value - 1) * 1000) / 10;
  const unit = m.unit ?? base.unit ?? "";
  return f(`${lower ? "slower" : "lower"} by ${pct}%: ${m.value}${unit} against a baseline of ${base.value}${unit} (budget ${Math.round(tol * 100)}%, ${m.runs?.length ?? 1} run${(m.runs?.length ?? 1) > 1 ? "s" : ""}, \`${p.command}\`)`);
}
