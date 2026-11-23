---
name: gel-init
description: Add GEL (the flisk-sh CI guards) to a repo with `gel init` and run it for real. Writes the pinned caller workflow and docs/gel.json with every guard set to block, scans the tree, and shows what the first CI run will fail on. Use when asked to "add GEL", "gel init", "put the guards on this repo", or "make CI fail on issues like GEL would".
---

# gel-init

Put GEL on a repo so CI fails (an error, not a report) on what the guards find.

1. From the repo root run the real command, not a dry run: `node <path-to-gel>/bin/gel.mjs init`
   (clone `flisk-sh/gel` if you have no checkout). Add `--strict` to also block the guards that need a browser or a declared metric.
2. It writes `.github/workflows/gel.yml` (pinned to a commit SHA) and `docs/gel.json` (`"mode": "block"`), then scans the whole tree and prints each finding as `BLOCK` or `report`. It exits 1 when a blocking guard finds something.
3. Do not downgrade a guard to `report` to make the run green, and do not fix the findings in the same PR unless asked: the failing CI is the evidence. Commit both files, open the PR, and quote the findings.
4. Existing files are kept; `--force` replaces them. `--dry-run` only lists what would be written.
5. GEL reads `docs/gel.json` only, never a root `gel.json`.
