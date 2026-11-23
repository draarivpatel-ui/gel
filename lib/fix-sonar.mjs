// The flywheel's second fixer: rewrite what the sonar-patterns guard reports, mechanically.
//   `[ a = b ]`  ->  `[[ a = b ]]`            (bash:S7688, only when the two forms mean the same)
//   `.sort()`    ->  `.sort((a, b) => ...)`    (typescript:S2871, default order kept for strings)
// It edits only the lines the guard names, skips what it cannot prove safe, and the guards decide whether the result is better.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hitsFor } from "../guards/sonar-patterns/index.mjs";

const COMPARE = "(a, b) => (a < b ? -1 : a > b ? 1 : 0)";
const OPEN = /(^|[\s;&|({!"'])\[ /;

// Wrap the first `[ ... ]` of a bash line in `[[ ... ]]`, or return null when the tests could differ.
export function bracketLine(line) {
  const m = OPEN.exec(line);
  if (!m) return null;
  const start = m.index + m[1].length; // index of "["
  const rest = line.slice(start + 2);
  const close = /\s\](?=$|[\s;&|)}])/.exec(rest);
  if (!close) return null;
  const inner = rest.slice(0, close.index);
  const bare = inner.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  // `-a` / `-o` / `\( \)` / `<` `>` have another meaning inside [ ]; an unquoted glob or `[` turns a literal into a pattern in [[ ]]
  if (/(^|\s)(-a|-o|\\\(|\\\)|\\<|\\>|<|>|\(|\))(\s|$)/.test(bare) || /[*?[\]]/.test(bare) || /\[|\]/.test(inner.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ""))) return null;
  const tail = rest.slice(close.index + close[0].length);
  if (/(^|[\s;&|({!"'])\[ /.test(tail) || /^\s*\]/.test(tail)) return null; // one test per line, otherwise leave it to a person
  return `${line.slice(0, start)}[[ ${inner} ]]${tail}`;
}

export function sortLine(line) {
  return line.replace(/\.(sort|toSorted)\(\s*\)/, `.$1(${COMPARE})`);
}

// findings: the guard's findings ignoring the baseline ({ file, line, message }). Returns what changed and what was left.
export function fixSonar(root, findings) {
  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const files = [], unresolved = [];
  let fixed = 0;
  for (const [file, list] of byFile) {
    const path = join(root, file);
    const text = readFileSync(path, "utf8").split("\n");
    let changed = false;
    for (const f of list) {
      const line = text[f.line - 1];
      const next = f.message.includes("S7688") ? bracketLine(line) : f.message.includes("S2871") ? sortLine(line) : null;
      if (next == null || next === line) { unresolved.push({ file, line: f.line, why: f.message }); continue; }
      text[f.line - 1] = next; changed = true; fixed++;
    }
    if (changed) { writeFileSync(path, text.join("\n")); files.push(file); }
  }
  return { files, fixed, unresolved };
}

// All hits of the given files, ignoring the baseline, read from disk.
export function collectHits(root, files) {
  const out = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(root, f), "utf8"); } catch { continue; }
    out.push(...hitsFor(f, text));
  }
  return out;
}
