"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseEnvironment } = require("../environment-parser");

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

describe("environment-parser — parseEnvironment", () => {
  it("returns null when ENVIRONMENT block is absent", () => {
    assert.equal(parseEnvironment(GOAL_NO_ENV), null);
  });

  it("parses mode read and credential vars", () => {
    const sessionEnv = parseEnvironment(GOAL_WITH_ENV);
    assert.ok(sessionEnv);
    assert.equal(sessionEnv.mode, "read");
    assert.equal(sessionEnv.credentials.length, 1);
    assert.equal(sessionEnv.credentials[0].name, "example_api");
    assert.equal(sessionEnv.credentials[0].type, "api_key");
    assert.deepEqual(sessionEnv.credentials[0].vars, {
      url: "TEST_RUN_SCOPE_URL",
      key: "TEST_RUN_SCOPE_TOKEN",
    });
  });

  it("defaults mode to read when omitted", () => {
    const goal = `MODE: DEV
ENVIRONMENT:
  credentials:
    - name: svc
      type: token
      vars:
        token: SVC_TOKEN
`;
    const sessionEnv = parseEnvironment(goal);
    assert.ok(sessionEnv);
    assert.equal(sessionEnv.mode, "read");
  });

  it("parses write mode", () => {
    const goal = `ENVIRONMENT:
  mode: write
  credentials:
    - name: deploy
      type: api_key
      vars:
        key: DEPLOY_KEY
`;
    const sessionEnv = parseEnvironment(goal);
    assert.ok(sessionEnv);
    assert.equal(sessionEnv.mode, "write");
  });

  it("parses multiple credentials", () => {
    const goal = `ENVIRONMENT:
  mode: read
  credentials:
    - name: n8n
      type: api_key
      vars:
        url: N8N_URL
    - name: gh
      type: token
      vars:
        token: GH_TOKEN
`;
    const sessionEnv = parseEnvironment(goal);
    assert.ok(sessionEnv);
    assert.equal(sessionEnv.credentials.length, 2);
    assert.equal(sessionEnv.credentials[0].name, "n8n");
    assert.equal(sessionEnv.credentials[1].name, "gh");
  });

  it("skips credential entries missing name or type", () => {
    const goal = `ENVIRONMENT:
  mode: read
  credentials:
    - name: incomplete
    - name: ok
      type: api_key
      vars:
        key: OK_KEY
`;
    const sessionEnv = parseEnvironment(goal);
    assert.ok(sessionEnv);
    assert.equal(sessionEnv.credentials.length, 1);
    assert.equal(sessionEnv.credentials[0].name, "ok");
  });

  it("orchestrator re-export matches module implementation", () => {
    const { parseEnvironment: fromOrchestrator } = require("../orchestrator");
    assert.equal(fromOrchestrator, parseEnvironment);
  });
});
