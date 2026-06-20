import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  MINIMUM_GATE_CELLS,
  buildEmptyMatrixRecord,
  validateGateResults,
  validateMatrixDoc,
  validateMatrixRecord,
} from "../scripts/lib/beta-smoke-matrix-data.mjs";
import {
  REASON_CODES,
  formatReportText,
  runBetaSmokeMatrix,
} from "../scripts/run-beta-smoke-matrix.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_DOC = path.join(REPO_ROOT, "docs/how-to/beta-smoke-matrix.md");
const MATRIX_RECORD = path.join(
  REPO_ROOT,
  "docs/how-to/evidence/beta-smoke-matrix-record.json",
);

describe("beta-smoke-matrix-data", () => {
  it("committed record matches schema", () => {
    const record = JSON.parse(fs.readFileSync(MATRIX_RECORD, "utf8"));
    const check = validateMatrixRecord(record);
    assert.equal(check.ok, true, check.errors.join("; "));
  });

  it("validateGateResults blocks PENDING required cells", () => {
    const empty = buildEmptyMatrixRecord();
    const check = validateGateResults(
      /** @type {Record<string, unknown>} */ (empty.cells),
      { requireGatePass: true },
    );
    assert.equal(check.ok, false);
    assert.match(check.errors.join(" "), /linux-ollama-sa-trivial/);
  });

  it("validateGateResults accepts PASS and approved EXCEPTION", () => {
    const empty = buildEmptyMatrixRecord();
    const cells = /** @type {Record<string, unknown>} */ (empty.cells);
    for (const def of MINIMUM_GATE_CELLS) {
      if (def.gate !== "required") continue;
      const cell = /** @type {Record<string, unknown>} */ (cells[def.id]);
      cell.result = def.id === "linux-claude-sa-trivial" ? "EXCEPTION" : "PASS";
      if (cell.result === "EXCEPTION") {
        cell.exception = {
          cerberus_approved: true,
          reason: "no remote credentials in CI",
          approved_at: "2026-06-20",
        };
      }
    }
    const check = validateGateResults(cells, { requireGatePass: true });
    assert.equal(check.ok, true, check.errors.join("; "));
  });

  it("matrix doc references all gate cell ids", () => {
    const doc = fs.readFileSync(MATRIX_DOC, "utf8");
    const check = validateMatrixDoc(doc);
    assert.equal(check.ok, true, check.errors.join("; "));
  });
});

describe("run-beta-smoke-matrix", () => {
  it("passes CI structure gate with --skip-live semantics", async () => {
    const report = await runBetaSmokeMatrix({ skipLive: true });
    const doc = report.steps.find((s) => s.id === "matrix_doc");
    const record = report.steps.find((s) => s.id === "matrix_record");
    const claim = report.steps.find((s) => s.id === "claim_audit");
    const gate = report.steps.find((s) => s.id === "matrix_gate");
    assert.equal(doc?.status, "pass");
    assert.equal(record?.status, "pass");
    assert.equal(claim?.status, "pass");
    assert.equal(gate?.status, "skip");
    assert.equal(report.evidence_class, "ci_structure_gate");
    assert.equal(report.ok, true);
  });

  it("fails validate-gate while cells are PENDING", async () => {
    const report = await runBetaSmokeMatrix({ skipLive: false, validateGate: true });
    const gate = report.steps.find((s) => s.id === "matrix_gate");
    assert.equal(gate?.status, "fail");
    assert.equal(report.ok, false);
  });

  it("formatReportText includes evidence_class", async () => {
    const report = await runBetaSmokeMatrix({ skipLive: true });
    const text = formatReportText(report);
    assert.match(text, /beta smoke matrix evidence/);
    assert.match(text, /evidence_class/);
  });

  it("uses SMOKE_MATRIX reason codes", () => {
    assert.equal(REASON_CODES.DOC, "SMOKE_MATRIX_DOC_FAIL");
    assert.equal(REASON_CODES.GATE, "SMOKE_MATRIX_GATE_FAIL");
  });
});
