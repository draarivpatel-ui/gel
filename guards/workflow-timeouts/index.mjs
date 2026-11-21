// No node imports here: this file also runs in a browser. `read(file)` returns the file text or null.

export const name = "workflow-timeouts";
// Pre-flight on workflow config: every job that runs steps sets `timeout-minutes`. GitHub's default is 360
// minutes, so one hung install or a stuck agent loop burns six hours of runner time before anyone notices.
// Skips a job that only calls a reusable workflow (`uses:` at job level): the timeout lives in the callee.

function jobs(lines) {
  const start = lines.findIndex((l) => /^jobs\s*:/.test(l));
  if (start < 0) return [];
  let indent = null;
  let bodyInd = null;
  const out = [];
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() === "" || /^\s*#/.test(l)) continue;
    if (!/^\s/.test(l)) break;
    const ind = l.match(/^(\s*)/)[1].length;
    if (indent === null) indent = ind;
    if (ind === indent) { out.push({ name: l.trim().split(":")[0], line: j + 1, timeout: false, calls: false }); bodyInd = null; continue; }
    if (!out.length) continue;
    if (bodyInd === null) bodyInd = ind;
    if (ind !== bodyInd) continue;
    if (/^\s*timeout-minutes\s*:/.test(l)) out.at(-1).timeout = true;
    if (/^\s*uses\s*:/.test(l)) out.at(-1).calls = true;
  }
  return out;
}

export function run({ files, read }) {
  const findings = [];
  for (const f of files.filter((x) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(x))) {
    const text = read(f);
    if (text === null) continue;
    for (const j of jobs(text.split("\n"))) {
      if (j.timeout || j.calls) continue;
      findings.push({ file: f, line: j.line, message: `job "${j.name}" has no timeout-minutes, so a hang runs for GitHub's 360-minute default` });
    }
  }
  return { pass: findings.length === 0, findings };
}
