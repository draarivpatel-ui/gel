// mode "block" is the level of every guard the file does not list. Before, an unlisted guard stayed "report",
// so under mode "block" a guard added in a later GEL version (or never listed) only warned and CI stayed green.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../lib/config.mjs";
import { GUARD_NAMES } from "../lib/guards.mjs";

const repo = (cfg) => {
  const root = mkdtempSync(join(tmpdir(), "gel-mode-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "gel.json"), JSON.stringify(cfg));
  return root;
};

test("mode block: a guard the file does not list blocks", () => {
  const cfg = loadConfig(repo({ mode: "block", guards: { "secret-scan": "block" } }));
  for (const g of GUARD_NAMES) assert.equal(cfg.guards[g], "block", g);
});

test("mode block: a guard listed as report or off keeps that level", () => {
  const cfg = loadConfig(repo({ mode: "block", guards: { "dead-links": "report", "ice-score": "off" } }));
  assert.equal(cfg.guards["dead-links"], "report");
  assert.equal(cfg.guards["ice-score"], "off");
  assert.equal(cfg.guards["frozen-install"], "block");
});

test("mode report and no mode: unlisted guards stay report", () => {
  for (const c of [{ mode: "report" }, {}]) {
    const cfg = loadConfig(repo(c));
    for (const g of GUARD_NAMES) assert.equal(cfg.guards[g], "report", g);
  }
});
