// Grades for the three product checks (click-map, ice-score, product-brief): bad < passed < good < high < super high.
// "bad" is the guard failing; "passed" and above is the guard passing, and how far above it went. null means the check
// has nothing to grade in this repo (not declared, no ICE table, too few clicks), which is not a pass and not a fail.
// `gel grade --root <repo> --json` prints these; the e2e suite in e2e/ runs it on recorded real repos.
import { walk, readText } from "./fs.mjs";
import { loadConfig } from "./config.mjs";
import * as clickMap from "../guards/click-map/index.mjs";
import * as ice from "../guards/ice-score/index.mjs";
import * as brief from "../guards/product-brief/index.mjs";

export const GRADES = ["bad", "passed", "good", "high", "super high"];
export const CHECKS = ["click-map", "ice-score", "product-brief"];

function gradeClicks(a) {
  if (a.cfg?.click_map == null || a.cfg?.status === "archived") return { grade: null, why: 'no "click_map" in docs/gel.json' };
  const lim = clickMap.limits(a.cfg);
  const v = clickMap.run(a);
  let entries = [];
  try { entries = JSON.parse(a.read(lim.resultFile) ?? "{}").entries ?? []; } catch {}
  const g = clickMap.grade(Array.isArray(entries) ? entries : [], lim);
  if (!v.pass) return { ...g, grade: "bad", findings: v.findings.length };
  return g;
}

export function gradeRepo(root, { now } = {}) {
  const cfg = loadConfig(root);
  const a = { cfg, files: walk(root), read: (f) => readText(root, f), ctx: now ? { now } : {} };
  return {
    "click-map": gradeClicks(a),
    "ice-score": ice.grade(a),
    "product-brief": brief.grade(a),
  };
}
