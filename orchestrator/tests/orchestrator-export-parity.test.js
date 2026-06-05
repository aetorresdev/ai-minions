/**
 * Public API parity for require("../orchestrator") after ORCH-LOOP module split.
 * Guards against accidental export loss or facade drift from extracted modules.
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// orchestrator.js requires agents.js — stub spawnSync before facade load.
const cp = require("child_process");
cp.spawnSync = () => ({ error: null, status: 0, stdout: "\n", stderr: "" });

/** Canonical export names — update only when intentionally changing the facade contract. */
const EXPECTED_ORCHESTRATOR_EXPORT_KEYS = [
  "_hashGoal",
  "_sanitize",
  "_test_beginMcpAudit",
  "_test_callCompactHandoff",
  "_test_callStateMcp",
  "_test_clearMcpAudit",
  "_test_invokeMcpDirect",
  "FAILURE_AXES",
  "FAILURE_TYPES",
  "TRACE_SCHEMA_VERSION",
  "TRANSITION_REASON_CODES",
  "TRANSITION_REASON_TYPES",
  "aggregateMcpUsage",
  "aggregatePermissionCheckRows",
  "applyQaSpecBeforeDevPlan",
  "assertParentStepExists",
  "compactHandoffDegradedMeta",
  "compactHandoffStrictFailureFields",
  "composeIterationDonePayload",
  "detectBlockers",
  "EDGE_TYPE_CATEGORY",
  "edgeMeta",
  "emitPermissionCheckTrace",
  "failureAxisForIterationDone",
  "failureTypeForIterationDone",
  "inferReasonCode",
  "isQaSpecBeforeDevEnabled",
  "parseEnvironment",
  "redactSensitivePlaintext",
  "resolveHandoffMode",
  "resolveMaxIterations",
  "resolveRequireHandoff",
  "run",
  "stripLeadingOwnerArchitectForDegradedMultiAgent",
  "traceIterationDone",
  "transitionReason",
  "validateHandoffStructure",
  "validateStepGraph",
].sort();

/** @param {string} modulePath @param {Record<string, string>} moduleKeyToOrchKey */
function assertFacadeReexports(modulePath, moduleKeyToOrchKey) {
  const orch = require("../orchestrator");
  const mod = require(modulePath);
  for (const [modKey, orchKey] of Object.entries(moduleKeyToOrchKey)) {
    assert.equal(
      orch[orchKey],
      mod[modKey],
      `${modulePath}.${modKey} must re-export as orchestrator.${orchKey}`,
    );
  }
}

describe("orchestrator facade — public export surface", () => {
  it("exports exactly the documented public keys (sorted parity)", () => {
    const orch = require("../orchestrator");
    assert.deepEqual(Object.keys(orch).sort(), EXPECTED_ORCHESTRATOR_EXPORT_KEYS);
  });

  it("run is a function entrypoint", () => {
    const { run } = require("../orchestrator");
    assert.equal(typeof run, "function");
  });
});

describe("orchestrator facade — environment-parser parity", () => {
  it("re-exports parseEnvironment by reference", () => {
    assertFacadeReexports("../environment-parser", {
      parseEnvironment: "parseEnvironment",
    });
  });
});

describe("orchestrator facade — trace-writer parity", () => {
  it("re-exports trace writer symbols by reference", () => {
    assertFacadeReexports("../trace-writer", {
      _sanitize: "_sanitize",
      _hashGoal: "_hashGoal",
      TRACE_SCHEMA_VERSION: "TRACE_SCHEMA_VERSION",
      transitionReason: "transitionReason",
      TRANSITION_REASON_TYPES: "TRANSITION_REASON_TYPES",
      TRANSITION_REASON_CODES: "TRANSITION_REASON_CODES",
      inferReasonCode: "inferReasonCode",
      FAILURE_TYPES: "FAILURE_TYPES",
      FAILURE_AXES: "FAILURE_AXES",
      failureTypeForIterationDone: "failureTypeForIterationDone",
      failureAxisForIterationDone: "failureAxisForIterationDone",
      traceIterationDone: "traceIterationDone",
      composeIterationDonePayload: "composeIterationDonePayload",
    });
  });

  it("re-exports redactSensitivePlaintext from trace-redact", () => {
    const orch = require("../orchestrator");
    const { redactSensitivePlaintext } = require("../trace-redact");
    assert.equal(orch.redactSensitivePlaintext, redactSensitivePlaintext);
  });
});

describe("orchestrator facade — mcp-client parity", () => {
  it("re-exports MCP audit surface by reference", () => {
    assertFacadeReexports("../mcp-client", {
      aggregateMcpUsage: "aggregateMcpUsage",
      emitPermissionCheckTrace: "emitPermissionCheckTrace",
      invokeMcpDirect: "_test_invokeMcpDirect",
      callStateMcp: "_test_callStateMcp",
      callCompactHandoff: "_test_callCompactHandoff",
      beginMcpAudit: "_test_beginMcpAudit",
      clearMcpAudit: "_test_clearMcpAudit",
    });
  });

  it("re-exports aggregatePermissionCheckRows from permission-check-summary", () => {
    const orch = require("../orchestrator");
    const { aggregatePermissionCheckRows } = require("../security/permission-check-summary");
    assert.equal(orch.aggregatePermissionCheckRows, aggregatePermissionCheckRows);
  });
});

describe("orchestrator facade — run-loop-helpers parity", () => {
  it("re-exports run-loop helper symbols by reference", () => {
    assertFacadeReexports("../run-loop-helpers", {
      resolveMaxIterations: "resolveMaxIterations",
      detectBlockers: "detectBlockers",
      validateHandoffStructure: "validateHandoffStructure",
      stripLeadingOwnerArchitectForDegradedMultiAgent: "stripLeadingOwnerArchitectForDegradedMultiAgent",
      edgeMeta: "edgeMeta",
      EDGE_TYPE_CATEGORY: "EDGE_TYPE_CATEGORY",
      validateStepGraph: "validateStepGraph",
      assertParentStepExists: "assertParentStepExists",
    });
  });
});
