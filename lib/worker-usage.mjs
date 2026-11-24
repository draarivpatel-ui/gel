// `gel worker-usage`: read yesterday's request count per Worker script from Cloudflare's GraphQL Analytics API, so
// the worker-request-budget guard has a measurement to judge. Needs CLOUDFLARE_API_TOKEN (Account Analytics: Read).
const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

const day = (d) => d.toISOString().slice(0, 10);

// Pure: the UTC day to measure, as [from, to). Default is the last complete day; `dayOffset` 0 means today so far.
export function window(now = new Date(), dayOffset = 1) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1 - dayOffset));
  const start = new Date(end.getTime() - 86400000);
  return { from: start.toISOString(), to: end.toISOString(), day: day(start) };
}
export function query(account, from, to) {
  return `query{viewer{accounts(filter:{accountTag:${JSON.stringify(account)}}){workersInvocationsAdaptive(limit:200,filter:{datetime_geq:${JSON.stringify(from)},datetime_lt:${JSON.stringify(to)}},orderBy:[sum_requests_DESC]){sum{requests errors} dimensions{scriptName}}}}}`;
}
// Pure: GraphQL response -> [{script, requests, errors}], most requests first.
export function parse(json) {
  if (json?.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  const rows = json?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
  if (!Array.isArray(rows)) throw new Error("Cloudflare returned no Workers analytics for this account");
  return rows.map((r) => ({ script: r.dimensions.scriptName, requests: r.sum.requests, errors: r.sum.errors })).sort((a, b) => b.requests - a.requests);
}
// `toolCalls`: {script: n} from the directory's usage page (the connector listing shows tool calls per day).
export async function measure({ account, token = process.env.CLOUDFLARE_API_TOKEN, dayOffset = 1, dailyLimit = 100000, toolCalls = {}, now = new Date(), fetchFn = fetch }) {
  if (!account) throw new Error("--account <Cloudflare account id> is required");
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set (Account Analytics: Read)");
  const w = window(now, dayOffset);
  const res = await fetchFn(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ query: query(account, w.from, w.to) }) });
  if (!res.ok) throw new Error(`Cloudflare answered ${res.status}`);
  const scripts = parse(await res.json()).map((s) => (toolCalls[s.script] != null ? { ...s, toolCalls: toolCalls[s.script] } : s));
  return { measuredAt: now.toISOString(), day: w.day, dailyLimit, scripts };
}
