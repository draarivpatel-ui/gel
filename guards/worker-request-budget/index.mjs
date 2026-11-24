// No node imports here: this file also runs in a browser. A Cloudflare Worker on the free plan has 100,000 requests
// a day for the whole account; when it runs out every Worker fails until midnight UTC. One chatty Worker is enough:
// an MCP connector answers a handshake (initialize, an "initialized" notice, tools/list) for every Claude session
// that has it switched on, so a listing with 1,100 connected accounts cost 50,000 requests a day for about 100 real
// tool calls. Traffic cannot be judged from source, so the guard reads a MEASUREMENT written by
// `gel worker-usage --account <id> --write bench/worker-usage.json` (Cloudflare GraphQL, needs CLOUDFLARE_API_TOKEN):
//   "worker_budget": {
//     "result": "bench/worker-usage.json",  // {"measuredAt","dailyLimit","day","scripts":[{"script","requests","errors","toolCalls"?}]}
//     "max_age_days": 7,                    // optional, default 7
//     "max_share": 0.25,                    // optional: one script may use at most this share of dailyLimit
//     "max_total_share": 0.6,               // optional: all scripts together
//     "max_requests_per_tool_call": 50,     // optional: applies to a script that reports toolCalls (an MCP server)
//     "scripts": ["citable"]                // optional: only these scripts are judged (default: all in the file)
//   }
// It applies when docs/gel.json has "worker_budget", or when the repo has a wrangler config and a source file that
// serves an /mcp endpoint. Missing or stale measurement, or a limit crossed, is a finding. An archived repo needs none.
export const name = "worker-request-budget";

const WRANGLER = /(^|\/)wrangler\.(toml|jsonc?)$/;
const SOURCE = /\.(m?[jt]s|[jt]sx)$/;
const SKIP = /(^|\/)(node_modules|dist|build|tests?|__tests__|\.wrangler)\/|\.(test|spec)\.[jt]s$/;
// A quoted "/mcp" path, which is how a Worker routes its MCP endpoint (app.post("/mcp"), pathname === "/mcp").
const MCP_ROUTE = /["'`]\/mcp["'`]/;

const pct = (x) => `${Math.round(x * 1000) / 10}%`;

export function run({ cfg, files, read, ctx }) {
  if (cfg?.status === "archived") return { pass: true, findings: [] };
  const c = cfg?.worker_budget;
  const declared = c != null && typeof c === "object";
  const list = files ?? [];
  const hasWrangler = list.some((f) => WRANGLER.test(f));
  const mcpFile = hasWrangler ? list.find((f) => SOURCE.test(f) && !SKIP.test(f) && MCP_ROUTE.test(read?.(f) ?? "")) : undefined;
  if (!declared && !mcpFile) return { pass: true, findings: [] };
  const findings = [];
  const at = (message) => findings.push({ file: "docs/gel.json", line: 0, message: `worker request budget: ${message}` });
  const resultFile = typeof c?.result === "string" && c.result.trim() ? c.result.trim() : "bench/worker-usage.json";
  const raw = list.includes(resultFile) ? read?.(resultFile) : null;
  if (raw == null) {
    at(`${mcpFile ? `${mcpFile} serves an MCP endpoint` : "this repo declares a Worker budget"} but "${resultFile}" is missing: run \`gel worker-usage --account <id> --write ${resultFile}\` and commit it`);
    return { pass: false, findings };
  }
  let r;
  try { r = JSON.parse(raw); } catch { at(`${resultFile} is not valid JSON`); return { pass: false, findings }; }
  const only = Array.isArray(c?.scripts) && c.scripts.length ? new Set(c.scripts) : null;
  const scripts = (Array.isArray(r?.scripts) ? r.scripts : []).filter((s) => !only || only.has(s.script));
  if (scripts.length === 0) { at(`${resultFile} has no "scripts"${only ? ` for ${[...only].join(", ")}` : ""}`); return { pass: false, findings }; }
  const limit = Number(r.dailyLimit) > 0 ? Number(r.dailyLimit) : 100000;
  const now = ctx?.now ? Date.parse(ctx.now) : Date.now();
  const when = Date.parse(r.measuredAt);
  const maxAge = (c?.max_age_days ?? 7) * 86400000;
  if (Number.isNaN(when)) at(`${resultFile} has no "measuredAt" date`);
  else if (now - when > maxAge) at(`measured ${Math.floor((now - when) / 86400000)} days ago (limit ${c?.max_age_days ?? 7}): measure again`);
  const maxShare = c?.max_share ?? 0.25;
  const maxTotal = c?.max_total_share ?? 0.6;
  const maxRatio = c?.max_requests_per_tool_call ?? 50;
  let total = 0;
  for (const s of scripts) {
    const n = Number(s.requests);
    if (!Number.isFinite(n)) { at(`${s.script}: no numeric "requests"`); continue; }
    total += n;
    if (n / limit > maxShare) at(`${s.script} used ${n} requests (${pct(n / limit)} of the ${limit} a day, limit ${pct(maxShare)}): one Worker is eating the free plan; cut its traffic or move it off Workers`);
    const calls = Number(s.toolCalls);
    if (Number.isFinite(calls) && calls >= 0 && n / Math.max(calls, 1) > maxRatio) at(`${s.script}: ${n} requests for ${calls} tool calls (${Math.round(n / Math.max(calls, 1))} per call, limit ${maxRatio}): the traffic is connection handshakes, not use; stop clients from reconnecting or host the MCP endpoint elsewhere`);
  }
  if (total / limit > maxTotal) at(`the scripts above used ${total} requests together (${pct(total / limit)} of ${limit}, limit ${pct(maxTotal)}): the account will hit the free daily limit`);
  return { pass: findings.length === 0, findings };
}
