#!/usr/bin/env node
// Builds ctx.json for the guards that read GitHub facts: done-without-green (the PR text), checks-green (the other checks on
// the head commit, after waiting for them to finish) and deploy-delivered (the latest deploy runs). Reads the event file, never a shell string.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { collectChecks, collectDeployRuns } from "../lib/ctx-collect.mjs";

const out = process.argv[2] ?? "gel-ctx.json";
const ctx = { claim: "", checkRuns: [] };
const get = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" } });
  return res.ok ? res.json() : null;
};
try {
  const ev = existsSync(process.env.GITHUB_EVENT_PATH ?? "") ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
  const pr = ev.pull_request;
  const repo = process.env.GITHUB_REPOSITORY;
  if (pr) {
    ctx.claim = `${pr.title ?? ""}\n${pr.body ?? ""}`;
    let ignore = [];
    try { ignore = JSON.parse(readFileSync("docs/gel.json", "utf8")).checks_green?.ignore ?? []; } catch { /* no config */ }
    Object.assign(ctx, await collectChecks(get, { repo, sha: pr.head.sha, ignore, waitS: Number(process.env.GEL_WAIT_SECONDS ?? 300) }));
    ctx.deployRuns = await collectDeployRuns(get, { repo, branch: ev.repository?.default_branch ?? pr.base.ref });
  }
} catch (e) { console.error(`gel-ctx: ${e.message}`); }
writeFileSync(out, JSON.stringify(ctx));
