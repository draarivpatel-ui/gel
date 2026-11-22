# e2e: grades on real data

Three product checks grade a repo, not just pass or fail it: `click-map`, `ice-score` and `product-brief`.

`gel grade --root <repo>` prints one of five grades for each check, from lowest to highest: **bad**, **passed**, **good**, **high**, **super high**. "bad" means the guard fails, and every other grade means it passes. "no grade" means the repo has nothing for that check, such as a page with too few clicks or a repo with no ICE table. "No grade" counts as neither a pass nor a fail.

| grade | click-map (each page; the repo gets its lowest page) | ice-score (all ICE tables together) | product-brief (six measured numbers) |
| --- | --- | --- | --- |
| bad | over 30% dead clicks, or the main button under 10% | wrong arithmetic, bad score, wrong order, or confidence 7+ with no evidence | an answer, target, number, date or source missing, or a number older than 30 days |
| passed | no finding | no finding | all six answered with fresh, sourced numbers |
| good | at most 15% dead, main button at least 25% | half the rows have evidence, every table has phases | 3 of 6 targets met |
| high | at most 10% dead, main button at least 40%, phones and computers both measured | 80% of rows have evidence, phases, 5+ rows | 5 of 6 met |
| super high | at most 5% dead, main button at least 50%, 200+ clicks, phones and computers | every row links its evidence, phases, 5+ rows | 6 of 6 met, every number at most 7 days old |

## What is real and what is made up

`sources.json` lists every case. `node e2e/record.mjs` fetches each real case and writes the result to `cases.json`:

- Files come from GitHub, pinned to a commit.
- Click maps come from the live `/api/clicks` of grow.flisk.si.

`tests/e2e.test.mjs` builds one repo per case and runs the real `gel grade` CLI on it. It never uses the network.

Some grades have no real example anywhere, so their cases are made up, and each made-up case says why. As of the last recording:

<!-- coverage -->
| check | bad | passed | good | high | super high | no grade |
| --- | --- | --- | --- | --- | --- | --- |
| click-map | 1 real | made up only | made up only | made up only | made up only | 1 real |
| ice-score | 8 real | 1 real | made up only | made up only | made up only | none |
| product-brief | 2 real | made up only | made up only | made up only | made up only | none |
<!-- /coverage -->

What the real data says (recorded 2026-11-22):

- **Clicks.** Grow is the only Flisk site that records every click. Its recorder went live on 2026-11-22. On computers, home has 28 clicks with 71% hitting nothing. Plan has 95 clicks with 42% hitting nothing, and "MAKE MY PLAN" gets 8 of them. No phone taps are recorded yet. Flisk Analytics records only clicks on links that leave the site, so no other Flisk site has click data.
- **ICE.** Five Flisk repos have ICE tables. Four fail because they give a confidence of 7 or more with no evidence. `flisk-sh/pages` passes but has no phase column, so it stops at passed. On public GitHub, the top 100 search results for "ICE score" contain 12 files with scored tables, and all 12 fail on the same evidence rule. Four of them are recorded here, MIT-licensed only and ICE tables only.
- **Briefs.** No repo has a `docs/brief.json` yet. GEL and chat both name a north star and leave the six questions unanswered, so both grade bad.

To replace a made-up case with a real one, add the real source to `sources.json`, run `node e2e/record.mjs`, and commit both files.
