// No node imports here: this file also runs in a browser. Some scanners (the Claude plugin directory) refuse a
// repo before reading it when a .gitattributes line-ending rule could make Git check out other bytes than they read,
// even the common `* text=auto`. A rule passes when `eol=lf` is the only eol setting on its line, or when it only
// switches line endings off (`-text`, `-crlf`, bare `binary`). Offline, whole tree, every .gitattributes in the repo.
export const name = "gitattributes-eol";
const MAX_RULES = 256;

// First token is the pattern (it may be double-quoted); the rest are attributes.
function split(line) {
  const m = /^("(?:[^"\\]|\\.)*"|\S+)\s*(.*)$/.exec(line);
  return m ? { pattern: m[1], attrs: m[2].split(/\s+/).filter(Boolean) } : null;
}

export function run({ files, read }) {
  const findings = [];
  for (const f of files) {
    if (!/(^|\/)\.gitattributes$/.test(f)) continue;
    const text = read(f);
    if (text == null) continue;
    let count = 0;
    text.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("[attr]")) return;
      const r = split(line);
      if (!r) return;
      const attrs = r.attrs;
      const eols = attrs.filter((a) => /^!?eol(=|$)/i.test(a));
      const lineEnding = attrs.filter((a) => /^(text|!text|text=.*|crlf|!crlf|crlf=.*|!binary|-binary|binary=.*|!eol|eol=.*)$/i.test(a));
      if (!lineEnding.length) return;
      count++;
      const lf = eols.length === 1 && /^eol=lf$/i.test(eols[0]);
      const bad = attrs.filter((a) => /^(!binary|-binary|binary=.*)$/i.test(a));
      if (bad.length) findings.push({ file: f, line: i + 1, message: `\`${bad[0]}\` counts as a line-ending rule: delete the rule` });
      else if (!lf) findings.push({ file: f, line: i + 1, message: `\`${line}\` has no \`eol=lf\` as its only eol setting: add \`eol=lf\`, or use \`-text\`/delete it (.bat/.cmd: \`*.bat -text\`)` });
    });
    if (count > MAX_RULES) findings.push({ file: f, line: 0, message: `${count} line-ending rules; more than ${MAX_RULES} are refused` });
  }
  return { pass: findings.length === 0, findings };
}
