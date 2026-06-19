import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REASON_CODES,
  formatReportText,
  runInstallEvidence,
} from "../scripts/run-install-evidence.mjs";

describe("run-install-evidence", () => {
  it("skips live install by default in --skip-live mode and runs claim audit", async () => {
    const report = await runInstallEvidence({ skipLive: true });
    const install = report.steps.find((s) => s.id === "install");
    const operator = report.steps.find((s) => s.id === "operator_preflight");
    const claim = report.steps.find((s) => s.id === "claim_audit");
    assert.equal(install?.status, "skip");
    assert.equal(operator?.status, "skip");
    assert.equal(claim?.status, "pass");
    assert.equal(report.evidence_class, "ci_claim_audit");
  });

  it("skips npm test by default", async () => {
    const report = await runInstallEvidence({ skipLive: true });
    const npm = report.steps.find((s) => s.id === "npm_test");
    assert.equal(npm?.status, "skip");
  });

  it("formatReportText includes evidence_class", async () => {
    const report = await runInstallEvidence({ skipLive: true });
    const text = formatReportText(report);
    assert.match(text, /install evidence/);
    assert.match(text, /evidence_class/);
  });

  it("uses INSTALL_EVIDENCE reason codes on failure paths", () => {
    assert.equal(REASON_CODES.INSTALL, "INSTALL_EVIDENCE_INSTALL_FAIL");
    assert.equal(REASON_CODES.CLAIM_AUDIT, "INSTALL_EVIDENCE_CLAIM_AUDIT_FAIL");
  });
});
