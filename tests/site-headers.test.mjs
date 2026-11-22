// gel.flisk.si is a static-assets Worker (gel-site), so its security headers live in site/public/_headers. Cloudflare
// applies the `/*` block to every response: the home page, assets and the 404 page.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const file = new URL("../site/public/_headers", import.meta.url);
const text = readFileSync(file, "utf8");

// Parse into { "/path": { header-lowercase: [values] } }.
const rules = {};
let cur = null;
for (const raw of text.split("\n")) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  if (!/^\s/.test(raw)) { cur = rules[raw.trim()] = {}; continue; }
  const i = raw.indexOf(":");
  const k = raw.slice(0, i).trim().toLowerCase();
  (cur[k] ||= []).push(raw.slice(i + 1).trim());
}

test("a catch-all rule covers every path, so 200s and the 404 page both get the headers", () => {
  assert.ok(rules["/*"], "no /* rule");
});

test("the baseline security headers are set once each", () => {
  const want = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
  for (const [k, v] of Object.entries(want)) assert.deepEqual(rules["/*"][k], [v], k);
});

test("the CSP sets a default-src and restricts framing", () => {
  const csp = rules["/*"]["content-security-policy"];
  assert.equal(csp.length, 1);
  assert.match(csp[0], /^default-src 'self';/);
  assert.match(csp[0], /frame-ancestors 'self' https:\/\/analytics\.flisk\.si/);
  assert.match(csp[0], /object-src 'none'/);
});

test("the site has a 404 page setting and the _headers file ships with the assets", () => {
  assert.ok(existsSync(new URL("../site/public/index.html", import.meta.url)));
  assert.match(readFileSync(new URL("../site/wrangler.toml", import.meta.url), "utf8"), /not_found_handling = "404-page"/);
});
