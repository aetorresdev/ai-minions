"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  deriveDoctorFieldSummary,
  deriveRedactionStatus,
  resolveLatestBundleDir,
  resolveEvidenceArtifactPaths,
  runOperatorDoctor,
  runOperatorEvidence,
} = require("../../modules/operator/operator-doctor-evidence");

const FIXTURES = path.join(__dirname, "..", "fixtures", "operator-trace-summary");
const CLI_PATH = path.join(__dirname, "..", "..", "ai-minions-cli.js");
const ORCH_CWD = path.join(__dirname, "..", "..");

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

describe("operator-doctor-evidence doctor", () => {
  it("formats field summary and preserves bridge reason codes", async () => {
    const report = {
      ok: false,
      layer_stopped: "runner",
      traces_dir: "/tmp/traces",
      bootstrap: {
        checks: [
          { id: "node_version", reason_code: "PREFLIGHT_OK", status: "pass", message: "Node ok" },
          { id: "claude_cli", reason_code: "PREFLIGHT_OK", status: "pass", message: "skipped" },
        ],
      },
      runtime_preflight: { overall_status: "ok", components: [] },
      checks: [
        {
          id: "runner_blocker_0",
          layer: "runner",
          reason_code: null,
          operator_reason_code: "OPERATOR_OLLAMA_UNREACHABLE",
          status: "fail",
          message: "ollama backend unreachable",
        },
      ],
    };

    const fields = deriveDoctorFieldSummary(report);
    assert.equal(fields.host_prerequisites, "pass");
    assert.equal(fields.provider_reachability, "unreachable");
    assert.equal(fields.auth_status, "not_checked");

    const result = await runOperatorDoctor({
      repoRoot: ORCH_CWD,
      install: false,
      loadOperatorPreflightModule: async () => ({
        runOperatorPreflight: async () => report,
      }),
      buildRunPreflightFn: async () => ({
        ok: false,
        model_policy: "local_only",
        provider: "ollama",
        selected_model: null,
        override_source: null,
        selection_reason: null,
        discovered_models: [],
        ollama_reachable: false,
        blockers: ["ollama backend unreachable"],
      }),
    });

    assert.equal(result.exitCode, 2);
    assert.match(result.text, /ai-minions doctor/);
    assert.match(result.text, /OPERATOR_OLLAMA_UNREACHABLE/);
    assert.match(result.text, /next_safe_action:/);
    assert.equal(result.json.command, "doctor");
  });

  it("exit 0 when preflight bridge passes", async () => {
    const report = {
      ok: true,
      layer_stopped: null,
      traces_dir: "/tmp/traces",
      bootstrap: { checks: [{ id: "node_version", reason_code: "PREFLIGHT_OK", status: "pass", message: "ok" }] },
      runtime_preflight: { overall_status: "ok", components: [] },
      checks: [
        {
          id: "runner_layer",
          layer: "runner",
          reason_code: null,
          operator_reason_code: "OPERATOR_OK",
          status: "pass",
          message: "runner launch preflight passed",
        },
      ],
    };

    const result = await runOperatorDoctor({
      loadOperatorPreflightModule: async () => ({
        runOperatorPreflight: async () => report,
      }),
      buildRunPreflightFn: async () => ({
        ok: true,
        model_policy: "local_only",
        provider: "ollama",
        selected_model: "qwen2.5-coder:7b",
        override_source: null,
        selection_reason: "default",
        discovered_models: ["qwen2.5-coder:7b"],
        ollama_reachable: true,
        blockers: [],
      }),
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.ok, true);
    assert.match(result.text, /host_prerequisites:\s+pass/);
  });
});

describe("operator-doctor-evidence bundle resolution", () => {
  it("resolveLatestBundleDir picks newest matching directory", () => {
    const repoRoot = path.join(ORCH_CWD, "tests", "fixtures", "bundle-repo");
    const bundleRoot = path.join(repoRoot, "report-bundles");
    const oldDir = path.join(bundleRoot, "task-abc-old");
    const newDir = path.join(bundleRoot, "task-abc-new");
    const bundle = resolveLatestBundleDir("task-abc", repoRoot, {
      existsSync: (p) => p === bundleRoot || p === oldDir || p === newDir,
      readdirSync: () => ["task-abc-old", "other", "task-abc-new"],
      statSync: (p) => ({
        isDirectory: () => true,
        mtimeMs: p === newDir ? 200 : 100,
      }),
    });
    assert.equal(bundle, newDir);
  });

  it("deriveRedactionStatus reads privacy-scan reason_code", () => {
    const status = deriveRedactionStatus("/bundle", {
      existsSync: (p) => p === "/bundle" || p === "/bundle/privacy-scan.json",
      readFileSync: () => JSON.stringify({ reason_code: "PRIVACY_OK" }),
    });
    assert.equal(status.status, "privacy_scan_present");
    assert.equal(status.reason_code, "PRIVACY_OK");
  });

  it("resolveEvidenceArtifactPaths maps inspect report and ATTACH.md", () => {
    const bundleDir = "/repo/report-bundles/run-1-stamp";
    const paths = resolveEvidenceArtifactPaths("run-1", "/repo", {
      existsSync: (p) => p === path.join("/repo", "report-bundles")
        || p === bundleDir
        || p === path.join(bundleDir, "inspect-report.json")
        || p === path.join(bundleDir, "ATTACH.md"),
      readdirSync: () => ["run-1-stamp"],
      statSync: () => ({ isDirectory: () => true, mtimeMs: 1 }),
    });
    assert.equal(paths.attach_bundle, bundleDir);
    assert.equal(paths.report_path, path.join(bundleDir, "inspect-report.json"));
    assert.equal(paths.attach_md, path.join(bundleDir, "ATTACH.md"));
  });
});

describe("operator-doctor-evidence runOperatorEvidence", () => {
  it("includes trace paths, missing bundle, and inspect panel", () => {
    const result = runOperatorEvidence({
      runId: "task-evidence-1",
      repoRoot: ORCH_CWD,
      loadContext: () => ({
        ok: true,
        run_id: "task-evidence-1",
        trace_file: "/traces/task-evidence-1.jsonl",
        rows: [
          { event: "session_start", task_id: "task-evidence-1", flow_mode: "single_agent", ts_ms: 1 },
          { event: "session_end", task_id: "task-evidence-1", done: true, iterations: 1, ts_ms: 2 },
        ],
        summary: {
          outcome: "complete",
          missing_evidence: [],
          artifacts: { trace: "/traces/task-evidence-1.jsonl", report: null, attach_bundle: null },
        },
        skipped: 0,
        truncated: false,
      }),
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.text, /trace_path:\s+\/traces\/task-evidence-1\.jsonl/);
    assert.match(result.text, /attach_bundle:\s+\(not collected\)/);
    assert.match(result.text, /missing_evidence:.*attach_bundle/);
    assert.match(result.text, /Control plane - read-only run inspect/);
    assert.equal(result.json.redaction_status, "bundle_not_collected");
  });

  it("loads fixture trace via file path", () => {
    const result = runOperatorEvidence({
      filePath: path.join(FIXTURES, "complete.v1.jsonl"),
      repoRoot: ORCH_CWD,
      loadContext: () => {
        const { loadOperatorTraceContext } = require("../../modules/operator/operator-trace-command");
        return loadOperatorTraceContext({
          filePath: path.join(FIXTURES, "complete.v1.jsonl"),
          existsSync: () => true,
          readFileSync: (p) => loadFixture(path.basename(p)),
        });
      },
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.text, /ai-minions evidence/);
  });

  it("exit 2 when trace missing", () => {
    const result = runOperatorEvidence({
      runId: "missing-evidence-run",
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

describe("ai-minions-cli doctor/evidence integration", () => {
  it("help documents doctor and evidence as shipped", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "--help"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /doctor\s+Bootstrap \+ runtime \+ runner preflight/);
    assert.match(r.stdout, /evidence\s+Trace\/bundle paths/);
    assert.doesNotMatch(r.stdout, /doctor.*not implemented/i);
  });

  it("evidence with missing trace exits 2", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "evidence", "--run-id", "no-such-evidence-e18"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
      env: { ...process.env, ORCH_TRACES_DIR: path.join(ORCH_CWD, "tests", "fixtures", "no-traces-dir") },
    });
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /OPERATOR_TRACE_NOT_FOUND/);
  });
});
