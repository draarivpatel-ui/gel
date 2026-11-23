// No node imports here: this file also runs in a browser. It reads `ctx.history` (built from git by lib/history.mjs)
// and the pull request's `changes`, and scores each changed product file from its own past: how often it needed a
// fix or a revert, how recently it moved, how often it changes, and whether this pull request touches a test.
// Same history, same score. A push scan, a shallow clone or a young repo "does not apply" and passes: it never guesses.
// gel.json can tune it:
//   "risk_history": { "threshold": 60, "min_commits": 20, "weights": { "fixes": 60, "recent": 15, "churn": 15, "untested": 10 } }
import { matchAny } from "../../lib/glob.mjs";
import { TESTS, EXEMPT } from "../tests-with-change/index.mjs";

export const name = "risk-history";

const CODE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|go|rs|rb|java|kt|swift|php|cs|c|cc|cpp|h|hpp|sh|star)$/i;
export const WEIGHTS = { fixes: 60, recent: 15, churn: 15, untested: 10 };
const DAY = 86400000;

// Score one file 0..100 and say where each point came from.
export function scoreFile(h, { weights = WEIGHTS, now, hasTest }) {
  const w = { ...WEIGHTS, ...weights };
  const changes = h?.changes ?? 0;
  const bad = (h?.fixes ?? 0) + 2 * (h?.reverts ?? 0);
  const parts = {
    fixes: Math.round(w.fixes * Math.min(1, bad / Math.max(changes, 3))),
    recent: h?.lastAt && now - Date.parse(h.lastAt) <= 14 * DAY ? w.recent : 0,
    churn: Math.round(w.churn * Math.min(1, changes / 20)),
    untested: hasTest ? 0 : w.untested,
  };
  return { score: Object.values(parts).reduce((a, b) => a + b, 0), parts, changes, fixes: h?.fixes ?? 0, reverts: h?.reverts ?? 0 };
}

export function run({ changes, ctx, cfg }) {
  const c = cfg?.risk_history ?? {};
  const h = ctx?.history;
  if (!changes || !h || h.shallow || (h.commits ?? 0) < (c.min_commits ?? 20)) return { pass: true, findings: [] };
  const tests = TESTS;
  const exempt = [...EXEMPT, ...(c.exempt ?? [])];
  const touched = changes.filter((x) => x.status !== "D");
  const hasTest = touched.some((x) => matchAny(tests, x.file));
  const src = touched.filter((x) => CODE_RE.test(x.file) && !matchAny(tests, x.file) && !matchAny(exempt, x.file));
  if (!src.length) return { pass: true, findings: [] };
  const now = ctx.now ? Date.parse(ctx.now) : Date.now();
  const ranked = src.map((x) => ({ file: x.file, ...scoreFile(h.files?.[x.from ?? x.file], { weights: c.weights, now, hasTest }) })).sort((a, b) => b.score - a.score || (a.file < b.file ? -1 : 1));
  const threshold = c.threshold ?? 60;
  if (ranked[0].score < threshold) return { pass: true, findings: [] };
  const why = (r) => `${r.file} scores ${r.score}/100: ${r.fixes} fix and ${r.reverts} revert commit${r.fixes + r.reverts === 1 ? "" : "s"} in ${r.changes} change${r.changes === 1 ? "" : "s"}` +
    `${r.parts.recent ? ", changed in the last 14 days" : ""}${r.parts.untested ? ", no test in this pull request" : ""} (fixes ${r.parts.fixes}, recent ${r.parts.recent}, churn ${r.parts.churn}, untested ${r.parts.untested})`;
  return { pass: false, findings: ranked.filter((r) => r.score >= threshold).slice(0, 5).map((r) => ({ file: r.file, line: 1, message: why(r) })) };
}
