"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildRunStateVisibility,
  deriveModelSelectionContext,
  deriveBlockingReasonCode,
  deriveLastSuccessfulPhase,
  deriveNextSafeAction,
  deriveToolFailureSummary,
  deriveContextAuthorityStatus,
  buildUnavailableToolFailureSummary,
  buildUnavailableContextAuthorityStatus,
  formatRunStateVisibilityLines,
} = require("../../modules/operator/operator-trace-summary");
const { buildOperatorTraceSummary } = require("../../modules/operator/operator-trace-summary");

test("deriveModelSelectionContext reads latest model_selection row", () => {
  const rows = [
    {
      event: "session_start",
      task_id: "m1",
      model_backend: "ollama",
    },
    {
      event: "model_selection",
      model: "qwen2.5-coder:7b",
      model_tier: "cheap",
      selection_reason: "default_model from .ai-minions/model-policy.yaml",
    },
  ];
  const ctx = deriveModelSelectionContext(rows);
  assert.equal(ctx.availability, "available");
  assert.equal(ctx.model, "qwen2.5-coder:7b");
  assert.equal(ctx.model_backend, "ollama");
  assert.match(ctx.selection_reason, /default_model/);
});

test("deriveModelSelectionContext unavailable without model_selection", () => {
  const ctx = deriveModelSelectionContext([
    { event: "session_start", model_backend: "ollama" },
  ]);
  assert.equal(ctx.availability, "unavailable");
  assert.equal(ctx.model, null);
  assert.equal(ctx.model_backend, "ollama");
});

test("deriveModelSelectionContext not_aggregated when multiple roles present", () => {
  const ctx = deriveModelSelectionContext([
    { event: "session_start", model_backend: "ollama" },
    {
      event: "model_selection",
      role: "DEV",
      model: "qwen2.5-coder:7b",
      model_tier: "cheap",
      route_source: "role_defaults",
      selection_reason: "role_defaults:tier=cheap",
      model_backend: "ollama",
    },
    {
      event: "model_selection",
      role: "ARCHITECT",
      model: "qwen3.6:35b-a3b",
      model_tier: "strong",
      route_source: "role_defaults",
      selection_reason: "role_defaults:tier=strong",
      model_backend: "ollama",
    },
  ]);
  assert.equal(ctx.availability, "not_aggregated");
  assert.equal(ctx.model, null);
  assert.equal(ctx.selection_reason, null);
  assert.equal(ctx.model_backend, "ollama");
});

test("deriveModelSelectionContext not_aggregated when same role but distinct models", () => {
  const ctx = deriveModelSelectionContext([
    {
      event: "model_selection",
      role: "DEV",
      model: "a",
      model_tier: "cheap",
      selection_reason: "first",
    },
    {
      event: "model_selection",
      role: "DEV",
      model: "b",
      model_tier: "cheap",
      selection_reason: "second",
    },
  ]);
  assert.equal(ctx.availability, "not_aggregated");
  assert.equal(ctx.model, null);
});

test("buildRunStateVisibility includes run state visibility contract fields", () => {
  const rows = [
    { event: "session_start", task_id: "rsv-1", flow_mode: "single_agent" },
    {
      event: "model_selection",
      model: "llama3",
      model_tier: "standard",
      selection_reason: "policy:local_only",
      model_backend: "ollama",
    },
    { event: "session_end", task_id: "rsv-1", done: true, iterations: 1, gate_blocks: 0 },
  ];
  const summary = buildOperatorTraceSummary(rows, { trace_file: "/traces/rsv-1.jsonl" });
  const runState = buildRunStateVisibility(summary, rows, {
    attach_bundle: "/bundles/rsv-1",
    report_path: "/bundles/rsv-1/inspect-report.json",
    privacy_notice_status: "privacy_scan_present",
  });
  assert.equal(runState.result_code, "RUN_FOUND");
  assert.equal(runState.model, "llama3");
  assert.equal(runState.attach_available, true);
  assert.equal(runState.attach_bundle_available, true);
  assert.equal(runState.attach_action_available, true);
  assert.equal(runState.attach_result_code, "RUN_ATTACH_AVAILABLE");
  assert.equal(runState.privacy_notice_status, "privacy_scan_present");
  assert.ok(runState.evidence_paths.includes("/traces/rsv-1.jsonl"));
});

test("buildRunStateVisibility marks attach ready when bundle missing but trace exists", () => {
  const rows = [
    { event: "session_start", task_id: "rsv-2", flow_mode: "single_agent" },
    { event: "session_end", task_id: "rsv-2", done: false, iterations: 1, gate_blocks: 1 },
  ];
  const summary = buildOperatorTraceSummary(rows, { trace_file: "/traces/rsv-2.jsonl" });
  const runState = buildRunStateVisibility(summary, rows, {});
  assert.equal(runState.attach_bundle_available, false);
  assert.equal(runState.attach_action_available, true);
  assert.equal(runState.attach_available, false);
  assert.equal(runState.attach_result_code, "RUN_ATTACH_READY");
  assert.match(runState.next_safe_action, /attach/);
  assert.match(runState.next_safe_action, /attach_available=false only means no bundle on disk yet/);
  assert.doesNotMatch(runState.next_safe_action, /merge|do not merge|CERBERUS evidence/i);
  const visibilityText = formatRunStateVisibilityLines(runState).join("\n");
  assert.match(visibilityText, /attach_note:/);
  assert.match(visibilityText, /run attach to create one/);
});

test("deriveNextSafeAction for blocked run prefers attach evidence over merge language", () => {
  const action = deriveNextSafeAction(
    "blocked",
    {
      run_id: "task-blocked",
      artifacts: { trace: "/t.jsonl", report: null, attach_bundle: null },
      missing_evidence: [],
    },
    {},
  );
  assert.match(action, /ai-minions attach --run-id task-blocked/);
  assert.doesNotMatch(action, /explain/);
  assert.doesNotMatch(action, /merge|CERBERUS/i);
});

test("deriveBlockingReasonCode prefers model_tier_gate_denied reason_code", () => {
  const rows = [
    {
      event: "model_tier_gate_denied",
      reason_code: "FRONTIER_UNAUTHORIZED_SOURCE",
    },
  ];
  const summary = buildOperatorTraceSummary(rows, { trace_file: "/t.jsonl" });
  assert.equal(
    deriveBlockingReasonCode(summary, rows),
    "FRONTIER_UNAUTHORIZED_SOURCE",
  );
});

test("deriveLastSuccessfulPhase returns complete phase for successful run", () => {
  const rows = [
    { event: "session_start", task_id: "ok" },
    { event: "agent_done", agent: "dev-backend", phase: "execute" },
    { event: "session_end", done: true },
  ];
  assert.equal(deriveLastSuccessfulPhase(rows), "complete");
});

test("deriveToolFailureSummary unavailable without tool_failure_eval events", () => {
  const summary = deriveToolFailureSummary([
    { event: "session_start", task_id: "plain" },
    { event: "session_end", done: true },
  ]);
  assert.equal(summary.availability, "unavailable");
  assert.equal(summary.reason_code, "unavailable");
  assert.equal(summary.next_safe_action, "unavailable");
  assert.equal(summary.evidence_path, "unavailable");
});

test("deriveToolFailureSummary reads latest tool_failure_eval row", () => {
  const rows = [
    {
      event: "tool_failure_eval",
      tool_id: "stub_mcp",
      failure_mode: "mcp_timeout",
      failure_type: "timeout",
      failure_axis: "tool",
      reason_code: "TOOL_FAILURE_MCP_TIMEOUT",
      decision: "fail_closed",
      operator_explanation: "MCP tool call timed out before a response was received.",
      next_safe_action: "retry_with_backoff_or_check_mcp_server",
      evidence_path: "fixture:mcp_timeout",
    },
    {
      event: "tool_failure_eval",
      tool_id: "stub_mcp",
      failure_mode: "mcp_unreachable",
      failure_type: "unreachable",
      failure_axis: "tool",
      reason_code: "TOOL_FAILURE_MCP_UNREACHABLE",
      decision: "fail_closed",
      operator_explanation: "MCP server was unreachable.",
      next_safe_action: "verify_mcp_server_running_and_network_path",
      evidence_path: "fixture:mcp_unreachable",
    },
  ];
  const summary = deriveToolFailureSummary(rows);
  assert.equal(summary.availability, "available");
  assert.equal(summary.reason_code, "TOOL_FAILURE_MCP_UNREACHABLE");
  assert.equal(summary.next_safe_action, "verify_mcp_server_running_and_network_path");
  assert.equal(summary.evidence_path, "fixture:mcp_unreachable");
});

test("deriveToolFailureSummary marks missing trace fields unavailable", () => {
  const summary = deriveToolFailureSummary([
    {
      event: "tool_failure_eval",
      reason_code: "TOOL_FAILURE_UNKNOWN",
      decision: "fail_closed",
    },
  ]);
  assert.equal(summary.availability, "available");
  assert.equal(summary.tool_id, "unavailable");
  assert.equal(summary.operator_explanation, "unavailable");
  assert.equal(summary.evidence_path, "unavailable");
});

test("deriveContextAuthorityStatus unavailable without context_authority_check events", () => {
  const summary = deriveContextAuthorityStatus([
    { event: "session_start", task_id: "plain" },
  ]);
  assert.equal(summary.availability, "unavailable");
  assert.equal(summary.decision, "unavailable");
  assert.equal(summary.evidence_path, "unavailable");
});

test("deriveContextAuthorityStatus reads latest context_authority_check row", () => {
  const rows = [
    {
      event: "context_authority_check",
      context_type: "document_text",
      authority_tier: "retrieved_context",
      instruction_source: "retrieved_context",
      decision: "accept_as_data",
      reason_code: "untrusted_context_data_only",
      failure_axis: "context_authority",
      failure_type: "none",
      injection_detected: false,
      attempted_action: null,
      variant: "benign",
      operator_explanation: "Untrusted context treated as reference data only.",
      next_safe_action: "continue_with_sovereign_user_instruction",
      evidence_path: "runtime:document_text",
    },
    {
      event: "context_authority_check",
      context_type: "fetched_web",
      authority_tier: "retrieved_context",
      instruction_source: "retrieved_context",
      decision: "ignore_instruction",
      reason_code: "injection_not_sovereign:invoke_shell",
      failure_axis: "context_authority",
      failure_type: "injection_not_sovereign",
      injection_detected: true,
      attempted_action: "invoke_shell",
      variant: "injected",
      operator_explanation: "Injected instruction from untrusted tier blocked.",
      next_safe_action: "escalate_to_operator",
      evidence_path: "runtime:fetched_web",
    },
  ];
  const status = deriveContextAuthorityStatus(rows);
  assert.equal(status.availability, "available");
  assert.equal(status.reason_code, "injection_not_sovereign:invoke_shell");
  assert.equal(status.injection_detected, true);
  assert.equal(status.next_safe_action, "escalate_to_operator");
});

test("buildRunStateVisibility includes harness resilience fields", () => {
  const rows = [
    { event: "session_start", task_id: "harness-1", flow_mode: "single_agent" },
    {
      event: "tool_failure_eval",
      tool_id: "stub_mcp",
      failure_mode: "mcp_timeout",
      failure_type: "timeout",
      failure_axis: "tool",
      reason_code: "TOOL_FAILURE_MCP_TIMEOUT",
      decision: "fail_closed",
      operator_explanation: "Timed out.",
      next_safe_action: "retry_with_backoff_or_check_mcp_server",
      evidence_path: "fixture:mcp_timeout",
    },
    { event: "session_end", task_id: "harness-1", done: true, iterations: 1, gate_blocks: 0 },
  ];
  const summary = buildOperatorTraceSummary(rows, { trace_file: "/traces/harness-1.jsonl" });
  const runState = buildRunStateVisibility(summary, rows, {});
  assert.equal(runState.tool_failure_summary.availability, "available");
  assert.equal(runState.context_authority_status.availability, "unavailable");
  const text = formatRunStateVisibilityLines(runState).join("\n");
  assert.match(text, /tool_failure_summary/);
  assert.match(text, /context_authority_status/);
  assert.match(text, /TOOL_FAILURE_MCP_TIMEOUT/);
});

test("unavailable harness summaries use stable unavailable sentinel", () => {
  const tf = buildUnavailableToolFailureSummary();
  const ca = buildUnavailableContextAuthorityStatus();
  assert.equal(tf.availability, "unavailable");
  assert.equal(ca.availability, "unavailable");
  assert.equal(tf.evidence_path, "unavailable");
  assert.equal(ca.next_safe_action, "unavailable");
});
