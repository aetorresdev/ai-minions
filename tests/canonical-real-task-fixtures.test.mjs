import assert from "node:assert/strict";
import fs from "node:fs";
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
