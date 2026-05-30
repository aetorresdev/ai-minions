"use strict";

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");

const {
  buildRunPreflight,
  formatPreflightText,
  normalizeModelPolicy,
  resolveModelPolicyInput,
} = require("../runner-preflight");
const {
  launchRun,
  loadRunStatusFromTrace,
  formatRunStatusText,
  terminalStatusFromRunResult,
} = require("../runner-launcher");
const { parseCommonArgs, parseMaxIterations } = require("../runner-tui-cli");

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
    assert.equal(normalizeModelPolicy(undefined), "local_only");
  });

  it("normalizeModelPolicy returns null for unknown values", () => {
    assert.equal(normalizeModelPolicy("banana_ops"), null);
  });

  it("buildRunPreflight blocks unknown model policy", async () => {
    const pf = await buildRunPreflight({ modelPolicy: "banana_ops" });
    assert.equal(pf.ok, false);
    assert.ok(pf.blockers.some((b) => /unknown model policy: banana_ops/.test(b)));
  });

  it("resolveModelPolicyInput rejects unknown explicit policy", () => {
    const resolved = resolveModelPolicyInput("banana");
    assert.equal(resolved.ok, false);
    if (!resolved.ok) {
      assert.equal(resolved.blocker, "unknown model policy: banana");
    }
  });

  it("resolveModelPolicyInput defaults implicit policy to local_only", () => {
    const resolved = resolveModelPolicyInput(undefined);
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.policy, "local_only");
      assert.equal(resolved.explicit, false);
    }
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

  it("parseCommonArgs extracts interactive and show-routing flags", () => {
    const opts = parseCommonArgs(["--interactive", "--show-routing"]);
    assert.equal(opts.interactive, true);
    assert.equal(opts.showRouting, true);
  });

  it("parseMaxIterations rejects non-numeric values", () => {
    assert.equal(parseMaxIterations(undefined), undefined);
    assert.equal(parseMaxIterations("3"), 3);
    assert.ok(Number.isNaN(parseMaxIterations("nope")));
    assert.ok(Number.isNaN(parseMaxIterations("0")));
  });
});

describe("runner-model-routing", () => {
  const {
    buildRoleRoutingPreview,
    formatRoleRoutingText,
    formatModelPolicyCatalogText,
    extractRoleRoutingFromTrace,
    formatTraceRoleRoutingText,
  } = require("../runner-model-routing");

  it("buildRoleRoutingPreview maps all roles to Ollama in local_only", () => {
    const preview = buildRoleRoutingPreview({
      modelPolicy: "local_only",
      localModel: "qwen2.5-coder:7b",
      flowMode: "single_agent",
    });
    assert.equal(preview.model_policy, "local_only");
    assert.ok(preview.roles.length >= 5);
    for (const row of preview.roles) {
      assert.equal(row.provider, "ollama");
      assert.equal(row.model, "qwen2.5-coder:7b");
    }
    assert.match(formatRoleRoutingText(preview), /dev-backend/);
  });

  it("buildRoleRoutingPreview uses resolveModel for remote_ok", () => {
    const preview = buildRoleRoutingPreview({ modelPolicy: "remote_ok" });
    assert.equal(preview.model_policy, "remote_ok");
    const cerberus = preview.roles.find((r) => r.role === "cerberus");
    assert.ok(cerberus);
    assert.match(cerberus.model, /claude-sonnet/);
  });

  it("formatModelPolicyCatalogText lists both policies", () => {
    const text = formatModelPolicyCatalogText();
    assert.match(text, /local_only/);
    assert.match(text, /remote_ok/);
  });

  it("extractRoleRoutingFromTrace reads session_start and context_stats", () => {
    const rows = [
      {
        event: "session_start",
        local_only_mode: true,
        selected_model: "qwen2.5-coder:7b",
        override_source: "cli",
      },
      { event: "agent_start", agent: "dev-backend" },
      {
        event: "context_stats",
        agent: "dev-backend",
        model: "qwen2.5-coder:7b",
        model_backend: "ollama",
      },
    ];
    const routing = extractRoleRoutingFromTrace(rows);
    assert.equal(routing.model_policy, "local_only");
    assert.equal(routing.selected_model, "qwen2.5-coder:7b");
    assert.equal(routing.roles.length, 1);
    assert.match(formatTraceRoleRoutingText(routing), /dev-backend/);
  });

  it("buildRoleRoutingPreview rejects unknown explicit model policy", () => {
    assert.throws(
      () => buildRoleRoutingPreview({ modelPolicy: "banana" }),
      (err) => err instanceof Error
        && err.message === "unknown model policy: banana"
        && err.code === "RUNNER_UNKNOWN_MODEL_POLICY",
    );
  });

  it("buildRoleRoutingPreview defaults implicit policy to local_only", () => {
    const preview = buildRoleRoutingPreview({ localModel: "qwen2.5-coder:7b" });
    assert.equal(preview.model_policy, "local_only");
  });
});

describe("runner-tui-cli routing policy validation", () => {
  const cliPath = path.join(__dirname, "..", "runner-tui-cli.js");

  it("routing rejects unknown explicit model policy (exit 2)", () => {
    const r = cp.spawnSync(process.execPath, [cliPath, "routing", "--model-policy", "banana"], {
      encoding: "utf8",
      cwd: path.join(__dirname, ".."),
    });
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}\n${r.stderr}`, /unknown model policy: banana/);
    assert.doesNotMatch(r.stdout, /Role routing preview/);
  });

  it("routing rejects unknown policy even when --model is set", () => {
    const r = cp.spawnSync(
      process.execPath,
      [cliPath, "routing", "--model-policy", "banana", "--model", "qwen2.5-coder:7b"],
      { encoding: "utf8", cwd: path.join(__dirname, "..") },
    );
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}\n${r.stderr}`, /unknown model policy: banana/);
    assert.doesNotMatch(r.stdout, /Role routing preview/);
  });
});
