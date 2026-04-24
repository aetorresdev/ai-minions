"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MODEL_ROUTING,
  FALLBACK_POLICY,
  resolveModel,
  resolveFallback,
} = require("../agents");

/** MODE roles that must stay wired for multi-agent runs (sync: model-routing.md § Explicit strategy). */
const EXPECTED_ROLES = [
  "architect",
  "cerberus",
  "dev-backend",
  "dev-devops",
  "dev-frontend",
  "orchestrator",
  "owner",
  "qa",
  "summarizer",
];

test("MODEL_ROUTING defines every MODE orchestration role", () => {
  const keys = Object.keys(MODEL_ROUTING).sort();
  assert.deepEqual(keys, [...EXPECTED_ROLES].sort());
  for (const role of EXPECTED_ROLES) {
    const r = MODEL_ROUTING[role];
    assert.ok(r && typeof r.primary === "string" && r.primary.length > 0, role);
    assert.ok(typeof r.localSafe === "boolean", `${role}.localSafe`);
    const prov = r.provider ?? "claude";
    assert.ok(prov === "ollama" || prov === "claude", `${role}.provider`);
  }
});

test("FALLBACK_POLICY covers the same roles as MODEL_ROUTING", () => {
  assert.deepEqual(Object.keys(FALLBACK_POLICY).sort(), Object.keys(MODEL_ROUTING).sort());
});

test("resolveModel returns a non-empty model id for each role (no profile)", () => {
  for (const role of EXPECTED_ROLES) {
    const m = resolveModel(role);
    assert.ok(typeof m === "string" && m.length > 0, role);
  }
});

test("resolveFallback: degraded roles return a model; architect and cerberus hard-fail", () => {
  const degraded = resolveFallback("orchestrator");
  assert.ok(degraded.model);
  assert.equal(degraded.degraded, true);
  assert.throws(() => resolveFallback("architect"), /hard fail/);
  assert.throws(() => resolveFallback("cerberus"), /hard fail/);
});
