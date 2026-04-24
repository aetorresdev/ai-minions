/**
 * Parity: permission matrix roles stay aligned with model routing keys (S1 refactor guard).
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { ROLE_PERMISSION, MODEL_ROUTING } = require("../agents");

describe("ROLE_PERMISSION vs MODEL_ROUTING", () => {
  it("defines the same role keys as MODEL_ROUTING", () => {
    assert.deepEqual(
      Object.keys(ROLE_PERMISSION).sort(),
      Object.keys(MODEL_ROUTING).sort(),
    );
  });

  it("uses only none | read | write values", () => {
    const allowed = new Set(["none", "read", "write"]);
    for (const [role, perm] of Object.entries(ROLE_PERMISSION)) {
      assert.ok(allowed.has(perm), `role ${role}: unexpected permission "${perm}"`);
    }
  });
});
