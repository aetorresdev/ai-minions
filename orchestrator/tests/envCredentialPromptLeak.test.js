"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { parseEnvironment } = require("../orchestrator");
const { buildEnvContext } = require("../agents");

/**
 * @param {Record<string, string>} envVars
 * @returns {string}
 */
function goalWithCredentials(envVars) {
  const varLines = Object.entries(envVars)
    .map(([alias, envName]) => `        ${alias}: ${envName}`)
    .join("\n");
  return `MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: credential leak regression
ENVIRONMENT:
  mode: write
  credentials:
    - name: test_cred
      type: api_key
      vars:
${varLines}
`;
}

describe("ENV credential prompt leak — buildEnvContext", () => {
  /** @type {Record<string, string | undefined>} */
  let prevEnv;

  beforeEach(() => {
    prevEnv = {};
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /**
   * @param {Record<string, string>} set
   */
  function saveAndSetEnv(set) {
    for (const [k, v] of Object.entries(set)) {
      prevEnv[k] = process.env[k];
      process.env[k] = v;
    }
  }

  it("does not inject bearer token value into prompt context", () => {
    saveAndSetEnv({ TEST_LEAK_TOKEN: "bearer-super-secret-xyz" });
    const sessionEnv = parseEnvironment(goalWithCredentials({ token: "TEST_LEAK_TOKEN" }));
    const ctx = buildEnvContext("dev-backend", sessionEnv);
    assert.match(ctx, /TEST_LEAK_TOKEN/);
    assert.doesNotMatch(ctx, /bearer-super-secret-xyz/);
  });

  it("does not inject API key value into prompt context", () => {
    saveAndSetEnv({ TEST_LEAK_API_KEY: "sk-live-not-in-prompt-abc123" });
    const sessionEnv = parseEnvironment(goalWithCredentials({ key: "TEST_LEAK_API_KEY" }));
    const ctx = buildEnvContext("dev-backend", sessionEnv);
    assert.match(ctx, /TEST_LEAK_API_KEY/);
    assert.doesNotMatch(ctx, /sk-live-not-in-prompt/);
  });

  it("does not inject connection string value into prompt context", () => {
    saveAndSetEnv({
      TEST_LEAK_DB_URI: "mongodb://user:pass@cluster.example/db?authSource=admin",
    });
    const goal = `MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: leak
ENVIRONMENT:
  mode: read
  credentials:
    - name: db
      type: connection_string
      vars:
        uri: TEST_LEAK_DB_URI
`;
    const session = parseEnvironment(goal);
    const ctx = buildEnvContext("qa", session);
    assert.match(ctx, /TEST_LEAK_DB_URI/);
    assert.doesNotMatch(ctx, /mongodb:\/\//);
    assert.doesNotMatch(ctx, /:pass@/);
  });
});
