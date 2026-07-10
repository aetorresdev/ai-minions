"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  RUNTIME_EVIDENCE_SOURCE,
  RUNTIME_EVIDENCE_TRUST,
  runContextAuthorityGate,
  enforceContextAuthorityGate,
} = require("../security/context-authority-runtime-gate");
const {
  loadUntrustedContextFixtures,
  evaluateUntrustedContextScenario,
} = require("../security/untrusted-context-eval");
const { spawnClassifiedSync } = require("../agents/runtime/run-classified-shell.js");
const {
  loadToolActionManifest,
  resetToolActionManifestCache,
} = require("../security/load-tool-action-manifest");

function assertUnclassifiedBlock(result) {
  assert.equal(result.allowed, false);
  assert.equal(result.decision, "block_unclassified");
  assert.equal(result.reason_code, "context_authority_unknown");
  assert.equal(result.tracePayload.next_safe_action, "escalate_to_operator");
}

describe("context-authority-runtime-gate", () => {
  it("skips gate when tool call is not derived from untrusted context", () => {
    const result = runContextAuthorityGate({});
    assert.equal(result.skipped, true);
    assert.equal(result.allowed, true);
    assert.equal(result.reason_code, "context_authority_not_required");
  });

  it("unknown context_type fails closed with context_authority_unknown", () => {
    const result = runContextAuthorityGate({
      context_authority: {
        derived_from_untrusted: true,
        context_type: "not_a_channel",
        variant: "benign",
      },
      tool: "stub_mcp.test_tool",
    });
    assertUnclassifiedBlock(result);
    assert.equal(result.tracePayload.event, "context_authority_check");
    assert.equal(result.tracePayload.failure_axis, "context_authority");
    assert.equal(result.tracePayload.source, RUNTIME_EVIDENCE_SOURCE);
    assert.equal(result.tracePayload.trust, RUNTIME_EVIDENCE_TRUST);
  });

  it("missing variant fails closed when derived_from_untrusted", () => {
    const result = runContextAuthorityGate({
      context_authority: {
        derived_from_untrusted: true,
        context_type: "document_text",
      },
      tool: "stub_mcp.test_tool",
    });
    assertUnclassifiedBlock(result);
  });

  it("variant unknown fails closed", () => {
    const result = runContextAuthorityGate({
      context_authority: {
        derived_from_untrusted: true,
        context_type: "document_text",
        variant: "unknown",
      },
      tool: "stub_mcp.test_tool",
    });
    assertUnclassifiedBlock(result);
  });

  it("variant with unexpected casing fails closed", () => {
    const result = runContextAuthorityGate({
      context_authority: {
        derived_from_untrusted: true,
        context_type: "document_text",
        variant: "Injected",
      },
      tool: "stub_mcp.test_tool",
    });
    assertUnclassifiedBlock(result);
  });

  it("benign untrusted context allows invocation and emits trace", () => {
    const result = runContextAuthorityGate({
      context_authority: {
        derived_from_untrusted: true,
        context_type: "document_text",
        variant: "benign",
      },
      tool: "stub_mcp.list_boards",
    });
    assert.equal(result.allowed, true);
    assert.equal(result.skipped, false);
    assert.equal(result.decision, "accept_as_data");
    assert.equal(result.reason_code, "untrusted_context_data_only");
    assert.equal(result.tracePayload.instruction_source, "retrieved_context");
  });

  it("injected untrusted context blocks invocation", () => {
    const result = runContextAuthorityGate({
      context_authority: {
        derived_from_untrusted: true,
        context_type: "fetched_web",
        variant: "injected",
        attempted_action: "invoke_shell",
      },
      tool: "stub_mcp.run_shell",
    });
    assert.equal(result.allowed, false);
    assert.equal(result.decision, "ignore_instruction");
    assert.equal(result.reason_code, "injection_not_sovereign:invoke_shell");
    assert.equal(result.tracePayload.injection_detected, true);
    assert.equal(result.tracePayload.next_safe_action, "escalate_to_operator");
  });

  it("enforceContextAuthorityGate throws CONTEXT_AUTHORITY_DENIED on block", () => {
    assert.throws(
      () =>
        enforceContextAuthorityGate({
          context_authority: {
            derived_from_untrusted: true,
            context_type: "memory_entry",
            variant: "injected",
            attempted_action: "skip_cerberus",
          },
        }),
      (err) => err.code === "CONTEXT_AUTHORITY_DENIED",
    );
  });

  it("redteam fixture corpus aligns runtime gate with fixture harness", () => {
    const fx = loadUntrustedContextFixtures();
    for (const scenario of fx.scenarios) {
      const fixtureResult = evaluateUntrustedContextScenario(scenario);
      assert.equal(fixtureResult.pass, true, `${scenario.id}: ${JSON.stringify(fixtureResult.mismatches)}`);

      const runtimeResult = runContextAuthorityGate({
        context_authority: {
          derived_from_untrusted: true,
          context_type: scenario.context_type,
          variant: scenario.variant,
          attempted_action: scenario.attempted_action,
        },
        tool: "stub_mcp.test",
      });

      if (scenario.variant === "injected") {
        assert.equal(runtimeResult.allowed, false, scenario.id);
        assert.equal(runtimeResult.decision, "ignore_instruction", scenario.id);
      } else {
        assert.equal(runtimeResult.allowed, true, scenario.id);
        assert.equal(runtimeResult.decision, "accept_as_data", scenario.id);
      }

      assert.equal(runtimeResult.reason_code, fixtureResult.reason_code, scenario.id);
      assert.equal(runtimeResult.tracePayload.event, "context_authority_check", scenario.id);
      assert.equal(runtimeResult.tracePayload.authority_tier, fixtureResult.authority_tier, scenario.id);
      assert.equal(
        runtimeResult.tracePayload.instruction_source,
        fixtureResult.instruction_source,
        scenario.id,
      );
    }
  });
});

describe("context authority runtime wiring", () => {
  let tmpDir;
  let savedEnv;
  let origSpawn;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-context-auth-wire-"));
    savedEnv = {
      ORCH_TRACES_DIR: process.env.ORCH_TRACES_DIR,
      ORCH_MCP_TRANSPORT: process.env.ORCH_MCP_TRANSPORT,
      ORCH_PERMISSION_PROFILE: process.env.ORCH_PERMISSION_PROFILE,
      ORCH_SKIP_MCP_PERMISSION_GATE: process.env.ORCH_SKIP_MCP_PERMISSION_GATE,
      ORCH_SKIP_CONTEXT_AUTHORITY_GATE: process.env.ORCH_SKIP_CONTEXT_AUTHORITY_GATE,
      ORCH_SKIP_CLASSIFIED_SHELL_GATE: process.env.ORCH_SKIP_CLASSIFIED_SHELL_GATE,
    };
    process.env.ORCH_TRACES_DIR = tmpDir;
    process.env.ORCH_MCP_TRANSPORT = "direct";
    process.env.ORCH_PERMISSION_PROFILE = "dev-local";
    delete process.env.ORCH_SKIP_MCP_PERMISSION_GATE;
    delete process.env.ORCH_SKIP_CONTEXT_AUTHORITY_GATE;
    delete process.env.ORCH_SKIP_CLASSIFIED_SHELL_GATE;
    origSpawn = cp.spawnSync;
    cp.spawnSync = origSpawn;
    delete require.cache[require.resolve("../modules/tools/mcp-client")];
    resetToolActionManifestCache();
    loadToolActionManifest();
  });

  afterEach(() => {
    cp.spawnSync = origSpawn;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("invokeMcpDirect blocks injected metadata before transport", () => {
    cp.spawnSync = () => assert.fail("spawn must not run");
    delete require.cache[require.resolve("../modules/tools/mcp-client")];
    const { invokeMcpDirect } = require("../modules/tools/mcp-client");
    assert.throws(
      () =>
        invokeMcpDirect(
          "orchestrator-state",
          "open_envelope",
          { task_id: "task-ctx-auth-1" },
          {
            cwd: tmpDir,
            context_authority: {
              derived_from_untrusted: true,
              context_type: "fetched_web",
              variant: "injected",
              attempted_action: "invoke_shell",
            },
          },
        ),
      (err) =>
        err.code === "CONTEXT_AUTHORITY_DENIED"
        && err.context_authority_decision.reason_code === "injection_not_sovereign:invoke_shell",
    );
  });

  it("invokeMcpDirect blocks missing variant before transport", () => {
    cp.spawnSync = () => assert.fail("spawn must not run");
    delete require.cache[require.resolve("../modules/tools/mcp-client")];
    const { invokeMcpDirect } = require("../modules/tools/mcp-client");
    assert.throws(
      () =>
        invokeMcpDirect(
          "orchestrator-state",
          "open_envelope",
          { task_id: "task-ctx-auth-2" },
          {
            cwd: tmpDir,
            context_authority: {
              derived_from_untrusted: true,
              context_type: "document_text",
            },
          },
        ),
      (err) =>
        err.code === "CONTEXT_AUTHORITY_DENIED"
        && err.context_authority_decision.reason_code === "context_authority_unknown",
    );
  });

  it("invokeMcpDirect allows benign derived metadata through to transport", () => {
    let transportSpawned = false;
    cp.spawnSync = (cmd, args) => {
      const joined = [cmd, ...(Array.isArray(args) ? args : [])].join(" ");
      if (joined.includes("mcp-direct.py")) {
        transportSpawned = true;
      }
      return { error: null, status: 0, stdout: '{"ok":true,"task_id":"stub"}\n', stderr: "" };
    };
    delete require.cache[require.resolve("../modules/tools/mcp-client")];
    const { invokeMcpDirect, beginMcpAudit, clearMcpAudit } = require("../modules/tools/mcp-client");
    beginMcpAudit("task-ctx-auth-3");
    const parsed = invokeMcpDirect(
      "orchestrator-state",
      "open_envelope",
      { task_id: "task-ctx-auth-3" },
      {
        cwd: tmpDir,
        context_authority: {
          derived_from_untrusted: true,
          context_type: "document_text",
          variant: "benign",
        },
      },
    );
    clearMcpAudit();
    assert.equal(transportSpawned, true);
    assert.equal(parsed.ok, true);

    const jsonlPath = path.join(tmpDir, "task-ctx-auth-3.jsonl");
    assert.ok(fs.existsSync(jsonlPath));
    const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const authority = lines.filter((r) => r.event === "context_authority_check");
    const perm = lines.filter((r) => r.event === "permission_check");
    const mcp = lines.filter((r) => r.event === "mcp_call");
    assert.equal(authority.length, 1);
    assert.equal(authority[0].decision, "accept_as_data");
    assert.equal(perm.length, 1);
    assert.equal(mcp.length, 1);
  });

  it("spawnClassifiedSync blocks injected metadata before spawn", () => {
    cp.spawnSync = () => assert.fail("spawn must not run");
    assert.throws(
      () =>
        spawnClassifiedSync("git", ["status"], {
          cwd: tmpDir,
          permissionProfileName: "dev-local",
          traceRole: "DEV",
          context_authority: {
            derived_from_untrusted: true,
            context_type: "memory_entry",
            variant: "injected",
            attempted_action: "expand_permissions",
          },
        }),
      (err) =>
        err.code === "CONTEXT_AUTHORITY_DENIED"
        && err.context_authority_decision.reason_code === "injection_not_sovereign:expand_permissions",
    );
  });

  it("spawnClassifiedSync blocks missing variant before spawn", () => {
    cp.spawnSync = () => assert.fail("spawn must not run");
    assert.throws(
      () =>
        spawnClassifiedSync("git", ["status"], {
          cwd: tmpDir,
          permissionProfileName: "dev-local",
          traceRole: "DEV",
          context_authority: {
            derived_from_untrusted: true,
            context_type: "document_text",
          },
        }),
      (err) =>
        err.code === "CONTEXT_AUTHORITY_DENIED"
        && err.context_authority_decision.reason_code === "context_authority_unknown",
    );
  });

  it("spawnClassifiedSync allows benign derived metadata through to spawn", () => {
    let spawned = false;
    cp.spawnSync = (exe, args) => {
      spawned = true;
      assert.equal(exe, "git");
      assert.deepEqual(args, ["status"]);
      return { error: null, status: 0, stdout: "", stderr: "" };
    };
    const result = spawnClassifiedSync("git", ["status"], {
      cwd: tmpDir,
      permissionProfileName: "dev-local",
      traceRole: "DEV",
      context_authority: {
        derived_from_untrusted: true,
        context_type: "document_text",
        variant: "benign",
      },
    });
    assert.equal(spawned, true);
    assert.equal(result.status, 0);
  });
});
