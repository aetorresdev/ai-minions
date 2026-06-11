'use strict';

/**
 * Mocked E2E: session mode read + broker denies write-class ops.
 * Simulates an approved tool wrapper that must call requestCredentialUse() before live ops.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseEnvironment } = require('../orchestrator');
const { requestCredentialUse } = require('../credential-broker');
const { validateTraceLine } = require('../trace-schema');

const TMP = path.join(os.tmpdir(), `orch-readonly-e2e-${process.pid}`);

const WRITE_OPS_SPEC = ['apply', 'activate', 'update', 'execute', 'delete', 'create'];
const READ_OPS_SPEC = ['query', 'read'];

const GOAL_READ_ONLY = `MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: readonly-write-block-e2e
ENVIRONMENT:
  mode: read
  credentials:
    - name: n8n
      type: api_key
      vars:
        url: N8N_RO_E2E_URL
        key: N8N_RO_E2E_KEY
`;

/**
 * Mock tool path: broker gate before would-be live credential use.
 * @param {object} opts
 */
function mockBrokeredToolInvoke(opts) {
  const decision = requestCredentialUse(opts);
  if (!decision.allowed) {
    return { executed: false, broker: decision };
  }
  return { executed: true, broker: decision };
}

describe('ENV-READONLY-WRITE-BLOCK-E2E (mocked broker integration)', () => {
  /** @type {import('../orchestrator').parseEnvironment extends Function ? ReturnType<typeof parseEnvironment> : never} */
  let sessionEnv;

  beforeEach(() => {
    fs.mkdirSync(TMP, { recursive: true });
    process.env.N8N_RO_E2E_URL = 'https://n8n.example.test';
    process.env.N8N_RO_E2E_KEY = 'e2e-secret-must-not-trace';
    sessionEnv = parseEnvironment(GOAL_READ_ONLY);
    assert.ok(sessionEnv);
    assert.equal(sessionEnv.mode, 'read');
  });

  afterEach(() => {
    delete process.env.N8N_RO_E2E_URL;
    delete process.env.N8N_RO_E2E_KEY;
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  for (const operationClass of WRITE_OPS_SPEC) {
    it(`write-class "${operationClass}" is denied under session mode read`, () => {
      const out = mockBrokeredToolInvoke({
        credentialAlias: 'n8n',
        operationClass,
        agentId: 'architect',
        sessionEnv,
      });
      assert.equal(out.executed, false);
      assert.equal(out.broker.decision, 'deny');
      assert.equal(out.broker.reason_code, 'credential_broker_denied_read_mode');
      assert.equal(out.broker.resolved, undefined);
    });
  }

  for (const operationClass of READ_OPS_SPEC) {
    it(`read-class "${operationClass}" is allowed under session mode read`, () => {
      const out = mockBrokeredToolInvoke({
        credentialAlias: 'n8n',
        operationClass,
        agentId: 'architect',
        sessionEnv,
      });
      assert.equal(out.executed, true);
      assert.equal(out.broker.reason_code, 'credential_broker_allowed');
      assert.equal(out.broker.resolved.key, 'e2e-secret-must-not-trace');
    });
  }

  it('emits stable deny reason_code in trace for write attempt', () => {
    const taskId = 'readonly-e2e-deny-trace';
    mockBrokeredToolInvoke({
      credentialAlias: 'n8n',
      operationClass: 'execute',
      agentId: 'architect',
      sessionEnv,
      taskId,
      tracesDir: TMP,
    });
    const raw = fs.readFileSync(path.join(TMP, `${taskId}.jsonl`), 'utf8');
    assert.ok(!raw.includes('e2e-secret-must-not-trace'));
    const line = JSON.parse(raw.trim().split('\n').pop());
    const v = validateTraceLine(line);
    assert.equal(v.ok, true, v.errors?.join('; '));
    assert.equal(line.event, 'credential_broker_used');
    assert.equal(line.reason_code, 'credential_broker_denied_read_mode');
    assert.equal(line.decision, 'deny');
    assert.equal(line.effective_mode, 'read');
  });

  it('emits allow reason_code in trace for read attempt', () => {
    const taskId = 'readonly-e2e-allow-trace';
    mockBrokeredToolInvoke({
      credentialAlias: 'n8n',
      operationClass: 'query',
      agentId: 'architect',
      sessionEnv,
      taskId,
      tracesDir: TMP,
    });
    const raw = fs.readFileSync(path.join(TMP, `${taskId}.jsonl`), 'utf8');
    assert.ok(!raw.includes('e2e-secret-must-not-trace'));
    const line = JSON.parse(raw.trim().split('\n').pop());
    assert.equal(line.reason_code, 'credential_broker_allowed');
    assert.equal(line.decision, 'allow');
  });

  it('full mocked session: read then write — only read executes', () => {
    const taskId = 'readonly-e2e-session-flow';
    const readOut = mockBrokeredToolInvoke({
      credentialAlias: 'n8n',
      operationClass: 'query',
      agentId: 'architect',
      sessionEnv,
      taskId,
      tracesDir: TMP,
    });
    const writeOut = mockBrokeredToolInvoke({
      credentialAlias: 'n8n',
      operationClass: 'apply',
      agentId: 'architect',
      sessionEnv,
      taskId,
      tracesDir: TMP,
    });
    assert.equal(readOut.executed, true);
    assert.equal(writeOut.executed, false);
    assert.equal(writeOut.broker.reason_code, 'credential_broker_denied_read_mode');

    const lines = fs
      .readFileSync(path.join(TMP, `${taskId}.jsonl`), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .filter((e) => e.event === 'credential_broker_used');
    assert.equal(lines.length, 2);
    assert.equal(lines[0].reason_code, 'credential_broker_allowed');
    assert.equal(lines[1].reason_code, 'credential_broker_denied_read_mode');
  });
});
