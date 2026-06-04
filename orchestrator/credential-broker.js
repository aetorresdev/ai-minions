'use strict';

/**
 * Brokered credential resolution outside model context (ENV-CREDENTIAL-BROKER-1).
 * Fail-closed; trace never contains secret values.
 */

const { resolveCredentials } = require('./agents');
const { effectiveMode } = require('./agents/permissions');
const { appendTraceEvent } = require('./trace-append');
const { redactSensitivePlaintext } = require('./trace-redact');

const READ_OPERATIONS = new Set([
  'query',
  'list',
  'describe',
  'read',
  'plan',
  'diff',
  'dry_run',
  'get',
  'fetch',
  'show',
]);

const WRITE_OPERATIONS = new Set([
  'apply',
  'activate',
  'update',
  'execute',
  'delete',
  'create',
  'insert',
  'patch',
  'put',
  'post',
  'run',
  'deploy',
]);

/**
 * @param {string} operationClass
 * @returns {'read'|'write'|'unknown'}
 */
function classifyOperation(operationClass) {
  const op = String(operationClass || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (!op) return 'unknown';
  if (WRITE_OPERATIONS.has(op)) return 'write';
  if (READ_OPERATIONS.has(op)) return 'read';
  return 'unknown';
}

/**
 * Canonical JS API uses camelCase; snake_case keys are accepted for doc/back-compat.
 * @param {object} raw
 */
function normalizeRequestParams(raw) {
  const params = raw || {};
  return {
    credentialAlias: params.credentialAlias ?? params.credential_alias,
    operationClass: params.operationClass ?? params.operation_class,
    target: params.target,
    agentId: params.agentId ?? params.agent_id,
    sessionEnv: params.sessionEnv ?? params.session_env ?? null,
    taskId: params.taskId ?? params.task_id,
    tracesDir: params.tracesDir ?? params.traces_dir,
  };
}

/**
 * Redact secrets from optional trace target (URLs, query strings, env values).
 * @param {string|undefined} rawTarget
 * @param {{ credentials?: Array<{ vars?: Record<string, string> }> }|null} sessionEnv
 * @returns {string|undefined}
 */
function sanitizeBrokerTraceTarget(rawTarget, sessionEnv) {
  let t = String(rawTarget || '').trim();
  if (!t) return undefined;
  t = t.slice(0, 200);
  t = redactSensitivePlaintext(t);
  t = t.replace(/([?&][^=]+=)([^&\s#]+)/g, '$1[REDACTED:query]');
  if (sessionEnv && Array.isArray(sessionEnv.credentials)) {
    const envNames = new Set();
    for (const cred of sessionEnv.credentials) {
      if (!cred || !cred.vars) continue;
      for (const envName of Object.values(cred.vars)) {
        if (envName) envNames.add(String(envName));
      }
    }
    for (const envName of envNames) {
      const val = process.env[envName];
      if (!val || val.length < 4) continue;
      if (t.includes(val)) t = t.split(val).join('[REDACTED:env]');
    }
  }
  return t || undefined;
}

/**
 * @param {object} params — camelCase preferred; snake_case aliases accepted
 * @param {string} params.credentialAlias
 * @param {string} params.operationClass
 * @param {string} [params.target]
 * @param {string} params.agentId
 * @param {{ mode: string, credentials: Array<{ name: string, type: string, vars: Record<string, string> }> }|null} params.sessionEnv
 * @param {string} [params.taskId]
 * @param {string} [params.tracesDir]
 * @returns {{ allowed: boolean, decision: 'allow'|'deny', reason_code: string, credential_alias: string, operation_class: string, operation_kind: string, effective_mode: string, resolved?: Record<string, string> }}
 */
function requestCredentialUse(rawParams) {
  const params = normalizeRequestParams(rawParams);
  const credentialAlias = String(params.credentialAlias || '').trim();
  const operationClass = String(params.operationClass || '').trim();
  const agentId = String(params.agentId || '').trim();
  const sessionEnv = params.sessionEnv || null;
  const operationKind = classifyOperation(operationClass);

  const base = {
    credential_alias: credentialAlias,
    operation_class: operationClass,
    operation_kind: operationKind,
    agent_id: agentId,
  };

  if (!credentialAlias || !operationClass || !agentId) {
    return finish({
      ...base,
      allowed: false,
      decision: 'deny',
      reason_code: 'credential_broker_denied_unknown_operation',
      effective_mode: 'none',
    }, params);
  }

  if (!sessionEnv || !Array.isArray(sessionEnv.credentials)) {
    return finish({
      ...base,
      allowed: false,
      decision: 'deny',
      reason_code: 'credential_broker_denied_unknown_alias',
      effective_mode: 'none',
    }, params);
  }

  const mode = effectiveMode(agentId, sessionEnv.mode || 'read');
  if (mode === 'none') {
    return finish({
      ...base,
      allowed: false,
      decision: 'deny',
      reason_code: 'credential_broker_denied_role_none',
      effective_mode: mode,
    }, params);
  }

  if (operationKind === 'unknown') {
    return finish({
      ...base,
      allowed: false,
      decision: 'deny',
      reason_code: 'credential_broker_denied_unknown_operation',
      effective_mode: mode,
    }, params);
  }

  const credDef = sessionEnv.credentials.find((c) => c && c.name === credentialAlias);
  if (!credDef) {
    return finish({
      ...base,
      allowed: false,
      decision: 'deny',
      reason_code: 'credential_broker_denied_unknown_alias',
      effective_mode: mode,
    }, params);
  }

  const resolvedList = resolveCredentials([credDef], agentId);
  const entry = resolvedList[0];
  if (!entry || entry.missing.length > 0) {
    return finish({
      ...base,
      allowed: false,
      decision: 'deny',
      reason_code: 'credential_broker_denied_missing_env',
      effective_mode: mode,
    }, params);
  }

  if (mode === 'read' && operationKind === 'write') {
    return finish({
      ...base,
      allowed: false,
      decision: 'deny',
      reason_code: 'credential_broker_denied_read_mode',
      effective_mode: mode,
    }, params);
  }

  return finish({
    ...base,
    allowed: true,
    decision: 'allow',
    reason_code: 'credential_broker_allowed',
    effective_mode: mode,
    resolved: { ...entry.resolved },
  }, params);
}

/**
 * @param {Record<string, unknown>} result
 * @param {object} params
 */
function finish(result, params) {
  const taskId = params.taskId && String(params.taskId).trim();
  if (taskId) {
    const safeTarget = sanitizeBrokerTraceTarget(params.target, params.sessionEnv);
    appendTraceEvent(
      taskId,
      {
        event: 'credential_broker_used',
        credential_alias: result.credential_alias,
        operation_class: result.operation_class,
        operation_kind: result.operation_kind,
        decision: result.decision,
        reason_code: result.reason_code,
        agent_id: result.agent_id,
        effective_mode: result.effective_mode,
        ...(safeTarget ? { target: safeTarget } : {}),
      },
      { tracesDir: params.tracesDir, throwOnInvalid: true },
    );
  }
  return result;
}

module.exports = {
  classifyOperation,
  normalizeRequestParams,
  sanitizeBrokerTraceTarget,
  requestCredentialUse,
  READ_OPERATIONS,
  WRITE_OPERATIONS,
};
