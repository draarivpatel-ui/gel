// Brakes for the loops: a kill switch and a cap on open loop PRs. Pure, so the autofix and its test share one rule.

// GEL_PAUSE=1 (or true, yes, on, pause, paused) stops every loop. Empty or unset means run.
export const isPaused = (v) => /^(1|true|yes|on|pause|paused)$/i.test(String(v ?? "").trim());

// How many new PRs this run may open: never more than `max`, and never past `wip` loop PRs open at once.
// `open` counts the loop PRs already waiting for a person, so unmerged work blocks more work.
export function budget({ max, wip, open }) {
  const room = Math.max(0, wip - open);
  const allow = Math.max(0, Math.min(max, room));
  const why = allow === 0 ? (room === 0 ? `${open} loop PRs are open, the cap is ${wip}` : "max is 0") : "";
  return { allow, room, why };
}
