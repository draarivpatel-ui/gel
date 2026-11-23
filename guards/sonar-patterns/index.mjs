// No node imports here: this file also runs in a browser. Two SonarCloud findings that keep coming back:
//   shell: `[ ... ]` instead of `[[ ... ]]` (bash:S7688) in files whose first line is a bash shebang. POSIX `#!/bin/sh`
//          files are skipped, `[[` is invalid there. Comments and heredoc bodies are skipped.
//   regex: backtracking-prone expressions (typescript:S5852) in non-test .ts files, of the shapes below.
//   sort:  `.sort()` / `.toSorted()` with no compare function (typescript:S2871), in .ts, .js, .mjs and .cjs files.
//   tests: an assertion reached through a wrapper object, `native.expect(...)` (typescript:S2699, "add at least one
//          assertion"): SonarCloud only counts a bare `expect(` call, so import `expect` from the test runner instead.
// Existing hits are frozen in docs/gel.json as "sonar_patterns": {"baseline": {"<file>": <count>}}: a file may only
// get cleaner, a file not listed must be clean. Lower the baseline after fixing files.
export const name = "sonar-patterns";

// A test command opened with a single bracket: at line start or after whitespace, `&&`, `||`, `;`, `(`, `{`, `!` or a quote.
const SINGLE_BRACKET = /(^|[\s;&|({!"'])\[ /;
const REGEX_SHAPES = [
  [/\\s\*\$\/[a-z]*[),.;]/, "trailing `\\s*$` (trim the input and drop it)"],
  [/\.replace\(\/[^/\n]*[+*]\$\/[a-z]*,/, "`.replace(/x+$/, ...)` (trim the end with a loop or a helper)"],
  [/\.replace\(\/\^[^/\n]*[+*]\/[a-z]*,/, "`.replace(/^x+/, ...)` (trim the start with a loop or a helper)"],
  [/\.replace\(\/\^[^/\n]*\+\|[^/\n]*\+\$\/[a-z]*,/, "`.replace(/^x+|x+$/g, ...)` (trim both ends with a helper)"],
  [/\.(?:split|replace)\(\/\\s[*+][^/\n]*\\s[*+]\//, "a regex padded with `\\s*` on both sides (split on the literal, then trim)"],
  [/\(\.\+\?\)\\s\*\$/, "lazy `(.+?)\\s*$`"],
];

const BARE_SORT = /\.(?:sort|toSorted)\(\s*\)/;
const WRAPPED_EXPECT = /(^|[^\w$.])[A-Za-z_$][\w$]*\s*\.expect\b|^\s*\.expect\(/;
const isTest = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) && !SKIP_DIR.test(f);

const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build)\//;
const isTs = (f) => /\.ts$/.test(f) && !/\.d\.ts$/.test(f) && !/\.(test|spec)\.ts$/.test(f) && !/(^|\/)__tests__\//.test(f) && !SKIP_DIR.test(f);
const isJs = (f) => /\.[cm]?js$/.test(f) && !/\.(test|spec)\.[cm]?js$/.test(f) && !/(^|\/)__tests__\//.test(f) && !SKIP_DIR.test(f);
const maybeShell = (f) => /\.(sh|bash)$/.test(f) || !/\.[^/]*$/.test(f.slice(f.lastIndexOf("/") + 1));

function shellHits(file, text) {
  const lines = text.split("\n");
  if (!/^#!.*\bbash\b/.test(lines[0])) return [];
  const out = [];
  let heredoc = null;
  lines.forEach((line, i) => {
    if (heredoc) { if (line.trim() === heredoc) heredoc = null; return; }
    const doc = /<<-?\s*['"]?(\w+)['"]?/.exec(line);
    if (doc) heredoc = doc[1];
    if (/^\s*#/.test(line)) return;
    if (SINGLE_BRACKET.test(line)) out.push({ file, line: i + 1, message: "single-bracket test, use [[ ]] (bash:S7688)" });
  });
  return out;
}

function regexHits(file, text) {
  const out = [];
  const ts = isTs(file);
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (BARE_SORT.test(line)) out.push({ file, line: i + 1, message: "sort without a compare function, pass one (typescript:S2871)" });
    if (ts) for (const [re, why] of REGEX_SHAPES) if (re.test(line)) out.push({ file, line: i + 1, message: `${why} (typescript:S5852)` });
  });
  return out;
}

function testHits(file, text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (WRAPPED_EXPECT.test(line)) out.push({ file, line: i + 1, message: "assertion through a wrapper (`obj.expect(...)`), import `expect` from the test runner (typescript:S2699)" });
  });
  return out;
}

// Every hit in one file, ignoring the baseline. The fixer uses this; run() applies the baseline.
export function hitsFor(file, text) {
  const check = isTest(file) ? testHits : isTs(file) || isJs(file) ? regexHits : maybeShell(file) && !SKIP_DIR.test(file) ? shellHits : null;
  return check ? check(file, text) : [];
}

export function run({ files, cfg, read }) {
  const baseline = cfg?.sonar_patterns?.baseline ?? {};
  const findings = [];
  for (const f of files) {
    const text = read(f);
    if (text == null) continue;
    const hits = hitsFor(f, text);
    const allowed = Number(baseline[f] ?? 0);
    if (hits.length > allowed) findings.push(...hits);
  }
  return { pass: findings.length === 0, findings };
}
