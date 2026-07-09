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

function fixtureLoadContext(opts) {
  return loadOperatorTraceContext({
    ...opts,
    existsSync: (p) => !String(p).includes("report-bundles"),
    readFileSync: (p) => {
      const base = path.basename(p);
      if (fs.existsSync(path.join(FIXTURES, base))) {
        return loadFixture(base);
      }
      return fs.readFileSync(p, "utf8");
    },
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
    loadContext: fixtureLoadContext,
  });
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  for (const name of ["OPERATOR_REPORT.md", "MANAGEMENT_SUMMARY.md", "CERBERUS_REVIEW_INPUT.md"]) {
    const abs = path.join(tmp, name);
    assert.ok(fs.existsSync(abs), `missing ${name}`);
    assert.ok(fs.statSync(abs).size > 0);
  }
});

test("runOperatorReport filePath overrides runId for run_id and default out_dir", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "run-report-precedence-"));
  const tracePath = path.join(FIXTURES, "complete.v1.jsonl");
  const result = runOperatorReport({
    runId: "old-run",
    filePath: tracePath,
    cwd,
    loadContext: fixtureLoadContext,
  });
  assert.equal(result.ok, true);
  assert.equal(result.run_id, "fix-complete");
  assert.equal(result.out_dir, path.join(cwd, "report-fix-complete"));
  assert.doesNotMatch(result.out_dir, /old-run/);
});

test("runOperatorReport passes undefined runId to loader when filePath is set", () => {
  /** @type {Record<string, unknown> | null} */
  let captured = null;
  runOperatorReport({
    runId: "old-run",
    filePath: path.join(FIXTURES, "complete.v1.jsonl"),
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), "run-report-capture-")),
    loadContext: (opts) => {
      captured = opts;
      return fixtureLoadContext(opts);
    },
  });
  assert.equal(captured?.runId, undefined);
  assert.ok(captured?.filePath);
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

test("ai-minions report --run with --file uses trace run_id not --run", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "run-report-cli-precedence-"));
  const trace = path.join(FIXTURES, "complete.v1.jsonl");
  const r = spawnSync(
    process.execPath,
    [CLI_PATH, "report", "--run", "old-run", "--file", trace, "--out", tmp],
    { encoding: "utf8", cwd: ORCH_CWD },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /run_id:\s+fix-complete/);
  assert.doesNotMatch(r.stdout, /run_id:\s+old-run/);
  assert.doesNotMatch(r.stdout, /report-old-run/);
});

test("ai-minions report --run-id resolves trace from ORCH_TRACES_DIR", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "run-report-cli-runid-"));
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "traces-runid-"));
  fs.copyFileSync(
    path.join(FIXTURES, "complete.v1.jsonl"),
    path.join(tracesDir, "fix-complete.jsonl"),
  );
  const r = spawnSync(
    process.execPath,
    [CLI_PATH, "report", "--run-id", "fix-complete", "--out", tmp],
    {
      encoding: "utf8",
      cwd: ORCH_CWD,
      env: { ...process.env, ORCH_TRACES_DIR: tracesDir },
    },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /run_id:\s+fix-complete/);
  assert.ok(fs.existsSync(path.join(tmp, "OPERATOR_REPORT.md")));
});

test("ai-minions report --latest picks newest trace by ts_ms", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "run-report-cli-latest-"));
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "traces-latest-"));
  fs.writeFileSync(
    path.join(tracesDir, "older.jsonl"),
    [
      '{"event":"session_start","task_id":"older-run","ts_ms":1}',
      '{"event":"session_end","task_id":"older-run","done":true}',
    ].join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(tracesDir, "newer.jsonl"),
    [
      '{"event":"session_start","task_id":"newer-run","ts_ms":99999}',
      '{"event":"session_end","task_id":"newer-run","done":true}',
    ].join("\n") + "\n",
  );
  const r = spawnSync(
    process.execPath,
    [CLI_PATH, "report", "--latest", "--out", tmp],
    {
      encoding: "utf8",
      cwd: ORCH_CWD,
      env: { ...process.env, ORCH_TRACES_DIR: tracesDir },
    },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /run_id:\s+newer-run/);
  assert.doesNotMatch(r.stdout, /run_id:\s+older-run/);
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
