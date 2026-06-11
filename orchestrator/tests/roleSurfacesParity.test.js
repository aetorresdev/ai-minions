"use strict";

/**
 * Cross-surface role id parity: routing, permissions, capability matrix, AGENTS registry.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { MODEL_ROUTING, ROLE_PERMISSION, AGENTS } = require("../agents");
const { KNOWN_ROLE_IDS } = require("../agents/capability-matrix");

function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

/** Roles present in routing/matrix/permissions but not interactive AGENTS (handoff-only, etc.). */
const ROUTING_ONLY_IDS = new Set(["summarizer"]);

describe("role surfaces parity (MODEL_ROUTING × ROLE_PERMISSION × matrix × AGENTS)", () => {
  it("MODEL_ROUTING matches ROLE_PERMISSION keys", () => {
    assert.deepEqual(sortedKeys(MODEL_ROUTING), sortedKeys(ROLE_PERMISSION));
  });

  it("capability matrix roles match MODEL_ROUTING keys", () => {
    assert.deepEqual([...KNOWN_ROLE_IDS].sort(), sortedKeys(MODEL_ROUTING));
  });

  it("every AGENTS id exists in MODEL_ROUTING", () => {
    for (const id of sortedKeys(AGENTS)) {
      assert.ok(MODEL_ROUTING[id], `AGENTS has "${id}" but MODEL_ROUTING does not`);
    }
  });

  it("every MODEL_ROUTING id is either in AGENTS or explicitly routing-only", () => {
    for (const id of sortedKeys(MODEL_ROUTING)) {
      if (ROUTING_ONLY_IDS.has(id)) {
        assert.ok(!AGENTS[id], `routing-only role "${id}" should not appear in AGENTS`);
        continue;
      }
      assert.ok(AGENTS[id], `MODEL_ROUTING has "${id}" but AGENTS does not (add to registry or ROUTING_ONLY_IDS)`);
    }
  });
});
