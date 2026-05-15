"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildApprovalRequiredFromPermissionTrace,
  buildApprovalGrantedPayload,
  buildApprovalDeniedPayload,
  governanceRunnerShouldHold,
  governanceOwnershipHandoffUnresolved,
} = require("../governance-gate");

test("governanceRunnerShouldHold is true when only approval_required", () => {
  const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const rows = [
    {
      event: "approval_required",
      approval_id: id,
      agent: "orchestrator",
      iteration: 0,
      gate_id: "governance_human",
      reason: "external_side_effect_requires_allow",
      action_summary: "x",
      role: "ORCHESTRATOR",
    },
  ];
  assert.equal(governanceRunnerShouldHold(rows), true);
});

test("governanceRunnerShouldHold is false after approval_granted", () => {
  const id = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const rows = [
    {
      event: "approval_required",
      approval_id: id,
      agent: "orchestrator",
      iteration: 0,
      gate_id: "governance_human",
      reason: "r",
      action_summary: "s",
      role: "ORCHESTRATOR",
    },
    {
      event: "approval_granted",
      approval_id: id,
      agent: "operator",
      iteration: 0,
      gate_id: "governance_human",
    },
  ];
  assert.equal(governanceRunnerShouldHold(rows), false);
});

test("governanceRunnerShouldHold stays true after approval_denied", () => {
  const id = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
  const rows = [
    {
      event: "approval_required",
      approval_id: id,
      agent: "orchestrator",
      iteration: 0,
      gate_id: "governance_human",
      reason: "r",
      action_summary: "s",
      role: "ORCHESTRATOR",
    },
    {
      event: "approval_denied",
      approval_id: id,
      agent: "operator",
      iteration: 0,
      gate_id: "governance_human",
      reason_code: "GOVERNANCE_OPERATOR_DENIED",
    },
  ];
  assert.equal(governanceRunnerShouldHold(rows), true);
});

test("governanceOwnershipHandoffUnresolved detects missing grant", () => {
  const id = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
  const rows = [
    buildApprovalRequiredFromPermissionTrace(
      {
        event: "permission_check",
        actor: "local",
        role: "DEV",
        tool: "x.y",
        domain: "mcp",
        action_class: "external_side_effect",
        target_class: null,
        decision: "requires_approval",
        reason_code: "requires_allow",
        policy_source: "p",
        permission_profile: "dev-local",
        requires_approval: true,
      },
      {
        mcpServer: "srv",
        mcpTool: "t",
        approval_id: id,
        ownership_change: true,
        handoff_contract_ref: "handoff-contract-001",
        source_role: "DEV",
        target_role: "OWNER",
      },
    ),
  ];
  assert.equal(governanceOwnershipHandoffUnresolved(rows), true);
  rows.push(buildApprovalGrantedPayload({ approval_id: id, agent: "operator", iteration: 1 }));
  assert.equal(governanceOwnershipHandoffUnresolved(rows), false);
});

test("buildApprovalDeniedPayload rejects unknown reason_code", () => {
  assert.throws(() =>
    buildApprovalDeniedPayload({
      approval_id: "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee",
      reason_code: "UNKNOWN",
    }),
  );
});
