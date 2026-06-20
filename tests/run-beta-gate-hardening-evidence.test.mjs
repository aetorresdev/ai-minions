import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REASON_CODES,
  formatReportText,
  runBetaGateHardeningEvidence,
} from "../scripts/run-beta-gate-hardening-evidence.mjs";

describe("run-beta-gate-hardening-evidence", () => {
  it("runs full CI gate-hardening chain on repo", async () => {
    const report = await runBetaGateHardeningEvidence();
    assert.equal(report.evidence_class, "ci_gate_hardening");
    const ids = report.steps.map((s) => s.id);
    assert.ok(ids.includes("verify_usage_docs"));
    assert.ok(ids.includes("claim_audit"));
    assert.ok(ids.includes("smoke_matrix"));
    assert.ok(ids.includes("contract_tests"));
    assert.equal(report.ok, true, formatReportText(report));
  });

  it("formatReportText includes evidence_class", async () => {
    const report = await runBetaGateHardeningEvidence();
    const text = formatReportText(report);
    assert.match(text, /beta gate hardening evidence/);
    assert.match(text, /evidence_class/);
  });

  it("uses GATE_HARDENING reason codes", () => {
    assert.equal(REASON_CODES.DOCS_VERIFY, "GATE_HARDENING_DOCS_VERIFY_FAIL");
    assert.equal(REASON_CODES.CLAIM_AUDIT, "GATE_HARDENING_CLAIM_AUDIT_FAIL");
  });
});
