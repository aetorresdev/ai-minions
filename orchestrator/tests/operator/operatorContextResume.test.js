"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  deriveTrustClassification,
  buildContextPackageSummary,
  runOperatorContext,
  runOperatorResume,
  RUN_RESUME_NOT_IMPLEMENTED,
  ELIGIBLE_NOT_SUPPORTED_BANNER,
  deriveResumeNextSafeAction,
} = require("../../modules/operator/operator-context-resume");
const { loadOperatorTraceContext } = require("../../modules/operator/operator-trace-command");

const FIXTURE = path.join(__dirname, "..", "fixtures", "context-disclosure-trace.v1.jsonl");
const CLI_PATH = path.join(__dirname, "..", "..", "ai-minions-cli.js");
const ORCH_CWD = path.join(__dirname, "..", "..");

function loadFixture() {
  return fs.readFileSync(FIXTURE, "utf8");
}

describe("operator-context-resume trust classification", () => {
  it("maps disclosure actions to trust buckets", () => {
    assert.equal(deriveTrustClassification("exposed"), "trusted");
    assert.equal(deriveTrustClassification("partial"), "partial");
    assert.equal(deriveTrustClassification("hidden"), "excluded");
  });
});

describe("operator-context-resume buildContextPackageSummary", () => {
  it("extracts package refs and freshness from disclosure fixture", () => {
    const ctx = loadOperatorTraceContext({
      filePath: FIXTURE,
      existsSync: () => true,
      readFileSync: () => loadFixture(),
    });
    assert.equal(ctx.ok, true);
    const summary = buildContextPackageSummary(ctx.rows);
    assert.deepEqual(summary.context_package_refs, ["handoff:dev-001.yaml", "acceptance_criteria"]);
    assert.equal(summary.freshness_marker, "trace_recorded");
    assert.ok(summary.disclosure_items.length >= 3);
    assert.ok(summary.limitations.length > 0);
  });
});

describe("operator-context-resume runOperatorContext", () => {
  it("formats human output with package refs and trust lines", () => {
    const result = runOperatorContext({
      filePath: FIXTURE,
      loadContext: () => loadOperatorTraceContext({
        filePath: FIXTURE,
        existsSync: () => true,
        readFileSync: () => loadFixture(),
      }),
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.text, /package_refs:.*handoff:dev-001\.yaml/);
    assert.match(result.text, /context_package: exposed → trusted/);
    assert.match(result.text, /limitations:/);
  });

  it("exit 2 when trace missing", () => {
    const result = runOperatorContext({
      runId: "missing-context-run",
      loadContext: () => ({
        ok: false,
        reason_code: "OPERATOR_TRACE_NOT_FOUND",
        next_safe_action: "Provide --run-id",
      }),
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.reason_code, "OPERATOR_TRACE_NOT_FOUND");
  });
});

describe("operator-context-resume runOperatorResume", () => {
  it("always returns RUN_RESUME_NOT_IMPLEMENTED with inspect alternatives", () => {
    const result = runOperatorResume({});
    assert.equal(result.exitCode, 2);
    assert.equal(result.reason_code, RUN_RESUME_NOT_IMPLEMENTED);
    assert.equal(result.json.supported, false);
    assert.equal(result.json.selector_provided, false);
    assert.match(result.text, /supported:\s+false/);
    assert.match(result.text, /inspect_instead:/);
    assert.match(result.text, /ai-minions runs --limit 10/);
    assert.match(result.json.next_safe_action, /runs --limit 10/);
    assert.doesNotMatch(result.text, /resume launched/i);
  });

  it("includes checkpoint eligibility banner when eligible but supported false", () => {
    const rows = [
      { event: "session_start", task_id: "t-resume-1", goal: "ship feature", permission_profile: "dev-local" },
      { event: "agent_start", step_id: "s1", agent: "DEV", iteration: 1 },
      { event: "agent_done", step_id: "s1", agent: "DEV", iteration: 1 },
      { event: "recovery_completed", recovery_schema_version: "1", policy: "no_auto_retry", finding_count: 0, clean: true, summary: "clean" },
    ];
    const result = runOperatorResume({
      runId: "t-resume-1",
      loadContext: () => ({
        ok: true,
        run_id: "t-resume-1",
        trace_file: "/tmp/t-resume-1.jsonl",
        rows,
        summary: {},
        skipped: 0,
        truncated: false,
      }),
    });
    assert.equal(result.reason_code, RUN_RESUME_NOT_IMPLEMENTED);
    assert.equal(result.json.supported, false);
    assert.equal(result.json.checkpoint_eligible, true);
    assert.equal(result.json.eligibility_note, ELIGIBLE_NOT_SUPPORTED_BANNER);
    assert.match(result.text, /checkpoint_eligible:\s+true/);
    assert.match(result.text, /eligibility_note:.*product resume is not implemented/);
    assert.match(result.text, /reason_code:\s+RUN_RESUME_NOT_IMPLEMENTED/);
    assert.match(result.json.next_safe_action, /status --run-id t-resume-1 then ai-minions attach --run-id t-resume-1/);
    assert.doesNotMatch(result.json.next_safe_action, /merge|CERBERUS/i);
  });

  it("deriveResumeNextSafeAction prefers status then attach with run-id", () => {
    const withId = deriveResumeNextSafeAction({ run_id: "task-x" });
    assert.match(withId, /status --run-id task-x then ai-minions attach --run-id task-x/);
    assert.match(withId, /product resume is not implemented/);
    const without = deriveResumeNextSafeAction(null);
    assert.match(without, /runs --limit 10/);
    assert.match(without, /smoke/);
  });

  it("resume with missing trace keeps RUN_RESUME_NOT_IMPLEMENTED as primary reason", () => {
    const result = runOperatorResume({
      runId: "missing-resume-run",
      loadContext: () => ({
        ok: false,
        reason_code: "OPERATOR_TRACE_NOT_FOUND",
        next_safe_action: "Provide --run-id",
      }),
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.reason_code, RUN_RESUME_NOT_IMPLEMENTED);
    assert.equal(result.json.supported, false);
    assert.equal(result.json.trace_reason_code, "OPERATOR_TRACE_NOT_FOUND");
    assert.equal(result.json.trace_missing, true);
    assert.match(result.text, /supported:\s+false/);
    assert.match(result.text, /reason_code:\s+RUN_RESUME_NOT_IMPLEMENTED/);
    assert.match(result.text, /trace_reason_code:\s+OPERATOR_TRACE_NOT_FOUND/);
    assert.match(result.json.next_safe_action, /runs --limit 10/);
  });
});

describe("ai-minions-cli context/resume integration", () => {
  it("help documents context and resume as shipped", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "--help"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /context\s+Context package refs/);
    assert.match(r.stdout, /resume\s+Honest resume probe/);
    assert.doesNotMatch(r.stdout, /Planned \(not implemented/);
  });

  it("resume exits 2 with RUN_RESUME_NOT_IMPLEMENTED", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "resume"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
    });
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /RUN_RESUME_NOT_IMPLEMENTED/);
    assert.match(r.stdout, /runs --limit 10/);
  });

  it("resume with missing trace exits 2 with RUN_RESUME_NOT_IMPLEMENTED primary", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "resume", "--run-id", "no-such-resume-e18"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
      env: { ...process.env, ORCH_TRACES_DIR: path.join(ORCH_CWD, "tests", "fixtures", "no-traces-dir") },
    });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /supported:\s+false/);
    assert.match(r.stdout + r.stderr, /reason_code:\s+RUN_RESUME_NOT_IMPLEMENTED/);
    assert.match(r.stdout, /trace_reason_code:\s+OPERATOR_TRACE_NOT_FOUND/);
    assert.doesNotMatch(r.stderr, /reason_code: OPERATOR_TRACE_NOT_FOUND/);
  });

  it("context loads disclosure fixture via --file", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "context", "--file", FIXTURE], {
      encoding: "utf8",
      cwd: ORCH_CWD,
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /acceptance_criteria/);
  });
});
