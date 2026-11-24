// No node imports here: this file also runs in a browser. `read(file)` returns the file text or null.
//
// Mirrors SonarCloud S7631 (a privileged workflow that checks out code it should not trust). A workflow
// triggered by `workflow_run` or `pull_request_target` runs with a write token and secrets, so its
// `actions/checkout` must not leave that token in `.git/config` for later steps, and must not check out the
// pull request's own code. Fails when such a workflow has an `actions/checkout` step that:
//   - has no `persist-credentials: false`
//   - has a `ref:` of the PR head: `github.event.pull_request.head.*`, `github.head_ref`, `github.event.workflow_run.head_*`
//     or `refs/pull/...`
// Workflows with other triggers only are not checked (workflow-permissions covers their token scope).
// Existing hits are frozen in docs/gel.json as "workflow_checkout_safety": {"baseline": {"<file>": <count>}}.
export const name = "workflow-checkout-safety";

const isWorkflow = (f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f);
const TRIGGER = /\b(workflow_run|pull_request_target)\b/;
const HEAD_REF = /github\.event\.pull_request\.head\.|github\.head_ref|github\.event\.workflow_run\.head_|refs\/pull\//;

function onBlock(lines) {
  const i = lines.findIndex((l) => /^["']?on["']?\s*:/.test(l));
  if (i < 0) return "";
  const out = [lines[i].replace(/^["']?on["']?\s*:/, "")];
  for (let j = i + 1; j < lines.length && (/^\s/.test(lines[j]) || lines[j].trim() === ""); j++) out.push(lines[j]);
  return out.join("\n").replace(/^\s*#.*$/gm, "").replace(/\s#.*$/gm, "");
}

export function hitsFor(file, text) {
  if (!isWorkflow(file)) return [];
  const lines = text.split("\n");
  if (!TRIGGER.test(onBlock(lines))) return [];
  const out = [];
  lines.forEach((l, i) => {
    const m = /^(\s*)-?\s*uses\s*:\s*["']?actions\/checkout\b/.exec(l);
    if (!m) return;
    // The step's own keys: from its `- ` line (or the `uses` line when it is not first) to the next `- ` at the same indent.
    let start = i;
    while (start > 0 && !/^\s*-\s/.test(lines[start])) start--;
    const stepIndent = lines[start].match(/^(\s*)/)[1].length;
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === "" || lines[end].match(/^(\s*)/)[1].length > stepIndent)) end++;
    const step = lines.slice(start, end).filter((s) => !/^\s*#/.test(s)).join("\n");
    const refLine = /^\s*(?:-\s*)?ref\s*:\s*(.*)$/m.exec(step);
    if (!/persist-credentials\s*:\s*["']?false["']?\s*(#.*)?$/m.test(step)) out.push({ file, line: i + 1, message: "checkout in a workflow_run / pull_request_target workflow has no persist-credentials: false (S7631)" });
    if (refLine && HEAD_REF.test(refLine[1])) out.push({ file, line: i + 1, message: "checkout in a workflow_run / pull_request_target workflow takes the pull request's own code with a write token (S7631)" });
  });
  return out;
}

export function run({ files, cfg, read }) {
  const baseline = cfg?.workflow_checkout_safety?.baseline ?? {};
  const findings = [];
  for (const f of files) {
    if (!isWorkflow(f)) continue;
    const text = read(f);
    if (text == null) continue;
    const hits = hitsFor(f, text);
    if (hits.length > Number(baseline[f] ?? 0)) findings.push(...hits);
  }
  return { pass: findings.length === 0, findings };
}
