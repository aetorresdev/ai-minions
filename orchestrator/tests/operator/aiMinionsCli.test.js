"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const {
  parseAiMinionsArgs,
  formatInitText,
  formatStartText,
  formatPlannedCommandMessage,
  deriveInitNextSafeAction,
  runInit,
  runStart,
  defaultTracePath,
  resolveInstallRepoRoot,
  REPO_ROOT,
} = require("../../modules/operator/ai-minions-cli");

const CLI_PATH = path.join(__dirname, "..", "..", "ai-minions-cli.js");
const ORCH_CWD = path.join(__dirname, "..", "..");

describe("ai-minions-cli help", () => {
  it("--help exits 0 and documents init/start and alpha limitations", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "--help"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = r.stdout;
    assert.match(out, /ai-minions — product CLI/);
    assert.match(out, /init\s+Validate host prereqs/);
    assert.match(out, /start\s+Preflight then launch/);
    assert.match(out, /status\s+Operator trace summary/);
    assert.match(out, /explain\s+Why blocked/);
    assert.match(out, /doctor\s+Bootstrap \+ runtime \+ runner preflight/);
    assert.match(out, /evidence\s+Trace\/bundle paths/);
    assert.match(out, /context\s+Context package refs/);
    assert.match(out, /resume\s+Honest resume capability probe/);
    assert.match(out, /RUN_RESUME_NOT_IMPLEMENTED/);
    assert.match(out, /ai-minions <command>/);
    assert.match(out, /Dev fallback/);
    assert.match(out, /npm run ai-minions/);
    assert.match(out, /runner:tui/);
    assert.doesNotMatch(out, /production-ready/i);
  });

  it("unknown command exits 1", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "nope"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /Unknown command/);
  });

  it("status with missing trace exits 2 with reason_code", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "status", "--run-id", "no-such-task-e18"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
      env: { ...process.env, ORCH_TRACES_DIR: path.join(ORCH_CWD, "tests", "fixtures", "no-traces-dir") },
    });
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /OPERATOR_TRACE_NOT_FOUND/);
    assert.match(r.stdout + r.stderr, /next_safe_action/);
  });

  it("result alias behaves like status", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "result", "--run-id", "no-such-task-e18"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
      env: { ...process.env, ORCH_TRACES_DIR: path.join(ORCH_CWD, "tests", "fixtures", "no-traces-dir") },
    });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /ai-minions status/);
  });

  it("context without trace exits 2 with reason_code", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "context", "--run-id", "no-such-context-e18"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
      env: { ...process.env, ORCH_TRACES_DIR: path.join(ORCH_CWD, "tests", "fixtures", "no-traces-dir") },
    });
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /OPERATOR_TRACE_NOT_FOUND/);
  });
});

describe("ai-minions-cli args", () => {
  it("parseAiMinionsArgs extracts init and start flags", () => {
    const opts = parseAiMinionsArgs([
      "--cwd",
      "/tmp/proj",
      "--model-policy",
      "local_only",
      "--json",
      "--no-install",
      "--goal",
      "smoke",
      "--skip-gates",
    ]);
    assert.equal(opts.cwd, "/tmp/proj");
    assert.equal(opts.modelPolicy, "local_only");
    assert.equal(opts.json, true);
    assert.equal(opts.noInstall, true);
    assert.equal(opts.goal, "smoke");
    assert.equal(opts.skipGates, true);
  });
});

describe("ai-minions-cli formatters", () => {
  it("formatInitText includes config paths and next_safe_action", () => {
    const text = formatInitText({
      ok: true,
      phase: "config_write",
      model_policy: "local_only",
      model_policy_mode: "declarative",
      repo_root: "/repo",
      checks: [{ id: "x", reason_code: "INSTALL_OK", status: "pass", message: "ok" }],
      discovery: {
        backends: [{ backend_id: "ollama", support_status: "supported", available: true, host: "localhost", port: 11434 }],
        models: [{ name: "qwen2.5-coder:7b" }],
      },
      default_model: "qwen2.5-coder:7b",
    });
    assert.match(text, /config_dir:\s+\/repo\/\.ai-minions/);
    assert.match(text, /model-policy\.yaml/);
    assert.match(text, /provider:\s+ollama/);
    assert.match(text, /next_safe_action:/);
  });

  it("deriveInitNextSafeAction points to start after successful config write", () => {
    const action = deriveInitNextSafeAction({ ok: true, phase: "config_write" });
    assert.match(action, /start --goal/);
  });

  it("formatStartText includes run_id, mode, trace and evidence paths", () => {
    const text = formatStartText({
      task_id: "task-abc",
      terminal_status: "done",
      preflight: {
        provider: "ollama",
        model_policy: "local_only",
        selected_model: "qwen2.5-coder:7b",
      },
      result: { summary: "completed", done: true, iterations: 1 },
    }, { flowMode: "single_agent" });
    assert.match(text, /run_id:\s+task-abc/);
    assert.match(text, /mode:\s+single_agent/);
    assert.match(text, /trace_file:/);
    assert.match(text, /evidence_path:/);
  });

  it("defaultTracePath respects ORCH_TRACES_DIR", () => {
    const prev = process.env.ORCH_TRACES_DIR;
    process.env.ORCH_TRACES_DIR = "/tmp/traces";
    try {
      assert.equal(defaultTracePath("t1"), "/tmp/traces/t1.jsonl");
    } finally {
      if (prev === undefined) delete process.env.ORCH_TRACES_DIR;
      else process.env.ORCH_TRACES_DIR = prev;
    }
  });

  it("formatPlannedCommandMessage includes help fallback", () => {
    assert.match(formatPlannedCommandMessage("future-cmd"), /not implemented in this alpha slice/);
    assert.match(formatPlannedCommandMessage("future-cmd"), /ai-minions --help/);
  });
});

describe("ai-minions-cli runInit", () => {
  it("wraps install module without duplicate logic", async () => {
    const result = await runInit({
      cwd: REPO_ROOT,
      install: false,
      loadInstallModule: async () => ({
        runInstallAiMinions: async () => ({
          ok: false,
          phase: "model_discovery",
          model_policy: "local_only",
          model_policy_mode: "declarative",
          repo_root: REPO_ROOT,
          checks: [{
            id: "ollama",
            reason_code: "INSTALL_OLLAMA_UNREACHABLE",
            status: "fail",
            message: "cannot reach Ollama",
          }],
          discovery: null,
        }),
      }),
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.text, /INSTALL_OLLAMA_UNREACHABLE/);
    assert.match(result.text, /next_safe_action/);
  });

  it("defaults repoRoot to REPO_ROOT when cwd omitted", async () => {
    /** @type {string | undefined} */
    let capturedRepoRoot;
    await runInit({
      install: false,
      loadInstallModule: async () => ({
        runInstallAiMinions: async (opts) => {
          capturedRepoRoot = opts.repoRoot;
          return {
            ok: false,
            phase: "host_prereqs",
            model_policy: "local_only",
            model_policy_mode: "declarative",
            repo_root: opts.repoRoot,
            checks: [],
            discovery: null,
          };
        },
      }),
    });
    assert.equal(capturedRepoRoot, REPO_ROOT);
  });

  it("normalizes orchestrator/ cwd to clone root for install", async () => {
    /** @type {string | undefined} */
    let capturedRepoRoot;
    await runInit({
      cwd: ORCH_CWD,
      install: false,
      loadInstallModule: async () => ({
        runInstallAiMinions: async (opts) => {
          capturedRepoRoot = opts.repoRoot;
          return {
            ok: false,
            phase: "host_prereqs",
            model_policy: "local_only",
            model_policy_mode: "declarative",
            repo_root: opts.repoRoot,
            checks: [],
            discovery: null,
          };
        },
      }),
    });
    assert.equal(capturedRepoRoot, REPO_ROOT);
    assert.notEqual(capturedRepoRoot, ORCH_CWD);
  });

  it("preserves explicit clone root when --cwd points at repo root", async () => {
    /** @type {string | undefined} */
    let capturedRepoRoot;
    await runInit({
      cwd: REPO_ROOT,
      install: false,
      loadInstallModule: async () => ({
        runInstallAiMinions: async (opts) => {
          capturedRepoRoot = opts.repoRoot;
          return {
            ok: false,
            phase: "host_prereqs",
            model_policy: "local_only",
            model_policy_mode: "declarative",
            repo_root: opts.repoRoot,
            checks: [],
            discovery: null,
          };
        },
      }),
    });
    assert.equal(capturedRepoRoot, REPO_ROOT);
  });
});

describe("ai-minions-cli resolveInstallRepoRoot", () => {
  it("returns REPO_ROOT when cwd omitted", () => {
    assert.equal(resolveInstallRepoRoot(undefined), REPO_ROOT);
  });

  it("lifts orchestrator package cwd to clone root", () => {
    assert.equal(resolveInstallRepoRoot(ORCH_CWD), REPO_ROOT);
  });

  it("keeps clone root when cwd is repo root", () => {
    assert.equal(resolveInstallRepoRoot(REPO_ROOT), REPO_ROOT);
  });
});

describe("ai-minions-cli runStart", () => {
  it("requires non-empty goal", async () => {
    await assert.rejects(
      () => runStart({ goal: "  " }),
      (err) => err && err.code === "AI_MINIONS_USAGE",
    );
  });

  it("delegates to launchRun and formats operator output", async () => {
    const result = await runStart({
      goal: "smoke",
      flowMode: "single_agent",
      launchRunFn: async () => ({
        task_id: "task-xyz",
        terminal_status: "done",
        preflight: {
          provider: "ollama",
          model_policy: "local_only",
          selected_model: "qwen2.5-coder:7b",
          discovered_models: [],
          blockers: [],
          ok: true,
        },
        result: { summary: "ok", done: true, iterations: 1 },
      }),
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.text, /task-xyz/);
    assert.match(result.preflightText, /Runner preflight/);
  });
});
