// No node imports here: this file also runs in a browser. `read(file)` returns the file text or null.
//
// Mirrors SonarCloud S5145 (log injection). A value an attacker can shape, written to a log with its CR and LF
// intact, lets them forge extra log lines, and in a workflow `::error::` / `::warning::` lines forge annotations
// and workflow commands. This is a line-level heuristic, not data-flow analysis, so run it in report mode
// (a warning) unless the repo has settled its false positives. Flags a line that:
//   - in a .ts/.js/.mjs/.cjs file (not tests) calls console.*, log(), logger.*, core.info/warning/error/notice or
//     a `log`/`warn`/`error` helper with `error.message`, `err.message`, `e.message`, `req.body`, `req.query`,
//     `req.params`, `req.headers`, `request.url`, `searchParams`, `process.argv` or `github.event`
//   - in a workflow or shell script prints `::error::`, `::warning::` or `::notice::` with a `${{ github.event.* }}`,
//     `${{ github.head_ref }}`, `${{ inputs.* }}`, `${{ steps.*.outputs.* }}` expression or a `$MESSAGE`, `$ERROR`,
//     `$OUTPUT`, `$RESPONSE`, `$BODY`, `$TITLE` style variable
// A line is clean when it also strips line breaks: `.replace(/[\r\n]/g, ...)`, `sanitize`, `JSON.stringify(`,
// `encodeURIComponent(`, `tr -d '\r\n'` or a `${var//[$'\r\n']/}` expansion.
// Existing hits are frozen in docs/gel.json as "log_injection": {"baseline": {"<file>": <count>}}.
export const name = "log-injection";

const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build)\//;
const isCode = (f) => /\.[cm]?[jt]s$/.test(f) && !/\.d\.ts$/.test(f) && !/\.(test|spec)\.[cm]?[jt]s$/.test(f) && !/(^|\/)__tests__\//.test(f) && !SKIP_DIR.test(f);
const isWorkflow = (f) => /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/.test(f);
const isShell = (f) => /\.(sh|bash)$/.test(f) && !SKIP_DIR.test(f);

const LOG_CALL = /\b(?:console\.(?:log|info|warn|error|debug)|logger\.\w+|log|warn|error|core\.(?:info|warning|error|notice|setFailed))\s*\(/;
const UNTRUSTED_JS = /\b(?:err|error|e|ex|exception|reason)\.message\b|\b(?:req|request)\.(?:body|query|params|headers|url)\b|\bsearchParams\b|\bprocess\.argv\b|\bgithub\.event\b/;
const ANNOTATION = /::(?:error|warning|notice)(?:\s[^:]*)?::/;
const UNTRUSTED_SH = /\$\{\{\s*(?:github\.event\.|github\.head_ref|inputs\.|steps\.[\w-]+\.outputs\.)[^}]*\}\}|\$\{?(?:MESSAGE|MSG|ERROR|ERR|OUTPUT|RESPONSE|BODY|TITLE|COMMENT)\b\}?/;
const STRIPPED = /\.replace(?:All)?\(\s*\/\[?[^/\n]*\\[rn]|sanitize|stripNewlines|stripCrlf|JSON\.stringify\(|encodeURI(?:Component)?\(|tr\s+-d\s+['"][^'"]*\\[rn]|\/\/\s*\[\$?'?\\[rn]|\/\/\s*\$'\\[rn]/i;

export function hitsFor(file, text) {
  const code = isCode(file);
  if (!code && !isWorkflow(file) && !isShell(file)) return [];
  const out = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*|#)/.test(line) || STRIPPED.test(line)) return;
    if (ANNOTATION.test(line) && UNTRUSTED_SH.test(line)) out.push({ file, line: i + 1, message: "workflow annotation prints an outside value with its line breaks, strip CR and LF first (S5145)" });
    else if (code && LOG_CALL.test(line) && UNTRUSTED_JS.test(line)) out.push({ file, line: i + 1, message: "log line carries an outside value (error.message, request data), strip CR and LF first (S5145)" });
  });
  return out;
}

export function run({ files, cfg, read }) {
  const baseline = cfg?.log_injection?.baseline ?? {};
  const findings = [];
  for (const f of files) {
    const text = read(f);
    if (text == null) continue;
    const hits = hitsFor(f, text);
    if (hits.length > Number(baseline[f] ?? 0)) findings.push(...hits);
  }
  return { pass: findings.length === 0, findings };
}
