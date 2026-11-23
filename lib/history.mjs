// What git remembers about each file, for the risk-history guard: how many commits touched it, how many of them were a
// fix or a revert (read from the commit subject), and when it last changed. Needs full history; on a shallow clone it
// says so and the guard does not apply. Capped, so a large repo stays fast.
import { execFileSync } from "node:child_process";

// git is looked up on PATH like every other git call in GEL (lib/diff.mjs, lib/fs.mjs); the arguments are fixed, never user text
const git = (root, ...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); // NOSONAR
const FIX = /^(fix|hotfix|bugfix)(\(.+\))?!?:|^fix\b|\bhotfix\b/i;
const REVERT = /^revert\b/i;

export function collectHistory(root, { days = 365, maxCommits = 3000 } = {}) {
  try {
    if (git(root, "rev-parse", "--is-shallow-repository").trim() === "true") return { shallow: true, commits: 0, files: {} };
    const out = git(root, "log", `--since=${days}.days`, `-n${maxCommits}`, "--no-merges", "--name-only", "--format=%x01%cI%x02%s", "-z");
    const files = {};
    let commits = 0;
    for (const chunk of out.split("\x01").filter(Boolean)) {
      const [head, ...rest] = chunk.split("\0");
      const [at, subject = ""] = head.split("\x02");
      commits++;
      const kind = REVERT.test(subject) ? "reverts" : FIX.test(subject) ? "fixes" : null;
      for (const f of rest.map((x) => x.trim()).filter(Boolean)) {
        const e = (files[f] ??= { changes: 0, fixes: 0, reverts: 0, lastAt: at });
        e.changes++;
        if (kind) e[kind]++;
        if (at > e.lastAt) e.lastAt = at;
      }
    }
    return { shallow: false, commits, files };
  } catch { return { shallow: true, commits: 0, files: {} }; }
}
