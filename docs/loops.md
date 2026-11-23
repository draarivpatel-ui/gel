# Metrics, loops and org view

How GEL decides when to block, how it measures a headline number, and the nightly loops around it. Start with the [README](../README.md) if you only want the guards.

## North star, measured

A north star number typed into a file proves nothing. `.github/workflows/north-star.yml` measures it on a schedule: it runs `north_star.measure`, stamps the date, the run link (`run`) and the commit, and pushes the result to the repo's `north-star` branch, with `history.jsonl` holding one line per run. The default branch is left alone, so the workflow needs only `contents: write` and no pull request. The `north-star` guard and `gel north-star` judge whichever is newer by `measuredAt`: the committed `result` file or the branch copy. Check out with `fetch-depth: 0` so the guard sees the branch.

```yaml
# .github/workflows/north-star.yml in your repo
name: North star
on:
  schedule: [{ cron: "23 5 * * 1" }]
  workflow_dispatch:
concurrency: { group: north-star, cancel-in-progress: false }
jobs:
  measure:
    permissions: { contents: write }
    uses: flisk-sh/gel/.github/workflows/north-star.yml@<40-char gel commit> # vX.Y.Z
    with:
      gel_ref: <same commit>
      setup: npm ci   # optional: whatever the measure command needs first
    secrets:
      measure_secret: ${{ secrets.MY_API_KEY }}   # optional: the measure reads it as $MEASURE_SECRET
```

`measure_secret` is for a number that lives behind an API key, such as a site's analytics. It is set only on the measure step, so the setup command never sees it. Keep the key in a repository secret, never in the file.

A run that misses the target still publishes its number, then fails, so the red run says it missed.

## Run record

Each run appends one JSON line to `gel-record.jsonl`: repo, commit, lane, each guard's result, its first 10 findings and the time. That record is how you decide to promote a guard.

## Org view: Cilytics

[Cilytics](https://cilytics.flisk.si/) ([flisk-sh/cilytics](https://github.com/flisk-sh/cilytics)) shows GEL across a whole org or user account. It finds the newest completed run of each repo's workflow named `GEL` (or a file called `gel.yml`), reads `gel-record.jsonl` from its `gel-record` artifact, and shows which repos run GEL, the guard findings and what is blocked. Keep that workflow name and artifact name, or the repo shows as "GEL not installed". Cilytics also shows each guard's own quality score (recall, precision, false blocks) from `scores.json`, the published result of `gel selftest`; regenerate it with `node bin/gel.mjs selftest --json > scores.json` when a guard changes (a test fails if it is stale).

## Metrics and the flywheel

```bash
node bin/gel.mjs metrics records/*.jsonl --labels docs/gel-labels.json
```

Per guard: runs, fail rate, precision from your labels (`[{guard, file, line, verdict: "real" | "false"}]`), and advice:

- **promote** to block after 20 runs, 5 labelled findings and 95% precision;
- **demote** a blocking guard on a labelled false alarm;
- **hold** otherwise. It never promotes on an unknown precision.

Every false alarm is listed as a hard case to add to the guard's `cases.json`. Overall it reports first-pass share, blocked runs and p50/p95 time. GEL only advises: a person edits `docs/gel.json`, and that edit is lane C.

### Promote and demote

```bash
node bin/gel.mjs promote gel-record.jsonl --labels docs/gel-labels.json [--write]
```

Turns the `gel metrics` advice into a change of `docs/gel.json`: a guard advised to **promote** goes from `report` to `block`, a blocking guard advised to **demote** goes back to `report`, nothing else is touched. Without `--write` it only prints the proposal as a table. It warns when the file has `mode: "report"`, because that keeps every guard advisory. Editing `docs/gel.json` is lane C, so a person approves the PR; GEL never changes the level on its own. `.github/workflows/promote.yml` runs `scripts/promote-pr.mjs` each Monday: it gathers the repo's last 50 `gel-record` artifacts, runs the command above and opens one PR (branch `gel/promote-guards`, one open at a time) when a guard should change. It honours the `GEL_PAUSE` kill switch and, like the flywheel, only opens the PR when the secret `GEL_AUTOFIX_GITHUB_TOKEN` exists; promotion needs labelled findings in `docs/gel-labels.json`, so until someone labels findings every guard holds.

### Fix PRs

```bash
node bin/gel.mjs fix pinned-actions --root path/to/repo   # pins what the guard reports, then re-scores
node scripts/autofix.mjs --max 5 [--dry-run]             # the nightly loop over the repos Cilytics lists
```

`gel fix` edits only the lines the guard reports, then runs every guard again over the whole tree. It exits 0 only when the target guard dropped, no other guard rose, and only workflow or action files changed. `.github/workflows/flywheel.yml` runs the loop each night and opens at most 5 PRs a night and never more than 3 loop PRs open at once (`--wip`), so unmerged work stops new work (branch `gel/fix-pinned-actions`). Kill switch: set the repository variable `GEL_PAUSE` to `1` (or run with `GEL_PAUSE=1`) and the run exits without touching anything. It needs the secret `GEL_AUTOFIX_GITHUB_TOKEN` (contents and pull requests: write on the org's repos); without it the run is a dry run.

### Factory metrics

```bash
node bin/gel.mjs factory --repo flisk-sh/gel --limit 100   # or: gel factory prs.json [--json]
```

The north star of the software factory: **human touch points per merged PR** (lower is better), with the share of PRs that took none and lead time (p50, p90). A touch point is one thing a person did: opening the PR by hand, each human review or comment, each human commit pushed after it opened, and merging it by hand (auto-merge is not a touch). A PR from a loop (branch `gel/...` or a bot author) costs nothing to open. It reads merged PRs through `gh`; nothing is written.

## Nightly meta-eval

`.github/workflows/meta-eval.yml` runs every night: the selftest (recall and precision per guard), then the bench, then `bench/check.mjs`, which fails if any guard catches fewer planted defects or raises more findings on clean repos than `bench/baseline.json`. Changing the baseline is lane C.

## Release gate and deploy health

The shared [flisk-sh/.github](https://github.com/flisk-sh/.github) workflows cover the stages after GEL: `release-gate.yml` waits for every check on the release commit and fails on a red or missing required one, and `deploy-health.yml` checks the deployed URL. The `flisk-release` starter wires both around a publish job.
