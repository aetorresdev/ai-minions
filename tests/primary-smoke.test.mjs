import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_GOAL,
  REASON_CODES,
  buildSmokeInvocation,
  extractTaskId,
  formatReportText,
  inspectSmokeTrace,
  planPrimarySmoke,
  traceFilePath,
} from "../scripts/run-primary-smoke.mjs";

describe("run-primary-smoke", () => {
  it("buildSmokeInvocation uses stable degraded defaults", () => {
    const inv = buildSmokeInvocation();
    assert.equal(inv.argv.includes("--skip-gates"), true);
    assert.equal(inv.argv.at(-1), DEFAULT_GOAL);
    assert.match(inv.shellCommand, /run-orchestrator\.js/);
  });

  it("extractTaskId parses orchestrator result block", () => {
    const sample = "\n─── Result ───────────────────────────────────────────────\nDone:       true\nTask ID:    abc-123\n";
    assert.equal(extractTaskId(sample), "abc-123");
  });

  it("plan fails when orchestrator layout is missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-smoke-"));
    const plan = planPrimarySmoke({ repoRoot: tmp });
    assert.equal(plan.ok, false);
    const layout = plan.checks.find((c) => c.id === "repo_layout");
    assert.equal(layout?.reason_code, REASON_CODES.REPO_LAYOUT);
  });

  it("plan passes when orchestrator runner exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-smoke-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.writeFileSync(path.join(orch, "run-orchestrator.js"), "// stub\n");

    const plan = planPrimarySmoke({ repoRoot: tmp });
    assert.equal(plan.ok, true);
    assert.match(plan.expected.trace_pattern, /traces/);
    assert.deepEqual(plan.expected.stdout_fields, ["Done", "Task ID"]);
  });

  it("inspectSmokeTrace fails when trace file is missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-smoke-traces-"));
    const report = inspectSmokeTrace("missing-task", tmp);
    assert.equal(report.ok, false);
    assert.equal(report.checks[0]?.reason_code, REASON_CODES.TRACE_NOT_FOUND);
    assert.equal(traceFilePath(tmp, "missing-task"), path.join(tmp, "missing-task.jsonl"));
  });

  it("inspectSmokeTrace passes for non-empty JSONL", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-smoke-traces-"));
    const file = path.join(tmp, "task-1.jsonl");
    fs.writeFileSync(file, '{"event":"session_start"}\n');
    const report = inspectSmokeTrace("task-1", tmp);
    assert.equal(report.ok, true);
    assert.equal(report.trace_file, file);
  });

  it("formatReportText includes command and trace pattern in plan mode", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-smoke-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.writeFileSync(path.join(orch, "run-orchestrator.js"), "// stub\n");
    const plan = planPrimarySmoke({ repoRoot: tmp });
    const text = formatReportText({ mode: "plan", plan });
    assert.match(text, /primary-smoke/);
    assert.match(text, /trace_file:/);
    assert.match(text, /run-orchestrator\.js/);
  });
});
