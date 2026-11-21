// No node imports here: this file also runs in a browser. `read(file)` returns the file text or null.

export const name = "frozen-install";
// Pre-flight on CI config: CI installs exactly what the lockfile says. A plain `npm install` or `bun install`
// can resolve versions nobody committed, so CI goes green on code nobody reviewed, and a poisoned release lands unseen.
// Fails when:
//   - a workflow `run:` line installs with npm, bun, yarn, pnpm or pip and uses no frozen form
//     (`npm ci`, `--frozen-lockfile`, `--immutable`, `--require-hashes`)
//   - a package.json lists dependencies and no lockfile sits next to it
// Global installs (`-g`, `--global`) are skipped.

const INSTALL = /\b(?:(?:npm|bun|yarn|pnpm)\s+(?:install|i|add)|pip3?\s+install)\b/;
const FROZEN = /--frozen-lockfile|--immutable|--require-hashes|--locked|\bnpm\s+ci\b/;
const GLOBAL = /\s(?:-g|--global)\b/;
const LOCKS = ["bun.lock", "bun.lockb", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"];

export function run({ files, read }) {
  const findings = [];
  for (const f of files.filter((x) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(x))) {
    const text = read(f);
    if (text === null) continue;
    text.split("\n").forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      const cmd = line.replace(/\s+#.*$/, "");
      if (!INSTALL.test(cmd) || FROZEN.test(cmd) || GLOBAL.test(cmd)) return;
      // a bare `npm install` or `pip install` with no package and no -r is still an install from the manifest
      findings.push({ file: f, line: i + 1, message: `installs without a frozen lockfile: ${cmd.trim().replace(/^-\s*(run:\s*)?|^run:\s*/, "").slice(0, 80)}` });
    });
  }
  const set = new Set(files);
  for (const f of files.filter((x) => /(^|\/)package\.json$/.test(x) && !/(^|\/)node_modules\//.test(x))) {
    const text = read(f);
    if (text === null) continue;
    let pkg;
    try { pkg = JSON.parse(text); } catch { continue; }
    const deps = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    if (!deps) continue;
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/") + 1) : "";
    if (!LOCKS.some((l) => set.has(dir + l))) findings.push({ file: f, line: 1, message: "has dependencies and no lockfile next to it" });
  }
  return { pass: findings.length === 0, findings };
}
