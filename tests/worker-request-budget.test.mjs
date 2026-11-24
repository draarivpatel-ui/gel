import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../guards/worker-request-budget/index.mjs";

const NOW = "2026-11-24T10:00:00Z";
const check = (files) => run({ cfg: {}, files: Object.keys(files), read: (f) => files[f] ?? null, ctx: { now: NOW } });

test("an /mcp mention in a comment is not an MCP server", () => {
  const r = check({ "wrangler.toml": "name='x'\n", "src/guard.mjs": '// A source file that routes "/mcp" is live\n/* "/mcp" */\nexport const x = 1\n' });
  assert.equal(r.pass, true);
});
test("a real /mcp route next to comments still needs a measurement", () => {
  const r = check({ "wrangler.toml": "name='x'\n", "src/app.ts": '// the endpoint\napp.post("/mcp", h) // handshake\n' });
  assert.equal(r.pass, false);
  assert.match(r.findings[0].message, /bench\/worker-usage\.json/);
});
test("a URL with // inside a string does not hide the route", () => {
  const r = check({ "wrangler.toml": "name='x'\n", "src/app.ts": 'const u = "https://x.test"; app.post("/mcp", h)\n' });
  assert.equal(r.pass, false);
});
test("a missing wrangler config means no Worker, so no measurement", () => {
  assert.equal(check({ "src/app.ts": 'app.post("/mcp", h)\n' }).pass, true);
});
