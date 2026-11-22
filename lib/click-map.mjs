// `gel click-map`: read a site's click numbers for one page on one kind of device and keep what the click-map guard
// judges: how many clicks, how many of them hit nothing, and the ten most pressed things. The site answers with
// {"page", "dev", "since", "clicks", "dead", "targets": [{"target", "kind": "ctl" | "dead", "n"}]} (Grow's /api/clicks).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
// The names come from another server and end up in a terminal, a committed file and a pull request comment:
// one line, no control characters, a short length.
const text = (v, max) => String(v ?? "").replace(/[\n\r]/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

// Pure: one answer of the site -> one entry of docs/click-map.json. Throws when the answer is not a click map.
export function toEntry(j, source, now = Date.now()) {
  if (j == null || typeof j !== "object" || !fin(j.clicks) || !Array.isArray(j.targets)) throw new Error(`${source} did not answer with a click map ({"clicks", "dead", "targets"})`);
  let days = null;
  try { const d = Number(new URL(source).searchParams.get("days")); if (d > 0) days = d; } catch {}
  const since = Date.parse(j.since);
  if (days == null && !Number.isNaN(since)) days = Math.floor((now - since) / 86400000) + 1;
  const targets = j.targets.filter((t) => t && fin(t.n)).map((t) => ({ target: text(t.target, 60), kind: t.kind === "dead" ? "dead" : "ctl", n: t.n })).sort((a, b) => b.n - a.n).slice(0, 10);
  return { page: text(j.page, 40) || "page", dev: text(j.dev, 20) || "all", days, clicks: j.clicks, dead: fin(j.dead) ? j.dead : 0, targets, source };
}

export async function measure({ url, file }) {
  if (url) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    let j; try { j = await res.json(); } catch { throw new Error(`${url} did not answer with JSON`); }
    return toEntry(j, url);
  }
  let j; try { j = JSON.parse(readFileSync(resolve(file), "utf8")); } catch { throw new Error(`${file} is not a JSON file`); }
  return toEntry(j, file);
}
