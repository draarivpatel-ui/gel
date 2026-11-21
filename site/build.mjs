#!/usr/bin/env node
// Builds site/public/index.html from the bench. No number on the page is typed by hand.
//   node site/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, "..", p), "utf8"));
const R = read("bench/results.json");
const V1 = read("bench/results-v1.0.json");
const T = read("bench/triage.json");
const CI = read("bench/ci-times.json");
const S = R.summary, C = R.claims.summary;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const fmt = (n) => n.toLocaleString("en-US");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

const k = S.perKind;
const covered = ["secret", "action", "perm", "link"].reduce((s, x) => ({ n: s.n + k[x].covered.n, c: s.c + k[x].covered.caught }), { n: 0, c: 0 });
const permReal = T["workflow-permissions"].filter((x) => x.verdict === "real").length, permN = T["workflow-permissions"].length;
const real = T["dead-links"].filter((x) => x.verdict === "real").reduce((s, x) => s + x.n, 0);
const ciMedian = median(CI.runs.map((r) => r.seconds));
const softOnly = R.claims.prs.filter((p) => p.flagged && p.red.every((n) => /codecov|dependabot|visual|flaky|Workers Builds|rules|Pages changed|approval|Ready to merge|snyk/i.test(n))).length;
const hardIds = ["google-api-key", "password-in-url", "aws-key-in-test-file", "html-href", "scope-not-needed"];
const hard = hardIds.reduce((s, id) => ({ n: s.n + S.perDefect[id].n, c: s.c + S.perDefect[id].caught }), { n: 0, c: 0 });
const share = pct(C.flagged, C.withChecks);

// Text that fills the bars, ponytail style: what each guard actually reads. Fake keys are split so no scanner trips on this file.
const fill = {
  secret: `const key = "AKIA" + "…"; stripe.init("sk_" + "live_…"); ----BEGIN ${"PRIVATE"} KEY---- headers: { authorization: "ghp_…" } anthropic({ apiKey: "sk-ant-…" }) `,
  action: `- uses: actions/checkout@v4  - uses: docker/build-push-action@master  - uses: aws-actions/configure-aws-credentials@v4.1.0  - uses: some/action@main `,
  perm: `on: pull_request_target  permissions: write-all  jobs: build: runs-on: ubuntu-latest  ref: ${"$"}{{ github.event.pull_request.head.sha }}  `,
  link: `[Setup](docs/setup.md)  ![diagram](img/arch.png)  [API](docs/api.md#auth)  [Guide](../guide/README.md)  [Changelog](CHANGELOG.md) `,
  claim: `"All tests pass, ready to merge."  test (ubuntu-latest): failure  "All checks pass"  lint: timed_out  build: cancelled `,
};
const rows = [
  ["secret", "Leaked keys", "AWS, GitHub, Anthropic, Stripe live, private key blocks", "scan for keys"],
  ["action", "Unpinned actions", "@v4, @master, @v4.1.0 on another org's action", "check action pins"],
  ["perm", "Open token scope", "no permissions key, write-all, fork head under pull_request_target", "audit workflow permissions"],
  ["link", "Broken repo links", "missing doc, image, doc#anchor", "check links"],
  ["claim", "Green claim, red check", "two lies and two honest PRs per repo", "check this"],
];
const statRows = rows.map(([id, name, what, ownWhat]) => {
  const c = k[id].covered, own = k[id].withoutGel;
  const bar = (w, cls, label) => `<div class="bar ${cls}"><div class="fill" style="width:${Math.max(w, 1.5)}%"><span>${esc(fill[id].repeat(4))}</span></div><em>${label}</em></div>`;
  return `
  <div class="stat">
   <div class="stat-l"><b>${c.caught}/${c.n}</b><span>${name}</span><small>${what}</small></div>
   <div class="stat-r">
    ${bar(pct(c.caught, c.n), "gel", `${pct(c.caught, c.n)}%`)}
    ${bar(pct(own, S.repos), "own", `${own}/${S.repos} repos ${ownWhat}`)}
   </div>
  </div>`;
}).join("");

const misses = [
  ["google-api-key", "Google API key in a source file", "Not in the rules yet."],
  ["password-in-url", "Password inside a database URL", "Not in the rules yet."],
  ["aws-key-in-test-file", "AWS key inside a test file", "On purpose: test files are full of fake keys."],
  ["html-href", "HTML <a href> inside a markdown file", "Markdown files are read for markdown links only."],
  ["scope-not-needed", "A write scope the job never uses", "GEL checks that a scope is set, not that it is needed."],
].map(([id, what, why]) => `<tr><td>${esc(what)}</td><td class="num miss">${S.perDefect[id].caught}/${S.perDefect[id].n}</td><td class="dim">${esc(why)}</td></tr>`).join("");

const permTriage = T["workflow-permissions"].map((x) => `<tr><td class="mono">${esc(x.repo)}</td><td class="mono dim">${esc(x.where.split("/").pop())}</td><td><span class="v ${x.verdict}">${x.verdict}</span></td><td class="dim">${esc(x.why)}</td></tr>`).join("");
const triage = T["dead-links"].map((x) => `<tr><td class="mono">${esc(x.repo)}</td><td class="num">${x.n}</td><td><span class="v ${x.verdict}">${x.verdict}</span></td><td class="dim">${esc(x.why)}</td></tr>`).join("");

const ticker = [
  `secret-scan ${k.secret.covered.caught}/${k.secret.covered.n}`, `pinned-actions ${k.action.covered.caught}/${k.action.covered.n}`,
  `workflow-permissions ${k.perm.covered.caught}/${k.perm.covered.n}`, `dead-links ${k.link.covered.caught}/${k.link.covered.n}`, `done-without-green ${C.flagged}/${C.withChecks} real PRs`,
  `false secret alarms ${V1.summary.clean["secret-scan"].findings} → ${S.clean["secret-scan"].findings}`,
  `dead-link findings ${V1.summary.clean["dead-links"].findings} → ${S.clean["dead-links"].findings}`,
  `p50 ${S.msP50} ms per repo`, `${fmt(S.files)} files`, `${S.repos} repos`, `misses ${hard.n - hard.c}/${hard.n} by design`,
].map((t) => `<span>${esc(t)}</span>`).join("<i>/</i>");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GEL: CI guards for AI pull requests</title>
<meta name="description" content="Five CI checks for AI-written pull requests: leaked keys, unpinned actions, open workflow tokens, dead links, and PRs that say green while a check is red. Benchmarked on ${S.repos} public repos and ${C.withChecks} real pull requests.">
<meta property="og:title" content="GEL: your agent said all tests pass">
<meta property="og:description" content="${C.flagged} of ${C.withChecks} real public PRs said green while a check was red. GEL catches it, plus leaked keys, unpinned actions and dead links.">
<meta name="theme-color" content="#000000">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23000'/%3E%3Cpath d='M9 17l5 5 9-12' stroke='%23b49cff' stroke-width='3.5' fill='none'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&family=Geist+Mono:wght@400;500;600&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
<style>
:root{--bg:#000;--card:#0a0a0b;--card2:#111113;--ink:#fff;--soft:#d6d3cc;--muted:#9a9690;--faint:#5f5c57;--line:rgba(255,255,255,.1);--line2:rgba(255,255,255,.18);
 --holo:linear-gradient(120deg,#7fe3f5 0%,#b49cff 50%,#ff9fd8 100%);--pink:#ff9fd8;--violet:#b49cff;--cyan:#7fe3f5;--green:#4ade80;
 --sans:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;color-scheme:dark}
*{box-sizing:border-box}html{scroll-behavior:smooth;overflow-x:clip}
body{margin:0;background:var(--bg);color:var(--ink);font:300 16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit}code,.mono{font-family:var(--mono);font-size:.86em}
:focus-visible{outline:2px solid var(--violet);outline-offset:3px;border-radius:6px}
.wrap{max-width:1120px;margin:0 auto;padding:0 32px}
.holo{background:var(--holo);-webkit-background-clip:text;background-clip:text;color:transparent}
.kicker{font:500 11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}


.fm .fi{width:16px;height:16px;border-radius:5px}.fm .cv{color:var(--muted);transition:transform .2s}.fm[open] .cv{transform:rotate(180deg)}
.fm strong{font-weight:600;background:linear-gradient(100deg,#6a6a72 20%,#4ade80 40%,#bbf7d0 50%,#4ade80 60%,#6a6a72 80%) 0 0/300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:fsh 4s linear infinite}
@keyframes fsh{to{background-position:-300% 0}}@media(prefers-reduced-motion:reduce){.fm strong{animation:none}}
.fm-pop{position:absolute;left:0;top:calc(100% + 10px);width:min(640px,calc(100vw - 32px));background:var(--card);border:1px solid var(--line2);border-radius:16px;padding:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px 18px;box-shadow:0 24px 60px -20px #000}
.fm-g h3{margin:0 0 6px;font:500 11px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.fm-g a,.fm-all{display:block;padding:5px 8px;margin:0 -8px;border-radius:8px;font-size:14px;color:var(--soft);text-decoration:none}.fm-g a:hover,.fm-all:hover{background:var(--card2);color:var(--ink)}
.fm-all{grid-column:1/-1;border-top:1px solid var(--line);border-radius:0 0 8px 8px;margin:0;padding-top:12px;color:var(--ink)}
@media(max-width:640px){.fm-pop{grid-template-columns:1fr 1fr}.fm .fr{display:none}}
.pill{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:12px 22px;font:500 14px var(--sans);text-decoration:none;white-space:nowrap;border:1px solid var(--line2);color:var(--ink);background:var(--card);cursor:pointer;transition:transform .15s}
.pill:hover{transform:translateY(-1px)}.pill.white{background:#fff;color:#000;border-color:#fff}
.pill.holo-b{border:1px solid transparent;background:linear-gradient(rgba(10,10,11,.9),rgba(10,10,11,.9)) padding-box,var(--holo) border-box}
.pill.sm{padding:7px 14px;font-size:13px}

.ticker{border-bottom:1px solid var(--line);overflow:hidden;white-space:nowrap;font:400 12px var(--mono);color:var(--muted);padding:10px 0;mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.ticker .run{display:inline-flex;gap:18px;animation:tick 60s linear infinite;padding-left:18px}.ticker i{color:var(--faint);font-style:normal}
@keyframes tick{to{transform:translateX(-50%)}}

.subnav{border-bottom:1px solid var(--line);background:rgba(0,0,0,.72)}.subnav .wrap{display:flex;gap:4px;height:40px;align-items:center}.subnav a{font-size:13.5px;color:var(--muted);text-decoration:none;padding:5px 12px;border-radius:999px}.subnav a:hover{background:var(--card2);color:var(--ink)}
.hero{position:relative;padding:88px 0 40px}
.hero::before{content:"";position:absolute;inset:-120px -20% auto;height:720px;background:radial-gradient(ellipse 50% 45% at 30% 30%,rgba(66,92,255,.28),transparent 70%),radial-gradient(ellipse 35% 35% at 75% 55%,rgba(180,156,255,.16),transparent 70%);pointer-events:none;z-index:-1}
.hero-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:40px;align-items:center}
h1{font:200 clamp(42px,6vw,76px)/1.02 var(--sans);letter-spacing:-.035em;margin:18px 0 24px}
h1 .l2{display:block}
.lead{font-size:19px;color:var(--soft);max-width:33em;margin:0 0 30px}
.cta{display:flex;gap:10px;flex-wrap:wrap}
.sphere{position:relative;aspect-ratio:1;width:100%;max-width:440px;justify-self:end}
.sphere canvas{width:100%;height:100%;display:block}
.sphere figcaption{position:absolute;left:0;right:0;bottom:-6px;text-align:center;font:400 11.5px var(--mono);color:var(--muted)}
.sphere figcaption b{color:var(--pink);font-weight:500}
.proof{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:64px}
.proof div{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 22px}
.proof b{display:block;font:200 40px/1.05 var(--sans);letter-spacing:-.03em}.proof span{font-size:14px;color:var(--muted)}.proof a{color:var(--soft)}

section{padding:100px 0 20px}
h2{font:200 clamp(32px,4.2vw,52px)/1.08 var(--sans);letter-spacing:-.03em;margin:14px 0 18px}
h2 .l2{display:block;color:var(--muted)}
.sub{color:var(--soft);max-width:44em;font-size:17px;margin:0 0 40px}

.stat{display:grid;grid-template-columns:260px 1fr;gap:32px;padding:28px 0;border-top:1px solid var(--line)}
.stat:last-of-type{border-bottom:1px solid var(--line)}
.stat-l b{display:block;font:500 clamp(40px,5vw,60px)/1 var(--mono);letter-spacing:-.04em}
.stat-l span{display:block;font:500 11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--soft);margin-top:12px}
.stat-l small{display:block;color:var(--faint);font-size:13px;margin-top:4px}
.stat-r{display:flex;flex-direction:column;justify-content:center;gap:10px}
.bar{position:relative;height:40px;border-radius:8px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 8px),var(--card);border:1px solid var(--line);overflow:hidden}
.bar .fill{height:100%;overflow:hidden;border-radius:7px 0 0 7px;transform-origin:left;animation:grow 1.2s cubic-bezier(.2,.7,.2,1) both}
.bar .fill span{display:block;font:500 10.5px/13px var(--mono);padding:1px 8px;white-space:normal;word-break:break-all;height:100%;overflow:hidden}
.bar.gel .fill{background:linear-gradient(120deg,rgba(127,227,245,.22),rgba(180,156,255,.3),rgba(255,159,216,.22));box-shadow:inset 0 0 0 1px rgba(180,156,255,.45)}
.bar.gel .fill span{background:var(--holo);-webkit-background-clip:text;background-clip:text;color:transparent}
.bar.own .fill{background:rgba(255,255,255,.08)}.bar.own .fill span{display:none}
.bar em{position:absolute;right:10px;top:50%;transform:translateY(-50%);font:500 12px var(--mono);font-style:normal;color:var(--ink);background:rgba(0,0,0,.75);padding:3px 8px;border-radius:6px}
.bar.own em{color:var(--muted)}
@keyframes grow{from{transform:scaleX(0)}}
.legend{display:flex;gap:22px;margin-top:20px;font:400 12px var(--mono);color:var(--muted)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;vertical-align:-1px}
.legend .a{background:var(--holo)}.legend .b{background:rgba(255,255,255,.2)}
.note{font:400 12.5px var(--mono);color:var(--faint);margin-top:18px}

.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.cards.three{grid-template-columns:repeat(3,1fr)}.cards.two{grid-template-columns:repeat(2,1fr)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
.card .tag{font:500 10.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.card b.n{display:block;font:200 52px/1 var(--sans);letter-spacing:-.04em;margin:14px 0 4px}
.card .was{font:400 12px var(--mono);color:var(--faint);text-decoration:line-through}
.card p{margin:10px 0 0;color:var(--muted);font-size:14.5px}
.card.hot{border:1px solid transparent;background:linear-gradient(var(--card),var(--card)) padding-box,var(--holo) border-box}
.card.hot b.n{background:var(--holo);-webkit-background-clip:text;background-clip:text;color:transparent}

.quote{margin:100px 0 0;padding:56px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.quote p{font:200 clamp(26px,3.4vw,40px)/1.2 var(--sans);letter-spacing:-.025em;margin:0;max-width:24em}

.table{border:1px solid var(--line);border-radius:16px;overflow:auto;background:var(--card)}
table{width:100%;border-collapse:collapse;font-size:14.5px}
th{font:500 10.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);text-align:left;white-space:nowrap}
th,td{padding:14px 18px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}td.miss{color:var(--pink);font-size:18px}
.dim{color:var(--muted);font-size:14px}
.v{font:500 10px var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:3px 9px;border-radius:999px;border:1px solid currentColor}.v.real{color:var(--green)}.v.false{color:var(--pink)}.v.unclear{color:#f5c26b}

.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.step{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
.step code{font:500 13px var(--mono);color:var(--ink)}.step .ix{font:500 11px var(--mono);color:var(--violet)}.step p{color:var(--muted);font-size:14.5px;margin:8px 0 0}
.ladder{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px;font:500 12px var(--mono)}
.ladder span{padding:8px 14px;border-radius:999px;border:1px solid var(--line2);color:var(--soft)}.ladder i{font-style:normal;color:var(--faint);align-self:center}
.ladder span.on{border-color:transparent;background:linear-gradient(#000,#000) padding-box,var(--holo) border-box;color:var(--ink)}

.term{background:#050506;border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-top:40px}
.term .bar-top{display:flex;gap:6px;padding:12px 14px;border-bottom:1px solid var(--line)}.term .bar-top i{width:10px;height:10px;border-radius:50%;background:#222}
.term pre{margin:0;padding:18px 20px;font:400 13px/1.75 var(--mono);color:var(--soft);white-space:pre-wrap;overflow-wrap:anywhere}
.term .r{color:var(--pink);font-weight:500}.term .g{color:var(--green);font-weight:500}.term .c{color:var(--faint)}

.code{position:relative;background:#050506;border:1px solid var(--line);border-radius:16px;overflow:hidden}
.code .lbl{display:block;font:500 10.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:12px 18px;border-bottom:1px solid var(--line)}
.code pre{margin:0;padding:18px;font:400 13px/1.7 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--soft)}
.code .copy{position:absolute;top:6px;right:8px}.kw{color:var(--violet)}
footer{margin-top:110px;border-top:1px solid var(--line);padding:28px 0 48px;font:400 12px var(--mono);color:var(--faint)}
footer .wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}footer a{color:var(--soft)}

@media(max-width:900px){.wrap{padding:0 16px}.links a.hide{display:none}.hero{padding-top:52px}.hero-grid{grid-template-columns:1fr}.sphere{justify-self:center;max-width:340px}
 .proof,.cards,.cards.three,.steps{grid-template-columns:1fr 1fr}.stat{grid-template-columns:1fr;gap:16px}section{padding-top:72px}}
@media(max-width:560px){.proof,.cards,.cards.three,.cards.two,.steps{grid-template-columns:1fr}.bar em{font-size:11px}}
@media(prefers-reduced-motion:reduce){.ticker .run,.bar .fill{animation:none}}
</style>
<script defer data-domain="gel.flisk.si" src="https://flisk.sh/a.js"></script>
</head>
<body>
<script src="https://flisk.si/assets/bar.js" data-product="GEL" data-icon="gel" data-accent="#b49cff" data-siblings="Cilytics,Ranker" data-text="Five CI checks for AI-written pull requests." defer></script>
<div class="subnav"><div class="wrap"><a href="#bench">Bench</a><a href="#prs">Real PRs</a><a href="#eval">Eval</a><a href="#limits">Limits</a></div></div>
<div class="ticker" aria-hidden="true"><div class="run">${ticker}<i>/</i>${ticker}<i>/</i></div></div>

<main id="top">
<header class="hero"><div class="wrap">
 <div class="hero-grid">
  <div>
   <div class="kicker">GEL &middot; Guard, Eval, Loop &middot; bench ${esc(S.date)}</div>
   <h1>Your agent said all tests pass.<span class="l2 holo">${share}% of the time, a check was red.</span></h1>
   <p class="lead">Five plain checks for every pull request: leaked keys, unpinned actions, workflows with an open token, links to files that are gone, and a PR that says green while its checks say red. No model, no network, any language. Starts in report mode.</p>
   <div class="cta"><a class="pill white" href="#install">Install in two lines</a><a class="pill" href="#bench">See the bench &darr;</a></div>
  </div>
  <figure class="sphere" style="margin:0">
   <canvas id="sphere" width="880" height="880" role="img" aria-label="${C.withChecks} dots, one per real pull request with checks; ${C.flagged} are lit because the PR said green while a check was red"></canvas>
   <figcaption>${C.withChecks} real PRs. <b>${C.flagged} lit</b>: said green, check was red.</figcaption>
  </figure>
 </div>
 <div class="proof">
  <div><b>${covered.c}/${covered.n}</b><span>planted keys, pins, permissions and links caught in ${S.repos} public repos. <a href="#limits">${hard.c}/${hard.n}</a> of kinds it does not cover.</span></div>
  <div><b>${C.flaggedMerged}</b><span>of the ${C.flagged} green-but-red PRs were merged anyway</span></div>
  <div><b>${S.msP50} ms</b><span>median per repo, all five guards, ${fmt(S.files)} files in all</span></div>
 </div>
</div></header>

<section id="bench"><div class="wrap">
 <div class="kicker">01 &middot; Benchmark</div>
 <h2>Same ${S.repos} repos. Same commits.<span class="l2">One planted defect at a time.</span></h2>
 <p class="sub">Popular public repos in TypeScript, JavaScript, Python, Go and Rust, each pinned to one commit. A seeded random number picks the file. A defect counts only if GEL points at the exact file and line. The grey bar is how many of the ${S.repos} repos already run a tool in their own CI that would catch it.</p>
 ${statRows}
 <div class="legend"><span><i class="a"></i>GEL</span><span><i class="b"></i>their CI today</span></div>
 <p class="note">The bars are filled with the kind of text each guard reads. Fake keys only.</p>
</div></section>

<section id="prs"><div class="wrap">
 <div class="kicker">02 &middot; Real pull requests</div>
 <h2>${C.flagged} of ${C.withChecks} public PRs said green.<span class="l2">A check on the last commit was red.</span></h2>
 <p class="sub">Public PRs from ${esc(C.window.replace("..", " to "))} whose text says "all tests pass", "all checks pass" or "ready to merge". We read the checks on each PR's last commit and ran GEL's done-without-green guard. No common CI tool compares what a PR says with what its checks say.</p>
 <div class="cards">
  <div class="card"><span class="tag">PRs found</span><b class="n">${C.prs}</b><p>${C.withChecks} had checks to compare.</p></div>
  <div class="card hot"><span class="tag">Said green, was red</span><b class="n">${C.flagged}</b><p>${share}% of the PRs with checks.</p></div>
  <div class="card"><span class="tag">Merged anyway</span><b class="n">${C.flaggedMerged}</b><p>The red check was on the commit that landed.</p></div>
  <div class="card"><span class="tag">Only optional red</span><b class="n">${softOnly}</b><p>Coverage, visual diffs. GEL cannot see which checks are required, so they still count.</p></div>
 </div>
 <div class="term" aria-label="Example GEL run">
  <div class="bar-top"><i></i><i></i><i></i></div>
<pre><span class="c">$ npx github:flisk-sh/gel run --base main</span>
lane C  .github/workflows/release.yml  <span class="c"># a person approves this one</span>
<span class="r">FAIL</span>  secret-scan         src/config.ts:12  Stripe live key, rotate it then remove it
<span class="r">FAIL</span>  pinned-actions      release.yml:31    docker/build-push-action@master
<span class="g">pass</span>  dead-links
<span class="r">FAIL</span>  done-without-green  PR says "all tests pass"; test (ubuntu) is failure
<span class="c">mode report: recorded in gel-record.jsonl, not blocked</span></pre>
 </div>
</div></section>

<div class="wrap"><div class="quote"><p>The first bench run found <span class="holo">our own false alarms</span> before it found anyone else's bugs. Every one became a test case, then a fix.</p></div></div>

<section><div class="wrap">
 <div class="kicker">03 &middot; False alarms</div>
 <h2>On clean code,<span class="l2">a guard should stay quiet.</span></h2>
 <p class="sub">The same ${S.repos} repos, untouched. They do not leak keys, so any secret GEL finds is a false alarm. Every dead-link finding was checked by hand.</p>
 <div class="cards">
  <div class="card hot"><span class="tag">Secret findings</span><b class="n">${S.clean["secret-scan"].findings}</b><span class="was">${V1.summary.clean["secret-scan"].findings} in the first run</span><p>Doc placeholders, sample TLS keys under <code>examples/</code> and tests in <code>t/unit</code> are now skipped.</p></div>
  <div class="card"><span class="tag">Dead-link findings</span><b class="n">${S.clean["dead-links"].findings}</b><span class="was">${V1.summary.clean["dead-links"].findings} in the first run</span><p>${real} are real broken links. The rest point at files a docs build makes, so dead-links stays report-only.</p></div>
  <div class="card"><span class="tag">Open token scope</span><b class="n">${S.clean["workflow-permissions"].reposWithFindings}/${S.repos}</b><p>repos have a workflow job with no <code>permissions</code> key, ${S.clean["workflow-permissions"].findings} in all. We read ${permN} by hand: ${permReal} real.</p></div>
  <div class="card"><span class="tag">Tag-pinned actions</span><b class="n">${S.clean["pinned-actions"].reposWithFindings}/${S.repos}</b><p>repos use another org's action by tag today, ${fmt(S.clean["pinned-actions"].findings)} uses. Not a false alarm: a tag can move under you.</p></div>
 </div>
 <div class="table" style="margin-top:20px"><table>
  <thead><tr><th>Repo</th><th>Workflow</th><th>Verdict</th><th>Why</th></tr></thead>
  <tbody>${permTriage}</tbody>
 </table></div>
 <p class="note">${esc(T["workflow-permissions-about"])}</p>
 <div class="table" style="margin-top:20px"><table>
  <thead><tr><th>Repo</th><th class="num">Links</th><th>Verdict</th><th>Why</th></tr></thead>
  <tbody>${triage}</tbody>
 </table></div>
</div></section>

<section id="how"><div class="wrap">
 <div class="kicker">04 &middot; How it works</div>
 <h2>Five guards. Three lanes.<span class="l2">One record per run.</span></h2>
 <p class="sub">Each guard is a small Node file with labelled good and bad cases. GEL's own CI fails if a guard misses a bad case or flags a good one.</p>
 <div class="steps">
  <div class="step"><span class="ix">guard 1</span><br><code>secret-scan</code><p>AWS, GitHub, Anthropic, OpenAI, Stripe live and Slack keys, and private key blocks. Skips tests, sample keys and placeholders.</p></div>
  <div class="step"><span class="ix">guard 2</span><br><code>pinned-actions</code><p>Another org's action must be pinned to a commit SHA. Your org and <code>trusted_owners</code> may use tags.</p></div>
  <div class="step"><span class="ix">guard 3</span><br><code>workflow-permissions</code><p>Every workflow job gets a token scope, never <code>write-all</code>, and <code>pull_request_target</code> never checks out the fork's code.</p></div>
  <div class="step"><span class="ix">guard 4</span><br><code>dead-links</code><p>Links to files that are not in the repo. Knows doc sites without <code>.md</code>, Vite <code>public/</code> and symlinked READMEs.</p></div>
  <div class="step"><span class="ix">guard 5</span><br><code>done-without-green</code><p>The PR says "all checks pass" and a check on its last commit failed, timed out or was cancelled.</p></div>
  <div class="step"><span class="ix">lanes</span><br><code>A &middot; B &middot; C</code><p>Picked from the changed files, never a label. Docs and tests, product code, and workflows/auth/payment/deploy where a person approves.</p></div>
  <div class="step"><span class="ix">loop</span><br><code>gel-record.jsonl</code><p>Every run writes one JSON line. Promote a guard to block once the record shows it was right.</p></div>
 </div>
 <div class="ladder"><span class="on">report</span><i>&rarr;</i><span>block one guard</span><i>&rarr;</i><span>block all</span></div>
</div></section>

<section id="eval"><div class="wrap">
 <div class="kicker">05 &middot; Eval and loop</div>
 <h2>Who checks the checker?<span class="l2">The bench, every night.</span></h2>
 <p class="sub">A guard is promoted only on evidence, and GEL never changes your policy by itself. It writes advice; a person edits <code>gel.json</code>, and that edit is lane C.</p>
 <div class="steps">
  <div class="step"><span class="ix">nightly</span><br><code>meta-eval</code><p>Every guard against its labelled cases, then the bench on the ${S.repos} pinned repos. Fails if a guard catches fewer planted defects or raises more findings on clean code than <code>bench/baseline.json</code>.</p></div>
  <div class="step"><span class="ix">per guard</span><br><code>gel metrics</code><p>Reads your <code>gel-record.jsonl</code> files and your <code>gel-labels.json</code>: runs, fail rate, precision, first-pass share, p50 and p95 time.</p></div>
  <div class="step"><span class="ix">flywheel</span><br><code>promote / demote</code><p>Promote after 20 runs, 5 labelled findings and 95% precision. Demote a blocking guard on one false alarm. Each false alarm is listed as a hard case to add to <code>cases.json</code>.</p></div>
  <div class="step"><span class="ix">before release</span><br><code>release-gate</code><p>A shared workflow in <a href="https://github.com/flisk-sh/.github">flisk-sh/.github</a>: waits for every check on the release commit and fails on a red or missing required one.</p></div>
  <div class="step"><span class="ix">after deploy</span><br><code>deploy-health</code><p>Curls the deployed URL until it answers with the expected status and text, or fails the release.</p></div>
  <div class="step"><span class="ix">org view</span><br><a href="https://cilytics.flisk.si/"><code>Cilytics</code></a><p>The org CI dashboard (<a href="https://github.com/flisk-sh/cilytics">flisk-sh/cilytics</a>, for any org or user) reads the latest <code>gel-record</code> of each repo: which repos run GEL, findings, blocks.</p></div>
 </div>
</div></section>

<section id="limits"><div class="wrap">
 <div class="kicker">06 &middot; Limits</div>
 <h2>What GEL misses.<span class="l2">Measured the same way.</span></h2>
 <p class="sub">We planted these too, so the recall above is not 100% by choice of test.</p>
 <div class="table"><table>
  <thead><tr><th>Planted</th><th class="num">Caught</th><th>Why</th></tr></thead>
  <tbody>${misses}
   <tr><td>Org default token setting</td><td class="num">&ndash;</td><td class="dim">workflow-permissions reads files only. If the org default token is read-only, a job without a permissions key is safer than GEL says.</td></tr>
   <tr><td>Protection outside workflows</td><td class="num">&ndash;</td><td class="dim">"Their CI today" reads workflow files only. Push protection, pre-commit hooks and branch rules are not seen, so it is a lower bound.</td></tr>
  </tbody>
 </table></div>
</div></section>

<section><div class="wrap">
 <div class="kicker">07 &middot; Speed</div>
 <h2>Fast enough<span class="l2">to run on every push.</span></h2>
 <div class="cards three">
  <div class="card"><span class="tag">Median per repo</span><b class="n">${S.msP50} ms</b><p>All five guards on every tracked file, on a laptop.</p></div>
  <div class="card"><span class="tag">95th percentile</span><b class="n">${S.msP95} ms</b><p>The slowest repos in the set. The largest has ${fmt(Math.max(...R.repos.map((x) => x.files)))} files.</p></div>
  <div class="card"><span class="tag">Whole CI job</span><b class="n">${ciMedian} s</b><p>Median wall time of ${CI.runs.length} pilot runs, queue to uploaded record.</p></div>
 </div>
</div></section>

<section id="install"><div class="wrap">
 <div class="kicker">08 &middot; Install</div>
 <h2>Two lines.<span class="l2">Then it runs on every PR.</span></h2>
 <p class="sub">Starts in report mode. Add a <code>gel.json</code> when you want a guard to block.</p>
 <div class="cards two">
  <div class="code"><span class="lbl">As a step</span><button class="pill sm copy" data-copy="s1">Copy</button><pre id="s1">- <span class="kw">uses</span>: actions/checkout@v4
  <span class="kw">with</span>: { fetch-depth: 0 }
- <span class="kw">uses</span>: flisk-sh/gel@v1</pre></div>
  <div class="code"><span class="lbl">As a job</span><button class="pill sm copy" data-copy="s2">Copy</button><pre id="s2"><span class="kw">jobs</span>:
  <span class="kw">gel</span>:
    <span class="kw">permissions</span>: { contents: read, checks: read, pull-requests: read }
    <span class="kw">uses</span>: flisk-sh/gel/.github/workflows/gel.yml@v1</pre></div>
  <div class="code"><span class="lbl">On your laptop</span><button class="pill sm copy" data-copy="s3">Copy</button><pre id="s3">npx github:flisk-sh/gel run --root .</pre></div>
  <div class="code"><span class="lbl">gel.json</span><button class="pill sm copy" data-copy="s4">Copy</button><pre id="s4">{
  "mode": "report",
  "guards": { "secret-scan": "block" },
  "trusted_owners": ["your-org"]
}</pre></div>
 </div>
 <p class="note">Run the bench yourself: <code>node bench/run.mjs &amp;&amp; node bench/claims.mjs</code>. Method: <a href="https://github.com/flisk-sh/gel/blob/main/bench/README.md">bench/README.md</a>.</p>
</div></section>
</main>

<footer><div class="wrap"><span>GEL &middot; MIT &middot; bench run ${esc(S.date)}</span><span><a href="https://github.com/flisk-sh/gel">github.com/flisk-sh/gel</a> &middot; <a href="https://flisk.si">flisk.si</a></span></div></footer>
<script>
document.querySelectorAll("[data-copy]").forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(document.getElementById(b.dataset.copy).innerText);b.textContent="Copied";setTimeout(()=>b.textContent="Copy",1200)}catch{}});
(()=>{const cv=document.getElementById("sphere"),x=cv.getContext("2d"),N=${C.withChecks},F=${C.flagged},W=cv.width,R=W*.4;
 const still=matchMedia("(prefers-reduced-motion: reduce)").matches,pts=[],ga=Math.PI*(3-Math.sqrt(5));
 for(let i=0;i<N;i++){const y=1-(i/(N-1))*2,r=Math.sqrt(1-y*y),t=ga*i;pts.push([Math.cos(t)*r,y,Math.sin(t)*r,(i*7919)%N<F])}
 let a=.6;function draw(){x.clearRect(0,0,W,W);const ca=Math.cos(a),sa=Math.sin(a),tl=.35,ct=Math.cos(tl),st=Math.sin(tl);
  const pr=pts.map(([px,py,pz,h])=>{const X=px*ca-pz*sa,Z=px*sa+pz*ca,Y=py*ct-Z*st,Z2=py*st+Z*ct;return[X,Y,Z2,h]}).sort((p,q)=>p[2]-q[2]);
  for(const[X,Y,Z,h]of pr){const d=(Z+1)/2,sx=W/2+X*R,sy=W/2+Y*R;
   if(h){x.shadowColor="rgba(255,159,216,.9)";x.shadowBlur=18*d;x.fillStyle="rgba(255,"+(140+60*d|0)+",216,"+(.35+.65*d)+")";x.beginPath();x.arc(sx,sy,3+5*d,0,7);x.fill();x.shadowBlur=0}
   else{x.fillStyle="rgba(200,205,255,"+(.08+.4*d)+")";x.beginPath();x.arc(sx,sy,1.4+2.4*d,0,7);x.fill()}}
  if(!still){a+=.0035;requestAnimationFrame(draw)}}
 draw()})();
</script>
</body>
</html>
`;
mkdirSync(join(here, "public"), { recursive: true });
writeFileSync(join(here, "public", "index.html"), html);
console.log(`site/public/index.html: ${html.length} bytes`);
