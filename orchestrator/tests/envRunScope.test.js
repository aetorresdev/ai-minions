"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { parseEnvironment } = require("../orchestrator");
const { buildEnvContext, resolveCredentials } = require("../agents");

const GOAL_WITH_ENV = `MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: smoke
ENVIRONMENT:
  mode: read
  credentials:
    - name: example_api
      type: api_key
      vars:
        url: TEST_RUN_SCOPE_URL
        key: TEST_RUN_SCOPE_TOKEN
`;

const GOAL_NO_ENV = `MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: smoke without credentials
`;

describe("ENV run scope — credential access", () => {
  /** @type {Record<string, string|undefined>} */
  let prevEnv;

  beforeEach(() => {
    prevEnv = {
      TEST_RUN_SCOPE_URL: process.env.TEST_RUN_SCOPE_URL,
      TEST_RUN_SCOPE_TOKEN: process.env.TEST_RUN_SCOPE_TOKEN,
    };
    process.env.TEST_RUN_SCOPE_URL = "https://example.test";
    process.env.TEST_RUN_SCOPE_TOKEN = "test-token-value";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("ENV-01: no ENVIRONMENT block → no credential context for agents", () => {
    assert.equal(parseEnvironment(GOAL_NO_ENV), null);
    assert.equal(buildEnvContext("dev-backend", null), "");
    assert.deepEqual(resolveCredentials(null, "dev-backend"), []);
  });

  it("ENV-02: declared ENVIRONMENT → credentials resolved at runtime, not in prompt", () => {
    const sessionEnv = parseEnvironment(GOAL_WITH_ENV);
    assert.ok(sessionEnv);
    const creds = resolveCredentials(sessionEnv.credentials, "dev-backend");
    assert.equal(creds.length, 1);
    assert.equal(creds[0].resolved.key, "test-token-value");
    assert.equal(creds[0].resolved.url, "https://example.test");
    const ctx = buildEnvContext("dev-backend", sessionEnv);
    assert.match(ctx, /example_api/);
    assert.match(ctx, /ENVIRONMENT ACCESS/);
    assert.match(ctx, /key→TEST_RUN_SCOPE_TOKEN/);
    assert.doesNotMatch(ctx, /test-token-value/);
    assert.doesNotMatch(ctx, /https:\/\/example\.test/);
  });

  it("ENV-03: later run without ENVIRONMENT does not inherit prior declaration", () => {
    const envA = parseEnvironment(GOAL_WITH_ENV);
    const envB = parseEnvironment(GOAL_NO_ENV);
    assert.ok(envA);
    assert.equal(envB, null);
    assert.equal(buildEnvContext("dev-backend", envB), "");
    const credsB = resolveCredentials(envB?.credentials, "dev-backend");
    assert.deepEqual(credsB, []);
  });

  it("ENV-04: undeclared env var in process.env is not resolved", () => {
    const goalUrlOnly = `MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: smoke
ENVIRONMENT:
  mode: read
  credentials:
    - name: example_api
      type: api_key
      vars:
        url: TEST_RUN_SCOPE_URL
`;
    const sessionEnv = parseEnvironment(goalUrlOnly);
    const creds = resolveCredentials(sessionEnv.credentials, "dev-backend");
    assert.equal(creds[0].resolved.url, "https://example.test");
    assert.equal(creds[0].resolved.key, undefined);
    assert.equal(creds[0].missing.length, 0);
    assert.ok(process.env.TEST_RUN_SCOPE_TOKEN);
  });

  it("ENV-05: missing-var blockers list env names only, not secret values", () => {
    delete process.env.TEST_RUN_SCOPE_TOKEN;
    const sessionEnv = parseEnvironment(GOAL_WITH_ENV);
    const ctx = buildEnvContext("dev-backend", sessionEnv);
    assert.match(ctx, /TEST_RUN_SCOPE_TOKEN/);
    assert.doesNotMatch(ctx, /test-token-value/);
  });
});
