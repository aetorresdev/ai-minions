import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REASON_CODES,
  checkCloseoutDocHonesty,
  formatReportText,
  runModularCloseoutEvidence,
} from "../scripts/run-modular-closeout-evidence.mjs";

describe("run-modular-closeout-evidence", () => {
  it("runs full closeout dry-run chain on repo", async () => {
    const report = await runModularCloseoutEvidence();
    assert.equal(report.evidence_class, "modular_closeout_dry_run");
    const ids = report.steps.map((s) => s.id);
    assert.ok(ids.includes("claim_audit"));
    assert.ok(ids.includes("root_import_guard"));
    assert.ok(ids.includes("module_boundaries"));
    assert.ok(ids.includes("parity_tests"));
    assert.equal(report.ok, true, formatReportText(report));
  });

  it("closeout docs include honesty markers", () => {
    const result = checkCloseoutDocHonesty();
    assert.equal(result.ok, true, result.failures.join("\n"));
  });

  it("uses CLOSEOUT reason codes", () => {
    assert.equal(REASON_CODES.CLAIM_AUDIT, "CLOSEOUT_CLAIM_AUDIT_FAIL");
    assert.equal(REASON_CODES.ROOT_IMPORT_GUARD, "CLOSEOUT_ROOT_IMPORT_GUARD_FAIL");
  });
});
