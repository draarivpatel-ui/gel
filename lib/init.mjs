// gel init: put GEL in a repo in one step. Writes the pinned caller workflow and docs/gel.json with every guard
// set to "block" (an error, not a report), then scans the tree so the first run already shows what would fail.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GUARD_NAMES } from "./guards.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const template = (f) => readFileSync(join(here, "..", "templates", f), "utf8");

// Guards that need a live URL or a browser, or a declared metric the repo does not have yet, cannot judge a bare
// checkout. They stay in the config as "report" so the repo can promote them once it has declared what they check.
export const NEEDS_DECLARATION = ["five-second-test", "click-map", "input-in-viewport", "north-star", "product-brief", "ice-score"];

export function initConfig({ mode = "block", strict = false } = {}) {
  const level = mode === "report" ? "report" : "block";
  const guards = Object.fromEntries(GUARD_NAMES.map((g) => [g, !strict && NEEDS_DECLARATION.includes(g) ? "report" : level]));
  return { mode: level, guards };
}

// Returns the files init would write, and which already exist (those are kept unless force).
export function plan(root, opts = {}) {
  const files = [
    { path: ".github/workflows/gel.yml", body: template("caller.yml") },
    { path: "docs/gel.json", body: JSON.stringify(initConfig(opts), null, 2) + "\n" },
  ];
  return files.map((f) => ({ ...f, exists: existsSync(join(root, f.path)) }));
}

export function apply(root, files, { force = false } = {}) {
  const done = [];
  for (const f of files) {
    if (f.exists && !force) { done.push({ path: f.path, action: "kept" }); continue; }
    mkdirSync(dirname(join(root, f.path)), { recursive: true });
    writeFileSync(join(root, f.path), f.body);
    done.push({ path: f.path, action: f.exists ? "replaced" : "created" });
  }
  return done;
}
