// Direct coverage for the tiny glob matcher every guard uses to choose files.
// Follow-up gaps noted in #24: lib/diff.mjs, lib/fs.mjs and lib/config.mjs still have no direct unit tests.
import assert from "node:assert/strict";
import { test } from "node:test";
import { globToRegExp, matchAny } from "../lib/glob.mjs";

const cases = [
  ["* matches a name in one directory", "*.mjs", "index.mjs", true],
  ["* does not cross a path separator", "*.mjs", "lib/glob.mjs", false],
  ["* matches dotfiles", "*.mjs", ".env.mjs", true],
  ["* still needs the literal rest of the pattern", "*.test.mjs", "glob.test.mjs", true],
  ["? matches exactly one non-separator character", "file?.mjs", "file1.mjs", true],
  ["? does not match zero characters", "file?.mjs", "file.mjs", false],
  ["? does not match two characters", "file?.mjs", "file12.mjs", false],
  ["? does not cross a path separator", "src?glob.mjs", "src/glob.mjs", false],
  ["** crosses folders", "src/**/*.mjs", "src/lib/glob.mjs", true],
  ["**/ also matches zero folders", "src/**/*.mjs", "src/glob.mjs", true],
  ["a trailing ** matches any depth", "src/**", "src/a/b/c.mjs", true],
  ["** alone matches any path", "**", "a/b/c.txt", true],
  ["a dot in the glob is literal", "src/glob.mjs", "srcXglob.mjs", false],
  ["negation is not supported: ! is a literal prefix", "!secret.txt", "!secret.txt", true],
  ["negation does not exclude a file", "!secret.txt", "secret.txt", false],
  ["backslashes are literal characters, not separators", "lib\\glob.mjs", "lib\\glob.mjs", true],
  // Cases carried over from #46 (AK-Lmn), written as table rows.
  ["* works between a literal prefix and suffix", "src/file-*.mjs", "src/file-a.mjs", true],
  ["* between a prefix and suffix does not cross folders", "src/file-*.mjs", "src/sub/file-a.mjs", false],
  ["* between a prefix and suffix keeps the literal suffix", "src/file-*.mjs", "src/file-a.js", false],
  ["**/ matches deeply nested folders", "**/*.md", "docs/api/v1/spec.md", true],
  ["**/ still needs the literal rest of the pattern", "**/*.md", "docs/guide.txt", false],
  ["a trailing ** matches the bare directory", "src/**", "src/", true],
  ["a trailing ** is anchored at the start", "src/**", "other/src/index.mjs", false],
  ["** matches the empty path", "**", "", true],
  [".* matches a dotfile", ".*", ".gitignore", true],
  [".* does not match a name without a leading dot", ".*", "file", false],
  ["**/.env matches at the repository root", "**/.env", ".env", true],
  ["**/.env matches in a subfolder", "**/.env", "config/.env", true],
  [".github/** matches a workflow file", ".github/**", ".github/workflows/ci.yml", true],
  ["a / pattern does not match a backslash path", "foo/bar", "foo\\bar", false],
  ["a literal pattern is anchored at the end", "docs/gel.json", "docs/gel.jsonl", false],
  ["a literal pattern is anchored at the start", "docs/gel.json", "a/docs/gel.json", false],
  ["a literal pattern does not match a longer path", "docs/gel.json", "docs/gel.json/extra", false],
  ["regex metacharacters are matched literally", "file.[a-z].{1}.(test)+$100.js", "file.[a-z].{1}.(test)+$100.js", true],
  ["regex metacharacters are not interpreted", "file.[a-z].{1}.(test)+$100.js", "file.a.1.test100.js", false],
];

for (const [name, glob, file, expected] of cases) {
  test(name, () => {
    assert.equal(globToRegExp(glob).test(file), expected, `${glob} vs ${file}`);
  });
}

test("matchAny accepts a file matching any one glob", () => {
  assert.equal(matchAny(["*.txt", "src/**/*.mjs"], "src/lib/glob.mjs"), true);
});

test("matchAny rejects a file matching none of the globs", () => {
  assert.equal(matchAny(["*.txt", "src/**/*.mjs"], "public/icon.png"), false);
});

test("matchAny with no globs matches nothing", () => {
  assert.equal(matchAny([], "index.mjs"), false);
});
