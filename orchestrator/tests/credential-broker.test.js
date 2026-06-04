'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  classifyOperation,
  requestCredentialUse,
} = require('../credential-broker');
const { validateTraceLine } = require('../trace-schema');

const TMP = path.join(os.tmpdir(), `orch-cred-broker-${process.pid}`);

const sessionEnv = {
  mode: 'read',
  credentials: [
    {
      name: 'n8n',
      type: 'api_key',
      vars: { url: 'N8N_TEST_URL', key: 'N8N_TEST_KEY' },
    },
  ],
};

describe('credential-broker', () => {
  beforeEach(() => {
    fs.mkdirSync(TMP, { recursive: true });
    process.env.N8N_TEST_URL = 'https://n8n.example.test';
    process.env.N8N_TEST_KEY = 'fake-key-not-in-trace';
  });

  afterEach(() => {
    delete process.env.N8N_TEST_URL;
    delete process.env.N8N_TEST_KEY;
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it('classifyOperation maps read and write classes', () => {
    assert.equal(classifyOperation('query'), 'read');
    assert.equal(classifyOperation('apply'), 'write');
    assert.equal(classifyOperation('weird-op'), 'unknown');
  });

  it('allows read operation under session read mode', () => {
    const r = requestCredentialUse({
      credentialAlias: 'n8n',
      operationClass: 'query',
      agentId: 'architect',
      sessionEnv,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason_code, 'credential_broker_allowed');
    assert.equal(r.resolved.key, 'fake-key-not-in-trace');
  });

  it('denies write operation under session read mode (fail closed)', () => {
    const r = requestCredentialUse({
      credentialAlias: 'n8n',
      operationClass: 'apply',
      agentId: 'architect',
      sessionEnv,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.decision, 'deny');
    assert.equal(r.reason_code, 'credential_broker_denied_read_mode');
    assert.equal(r.resolved, undefined);
  });

  it('denies unknown alias', () => {
    const r = requestCredentialUse({
      credentialAlias: 'missing',
      operationClass: 'query',
      agentId: 'architect',
      sessionEnv,
    });
    assert.equal(r.reason_code, 'credential_broker_denied_unknown_alias');
  });

  it('denies when env vars missing', () => {
    delete process.env.N8N_TEST_KEY;
    const r = requestCredentialUse({
      credentialAlias: 'n8n',
      operationClass: 'query',
      agentId: 'architect',
      sessionEnv,
    });
    assert.equal(r.reason_code, 'credential_broker_denied_missing_env');
  });

  it('accepts snake_case request keys (doc alias)', () => {
    const r = requestCredentialUse({
      credential_alias: 'n8n',
      operation_class: 'query',
      agent_id: 'architect',
      session_env: sessionEnv,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason_code, 'credential_broker_allowed');
  });

  it('emits credential_broker_used trace without secret values', () => {
    const taskId = 'cred-broker-trace-1';
    requestCredentialUse({
      credentialAlias: 'n8n',
      operationClass: 'query',
      agentId: 'architect',
      sessionEnv,
      taskId,
      tracesDir: TMP,
    });
    const raw = fs.readFileSync(path.join(TMP, `${taskId}.jsonl`), 'utf8');
    assert.ok(!raw.includes('fake-key-not-in-trace'));
    assert.ok(raw.includes('credential_broker_used'));
    const line = JSON.parse(raw.trim().split('\n').pop());
    const v = validateTraceLine(line);
    assert.equal(v.ok, true, v.errors?.join('; '));
    assert.equal(line.reason_code, 'credential_broker_allowed');
  });

  it('redacts target before trace (env value and query string)', () => {
    const taskId = 'cred-broker-target-redact';
    const secret = process.env.N8N_TEST_KEY;
    requestCredentialUse({
      credentialAlias: 'n8n',
      operationClass: 'query',
      agentId: 'architect',
      sessionEnv,
      taskId,
      tracesDir: TMP,
      target: `https://n8n.example.test/webhook?api_key=${secret}&token=Bearer sk-test12345678901234567890`,
    });
    const raw = fs.readFileSync(path.join(TMP, `${taskId}.jsonl`), 'utf8');
    assert.ok(!raw.includes(secret), 'trace must not contain env secret value');
    const line = JSON.parse(raw.trim().split('\n').pop());
    assert.ok(line.target);
    assert.ok(line.target.includes('[REDACTED:env]') || line.target.includes('[REDACTED:query]'));
    assert.ok(!line.target.includes(secret));
  });
});
