// No node imports here: this file also runs in a browser. A product answers six plain questions (the Zachman six:
// what, who, why, how, where, when), and each answer is backed by a NUMBER that was measured, not by a sentence alone:
//   "brief": {
//     "result": "docs/brief.json",        // optional, default docs/brief.json: where the six numbers are
//     "max_age_days": 30,                 // optional, default 30: an old number does not count
//     "what":  { "answer": "starts a ten-part app with one command", "metric": "seconds from first start to healthy", "target": 30, "better": "lower" },
//     "who":   { "answer": "teams of five to ten developers", "metric": "teams that pay each month", "target": 10 },
//     "why":   { ... }, "how": { ... }, "where": { ... }, "when": { ... }
//   }
// and the result file holds one measured number per question, each with its date and where it came from:
//   { "what": { "value": 12.4, "unit": "s", "measuredAt": "2026-11-20", "source": "bench/README.md" }, "who": { "value": 0, ... }, ... }
// It applies to a repo whose docs/gel.json has "brief" or a "north_star" (a repo that names a headline number is a product).
// Missing answer, answer with no target, no number, number with no source, or a stale number = finding. A target that is
// not met yet is NOT a finding: zero paying teams is an honest number. `gel brief` prints which targets are met.
export const name = "product-brief";

export const QUESTIONS = ["what", "who", "why", "how", "where", "when"];
const ASKS = {
  what: "what the product is",
  who: "who uses it or pays for it",
  why: "why they need it",
  how: "how it does the job",
  where: "where people find it or run it",
  when: "when they reach for it, or the date the goal is due",
};
const DEFAULT_RESULT = "docs/brief.json";

const words = (s) => (String(s).match(/\S+/g) ?? []).length;
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const obj = (x) => x != null && typeof x === "object" && !Array.isArray(x);

export const applies = (cfg) => !cfg?.noConfigFile && cfg?.status !== "archived" && (cfg?.brief != null || obj(cfg?.north_star));

// true when the number meets the target. "higher" (the default): value >= target. "lower": value <= target.
export const met = (value, target, better) => (better === "lower" ? value <= target : value >= target);

// One row per question: what was declared, what was measured, and what is wrong with it. `gel brief` prints these.
export function briefRows({ cfg, files, read, ctx }) {
  const b = obj(cfg?.brief) ? cfg.brief : {};
  const resultFile = typeof b.result === "string" && b.result.trim() ? b.result.trim() : DEFAULT_RESULT;
  const maxDays = fin(b.max_age_days) && b.max_age_days > 0 ? b.max_age_days : 30;
  const now = ctx?.now ? Date.parse(ctx.now) : Date.now();
  const raw = (files ?? []).includes(resultFile) ? read?.(resultFile) : null;
  let result = null, resultProblem = null;
  if (raw == null) resultProblem = `"${resultFile}" is not in the repo: write the six measured numbers there ({"what": {"value": 12.4, "measuredAt": "2026-11-20", "source": "bench/README.md"}, ...})`;
  else { try { result = JSON.parse(raw); } catch { resultProblem = `${resultFile} is not valid JSON`; } }
  if (result != null && !obj(result)) { result = null; resultProblem = `${resultFile} must be an object with one entry per question`; }

  const rows = QUESTIONS.map((q) => {
    const d = b[q], declared = [], measured = [];
    if (!obj(d)) declared.push(`brief.${q} is missing: say ${ASKS[q]} ({"answer", "metric", "target"})`);
    else {
      if (typeof d.answer !== "string" || words(d.answer) < 3) declared.push(`brief.${q}.answer must say ${ASKS[q]}, in at least three words`);
      if (typeof d.metric !== "string" || words(d.metric) < 2) declared.push(`brief.${q}.metric must name the number that backs the answer, in at least two words`);
      if (!fin(d.target)) declared.push(`brief.${q}.target must be a number: what the metric has to reach`);
      if (d.better != null && d.better !== "lower" && d.better !== "higher") declared.push(`brief.${q}.better must be "higher" (the default) or "lower"`);
    }
    const r = obj(result) ? result[q] : null;
    let age = null;
    if (result != null) {
      if (!obj(r) || !fin(r.value)) measured.push(`${q}: no measured number ("value") for ${obj(d) && typeof d.metric === "string" ? `"${d.metric}"` : "this answer"}`);
      else {
        const when = Date.parse(r.measuredAt);
        if (Number.isNaN(when)) measured.push(`${q}: the number has no "measuredAt" date`);
        else { age = Math.floor((now - when) / 86400000); if (now - when > maxDays * 86400000) measured.push(`${q}: measured ${age} days ago (limit ${maxDays}): measure it again`); }
        const src = typeof r.source === "string" ? r.source.trim() : "";
        if (!src) measured.push(`${q}: the number has no "source" (a file in this repo or an https link that shows where it came from)`);
        else if (!/^https:\/\/\S+$/.test(src) && !(files ?? []).includes(src.replace(/^\.\//, "").replace(/#.*$/, ""))) measured.push(`${q}: source "${src}" is not a file in this repo and not an https link`);
      }
    }
    const value = obj(r) && fin(r.value) ? r.value : null;
    return {
      question: q,
      answer: obj(d) && typeof d.answer === "string" ? d.answer : null,
      metric: obj(d) && typeof d.metric === "string" ? d.metric : null,
      target: obj(d) && fin(d.target) ? d.target : null,
      better: obj(d) && d.better === "lower" ? "lower" : "higher",
      value, unit: obj(r) && typeof r.unit === "string" ? r.unit : null, ageDays: age,
      met: value != null && obj(d) && fin(d.target) ? met(value, d.target, d.better) : null,
      declared, measured,
    };
  });
  // the same sentence pasted under two questions answers only one of them
  const seen = new Map();
  for (const row of rows) {
    if (!row.answer) continue;
    const key = row.answer.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) row.declared.push(`brief.${row.question}.answer repeats brief.${seen.get(key)}.answer: each question needs its own answer`);
    else seen.set(key, row.question);
  }
  return { rows, resultFile, resultProblem };
}

export function run({ cfg, files, read, ctx }) {
  if (!applies(cfg)) return { pass: true, findings: [] };
  const findings = [];
  if (!obj(cfg.brief)) {
    findings.push({ file: "docs/gel.json", line: 0, message: `docs/gel.json has no "brief": answer what, who, why, how, where and when, each with a metric and a target ({"what": {"answer", "metric", "target"}, ...}), and put the six measured numbers in ${DEFAULT_RESULT}` });
    return { pass: false, findings };
  }
  const { rows, resultFile, resultProblem } = briefRows({ cfg, files, read, ctx });
  for (const row of rows) for (const m of row.declared) findings.push({ file: "docs/gel.json", line: 0, message: m });
  if (resultProblem) findings.push({ file: "docs/gel.json", line: 0, message: `brief: ${resultProblem}` });
  for (const row of rows) for (const m of row.measured) findings.push({ file: resultFile, line: 0, message: `brief ${m}` });
  return { pass: findings.length === 0, findings };
}
