// No node imports here: this file also runs in a browser. A click map shows what visitors really press on a page. Two
// things in it are a product problem that no test of the source can see: people keep clicking something that does
// nothing (a dead click: text that looks like a button, a picture that looks like a link), and the button the page
// exists for is not what they press. The guard reads a MEASUREMENT, written by
// `gel click-map --url <site>/api/clicks?page=home&dev=mobile&days=30 --merge --write docs/click-map.json`:
//   "click_map": {
//     "result": "docs/click-map.json",    // optional, default docs/click-map.json:
//                                         //   {"measuredAt": "...", "entries": [{"page","dev","days","clicks","dead","targets":[{"target","kind","n"}]}]}
//     "max_age_days": 30,                 // optional, default 30: old clicks describe an old page
//     "min_clicks": 20,                   // optional, default 20: a page with fewer clicks is not judged
//     "max_dead_share": 0.3,              // optional, default 0.3: at most this share of clicks may hit nothing
//     "main": { "home": "Make my plan" }, // optional: the button each page exists for (or one name for every page)
//     "min_main_share": 0.1               // optional, default 0.1: at least this share of clicks goes to it
//   }
// It applies only when docs/gel.json has "click_map". Missing or stale measurement, too many dead clicks, or a main
// button that gets too few clicks = finding. A page with few clicks is NOT a finding: no visitors yet is an honest number.
export const name = "click-map";

const DEFAULT_RESULT = "docs/click-map.json";
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const obj = (x) => x != null && typeof x === "object" && !Array.isArray(x);
const pct = (share) => `${Math.round(share * 100)}%`;
const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

export function limits(cfg) {
  const c = obj(cfg?.click_map) ? cfg.click_map : {};
  return {
    resultFile: typeof c.result === "string" && c.result.trim() ? c.result.trim() : DEFAULT_RESULT,
    maxDays: fin(c.max_age_days) && c.max_age_days > 0 ? c.max_age_days : 30,
    minClicks: fin(c.min_clicks) && c.min_clicks > 0 ? c.min_clicks : 20,
    maxDead: fin(c.max_dead_share) && c.max_dead_share >= 0 ? c.max_dead_share : 0.3,
    minMain: fin(c.min_main_share) && c.min_main_share >= 0 ? c.min_main_share : 0.1,
    main: (page) => (typeof c.main === "string" ? c.main : obj(c.main) && typeof c.main[page] === "string" ? c.main[page] : null),
  };
}

// One page on one kind of device: its numbers and what is wrong with them. `gel click-map` prints these too.
export function judge(entry, lim) {
  const label = `${entry?.page ?? "page"} on ${entry?.dev ?? "?"}`;
  const problems = [];
  if (!obj(entry) || !fin(entry.clicks) || !fin(entry.dead) || entry.clicks < 0 || entry.dead < 0 || entry.dead > entry.clicks) {
    return { label, judged: false, deadShare: null, mainShare: null, problems: [`${label}: needs "clicks" and "dead" as numbers, with dead no larger than clicks`] };
  }
  const targets = (Array.isArray(entry.targets) ? entry.targets : []).filter((t) => obj(t) && fin(t.n));
  const deadShare = entry.clicks > 0 ? entry.dead / entry.clicks : 0;
  const main = lim.main(entry.page);
  const mainClicks = main == null ? null : targets.filter((t) => t.kind !== "dead" && same(t.target, main)).reduce((s, t) => s + t.n, 0);
  const mainShare = main == null || entry.clicks === 0 ? null : mainClicks / entry.clicks;
  if (entry.clicks < lim.minClicks) return { label, judged: false, deadShare, mainShare, problems };
  if (deadShare > lim.maxDead) {
    const top = targets.filter((t) => t.kind === "dead").sort((a, b) => b.n - a.n)[0];
    problems.push(`${label}: ${entry.dead} of ${entry.clicks} clicks (${pct(deadShare)}) hit something that does nothing (limit ${pct(lim.maxDead)})${top ? `, most of them on "${top.target}" (${top.n})` : ""}: make it a link or a button, or make it look less like one`);
  }
  if (mainShare != null && mainShare < lim.minMain) problems.push(`${label}: "${main}" got ${mainClicks} of ${entry.clicks} clicks (${pct(mainShare)}, at least ${pct(lim.minMain)} expected): the button this page exists for is not what people press`);
  return { label, judged: true, deadShare, mainShare, problems };
}

// Five grades, lowest first. A pass is "passed" or above; "bad" is a fail. One page grades like this:
//   bad         a finding: too many dead clicks, or too few on the main button
//   passed      no finding
//   good        at most 15% dead clicks, and the main button (when named) gets at least 25%
//   high        at most 10% dead, the main button named and at least 40%
//   super high  at most 5% dead, the main button at least 50%, and at least 200 clicks
// The repo gets its LOWEST judged page, and high or super high only when both phones and computers were measured:
// a page nobody tapped on a phone has not earned it. A page with too few clicks gets no grade (null), not a fail.
export const GRADES = ["bad", "passed", "good", "high", "super high"];
export function gradeEntry(entry, lim) {
  const v = judge(entry, lim);
  if (!v.judged) return null;
  if (v.problems.length) return "bad";
  const d = v.deadShare, m = v.mainShare;
  if (d <= 0.05 && m != null && m >= 0.5 && entry.clicks >= 200) return "super high";
  if (d <= 0.1 && m != null && m >= 0.4) return "high";
  if (d <= 0.15 && (m == null || m >= 0.25)) return "good";
  return "passed";
}
export function grade(entries, lim) {
  const pages = (entries ?? []).map((e) => ({ page: e?.page, dev: e?.dev, clicks: e?.clicks, grade: gradeEntry(e, lim) }));
  const judged = pages.filter((p) => p.grade != null);
  if (judged.length === 0) return { grade: null, pages, why: `no page has ${lim.minClicks} clicks yet` };
  let rank = Math.min(...judged.map((p) => GRADES.indexOf(p.grade)));
  const devs = new Set(judged.map((p) => p.dev));
  let why = null;
  if (rank >= 3 && !(devs.has("mobile") && devs.has("desktop"))) { rank = 2; why = "high needs judged pages on both mobile and desktop"; }
  return { grade: GRADES[rank], pages, why };
}

export function run({ cfg, files, read, ctx }) {
  if (cfg?.status === "archived" || cfg?.click_map == null) return { pass: true, findings: [] };
  const findings = [];
  const lim = limits(cfg);
  const at = (file, message) => findings.push({ file, line: 0, message: `click map: ${message}` });
  if (!obj(cfg.click_map)) { at("docs/gel.json", `"click_map" must be an object ({"result": "${DEFAULT_RESULT}"})`); return { pass: false, findings }; }
  const raw = (files ?? []).includes(lim.resultFile) ? read?.(lim.resultFile) : null;
  if (raw == null) {
    at("docs/gel.json", `"${lim.resultFile}" is missing: run \`gel click-map --url <site>/api/clicks?page=home&dev=mobile&days=30 --merge --write ${lim.resultFile}\` and commit it`);
    return { pass: false, findings };
  }
  let r;
  try { r = JSON.parse(raw); } catch { at(lim.resultFile, "the file is not valid JSON"); return { pass: false, findings }; }
  const entries = Array.isArray(r?.entries) ? r.entries : [];
  if (entries.length === 0) { at(lim.resultFile, `the file has no "entries"`); return { pass: false, findings }; }
  const now = ctx?.now ? Date.parse(ctx.now) : Date.now();
  const when = Date.parse(r.measuredAt);
  if (Number.isNaN(when)) at(lim.resultFile, `the file has no "measuredAt" date`);
  else if (now - when > lim.maxDays * 86400000) at(lim.resultFile, `measured ${Math.floor((now - when) / 86400000)} days ago (limit ${lim.maxDays}): measure again`);
  for (const e of entries) for (const p of judge(e, lim).problems) at(lim.resultFile, p);
  return { pass: findings.length === 0, findings };
}
