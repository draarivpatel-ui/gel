// No node imports here: this file also runs in a browser. `read(file)` returns the file text or null.
//
// Mirrors SonarCloud S6505 (a package install that runs lifecycle scripts) and S8543 (running an unpinned
// package with npx or bunx). A dependency's install script runs with the job's token and secrets, so CI installs
// with `--ignore-scripts`, and runs one-off tools from a pinned version or from what is already installed.
// Fails when a workflow or composite action line:
//   - runs `bun install|add|i`, `npm ci|install|i|add`, `pnpm install|add|i` or `yarn install|add` without `--ignore-scripts`
//   - runs `npx` or `bunx` on a package with no `@version` and no `--no-install`
// Global installs (`-g`, `--global`) and comment lines are skipped.
// Existing hits are frozen in docs/gel.json as "install_ignore_scripts": {"baseline": {"<file>": <count>}}: a file may
// only get cleaner, a file not listed must be clean. Lower the numbers after fixing files.
export const name = "install-ignore-scripts";

const INSTALL = /(^|[\s;&|(`'"])(?:bun\s+(?:install|add|i)|npm\s+(?:ci|install|add|i)|pnpm\s+(?:install|add|i)|yarn\s+(?:install|add))(?=\s|$|[;&|)`'"])/;
const GLOBAL = /\s(?:-g|--global)(?=\s|$)/;
const RUNNER = /(^|[\s;&|(`'"])(npx|bunx)((?:\s+[^\s;&|)`'"]+)+)/;
const SAFE_RUN = /(^|\s)--(?:no-install|no|offline)(?=\s|$)/;

const isWorkflow = (f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || /^\.github\/actions\/.+\/action\.ya?ml$/.test(f);

// The package a runner call names: the first word that is not a flag. Pinned when it carries `@version`.
function unpinnedPackage(args) {
  for (const w of args.trim().split(/\s+/)) {
    if (w.startsWith("-")) continue;
    const bare = w.startsWith("@") ? w.slice(1) : w;
    return bare.includes("@") ? null : w;
  }
  return null;
}

// Every hit in one file, ignoring the baseline.
export function hitsFor(file, text) {
  if (!isWorkflow(file)) return [];
  const out = [];
  text.split("\n").forEach((raw, i) => {
    if (/^\s*#/.test(raw) || /^\s*-?\s*uses\s*:/.test(raw)) return;
    const line = raw.replace(/\s+#.*$/, "");
    if (INSTALL.test(line) && !/--ignore-scripts/.test(line) && !GLOBAL.test(line)) {
      out.push({ file, line: i + 1, message: `install runs dependency scripts, add --ignore-scripts (S6505): ${line.trim().replace(/^-\s*(run:\s*)?|^run:\s*/, "").slice(0, 80)}` });
    }
    const m = RUNNER.exec(line);
    if (m && !SAFE_RUN.test(m[3]) && !GLOBAL.test(m[3])) {
      const pkg = unpinnedPackage(m[3]);
      if (pkg && !pkg.includes("${{") && !/^\$/.test(pkg)) out.push({ file, line: i + 1, message: `${m[2]} runs unpinned "${pkg}": pin it as ${pkg}@<version> or use ${m[2]} --no-install (S8543)` });
    }
  });
  return out;
}

export function run({ files, cfg, read }) {
  const baseline = cfg?.install_ignore_scripts?.baseline ?? {};
  const findings = [];
  for (const f of files) {
    if (!isWorkflow(f)) continue;
    const text = read(f);
    if (text == null) continue;
    const hits = hitsFor(f, text);
    if (hits.length > Number(baseline[f] ?? 0)) findings.push(...hits);
  }
  return { pass: findings.length === 0, findings };
}
