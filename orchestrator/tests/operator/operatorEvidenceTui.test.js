"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  derivePhaseTimeline,
  buildOperatorEvidenceTuiText,
  runOperatorEvidenceTui,
} = require("../../modules/operator/operator-evidence-tui");
const { loadOperatorTraceContext } = require("../../modules/operator/operator-trace-command");

const FIXTURES = path.join(__dirname, "..", "fixtures", "operator-trace-summary");
const CLI_PATH = path.join(__dirname, "..", "..", "ai-minions-cli.js");
const ORCH_CWD = path.join(__dirname, "..", "..");

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
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

test("derivePhaseTimeline includes session_end marker", () => {
  const ctx = fixtureLoadContext({ filePath: path.join(FIXTURES, "complete.v1.jsonl") });
  assert.equal(ctx.ok, true);
  const timeline = derivePhaseTimeline(ctx.rows);
  assert.ok(timeline.some((l) => l.includes("session_end")));
});

test("buildOperatorEvidenceTuiText includes required read-only panels", () => {
  const ctx = fixtureLoadContext({ filePath: path.join(FIXTURES, "complete.v1.jsonl") });
  assert.equal(ctx.ok, true);
  const text = buildOperatorEvidenceTuiText(ctx);
  assert.match(text, /read-only evidence/i);
  assert.match(text, /Run status/);
  assert.match(text, /Phase timeline/);
  assert.match(text, /Blockers/);
  assert.match(text, /Next safe action/);
  assert.match(text, /Evidence paths/);
  assert.match(text, /Cost \/ token \(estimated — not billing\)/);
  assert.match(text, /Attach status/);
  assert.match(text, /Management preview/);
  assert.match(text, /no edits, approvals, reruns/i);
  assert.match(text, /Not claimed/);
});

test("runOperatorEvidenceTui filePath overrides runId", () => {
  const result = runOperatorEvidenceTui({
    runId: "old-run",
    filePath: path.join(FIXTURES, "complete.v1.jsonl"),
    loadContext: fixtureLoadContext,
  });
  assert.equal(result.ok, true);
  assert.equal(result.run_id, "fix-complete");
  assert.match(result.text, /run_id:\s+fix-complete/);
});

test("runOperatorEvidenceTui missing trace exits 2", () => {
  const result = runOperatorEvidenceTui({
    runId: "missing-tui-fixture",
    loadContext: () => ({
      ok: false,
      reason_code: "OPERATOR_TRACE_NOT_FOUND",
      result_code: "RUN_NOT_FOUND",
      next_safe_action: "Provide --run-id",
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
});

test("ai-minions tui without selector on non-TTY exits with cockpit guidance", () => {
  const r = spawnSync(process.execPath, [CLI_PATH, "tui"], {
    encoding: "utf8",
    cwd: ORCH_CWD,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires a TTY/i);
  assert.match(r.stderr, /ai-minions smoke/);
});

test("ai-minions tui --file renders panels", () => {
  const trace = path.join(FIXTURES, "blocked.v1.jsonl");
  const r = spawnSync(process.execPath, [CLI_PATH, "tui", "--file", trace], {
    encoding: "utf8",
    cwd: ORCH_CWD,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /Management preview/);
});

test("ai-minions tui --run-id resolves from ORCH_TRACES_DIR", () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "tui-traces-"));
  fs.copyFileSync(
    path.join(FIXTURES, "complete.v1.jsonl"),
    path.join(tracesDir, "fix-complete.jsonl"),
  );
  const r = spawnSync(
    process.execPath,
    [CLI_PATH, "tui", "--run-id", "fix-complete"],
    {
      encoding: "utf8",
      cwd: ORCH_CWD,
      env: { ...process.env, ORCH_TRACES_DIR: tracesDir },
    },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /run_id:\s+fix-complete/);
});

test("ai-minions tui --latest picks newest trace", () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "tui-latest-"));
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
    [CLI_PATH, "tui", "--latest"],
    {
      encoding: "utf8",
      cwd: ORCH_CWD,
      env: { ...process.env, ORCH_TRACES_DIR: tracesDir },
    },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /run_id:\s+newer-run/);
});

test("ai-minions --help documents tui command", () => {
  const r = spawnSync(process.execPath, [CLI_PATH, "--help"], {
    encoding: "utf8",
    cwd: ORCH_CWD,
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /tui\s+Interactive cockpit/);
});
