// A north star number has to come from a run, not from a hand-typed file. The scheduled north-star workflow
// (.github/workflows/north-star.yml) runs north_star.measure and publishes the result to the `north-star` branch:
// the default branch needs a reviewed pull request, so a bot cannot commit there, but it can push to its own branch.
// The branch holds the latest result at the same path as north_star.result, plus history.jsonl (one line per run).
// The guard and `gel north-star` read whichever of the committed file and the branch copy was measured last.
import { execFileSync } from "node:child_process";

export const NS_BRANCH = "north-star";

const git = (root, args, opts = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], ...opts });
const clean = (p) => String(p).replace(/^\.\//, "");

// The branch copy of `path`, or null. A checkout with fetch-depth 0 has origin/north-star; a local clone may have the branch itself.
export function branchResult(root, path) {
  for (const ref of [`origin/${NS_BRANCH}`, NS_BRANCH]) {
    try { return git(root, ["show", `${ref}:${clean(path)}`]); } catch {}
  }
  return null;
}

const measuredAt = (text) => {
  try { const t = Date.parse(JSON.parse(text)?.measuredAt); return Number.isNaN(t) ? -Infinity : t; } catch { return -Infinity; }
};

// The text measured last of the two (the committed one wins a tie, so a fixed-by-hand file is not overridden by an older run).
export function newerResult(committed, measured) {
  if (measured == null) return committed;
  if (committed == null) return measured;
  return measuredAt(measured) > measuredAt(committed) ? measured : committed;
}

// Guard arguments that see the newest result: `files` lists it even when it is only on the branch, and `read` returns the newer copy.
export function northStarArgs(root, cfg, args, readText) {
  const p = cfg?.north_star?.result;
  if (typeof p !== "string" || !p.trim()) return args;
  const committed = readText(root, clean(p));
  const text = newerResult(committed, branchResult(root, p));
  if (text == null) return args;
  const files = args.files.includes(p) ? args.files : [...args.files, p];
  return { ...args, files, read: (f) => (clean(f) === clean(p) ? text : readText(root, f)) };
}

// A tree object for { "a/b.json": blobSha, ... }, nested directories included, built with `git mktree` (no index).
function mktree(root, files) {
  const blobs = [], dirs = new Map();
  for (const [p, sha] of Object.entries(files)) {
    const i = p.indexOf("/");
    if (i < 0) blobs.push(`100644 blob ${sha}\t${p}`);
    else {
      const [d, rest] = [p.slice(0, i), p.slice(i + 1)];
      if (!dirs.has(d)) dirs.set(d, {});
      dirs.get(d)[rest] = sha;
    }
  }
  const lines = [...blobs, ...[...dirs].map(([d, sub]) => `040000 tree ${mktree(root, sub)}\t${d}`)];
  return git(root, ["mktree"], { input: lines.join("\n") + "\n" }).trim();
}

// Commit `result` (text) at `path` plus one history line to the north-star branch and push it. No worktree, no checkout,
// no index: the caller's working copy and branch stay as they are.
export function publish(root, path, result, { remote = "origin", message } = {}) {
  let parent = null;
  try { git(root, ["fetch", "--quiet", remote, `+refs/heads/${NS_BRANCH}:refs/remotes/${remote}/${NS_BRANCH}`]); } catch {}
  try { parent = git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${NS_BRANCH}`]).trim() || null; } catch {}
  let history = "";
  if (parent) try { history = git(root, ["show", `${parent}:history.jsonl`]); } catch {}
  const r = JSON.parse(result);
  history = (history && !history.endsWith("\n") ? history + "\n" : history) + JSON.stringify(r) + "\n";
  const blob = (text) => git(root, ["hash-object", "-w", "--stdin"], { input: text }).trim();
  const tree = mktree(root, { [clean(path)]: blob(result), "history.jsonl": blob(history) });
  const msg = message ?? `north star: ${r.value}${r.unit ? " " + r.unit : ""} vs ${r.baseline} (${r.measuredAt ?? "no date"})${r.run ? "\n\n" + r.run : ""}`;
  const commit = git(root, ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-F", "-"], { input: msg + "\n" }).trim();
  git(root, ["push", "--quiet", remote, `${commit}:refs/heads/${NS_BRANCH}`]);
  return { commit, parent, runs: history.trim().split("\n").length };
}
