import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  checkCohortGuardRecord,
  checkGuidedPathChecklist,
  checkIssueEvidenceChain,
  checkPerformativeBetaGuard,
  REASON_CODES,
  formatReportText,
  runBetaCohortGuard,
} from "../scripts/run-beta-cohort-guard.mjs";
import {
  checkPerformativeBetaClaims,
  checkNoPrimaryDevPathInChecklist,
  checkLivePassCohortDocContract,
} from "../scripts/lib/beta-cohort-guard-data.mjs";

describe("beta-cohort-guard-data", () => {
  it("checkPerformativeBetaClaims allows negated lines", () => {
    const failures = [];
    checkPerformativeBetaClaims(
      "Not claimed: external beta is open until cohort guard passes.",
      "test.md",
      (msg) => failures.push(msg),
    );
    assert.equal(failures.length, 0);
  });

  it("checkPerformativeBetaClaims fails affirmative external beta open", () => {
    const failures = [];
    checkPerformativeBetaClaims(
      "The external beta is open for all testers.",
      "test.md",
      (msg) => failures.push(msg),
    );
    assert.ok(failures.length > 0);
  });

  it("checkNoPrimaryDevPathInChecklist fails required npm run row", () => {
    const failures = [];
    checkNoPrimaryDevPathInChecklist(
      "| B.1 | `npm run ai-minions` smoke | yes | | bad |",
      "checklist.md",
      (msg) => failures.push(msg),
    );
    assert.ok(failures.some((f) => f.includes("npm run ai-minions")));
  });
});

describe("run-beta-cohort-guard", () => {
  it("checkLivePassCohortDocContract passes on repo docs", () => {
    const result = checkLivePassCohortDocContract();
    assert.equal(result.ok, true, result.failures.join("; "));
  });

  it("checkLivePassCohortDocContract rejects Optional live attestation", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "live-pass-doc-"));
    const guardDir = path.join(tmp, "docs/how-to");
    fs.mkdirSync(guardDir, { recursive: true });
    const bad = "Optional live attestation\n";
    for (const name of ["beta-cohort-guard.md", "beta-tester-guide.md", "beta-known-limitations.md"]) {
      fs.writeFileSync(path.join(guardDir, name), bad);
    }
    const result = checkLivePassCohortDocContract({ repoRoot: tmp });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes("Optional live attestation")));
  });

  it("checkGuidedPathChecklist passes on repo checklist", () => {
    const result = checkGuidedPathChecklist();
    assert.equal(result.ok, true, result.failures.join("; "));
  });

  it("checkPerformativeBetaGuard passes on repo docs", () => {
    const result = checkPerformativeBetaGuard();
    assert.equal(result.ok, true, result.failures.join("; "));
  });

  it("checkIssueEvidenceChain passes on repo", () => {
    const result = checkIssueEvidenceChain();
    assert.equal(result.ok, true, result.failures.join("; "));
  });

  it("checkCohortGuardRecord passes on repo record", () => {
    const result = checkCohortGuardRecord();
    assert.equal(result.ok, true, result.failures.join("; "));
  });

  it("checkCohortGuardRecord fails when cohort_guard missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cohort-record-"));
    const recordDir = path.join(tmp, "docs/how-to/evidence");
    fs.mkdirSync(recordDir, { recursive: true });
    fs.writeFileSync(
      path.join(recordDir, "human-ready-rehearsal-record.json"),
      JSON.stringify({ schema_version: 2, record: {} }),
    );
    const result = checkCohortGuardRecord({ repoRoot: tmp });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes("cohort_guard")));
  });

  it("runBetaCohortGuard chains steps with mocks", async () => {
    const report = await runBetaCohortGuard({
      runHumanReady: async () => ({ ok: true, steps: [] }),
      runInstalled: async () => ({ ok: true, steps: [] }),
    });
    const ids = report.steps.map((s) => s.id);
    assert.ok(ids.includes("human_ready_rehearsal"));
    assert.ok(ids.includes("performative_beta_guard"));
    assert.ok(ids.includes("live_pass_doc_contract"));
    assert.ok(ids.includes("cohort_guard_record"));
    assert.equal(report.ok, true, formatReportText(report));
  });

  it("uses COHORT_GUARD reason codes", () => {
    assert.equal(REASON_CODES.LIVE_PASS, "COHORT_GUARD_LIVE_PASS_DOC_FAIL");
    assert.equal(REASON_CODES.RECORD, "COHORT_GUARD_RECORD_FAIL");
  });
});
