// No node imports here: this file also runs in a browser. A repo that opts in names ONE north star metric in docs/gel.json and
// the guard FAILS when the measured result does not meet the target. A claim is not enough:
//   "north_star": {
//     "metric": "first start to healthy on a 10-part shop",
//     "baseline": "Docker Compose 5.1.3",
//     "target": { "ratio": 8, "better": "lower" },      // baseline / value must be >= 8 (use "higher" for value / baseline)
//     "result": "bench/north-star.json",                // {"value": 3.1, "baseline": 26.1, "unit": "s", "measuredAt": "...", "run": "https://..."}
//     "evidence": "bench/README.md",                    // how it is measured: a repo file or an https link
//     "measure": "node bench/north-star.mjs",           // optional: `gel north-star --measure` runs it and writes `result`
//     "max_age_days": 30                                // optional, default 30: an old number does not count
//   }
// An archived repo needs none. Missing result, stale result, or ratio under target = finding (a failure in block mode).
// An optional second star, "north_star_candidate", names the org metric that is not measurable yet. It never replaces
// "north_star": it sits next to it until a person promotes it in a pull request. A candidate may say it is not measured
// (never estimate), but it must carry an owner and a review_by date: once that date passes, the guard raises a finding
// so someone decides to promote, extend or drop it.
//   "north_star_candidate": {
//     "metric": "weekly active projects with a healthy Flisk-managed stack",
//     "state": "not-measured",                          // or "measured" (then "result" is required)
//     "declared": "2026-11-22", "review_by": "2027-02-20", "owner": "github-login",
//     "promote_when": ["4 weeks of real telemetry, not a proxy", "four-week retention is computable"],
//     "result": "bench/candidate.json"                   // only when measured: {"value", "measuredAt", "proxy": true|false}
//   }
export const name = "north-star";

const words = (s) => (String(s).match(/\S+/g) ?? []).length;
const num = (x) => typeof x === "number" && Number.isFinite(x) && x > 0;

// ratio > 1 means "better than the baseline". lower: baseline / value (time, memory). higher: value / baseline (throughput).
export function ratioOf(result, better) {
  return better === "higher" ? result.value / result.baseline : result.baseline / result.value;
}

const isDate = (x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) && !Number.isNaN(Date.parse(x));

// Checks the optional second star. Every problem is a finding: a half-written candidate is a config bug, and a candidate
// nobody reviewed by its review_by date is a decision that was never made. "not-measured" on its own is fine.
export function checkCandidate(c, { files, read, now, at }) {
  if (c == null) return;
  const p = "north_star_candidate";
  if (typeof c !== "object" || Array.isArray(c)) return at(`${p} must be an object: {"metric","state","declared","review_by","owner","promote_when"}`);
  if (typeof c.metric !== "string" || words(c.metric) < 3) at(`${p}.metric must say what is measured, in at least three words`);
  if (c.state !== "not-measured" && c.state !== "measured") at(`${p}.state must be "not-measured" or "measured"`);
  if (typeof c.owner !== "string" || !c.owner.trim()) at(`${p}.owner must name who decides to promote, extend or drop it`);
  if (!Array.isArray(c.promote_when) || c.promote_when.length === 0 || c.promote_when.some((x) => typeof x !== "string" || !x.trim())) at(`${p}.promote_when must list, in words, what has to be true before this becomes the north star`);
  if (!isDate(c.declared)) at(`${p}.declared must be a date (YYYY-MM-DD)`);
  if (!isDate(c.review_by)) at(`${p}.review_by must be a date (YYYY-MM-DD): a candidate without a deadline stays a candidate forever`);
  else {
    if (isDate(c.declared) && Date.parse(c.review_by) <= Date.parse(c.declared)) at(`${p}.review_by must be after declared`);
    if (now > Date.parse(c.review_by) + 86400000) at(`${p} was due for review on ${c.review_by.slice(0, 10)}: promote it, move review_by, or remove it`);
  }
  if (c.state !== "measured") return;
  if (typeof c.result !== "string" || !c.result.trim()) return at(`${p}.state is "measured", so ${p}.result must name the file with the measurement`);
  const raw = (files ?? []).includes(c.result) ? read?.(c.result) : null;
  if (raw == null) return at(`${p}.result "${c.result}" is not in the repo`);
  let r;
  try { r = JSON.parse(raw); } catch { return at(`${c.result} is not valid JSON`); }
  if (!num(r?.value)) at(`${c.result} needs a positive number "value"`);
  if (typeof r?.proxy !== "boolean") at(`${c.result} must say "proxy": true or false: a stand-in number may not pass as the real one`);
  if (!isDate(r?.measuredAt)) at(`${c.result} has no "measuredAt" date`);
}

export function run({ cfg, files, read, ctx }) {
  if (cfg?.status === "archived") return { pass: true, findings: [] };
  // docs/gel.json is optional: a repo that has none has named no north star, so there is nothing to hold it to.
  if (cfg?.noConfigFile) return { pass: true, findings: [] };
  const findings = [];
  const at = (message) => findings.push({ file: "docs/gel.json", line: 0, message });
  checkCandidate(cfg?.north_star_candidate, { files, read, now: ctx?.now ? Date.parse(ctx.now) : Date.now(), at });
  const ns = cfg?.north_star;
  if (ns == null || typeof ns !== "object") {
    at(`docs/gel.json has no "north_star" (a measured metric: {"metric","baseline","target":{"ratio":8,"better":"lower"},"result":"bench/north-star.json","evidence"})`);
    return { pass: false, findings };
  }
  if (typeof ns.metric !== "string" || words(ns.metric) < 3) at(`north_star.metric must say what is measured, in at least three words`);
  if (typeof ns.baseline !== "string" || words(ns.baseline) < 1) at(`north_star.baseline must say what the target is compared with`);
  const t = ns.target;
  const better = t?.better;
  if (!t || typeof t !== "object" || !(t.ratio > 1) || (better !== "lower" && better !== "higher")) at(`north_star.target must be {"ratio": <number above 1>, "better": "lower" or "higher"}`);
  const ev = ns.evidence;
  if (typeof ev !== "string" || !ev.trim()) at(`north_star.evidence must be a file in this repo or an https link that shows how it is measured`);
  else if (!/^https:\/\/\S+$/.test(ev.trim()) && !(files ?? []).includes(ev.trim().replace(/^\.\//, "").replace(/#.*$/, ""))) at(`north_star.evidence "${ev}" is not a file in this repo and not an https link`);
  if (typeof ns.result !== "string" || !ns.result.trim()) { at(`north_star.result must name the file the measurement is written to (JSON with value and baseline)`); return { pass: false, findings }; }
  const raw = (files ?? []).includes(ns.result) ? read?.(ns.result) : null;
  if (raw == null) { at(`north_star.result "${ns.result}" is not in the repo: run \`gel north-star --measure\` and commit it (or publish it from the bench workflow)`); return { pass: false, findings }; }
  let r;
  try { r = JSON.parse(raw); } catch { at(`${ns.result} is not valid JSON`); return { pass: false, findings }; }
  if (!num(r?.value) || !num(r?.baseline)) { at(`${ns.result} needs a positive number "value" (this repo) and "baseline" (what it is compared with)`); return { pass: false, findings }; }
  const now = ctx?.now ? Date.parse(ctx.now) : Date.now();
  const at0 = Date.parse(r.measuredAt);
  const maxAge = (ns.max_age_days ?? 30) * 86400000;
  if (Number.isNaN(at0)) at(`${ns.result} has no "measuredAt" date`);
  else if (now - at0 > maxAge) at(`the north star was measured ${Math.floor((now - at0) / 86400000)} days ago (limit ${ns.max_age_days ?? 30}): measure it again`);
  if (t && t.ratio > 1 && (better === "lower" || better === "higher")) {
    const got = ratioOf(r, better);
    if (got < t.ratio) at(`north star NOT MET: ${ns.metric} is ${got.toFixed(2)}x ${better === "lower" ? "faster/lower" : "higher"} than ${ns.baseline} (value ${r.value}${r.unit ? " " + r.unit : ""} vs ${r.baseline}), target ${t.ratio}x`);
  }
  return { pass: findings.length === 0, findings };
}
