import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  TRIGGER_CODES,
  assessDegradedModeFromEvents,
  assessDegradedModeFromTrace,
} from "../scripts/lib/degraded-mode-evidence.mjs";
import { REASON_CODES, runInspectRunEvidence } from "../scripts/inspect-run-evidence.mjs";
import { runCollectRunReport } from "../scripts/collect-run-report.mjs";

describe("degraded-mode-evidence", () => {
  it("clean trace has no degraded signals", () => {
    const assessment = assessDegradedModeFromEvents([
      { event: "session_start", local_only_mode: true, goal: "smoke" },
      { event: "session_end" },
    ]);
    assert.equal(assessment.degraded_mode, false);
    assert.equal(assessment.disqualifies_beta_success, false);
    assert.equal(assessment.risk_acceptance_reason, null);
  });

  it("skip-gates degraded_mode disqualifies beta success", () => {
    const assessment = assessDegradedModeFromEvents([
      { event: "session_start" },
      { event: "degraded_mode", reason: "skipStateMcp=true" },
    ]);
    assert.equal(assessment.degraded_mode, true);
    assert.equal(assessment.disqualifies_beta_success, true);
    assert.equal(assessment.risk_acceptance_reason, TRIGGER_CODES.SKIP_GATES);
  });

  it("register_task failure maps to MCP missing", () => {
    const assessment = assessDegradedModeFromEvents([
      { event: "degraded_mode", reason: "register_task failed: orchestrator-state unavailable" },
    ]);
    assert.equal(assessment.disqualifies_beta_success, true);
    assert.match(assessment.risk_acceptance_reason ?? "", /DEGRADED_MCP_MISSING/);
  });

  it("privacy unavailable on remote-capable run disqualifies", () => {
    const assessment = assessDegradedModeFromEvents([
      { event: "session_start", local_only_mode: false },
      { event: "privacy_scan", reason_code: "PRIVACY_SCAN_UNAVAILABLE" },
    ]);
    assert.equal(assessment.disqualifies_beta_success, true);
    assert.match(assessment.risk_acceptance_reason ?? "", /DEGRADED_PRIVACY_SCAN_REMOTE_UNAVAILABLE/);
  });

  it("assessDegradedModeFromTrace reads JSONL file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "degraded-trace-"));
    const trace = path.join(tmp, "task-deg.jsonl");
    fs.writeFileSync(
      trace,
      `${JSON.stringify({ event: "degraded_mode", reason: "skipStateMcp=true" })}\n`,
    );
    const assessment = assessDegradedModeFromTrace(trace);
    assert.equal(assessment.disqualifies_beta_success, true);
  });
});

describe("inspect degraded wiring", () => {
  it("surfaces INSPECT_DEGRADED_BETA_INELIGIBLE for skip-gates trace", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inspect-deg-"));
    fs.writeFileSync(
      path.join(tmp, "task-skip.jsonl"),
      [
        JSON.stringify({ event: "session_start" }),
        JSON.stringify({ event: "degraded_mode", reason: "skipStateMcp=true" }),
      ].join("\n") + "\n",
    );

    const report = await runInspectRunEvidence({
      taskId: "task-skip",
      tracesDir: tmp,
      invokeStatus: () => ({ exitCode: 0, stdout: "ok\n", stderr: "" }),
      invokePanel: () => ({ exitCode: 0, stdout: "ok\n", stderr: "" }),
      invokeExplain: () => ({ exitCode: 0, stdout: "ok\n", stderr: "" }),
    });

    assert.equal(report.ok, true);
    assert.equal(report.degraded_assessment?.disqualifies_beta_success, true);
    assert.ok(
      report.checks.some(
        (c) => c.reason_code === REASON_CODES.DEGRADED_BETA_INELIGIBLE && c.status === "warn",
      ),
    );
  });
});

describe("collect degraded wiring", () => {
  it("writes degraded fields into manifest and ATTACH", async () => {
    const traces = fs.mkdtempSync(path.join(os.tmpdir(), "collect-deg-traces-"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "collect-deg-out-"));
    fs.writeFileSync(
      path.join(traces, "task-deg.jsonl"),
      `${JSON.stringify({ event: "degraded_mode", reason: "skipStateMcp=true" })}\n`,
    );
    const mockInvoke = () => ({ exitCode: 0, stdout: "ok\n", stderr: "" });

    const report = await runCollectRunReport({
      taskId: "task-deg",
      tracesDir: traces,
      outDir: out,
      invokeStatus: mockInvoke,
      invokePanel: mockInvoke,
      invokeExplain: mockInvoke,
    });

    assert.equal(report.ok, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    assert.equal(manifest.degraded_mode, true);
    assert.equal(manifest.disqualifies_beta_success, true);
    assert.match(manifest.risk_acceptance_reason, /DEGRADED_SKIP_GATES/);
    const attach = fs.readFileSync(path.join(out, "ATTACH.md"), "utf8");
    assert.match(attach, /Disqualifies beta success:\*\* yes/);
  });
});
