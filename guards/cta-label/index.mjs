import { readText } from "../../lib/fs.mjs";
import { firstControl } from "../five-second-test/index.mjs";

export const name = "cta-label";
// five-second-test only asks that SOME link or button sits under the headline. This guard reads what it SAYS: the first
// <a>/<button> after the first <h1> must tell the visitor what they get, not just "Sign in". Offline, no browser.
// Tune in docs/gel.json: "cta_label": { "pages": [...], "banned": [...], "max_words": 6 }. A page with no <h1> or no
// button stays silent here (five-second-test reports it). A label with the word "free" passes the generic check.
const PAGES = ["index.html", "public/index.html", "docs/index.html", "site/index.html"];
const BANNED = ["sign in", "sign up", "log in", "login", "submit", "continue", "next", "go", "click here", "learn more", "read more", "get started", "more", "ok"];
// Auth verbs stay generic even with a provider after them ("Sign in with GitHub") unless the label says it is free.
const AUTH = /^(?:sign in|sign up|log in|login|continue)\b/;
const ADVICE = `say what the visitor gets and that it is free, e.g. "Start free with GitHub" or "Get a free API key"`;
const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'", rarr: "", larr: "" };
const label = (inner) => inner.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&(#?\w+);/g, (m, e) => (e in ENTITIES ? ENTITIES[e] : m)).replace(/\s+/g, " ").trim().toLowerCase();
const plain = (s) => s.replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();

export function checkLabel(html, at, { banned, maxWords }) {
  const c = firstControl(html);
  if (!c) return;
  const raw = label(c.inner);
  const l = plain(raw);
  if (!l) return;
  const n = l.split(" ").length;
  const free = /\bfree\b/.test(l);
  if (n > maxWords) at(`the first button says "${raw}" (${n} words, max ${maxWords}): ${ADVICE}`);
  else if (!free && (banned.includes(l) || AUTH.test(l))) at(`the first button says "${raw}", which does not say what the visitor gets: ${ADVICE}`);
}

export function run({ root, files, cfg, read, ctx }) {
  void ctx;
  const c = cfg?.cta_label ?? {};
  const opts = { banned: (c.banned ?? BANNED).map((b) => plain(String(b).toLowerCase())), maxWords: c.max_words ?? 6 };
  const findings = [];
  for (const f of (c.pages ?? PAGES).filter((p) => files.includes(p))) {
    const html = read ? read(f) : readText(root, f);
    if (html == null) continue;
    checkLabel(html, (message) => findings.push({ file: f, line: 1, message: `cta-label: ${message}` }), opts);
  }
  // Pages drawn by script: the same measurement five-second-test reads (cfg.five_second.rendered, bench/five-second.json).
  // A missing, stale or malformed file is five-second-test's finding; here it is skipped.
  const r = cfg?.five_second?.rendered;
  if (r != null && typeof r === "object") {
    const file = typeof r.result === "string" && r.result.trim() ? r.result.trim() : "bench/five-second.json";
    const raw = files.includes(file) ? (read ? read(file) : readText(root, file)) : null;
    let m = null;
    try { m = raw == null ? null : JSON.parse(raw); } catch { m = null; }
    for (const e of Array.isArray(m?.entries) ? m.entries : []) {
      checkLabel(String(e.html ?? ""), (message) => findings.push({ file, line: 1, message: `cta-label (rendered): ${e.page ?? "page"}: ${message}` }), opts);
    }
  }
  return { pass: findings.length === 0, findings };
}
