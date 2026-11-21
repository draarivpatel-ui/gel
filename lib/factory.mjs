// Factory metrics: how much human work a merged PR took. The north star of the software factory is
// "human touch points per merged PR" (lower is better) with lead time as the second number.
//
// A touch point is one thing a person did: opening the PR by hand, each human review or comment,
// each human commit pushed after it opened, and merging it by hand (auto-merge is not a touch).
// A PR opened by a loop (branch `gel/...` or a bot author) costs nothing to open. Pure, no network.
import { percentile } from "./metrics.mjs";

const BOTS = new Set(["github-actions", "dependabot", "renovate", "copilot"]);
export const isBot = (login, flag) => !login || flag === true || /\[bot\]$/i.test(login) || BOTS.has(String(login).toLowerCase());
export const byLoop = (pr) => /^gel\//.test(pr.headRef || "") || isBot(pr.author?.login, pr.author?.isBot);

// Normalise `gh pr list --json number,author,createdAt,mergedAt,mergedBy,autoMergeRequest,headRefName,reviews,comments,commits`.
export const fromGh = (p) => ({
  number: p.number, headRef: p.headRefName, createdAt: p.createdAt, mergedAt: p.mergedAt,
  author: { login: p.author?.login, isBot: p.author?.is_bot },
  mergedBy: { login: p.mergedBy?.login, isBot: p.mergedBy?.is_bot },
  autoMerge: !!p.autoMergeRequest,
  reviews: (p.reviews || []).map((r) => ({ login: r.author?.login, isBot: r.author?.is_bot })),
  comments: (p.comments || []).map((c) => ({ login: c.author?.login, isBot: c.author?.is_bot })),
  commits: (p.commits || []).map((c) => ({ at: c.committedDate, logins: (c.authors || []).map((a) => a.login) })),
});

export function touchPoints(pr) {
  const t = { opened: byLoop(pr) ? 0 : 1, reviews: 0, comments: 0, commits: 0, merge: 0 };
  for (const r of pr.reviews || []) if (!isBot(r.login, r.isBot)) t.reviews++;
  for (const c of pr.comments || []) if (!isBot(c.login, c.isBot)) t.comments++;
  const opened = Date.parse(pr.createdAt);
  for (const c of pr.commits || []) if (Date.parse(c.at) > opened && (c.logins || []).some((l) => !isBot(l))) t.commits++;
  if (!pr.autoMerge && !isBot(pr.mergedBy?.login, pr.mergedBy?.isBot)) t.merge = 1;
  return { ...t, total: t.opened + t.reviews + t.comments + t.commits + t.merge };
}

const round = (n) => (n == null ? null : Math.round(n * 100) / 100);

export function factory(prs) {
  const merged = prs.filter((p) => p.mergedAt && p.createdAt);
  const touches = merged.map((p) => touchPoints(p).total);
  const hours = merged.map((p) => (Date.parse(p.mergedAt) - Date.parse(p.createdAt)) / 36e5);
  const loop = merged.filter(byLoop).length;
  return {
    merged: merged.length,
    touchPerPr: merged.length ? round(touches.reduce((a, b) => a + b, 0) / merged.length) : null,
    touchP50: percentile(touches, 50),
    zeroTouch: merged.length ? round(touches.filter((n) => n === 0).length / merged.length) : null,
    loopShare: merged.length ? round(loop / merged.length) : null,
    leadHoursP50: round(percentile(hours, 50)),
    leadHoursP90: round(percentile(hours, 90)),
  };
}

export const factoryMarkdown = (r) => [
  "## Factory metrics", "",
  `| merged PRs | touch points per PR | zero-touch share | opened by a loop | lead time p50 | lead time p90 |`,
  `|---|---|---|---|---|---|`,
  `| ${r.merged} | ${r.touchPerPr ?? "n/a"} | ${r.zeroTouch == null ? "n/a" : Math.round(r.zeroTouch * 100) + "%"} | ${r.loopShare == null ? "n/a" : Math.round(r.loopShare * 100) + "%"} | ${r.leadHoursP50 ?? "n/a"} h | ${r.leadHoursP90 ?? "n/a"} h |`,
].join("\n");
