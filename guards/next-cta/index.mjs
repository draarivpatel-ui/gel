import { readText } from "../../lib/fs.mjs";
import { dirname, posix } from "node:path";

export const name = "next-cta";
// A page has one most likely next action, and the visitor should see it at once. The page marks it with the attribute
// data-next-cta on exactly one element, and that element carries a class (default "next-cta") whose CSS spins a rainbow
// border. Offline, no browser. Fails when: nothing is marked, more than one thing is, the marked element lacks the class,
// it is not the first link, button or input after the first <h1> (so the page cannot mark the wrong thing), or the page
// defines no CSS for the class (an animation plus a prefers-reduced-motion rule). Copy the recipe from docs/next-cta.css.
// Tune in docs/gel.json: "next_cta": { "pages": [...], "class": "next-cta", "rendered": { "result": "bench/five-second.json" } }.
// A page with no <h1> stays silent here (five-second-test reports it).
const PAGES = ["index.html", "public/index.html", "docs/index.html", "site/index.html"];
const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, (m) => " ".repeat(m.length));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CONTROL = /<(a|button|input|textarea)\b[^>]*>/gi;
const MARK = /\sdata-next-cta(?=[\s=>/])/i;

function classes(tag) {
  const m = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  return (m ? (m[1] ?? m[2] ?? m[3]) : "").split(/\s+/).filter(Boolean);
}

// Rules 1-4: the markup. Rule 5 (CSS) is judged by the caller, who knows where stylesheets live.
export function checkMarkup(html, at, { cls }) {
  const clean = strip(html);
  const h1 = /<h1\b[^>]*>[\s\S]*?<\/h1>/i.exec(clean);
  if (!h1) return null;
  const marked = [...clean.matchAll(/<[a-z][^>]*>/gi)].filter((m) => MARK.test(m[0]));
  if (marked.length === 0) { at(`no element has data-next-cta: mark the one thing a visitor most likely does next (add data-next-cta and class "${cls}")`); return null; }
  if (marked.length > 1) { at(`${marked.length} elements have data-next-cta: only one next action can be the most likely`); return null; }
  const tag = marked[0][0];
  if (!classes(tag).includes(cls)) at(`the element with data-next-cta lacks the class "${cls}", so nothing draws the rainbow border`);
  CONTROL.lastIndex = h1.index + h1[0].length;
  const first = CONTROL.exec(clean);
  if (!first || first.index !== marked[0].index) at("the element with data-next-cta is not the first link, button or input after the <h1>: mark the first one, or move the real next action up");
  return clean;
}

export function checkCss(css, at, { cls }) {
  const rule = new RegExp(`\\.${esc(cls)}(?![\\w-])`);
  if (!rule.test(css)) { at(`the page defines no CSS for .${cls}: copy docs/next-cta.css (animated border plus a prefers-reduced-motion fallback)`); return; }
  if (!/animation\s*:|animation-name\s*:/i.test(css)) at(`the CSS for .${cls} has no animation: the border must spin`);
  if (!/prefers-reduced-motion/i.test(css)) at("the CSS has no prefers-reduced-motion rule: give people who turn motion off a static border");
}

function pageCss(html, file, files, read) {
  let css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  for (const l of strip(html).matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["']?stylesheet/i.test(l[0])) continue;
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(l[0]);
    const h = href && (href[1] ?? href[2] ?? href[3]);
    if (!h || /^(?:[a-z]+:)?\/\//i.test(h)) continue;
    const path = h.split(/[?#]/)[0];
    const target = path.startsWith("/") ? path.slice(1) : posix.normalize(posix.join(dirname(file), path));
    const found = [target, `public/${target}`].find((t) => files.includes(t));
    if (found) css += "\n" + (read(found) ?? "");
  }
  return css;
}

export function run({ root, files, cfg, read, ctx }) {
  void ctx;
  const c = cfg?.next_cta ?? {};
  const cls = c.class ?? "next-cta";
  const rd = read ?? ((f) => readText(root, f));
  const findings = [];
  for (const f of (c.pages ?? PAGES).filter((p) => files.includes(p))) {
    const html = rd(f);
    if (html == null) continue;
    const at = (message) => findings.push({ file: f, line: 1, message: `next-cta: ${message}` });
    if (checkMarkup(html, at, { cls }) !== null) checkCss(pageCss(html, f, files, rd), at, { cls });
  }
  // Pages drawn by script: the DOM measurement five-second-test writes (bench/five-second.json). The markup rules apply;
  // the CSS rule does not (the stylesheet is not in the measurement). A missing or malformed file is five-second-test's finding.
  const r = c.rendered;
  if (r != null && typeof r === "object") {
    const file = typeof r.result === "string" && r.result.trim() ? r.result.trim() : "bench/five-second.json";
    const raw = files.includes(file) ? rd(file) : null;
    let m = null;
    try { m = raw == null ? null : JSON.parse(raw); } catch { m = null; }
    for (const e of Array.isArray(m?.entries) ? m.entries : []) {
      checkMarkup(String(e.html ?? ""), (message) => findings.push({ file, line: 1, message: `next-cta (rendered): ${e.page ?? "page"}: ${message}` }), { cls });
    }
  }
  return { pass: findings.length === 0, findings };
}
