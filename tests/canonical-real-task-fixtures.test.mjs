import assert from "node:assert/strict";
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
  formatReportText,
  runCanonicalFixtureVerify,
} from "../scripts/verify-canonical-real-task-fixtures.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DOC = path.join(REPO_ROOT, "docs/how-to/canonical-real-task-fixtures.md");
const SAMPLE_SUDOKU = path.join(
  REPO_ROOT,
  "tests/fixtures/canonical-tasks/sudoku-html-app.sample.html",
);

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

/** Passes every source-text check but throws while loading (flat arrays spread as if nested). */
const CRASH_ON_LOAD_HTML = `<html><body><div id="board" class="grid cell"></div>
<button id="check">Check</button><button id="reset">Reset</button>
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
