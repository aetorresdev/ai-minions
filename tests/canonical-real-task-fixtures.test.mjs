import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  FIXTURE_DOC_REQUIRED_MARKERS,
  FIXTURE_MATRIX_ROW_IDS,
  REAL_TASK_FIXTURES,
  REASON_CODES,
  SUDOKU_PROMPT,
  findExternalNetworkAssetHits,
  getFixture,
  getFixturePrompt,
  validateFixtureArtifact,
  validateFixtureData,
  validateFixtureDoc,
} from "../scripts/lib/canonical-real-task-fixtures-data.mjs";
import {
  executeInlineScripts,
  extractInlineScripts,
} from "../scripts/lib/fixture-script-execution.mjs";
import {
  SUDOKU_CHECK_CODES,
  checkSudokuArtifactSolution,
  extractSolutionBlocks,
  validateSudokuSolution,
} from "../scripts/lib/sudoku-solution-check.mjs";
import {
  formatReportText,
  runCanonicalFixtureVerify,
} from "../scripts/verify-canonical-real-task-fixtures.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DOC = path.join(REPO_ROOT, "docs/how-to/canonical-real-task-fixtures.md");
const SAMPLE_SUDOKU = path.join(
  REPO_ROOT,
  "tests/fixtures/canonical-tasks/sudoku-html-app.sample.html",
);
const SOLUTION_CASES = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, "tests/fixtures/canonical-tasks/sudoku-solution-cases.json"),
    "utf8",
  ),
);
const SOLUTION_BLOCK_RE = /<script type="application\/json" id="sudoku-solution">[\s\S]*?<\/script>/;

/**
 * The shipped sample with its solution block replaced; `null` removes the block.
 * @param {string | null} blockBody
 */
function sampleWithSolutionBlock(blockBody) {
  const html = fs.readFileSync(SAMPLE_SUDOKU, "utf8");
  assert.match(html, SOLUTION_BLOCK_RE);
  const replacement =
    blockBody === null ? "" : `<script type="application/json" id="sudoku-solution">${blockBody}</script>`;
  return html.replace(SOLUTION_BLOCK_RE, () => replacement);
}

describe("canonical-real-task-fixtures-data", () => {
  it("defines exactly one canonical fixture and covers six matrix rows", () => {
    const data = validateFixtureData();
    assert.equal(data.ok, true, data.errors.join("; "));
    assert.equal(REAL_TASK_FIXTURES.filter((f) => f.status === "canonical").length, 1);
    assert.deepEqual([...FIXTURE_MATRIX_ROW_IDS].sort(), [
      "ma-hybrid",
      "ma-local_only",
      "ma-remote_ok",
      "sa-hybrid",
      "sa-local_only",
      "sa-remote_ok",
    ]);
    for (const fixture of REAL_TASK_FIXTURES) {
      assert.deepEqual([...fixture.matrix_row_ids], [...FIXTURE_MATRIX_ROW_IDS]);
    }
  });

  it("committed how-to passes validateFixtureDoc with exact prompts", () => {
    const text = fs.readFileSync(FIXTURE_DOC, "utf8");
    const check = validateFixtureDoc(text);
    assert.equal(check.ok, true, check.errors.join("; "));
    assert.ok(FIXTURE_DOC_REQUIRED_MARKERS.length > 10);
    assert.equal(text.includes(SUDOKU_PROMPT), true);
  });

  it("getFixturePrompt returns stable sudoku text", () => {
    assert.equal(getFixturePrompt("sudoku-html-app"), SUDOKU_PROMPT);
    assert.equal(getFixture("missing"), undefined);
    assert.throws(() => getFixturePrompt("missing"), /unknown fixture/);
  });

  it("shipped sudoku sample passes functional checks", () => {
    const html = fs.readFileSync(SAMPLE_SUDOKU, "utf8");
    const fixture = getFixture("sudoku-html-app");
    const result = validateFixtureArtifact(fixture, html);
    assert.equal(result.ok, true, result.errors.join("; "));
    assert.equal(findExternalNetworkAssetHits(html).length, 0);
  });

  it("rejects artifacts with external network patterns", () => {
    const fixture = getFixture("sudoku-html-app");
    const bad = `<html><script src="https://cdn.example/x.js"></script><script>fetch("/x")</script></html>`;
    const result = validateFixtureArtifact(fixture, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("external network")));
  });
});

describe("verify-canonical-real-task-fixtures", () => {
  it("structure gate passes on repo root", () => {
    const report = runCanonicalFixtureVerify({ repoRoot: REPO_ROOT });
    assert.equal(report.ok, true, formatReportText(report));
    assert.ok(report.steps.every((s) => s.status === "pass"));
  });

  it("artifact mode fails on missing file with FIXTURE_ARTIFACT_FAIL", () => {
    const report = runCanonicalFixtureVerify({
      repoRoot: REPO_ROOT,
      artifactPath: path.join(REPO_ROOT, "tests/fixtures/canonical-tasks/does-not-exist.html"),
      fixtureId: "sudoku-html-app",
    });
    assert.equal(report.ok, false);
    const artifact = report.steps.find((s) => s.id === "artifact");
    assert.equal(artifact?.reason_code, REASON_CODES.ARTIFACT_FAIL);
  });

  it("artifact mode passes shipped sample", () => {
    const report = runCanonicalFixtureVerify({
      repoRoot: REPO_ROOT,
      artifactPath: SAMPLE_SUDOKU,
      fixtureId: "sudoku-html-app",
    });
    assert.equal(report.ok, true, formatReportText(report));
  });
});

describe("sudoku solution grid check", () => {
  const fixture = getFixture("sudoku-html-app");
  /** @param {{ errors: { code: string }[] }} r */
  const codes = (r) => [...new Set(r.errors.map((e) => e.code))].sort();

  it("prompt and doc require the embedded solution block", () => {
    assert.match(SUDOKU_PROMPT, /id="sudoku-solution"/);
    assert.ok(fixture.functional_checks.some((c) => c.kind === "sudoku_solution_grid"));
  });

  it("passes the valid grid and the shipped sample", () => {
    assert.deepEqual(validateSudokuSolution(SOLUTION_CASES.valid.puzzle, SOLUTION_CASES.valid.solution), {
      ok: true,
      errors: [],
    });
    const html = fs.readFileSync(SAMPLE_SUDOKU, "utf8");
    assert.equal(extractSolutionBlocks(html).length, 1);
    assert.equal(checkSudokuArtifactSolution(html).ok, true);
    const result = validateFixtureArtifact(fixture, html);
    assert.equal(result.checks.find((c) => c.id === "valid_sudoku_solution")?.ok, true);
  });

  it("accepts 9x9 row arrays and '.' for empty puzzle cells", () => {
    const rows = (g) => Array.from({ length: 9 }, (_, r) => g.slice(r * 9, r * 9 + 9).split("").map(Number));
    const dotted = SOLUTION_CASES.valid.puzzle.replace(/0/g, ".");
    assert.equal(validateSudokuSolution(dotted, rows(SOLUTION_CASES.valid.solution)).ok, true);
    assert.equal(validateSudokuSolution(rows(SOLUTION_CASES.valid.puzzle), SOLUTION_CASES.valid.solution).ok, true);
  });

  it("covers every grid failure class with a fixture case", () => {
    const covered = new Set(SOLUTION_CASES.cases.flatMap((c) => c.expect));
    for (const code of [
      SUDOKU_CHECK_CODES.ROW_INVALID,
      SUDOKU_CHECK_CODES.COLUMN_INVALID,
      SUDOKU_CHECK_CODES.BOX_INVALID,
      SUDOKU_CHECK_CODES.GIVEN_CHANGED,
      SUDOKU_CHECK_CODES.GIVEN_MISSING,
      SUDOKU_CHECK_CODES.MALFORMED_GRID,
      SUDOKU_CHECK_CODES.INCOMPLETE_GRID,
      SUDOKU_CHECK_CODES.EMPTY_PUZZLE,
    ]) {
      assert.ok(covered.has(code), `no negative case for ${code}`);
    }
  });

  for (const c of SOLUTION_CASES.cases) {
    it(`rejects ${c.id} (${c.expect.join(", ")})`, () => {
      assert.deepEqual(codes(validateSudokuSolution(c.puzzle, c.solution)), [...c.expect].sort());
      // Embedded in an otherwise passing artifact, only the solution check fails.
      const body = JSON.stringify({ puzzle: c.puzzle, solution: c.solution });
      const result = validateFixtureArtifact(fixture, sampleWithSolutionBlock(body));
      assert.equal(result.ok, false);
      assert.deepEqual(
        result.checks.filter((k) => !k.ok).map((k) => k.id),
        ["valid_sudoku_solution"],
      );
      for (const code of c.expect) {
        assert.ok(
          result.errors.some((e) => e.startsWith(`valid_sudoku_solution: ${code} `)),
          result.errors.join("; "),
        );
      }
    });
  }

  it("names the failing row, column, box and given", () => {
    const byId = Object.fromEntries(SOLUTION_CASES.cases.map((c) => [c.id, c]));
    const messages = (id) =>
      validateSudokuSolution(byId[id].puzzle, byId[id].solution).errors.map((e) => e.message);
    assert.deepEqual(messages("row_duplicate").map((m) => m.split(" is")[0]), ["row 1", "row 2"]);
    assert.deepEqual(messages("column_duplicate").map((m) => m.split(" is")[0]), ["column 4", "column 6"]);
    assert.ok(messages("box_duplicate").every((m) => m.startsWith("box ")));
    assert.ok(messages("given_changed").includes("given 1 at r2c4 changed to 2"));
    assert.ok(messages("given_missing").includes("given 5 at r1c1 is blank in the solution"));
  });

  it("rejects a missing, duplicated, unparsable or non-object solution block", () => {
    const valid = JSON.stringify(SOLUTION_CASES.valid);
    const cases = [
      { html: sampleWithSolutionBlock(null), code: SUDOKU_CHECK_CODES.BLOCK_MISSING },
      {
        html: sampleWithSolutionBlock(
          `${valid}</script><script type="application/json" id="sudoku-solution">${valid}`,
        ),
        code: SUDOKU_CHECK_CODES.BLOCK_DUPLICATE,
      },
      { html: sampleWithSolutionBlock("{puzzle: 1"), code: SUDOKU_CHECK_CODES.BLOCK_INVALID_JSON },
      { html: sampleWithSolutionBlock("[]"), code: SUDOKU_CHECK_CODES.MALFORMED_GRID },
    ];
    for (const { html, code } of cases) {
      assert.deepEqual(codes(checkSudokuArtifactSolution(html)), [code]);
      const result = validateFixtureArtifact(fixture, html);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.startsWith(`valid_sudoku_solution: ${code} `)), result.errors.join("; "));
    }
  });

  it("artifact mode fails with FIXTURE_ARTIFACT_FAIL for an invalid solution", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-sudoku-grid-"));
    try {
      const bad = SOLUTION_CASES.cases.find((c) => c.id === "row_duplicate");
      const file = path.join(dir, "sudoku.html");
      fs.writeFileSync(file, sampleWithSolutionBlock(JSON.stringify({ puzzle: bad.puzzle, solution: bad.solution })));
      const report = runCanonicalFixtureVerify({
        repoRoot: REPO_ROOT,
        artifactPath: file,
        fixtureId: "sudoku-html-app",
      });
      const step = report.steps.find((s) => s.id === "artifact");
      assert.equal(report.ok, false);
      assert.equal(step?.reason_code, REASON_CODES.ARTIFACT_FAIL);
      assert.match(step?.message ?? "", /valid_sudoku_solution: row_invalid/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Passes every source-text check but throws while loading (flat arrays spread as if nested). */
const CRASH_ON_LOAD_HTML = `<html><body><div id="board" class="grid cell"></div>
<button id="check">Check</button><button id="reset">Reset</button>
<script type="application/json" id="sudoku-solution">${JSON.stringify(SOLUTION_CASES.valid)}</script>
<script>
  // sudoku
  const clone = (a) => a.map((r) => [...r]);
  clone([1, 2, 3]);
  document.getElementById("board").textContent = "rendered";
</script></body></html>`;

describe("fixture script execution", () => {
  it("fails an artifact that crashes on load even though every source-text check passes", () => {
    const fixture = getFixture("sudoku-html-app");
    const result = validateFixtureArtifact(fixture, CRASH_ON_LOAD_HTML);
    const exec = result.checks.find((c) => c.id === "executes_without_error");
    assert.equal(exec?.ok, false);
    assert.ok(
      result.checks.filter((c) => c.id !== "executes_without_error").every((c) => c.ok),
      "source-text checks alone must pass for this regression to prove anything",
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /executes_without_error: load .*not iterable/.test(e)), result.errors.join("; "));
  });

  it("passes the shipped sample and reports the execution check as ok", () => {
    const fixture = getFixture("sudoku-html-app");
    const result = validateFixtureArtifact(fixture, fs.readFileSync(SAMPLE_SUDOKU, "utf8"));
    assert.equal(result.checks.find((c) => c.id === "executes_without_error")?.ok, true);
  });

  it("surfaces an exception thrown by a DOMContentLoaded handler", () => {
    const html = `<script>document.addEventListener("DOMContentLoaded", () => { null.x; });</script>`;
    const result = executeInlineScripts(html);
    assert.equal(result.ok, false);
    assert.equal(result.phase, "init");
  });

  it("stops a script that never returns", () => {
    const result = executeInlineScripts("<script>while (true) {}</script>", { timeoutMs: 300 });
    assert.equal(result.ok, false);
    assert.match(result.error, /timed out/);
  });

  it("fails closed when there is no inline script", () => {
    const result = executeInlineScripts(`<html><script src="app.js"></script></html>`);
    assert.equal(result.ok, false);
    assert.equal(result.phase, "extract");
  });

  it("ignores external and non-JavaScript script blocks when extracting", () => {
    const html = `<script src="a.js"></script><script type="application/json">{"a":1}</script><script>var x = 1;</script>`;
    assert.deepEqual(extractInlineScripts(html), ["var x = 1;"]);
  });

  it("blocks filesystem and process access even through a vm escape", () => {
    const marker = path.join(os.tmpdir(), `fixture-exec-probe-${process.pid}`);
    const escape = (body) =>
      `<script>const P = this.constructor.constructor("return process")(); ${body}</script>`;
    const read = executeInlineScripts(escape(`P.getBuiltinModule("fs").readFileSync(${JSON.stringify(import.meta.filename)})`));
    const write = executeInlineScripts(escape(`P.getBuiltinModule("fs").writeFileSync(${JSON.stringify(marker)}, "x")`));
    const spawn = executeInlineScripts(escape(`P.getBuiltinModule("child_process").execSync("id")`));
    for (const r of [read, write, spawn]) {
      assert.equal(r.ok, false);
      assert.match(r.error, /restricted/);
    }
    assert.equal(fs.existsSync(marker), false);
  });

  it("blocks node:sqlite file creation and reads after a vm escape", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-sqlite-"));
    const created = path.join(dir, "created.sqlite");
    const existing = path.join(dir, "existing.sqlite");
    const escape = (body) =>
      `<script>const P = this.constructor.constructor("return process")(); ${body}</script>`;
    try {
      const db = new DatabaseSync(existing);
      db.exec("CREATE TABLE marker (v TEXT)");
      db.prepare("INSERT INTO marker (v) VALUES (?)").run("parent-marker");
      db.close();
      const write = executeInlineScripts(escape(
        `const {DatabaseSync}=P.getBuiltinModule("node:sqlite"); const db=new DatabaseSync(${JSON.stringify(created)}); db.exec("CREATE TABLE harmless_probe (id INTEGER)"); db.close();`,
      ));
      const read = executeInlineScripts(escape(
        `const {DatabaseSync}=P.getBuiltinModule("node:sqlite"); const db=new DatabaseSync(${JSON.stringify(existing)}, {readOnly:true}); db.prepare("SELECT v FROM marker").get();`,
      ));
      assert.equal(write.ok, false);
      assert.equal(read.ok, false);
      assert.match(`${write.error} ${read.error}`, /restricted/);
      assert.equal(fs.existsSync(created), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks node:sqlite reached through require after a vm escape", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-sqlite-require-"));
    const created = path.join(dir, "created.sqlite");
    const existing = path.join(dir, "existing.sqlite");
    const createdGlobal = path.join(dir, "created-global.sqlite");
    try {
      const db = new DatabaseSync(existing);
      db.exec("CREATE TABLE marker (v TEXT)");
      db.prepare("INSERT INTO marker (v) VALUES (?)").run("parent-marker");
      db.close();
      const write = executeInlineScripts(`<script>
        const Module = this.constructor.constructor("return module")();
        const req = Module.createRequire(${JSON.stringify(created)});
        const { DatabaseSync } = req("node:sqlite");
        const db = new DatabaseSync(${JSON.stringify(created)});
        db.exec("CREATE TABLE harmless_probe (id INTEGER)");
        db.close();
        const read = new DatabaseSync(${JSON.stringify(existing)}, { readOnly: true });
        read.prepare("SELECT v FROM marker").get();
        read.close();
      </script>`);
      const viaGlobal = executeInlineScripts(`<script>
        const sqlite = this.constructor.constructor('return globalThis["node:sqlite"]')();
        const db = new sqlite.DatabaseSync(${JSON.stringify(createdGlobal)});
        db.exec("CREATE TABLE harmless_probe (id INTEGER)");
        db.close();
      </script>`);
      const viaLoad = executeInlineScripts(`<script>
        const Module = this.constructor.constructor("return module")();
        const { DatabaseSync } = Module._load("node:sqlite");
        const db = new DatabaseSync(${JSON.stringify(createdGlobal)});
        db.exec("CREATE TABLE harmless_probe (id INTEGER)");
        db.close();
      </script>`);
      assert.equal(write.ok, false);
      assert.equal(viaGlobal.ok, false);
      assert.equal(viaLoad.ok, false);
      assert.equal(fs.existsSync(created), false);
      assert.equal(fs.existsSync(createdGlobal), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when an async DOMContentLoaded handler or window.onload throws", () => {
    const asyncHandler = executeInlineScripts(
      `<script>document.addEventListener("DOMContentLoaded", async () => { throw new Error("async init crash"); });</script>`,
    );
    const onload = executeInlineScripts(
      `<script>window.onload = () => { throw new Error("onload crash"); };</script>`,
    );
    assert.equal(asyncHandler.ok, false);
    assert.equal(asyncHandler.phase, "init");
    assert.match(asyncHandler.error, /async init crash/);
    assert.equal(onload.ok, false);
    assert.equal(onload.phase, "init");
    assert.match(onload.error, /onload crash/);
  });

  it("rejects a forged ok result, including one followed by a non-zero exit", () => {
    const escape = (body) =>
      `<script>const P = this.constructor.constructor("return process")(); ${body}</script>`;
    const exited = executeInlineScripts(escape(
      `P.stdout.write(JSON.stringify({ok:true})+"\\n"); P.exit(7);`,
    ));
    const zero = executeInlineScripts(escape(
      `P.stdout.write(JSON.stringify({ok:true})+"\\n"); P.exit(0);`,
    ));
    assert.equal(exited.ok, false);
    assert.equal(zero.ok, false);
    assert.match(exited.error, /untrusted/);
    assert.match(zero.error, /untrusted/);
  });

  it("rejects a throw rewritten through JSON.stringify and process.exit", () => {
    const rewritten = executeInlineScripts(`<script>
      const P = this.constructor.constructor("return process")();
      const orig = JSON.stringify;
      JSON.stringify = function (value, ...rest) {
        if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "proof")) {
          return orig({ ok: true, proof: value.proof });
        }
        return orig.call(JSON, value, ...rest);
      };
      P.exit = function () { return P.reallyExit(0); };
      throw new Error("forged pass");
    </script>`);
    const viaToJson = executeInlineScripts(`<script>
      Object.prototype.toJSON = function () {
        if (this && Object.prototype.hasOwnProperty.call(this, "proof")) return { ok: true, proof: this.proof };
      };
      const P = this.constructor.constructor("return process")();
      P.exit = function () { return P.reallyExit(0); };
      throw new Error("tojson pass");
    </script>`);
    assert.equal(rewritten.ok, false);
    assert.equal(rewritten.phase, "load");
    assert.match(rewritten.error, /forged pass/);
    assert.equal(viaToJson.ok, false);
    assert.equal(viaToJson.phase, "load");
    assert.match(viaToJson.error, /tojson pass/);
  });

  it("rejects a throw that replaces String before the result is encoded", () => {
    const result = executeInlineScripts(`<script>
      const F = this.constructor.constructor;
      const host = F("return globalThis")();
      const orig = host.String;
      host.String = function (value) {
        if (typeof value === "string" && /^[a-f0-9]{32}$/.test(value)) {
          const P = F("return process")();
          P.stdout.write('{"ok":true,"proof":"' + value + '"}\\n');
          return P.reallyExit(0);
        }
        return orig(value);
      };
      throw new Error("string pass");
    </script>`);
    assert.equal(result.ok, false);
    assert.equal(result.phase, "load");
    assert.match(result.error, /string pass/);
  });

  it("artifact mode fails with FIXTURE_ARTIFACT_FAIL for a crash-on-load file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-exec-"));
    try {
      const file = path.join(dir, "sudoku.html");
      fs.writeFileSync(file, CRASH_ON_LOAD_HTML);
      const report = runCanonicalFixtureVerify({
        repoRoot: REPO_ROOT,
        artifactPath: file,
        fixtureId: "sudoku-html-app",
      });
      const step = report.steps.find((s) => s.id === "artifact");
      assert.equal(report.ok, false);
      assert.equal(step?.reason_code, REASON_CODES.ARTIFACT_FAIL);
      assert.match(step?.message ?? "", /executes_without_error/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
