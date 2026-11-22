// No node imports here: this file also runs in a browser. An ICE table (Impact, Confidence, Ease, each 1 to 10) decides what
// gets built first, so its arithmetic and its order have to be right. The guard reads every Markdown table that has the
// columns I (or Impact), C (or Confidence), E (or Ease) and ICE, in any .md file, and reports:
//   - a score that is not a whole number from 1 to 10
//   - an ICE that does not follow the table's formula. Two are in use: impact x confidence x ease (the product) and
//     (impact + confidence + ease) / 3 (the average). A table follows whichever most of its rows follow (the product on
//     a tie); a row that follows neither is reported, so is a table that mixes the two
//   - a row in a later phase (P1, P2, Later) that outscores a row in an earlier one (P0): the order contradicts the scores
//   - a confidence of 7 or more with no evidence: no link in the row and nothing in an Evidence / Source / Proof column
// Tables inside a code fence, rows with no numbers yet (a blank template, "/10", "[1-10]") and struck-through rows are skipped.
//   "ice": { "evidence_from": 7 }      // optional in docs/gel.json: the confidence that needs evidence (11 switches it off)
export const name = "ice-score";

const clean = (s) => s.replace(/[*_`~]/g, "").trim();
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
const isRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isRule = (line) => isRow(line) && cells(line).every((c) => /^:?-{1,}:?$/.test(c));
const LINK = /https?:\/\/\S+|\]\([^)\s]+\)/;

function columns(header) {
  const h = header.map((c) => clean(c).toLowerCase());
  const find = (re, from = 0) => h.findIndex((c, n) => n >= from && re.test(c));
  const i = find(/^(i|impact)$/), c = find(/^(c|confidence)$/), e = find(/^(e|ease)$/);
  const ice = find(/^ice(\s+score)?$/);
  if (i < 0 || c < 0 || e < 0 || ice < 0) return null;
  return { i, c, e, ice, phase: find(/^(phase|priority|prio|p)$/), evidence: find(/^(evidence|source|sources|proof)$/, 1) }; // the first column names the item, even when it is headed "Source"
}

// P0 -> 0, P1 -> 1, now -> 0, next -> 1, later -> 99. Anything else (done, shipped, empty) is not ranked.
function phaseRank(text) {
  const t = clean(text ?? "").toLowerCase();
  const p = /^p(\d)$/.exec(t);
  if (p) return Number(p[1]);
  if (t === "now") return 0;
  if (t === "next") return 1;
  if (t === "later" || t === "someday" || t === "backlog") return 99;
  return null;
}

const score = (text) => { const t = clean(text ?? ""); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t === "" ? null : NaN; };
const valid = (n) => Number.isInteger(n) && n >= 1 && n <= 10;

// every ICE table in a Markdown text: [{ line, rows: [{ line, label, i, c, e, ice, rank, phase, evidence }] }]
export function iceTables(text) {
  const lines = text.split("\n");
  const tables = [];
  let fence = false;
  for (let n = 0; n < lines.length; n++) {
    if (/^\s*(```|~~~)/.test(lines[n])) { fence = !fence; continue; }
    if (fence || !isRow(lines[n]) || !lines[n + 1] || !isRule(lines[n + 1])) continue;
    const col = columns(cells(lines[n]));
    if (!col) continue;
    const rows = [];
    let m = n + 2;
    for (; m < lines.length && isRow(lines[m]); m++) {
      const c = cells(lines[m]);
      if (/~~.+~~/.test(c[0] ?? "")) continue; // struck through: dropped or done
      const row = { line: m + 1, label: clean(c[0] ?? "").slice(0, 60), i: score(c[col.i]), c: score(c[col.c]), e: score(c[col.e]), ice: score(c[col.ice]) };
      if (![row.i, row.c, row.e, row.ice].some((v) => Number.isFinite(v))) continue; // a blank template row: empty, "/10", "[1-10]", "[Score]"
      row.phase = col.phase >= 0 ? clean(c[col.phase] ?? "") : "";
      row.rank = col.phase >= 0 ? phaseRank(c[col.phase]) : null;
      row.evidence = (col.evidence >= 0 && clean(c[col.evidence] ?? "") !== "") || LINK.test(lines[m]);
      row.linked = LINK.test(lines[m]);
      rows.push(row);
    }
    tables.push({ line: n + 1, rows });
    n = m - 1;
  }
  return tables;
}

// Five grades, lowest first. A pass is "passed" or above. The repo's ICE tables, all together, grade like this:
//   bad         a finding (wrong arithmetic, a bad score, order against the scores, high confidence with no evidence)
//   passed      no finding
//   good        at least half the rows have evidence, and every table has a phase column (the order is written down)
//   high        at least 80% of rows have evidence, phases, and at least 5 scored rows
//   super high  every row has a link that shows its evidence (one anyone can open), phases, and at least 5 scored rows
// A repo with no scored ICE row gets no grade (null).
export const GRADES = ["bad", "passed", "good", "high", "super high"];
export function grade({ cfg, files, read }) {
  const rows = [];
  let phased = true;
  for (const file of (files ?? []).filter((f) => /\.mdx?$/i.test(f))) {
    const text = read?.(file);
    if (text == null || !/\bICE\b/i.test(text)) continue;
    for (const t of iceTables(text)) {
      if (!t.rows.length) continue;
      if (t.rows.every((r) => r.phase === "")) phased = false;
      rows.push(...t.rows);
    }
  }
  const counts = { rows: rows.length, evidence: rows.filter((r) => r.evidence).length, linked: rows.filter((r) => r.linked).length, phased };
  if (!rows.length) return { grade: null, ...counts, why: "no scored ICE row" };
  if (!run({ cfg, files, read }).pass) return { grade: "bad", ...counts };
  const share = counts.evidence / rows.length;
  const g = phased && rows.length >= 5 && counts.linked === rows.length ? "super high"
    : phased && rows.length >= 5 && share >= 0.8 ? "high"
    : phased && share >= 0.5 ? "good" : "passed";
  return { grade: g, ...counts };
}

export function run({ cfg, files, read }) {
  if (cfg?.status === "archived") return { pass: true, findings: [] };
  const from = typeof cfg?.ice?.evidence_from === "number" ? cfg.ice.evidence_from : 7;
  const findings = [];
  for (const file of (files ?? []).filter((f) => /\.mdx?$/i.test(f))) {
    const text = read?.(file);
    if (text == null || !/\bICE\b/i.test(text)) continue;
    for (const table of iceTables(text)) {
      const at = (row, message) => findings.push({ file, line: row.line, message: `ICE "${row.label}": ${message}` });
      const scored = [];
      for (const row of table.rows) {
        const legs = [["impact", row.i], ["confidence", row.c], ["ease", row.e]];
        const badLeg = legs.filter(([, v]) => !valid(v));
        for (const [leg, v] of badLeg) at(row, `${leg} is ${v === null ? "empty" : Number.isNaN(v) ? "not a number" : v}: score it with a whole number from 1 to 10`);
        if (badLeg.length) continue;
        if (row.c >= from && !row.evidence) at(row, `confidence ${row.c} with no evidence: link the number, test or user quote that earns it, or score it under ${from}`);
        scored.push({ ...row, product: row.i * row.c * row.e, avg: (row.i + row.c + row.e) / 3 });
      }
      const isProduct = (r) => r.ice === r.product, isAvg = (r) => Number.isFinite(r.ice) && Math.abs(r.ice - r.avg) < 0.06;
      const useAvg = scored.filter(isAvg).length > scored.filter(isProduct).length;
      for (const r of scored) {
        const want = useAvg ? `(${r.i} + ${r.c} + ${r.e}) / 3 = ${(Math.round(r.avg * 10) / 10).toFixed(1)}` : `${r.i} x ${r.c} x ${r.e} = ${r.product}`;
        if (r.ice === null) at(r, `no ICE score: ${want}`);
        else if (!(useAvg ? isAvg(r) : isProduct(r))) at(r, `the table says ${Number.isNaN(r.ice) ? "something that is not a number" : r.ice}, but this table uses the ${useAvg ? "average" : "product"}: ${want}${(useAvg ? isProduct(r) : isAvg(r)) ? ` (this row uses the ${useAvg ? "product" : "average"}: pick one formula for the whole table)` : ""}`);
        r.score = useAvg ? r.avg : r.product;
      }
      // order: no row in a later phase may outscore a row in an earlier phase
      const ranked = scored.filter((r) => r.rank !== null);
      for (const row of ranked) {
        const earlier = ranked.filter((r) => r.rank < row.rank && r.score < row.score - 1e-9).sort((a, b) => a.score - b.score)[0];
        const show = (r) => (useAvg ? (Math.round(r.score * 10) / 10).toFixed(1) : r.score);
        if (earlier) at(row, `scores ${show(row)} in ${row.phase} but "${earlier.label}" scores ${show(earlier)} in ${earlier.phase}: build the higher score first, or fix the scores`);
      }
    }
  }
  return { pass: findings.length === 0, findings };
}
