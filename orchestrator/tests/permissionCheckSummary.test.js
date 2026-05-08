"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregatePermissionCheckRows,
  aggregatePermissionChecksFromTraceRows,
} = require("../security/permission-check-summary");
const { buildReport } = require("../token-trace-report");

test("permission-check-summary: empty rows yields zeros and empty top lists", () => {
  const s = aggregatePermissionCheckRows([]);
  assert.equal(s.permission_check_total, 0);
  assert.deepEqual(s.by_decision, { allow: 0, deny: 0, requires_approval: 0 });
  assert.deepEqual(s.reason_codes_top, []);
  assert.deepEqual(s.repeated_denials, []);
});

test("permission-check-summary: counts decisions and reason_codes_top", () => {
  const s = aggregatePermissionCheckRows([
    { decision: "allow", reason_code: "mcp_trust_allow", domain: "mcp", tool: "x.y" },
    { decision: "deny", reason_code: "mcp_trust_denied", domain: "mcp", tool: "bad.z" },
    {
      decision: "requires_approval",
      reason_code: "external_side_effect_requires_allow",
      domain: "filesystem",
      tool: "terraform",
    },
  ]);
  assert.equal(s.permission_check_total, 3);
  assert.deepEqual(s.by_decision, { allow: 1, deny: 1, requires_approval: 1 });
  const tops = s.reason_codes_top.map((x) => `${x.reason_code}:${x.count}`).sort();
  assert.deepEqual(tops, [
    "external_side_effect_requires_allow:1",
    "mcp_trust_allow:1",
    "mcp_trust_denied:1",
  ]);
});

test("permission-check-summary: repeated_denials lists fingerprints with count >= 2", () => {
  const s = aggregatePermissionCheckRows([
    { decision: "deny", reason_code: "network_host_denied", domain: "network", tool: "ollama_chat" },
    { decision: "deny", reason_code: "network_host_denied", domain: "network", tool: "ollama_chat" },
    { decision: "deny", reason_code: "network_host_denied", domain: "network", tool: "other" },
  ]);
  assert.equal(s.repeated_denials.length, 1);
  assert.equal(s.repeated_denials[0].count, 2);
  assert.equal(s.repeated_denials[0].tool, "ollama_chat");
  assert.equal(s.repeated_denials[0].domain, "network");
  assert.equal(s.repeated_denials[0].reason_code, "network_host_denied");
});

test("permission-check-summary: aggregatePermissionChecksFromTraceRows filters permission_check events", () => {
  const rows = [
    { event: "session_start", task_id: "t" },
    { event: "permission_check", decision: "allow", reason_code: "a", domain: "mcp", tool: "s.t" },
    { event: "mcp_call", server: "s", tool: "t" },
  ];
  const s = aggregatePermissionChecksFromTraceRows(rows);
  assert.equal(s.permission_check_total, 1);
  assert.equal(s.by_decision.allow, 1);
});

test("permission-check-summary: buildReport exposes derived + matches session_end.permission_summary", () => {
  const ps = aggregatePermissionCheckRows([
    { decision: "allow", reason_code: "x", domain: "mcp", tool: "a.b" },
  ]);
  const rows = [
    { event: "permission_check", decision: "allow", reason_code: "x", domain: "mcp", tool: "a.b" },
    {
      event: "session_end",
      task_id: "tid",
      permission_summary: ps,
    },
  ];
  const rep = buildReport(rows);
  assert.deepEqual(rep.permission_summary_derived, ps);
  assert.deepEqual(rep.permission_summary_from_session_end, ps);
});
