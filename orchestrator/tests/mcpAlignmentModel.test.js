"use strict";

/**
 * Goal alignment runs inside the orchestrator-state MCP, which picks its Ollama model from
 * ORCHESTRATOR_OLLAMA_MODEL and otherwise defaults to a model that may not be pulled. A local_only
 * run must hand its resolved model to that server.
 */

const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");

function loadClient() {
  delete require.cache[require.resolve("../modules/tools/mcp-client")];
  return require("../modules/tools/mcp-client");
}

describe("invokeMcpDirect alignment model", () => {
  it("passes the model the launcher published when ORCHESTRATOR_OLLAMA_MODEL is unset", () => {
    const saved = process.env.ORCHESTRATOR_OLLAMA_MODEL;
    const savedPub = process.env.ORCH_ALIGNMENT_OLLAMA_MODEL;
    delete process.env.ORCHESTRATOR_OLLAMA_MODEL;
    process.env.ORCH_ALIGNMENT_OLLAMA_MODEL = "qwen3.6:35b-a3b";
    let seen;
    const spawn = mock.method(cp, "spawnSync", (_cmd, _args, opts) => {
      seen = opts.env.ORCHESTRATOR_OLLAMA_MODEL;
      return { status: 0, stdout: '{"ok":true}\n', stderr: "" };
    });
    try {
      loadClient().invokeMcpDirect("orchestrator-state", "validate_goal_alignment", { task_id: "t" }, {});
      assert.equal(seen, "qwen3.6:35b-a3b");
    } finally {
      spawn.mock.restore();
      if (saved === undefined) delete process.env.ORCHESTRATOR_OLLAMA_MODEL;
      else process.env.ORCHESTRATOR_OLLAMA_MODEL = saved;
      if (savedPub === undefined) delete process.env.ORCH_ALIGNMENT_OLLAMA_MODEL;
      else process.env.ORCH_ALIGNMENT_OLLAMA_MODEL = savedPub;
    }
  });

  it("keeps an explicitly configured model", () => {
    const saved = process.env.ORCHESTRATOR_OLLAMA_MODEL;
    const savedPub = process.env.ORCH_ALIGNMENT_OLLAMA_MODEL;
    process.env.ORCHESTRATOR_OLLAMA_MODEL = "operator-chosen:7b";
    process.env.ORCH_ALIGNMENT_OLLAMA_MODEL = "qwen3.6:35b-a3b";
    let seen;
    const spawn = mock.method(cp, "spawnSync", (_cmd, _args, opts) => {
      seen = opts.env.ORCHESTRATOR_OLLAMA_MODEL;
      return { status: 0, stdout: '{"ok":true}\n', stderr: "" };
    });
    try {
      loadClient().invokeMcpDirect("orchestrator-state", "register_task", { task_id: "t" }, {});
      assert.equal(seen, "operator-chosen:7b");
    } finally {
      spawn.mock.restore();
      if (saved === undefined) delete process.env.ORCHESTRATOR_OLLAMA_MODEL;
      else process.env.ORCHESTRATOR_OLLAMA_MODEL = saved;
      if (savedPub === undefined) delete process.env.ORCH_ALIGNMENT_OLLAMA_MODEL;
      else process.env.ORCH_ALIGNMENT_OLLAMA_MODEL = savedPub;
    }
  });

  it("does not invent a model when the launcher published none", () => {
    const saved = process.env.ORCHESTRATOR_OLLAMA_MODEL;
    const savedPub = process.env.ORCH_ALIGNMENT_OLLAMA_MODEL;
    delete process.env.ORCHESTRATOR_OLLAMA_MODEL;
    delete process.env.ORCH_ALIGNMENT_OLLAMA_MODEL;
    let seen = "unset";
    const spawn = mock.method(cp, "spawnSync", (_cmd, _args, opts) => {
      seen = opts.env.ORCHESTRATOR_OLLAMA_MODEL;
      return { status: 0, stdout: '{"ok":true}\n', stderr: "" };
    });
    try {
      loadClient().invokeMcpDirect("orchestrator-state", "register_task", { task_id: "t" }, {});
      assert.equal(seen, undefined);
    } finally {
      spawn.mock.restore();
      if (saved === undefined) delete process.env.ORCHESTRATOR_OLLAMA_MODEL;
      else process.env.ORCHESTRATOR_OLLAMA_MODEL = saved;
      if (savedPub === undefined) delete process.env.ORCH_ALIGNMENT_OLLAMA_MODEL;
      else process.env.ORCH_ALIGNMENT_OLLAMA_MODEL = savedPub;
    }
  });
});
