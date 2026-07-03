import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPECTED_EVIDENCE_CLASS,
  assertDockerLiveInstallEvidence,
} from "../scripts/assert-docker-live-install-evidence.mjs";

function makePassReport() {
  return {
    ok: true,
    evidence_class: EXPECTED_EVIDENCE_CLASS,
    steps: [
      {
        id: "installed_cli_product_cli_install",
        status: "pass",
        reason_code: "INSTALLED_CLI_EVIDENCE_OK",
      },
      {
        id: "installed_cli_installed_help",
        status: "pass",
        reason_code: "INSTALLED_CLI_EVIDENCE_OK",
      },
      {
        id: "installed_cli_installed_doctor",
        status: "pass",
        reason_code: "INSTALLED_CLI_EVIDENCE_OK",
      },
      {
        id: "operator_preflight",
        status: "skip",
        reason_code: "INSTALL_EVIDENCE_OK",
      },
      { id: "claim_audit", status: "pass", reason_code: "INSTALL_EVIDENCE_OK" },
    ],
  };
}

describe("assert-docker-live-install-evidence", () => {
  it("accepts mac_docker_live_installed_cli with required substeps", () => {
    const result = assertDockerLiveInstallEvidence(makePassReport());
    assert.equal(result.ok, true);
    assert.equal(result.failures.length, 0);
  });

  it("rejects doctor fail without specific reason codes", () => {
    const report = makePassReport();
    const doctor = report.steps.find((s) => s.id === "installed_cli_installed_doctor");
    doctor.status = "fail";
    doctor.reason_code = "INSTALL_EVIDENCE_INSTALLED_CLI_FAIL";
    report.ok = false;
    const result = assertDockerLiveInstallEvidence(report);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes("INSTALLED_CLI_DOCTOR_FAIL")));
  });

  it("accepts doctor fail when specific reason codes are preserved", () => {
    const report = makePassReport();
    const doctor = report.steps.find((s) => s.id === "installed_cli_installed_doctor");
    doctor.status = "fail";
    doctor.reason_code = "INSTALLED_CLI_DOCTOR_FAIL";
    doctor.evidence_reason_code = "INSTALL_EVIDENCE_INSTALLED_CLI_FAIL";
    report.ok = false;
    const result = assertDockerLiveInstallEvidence(report);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes("report.ok")));
    assert.ok(!result.failures.some((f) => f.includes("INSTALLED_CLI_DOCTOR_FAIL")));
  });
});
