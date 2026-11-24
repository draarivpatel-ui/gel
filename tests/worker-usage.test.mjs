import { test } from "node:test";
import assert from "node:assert/strict";
import { window, query, parse, measure } from "../lib/worker-usage.mjs";

test("window is the last complete UTC day", () => {
  const w = window(new Date("2026-11-24T10:30:00Z"));
  assert.deepEqual(w, { from: "2026-11-23T00:00:00.000Z", to: "2026-11-24T00:00:00.000Z", day: "2026-11-23" });
  assert.equal(window(new Date("2026-11-24T10:30:00Z"), 0).day, "2026-11-24");
});
test("query names the account and the day", () => {
  const q = query("abc", "2026-11-23T00:00:00.000Z", "2026-11-24T00:00:00.000Z");
  assert.match(q, /accountTag:"abc"/);
  assert.match(q, /datetime_geq:"2026-11-23T00:00:00.000Z"/);
});
test("parse sorts by requests and reports API errors", () => {
  const row = (s, r) => ({ dimensions: { scriptName: s }, sum: { requests: r, errors: 0 } });
  const out = parse({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [row("a", 5), row("b", 50)] }] } } });
  assert.deepEqual(out.map((s) => s.script), ["b", "a"]);
  assert.throws(() => parse({ errors: [{ message: "denied" }] }), /denied/);
  assert.throws(() => parse({ data: { viewer: { accounts: [] } } }), /no Workers analytics/);
});
test("measure sends the token and attaches tool calls", async () => {
  let seen;
  const fetchFn = async (url, init) => { seen = init; return { ok: true, json: async () => ({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ dimensions: { scriptName: "citable" }, sum: { requests: 50199, errors: 0 } }] }] } } }) }; };
  const r = await measure({ account: "abc", token: "t", toolCalls: { citable: 100 }, now: new Date("2026-11-24T10:00:00Z"), fetchFn });
  assert.equal(seen.headers.authorization, "Bearer t");
  assert.deepEqual(r.scripts, [{ script: "citable", requests: 50199, errors: 0, toolCalls: 100 }]);
  assert.equal(r.day, "2026-11-23");
});
test("measure refuses without a token", async () => {
  await assert.rejects(measure({ account: "abc", token: "" }), /CLOUDFLARE_API_TOKEN/);
});
