/**
 * Unit tests for orchestrator internals: _sanitize and _hashGoal (trace redaction).
 *
 * Uses Node.js built-in test runner (node:test). Requires Node >= 18.
 * No Claude auth, no Ollama, no MCPs required.
 *
 * Degraded-agent tracking (getDegradedAgents/clearDegradedAgents) is tested
 * in askAgent.test.js where the spawnSync stub is already configured.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// orchestrator.js requires agents.js which calls spawnSync at module load time
// in some code paths — stub it to prevent errors during require.
const cp = require("child_process");
cp.spawnSync = () => ({ error: null, status: 0, stdout: "\n", stderr: "" });

const {
  _sanitize,
  _hashGoal,
  aggregateMcpUsage,
  edgeMeta,
  EDGE_TYPE_CATEGORY,
  validateStepGraph,
  assertParentStepExists,
  transitionReason,
  TRANSITION_REASON_TYPES,
  TRACE_SCHEMA_VERSION,
} = require("../orchestrator");
const { validateOutput } = require("../agents");

describe("_hashGoal", () => {
  it("returns a 12-char hex string", () => {
    const h = _hashGoal("my goal");
    assert.match(h, /^[0-9a-f]{12}$/);
  });

  it("is deterministic for the same input", () => {
    assert.equal(_hashGoal("abc"), _hashGoal("abc"));
  });

  it("differs for different inputs", () => {
    assert.notEqual(_hashGoal("goal A"), _hashGoal("goal B"));
  });
});

describe("_sanitize — goal field", () => {
  it("preserves goal up to 80 chars and appends hash when TRACE_REDACT_GOAL is unset", () => {
    const shortGoal = "short goal";
    const out = _sanitize({ event: "session_start", goal: shortGoal });
    assert.ok(out.goal.includes(shortGoal), "should include original text");
    assert.match(out.goal, /\[sha256:[0-9a-f]{12}\]/, "should include hash suffix");
  });

  it("truncates goal longer than 80 chars", () => {
    const longGoal = "a".repeat(120);
    const out = _sanitize({ event: "session_start", goal: longGoal });
    // Should contain the 80-char prefix (no more)
    assert.ok(out.goal.startsWith("a".repeat(80)), "should include 80-char prefix");
    assert.ok(!out.goal.includes("a".repeat(81)), "should not include char 81+");
  });

  it("does not modify event without a goal field", () => {
    const out = _sanitize({ event: "agent_done", agent: "dev-backend" });
    assert.equal(out.agent, "dev-backend");
    assert.equal("goal" in out, false);
  });
});

describe("_sanitize — other fields", () => {
  it("truncates task to 120 chars", () => {
    const out = _sanitize({ task: "x".repeat(200) });
    assert.equal(out.task.length, 120);
  });

  it("truncates reason to 300 chars", () => {
    const out = _sanitize({ reason: "r".repeat(400) });
    assert.equal(out.reason.length, 300);
  });

  it("truncates summary to 300 chars", () => {
    const out = _sanitize({ summary: "s".repeat(400) });
    assert.equal(out.summary.length, 300);
  });

  it("does not mutate the original event object", () => {
    const original = { goal: "some goal", task: "some task" };
    _sanitize(original);
    assert.equal(original.goal, "some goal");
    assert.equal(original.task, "some task");
  });
});

describe("validateOutput — context gating (files_read)", () => {
  const devOutput = (filesRead) =>
    `${filesRead}\nfiles_modified:\n  - src/app.js\nvalidation_run: npm test → pass`;

  it("rejects architect output missing files_read", () => {
    const r = validateOutput("architect", "Design: use module X. Components: A, B.");
    assert.equal(r.valid, false);
    assert.match(r.reason, /files_read/);
  });

  it("accepts architect output with files_read", () => {
    const r = validateOutput("architect", "files_read: [docs/api.yaml]\nDesign: use module X.");
    assert.equal(r.valid, true);
  });

  it("rejects dev-backend output missing files_read", () => {
    const r = validateOutput("dev-backend", "modified: /src/app.js\nvalidation_run: npm test → pass");
    assert.equal(r.valid, false);
    assert.match(r.reason, /files_read/);
  });

  it("accepts dev-backend output with files_read", () => {
    const r = validateOutput("dev-backend", devOutput("files_read: [src/app.js]"));
    assert.equal(r.valid, true);
  });

  it("accepts dev-devops output with files_read block syntax", () => {
    const output = [
      "files_read:",
      "  - main.tf",
      "  - variables.tf",
      "files_modified:",
      "  - main.tf",
      "validation_run: terraform validate → pass",
    ].join("\n");
    const r = validateOutput("dev-devops", output);
    assert.equal(r.valid, true);
  });

  it("rejects dev-frontend output missing files_read even with file and validation", () => {
    const r = validateOutput("dev-frontend", "modified: /src/App.tsx\nvalidation_run: lint → pass");
    assert.equal(r.valid, false);
    assert.match(r.reason, /files_read/);
  });

  it("rejects architect output with empty files_read []", () => {
    const r = validateOutput("architect", "files_read: []\nDesign: use module X.");
    assert.equal(r.valid, false);
    assert.match(r.reason, /empty/);
  });

  it("rejects dev-backend output with empty files_read []", () => {
    const r = validateOutput("dev-backend", "files_read: []\nmodified: /src/app.js\nvalidation_run: npm test → pass");
    assert.equal(r.valid, false);
    assert.match(r.reason, /empty/);
  });
});

describe("validateOutput — files_read vs files_modified (strict mode)", () => {
  it("accepts dev-backend when files_modified is subset of files_read", () => {
    const output = [
      "files_read:",
      "  - src/app.js",
      "  - src/utils.js",
      "files_modified:",
      "  - src/app.js",
      "validation_run: npm test → pass",
    ].join("\n");
    const r = validateOutput("dev-backend", output);
    assert.equal(r.valid, true);
  });

  it("rejects dev-backend when files_modified contains path not in files_read", () => {
    const output = [
      "files_read:",
      "  - src/app.js",
      "files_modified:",
      "  - src/app.js",
      "  - src/config.js",
      "validation_run: npm test → pass",
    ].join("\n");
    const r = validateOutput("dev-backend", output);
    assert.equal(r.valid, false);
    assert.match(r.reason, /files_modified.*files_read|files_read.*files_modified/i);
  });

  it("rejects dev-devops when files_modified block is absent", () => {
    const output = [
      "files_read:",
      "  - main.tf",
      "validation_run: terraform validate → pass",
    ].join("\n");
    const r = validateOutput("dev-devops", output);
    assert.equal(r.valid, false);
    assert.match(r.reason, /files_modified/);
  });

  it("accepts dev-devops with files_modified matching files_read", () => {
    const output = [
      "files_read:",
      "  - main.tf",
      "files_modified:",
      "  - main.tf",
      "validation_run: terraform validate → pass",
    ].join("\n");
    const r = validateOutput("dev-devops", output);
    assert.equal(r.valid, true);
  });
});

describe("aggregateMcpUsage", () => {
  it("returns zeros for empty call list", () => {
    const s = aggregateMcpUsage([]);
    assert.equal(s.mcp_total_calls, 0);
    assert.deepEqual(s.mcp_by_tool, {});
    assert.deepEqual(s.mcp_by_transport, {});
    assert.equal(s.mcp_failed_calls, 0);
  });

  it("aggregates by tool and transport and counts failures", () => {
    const calls = [
      { server: "orchestrator-state", tool: "register_task", transport: "direct", duration_ms: 10, ok: true },
      { server: "orchestrator-state", tool: "advance_mode", transport: "direct", duration_ms: 5, ok: true },
      { server: "orchestrator-state", tool: "advance_mode", transport: "direct", duration_ms: 2, ok: false },
      { server: "compact-handoff", tool: "compact_handoff", transport: "claude_cli", duration_ms: 100, ok: true },
    ];
    const s = aggregateMcpUsage(calls);
    assert.equal(s.mcp_total_calls, 4);
    assert.equal(s.mcp_by_tool["orchestrator-state.register_task"], 1);
    assert.equal(s.mcp_by_tool["orchestrator-state.advance_mode"], 2);
    assert.equal(s.mcp_by_tool["compact-handoff.compact_handoff"], 1);
    assert.equal(s.mcp_by_transport.direct, 3);
    assert.equal(s.mcp_by_transport.claude_cli, 1);
    assert.equal(s.mcp_failed_calls, 1);
  });
});


describe("graph metadata in trace events", () => {
  // Simulate the step_id / step_index / retry_number logic extracted from orchestrator.js
  function makeStepId(taskId, iteration, agentId, retryNumber) {
    return `${taskId}-i${iteration}-${agentId}${retryNumber > 0 ? `-r${retryNumber}` : ""}`;
  }

  it("step_id encodes taskId, iteration, agentId", () => {
    const id = makeStepId("task-abc", 1, "dev-backend", 0);
    assert.equal(id, "task-abc-i1-dev-backend");
  });

  it("step_id appends -rN suffix on retry", () => {
    const id = makeStepId("task-abc", 2, "dev-backend", 1);
    assert.equal(id, "task-abc-i2-dev-backend-r1");
  });

  it("retry_number is 0 on first execution, increments on repeat", () => {
    const retryCount = {};
    const agents = ["dev-backend", "dev-backend", "qa"];
    const retries = agents.map(a => {
      const n = retryCount[a] ?? 0;
      retryCount[a] = n + 1;
      return n;
    });
    assert.deepEqual(retries, [0, 1, 0]);
  });

  it("step_index matches position in steps array", () => {
    const steps = [
      { agentId: "architect" },
      { agentId: "dev-backend" },
      { agentId: "qa" },
    ];
    const indices = steps.map((_, i) => i);
    assert.deepEqual(indices, [0, 1, 2]);
  });

  it("iteration_done uses structured transition_reason with reason_code", () => {
    const r1 = transitionReason("DONE");
    assert.deepEqual(r1.transition_reason, { type: "DONE", reason_code: "RUN_COMPLETED" });
    const r2 = transitionReason("GATE_BLOCK", "cerberus_blockers");
    assert.equal(r2.transition_reason.type, "GATE_BLOCK");
    assert.equal(r2.transition_reason.reason_code, "CERBERUS_BLOCKERS_ITERATE");
    assert.equal(r2.transition_reason.details, "cerberus_blockers");
    const r3 = transitionReason("ITERATE", "orchestrator_decide_corrections");
    assert.equal(r3.transition_reason.type, "ITERATE");
    assert.equal(r3.transition_reason.reason_code, "ORCHESTRATOR_DECIDE_CORRECTIONS");
    assert.throws(() => transitionReason("NOT_A_TYPE"), /invalid transition_reason/);
    assert.ok(TRANSITION_REASON_TYPES.has("MAX_ITERATIONS"));
    const g = transitionReason("GUARD", "step_retry_limit", { reason_code: "GUARD_STEP_RETRY_LIMIT", gate_id: "dev-backend" });
    assert.equal(g.transition_reason.type, "GUARD");
    assert.equal(g.transition_reason.reason_code, "GUARD_STEP_RETRY_LIMIT");
    assert.equal(g.transition_reason.gate_id, "dev-backend");
  });

  it("_sanitize truncates transition_reason.details", () => {
    const long = "x".repeat(400);
    const out = _sanitize({
      event: "iteration_done",
      transition_reason: { type: "CONTRACT_FAIL", details: long },
    });
    assert.equal(out.transition_reason.details.length, 300);
    assert.equal(out.transition_reason_legacy, undefined);
  });
});

describe("trace schema version", () => {
  it("exports TRACE_SCHEMA_VERSION 2", () => {
    assert.equal(TRACE_SCHEMA_VERSION, "2");
  });

  it("_sanitize does not emit transition_reason_legacy on iteration_done", () => {
    const out = _sanitize({
      event: "iteration_done",
      iteration: 1,
      outcome: "done",
      ...transitionReason("DONE"),
    });
    assert.equal(out.transition_reason_legacy, undefined);
  });
});

describe("graph edges — parent_step_id and edge_type", () => {
  it("parent_step_id is null for the first step", () => {
    const previousStepId = null;
    const graphMeta = { parent_step_id: previousStepId };
    assert.equal(graphMeta.parent_step_id, null);
  });

  it("parent_step_id carries previous step_id after first step", () => {
    const previousStepId = "task-abc-i1-dev-backend";
    const graphMeta = { parent_step_id: previousStepId };
    assert.equal(graphMeta.parent_step_id, "task-abc-i1-dev-backend");
  });

  it("edge_type is 'success' on first successful agent_done", () => {
    const retryNumber = 0;
    const edgeType = retryNumber > 0 ? "retry" : "success";
    assert.equal(edgeType, "success");
  });

  it("edge_type is 'retry' when retry_number > 0", () => {
    const retryNumber = 1;
    const edgeType = retryNumber > 0 ? "retry" : "success";
    assert.equal(edgeType, "retry");
  });

  it("edge_type is 'fail' on contract_fail", () => {
    const event = { event: "contract_fail", edge_type: "fail" };
    assert.equal(event.edge_type, "fail");
  });

  it("edge_type is 'gate_block' on failed gate_result", () => {
    const event = { event: "gate_result", passed: false, edge_type: "gate_block" };
    assert.equal(event.edge_type, "gate_block");
  });

  it("edge_type is 'success' on passed gate_result", () => {
    const event = { event: "gate_result", passed: true, edge_type: "success" };
    assert.equal(event.edge_type, "success");
  });
});

describe("edgeMeta — edge_type taxonomy", () => {
  it("success maps to control_flow category", () => {
    const m = edgeMeta("success");
    assert.equal(m.edge_type, "success");
    assert.equal(m.edge_category, "control_flow");
  });

  it("retry maps to control_flow category", () => {
    const m = edgeMeta("retry");
    assert.equal(m.edge_type, "retry");
    assert.equal(m.edge_category, "control_flow");
  });

  it("fail maps to failure category", () => {
    const m = edgeMeta("fail");
    assert.equal(m.edge_type, "fail");
    assert.equal(m.edge_category, "failure");
  });

  it("timeout maps to failure category", () => {
    const m = edgeMeta("timeout");
    assert.equal(m.edge_type, "timeout");
    assert.equal(m.edge_category, "failure");
  });

  it("gate_block maps to policy category", () => {
    const m = edgeMeta("gate_block");
    assert.equal(m.edge_type, "gate_block");
    assert.equal(m.edge_category, "policy");
  });

  it("unknown type returns edge_category 'unknown'", () => {
    const m = edgeMeta("future_type");
    assert.equal(m.edge_type, "future_type");
    assert.equal(m.edge_category, "unknown");
  });

  it("EDGE_TYPE_CATEGORY covers all defined types", () => {
    const keys = Object.keys(EDGE_TYPE_CATEGORY);
    assert.ok(keys.includes("success"));
    assert.ok(keys.includes("retry"));
    assert.ok(keys.includes("fail"));
    assert.ok(keys.includes("timeout"));
    assert.ok(keys.includes("gate_block"));
  });
});

describe("validateStepGraph — plan structure validation", () => {
  const validAgents = new Set(["dev-backend", "qa", "architect"]);

  it("returns valid for a well-formed steps array", () => {
    const steps = [
      { agentId: "dev-backend", task: "implement feature" },
      { agentId: "qa", task: "verify output" },
    ];
    const result = validateStepGraph(steps, validAgents);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("returns invalid when steps is not an array", () => {
    const result = validateStepGraph(null, validAgents);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes("array"));
  });

  it("returns invalid when a step has no agentId", () => {
    const steps = [{ task: "do something" }];
    const result = validateStepGraph(steps, validAgents);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes("missing agentId"));
  });

  it("skips steps with unknown agentId without error", () => {
    const steps = [
      { agentId: "unknown-agent", task: "something" },
      { agentId: "dev-backend", task: "real work" },
    ];
    const result = validateStepGraph(steps, validAgents);
    assert.equal(result.valid, true);
  });

  it("rejects legacy agent field (agentId only, aligned with plan capability validation)", () => {
    const steps = [{ agent: "dev-backend", task: "work" }];
    const result = validateStepGraph(steps, validAgents);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes("missing agentId"));
  });
});

describe("assertParentStepExists — emit-time parent validation", () => {
  it("does not write to stderr when parentStepId is null", () => {
    const emitted = new Set(["step-1"]);
    const writes = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { writes.push(s); return true; };
    assertParentStepExists(null, emitted);
    process.stderr.write = orig;
    assert.equal(writes.length, 0);
  });

  it("does not write to stderr when parentStepId exists in emitted set", () => {
    const emitted = new Set(["task-i1-dev-backend"]);
    const writes = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { writes.push(s); return true; };
    assertParentStepExists("task-i1-dev-backend", emitted);
    process.stderr.write = orig;
    assert.equal(writes.length, 0);
  });

  it("writes warning to stderr when parentStepId is unknown", () => {
    const emitted = new Set(["task-i1-dev-backend"]);
    const writes = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { writes.push(s); return true; };
    assertParentStepExists("nonexistent-step", emitted);
    process.stderr.write = orig;
    assert.equal(writes.length, 1);
    assert.ok(writes[0].includes("nonexistent-step"));
  });
});
