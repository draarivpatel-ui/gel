// No node imports here: this file also runs in a browser. `read(file)` returns the file text or null.
//
// Mirrors SonarCloud S6506 (a download that can fall back to a plain protocol). `curl` follows a redirect to
// http:// unless told not to, so a download for a build or an installer needs `--proto '=https'` (with
// `--tlsv1.2` if you want a floor). Fails when a `curl` command in a workflow, a shell script or a Dockerfile has
// no `--proto` flag. Skipped: comment lines, heredoc bodies, `curl --version`/`--help`, and a curl whose every URL
// is localhost, 127.0.0.1, [::1] or 0.0.0.0.
// Existing hits are frozen in docs/gel.json as "curl_https_only": {"baseline": {"<file>": <count>}}: a file may only
// get cleaner, a file not listed must be clean.
export const name = "curl-https-only";

const CURL = /(^|[\s;&|(`'"{]|\$\()curl(?=\s)/;
const LOCAL_URL = /^https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(?=[:/?#'"\s]|$)/i;
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build)\//;

const isWorkflow = (f) => /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/.test(f);
const isDockerfile = (f) => /(^|\/)(Dockerfile[^/]*|[^/]*\.dockerfile)$/i.test(f);
const isShell = (f) => /\.(sh|bash)$/.test(f) || !/\.[^/]*$/.test(f.slice(f.lastIndexOf("/") + 1));

// Join `\` continuations so a flag on the next line counts. Returns [{ line, text }] with the first line number.
function logicalLines(text) {
  const out = [];
  let cur = null;
  text.split("\n").forEach((raw, i) => {
    const cont = /\\\s*$/.test(raw);
    const piece = raw.replace(/\\\s*$/, " ");
    if (cur) cur.text += piece; else cur = { line: i + 1, text: piece };
    if (!cont) { out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  return out;
}

function onlyLocal(cmd) {
  const urls = cmd.match(/https?:\/\/[^\s'"]+/gi) ?? [];
  return urls.length > 0 && urls.every((u) => LOCAL_URL.test(u));
}

export function hitsFor(file, text) {
  const kinds = isWorkflow(file) ? "yaml" : isDockerfile(file) ? "docker" : isShell(file) && !SKIP_DIR.test(file) ? "shell" : null;
  if (!kinds) return [];
  if (kinds === "shell" && !/^#!/.test(text) && !/\.(sh|bash)$/.test(file)) return [];
  const out = [];
  let heredoc = null;
  for (const { line, text: t } of logicalLines(text)) {
    const first = t.split("\n")[0];
    if (heredoc) { if (first.trim() === heredoc) heredoc = null; continue; }
    const doc = /<<-?\s*['"]?(\w+)['"]?/.exec(t);
    if (doc && kinds !== "yaml") heredoc = doc[1];
    if (/^\s*#/.test(t)) continue;
    const cmd = t.replace(/\s+#.*$/, "");
    if (!CURL.test(cmd) || /--proto(?:-default)?\b/.test(cmd) || /curl\s+(?:-V|--version|--help)\b/.test(cmd) || onlyLocal(cmd)) continue;
    out.push({ file, line, message: "curl without --proto '=https', a redirect can drop to http (S6506)" });
  }
  return out;
}

export function run({ files, cfg, read }) {
  const baseline = cfg?.curl_https_only?.baseline ?? {};
  const findings = [];
  for (const f of files) {
    const text = read(f);
    if (text == null) continue;
    const hits = hitsFor(f, text);
    if (hits.length > Number(baseline[f] ?? 0)) findings.push(...hits);
  }
  return { pass: findings.length === 0, findings };
}
