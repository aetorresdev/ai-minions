import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  REASON_CODES,
  formatReportText,
  mapTraceCheck,
  runInspectRunEvidence,
} from "../scripts/inspect-run-evidence.mjs";

describe("inspect-run-evidence", () => {
  it("mapTraceCheck converts SMOKE_* to INSPECT_*", () => {
    const mapped = mapTraceCheck({
      id: "trace_file",
      reason_code: "SMOKE_TRACE_NOT_FOUND",
      status: "fail",
      message: "missing",
    });
    assert.equal(mapped.reason_code, REASON_CODES.TRACE_NOT_FOUND);
  });

  it("fails when task_id is missing", async () => {
    const report = await runInspectRunEvidence({ taskId: "" });
    assert.equal(report.ok, false);
    assert.equal(report.checks[0]?.reason_code, REASON_CODES.TASK_ID_MISSING);
  });

  it("fails when trace file is missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inspect-evidence-"));
    const report = await runInspectRunEvidence({
      taskId: "task-missing",
      tracesDir: tmp,
      invokeStatus: () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => c.reason_code === REASON_CODES.TRACE_NOT_FOUND));
  });

  it("passes when trace exists and panels succeed", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inspect-evidence-"));
    fs.writeFileSync(path.join(tmp, "task-ok.jsonl"), '{"event":"session_start"}\n');

    const report = await runInspectRunEvidence({
      taskId: "task-ok",
      tracesDir: tmp,
      invokeStatus: () => ({
        exitCode: 0,
        stdout: "Run status\n  task_id: task-ok\n  terminal_status: done\n",
        stderr: "",
      }),
      invokePanel: () => ({ exitCode: 0, stdout: "trace panel\n", stderr: "" }),
      invokeExplain: () => ({ exitCode: 0, stdout: "Run summary\n", stderr: "" }),
    });

    assert.equal(report.ok, true);
    assert.ok(report.checks.some((c) => c.id === "runner_status" && c.status === "pass"));
    assert.ok(report.checks.some((c) => c.id === "runner_trace" && c.status === "pass"));
    assert.ok(report.checks.some((c) => c.id === "runner_budget" && c.status === "pass"));
    assert.ok(report.checks.some((c) => c.id === "explain_run" && c.status === "pass"));
    const text = formatReportText(report);
    assert.match(text, /INSPECT_OK/);
  });

  it("maps status exit 2 to INSPECT_STATUS_TRACE_MISSING", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inspect-evidence-"));
    fs.writeFileSync(path.join(tmp, "task-2.jsonl"), '{"event":"session_start"}\n');

    const report = await runInspectRunEvidence({
      taskId: "task-2",
      tracesDir: tmp,
      skipPanels: true,
      invokeStatus: () => ({ exitCode: 2, stdout: "", stderr: "" }),
      invokeExplain: () => ({ exitCode: 0, stdout: "ok\n", stderr: "" }),
    });

    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => c.reason_code === REASON_CODES.STATUS_TRACE_MISSING));
  });
});
