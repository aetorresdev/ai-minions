'use strict';

/**
 * Local-only model execution policy (MVP).
 * Blocks remote providers when enabled; resolves explicit CLI/env model overrides.
 */

const GATE_ID = 'model_policy_block';

const { selectLocalModel } = require('./local-model-selection');

/** @type {{ cliModel: string | null, skipBackendCheck: boolean, selectionResult: import('./local-model-selection').LocalModelSelectionResult | null, cwd: string | null }} */
let _runConfig = {
  cliModel: null,
  skipBackendCheck: false,
  selectionResult: null,
  cwd: null,
};

/** @type {((payload: Record<string, unknown>) => void) | null} */
let _traceReporter = null;

function normalizeModelName(name) {
  const s = String(name ?? '').trim();
  return s || null;
}

function isTruthyDisabled(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no';
}

/**
 * True when remote model providers must not be invoked.
 */
function isLocalOnlyModeEnabled() {
  const mode = String(process.env.ORCH_MODEL_MODE ?? '').trim().toLowerCase();
  if (mode === 'local_only') return true;
  if (isTruthyDisabled(process.env.ORCH_ALLOW_REMOTE_MODELS)) return true;
  return false;
}

/**
 * Resolve explicit local model override (sync fast-path or cached selection result).
 * @param {{ cliModel?: string | null }} [opts]
 * @returns {{ model: string, override_source: string, selection_reason?: string, discovered_models?: string[] } | null}
 */
function resolveLocalModelOverride(opts = {}) {
  if (_runConfig.selectionResult?.selected_model) {
    const sel = _runConfig.selectionResult;
    return {
      model: sel.selected_model,
      override_source: sel.override_source,
      selection_reason: sel.selection_reason,
      discovered_models: sel.discovered_models,
    };
  }

  const cliModel = normalizeModelName(opts.cliModel ?? _runConfig.cliModel);
  if (cliModel) {
    return { model: cliModel, override_source: 'cli' };
  }
  const envLocal = normalizeModelName(process.env.ORCH_LOCAL_MODEL);
  if (envLocal) {
    return { model: envLocal, override_source: 'env_orchestr_local_model' };
  }
  const ollamaModel = normalizeModelName(process.env.OLLAMA_MODEL);
  if (ollamaModel) {
    return { model: ollamaModel, override_source: 'env_ollama_model' };
  }
  return null;
}

/**
 * Configure per-run policy inputs (CLI model, test hooks).
 * @param {{ cliModel?: string | null, skipBackendCheck?: boolean }} [opts]
 */
function configureLocalModelPolicy(opts = {}) {
  if (Object.prototype.hasOwnProperty.call(opts, 'cliModel')) {
    _runConfig.cliModel = normalizeModelName(opts.cliModel);
  }
  if (Object.prototype.hasOwnProperty.call(opts, 'skipBackendCheck')) {
    _runConfig.skipBackendCheck = opts.skipBackendCheck === true;
  }
  if (Object.prototype.hasOwnProperty.call(opts, 'selectionResult')) {
    _runConfig.selectionResult = opts.selectionResult ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(opts, 'cwd')) {
    _runConfig.cwd = opts.cwd != null ? String(opts.cwd) : null;
  }
}

function resetLocalModelPolicy() {
  _runConfig = {
    cliModel: null,
    skipBackendCheck: false,
    selectionResult: null,
    cwd: null,
  };
  _traceReporter = null;
}

/**
 * @param {(payload: Record<string, unknown>) => void} fn
 */
function setLocalModelTraceReporter(fn) {
  _traceReporter = typeof fn === 'function' ? fn : null;
}

function emitModelPolicyBlock(payload) {
  if (_traceReporter) {
    _traceReporter({
      event: 'model_policy_block',
      gate_id: GATE_ID,
      ...payload,
    });
  }
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
function createLocalOnlyPolicyError(message, extra = {}) {
  const err = new Error(message);
  err.gate_id = GATE_ID;
  err.code = 'LOCAL_ONLY_POLICY_VIOLATION';
  Object.assign(err, extra);
  return err;
}

/**
 * @param {{ provider?: string, agentId: string, backend?: string }} ctx
 */
function assertRemoteProviderBlocked(ctx) {
  if (!isLocalOnlyModeEnabled()) return;
  const backend = ctx.backend || ctx.provider || 'claude';
  if (backend === 'ollama') return;
  emitModelPolicyBlock({
    agent: ctx.agentId,
    blocked_provider: backend,
    reason: 'local_only_mode',
  });
  throw createLocalOnlyPolicyError(
    `[local-only] Remote model provider blocked for agent "${ctx.agentId}". ` +
      'Provide --model, ORCH_LOCAL_MODEL, or OLLAMA_MODEL and ensure Ollama is reachable.',
    { agentId: ctx.agentId, blocked_provider: backend },
  );
}

/**
 * Session trace fields for session_start when local-only is active or inactive.
 * @param {{ cliModel?: string | null }} [opts]
 */
function getLocalOnlySessionContext(opts = {}) {
  if (!isLocalOnlyModeEnabled()) {
    return { local_only_mode: false };
  }
  const resolved = resolveLocalModelOverride(opts);
  return {
    local_only_mode: true,
    ...(resolved
      ? {
          selected_model: resolved.model,
          override_source: resolved.override_source,
          ...(resolved.selection_reason ? { selection_reason: resolved.selection_reason } : {}),
          ...(resolved.discovered_models?.length
            ? { discovered_models: resolved.discovered_models }
            : {}),
        }
      : {}),
  };
}

/**
 * Fail fast before agent loop when local-only is on but model/backend is missing.
 * @param {{ checkOllama?: () => Promise<boolean>, cwd?: string, selectLocalModel?: typeof selectLocalModel }} [deps]
 */
async function validateLocalOnlyRunPrerequisites(deps = {}) {
  const ctx = getLocalOnlySessionContext();
  if (!ctx.local_only_mode) return ctx;

  const cwd = deps.cwd ?? _runConfig.cwd ?? process.cwd();
  const selectFn = deps.selectLocalModel ?? selectLocalModel;

  try {
    _runConfig.selectionResult = await selectFn({
      cwd,
      cliModel: _runConfig.cliModel,
      interactive: process.env.ORCH_NON_INTERACTIVE === '1' ? false : undefined,
    });
  } catch (err) {
    throw createLocalOnlyPolicyError(
      err instanceof Error ? err.message : String(err),
      { missing: 'selected_model' },
    );
  }

  const resolved = resolveLocalModelOverride();
  if (!resolved?.model) {
    throw createLocalOnlyPolicyError(
      '[local-only] No local model configured. Provide --model, ORCH_LOCAL_MODEL, model-policy.yaml, or discoverable Ollama models.',
      { missing: 'selected_model' },
    );
  }

  const enriched = getLocalOnlySessionContext();

  if (_runConfig.skipBackendCheck) {
    return enriched;
  }

  const checkOllama = deps.checkOllama;
  if (typeof checkOllama !== 'function') {
    throw new Error('validateLocalOnlyRunPrerequisites requires checkOllama when backend check is enabled');
  }

  const ok = await checkOllama();
  if (!ok) {
    throw createLocalOnlyPolicyError(
      '[local-only] Local model backend unreachable. Start Ollama or fix OLLAMA_HOST/OLLAMA_PORT.',
      { missing: 'local_backend', selected_model: resolved.model },
    );
  }

  return enriched;
}

/**
 * Ollama model name for the current agent invocation under local-only routing.
 * @param {{ forceOllama?: boolean, agentModel?: string }} [ctx]
 * @returns {string | null}
 */
function getEffectiveOllamaModel(ctx = {}) {
  if (isLocalOnlyModeEnabled()) {
    return resolveLocalModelOverride()?.model ?? null;
  }
  if (ctx.forceOllama) {
    return normalizeModelName(process.env.OLLAMA_MODEL);
  }
  return ctx.agentModel ?? null;
}

module.exports = {
  GATE_ID,
  isLocalOnlyModeEnabled,
  resolveLocalModelOverride,
  configureLocalModelPolicy,
  resetLocalModelPolicy,
  setLocalModelTraceReporter,
  createLocalOnlyPolicyError,
  assertRemoteProviderBlocked,
  getLocalOnlySessionContext,
  validateLocalOnlyRunPrerequisites,
  getEffectiveOllamaModel,
};
