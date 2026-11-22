import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { measure } from "../lib/five-second-render.mjs";
import { run } from "../guards/five-second-test/index.mjs";

// The rendered five-second test must judge what a visitor sees on a phone, not what is in the DOM.
const hasChrome = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].some((c) => c && existsSync(c))
  || ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].some((c) => spawnSync("which", [c]).status === 0);
const dir = mkdtempSync(join(tmpdir(), "gel-5s-test-"));
const GOOD = `<h1>Run your app on your laptop</h1><p>One command starts every service. Free.</p><a href="#s">Get started</a>`;
const JARGON = `<h2>The orchestration control plane for serverless pods</h2><p>Idempotent middleware for multi-tenant inference endpoints.</p>`;
const page = (name, body) => { const f = join(dir, `${name}.html`); writeFileSync(f, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`); return f; };
const judge = (e) => run({ root: dir, files: ["r.json"], cfg: { five_second: { pages: [], rendered: { result: "r.json" } } }, read: () => JSON.stringify({ measuredAt: new Date().toISOString(), entries: [e] }) });
const opts = { skip: hasChrome ? false : "no Chrome", timeout: 60000 };

test("a plain good page passes", opts, async () => {
  const v = judge(await measure({ file: page("good", GOOD) }));
  assert.equal(v.pass, true, JSON.stringify(v.findings));
});

test("a good headline pushed off the screen does not count: the visible page has no h1", opts, async () => {
  const e = await measure({ file: page("offscreen", `<div style="position:absolute;left:-9999px">${GOOD}</div>${JARGON}`) });
  assert.equal(e.html, "");
  assert.match(judge(e).findings.map((f) => f.message).join("\n"), /no <h1>/);
});

test("hidden, transparent and screen-reader-only headlines do not count", opts, async () => {
  for (const style of ["display:none", "visibility:hidden", "opacity:0", "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)"]) {
    const e = await measure({ file: page("hidden", `<div style="${style}">${GOOD}</div>${JARGON}`) });
    assert.equal(e.html, "", style);
  }
});

test("a hidden button under a good headline does not count", opts, async () => {
  const e = await measure({ file: page("nobutton", `<h1>Run your app on your laptop</h1><p>One command starts every service. Free.</p><a href="#s" style="display:none">Get started</a>`) });
  assert.match(judge(e).findings.map((f) => f.message).join("\n"), /no link or button/);
});

test("a headline under a cookie wall is reported as covered", opts, async () => {
  const e = await measure({ file: page("wall", `<div class="consent" style="position:fixed;inset:0;background:#fff;z-index:9">We value your privacy</div>${GOOD}`) });
  assert.equal(e.covered, "div.consent");
  assert.match(judge(e).findings.map((f) => f.message).join("\n"), /covered by div\.consent/);
});

test("display:contents wrappers (no box of their own) keep their headline", opts, async () => {
  const e = await measure({ file: page("contents", `<section style="overflow:hidden"><div style="display:contents"><div style="display:contents">${GOOD}</div></div></section>`) });
  assert.equal(judge(e).pass, true, JSON.stringify(judge(e).findings));
});

test("the guard fails a measurement that says the headline is covered (no browser needed)", () => {
  const v = judge({ page: "https://x.test", html: GOOD, covered: "div.popup" });
  assert.equal(v.pass, false);
  assert.match(v.findings[0].message, /covered by div\.popup/);
});
