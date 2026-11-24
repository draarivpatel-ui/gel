// What gel-ctx reads from GitHub for checks-green and deploy-delivered. `get(path)` returns parsed JSON or null, so tests pass a fake.
const OWN = /^gel\b/i; // our own job is named "GEL guards"; it cannot judge itself
const DEPLOY_NAME = /deploy|release|publish|ship/i;

async function checkRunsForCommit(get, repo, sha) {
  const path = `/repos/${repo}/commits/${sha}/check-runs?per_page=100`;
  const runs = [];
  for (let page = 1; ; page++) {
    const result = await get(`${path}&page=${page}`);
    const batch = result?.check_runs ?? [];
    runs.push(...batch);
    if (!batch.length || runs.length >= (result?.total_count ?? runs.length)) return runs;
  }
}

export async function collectChecks(get, { repo, sha, ignore = [], waitS = 300, pollMs = 10000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
  const skip = (n) => OWN.test(n) || ignore.some((i) => String(i).toLowerCase() === String(n).toLowerCase());
  const deadline = now() + waitS * 1000;
  let runs = [];
  for (;;) {
    runs = await checkRunsForCommit(get, repo, sha);
    const pending = runs.filter((c) => c.status !== "completed" && !skip(c.name));
    if (!pending.length || now() >= deadline) break;
    await sleep(pollMs);
  }
  const pending = runs.filter((c) => c.status !== "completed" && !skip(c.name)).map((c) => c.name);
  const statuses = ((await get(`/repos/${repo}/commits/${sha}/status`))?.statuses ?? []).filter((s) => !skip(s.context))
    .map((s) => ({ context: s.context, state: s.state === "pending" ? "pending" : s.state, description: s.description }));
  return {
    checkRuns: runs.filter((c) => !OWN.test(c.name)).map((c) => ({ name: c.name, conclusion: c.conclusion, title: c.output?.title ?? undefined, summary: c.output?.summary ? String(c.output.summary).slice(0, 600) : undefined })),
    statuses: statuses.filter((s) => s.state !== "pending"),
    checksSettled: pending.length === 0 && !statuses.some((s) => s.state === "pending"),
    pendingChecks: [...pending, ...statuses.filter((s) => s.state === "pending").map((s) => s.context)],
  };
}

// the latest finished run of each deploy-looking workflow on the default branch, with its jobs and steps
export async function collectDeployRuns(get, { repo, branch, max = 3 }) {
  const runs = (await get(`/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=30`))?.workflow_runs ?? [];
  const seen = new Set();
  const out = [];
  for (const r of runs) {
    if (seen.has(r.workflow_id) || !DEPLOY_NAME.test(r.name ?? "") || !["push", "workflow_dispatch", "release", "schedule"].includes(r.event)) continue;
    seen.add(r.workflow_id);
    const jobs = (await get(`/repos/${repo}/actions/runs/${r.id}/jobs?per_page=50`))?.jobs ?? [];
    out.push({ workflow: r.name, path: r.path, url: r.html_url, conclusion: r.conclusion, sha: r.head_sha, jobs: jobs.map((j) => ({ name: j.name, conclusion: j.conclusion, steps: (j.steps ?? []).map((s) => ({ name: s.name, conclusion: s.conclusion })) })) });
    if (out.length >= max) break;
  }
  return out;
}
