// A north star that lives behind an API key (a site's analytics) needs the key in the measure step. The reusable
// workflow takes it as an optional `measure_secret` and sets it on that one step, so the setup command and the
// checkouts never see it, and a repo that passes nothing runs as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wf = readFileSync(new URL("../.github/workflows/north-star.yml", import.meta.url), "utf8");

test("measure_secret is an optional workflow_call secret", () => {
  const block = wf.match(/secrets:\n\s+measure_secret:\n([\s\S]*?)\npermissions:/)?.[1] ?? "";
  assert.match(block, /required: false/);
});

test("MEASURE_SECRET is set on the measure step only", () => {
  const uses = wf.split("\n").filter((l) => l.includes("secrets.measure_secret"));
  assert.equal(uses.length, 1);
  const measure = wf.slice(wf.indexOf("- name: Measure and publish"));
  assert.match(measure, /MEASURE_SECRET: \$\{\{ secrets\.measure_secret \}\}/);
  const setup = wf.slice(wf.indexOf("- name: Set up"), wf.indexOf("- name: Measure and publish"));
  assert.doesNotMatch(setup, /secret/i);
});

test("the README tells callers how to pass it", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /measure_secret: \$\{\{ secrets\./);
});
