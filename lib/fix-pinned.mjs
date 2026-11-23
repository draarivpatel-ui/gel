// The autofix's first fixer: pin the actions the pinned-actions guard reports to commit SHAs.
// It edits only the lines the guard names, and the guards (not this file) decide whether the result is better.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const USES = /^(\s*(?:-\s*)?uses:\s*)(["']?)([^\s"'#]+)\2(\s*#.*)?\s*$/;

// "actions/checkout@v4" -> { repo: "actions/checkout", ref: "v4" }; "github/codeql-action/init@v3" -> repo github/codeql-action
export function parseUses(ref) {
  const at = ref.lastIndexOf("@");
  if (at < 0) return null;
  const path = ref.slice(0, at), tag = ref.slice(at + 1);
  const parts = path.split("/");
  if (parts.length < 2 || !tag || tag.includes("${{")) return null;
  return { repo: `${parts[0]}/${parts[1]}`, ref: tag };
}

// Rewrite one `uses:` line to `<ref>@<sha> # <tag>`. A comment already on the line is kept as it is.
export function pinLine(line, sha) {
  const m = line.match(USES);
  if (!m) return null;
  const [, head, quote, ref, comment] = m;
  const p = parseUses(ref);
  if (!p) return null;
  const pinned = `${ref.slice(0, ref.lastIndexOf("@"))}@${sha}`;
  return `${head}${quote}${pinned}${quote}${comment ? comment : ` # ${p.ref}`}`;
}

// The commit a tag or branch points at, from the public git server (no token). An annotated tag is peeled.
export function lsRemoteResolver(run = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 })) {
  const cache = new Map();
  return (repo, ref) => {
    const key = `${repo}@${ref}`;
    if (cache.has(key)) return cache.get(key);
    let sha = null;
    try {
      const out = run(["ls-remote", `https://github.com/${repo}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`, `refs/heads/${ref}`]);
      const rows = out.split("\n").filter(Boolean).map((l) => l.split("\t"));
      const pick = (name) => rows.find((r) => r[1] === name)?.[0];
      sha = pick(`refs/tags/${ref}^{}`) ?? pick(`refs/tags/${ref}`) ?? pick(`refs/heads/${ref}`) ?? null;
    } catch { sha = null; }
    cache.set(key, sha);
    return sha;
  };
}

// findings: the pinned-actions guard's own findings ({ file, line }). Returns what changed and what could not be resolved.
export function fixPinned(root, findings, resolveRef) {
  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f.line]);
  const files = [], unresolved = [];
  let pinned = 0;
  for (const [file, lines] of byFile) {
    const path = join(root, file);
    const text = readFileSync(path, "utf8").split("\n");
    let changed = false;
    for (const n of lines) {
      const line = text[n - 1];
      const m = line?.match(USES);
      const p = m && parseUses(m[3]);
      if (!p) { unresolved.push({ file, line: n, why: "not a plain owner/repo@ref" }); continue; }
      const sha = resolveRef(p.repo, p.ref);
      if (!sha || !/^[0-9a-f]{40}$/.test(sha)) { unresolved.push({ file, line: n, why: `${p.repo}@${p.ref} not found` }); continue; }
      const next = pinLine(line, sha);
      if (next && next !== line) { text[n - 1] = next; changed = true; pinned++; }
    }
    if (changed) { writeFileSync(path, text.join("\n")); files.push(file); }
  }
  return { files, pinned, unresolved };
}
