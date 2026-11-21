import { readText } from "../../lib/fs.mjs";

export const name = "agent-readiness";
// A site that tells agents it has a remote MCP server must also publish the card agents look for, and a card
// that is published must be real. This guard never asks for an agent card (A2A) a site has no agent for: it
// only checks what the site already claims. Offline; reads llms.txt, the cards and the Jekyll config.
// Card shape follows the MCP Server Card draft (modelcontextprotocol/ext-server-card): $schema, name, version and
// description are required, remotes[] holds the endpoints, and /.well-known/ai-catalog.json lists a domain's cards.
const SCHEMA = /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/v1\/server-card\.schema\.json$/;
const CARD_TYPE = "application/mcp-server-card+json";
const ROOTS = ["", "public/", "static/", "site/", "docs/"];
const MCP_URL = /https?:\/\/[a-z0-9.-]+(?::\d+)?\/mcp\b(?![a-z0-9_-])/gi;
// A source file that routes "/mcp" is a live MCP server; it must serve or ship a card (tests do not count).
const MCP_ROUTE = /(?:\b(?:pathname|path|url)\s*={2,3}\s*["'`]\/mcp["'`]|\.(?:all|post|get|use|route)\(\s*["'`]\/mcp["'`])/;
const SRC = /\.(?:m?[jt]s|[jt]sx)$/;
const isTest = (f) => /(^|\/)(?:tests?|__tests__|node_modules|dist)\//.test(f) || /\.(?:test|spec)\./.test(f);
const CARD_REF = /mcp-server-card|mcp\/server-card|ai-catalog/;
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
    const cardPaths = [`${root}.well-known/mcp-server-card.json`, `${root}.well-known/mcp/server-card.json`];
    const mcpCard = cardPaths.find((f) => files.includes(f)) ?? cardPaths[0];
    const catalog = `${root}.well-known/ai-catalog.json`;
    const agentCard = `${root}.well-known/agent-card.json`;
    const hasMcpCard = cardPaths.some((f) => files.includes(f)) || files.includes(catalog);
    // 1. The site says "MCP server at <url>" in llms.txt but publishes no card for it.
    for (const f of llms) {
      const text = read(f) ?? "";
      const urls = [...new Set(text.match(MCP_URL) ?? [])];
      if (urls.length && !hasMcpCard && root === "") {
        findings.push({ file: f, line: 1, message: `advertises a remote MCP server (${urls[0]}) but ${mcpCard} (or an ai-catalog.json) does not exist: agents look for it first` });
      }
    }
    // 2. Every published MCP card must be a real Server Card, and a catalog must point at real ones.
    const checkCard = (card, file) => {
      if (!card || typeof card !== "object") { add(file)("is not a Server Card object"); return; }
      if (!SCHEMA.test(card.$schema ?? "")) add(file)('needs "$schema": "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json"');
      for (const k of ["name", "version", "description"]) if (!card[k] || typeof card[k] !== "string") add(file)(`has no "${k}"`);
      // Limits from the published Server Card schema: a consumer that validates rejects a longer value.
      if (typeof card.description === "string" && card.description.length > 100) add(file)(`"description" is ${card.description.length} characters; the Server Card schema allows at most 100`);
      if (typeof card.title === "string" && card.title.length > 100) add(file)(`"title" is ${card.title.length} characters; the Server Card schema allows at most 100`);
      if (typeof card.name === "string" && !/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(card.name)) add(file)(`"name" ${card.name} must be reverse-DNS with one slash, like sh.flisk/app`);
      const remotes = Array.isArray(card.remotes) ? card.remotes : [];
      if (!remotes.length) add(file)('has no "remotes": a card with no endpoint tells an agent nothing');
      for (const r of remotes) if (!isHttps(r?.url)) add(file)(`remote "${r?.url ?? ""}" is not an https URL`);
    };
    for (const f of cardPaths.filter((x) => files.includes(x))) {
      const card = parse(read, f, (file, m) => add(file)(m));
      if (card !== null && card !== undefined) checkCard(card, f);
    }
    if (files.includes(catalog)) {
      const cat = parse(read, catalog, (file, m) => add(file)(m));
      if (cat && typeof cat === "object") {
        const entries = Array.isArray(cat.entries) ? cat.entries : [];
        if (!cat.specVersion || !entries.length) add(catalog)('needs "specVersion" and at least one entry');
        for (const e of entries) {
          const id = e?.identifier ?? "?";
          if (!e?.identifier || !e?.type) add(catalog)(`entry ${id} needs "identifier" and "type"`);
          else if (e.type === CARD_TYPE) {
            if (Boolean(e.url) === Boolean(e.data)) add(catalog)(`entry ${id} needs exactly one of "url" or "data"`);
            else if (e.data) checkCard(e.data, catalog);
            else if (!isHttps(e.url)) add(catalog)(`entry ${id} url is not https`);
          }
        }
      }
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
  // 5. A server that routes /mcp but neither ships a card file nor has code that serves one.
  const src = files.filter((f) => SRC.test(f) && !isTest(f));
  const routes = src.filter((f) => MCP_ROUTE.test(read(f) ?? ""));
  if (routes.length) {
    const served = files.some((f) => !isTest(f) && /(^|\/)\.well-known\/(?:mcp-server-card|mcp\/server-card|ai-catalog)\.json$/.test(f))
      || src.some((f) => CARD_REF.test(read(f) ?? ""));
    if (!served) findings.push({ file: routes[0], line: 1, message: "routes /mcp but nothing serves /.well-known/mcp-server-card.json: agents cannot discover this MCP server" });
  }
  return { pass: findings.length === 0, findings };
}
