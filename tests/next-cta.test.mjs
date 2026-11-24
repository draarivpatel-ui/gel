import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = `@property --a{syntax:"<angle>";inherits:false;initial-value:0deg}
.next-cta{border:2px solid transparent;background:conic-gradient(from var(--a),var(--c1),var(--c2),var(--c1)) border-box;animation:next-cta-spin 3s linear infinite}
@keyframes next-cta-spin{to{--a:360deg}}
@media (prefers-reduced-motion:reduce){.next-cta{animation:none}}`;
const page = (body, head = `<style>${CSS}</style>`) => `<html><head>${head}</head><body>${body}</body></html>`;
const GOOD = page('<h1>Run your AI</h1><p>Free key.</p><a class="b next-cta" data-next-cta href="#k">Get a free API key</a><a href="#x">Docs</a>');

async function judge(files, cfg = {}) {
  const m = await import("../guards/next-cta/index.mjs");
  return m.run({ files: Object.keys(files), cfg, read: (f) => files[f] });
}
const msgs = (r) => r.findings.map((f) => f.message).join("\n");

test("a page with one marked, styled first button passes", async () => {
  assert.equal((await judge({ "index.html": GOOD })).pass, true);
});
test("pages that do not exist are skipped", async () => {
  assert.equal((await judge({})).pass, true);
});
test("a page with no <h1> stays silent (five-second-test reports it)", async () => {
  assert.equal((await judge({ "index.html": page("<a href='#'>Go</a>") })).pass, true);
});
test("rule 1: no element carries data-next-cta", async () => {
  const r = await judge({ "index.html": page('<h1>X</h1><a class="next-cta" href="#">Get a free key</a>') });
  assert.equal(r.pass, false);
  assert.match(msgs(r), /no element has data-next-cta/);
});
test("rule 2: more than one element carries data-next-cta", async () => {
  const r = await judge({ "index.html": page('<h1>X</h1><a class="next-cta" data-next-cta href="#">A</a><a class="next-cta" data-next-cta href="#">B</a>') });
  assert.equal(r.pass, false);
  assert.match(msgs(r), /2 elements have data-next-cta/);
});
test("rule 3: the marked element lacks the class", async () => {
  const r = await judge({ "index.html": page('<h1>X</h1><a class="b" data-next-cta href="#">A</a>') });
  assert.equal(r.pass, false);
  assert.match(msgs(r), /lacks the class "next-cta"/);
});
test("rule 3: a configured class is honoured", async () => {
  const css = CSS.replaceAll("next-cta", "spin-me");
  const html = page('<h1>X</h1><a class="spin-me" data-next-cta href="#">A</a>', `<style>${css}</style>`);
  assert.equal((await judge({ "index.html": html }, { next_cta: { class: "spin-me" } })).pass, true);
});
test("rule 4: the marked element is not the first control after the <h1>", async () => {
  const r = await judge({ "index.html": page('<h1>X</h1><a href="#">Docs</a><a class="next-cta" data-next-cta href="#">A</a>') });
  assert.equal(r.pass, false);
  assert.match(msgs(r), /not the first link, button or input/);
});
test("rule 4: a first <input> counts as the control", async () => {
  const ok = page('<h1>X</h1><input class="next-cta" data-next-cta name="q"><a href="#">Docs</a>');
  assert.equal((await judge({ "index.html": ok })).pass, true);
  const bad = page('<h1>X</h1><input name="q"><a class="next-cta" data-next-cta href="#">A</a>');
  assert.equal((await judge({ "index.html": bad })).pass, false);
});
test("rule 5: no CSS for the class", async () => {
  const r = await judge({ "index.html": page('<h1>X</h1><a class="next-cta" data-next-cta href="#">A</a>', "") });
  assert.equal(r.pass, false);
  assert.match(msgs(r), /defines no CSS/);
});
test("rule 5: CSS without an animation, or without prefers-reduced-motion, fails", async () => {
  const body = '<h1>X</h1><a class="next-cta" data-next-cta href="#">A</a>';
  const still = page(body, "<style>.next-cta{border:1px solid red}@media (prefers-reduced-motion:reduce){.next-cta{color:red}}</style>");
  assert.match(msgs(await judge({ "index.html": still })), /animation/);
  const noMotion = page(body, "<style>.next-cta{animation:spin 3s infinite}</style>");
  assert.match(msgs(await judge({ "index.html": noMotion })), /prefers-reduced-motion/);
});
test("rule 5: an animation elsewhere, or animation:none on the class, does not count", async () => {
  const body = '<h1>X</h1><a class="next-cta" data-next-cta href="#">A</a>';
  const other = page(body, "<style>.next-cta{border:1px solid red}.pulse{animation:p 1s infinite}@media (prefers-reduced-motion:reduce){.next-cta{animation:none}}</style>");
  assert.match(msgs(await judge({ "index.html": other })), /no animation/);
  const none = page(body, "<style>.next-cta{animation:none}@media (prefers-reduced-motion:reduce){.next-cta{animation:none}}</style>");
  assert.match(msgs(await judge({ "index.html": none })), /no animation/);
  const noFallback = page(body, "<style>.next-cta{animation:s 1s infinite}@media (prefers-reduced-motion:reduce){.pulse{animation:none}}</style>");
  assert.match(msgs(await judge({ "index.html": noFallback })), /prefers-reduced-motion/);
});
test("rule 5: a linked stylesheet in the repo satisfies the CSS rule", async () => {
  const html = page('<h1>X</h1><a class="next-cta" data-next-cta href="#">A</a>', '<link rel="stylesheet" href="css/app.css">');
  assert.equal((await judge({ "index.html": html, "css/app.css": CSS })).pass, true);
  assert.equal((await judge({ "index.html": html })).pass, false);
});
test("markup inside comments and scripts is ignored", async () => {
  const html = page('<!-- <a data-next-cta> --><h1>X</h1><script>var s="<a data-next-cta>"</script><a class="next-cta" data-next-cta href="#">A</a>');
  assert.equal((await judge({ "index.html": html })).pass, true);
});
test("rendered mode judges the DOM a browser drew (rules 1-4)", async () => {
  const cfg = { next_cta: { rendered: {} } };
  const run = (html) => judge({ "bench/five-second.json": JSON.stringify({ entries: [{ page: "p", html }] }) }, cfg);
  assert.equal((await run(GOOD)).pass, true);
  const r = await run(page('<h1>X</h1><a href="#">A</a>'));
  assert.equal(r.pass, false);
  assert.match(msgs(r), /rendered/);
});
test("the guard is registered, in the template, docs, README and the CSS recipe", () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  assert.match(read("lib/guards.mjs"), /"next-cta"/);
  assert.match(read("templates/gel.json"), /"next-cta"/);
  assert.match(read("docs/guards.md"), /`next-cta`/);
  assert.match(read("README.md"), /`next-cta`/);
  assert.match(read("docs/next-cta.css"), /prefers-reduced-motion/);
  assert.match(read("docs/guards.md"), /next-cta\.css/);
});
