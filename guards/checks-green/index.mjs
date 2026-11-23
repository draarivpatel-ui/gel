// No node imports here: this file also runs in a browser.
// "Another check on this commit is red, or is green only because it is broken." done-without-green only speaks up when
// the PR text claims green; this guard judges the checks themselves. It reads what `gel-ctx` collected for the head commit:
//   ctx.checkRuns: [{ name, conclusion, title?, summary? }]   check runs of other apps (SonarCloud, CodeRabbit, CI), not GEL's own
//   ctx.statuses:  [{ context, state, description? }]         legacy commit statuses
//   ctx.checksSettled: false when a check was still running after gel-ctx waited (a verdict that is not in yet is not green)
// It reports three things: a red check, a check whose own text says it is misconfigured (a Sonar project that does not exist,
// a revoked token) even when it ended neutral or green, and a check that never finished. gel.json:
//   "checks_green": { "ignore": ["CodeRabbit"], "allow_pending": false }
export const name = "checks-green";

const RED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "error"]);
// text a check prints when it did not really run: the verdict is meaningless, whatever colour it has
const BROKEN = /project (?:key )?(?:does(?: not|n['’]t) exist|not found)|could not find (?:the )?(?:project|organi[sz]ation)|not authori[sz]ed|unauthori[sz]ed|bad credentials|(?:invalid|expired|revoked|missing) (?:api )?(?:token|key|credentials?)|token (?:is |was )?(?:invalid|expired|missing|not set)|(?:no|missing) (?:sonar|analysis) (?:project|token)|analysis (?:was )?not (?:run|found|uploaded)|authentication (?:failed|required)|resource not accessible/i;

const text = (c) => [c.title, c.summary, c.description, c.text].filter(Boolean).join(" ");

export function run({ ctx = {}, cfg = {} }) {
  const c = cfg.checks_green ?? {};
  const ignored = (n) => (c.ignore ?? []).some((i) => String(n).toLowerCase() === String(i).toLowerCase());
  const findings = [];
  const add = (name, message) => findings.push({ file: "(pull request)", line: 0, message: `${name}: ${message}` });

  for (const k of ctx.checkRuns ?? []) {
    if (ignored(k.name)) continue;
    const why = text(k).match(BROKEN)?.[0];
    if (RED.has(k.conclusion)) add(k.name, `${k.conclusion}${k.title ? ` ("${String(k.title).slice(0, 80)}")` : ""}${why ? `, and it says "${why}", so the check itself is misconfigured` : ""}`);
    else if (why) add(k.name, `ended ${k.conclusion ?? "without a verdict"} but says "${why}": it did not really run`);
  }
  for (const s of ctx.statuses ?? []) {
    if (ignored(s.context)) continue;
    const why = text({ description: s.description }).match(BROKEN)?.[0];
    if (s.state === "failure" || s.state === "error") add(s.context, `status ${s.state}${s.description ? ` ("${String(s.description).slice(0, 80)}")` : ""}${why ? `, misconfigured: "${why}"` : ""}`);
    else if (why) add(s.context, `status ${s.state} but says "${why}": it did not really run`);
  }
  if (ctx.checksSettled === false && !c.allow_pending) {
    const names = (ctx.pendingChecks ?? []).filter((n) => !ignored(n));
    if (names.length) findings.push({ file: "(pull request)", line: 0, message: `${names.slice(0, 5).join(", ")} still running when GEL judged this commit, so it cannot be called green` });
  }
  return { pass: findings.length === 0, findings };
}
