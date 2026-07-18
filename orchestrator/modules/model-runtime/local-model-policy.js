'use strict';

/**
 * Local-only model execution policy (MVP).
 * Blocks remote providers when enabled; resolves explicit CLI/env model overrides.
 */

const GATE_ID = 'model_policy_block';
const MODEL_NOT_FOUND = 'MODEL_NOT_FOUND';

const { selectLocalModel } = require('./local-model-selection');
const {
  loadCanonicalRoutingConfig,
  resolveRoleDefaultTier,
  listAllowedModelsForTier,
} = require('./model-policy-config');
const {
  assertModelMeetsRoleCapability,
  pickCapableModel,
  MODEL_CAPABILITY_INSUFFICIENT,
} = require('./role-capability-probes');
const { isCriticalCapabilityRole } = require('./role-capability-profile');

/** Sources from selectLocalModel / CLI that pin every role to one model. */
const GLOBAL_PIN_SOURCES = new Set([
  'cli',
  'env_orchestr_local_model',
  'env_ollama_model',
]);

/** @type {{ cliModel: string | null, skipBackendCheck: boolean, selectionResult: import('./local-model-selection').LocalModelSelectionResult | null, cwd: string | null, endpointMeta: { host: string, port: number, base_url: string, endpoint_scope: string } | null }} */
let _runConfig = {
  cliModel: null,
  skipBackendCheck: false,
  selectionResult: null,
  cwd: null,
  endpointMeta: null,
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
  if (Object.prototype.hasOwnProperty.call(opts, 'endpointMeta')) {
    _runConfig.endpointMeta = opts.endpointMeta ?? null;
  }
}

function resetLocalModelPolicy() {
  _runConfig = {
    cliModel: null,
    skipBackendCheck: false,
    selectionResult: null,
    cwd: null,
    endpointMeta: null,
  };
  _traceReporter = null;
}

/**
 * Endpoint meta configured for the current local_only run (no secrets; may include scope only).
 * @returns {{ host: string, port: number, base_url: string, endpoint_scope: string } | null}
 */
function getLocalModelEndpointMeta() {
  return _runConfig.endpointMeta;
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
  const endpoint = _runConfig.endpointMeta
    ?? (_runConfig.selectionResult?.base_url
      ? {
          base_url: _runConfig.selectionResult.base_url,
          endpoint_scope: _runConfig.selectionResult.endpoint_scope,
          host: null,
          port: null,
        }
      : null);
  return {
    local_only_mode: true,
    model_backend: 'ollama',
    ...(endpoint?.endpoint_scope ? { endpoint_scope: endpoint.endpoint_scope } : {}),
    ...(endpoint?.base_url ? { base_url: endpoint.base_url } : {}),
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

  const ok = await checkOllama({ cwd });
  if (!ok) {
    throw createLocalOnlyPolicyError(
      '[local-only] Local model backend unreachable. Start Ollama or fix OLLAMA_HOST/OLLAMA_PORT.',
      { missing: 'local_backend', selected_model: resolved.model },
    );
  }

  return enriched;
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
function createModelNotFoundError(message, extra = {}) {
  const err = new Error(message);
  err.gate_id = GATE_ID;
  err.code = MODEL_NOT_FOUND;
  Object.assign(err, extra);
  return err;
}

/**
 * @param {unknown} role
 * @returns {string}
 */
function normalizeRoleKey(role) {
  return String(role ?? '').trim().toUpperCase().replace(/-/g, '_');
}

/**
 * @param {string} roleKey
 * @returns {string | null}
 */
function resolveRoleEnvOverride(roleKey) {
  const key = `MODEL_OVERRIDE_${roleKey}`;
  return normalizeModelName(process.env[key]);
}

/**
 * Global pin: --model / ORCH_LOCAL_MODEL / OLLAMA_MODEL (or cached selection from those).
 * Does not treat YAML default_model / auto_detect as a global pin so tier routing can apply.
 * @param {{ cliModel?: string | null }} [opts]
 * @returns {{ model: string, override_source: string, route_source: 'override' } | null}
 */
function resolveGlobalModelPin(opts = {}) {
  const cliModel = normalizeModelName(opts.cliModel ?? _runConfig.cliModel);
  if (cliModel) {
    return { model: cliModel, override_source: 'cli', route_source: 'override' };
  }
  const envLocal = normalizeModelName(process.env.ORCH_LOCAL_MODEL);
  if (envLocal) {
    return {
      model: envLocal,
      override_source: 'env_orchestr_local_model',
      route_source: 'override',
    };
  }
  const ollamaModel = normalizeModelName(process.env.OLLAMA_MODEL);
  if (ollamaModel) {
    return {
      model: ollamaModel,
      override_source: 'env_ollama_model',
      route_source: 'override',
    };
  }
  const sel = _runConfig.selectionResult;
  if (sel?.selected_model && GLOBAL_PIN_SOURCES.has(sel.override_source)) {
    return {
      model: sel.selected_model,
      override_source: sel.override_source,
      route_source: 'override',
    };
  }
  return null;
}

/**
 * @param {{ inventory?: string[] | null }} [opts]
 * @returns {Set<string> | null} null when inventory is unknown
 */
function resolveInventorySet(opts = {}) {
  if (Object.prototype.hasOwnProperty.call(opts, 'inventory')) {
    if (opts.inventory == null) return null;
    return new Set(Array.isArray(opts.inventory) ? opts.inventory : []);
  }
  const discovered = _runConfig.selectionResult?.discovered_models;
  if (Array.isArray(discovered)) return new Set(discovered);
  return null;
}

/**
 * @param {string} model
 * @param {Set<string> | null} inventory
 * @param {string} roleKey
 * @param {Record<string, unknown>} [extra]
 */
function assertModelInInventory(model, inventory, roleKey, extra = {}) {
  if (inventory == null) return;
  if (!inventory.has(model)) {
    throw createModelNotFoundError(
      `[local-only] MODEL_NOT_FOUND for role "${roleKey}": model "${model}" not in discovery inventory.`,
      { role: roleKey, model, ...extra },
    );
  }
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
function createCapabilityInsufficientError(message, extra = {}) {
  const err = new Error(message);
  err.gate_id = 'model_capability';
  err.code = MODEL_CAPABILITY_INSUFFICIENT;
  Object.assign(err, extra);
  return err;
}

/**
 * Apply capability evidence when present (critical roles only).
 * @param {string} model
 * @param {string} roleKey
 * @param {{ cwd?: string, capabilityByModel?: object }} opts
 */
function enforceRoleCapability(model, roleKey, opts) {
  if (!isCriticalCapabilityRole(roleKey)) return;
  try {
    assertModelMeetsRoleCapability(model, roleKey, {
      cwd: opts.cwd,
      capabilityByModel: opts.capabilityByModel,
    });
  } catch (err) {
    if (err && err.code === MODEL_CAPABILITY_INSUFFICIENT) throw err;
    throw err;
  }
}

/**
 * Resolve local Ollama model for a MODE role under local_only.
 * Precedence: MODEL_OVERRIDE_<ROLE> → global CLI/env pin → role_defaults+tiers ∩ inventory → YAML default_model.
 * Critical roles skip models with failing capability evidence and prefer capable inventory hits.
 *
 * @param {string} role
 * @param {{ cwd?: string, inventory?: string[] | null, cliModel?: string | null, capabilityByModel?: object }} [opts]
 * @returns {{
 *   model: string,
 *   role: string,
 *   tier: string | null,
 *   route_source: 'override' | 'role_defaults' | 'legacy_default',
 *   override_source: string | null,
 * }}
 */
function selectModelForRole(role, opts = {}) {
  const roleKey = normalizeRoleKey(role);
  if (!roleKey) {
    throw createModelNotFoundError(
      '[local-only] MODEL_NOT_FOUND: role is required for tier-by-role routing.',
      { role: role ?? null },
    );
  }

  const cwd = opts.cwd ?? _runConfig.cwd ?? process.cwd();
  const inventory = resolveInventorySet(opts);
  const capOpts = { cwd, capabilityByModel: opts.capabilityByModel };

  const roleOverride = resolveRoleEnvOverride(roleKey);
  if (roleOverride) {
    assertModelInInventory(roleOverride, inventory, roleKey);
    enforceRoleCapability(roleOverride, roleKey, capOpts);
    return {
      model: roleOverride,
      role: roleKey,
      tier: null,
      route_source: 'override',
      override_source: `env_model_override_${roleKey.toLowerCase()}`,
    };
  }

  const globalPin = resolveGlobalModelPin(opts);
  if (globalPin) {
    assertModelInInventory(globalPin.model, inventory, roleKey);
    enforceRoleCapability(globalPin.model, roleKey, capOpts);
    return {
      model: globalPin.model,
      role: roleKey,
      tier: null,
      route_source: 'override',
      override_source: globalPin.override_source,
    };
  }

  const auth = loadCanonicalRoutingConfig(cwd);

  if (auth.route_source === 'model_policy_json' && auth.policy) {
    const tier = resolveRoleDefaultTier(auth.policy, roleKey);
    const candidates = listAllowedModelsForTier(auth.policy, tier);
    if (!candidates.length) {
      throw createModelNotFoundError(
        `[local-only] MODEL_NOT_FOUND for role "${roleKey}": tier "${tier}" has no models configured.`,
        { role: roleKey, tier },
      );
    }
    if (inventory == null) {
      throw createModelNotFoundError(
        `[local-only] MODEL_NOT_FOUND for role "${roleKey}": discovery inventory unavailable for tier "${tier}".`,
        { role: roleKey, tier },
      );
    }

    let chosen = null;
    if (isCriticalCapabilityRole(roleKey)) {
      chosen = pickCapableModel(candidates, inventory, roleKey, capOpts);
      if (!chosen) {
        const inInv = candidates.filter((m) => inventory.has(m));
        if (inInv.length) {
          throw createCapabilityInsufficientError(
            `[local-only] ${MODEL_CAPABILITY_INSUFFICIENT} for role "${roleKey}": `
              + `no inventory model from tier "${tier}" passed capability probes `
              + `(selection is capability-based, not brand/size).`,
            { role: roleKey, tier, candidates: inInv },
          );
        }
      }
    }
    if (!chosen) {
      chosen = candidates.find((m) => inventory.has(m)) ?? null;
    }
    if (!chosen) {
      throw createModelNotFoundError(
        `[local-only] MODEL_NOT_FOUND for role "${roleKey}": no model from tier "${tier}" present in discovery inventory.`,
        { role: roleKey, tier, candidates: [...candidates] },
      );
    }
    enforceRoleCapability(chosen, roleKey, capOpts);
    return {
      model: chosen,
      role: roleKey,
      tier,
      route_source: 'role_defaults',
      override_source: null,
    };
  }

  const legacyModel =
    normalizeModelName(auth.legacy?.model)
    ?? normalizeModelName(_runConfig.selectionResult?.selected_model);
  if (!legacyModel) {
    throw createModelNotFoundError(
      `[local-only] MODEL_NOT_FOUND for role "${roleKey}": no model_policy.json routing and no YAML default_model.`,
      { role: roleKey, soft: true },
    );
  }
  assertModelInInventory(legacyModel, inventory, roleKey);
  enforceRoleCapability(legacyModel, roleKey, capOpts);
  return {
    model: legacyModel,
    role: roleKey,
    tier: null,
    route_source: 'legacy_default',
    override_source: _runConfig.selectionResult?.override_source ?? 'model_policy_yaml',
  };
}

/**
 * Ollama model name for the current agent invocation under local-only routing.
 * When `role` is set, resolves via tier-by-role (`selectModelForRole`).
 * @param {{ forceOllama?: boolean, agentModel?: string, role?: string, cwd?: string, inventory?: string[] | null, cliModel?: string | null }} [ctx]
 * @returns {string | null}
 */
function getEffectiveOllamaModel(ctx = {}) {
  if (isLocalOnlyModeEnabled()) {
    const role = ctx.role != null && String(ctx.role).trim() !== '' ? ctx.role : null;
    if (role) {
      /** @type {{ cwd?: string, inventory?: string[] | null, cliModel?: string | null }} */
      const selOpts = { cwd: ctx.cwd, cliModel: ctx.cliModel };
      if (Object.prototype.hasOwnProperty.call(ctx, 'inventory')) {
        selOpts.inventory = ctx.inventory;
      }
      try {
        return selectModelForRole(role, selOpts).model;
      } catch (err) {
        // Soft miss (nothing configured) → null so assertRemoteProviderBlocked can fire.
        if (err && err.code === MODEL_NOT_FOUND && err.soft === true) return null;
        throw err;
      }
    }
    return resolveLocalModelOverride()?.model ?? null;
  }
  if (ctx.forceOllama) {
    return normalizeModelName(process.env.OLLAMA_MODEL);
  }
  return ctx.agentModel ?? null;
}

module.exports = {
  GATE_ID,
  MODEL_NOT_FOUND,
  MODEL_CAPABILITY_INSUFFICIENT,
  isLocalOnlyModeEnabled,
  resolveLocalModelOverride,
  configureLocalModelPolicy,
  resetLocalModelPolicy,
  getLocalModelEndpointMeta,
  setLocalModelTraceReporter,
  createLocalOnlyPolicyError,
  assertRemoteProviderBlocked,
  getLocalOnlySessionContext,
  validateLocalOnlyRunPrerequisites,
  selectModelForRole,
  getEffectiveOllamaModel,
};
