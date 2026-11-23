// No node imports here: this file also runs in a browser. `read(file)` returns the file text or null.
// "The deploy workflow is green and deployed nothing." A deploy job that skips every real step when a secret is unset
// ends green, so a person sees a tick and assumes the site is live (flisk-sh/studio: CLOUDFLARE_API_TOKEN unset, five
// "successful" deploys, nothing shipped). Two ways to see it:
//   1. static: a deploy workflow gates its steps on a secret-backed variable being empty or not, and no step fails
//      when it is empty (`exit 1` or `::error`). Add the failing step, or declare the skip on purpose.
//   2. observed: ctx.deployRuns, the latest deploy runs on the default branch (gel-ctx collects them), ended `success`
//      with every deploy-looking step `skipped`.
// gel.json: "deploy_delivered": { "allow_skip": [".github/workflows/deploy.yml"] }   (the skip is on purpose)
export const name = "deploy-delivered";

const DEPLOYISH = /deploy|publish|release|wrangler|ship|upload|push image|flyctl|vercel|netlify/i;
const DEPLOY_USES = /wrangler-action|deploy-pages|webapps-deploy|amplify|flyctl|vercel|netlify|aws-actions|google-github-actions\/deploy|azure\/|kubectl|helm|docker\/build-push-action|pypa\/gh-action-pypi-publish|publish/i;

const norm = (x) => x.split(/\s+/).filter(Boolean).join(" ");
function secretEnvs(text) {
  const names = new Set();
  for (const l of text.split("\n")) {
    const i = l.indexOf(":");
    if (i < 1) continue;
    const key = l.slice(0, i).trim();
    const val = norm(l.slice(i + 1));
    if (/^[A-Z][A-Z0-9_]*$/.test(key) && val.startsWith("${{ secrets.") && val.endsWith("}}")) names.add(key);
  }
  return names;
}

// the name of the secret-backed variable an `if:` compares with an empty string, and which way
function emptyTest(expr, secretNames) {
  const e = norm(expr);
  const m = e.match(/(?:env|secrets)\.(\w+) ?(==|!=) ?(?:''|"")/);
  if (m && (e.includes("secrets.") || secretNames.has(m[1]))) return { name: m[1], whenEmpty: m[2] === "==" };
  const neg = e.startsWith("!");
  const n = (neg ? e.slice(1).trim() : e).match(/^(?:env|secrets)\.(\w+)$/);
  if (n && (e.includes("secrets.") || secretNames.has(n[1]))) return { name: n[1], whenEmpty: neg };
  return null;
}

// the expression after `if:` on a workflow line (also `- if:`), without `${{ }}`, or null
function ifExpr(line) {
  let t = line.trim();
  if (t.startsWith("- ")) t = t.slice(2).trim();
  if (!t.startsWith("if:")) return null;
  t = t.slice(3).trim();
  if (t.startsWith("${{")) t = t.slice(3);
  if (t.endsWith("}}")) t = t.slice(0, -2);
  return t.trim();
}

export function run({ files = [], read, ctx = {}, cfg = {} }) {
  const findings = [];
  const allow = new Set(cfg.deploy_delivered?.allow_skip ?? []);
  for (const f of files.filter((x) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(x))) {
    const text = read?.(f);
    if (text == null || allow.has(f)) continue;
    const lines = text.split("\n");
    const title = lines.find((l) => l.startsWith("name:"))?.slice(5).trim() ?? "";
    const isDeploy = DEPLOYISH.test(f.split("/").pop()) || DEPLOYISH.test(title) || DEPLOY_USES.test(text) || /\bwrangler\s+deploy\b|\bflyctl\s+deploy\b|\bnpm\s+publish\b/.test(text);
    if (!isDeploy) continue;
    const secrets = secretEnvs(text);
    const gated = []; // { name, line, whenEmpty }
    let loud = false; // some step runs only when the secret is empty and fails
    lines.forEach((l, i) => {
      const expr = ifExpr(l);
      if (!expr) return;
      const t = emptyTest(expr, secrets);
      if (!t) return;
      if (t.whenEmpty) {
        // the step this `if` belongs to: look a few lines around for a failing command
        const around = lines.slice(Math.max(0, i - 4), i + 8).join("\n");
        if (around.includes("::error") || /\bexit [1-9]/.test(around.split("exit 0").join(""))) loud = true;
      } else gated.push({ name: t.name, line: i + 1 });
    });
    if (gated.length && !loud) {
      const n = gated[0];
      findings.push({ file: f, line: n.line, message: `${gated.length} step${gated.length > 1 ? "s" : ""} only run when ${n.name} is set, and nothing fails when it is not: the job ends green and deploys nothing. Fail the job when ${n.name} is empty (exit 1), or list this file in deploy_delivered.allow_skip` });
    }
  }
  for (const r of ctx.deployRuns ?? []) {
    if (allow.has(r.path)) continue;
    if (r.conclusion !== "success") continue;
    const steps = (r.jobs ?? []).flatMap((j) => (j.steps ?? []).map((s) => ({ ...s, job: j.name })));
    const deploySteps = steps.filter((s) => DEPLOYISH.test(s.name) && !/skip/i.test(s.name));
    const ran = deploySteps.some((s) => s.conclusion === "success");
    const skipped = deploySteps.filter((s) => s.conclusion === "skipped");
    const allJobsSkipped = (r.jobs ?? []).length > 0 && r.jobs.every((j) => j.conclusion === "skipped");
    if (allJobsSkipped || (!ran && skipped.length)) {
      findings.push({ file: r.path ?? r.workflow ?? "(deploy)", line: 0, message: `the latest "${r.workflow}" run${r.url ? ` (${r.url})` : ""} ended success but skipped ${allJobsSkipped ? "every job" : skipped.map((s) => `"${s.name}"`).slice(0, 3).join(", ")}: nothing was deployed` });
    }
  }
  return { pass: findings.length === 0, findings };
}
