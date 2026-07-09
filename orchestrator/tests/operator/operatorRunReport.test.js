"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  deriveRunAnalystMetrics,
  buildRunReportArtifacts,
  runOperatorReport,
} = require("../../modules/operator/operator-run-report");
const { loadOperatorTraceContext } = require("../../modules/operator/operator-trace-command");

const FIXTURES = path.join(__dirname, "..", "fixtures", "operator-trace-summary");
const CLI_PATH = path.join(__dirname, "..", "..", "ai-minions-cli.js");
const ORCH_CWD = path.join(__dirname, "..", "..");

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

function loadFixtureCtx(name) {
  return loadOperatorTraceContext({
    filePath: path.join(FIXTURES, name),
    existsSync: (p) => !String(p).includes("report-bundles"),
    readFileSync: (p) => loadFixture(path.basename(p)),
    repoRoot: "/tmp/repo",
  });
}

test("deriveRunAnalystMetrics counts gate blocks and iterations from session_end", () => {
  const ctx = loadFixtureCtx("blocked.v1.jsonl");
  assert.equal(ctx.ok, true);
  const metrics = deriveRunAnalystMetrics(ctx.rows);
  assert.equal(typeof metrics.gate_blocks, "number");
  assert.ok(Array.isArray(metrics.flakiness_signals));
});

test("buildRunReportArtifacts includes required markdown sections", () => {
  const ctx = loadFixtureCtx("complete.v1.jsonl");
  assert.equal(ctx.ok, true);
  const artifacts = buildRunReportArtifacts(ctx);
  assert.match(artifacts.operator_report, /Operator report/);
  assert.match(artifacts.operator_report, /Flow metrics/);
  assert.match(artifacts.operator_report, /Not claimed/);
  assert.match(artifacts.operator_report, /not billing/i);
  assert.match(artifacts.management_summary, /Management summary/);
  assert.match(artifacts.management_summary, /Not claimed/);
  assert.match(artifacts.cerberus_review_input, /\*\*Subject:\*\*/);
  assert.match(artifacts.cerberus_review_input, /estimated \/ not billing/i);
  assert.match(artifacts.cerberus_review_input, /Verdict requested/);
});

test("buildCerberusReviewInputMd rejects unsupported claim posture in ask list", () => {
  const ctx = loadFixtureCtx("degraded.v1.jsonl");
  assert.equal(ctx.ok, true);
  const artifacts = buildRunReportArtifacts(ctx);
  assert.match(artifacts.cerberus_review_input, /No unsupported ROI\/billing\/productivity claims/);
});

test("runOperatorReport writes three files to out dir", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "run-report-"));
  const result = runOperatorReport({
    filePath: path.join(FIXTURES, "complete.v1.jsonl"),
    outDir: tmp,
    loadContext: (opts) => loadOperatorTraceContext({
      ...opts,
      existsSync: (p) => !String(p).includes("report-bundles"),
      readFileSync: (p) => {
        const base = path.basename(p);
        if (FIXTURES.endsWith(path.dirname(p)) || fs.existsSync(path.join(FIXTURES, base))) {
          return loadFixture(base);
        }
        return fs.readFileSync(p, "utf8");
      },
      repoRoot: "/tmp/repo",
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  for (const name of ["OPERATOR_REPORT.md", "MANAGEMENT_SUMMARY.md", "CERBERUS_REVIEW_INPUT.md"]) {
    const abs = path.join(tmp, name);
    assert.ok(fs.existsSync(abs), `missing ${name}`);
    assert.ok(fs.statSync(abs).size > 0);
  }
});

test("runOperatorReport missing trace exits 2", () => {
  const result = runOperatorReport({
    runId: "no-such-run-analyst-fixture",
    outDir: path.join(os.tmpdir(), "run-report-missing"),
    loadContext: () => ({
      ok: false,
      code: "TRACE_NOT_FOUND",
      reason_code: "OPERATOR_TRACE_NOT_FOUND",
      result_code: "RUN_NOT_FOUND",
      next_safe_action: "Provide --run-id",
      trace_file: null,
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
});

test("ai-minions report without selector exits 1", () => {
  const r = spawnSync(process.execPath, [CLI_PATH, "report"], {
    encoding: "utf8",
    cwd: ORCH_CWD,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires --run/);
});

test("ai-minions report --file writes artifacts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "run-report-cli-"));
  const trace = path.join(FIXTURES, "complete.v1.jsonl");
  const r = spawnSync(
    process.execPath,
    [CLI_PATH, "report", "--file", trace, "--out", tmp],
    { encoding: "utf8", cwd: ORCH_CWD },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /OPERATOR_REPORT\.md/);
  assert.ok(fs.existsSync(path.join(tmp, "MANAGEMENT_SUMMARY.md")));
});

test("ai-minions --help documents report command", () => {
  const r = spawnSync(process.execPath, [CLI_PATH, "--help"], {
    encoding: "utf8",
    cwd: ORCH_CWD,
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /report\s+Read-only RUN_ANALYST/);
  assert.match(r.stdout, /--latest/);
});
