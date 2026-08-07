"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isAiMinionsActive,
  activateAiMinionsEnv,
  ACTIVE_ENV,
  RUN_ID_ENV,
} = require("../../modules/shared/ai-minions-activation");

describe("ai-minions-activation", () => {
  it("isAiMinionsActive requires ACTIVE=1 and non-empty RUN_ID", () => {
    assert.equal(isAiMinionsActive({}), false);
    assert.equal(isAiMinionsActive({ [ACTIVE_ENV]: "1" }), false);
    assert.equal(isAiMinionsActive({ [ACTIVE_ENV]: "1", [RUN_ID_ENV]: "" }), false);
    assert.equal(
      isAiMinionsActive({ [ACTIVE_ENV]: "1", [RUN_ID_ENV]: "task-1" }),
      true,
    );
  });

  it("activateAiMinionsEnv sets both markers", () => {
    const env = {};
    activateAiMinionsEnv(env, { runId: "task-activate" });
    assert.equal(env[ACTIVE_ENV], "1");
    assert.equal(env[RUN_ID_ENV], "task-activate");
    assert.equal(isAiMinionsActive(env), true);
  });
});
