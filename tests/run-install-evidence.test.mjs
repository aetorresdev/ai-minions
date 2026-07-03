import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REASON_CODES,
  formatReportText,
  runInstallEvidence,
} from "../scripts/run-install-evidence.mjs";
import { INSTALLED_CLI_REASON_CODES } from "../scripts/lib/installed-cli-evidence.mjs";

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
    assert.equal(REASON_CODES.INSTALLED_CLI, "INSTALL_EVIDENCE_INSTALLED_CLI_FAIL");
    assert.equal(REASON_CODES.CLAIM_AUDIT, "INSTALL_EVIDENCE_CLAIM_AUDIT_FAIL");
  });

  it("installedCliCi mode runs shim evidence without doctor", async () => {
    const report = await runInstallEvidence({ installedCliCi: true });
    assert.equal(report.evidence_class, "installed_cli_ci");
    const doctor = report.steps.find((s) => s.id === "installed_cli_installed_doctor");
    const help = report.steps.find((s) => s.id === "installed_cli_installed_help");
    assert.equal(doctor?.status, "skip");
    assert.ok(help);
    const install = report.steps.find((s) => s.id === "install");
    assert.equal(install?.status, "skip");
  });

  it("preserves INSTALLED_CLI_HELP_FAIL in report", async () => {
    const report = await runInstallEvidence({
      installedCliCi: true,
      runInstalledCliEvidence: async () => ({
        ok: false,
        home_dir: "/tmp",
        bin_dir: "/tmp/bin",
        steps: [
          {
            id: "product_cli_install",
            reason_code: INSTALLED_CLI_REASON_CODES.OK,
            status: "pass",
            message: "shim ok",
          },
          {
            id: "installed_help",
            reason_code: INSTALLED_CLI_REASON_CODES.HELP,
            status: "fail",
            message: "ai-minions --help failed",
          },
        ],
      }),
    });
    const help = report.steps.find((s) => s.id === "installed_cli_installed_help");
    assert.equal(help?.reason_code, INSTALLED_CLI_REASON_CODES.HELP);
    assert.equal(help?.evidence_reason_code, REASON_CODES.INSTALLED_CLI);
    assert.equal(report.ok, false);
  });

  it("preserves INSTALLED_CLI_DOCTOR_FAIL in live report", async () => {
    const report = await runInstallEvidence({
      runInstalledCliEvidence: async () => ({
        ok: false,
        home_dir: "/tmp",
        bin_dir: "/tmp/bin",
        steps: [
          {
            id: "product_cli_install",
            reason_code: INSTALLED_CLI_REASON_CODES.OK,
            status: "pass",
            message: "shim ok",
          },
          {
            id: "installed_help",
            reason_code: INSTALLED_CLI_REASON_CODES.OK,
            status: "pass",
            message: "help ok",
          },
          {
            id: "installed_doctor",
            reason_code: INSTALLED_CLI_REASON_CODES.DOCTOR,
            status: "fail",
            message: "ai-minions doctor blocked",
          },
        ],
      }),
    });
    const doctor = report.steps.find((s) => s.id === "installed_cli_installed_doctor");
    assert.equal(doctor?.reason_code, INSTALLED_CLI_REASON_CODES.DOCTOR);
    assert.equal(doctor?.evidence_reason_code, REASON_CODES.INSTALLED_CLI);
    assert.equal(report.evidence_class, "mac_docker_live_installed_cli");
    assert.equal(report.ok, false);
  });
});
