/**
 * Capability matrix parity (CAPABILITY-FLOW-1): roles and domains vs routing registry.
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { MODEL_ROUTING } = require("../agents");
const {
  CAPABILITY_MATRIX_VERSION,
  DOMAIN_ENUM,
  KNOWN_ROLE_IDS,
  getDomainsForRole,
  roleCanUseDomains,
  validatePlanStepRoles,
} = require("../agents/capability-matrix");

describe("capability matrix", () => {
  it("exposes a stable version string", () => {
    assert.match(CAPABILITY_MATRIX_VERSION, /^cap\.orchestrator\.v\d+$/);
  });

  it("lists the same role ids as MODEL_ROUTING", () => {
    assert.deepEqual(KNOWN_ROLE_IDS, Object.keys(MODEL_ROUTING).sort());
  });

  it("has unique sorted domains glossary", () => {
    const sorted = [...DOMAIN_ENUM].sort();
    assert.deepEqual(DOMAIN_ENUM, sorted);
    assert.equal(new Set(DOMAIN_ENUM).size, DOMAIN_ENUM.length);
  });

  it("every role assigns only glossary domains", () => {
    const allowed = new Set(DOMAIN_ENUM);
    for (const role of KNOWN_ROLE_IDS) {
      const set = getDomainsForRole(role);
      for (const d of set) {
        assert.ok(allowed.has(d), `${role}: unexpected domain ${d}`);
      }
    }
  });

  it("validatePlanStepRoles rejects unknown agentId", () => {
    const r = validatePlanStepRoles([{ agentId: "dev-backend", task: "x" }, { agentId: "nope", task: "y" }]);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("nope")));
  });

  it("roleCanUseDomains enforces subset", () => {
    assert.equal(roleCanUseDomains("orchestrator", ["shell"]).ok, false);
    assert.equal(roleCanUseDomains("dev-backend", ["filesystem", "shell"]).ok, true);
  });
});
