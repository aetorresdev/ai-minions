import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  REASON_CODES,
  buildAttachTemplate,
  formatInspectBlockersForForm,
  formatReportText,
  runCollectRunReport,
  validateTraceForBundle,
  writeBundleFiles,
} from "../scripts/collect-run-report.mjs";

describe("collect-run-report", () => {
  it("validateTraceForBundle rejects malformed JSONL", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "collect-report-"));
    fs.writeFileSync(path.join(tmp, "task-bad.jsonl"), "{ bad json\n");

    const result = validateTraceForBundle("task-bad", tmp);
    assert.equal(result.ok, false);
    assert.ok(result.checks.some((c) => c.reason_code === REASON_CODES.TRACE_NOT_READABLE));
  });

  it("fails malformed JSONL before bundle write", async () => {
    const traces = fs.mkdtempSync(path.join(os.tmpdir(), "collect-traces-"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "collect-out-"));
    fs.writeFileSync(path.join(traces, "task-bad.jsonl"), "{ bad json\n");

    const report = await runCollectRunReport({
      taskId: "task-bad",
      tracesDir: traces,
      outDir: out,
      invokeStatus: () => {
        throw new Error("status should not run");
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.bundle_dir, null);
    assert.ok(report.checks.some((c) => c.reason_code === REASON_CODES.TRACE_NOT_READABLE));
    assert.equal(fs.readdirSync(out).length, 0);
  });

  it("writes bundle files when trace and inspect pass", async () => {
    const traces = fs.mkdtempSync(path.join(os.tmpdir(), "collect-traces-"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "collect-out-"));
    fs.writeFileSync(path.join(traces, "task-ok.jsonl"), '{"event":"session_start"}\n');

    const mockInvoke = () => ({ exitCode: 0, stdout: "ok output\n", stderr: "" });

    const report = await runCollectRunReport({
      taskId: "task-ok",
      tracesDir: traces,
      outDir: out,
      invokeStatus: mockInvoke,
      invokePanel: mockInvoke,
      invokeExplain: mockInvoke,
    });

    assert.equal(report.ok, true);
    assert.equal(report.bundle_dir, out);
    assert.ok(fs.existsSync(path.join(out, "manifest.json")));
    assert.ok(fs.existsSync(path.join(out, "inspect-report.json")));
    assert.ok(fs.existsSync(path.join(out, "trace", "task-ok.jsonl")));
    assert.ok(fs.existsSync(path.join(out, "artifacts", "status.txt")));
    assert.ok(fs.existsSync(path.join(out, "ATTACH.md")));
    assert.ok(fs.existsSync(path.join(out, "privacy-scan.json")));
    assert.ok(fs.existsSync(path.join(out, "shareable", "trace", "task-ok.jsonl")));
    assert.match(formatReportText(report), /BUNDLE_OK/);
  });

  it("redacts sensitive shapes in shareable bundle copies", async () => {
    const traces = fs.mkdtempSync(path.join(os.tmpdir(), "collect-traces-"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "collect-out-"));
    const sk = "sk-" + "x".repeat(21);
    const email = "user" + "@" + "example.com";
    fs.writeFileSync(
      path.join(traces, "task-privacy.jsonl"),
      `${JSON.stringify({ event: "session_start", goal: `leak ${sk} ${email}` })}\n`,
    );

    const report = await runCollectRunReport({
      taskId: "task-privacy",
      tracesDir: traces,
      outDir: out,
      skipPanels: true,
      invokeStatus: () => ({ exitCode: 0, stdout: "ok\n", stderr: "" }),
      invokeExplain: () => ({ exitCode: 0, stdout: "summary\n", stderr: "" }),
    });

    const shareableTrace = fs.readFileSync(
      path.join(out, "shareable", "trace", "task-privacy.jsonl"),
      "utf8",
    );
    assert.ok(!shareableTrace.includes(sk));
    assert.ok(!shareableTrace.includes(email));
    assert.ok(report.checks.some((c) => c.id === "privacy_scan"));
  });

  it("collects bundle when inspect fails but trace is valid", async () => {
    const traces = fs.mkdtempSync(path.join(os.tmpdir(), "collect-traces-"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "collect-out-"));
    fs.writeFileSync(path.join(traces, "task-warn.jsonl"), '{"event":"session_start"}\n');

    const report = await runCollectRunReport({
      taskId: "task-warn",
      tracesDir: traces,
      outDir: out,
      skipPanels: true,
      invokeStatus: () => ({ exitCode: 2, stdout: "", stderr: "" }),
      invokeExplain: () => ({ exitCode: 0, stdout: "summary\n", stderr: "" }),
    });

    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => c.reason_code === REASON_CODES.INSPECT_BLOCKED));
    assert.ok(fs.existsSync(path.join(out, "manifest.json")));
  });

  it("buildAttachTemplate aligns with operator feedback issue form fields", () => {
    const text = buildAttachTemplate({
      taskId: "task-1",
      bundleDir: "/tmp/bundle",
      repoCommit: "abc123",
      inspectOk: false,
      inspectChecks: [
        {
          reason_code: "INSPECT_STATUS_TRACE_MISSING",
          status: "fail",
          message: "missing",
        },
      ],
      files: [
        "manifest.json",
        "trace/task-1.jsonl",
        "inspect-report.json",
        "artifacts/status.txt",
        "artifacts/explain-run.txt",
      ],
    });
    assert.match(text, /task-1/);
    assert.match(text, /INSPECT_STATUS_TRACE_MISSING/);
    assert.match(text, /operator-feedback-issue\.md/);
    assert.match(text, /Operator path/);
    assert.match(text, /Inspect verdict/);
    assert.match(text, /Report bundle path/);
    assert.match(text, /Severity/);
    assert.doesNotMatch(text, /planned for a later release/);
    assert.doesNotMatch(text, /trace-panel/);
  });

  it("formatInspectBlockersForForm returns (none) when inspect passed", () => {
    assert.equal(formatInspectBlockersForForm([]), "(none)");
  });

  it("ATTACH.md only lists existing files when skipPanels is true", async () => {
    const traces = fs.mkdtempSync(path.join(os.tmpdir(), "collect-traces-"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "collect-out-"));
    fs.writeFileSync(path.join(traces, "task-skip.jsonl"), '{"event":"session_start"}\n');

    const mockInvoke = () => ({ exitCode: 0, stdout: "ok\n", stderr: "" });

    await runCollectRunReport({
      taskId: "task-skip",
      tracesDir: traces,
      outDir: out,
      skipPanels: true,
      invokeStatus: mockInvoke,
      invokeExplain: mockInvoke,
    });

    const attach = fs.readFileSync(path.join(out, "ATTACH.md"), "utf8");
    assert.doesNotMatch(attach, /artifacts\/trace-panel\.txt/);
    assert.doesNotMatch(attach, /artifacts\/budget-panel\.txt/);
    assert.match(attach, /artifacts\/status\.txt/);
    assert.match(attach, /artifacts\/explain-run\.txt/);
    assert.equal(fs.existsSync(path.join(out, "artifacts", "trace-panel.txt")), false);
    assert.equal(fs.existsSync(path.join(out, "artifacts", "budget-panel.txt")), false);
  });

  it("writeBundleFiles lists manifest and trace copy", () => {
    const traces = fs.mkdtempSync(path.join(os.tmpdir(), "collect-traces-"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "collect-out-"));
    const traceFile = path.join(traces, "task-x.jsonl");
    fs.writeFileSync(traceFile, '{"event":"session_start"}\n');

    const written = writeBundleFiles({
      taskId: "task-x",
      traceFile,
      bundleDir: out,
      inspectReport: {
        ok: true,
        task_id: "task-x",
        traces_dir: traces,
        trace_file: traceFile,
        checks: [],
        panels: {},
      },
      panelOutputs: {
        status: { exit_code: 0, stdout: "status\n", stderr: "" },
      },
      repoCommit: "deadbeef",
      tracesDir: traces,
    });

    assert.ok(written.files.includes("manifest.json"));
    assert.ok(fs.existsSync(written.manifestPath));
    assert.ok(fs.existsSync(written.attachPath));
  });
});
