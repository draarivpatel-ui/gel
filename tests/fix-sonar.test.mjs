import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bracketLine, sortLine, fixSonar, collectHits } from "../lib/fix-sonar.mjs";
import { run as guard } from "../guards/sonar-patterns/index.mjs";

test("bracketLine wraps a plain test in [[ ]]", () => {
  assert.equal(bracketLine('if [ -f "$x" ]; then'), 'if [[ -f "$x" ]]; then');
  assert.equal(bracketLine('  [ "$a" = "b" ] && echo hi'), '  [[ "$a" = "b" ]] && echo hi');
  assert.equal(bracketLine("true && [ -n \"$A\" ] || exit 1"), 'true && [[ -n "$A" ]] || exit 1');
});

test("bracketLine leaves what means something else in [[ ]]", () => {
  assert.equal(bracketLine('[ -f a -a -f b ]'), null); // -a is "and" in [ ]
  assert.equal(bracketLine('[ "$a" = *.txt ]'), null); // unquoted glob becomes a pattern in [[ ]]
  assert.equal(bracketLine('[ \\( -f a \\) ]'), null);
  assert.equal(bracketLine('[ -f a ] && [ -f b ]'), null); // two tests: left to a person
  assert.equal(bracketLine('echo "no test here"'), null);
});

test("sortLine adds a compare function that keeps string order", () => {
  assert.equal(sortLine("const a = xs.sort();"), "const a = xs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));");
  assert.equal(sortLine("ys.toSorted( )"), "ys.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))");
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  assert.deepEqual(["b", "B", "a", "ä"].sort(cmp), ["b", "B", "a", "ä"].sort());
});

test("fixSonar edits only reported lines and the guard then passes", () => {
  const root = mkdtempSync(join(tmpdir(), "gel-sonar-"));
  mkdirSync(join(root, "scripts"));
  const sh = "scripts/run.sh", js = "scripts/list.mjs";
  writeFileSync(join(root, sh), '#!/usr/bin/env bash\nif [ -f x ]; then echo a; fi\n[ -f a -a -f b ] && echo both\n');
  writeFileSync(join(root, js), "export const names = (xs) => xs.sort();\n");
  const read = (f) => readFileSync(join(root, f), "utf8");
  const before = collectHits(root, [sh, js]);
  assert.equal(before.length, 3);
  const res = fixSonar(root, before);
  assert.equal(res.fixed, 2);
  assert.deepEqual(res.unresolved.map((u) => u.line), [3]);
  assert.match(read(sh), /if \[\[ -f x \]\]; then echo a; fi/);
  assert.match(read(sh), /\[ -f a -a -f b \]/);
  assert.match(read(js), /xs\.sort\(\(a, b\)/);
  const after = guard({ files: [sh, js], cfg: {}, read });
  assert.equal(after.findings.length, 1);
});
