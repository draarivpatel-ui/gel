// From `gel metrics` advice to a reviewable change of docs/gel.json. GEL only proposes: the edit is lane C,
// so a person approves the PR. Pure: no files, no network.

// Changes the advice asks for, against the levels written in docs/gel.json (not the effective ones,
// because mode "report" forces every guard to report, and mode "block" blocks every guard the file does not list).
export function plan(report, raw = {}) {
  const set = raw.guards ?? {};
  const changes = [];
  for (const g of report.guards) {
    const now = set[g.guard] ?? (raw.mode === "block" ? "block" : "report");
    if (g.advice.action === "promote" && now !== "block") changes.push({ guard: g.guard, from: now, to: "block", why: g.advice.why });
    if (g.advice.action === "demote" && now === "block") changes.push({ guard: g.guard, from: now, to: "report", why: g.advice.why });
  }
  return changes;
}

export function apply(raw = {}, changes) {
  const guards = { ...(raw.guards ?? {}) };
  for (const c of changes) guards[c.guard] = c.to;
  return { ...raw, guards };
}

// Promoting under a repo-wide mode "report" would change nothing, so say so instead of staying silent.
export const warnings = (raw, changes) => (changes.some((c) => c.to === "block") && (raw.mode ?? "report") === "report"
  ? ['docs/gel.json has mode "report", which keeps every guard advisory: promoting a guard changes nothing until the mode is "block"'] : []);

export function promoteMarkdown(changes, warns = []) {
  if (!changes.length) return "## GEL promote\n\nNo guard should change level.";
  return ["## GEL promote", "", "| guard | from | to | why |", "|---|---|---|---|", ...changes.map((c) => `| ${c.guard} | ${c.from} | **${c.to}** | ${c.why} |`),
    ...warns.map((w) => `\n> ${w}`), "", "Editing `docs/gel.json` is lane C: a person approves."].join("\n");
}
