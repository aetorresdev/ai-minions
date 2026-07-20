import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  MATRIX_DOC_REQUIRED_MARKERS,
  REASON_CODES,
  SIX_MODE_ROWS,
  assessCredentialPresence,
  assessMatrixRow,
  validateMatrixDoc,
} from "../scripts/lib/tester-six-mode-matrix-data.mjs";
import {
  formatReportText,
  runTesterSixModeMatrix,
} from "../scripts/run-tester-six-mode-matrix.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_DOC = path.join(REPO_ROOT, "docs/how-to/tester-six-mode-matrix.md");

describe("tester-six-mode-matrix-data", () => {
  it("defines exactly six rows covering the matrix", () => {
    assert.equal(SIX_MODE_ROWS.length, 6);
    const ids = SIX_MODE_ROWS.map((r) => r.id).sort();
    assert.deepEqual(ids, [
      "ma-hybrid",
      "ma-local_only",
      "ma-remote_ok",
      "sa-hybrid",
      "sa-local_only",
      "sa-remote_ok",
    ]);
  });

  it("committed runbook passes validateMatrixDoc", () => {
    const text = fs.readFileSync(MATRIX_DOC, "utf8");
    const check = validateMatrixDoc(text);
    assert.equal(check.ok, true, check.errors.join("; "));
    assert.ok(MATRIX_DOC_REQUIRED_MARKERS.length > 10);
  });

  it("hybrid rows always honest-skip", () => {
    for (const row of SIX_MODE_ROWS.filter((r) => r.inference_mode === "hybrid")) {
      const result = assessMatrixRow(row, {
        credentials: assessCredentialPresence({
          ANTHROPIC_API_KEY: "x",
          OPENAI_API_KEY: "y",
        }),
        localBackendReachable: true,
        skipLive: false,
      });
      assert.equal(result.status, "skip");
      assert.equal(result.reason_code, REASON_CODES.SKIP_HYBRID_UNSUPPORTED);
    }
  });

  it("remote_ok skips when no provider token present", () => {
    const row = SIX_MODE_ROWS.find((r) => r.id === "sa-remote_ok");
    const result = assessMatrixRow(row, {
      credentials: assessCredentialPresence({}),
      skipLive: false,
    });
    assert.equal(result.status, "skip");
    assert.equal(result.reason_code, REASON_CODES.SKIP_REMOTE_CREDENTIALS_MISSING);
  });

  it("remote_ok ready when any one provider token present", () => {
    const row = SIX_MODE_ROWS.find((r) => r.id === "sa-remote_ok");
    const result = assessMatrixRow(row, {
      credentials: assessCredentialPresence({ OPENAI_API_KEY: "token-present" }),
      skipLive: false,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.reason_code, REASON_CODES.READY);
  });

  it("local_only skips when local backend explicitly unreachable", () => {
    const row = SIX_MODE_ROWS.find((r) => r.id === "sa-local_only");
    const result = assessMatrixRow(row, {
      credentials: assessCredentialPresence({}),
      localBackendReachable: false,
      skipLive: false,
    });
    assert.equal(result.status, "skip");
    assert.equal(result.reason_code, REASON_CODES.SKIP_LOCAL_BACKEND_MISSING);
  });

  it("local_only does not require remote tokens", () => {
    const row = SIX_MODE_ROWS.find((r) => r.id === "sa-local_only");
    const result = assessMatrixRow(row, {
      credentials: assessCredentialPresence({}),
      localBackendReachable: true,
      skipLive: false,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.reason_code, REASON_CODES.READY);
  });

  it("assessCredentialPresence never returns secret values", () => {
    const c = assessCredentialPresence({
      ANTHROPIC_API_KEY: "sk-ant-secret-should-not-leak",
      OPENAI_API_KEY: "",
    });
    assert.equal(c.anthropic, "present");
    assert.equal(c.openai, "missing");
    assert.equal(c.any_provider, true);
    const serialized = JSON.stringify(c);
    assert.equal(serialized.includes("sk-ant"), false);
  });
});

describe("run-tester-six-mode-matrix", () => {
  it("structure gate passes on committed doc with --skip-live semantics", async () => {
    const report = await runTesterSixModeMatrix({
      repoRoot: REPO_ROOT,
      skipLive: true,
      env: {},
      localBackendReachable: null,
    });
    assert.equal(report.ok, true);
    assert.equal(report.steps[0].id, "matrix_doc");
    assert.equal(report.steps[0].status, "pass");
    const hybrid = report.rows.filter((r) => r.id.includes("hybrid"));
    assert.equal(hybrid.length, 2);
    for (const h of hybrid) {
      assert.equal(h.reason_code, REASON_CODES.SKIP_HYBRID_UNSUPPORTED);
    }
    const text = formatReportText(report);
    assert.match(text, /tester-six-mode-matrix: OK/);
    assert.doesNotMatch(text, /sk-ant|sk-proj|AKIA/);
  });

  it("fails when matrix doc is missing markers", async () => {
    const report = await runTesterSixModeMatrix({
      repoRoot: path.join(REPO_ROOT, "does-not-exist-matrix-root"),
      skipLive: true,
      env: {},
    });
    assert.equal(report.ok, false);
    assert.equal(report.steps[0].reason_code, REASON_CODES.DOC_FAIL);
  });

  it("remote rows skip without credentials under skip-live", async () => {
    const report = await runTesterSixModeMatrix({
      repoRoot: REPO_ROOT,
      skipLive: true,
      env: {},
      localBackendReachable: true,
    });
    const saRemote = report.rows.find((r) => r.id === "sa-remote_ok");
    assert.equal(saRemote.reason_code, REASON_CODES.SKIP_REMOTE_CREDENTIALS_MISSING);
  });
});
