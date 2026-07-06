"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  FIRST_RUN_REASON_CODES,
  classifyDoctorFailure,
  deriveFirstRunNextSafeAction,
  formatFirstRunText,
  hasInitConfig,
  runAttach,
  runFirstRun,
  runSmoke,
  validateTargetRepo,
} = require("../../modules/operator/operator-guided-first-run");

const CLI_PATH = path.join(__dirname, "..", "..", "ai-minions-cli.js");
const SMOKE_SUCCESS_PRELOAD = path.join(
  __dirname,
  "fixtures",
  "smoke-success-preload.cjs",
);
const ORCH_CWD = path.join(__dirname, "..", "..");

function makeRepoWithOrch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guided-first-run-"));
  const orch = path.join(tmp, "orchestrator");
  fs.mkdirSync(orch, { recursive: true });
  fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
  return tmp;
}

describe("operator-guided-first-run", () => {
  it("validateTargetRepo rejects missing orchestrator layout", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guided-bad-"));
    const result = validateTargetRepo(tmp);
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, FIRST_RUN_REASON_CODES.UNSUPPORTED_CWD);
  });

  it("classifyDoctorFailure maps Ollama to PROVIDER_BLOCKED", () => {
    const code = classifyDoctorFailure({
      report: {
        checks: [
          {
            status: "fail",
            operator_reason_code: "OPERATOR_OLLAMA_UNREACHABLE",
          },
        ],
      },
    });
    assert.equal(code, FIRST_RUN_REASON_CODES.PROVIDER_BLOCKED);
  });

  it("runFirstRun returns NEEDS_INIT when doctor ok and config missing", async () => {
    const repoRoot = makeRepoWithOrch();
    const result = await runFirstRun({
      cwd: repoRoot,
      install: false,
      runOperatorDoctor: async () => ({
        ok: true,
        report: { checks: [] },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason_code, FIRST_RUN_REASON_CODES.NEEDS_INIT);
    assert.match(result.text, /next_safe_action/);
    assert.equal(hasInitConfig(repoRoot), false);
  });

  it("runFirstRun returns READY when doctor ok and config present", async () => {
    const repoRoot = makeRepoWithOrch();
    const configDir = path.join(repoRoot, ".ai-minions");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "model_policy.json"), "{}\n");
    const result = await runFirstRun({
      cwd: repoRoot,
      install: false,
      runOperatorDoctor: async () => ({
        ok: true,
        report: { checks: [] },
      }),
    });
    assert.equal(result.reason_code, FIRST_RUN_REASON_CODES.READY);
    assert.match(result.text, /ai-minions smoke/);
  });

  it("runFirstRun preserves FIRST_RUN_PROVIDER_BLOCKED on doctor fail", async () => {
    const repoRoot = makeRepoWithOrch();
    const result = await runFirstRun({
      cwd: repoRoot,
      install: false,
      runOperatorDoctor: async () => ({
        ok: false,
        report: {
          checks: [
            {
              status: "fail",
              operator_reason_code: "OPERATOR_OLLAMA_UNREACHABLE",
            },
          ],
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, FIRST_RUN_REASON_CODES.PROVIDER_BLOCKED);
    assert.match(result.text, /FIRST_RUN_PROVIDER_BLOCKED/);
  });

  it("runAttach requires --run-id", async () => {
    const result = await runAttach({ runId: "" });
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, "ATTACH_RUN_ID_MISSING");
  });

  it("formatFirstRunText includes guided chain", () => {
    const text = formatFirstRunText({
      ok: true,
      reason_code: FIRST_RUN_REASON_CODES.READY,
      repo_root: "/repo",
      doctor_ok: true,
      config_present: true,
      next_safe_action: deriveFirstRunNextSafeAction(FIRST_RUN_REASON_CODES.READY, false),
    });
    assert.match(text, /guided_chain/);
    assert.match(text, /Not claimed: production TUI/);
  });

  it("runSmoke returns ok true and SMOKE_OK when start exits 0", async () => {
    const result = await runSmoke({
      runStart: async () => ({
        exitCode: 0,
        preflightText: "preflight",
        routingText: "routing",
        text: "done",
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason_code, "SMOKE_OK");
  });

  it("runSmoke returns ok false and SMOKE_BLOCKED when start exits non-zero", async () => {
    const result = await runSmoke({
      runStart: async () => ({
        exitCode: 2,
        preflightText: "preflight",
        routingText: "routing",
        text: "blocked",
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason_code, "SMOKE_BLOCKED");
  });
});

describe("ai-minions-cli guided verbs", () => {
  it("--help documents first-run smoke attach", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "--help"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /first-run/);
    assert.match(r.stdout, /smoke/);
    assert.match(r.stdout, /attach/);
    assert.match(r.stdout, /not production TUI/i);
  });

  it("first-run without valid repo exits 2 with FIRST_RUN_UNSUPPORTED_CWD", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guided-cli-bad-"));
    const r = spawnSync(
      process.execPath,
      [CLI_PATH, "first-run", "--cwd", tmp, "--no-install"],
      { encoding: "utf8", cwd: ORCH_CWD },
    );
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /FIRST_RUN_UNSUPPORTED_CWD/);
  });

  it("attach without --run-id exits 1", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "attach"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /ATTACH_RUN_ID_MISSING/);
  });

  it("smoke success does not print SMOKE_OK to stderr", () => {
    const r = spawnSync(
      process.execPath,
      ["-r", SMOKE_SUCCESS_PRELOAD, CLI_PATH, "smoke"],
      { encoding: "utf8", cwd: ORCH_CWD },
    );
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stderr, /reason_code:\s*SMOKE_OK/);
    assert.match(r.stdout, /smoke done/);
  });
});
