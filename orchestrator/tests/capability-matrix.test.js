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
  validatePlanCredentialCeiling,
  validatePlanStepHandoffDeclarations,
  validatePlanStepsCapability,
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

  it("validatePlanStepRoles rejects legacy agent field (agentId only)", () => {
    const r = validatePlanStepRoles([{ agent: "dev-backend", task: "x" }]);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /legacy.*agent/i.test(e)));
  });

  it("roleCanUseDomains enforces subset", () => {
    assert.equal(roleCanUseDomains("summarizer", ["shell"]).ok, false);
    assert.equal(roleCanUseDomains("dev-backend", ["filesystem", "shell"]).ok, true);
  });

  it("validatePlanStepRoles accepts optional requiredDomains when role allows them", () => {
    const r = validatePlanStepRoles([
      { agentId: "dev-backend", task: "x", requiredDomains: ["filesystem", "shell"] },
    ]);
    assert.equal(r.ok, true);
  });

  it("validatePlanStepRoles rejects requiredDomains not allowed for role", () => {
    const r = validatePlanStepRoles([
      { agentId: "orchestrator", task: "plan", requiredDomains: ["git"] },
    ]);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /cannot use domain/.test(e)));
  });

  it("validatePlanStepRoles rejects non-array requiredDomains", () => {
    const r = validatePlanStepRoles([{ agentId: "dev-backend", task: "x", requiredDomains: "filesystem" }]);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /requiredDomains must be an array/i.test(e)));
  });

  it("validatePlanCredentialCeiling rejects shell when session ceiling is read", () => {
    const r = validatePlanCredentialCeiling(
      [{ agentId: "dev-backend", task: "x", requiredDomains: ["shell"] }],
      "read",
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /require write-capable session/i.test(e)));
  });

  it("review roles allow local_model and network for local-only Ollama routing", () => {
    assert.equal(roleCanUseDomains("qa", ["local_model", "network"]).ok, true);
    assert.equal(roleCanUseDomains("cerberus", ["local_model", "network"]).ok, true);
    assert.equal(roleCanUseDomains("cerberus", ["mcp"]).ok, false);
  });

  it("validatePlanCredentialCeiling allows filesystem-only domains under read session", () => {
    const r = validatePlanCredentialCeiling(
      [{ agentId: "qa", task: "x", requiredDomains: ["filesystem", "remote_model"] }],
      "read",
    );
    assert.equal(r.ok, true);
  });

  it("validatePlanStepHandoffDeclarations rejects unknown handoff key name", () => {
    const r = validatePlanStepHandoffDeclarations([
      { agentId: "dev-backend", task: "x", requiredHandoffKeys: ["files_read", "not_a_real_key"] },
    ]);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /unknown requiredHandoffKeys/i.test(e)));
  });

  it("validatePlanStepsCapability merges role + credential + handoff errors", () => {
    const r = validatePlanStepsCapability(
      [
        {
          agentId: "dev-backend",
          task: "x",
          requiredDomains: ["shell"],
          requiredHandoffKeys: ["bogus"],
        },
      ],
      { sessionCredentialMode: "read" },
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.length >= 2);
  });
});
