/**
 * Unit tests for compact_handoff failure policy helpers (strict vs degraded).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveRequireHandoff,
  compactHandoffDegradedMeta,
  compactHandoffStrictFailureFields,
} = require("../orchestrator");

describe("resolveRequireHandoff", () => {
  it("defaults to true when skipStateMcp is false/undefined (strict)", () => {
    assert.equal(resolveRequireHandoff({}), true);
    assert.equal(resolveRequireHandoff({ skipStateMcp: false }), true);
  });

  it("defaults to false when skipStateMcp is true (degraded)", () => {
    assert.equal(resolveRequireHandoff({ skipStateMcp: true }), false);
  });

  it("honours explicit requireHandoff override over skipStateMcp", () => {
    assert.equal(resolveRequireHandoff({ skipStateMcp: true, requireHandoff: true }), true);
    assert.equal(resolveRequireHandoff({ skipStateMcp: false, requireHandoff: false }), false);
  });
});

describe("compactHandoffDegradedMeta", () => {
  it("returns structured fallback metadata", () => {
    const m = compactHandoffDegradedMeta(new Error("mcp timeout"));
    assert.equal(m.handoff_compression, "unavailable");
    assert.equal(m.handoff_fallback_used, true);
    assert.equal(m.handoff_degraded, true);
    assert.equal(m.handoff_error, "mcp timeout");
  });
});

describe("compactHandoffStrictFailureFields", () => {
  it("returns gateBlocked fields with explicit compact_handoff reason", () => {
    const f = compactHandoffStrictFailureFields(new Error("claude CLI error"));
    assert.equal(f.handoffYaml, "");
    assert.equal(f.gateBlocked, true);
    assert.match(f.gateReason, /^compact_handoff failed:/);
    assert.equal(f.handoff_compression, "failed");
    assert.equal(f.handoff_error, "claude CLI error");
  });
});
