// repo-health, status-declared and dependabot-config run in a browser too (Cilytics): no node imports, and they
// judge only what `files`, `cfg`, `ctx` and `read` give them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const GUARDS = ["repo-health", "status-declared", "dependabot-config", "gitattributes-eol"];

for (const g of GUARDS) {
  test(`${g} imports nothing from node`, () => {
    const src = readFileSync(new URL(`../guards/${g}/index.mjs`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\bfrom\s+["']node:/);
    assert.doesNotMatch(src, /\brequire\(/);
  });
}

test("repo-health passes a repo with every file and a real README line", async () => {
  const m = await import("../guards/repo-health/index.mjs");
  const files = { "README.md": "# x\n\nThis repo holds the thing that does the useful work.\n", LICENSE: "MIT", "SECURITY.md": "a", "CONTRIBUTING.md": "a", CODEOWNERS: "* @a" };
  assert.equal(m.run({ files: Object.keys(files), cfg: {}, read: (f) => files[f] ?? null }).pass, true);
});

test("status-declared skips the age check without ctx.lastCommitAt", async () => {
  const m = await import("../guards/status-declared/index.mjs");
  assert.equal(m.run({ cfg: { status: "active", owner: "@a/b" }, ctx: {} }).pass, true);
  assert.equal(m.run({ cfg: { status: "active", owner: "@a/b" } }).pass, true);
});

test("dependabot-config skips an unreadable dependabot file instead of guessing", async () => {
  const m = await import("../guards/dependabot-config/index.mjs");
  const files = ["package.json", ".github/dependabot.yml"];
  assert.equal(m.run({ files, cfg: {}, read: () => null }).pass, true);
});

for (const g of ["tests-with-change", "adr-required"]) {
  test(`${g} imports nothing from node and passes without a base`, async () => {
    const src = readFileSync(new URL(`../guards/${g}/index.mjs`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\bfrom\s+["']node:/);
    const m = await import(`../guards/${g}/index.mjs`);
    assert.equal(m.run({ changes: null, cfg: { adr_required: { paths: ["**"] } }, read: () => null }).pass, true);
  });
}

test("tests-with-change ignores the PR title: a test file is what counts", async () => {
  const m = await import("../guards/tests-with-change/index.mjs");
  const src = { status: "M", file: "src/a.ts" };
  assert.equal(m.run({ changes: [src], cfg: {}, title: "docs: typo" }).pass, false);
  assert.equal(m.run({ changes: [src, { status: "A", file: "src/a.test.ts" }], cfg: {} }).pass, true);
});

test("adr-required needs a NEW file with the sections, and only where paths are configured", async () => {
  const m = await import("../guards/adr-required/index.mjs");
  const cfg = { adr_required: { paths: ["schemas/**"] } };
  const code = { status: "M", file: "schemas/a.json" };
  const adr = { status: "A", file: "docs/adr/0003-x.md" };
  const full = "# X\n## Context\n## Decision\n## Alternatives\n## Consequences\n";
  assert.equal(m.run({ changes: [code], cfg, read: () => null }).pass, false);
  assert.equal(m.run({ changes: [code, adr], cfg, read: () => full }).pass, true);
  assert.equal(m.run({ changes: [code, adr], cfg, read: () => "# X\n## Context\n" }).pass, false);
  assert.equal(m.run({ changes: [code], cfg: {}, read: () => null }).pass, true);
});

test("gitattributes-eol fails text=auto and passes eol=lf, -text and binary", async () => {
  const m = await import("../guards/gitattributes-eol/index.mjs");
  const judge = (body) => m.run({ files: [".gitattributes"], cfg: {}, read: () => body });
  assert.equal(judge("* text=auto\n").pass, false);
  assert.equal(judge("*.ps1 text eol=crlf\n").pass, false);
  assert.equal(judge("* text=auto eol=lf\n*.bat -text\n*.png binary\n").pass, true);
});

test("cta-label judges the first button under the h1, offline and rendered", async () => {
  const m = await import("../guards/cta-label/index.mjs");
  const page = (btn) => `<html><body><h1>Chat</h1><p>Ask anything.</p>${btn}</body></html>`;
  const judge = (btn, cfg = {}) => m.run({ files: ["index.html"], cfg, read: () => page(btn) }).pass;
  assert.equal(judge('<a href="#">Get a free API key</a>'), true);
  assert.equal(judge('<a href="#">Start free with GitHub</a>'), true);
  assert.equal(judge('<a href="#">Sign in</a>'), false);
  assert.equal(judge('<a href="#">Sign in with GitHub</a>'), false);
  assert.equal(judge(""), true);
  const rendered = { five_second: { rendered: {} } };
  const run = (html) => m.run({ files: ["bench/five-second.json"], cfg: rendered, read: () => JSON.stringify({ entries: [{ page: "p", html }] }) });
  assert.equal(run(page("<button>Sign in with GitHub</button>")).pass, false);
  assert.equal(run(page("<button>Start free with GitHub</button>")).pass, true);
});
