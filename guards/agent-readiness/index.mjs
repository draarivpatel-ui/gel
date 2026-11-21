import { readText } from "../../lib/fs.mjs";

export const name = "agent-readiness";
// A site that tells agents it has a remote MCP server must also publish the card agents look for, and a card
// that is published must be real. This guard never asks for an agent card (A2A) a site has no agent for: it
// only checks what the site already claims. Offline; reads llms.txt, the cards and the Jekyll config.
const ROOTS = ["", "public/", "static/", "site/", "docs/"];
const MCP_URL = /https?:\/\/[a-z0-9.-]+(?::\d+)?\/mcp\b(?![a-z0-9_-])/gi;
const isHttps = (u) => typeof u === "string" && /^https:\/\/[a-z0-9.-]+(?::\d+)?(\/\S*)?$/i.test(u);

function parse(read, path, at) {
  const t = read(path);
  if (t === null) return null;
  try { return JSON.parse(t); } catch { at(path, "is not valid JSON: agents cannot read it"); return undefined; }
}

export function run({ files, read }) {
  const findings = [];
  const add = (file) => (message) => findings.push({ file, line: 1, message });
  for (const root of ROOTS) {
    const llms = [`${root}llms.txt`, `${root}llms-full.txt`].filter((f) => files.includes(f));
    const mcpCard = `${root}.well-known/mcp-server-card.json`;
    const agentCard = `${root}.well-known/agent-card.json`;
    const hasMcpCard = files.includes(mcpCard);
    // 1. The site says "MCP server at <url>" in llms.txt but publishes no card for it.
    for (const f of llms) {
      const text = read(f) ?? "";
      const urls = [...new Set(text.match(MCP_URL) ?? [])];
      if (urls.length && !hasMcpCard && root === "") {
        findings.push({ file: f, line: 1, message: `advertises a remote MCP server (${urls[0]}) but ${mcpCard} does not exist: agents look for that card first` });
      }
    }
    // 2. A published MCP card must name the server and give an https endpoint.
    if (hasMcpCard) {
      const at = (f, m) => add(f)(m);
      const card = parse(read, mcpCard, at);
      if (card && typeof card === "object") {
        if (!card.name || typeof card.name !== "string") at(mcpCard, 'has no "name"');
        const remotes = Array.isArray(card.remotes) ? card.remotes : [];
        if (!remotes.length) at(mcpCard, 'has no "remotes": a card with no endpoint tells an agent nothing');
        for (const r of remotes) if (!isHttps(r?.url)) at(mcpCard, `remote "${r?.url ?? ""}" is not an https URL`);
      } else if (card === null || card === undefined) { /* reported or unreadable */ }
    }
    // 3. A published A2A card must describe an interface, or it is a card for an agent that does not exist.
    if (files.includes(agentCard)) {
      const at = (f, m) => add(f)(m);
      const card = parse(read, agentCard, at);
      if (card && typeof card === "object") {
        if (!card.name || !card.description) at(agentCard, 'needs "name" and "description"');
        const ifaces = Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces : [];
        if (!ifaces.length || !ifaces.every((i) => isHttps(i?.url))) at(agentCard, 'needs "supportedInterfaces" with an https url: do not publish an agent card for an agent that is not running');
      }
    }
    // 4. Jekyll drops dot folders unless the config includes them, so the cards would 404 on the live site.
    const cards = files.filter((f) => f.startsWith(`${root}.well-known/`) && f.endsWith(".json"));
    if (root === "" && cards.length && files.includes("_config.yml")) {
      const cfg = read("_config.yml") ?? "";
      if (!/^\s*-\s*["']?\.well-known["']?\s*$/m.test(cfg)) findings.push({ file: "_config.yml", line: 1, message: ".well-known is not in `include:`; Jekyll will not publish the cards" });
    }
  }
  return { pass: findings.length === 0, findings };
}
