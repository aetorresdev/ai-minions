"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  FIRST_RUN_REASON_CODES,
  SMOKE_REASON_CODES,
  classifyDoctorFailure,
  classifySmokeFailure,
  deriveFirstRunNextSafeAction,
  deriveSmokeNextSafeAction,
  formatFirstRunText,
  formatSmokeText,
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

  it("runFirstRun maps RUNTIME_PREFLIGHT_BLOCKED to NEEDS_INIT on a clean checkout (no config)", async () => {
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
              operator_reason_code: "RUNTIME_PREFLIGHT_BLOCKED",
            },
          ],
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, FIRST_RUN_REASON_CODES.NEEDS_INIT);
    assert.match(result.text, /FIRST_RUN_NEEDS_INIT/);
    assert.match(result.text, /next_safe_action:\s+Run: ai-minions init/);
    assert.equal(hasInitConfig(repoRoot), false);
  });

  it("runFirstRun still reports PROVIDER_BLOCKED when config is missing and Ollama is unreachable", async () => {
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
    assert.equal(hasInitConfig(repoRoot), false);
  });

  it("runFirstRun still reports CONFIG_INVALID for CONFIG/BOOTSTRAP failures when config is present", async () => {
    const repoRoot = makeRepoWithOrch();
    const configDir = path.join(repoRoot, ".ai-minions");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "model_policy.json"), "{}\n");
    const result = await runFirstRun({
      cwd: repoRoot,
      install: false,
      runOperatorDoctor: async () => ({
        ok: false,
        report: {
          checks: [
            {
              status: "fail",
              operator_reason_code: "OPERATOR_BOOTSTRAP_CONFIG_INVALID",
            },
          ],
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, FIRST_RUN_REASON_CODES.CONFIG_INVALID);
    assert.match(result.text, /FIRST_RUN_CONFIG_INVALID/);
  });

  it("classifyDoctorFailure maps RUNTIME_PREFLIGHT_BLOCKED to NEEDS_INIT when config absent, CONFIG_INVALID when present", () => {
    const doctorResult = {
      report: {
        checks: [
          { status: "fail", operator_reason_code: "RUNTIME_PREFLIGHT_BLOCKED" },
        ],
      },
    };
    assert.equal(
      classifyDoctorFailure(doctorResult, false),
      FIRST_RUN_REASON_CODES.NEEDS_INIT,
    );
    assert.equal(
      classifyDoctorFailure(doctorResult, true),
      FIRST_RUN_REASON_CODES.UNKNOWN_ERROR,
    );
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
        launched: { task_id: null, terminal_status: "failed" },
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason_code, "SMOKE_BLOCKED");
    assert.match(result.smokeText, /next_safe_action/);
  });

  it("classifySmokeFailure maps contract fail to SMOKE_OUTPUT_CONTRACT from real gate blocks", () => {
    const out = classifySmokeFailure({
      task_id: "task-abc",
      terminal_status: "failed",
      trace_file: "/tmp/task-abc.jsonl",
      summary: {
        what: { last_transition_reason: { reason_code: "MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS" } },
        why: { rollup_contract_fail_steps: 1 },
      },
      gate_blocks: [
        {
          kind: "contract_fail",
          agent: "qa",
          gate_id: "finding_classification_missing",
          reason: "[output contract] qa: output must classify at least one finding",
          reviewer: null,
        },
        {
          kind: "contract_fail",
          agent: "cerberus",
          gate_id: "empty_output",
          reason: "[output contract] cerberus: empty output",
          reviewer: null,
        },
      ],
    });
    assert.equal(out.reason_code, SMOKE_REASON_CODES.OUTPUT_CONTRACT);
    assert.equal(out.failure_class, "output_contract");
    assert.equal(out.gate_id, "finding_classification_missing");
    assert.match(out.message, /qa:/);
    assert.match(out.message, /\+1 more/);
  });

  it("formatSmokeText surfaces output contract failure for operators", () => {
    const text = formatSmokeText({
      ok: false,
      reason_code: SMOKE_REASON_CODES.OUTPUT_CONTRACT,
      task_id: "task-abc",
      terminal_status: "failed",
      skip_gates: true,
      classification: {
        reason_code: SMOKE_REASON_CODES.OUTPUT_CONTRACT,
        failure_class: "output_contract",
        message: "qa: [output contract] qa: output must classify at least one finding (+1 more gate block(s))",
        gate_id: "finding_classification_missing",
        transition_reason: "MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS",
        gate_blocks: [
          {
            kind: "contract_fail",
            agent: "qa",
            gate_id: "finding_classification_missing",
            reason: "[output contract] qa: output must classify at least one finding",
          },
        ],
      },
      next_safe_action: deriveSmokeNextSafeAction({
        ok: false,
        reason_code: SMOKE_REASON_CODES.OUTPUT_CONTRACT,
        task_id: "task-abc",
      }),
    });
    assert.match(text, /failure_class:\s+output_contract/);
    assert.match(text, /gate_id:\s+finding_classification_missing/);
    assert.match(text, /checklist B\.3/);
    assert.match(text, /ai-minions attach --run-id task-abc/);
    assert.doesNotMatch(text, /ai-minions status --run-id task-abc then/);
    assert.doesNotMatch(text, /ai-minions explain --run-id/);
    assert.match(text, /max_iterations=1 is repair rounds/);
  });

  it("deriveSmokeNextSafeAction prefers attach for OUTPUT_CONTRACT and status→attach otherwise", () => {
    assert.match(
      deriveSmokeNextSafeAction({
        ok: true,
        reason_code: SMOKE_REASON_CODES.OK,
        task_id: "task-ok",
      }),
      /status --run-id task-ok then ai-minions attach --run-id task-ok/,
    );
    const b3 = deriveSmokeNextSafeAction({
      ok: false,
      reason_code: SMOKE_REASON_CODES.OUTPUT_CONTRACT,
      task_id: "task-b3",
    });
    assert.match(b3, /attach --run-id task-b3 and inspect the planner output-contract evidence/);
    assert.doesNotMatch(b3, /status --run-id task-b3 then/);
    assert.doesNotMatch(b3, /explain/);
    assert.doesNotMatch(b3, /merge|CERBERUS/i);
  });

  it("runSmoke classifies trace contract failure as SMOKE_OUTPUT_CONTRACT", async () => {
    const result = await runSmoke({
      runStart: async () => ({
        exitCode: 3,
        preflightText: "preflight",
        routingText: "routing",
        text: "start summary",
        launched: { task_id: "task-smoke-1", terminal_status: "failed" },
      }),
      loadRunStatusFromTrace: () => ({
        task_id: "task-smoke-1",
        terminal_status: "failed",
        trace_file: "/tmp/task-smoke-1.jsonl",
        summary: {
          what: {
            last_transition_reason: {
              reason_code: "MAX_ITERATIONS_CERBERUS_BLOCKERS",
              gate_id: "files_read_vs_modified",
            },
          },
          why: { rollup_contract_fail_steps: 1 },
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, SMOKE_REASON_CODES.OUTPUT_CONTRACT);
    assert.equal(result.failure_class, "output_contract");
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
    assert.match(r.stdout, /guided launcher|Web UI/i);
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
    assert.match(r.stdout, /SMOKE_OK/);
  });
});
