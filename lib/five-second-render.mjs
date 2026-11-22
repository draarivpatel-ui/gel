// `gel five-second`: open a page in headless Chrome at a phone size, let its scripts draw it, and keep the first screen
// (the headline and what follows it) so the five-second-test guard can judge a page whose source has no headline.
// Only what a visitor can see is kept: hidden, transparent, off-screen and screen-reader-only elements are dropped,
// and a headline that something else is drawn over (a cookie wall, a popup) is reported as covered.
// Chrome is driven over --remote-debugging-pipe (no dependencies), so the page's own Content-Security-Policy cannot
// block the measuring script and the viewport is a real phone size (a headless window cannot be narrower than 500px).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome } from "./input-viewport.mjs";

export function firstScreen(dom) {
  const h1 = /<h1\b[^>]*>[\s\S]*?<\/h1>/i.exec(dom);
  if (!h1) return "";
  return dom.slice(h1.index, h1.index + h1[0].length + 2600);
}

// Runs in the page. Returns the body with everything a visitor cannot see removed, and what covers the headline.
export function visibleScreen() {
  const hidden = (el) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return true;
    if (s.display === "contents") return false; // draws no box of its own (0x0), its children are judged on their own
    if (r.right <= 0 || r.left >= innerWidth || r.bottom + scrollY <= 0) return true; // pushed off the page
    if ((r.width <= 1 || r.height <= 1) && s.overflow !== "visible") return true; // screen-reader-only
    return /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(s.clip) || s.clipPath === "inset(50%)";
  };
  scrollTo(0, 0);
  const all = [...document.body.querySelectorAll("*")];
  const drop = new Set();
  for (const el of all) if (!drop.has(el.parentElement) && hidden(el)) drop.add(el);
  for (const el of all) if (drop.has(el.parentElement)) drop.add(el);
  const clone = document.body.cloneNode(true);
  const twins = [...clone.querySelectorAll("*")];
  all.forEach((el, i) => { if (drop.has(el) && !drop.has(el.parentElement)) twins[i].remove(); });
  for (const s of clone.querySelectorAll("script,style,noscript,template")) s.remove();
  const h1 = all.find((el) => el.tagName === "H1" && !drop.has(el));
  let covered = null;
  if (h1) {
    const r = h1.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(r.top + Math.min(r.height, 40) / 2, 0), innerHeight - 1);
    const hit = r.top < innerHeight ? document.elementFromPoint(x, y) : h1;
    if (hit && hit !== h1 && !h1.contains(hit) && !hit.contains(h1)) covered = hit.tagName.toLowerCase() + (typeof hit.className === "string" && hit.className.trim() ? "." + hit.className.trim().split(/\s+/)[0] : "");
  }
  return { html: clone.outerHTML, covered };
}

// Talk to Chrome's DevTools protocol over fds 3 (to Chrome) and 4 (from Chrome): JSON messages ended by a NUL byte.
async function render(chrome, target, w, h, budgetMs) {
  const dir = mkdtempSync(join(tmpdir(), "gel-5s-"));
  const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${join(dir, "profile")}`, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let id = 0, buf = "";
  const waiting = new Map(), events = [];
  proc.stdio[4].on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg.id && waiting.has(msg.id)) { const [ok, bad] = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? bad(new Error(msg.error.message)) : ok(msg.result); }
      else events.push(msg);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, bad) => { const n = ++id; waiting.set(n, [ok, bad]); proc.stdio[3].write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0"); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const killer = setTimeout(() => proc.kill("SIGKILL"), budgetMs + 30000);
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true }, sessionId);
    await send("Page.enable", {}, sessionId);
    const nav = await send("Page.navigate", { url: target }, sessionId);
    if (nav.errorText) throw new Error(`Chrome could not open ${target}: ${nav.errorText}`);
    const until = Date.now() + budgetMs;
    while (Date.now() < until && !events.some((e) => e.method === "Page.loadEventFired")) await sleep(100);
    await sleep(Math.min(1500, Math.max(0, until - Date.now()))); // let scripts that run after load draw the page
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression: `(${visibleScreen})()`, returnByValue: true }, sessionId);
    if (exceptionDetails) throw new Error(`measuring ${target} failed: ${exceptionDetails.text}`);
    await send("Browser.close").catch(() => {});
    return result.value;
  } finally {
    clearTimeout(killer);
    proc.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function measure({ url, file, size = "375x812", budgetMs = 8000 }) {
  const target = url ?? pathToFileURL(resolve(file)).href;
  const [w, h] = size.split("x").map(Number);
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome found: install Google Chrome or set CHROME=/path/to/chrome");
  const v = await render(chrome, target, w, h, budgetMs);
  return { page: url ?? file, width: w, height: h, html: firstScreen(v.html ?? ""), ...(v.covered ? { covered: v.covered } : {}) };
}
