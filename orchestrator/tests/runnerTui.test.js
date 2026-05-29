"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");

const {
  buildRunPreflight,
  formatPreflightText,
  normalizeModelPolicy,
} = require("../runner-preflight");
const {
  launchRun,
  loadRunStatusFromTrace,
  formatRunStatusText,
  terminalStatusFromRunResult,
} = require("../runner-launcher");
const { parseCommonArgs } = require("../runner-tui-cli");

const fixtureTags = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "ollama-tags-sample.json"), "utf8"),
);

const mockDiscoverOk = async () => ({
  backends: [{ backend_id: "ollama", available: true, host: "localhost", port: 11434, reason: null }],
  models: fixtureTags.models.map((m) => ({
    name: m.name,
    backend: "ollama",
    family: m.details?.family || null,
    size_bytes: m.size,
    context_length: null,
  })),
  missing_local_backend: null,
});

const mockDiscoverDown = async () => ({
  backends: [{ backend_id: "ollama", available: false, host: "localhost", port: 11434, reason: "connection refused" }],
  models: [],
  missing_local_backend: "ollama unreachable at localhost:11434",
});

const mockSelect = async () => ({
  selected_model: "qwen2.5-coder:7b",
  override_source: "auto",
  selection_reason: "auto rank",
  discovered_models: ["qwen2.5-coder:7b"],
});

describe("runner-preflight", () => {
  it("normalizeModelPolicy accepts remote_ok aliases", () => {
    assert.equal(normalizeModelPolicy("remote-approved"), "remote_ok");
    assert.equal(normalizeModelPolicy("local_only"), "local_only");
  });

  it("remote_ok preflight skips local selection", async () => {
    const pf = await buildRunPreflight({ modelPolicy: "remote_ok" });
    assert.equal(pf.ok, true);
    assert.equal(pf.model_policy, "remote_ok");
    assert.equal(pf.ollama_reachable, null);
  });

  it("local_only preflight ok when discovery and selection succeed", async () => {
    const pf = await buildRunPreflight({
      modelPolicy: "local_only",
      discover: mockDiscoverOk,
      selectLocalModel: mockSelect,
    });
    assert.equal(pf.ok, true);
    assert.equal(pf.selected_model, "qwen2.5-coder:7b");
    assert.equal(pf.ollama_reachable, true);
    assert.match(formatPreflightText(pf), /ok:\s+true/);
  });

  it("local_only preflight blocked when ollama unreachable", async () => {
    const pf = await buildRunPreflight({
      modelPolicy: "local_only",
      discover: mockDiscoverDown,
      selectLocalModel: mockSelect,
    });
    assert.equal(pf.ok, false);
    assert.ok(pf.blockers.length > 0);
    assert.match(formatPreflightText(pf), /blockers:/);
  });
});

describe("runner-launcher", () => {
  it("terminalStatusFromRunResult maps done flag", () => {
    assert.equal(terminalStatusFromRunResult({ done: true }), "done");
    assert.equal(terminalStatusFromRunResult({ done: false }), "failed");
  });

  it("launchRun blocks when preflight fails", async () => {
    await assert.rejects(
      () =>
        launchRun({
          goal: "test goal",
          buildRunPreflight: async () => ({
            ok: false,
            model_policy: "local_only",
            blockers: ["ollama down"],
          }),
        }),
      (err) => err.code === "RUNNER_PREFLIGHT_BLOCKED",
    );
  });

  it("launchRun executes run() after successful preflight", async () => {
    let runCalled = false;
    const launched = await launchRun({
      goal: "ship feature",
      flowMode: "single_agent",
      buildRunPreflight: async () => ({
        ok: true,
        model_policy: "local_only",
        blockers: [],
        provider: "ollama",
        selected_model: "qwen2.5-coder:7b",
        override_source: "auto",
        selection_reason: "auto",
        discovered_models: [],
        ollama_reachable: true,
      }),
      run: async (goal, opts) => {
        runCalled = true;
        assert.equal(goal, "ship feature");
        assert.equal(opts.flowMode, "single_agent");
        return { done: true, taskId: "task-runner-1", summary: "ok", iterations: 1 };
      },
    });
    assert.equal(runCalled, true);
    assert.equal(launched.terminal_status, "done");
    assert.equal(launched.task_id, "task-runner-1");
  });

  it("loadRunStatusFromTrace reads session_end from fixture", () => {
    const tracePath = path.join(__dirname, "fixtures", "golden-path-clean-v1.jsonl");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runner-status-"));
    const tracesDir = path.join(tmp, "traces");
    fs.mkdirSync(tracesDir);
    fs.copyFileSync(tracePath, path.join(tracesDir, "task-golden-v1.jsonl"));
    const status = loadRunStatusFromTrace("task-golden-v1", { tracesDir });
    assert.equal(status.terminal_status, "done");
    assert.equal(status.done, true);
    assert.match(formatRunStatusText(status), /terminal_status:\s+done/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("loadRunStatusFromTrace reports missing trace", () => {
    const status = loadRunStatusFromTrace("task-missing", {
      tracesDir: path.join(os.tmpdir(), "no-such-traces-dir-runner"),
    });
    assert.equal(status.terminal_status, "unknown");
    assert.ok(status.error);
  });
});

describe("runner-tui-cli args", () => {
  it("parseCommonArgs extracts run options", () => {
    const opts = parseCommonArgs([
      "--goal",
      "fix bug",
      "--flow",
      "multi_agent",
      "--model-policy",
      "local_only",
      "--skip-gates",
    ]);
    assert.equal(opts.goal, "fix bug");
    assert.equal(opts.flowMode, "multi_agent");
    assert.equal(opts.modelPolicy, "local_only");
    assert.equal(opts.skipGates, true);
  });
});
