/**
 * Public API parity for require("./agents") / require("../agents").
 * Prevents accidental removal or rename of facade exports (ROLE-REGISTRY-2+).
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/** Canonical export names — update when intentionally extending the facade contract. */
const EXPECTED_AGENT_EXPORT_KEYS = [
  "AGENTS",
  "CONTRACT_VERSION",
  "FALLBACK_POLICY",
  "MODEL_ROUTING",
  "ROLE_PERMISSION",
  "askAgent",
  "buildEnvContext",
  "cerberusFindingHasAnchor",
  "chatWithAgent",
  "clearDegradedAgents",
  "effectiveMode",
  "getDegradedAgents",
  "inferModelFallbackReason",
  "listAgents",
  "normalizeDevContractText",
  "parseCerberusTripleTemplate",
  "resolveCredentials",
  "resolveFallback",
  "resolveModel",
  "runOllama",
  "setBackend",
  "setModelProfile",
  "summarizeHandoff",
  "validateCerberusSemanticFloor",
  "validateOutput",
].sort();

describe("agents facade public API", () => {
  it("exports exactly the documented public keys (sorted parity)", () => {
    const agents = require("../agents");
    assert.deepEqual(Object.keys(agents).sort(), EXPECTED_AGENT_EXPORT_KEYS);
  });
});
