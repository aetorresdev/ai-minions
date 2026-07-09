"use strict";

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");

const {
  buildStepGraph,
  collectGateBlocks,
  formatTraceViewerText,
  loadTraceRowsFromFile,
  resolveTraceFilePath,
  runTraceViewer,
  appendTraceChunk,
  followTraceFile,
} = require("../../modules/operator/runner-trace-viewer");

const goldenClean = fs.readFileSync(
  path.join(__dirname, "..", "fixtures", "golden-path-clean-v1.jsonl"),
  "utf8",
).trim().split("\n").map((l) => JSON.parse(l));

const multiRole = fs.readFileSync(
  path.join(__dirname, "..", "fixtures", "golden-multi-role-chain-v1.jsonl"),
  "utf8",
).trim().split("\n").map((l) => JSON.parse(l));

describe("runner-trace-viewer", () => {
  it("buildStepGraph orders multi-role chain steps", () => {
    const steps = buildStepGraph(multiRole);
    assert.equal(steps.length, 3);
    assert.equal(steps[0].agent, "dev-backend");
    assert.equal(steps[1].agent, "qa");
    assert.equal(steps[2].agent, "cerberus");
    assert.equal(steps[2].status, "success");
  });

  it("collectGateBlocks includes contract_fail and review blockers", () => {
    const rows = [
      ...goldenClean.slice(0, 2),
      {
        event: "contract_fail",
        agent: "dev-backend",
        step_id: "task-golden-v1-i1-dev-backend",
        reason: "[output contract] files_read missing",
        gate_id: "DEV_CONTRACT",
      },
      {
        event: "review_record",
        reviewer_role: "cerberus",
        verdict: "block",
        blockers: ["missing tests"],
      },
    ];
    const blocks = collectGateBlocks(rows);
    assert.ok(blocks.some((b) => b.kind === "contract_fail"));
    assert.ok(blocks.some((b) => b.kind === "review_blocker" && /missing tests/.test(b.reason)));
  });

  it("formatTraceViewerText shows step graph and terminal status", () => {
    const text = formatTraceViewerText(goldenClean, { trace_file: "/tmp/golden.jsonl" });
    assert.match(text, /Runner trace view/);
    assert.match(text, /task-golden-v1/);
    assert.match(text, /terminal_status:\s+done/);
    assert.match(text, /dev-backend/);
    assert.match(text, /Step graph/);
    assert.match(text, /Gate blocks/);
  });

  it("resolveTraceFilePath resolves run id under traces dir", () => {
    const p = resolveTraceFilePath({
      runId: "task-abc",
      tracesDir: "/tmp/traces",
    });
    assert.equal(p, path.join("/tmp/traces", "task-abc.jsonl"));
  });

  it("loadTraceRowsFromFile reports missing trace", () => {
    const loaded = loadTraceRowsFromFile(path.join(os.tmpdir(), "no-such-trace-runner-viewer.jsonl"));
    assert.equal(loaded.ok, false);
    assert.equal(loaded.error, "trace file not found");
  });

  it("runTraceViewer snapshot reads fixture file", async () => {
    const fixture = path.join(__dirname, "..", "fixtures", "golden-path-clean-v1.jsonl");
    const result = await runTraceViewer({ filePath: fixture });
    assert.equal(result.ok, true);
    assert.match(result.text || "", /terminal_status:\s+done/);
  });

  it("runTraceViewer follow rejects missing trace before polling", async () => {
    const missing = path.join(os.tmpdir(), `task-missing-follow-${Date.now()}.jsonl`);
    const result = await runTraceViewer({ filePath: missing, follow: true });
    assert.equal(result.ok, false);
    assert.equal(result.error, "trace file not found");
  });

  it("appendTraceChunk retains partial line until newline completes JSON", () => {
    const sessionEnd = JSON.stringify({
      event: "session_end",
      task_id: "task-split",
      done: true,
      iterations: 1,
    });
    const mid = Math.floor(sessionEnd.length / 2);
    const first = appendTraceChunk("", `${sessionEnd.slice(0, mid)}`);
    assert.equal(first.rows.length, 0);
    assert.ok(first.carry.length > 0);
    const second = appendTraceChunk(first.carry, `${sessionEnd.slice(mid)}\n`);
    assert.equal(second.carry, "");
    assert.equal(second.rows.length, 1);
    assert.equal(second.rows[0].event, "session_end");
  });

  it("followTraceFile exits when session_end appended", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runner-trace-follow-"));
    const filePath = path.join(tmp, "task-follow.jsonl");
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ event: "session_start", task_id: "task-follow", ts_ms: 1 })}\n`,
    );

    const followPromise = followTraceFile(filePath, { pollMs: 50, maxWaitMs: 5000 });

    setTimeout(() => {
      fs.appendFileSync(
        filePath,
        `${JSON.stringify({
          event: "agent_start",
          agent: "dev-backend",
          step_id: "s1",
          step_index: 0,
          iteration: 1,
          task: "work",
          ts_ms: 2,
        })}\n`,
      );
      fs.appendFileSync(
        filePath,
        `${JSON.stringify({
          event: "session_end",
          task_id: "task-follow",
          done: false,
          iterations: 1,
          summary: "stopped",
          ts_ms: 3,
        })}\n`,
      );
    }, 120);

    const result = await followPromise;
    assert.equal(result.sessionEnded, true);
    assert.ok(result.rows.some((r) => r.event === "session_end"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("followTraceFile exits when session_end arrives in two chunks", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runner-trace-split-"));
    const filePath = path.join(tmp, "task-split-chunk.jsonl");
    const sessionEnd = JSON.stringify({
      event: "session_end",
      task_id: "task-split-chunk",
      done: true,
      iterations: 1,
      summary: "ok",
      ts_ms: 3,
    });
    const mid = Math.floor(sessionEnd.length / 2);
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ event: "session_start", task_id: "task-split-chunk", ts_ms: 1 })}\n`,
    );

    const followPromise = followTraceFile(filePath, { pollMs: 50, maxWaitMs: 5000 });

    setTimeout(() => {
      fs.appendFileSync(filePath, sessionEnd.slice(0, mid));
    }, 80);
    setTimeout(() => {
      fs.appendFileSync(filePath, `${sessionEnd.slice(mid)}\n`);
    }, 180);

    const result = await followPromise;
    assert.equal(result.sessionEnded, true);
    assert.ok(result.rows.some((r) => r.event === "session_end"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("runner-tui-cli trace command", () => {
  const cliPath = path.join(__dirname, "..", "..", "runner-tui-cli.js");
  const fixture = path.join(__dirname, "..", "fixtures", "golden-path-clean-v1.jsonl");

  it("trace --file prints step graph (exit 0)", () => {
    const r = cp.spawnSync(process.execPath, [cliPath, "trace", "--file", fixture], {
      encoding: "utf8",
      cwd: path.join(__dirname, "..", ".."),
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Step graph/);
    assert.match(r.stdout, /dev-backend/);
  });

  it("trace missing file exits 2", () => {
    const r = cp.spawnSync(
      process.execPath,
      [cliPath, "trace", "--run-id", "task-does-not-exist-runner-trace"],
      {
        encoding: "utf8",
        cwd: path.join(__dirname, "..", ".."),
        env: { ...process.env, ORCH_TRACES_DIR: os.tmpdir() },
      },
    );
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}\n${r.stderr}`, /trace file not found/);
  });

  it("trace --follow missing file exits 2", () => {
    const r = cp.spawnSync(
      process.execPath,
      [cliPath, "trace", "--follow", "--run-id", "task-does-not-exist-runner-trace-follow"],
      {
        encoding: "utf8",
        cwd: path.join(__dirname, "..", ".."),
        env: { ...process.env, ORCH_TRACES_DIR: os.tmpdir() },
      },
    );
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}\n${r.stderr}`, /trace file not found/);
  });
});
