// gel init through the real CLI: writes the caller and a config where every guard that can judge a bare checkout blocks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GUARD_NAMES } from "../lib/guards.mjs";
import { NEEDS_DECLARATION } from "../lib/init.mjs";

const gel = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "gel.mjs");
const repo = () => {
  const root = mkdtempSync(join(tmpdir(), "gel-init-"));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/ci.yml"), "on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
};
const init = (root, ...a) => spawnSync(process.execPath, [gel, "init", "--root", root, ...a], { encoding: "utf8" });

test("init writes the caller and a config with every guard blocking", () => {
  const root = repo();
  const r = init(root);
  assert.ok(existsSync(join(root, ".github/workflows/gel.yml")));
  const cfg = JSON.parse(readFileSync(join(root, "docs/gel.json"), "utf8"));
  assert.equal(cfg.mode, "block");
  for (const g of GUARD_NAMES) assert.equal(cfg.guards[g], NEEDS_DECLARATION.includes(g) ? "report" : "block", g);
  assert.equal(r.status, 1, "an unpinned action is a blocking finding, so init exits 1");
  assert.match(r.stdout, /BLOCK {2}pinned-actions/);
});

test("--strict blocks every guard, with no exception", () => {
  const root = repo();
  init(root, "--strict");
  const cfg = JSON.parse(readFileSync(join(root, "docs/gel.json"), "utf8"));
  for (const g of GUARD_NAMES) assert.equal(cfg.guards[g], "block", g);
});

test("init keeps an existing config unless --force, and --dry-run writes nothing", () => {
  const root = repo();
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/gel.json"), '{"mode":"block","guards":{}}\n');
  init(root);
  assert.equal(readFileSync(join(root, "docs/gel.json"), "utf8"), '{"mode":"block","guards":{}}\n');
  const fresh = repo();
  init(fresh, "--dry-run");
  assert.equal(existsSync(join(fresh, "docs/gel.json")), false);
});
