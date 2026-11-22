import { readText } from "../../lib/fs.mjs";

export const name = "five-second-test";
// A stranger on a phone decides in five seconds whether a project is alive and for them. This guard reads the
// first screen of each landing page (offline, no browser) and fails when that screen cannot be understood in
// five seconds: no headline, a headline that is a paragraph, a lead full of jargon, or no button to press.
// Tune in gel.json: "five_second": { "pages": [...], "max_h1_words": 12, "max_lead_words": 32, "jargon": [...] }.
const PAGES = ["index.html", "public/index.html", "docs/index.html", "site/index.html"];
const JARGON = ["pods?", "orchestrat\\w*", "endpoints?", "openai-compatible", "inference", "mcp", "llms?", "sdks?", "serverless", "runtimes?", "kubernetes", "k8s", "namespaces?", "tensors?", "latency", "throughput", "rag", "embeddings?", "checkpoints?", "middleware", "idempotent", "daemons?", "multi-tenant", "control plane"];
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => (s.match(/\S+/g) ?? []).length;

// The rules, shared by the offline read and by a rendered measurement (a page drawn by script has no h1 in its source).
export function checkFirstScreen(html, at, { maxH1, maxLead, jargon }) {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!h1) { at("no <h1>: a visitor has nothing to read first"); return; }
  const head = text(h1[1]);
  if (!head) { at("the <h1> is empty"); return; }
  if (words(head) > maxH1) at(`the headline is ${words(head)} words (max ${maxH1}): say what it is in one short line`);
  if (jargon.test(head)) at(`the headline uses jargon ("${jargon.exec(head)[0]}"): say what it does for a person`);
  const after = html.slice(h1.index + h1[0].length);
  const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(after);
  const lead = p ? text(p[1]) : "";
  if (!lead) at("no sentence under the headline saying who it is for and what they get");
  else {
    if (words(lead) > maxLead) at(`the first sentence block is ${words(lead)} words (max ${maxLead}): cut it`);
    if (jargon.test(lead)) at(`the lead uses jargon ("${jargon.exec(lead)[0]}"): use plain words`);
  }
  if (!/<(?:a|button)\b[^>]*>/i.test(after.slice(0, 2500))) at("no link or button right under the headline: tell the visitor what to do next");
}

export function run({ root, files, cfg, read, ctx }) {
  const c = cfg?.five_second ?? {};
  const opts = { maxH1: c.max_h1_words ?? 12, maxLead: c.max_lead_words ?? 32, jargon: new RegExp(`\\b(?:${(c.jargon ?? JARGON).join("|")})\\b`, "i") };
  const pages = (c.pages ?? PAGES).filter((p) => files.includes(p));
  const findings = [];
  for (const f of pages) {
    const html = readText(root, f);
    if (html === null) continue;
    checkFirstScreen(html, (message) => findings.push({ file: f, line: 1, message: `five-second test: ${message}` }), opts);
  }
  // Pages drawn by script (a single-page app, a worker that fills the page in the browser) have no headline in their source.
  // Declare them: "five_second": { "rendered": { "result": "bench/five-second.json", "max_age_days": 30 } }, and measure with
  // `gel five-second --url <page> --write bench/five-second.json` (headless Chrome, phone size). The first screen the browser
  // drew is judged by the same rules as an offline page, counting only what a visitor can see (hidden and off-screen text is
  // dropped when measuring), and a headline covered by a cookie wall or popup fails. The offline read cannot see CSS.
  const r = c.rendered;
  if (r != null && typeof r === "object") {
    const file = typeof r.result === "string" && r.result.trim() ? r.result.trim() : "bench/five-second.json";
    const at = (message) => findings.push({ file, line: 1, message: `five-second test (rendered): ${message}` });
    const raw = files.includes(file) ? (read ? read(file) : readText(root, file)) : null;
    if (raw == null) at(`"${file}" is missing: run \`gel five-second --url <page> --write ${file}\` and commit it`);
    else {
      let m;
      try { m = JSON.parse(raw); } catch { m = null; }
      const entries = Array.isArray(m?.entries) ? m.entries : [];
      if (!m || entries.length === 0) at(`${file} is not a measurement (needs "entries")`);
      else {
        const now = ctx?.now ? Date.parse(ctx.now) : Date.now();
        const when = Date.parse(m.measuredAt);
        const maxAge = (r.max_age_days ?? 30) * 86400000;
        if (Number.isNaN(when)) at(`${file} has no "measuredAt" date`);
        else if (now - when > maxAge) at(`measured ${Math.floor((now - when) / 86400000)} days ago (limit ${r.max_age_days ?? 30}): measure again`);
        for (const e of entries) {
          if (e.covered) at(`${e.page ?? "page"}: the headline is covered by ${e.covered} (a cookie wall or popup): that is what a visitor sees first`);
          checkFirstScreen(String(e.html ?? ""), (message) => at(`${e.page ?? "page"}: ${message}`), opts);
        }
      }
    }
  }
  return { pass: findings.length === 0, findings };
}
