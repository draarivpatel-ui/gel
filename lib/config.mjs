import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GUARD_NAMES } from "./guards.mjs";

// mode "report": nothing blocks. A guard is promoted to "block" in gel.json by a person, with the records as proof.
export const DEFAULTS = { mode: "report", guards: Object.fromEntries(GUARD_NAMES.map((g) => [g, "report"])), laneC: null, laneA: null, ignore: [], trusted_owners: [] };

export function loadConfig(root) {
  // GEL lives in docs/ only, so a repo root stays clean. A root gel.json is ignored, and says so: guards it
  // configured (a blocking north star, a minLane) would otherwise go quiet without a word.
  const p = join(root, "docs", "gel.json");
  if (!existsSync(p) && existsSync(join(root, "gel.json"))) console.error("gel: ./gel.json is ignored; GEL reads docs/gel.json only. Move it: git mv gel.json docs/gel.json");
  const user = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  // A guard the file does not list takes the top-level mode: "block" blocks it, anything else leaves it advisory.
  // Before, an unlisted guard stayed "report" even under mode "block", so a new guard only warned until someone noticed.
  const unlisted = user.mode === "block" ? "block" : "report";
  const cfg = { ...DEFAULTS, ...user, guards: { ...Object.fromEntries(GUARD_NAMES.map((g) => [g, unlisted])), ...(user.guards ?? {}) } };
  // docs/gel.json is optional. Guards that only check what a repo declared in it (status-declared, north-star) have
  // nothing to check in a repo that never opted in, so they read this flag and stay quiet instead of asking for the file.
  if (!existsSync(p)) cfg.noConfigFile = true;
  if (cfg.mode === "report") for (const g of Object.keys(cfg.guards)) if (cfg.guards[g] === "block") cfg.guards[g] = "report";
  return cfg;
}
