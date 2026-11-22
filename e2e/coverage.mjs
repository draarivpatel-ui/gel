// The table in e2e/README.md: for each check and grade, how many cases are real and how many are made up.
import { GRADES, CHECKS } from "../lib/grades.mjs";

export function coverage(cases) {
  const cell = (check, g) => {
    const of = cases.filter((c) => c.check === check && c.expect === g);
    const real = of.filter((c) => c.real).length;
    return real ? `${real} real` : of.length ? "made up only" : "none";
  };
  const head = ["check", ...GRADES, "no grade"];
  const rows = CHECKS.map((check) => [check, ...GRADES.map((g) => cell(check, g)), cell(check, null)]);
  return [head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}
