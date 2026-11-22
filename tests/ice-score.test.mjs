// ice-score: an ICE table decides what is built first, so its arithmetic, its order and its confidence have to hold up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { iceTables, run } from "../guards/ice-score/index.mjs";

const gel = join(import.meta.dirname, "..", "bin", "gel.mjs");
const TABLE = (rows) => `# Plan\n\nICE below.\n\n| Item | I | C | E | ICE | Phase |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
const judge = (text, cfg = {}) => run({ cfg, files: ["ROADMAP.md"], read: () => text });

test("the guard file has no node import, so it can run in a browser", () => {
  const src = readFileSync(new URL("../guards/ice-score/index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^\s*import\b/m);
});

test("iceTables reads scores, bold cells and phases, and gives each row its line", () => {
  const [t] = iceTables(TABLE(["| First | 8 | 6 | 8 | **384** | P0 |", "| Parked | 6 | 3 | 2 | 36 | Later |"]));
  assert.deepEqual(t.rows.map((r) => [r.line, r.i, r.c, r.e, r.ice, r.rank]), [[7, 8, 6, 8, 384, 0], [8, 6, 3, 2, 36, 99]]);
});

test("the average is named as the mistake", () => {
  const res = judge(TABLE(["| Idea | 8 | 6 | 7 | 7 | P0 |"]));
  assert.equal(res.pass, false);
  assert.match(res.findings[0].message, /8 x 6 x 7 = 336/);
  assert.match(res.findings[0].message, /not the average/);
  assert.equal(res.findings[0].line, 7);
});

test("a later phase that outscores an earlier one is reported on the later row", () => {
  const res = judge(TABLE(["| Pet project | 3 | 5 | 4 | 60 | P0 |", "| The real win | 8 | 6 | 8 | 384 | P1 |"]));
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].line, 8);
  assert.match(res.findings[0].message, /scores 384 in P1 but "Pet project" scores 60 in P0/);
});

test("confidence of 7 or more needs evidence; a link or an Evidence cell is enough; gel.json can move the bar", () => {
  assert.equal(judge(TABLE(["| Sure | 5 | 7 | 5 | 175 | P0 |"])).pass, false);
  assert.equal(judge(TABLE(["| Sure | 5 | 6 | 5 | 150 | P0 |"])).pass, true);
  assert.equal(judge(TABLE(["| Sure ([test](docs/t.md)) | 5 | 7 | 5 | 175 | P0 |"])).pass, true);
  assert.equal(judge(TABLE(["| Sure | 5 | 7 | 5 | 175 | P0 |"]), { ice: { evidence_from: 8 } }).pass, true);
});

test("gel run reports the table of a real file with its line", () => {
  const d = mkdtempSync(join(tmpdir(), "ice-"));
  writeFileSync(join(d, "ROADMAP.md"), TABLE(["| Idea | 8 | 6 | 7 | 7 | P0 |"]));
  const res = spawnSync(process.execPath, [gel, "run", "--root", d], { encoding: "utf8" });
  assert.match(res.stdout, /\| ice-score \| report \| 1 finding\(s\) \|/, res.stdout);
  assert.match(res.stdout, /ROADMAP\.md:7 ICE "Idea"/);
});
