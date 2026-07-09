'use strict';

/**
 * Preflight checks before launching an orchestrator run from the runner TUI/CLI.
 */

const path = require('path');

const { discoverLocalModels } = require('../../local-model-discovery');
const { selectLocalModel, MODEL_NOT_FOUND_PREFIX } = require('../../local-model-selection');
const {
  MODEL_RUNTIME_REASON,
  resolvePolicyCwd,
  buildDiscoverOptions,
} = require('../../local-runtime-endpoint');

const VALID_MODEL_POLICIES = new Set(['local_only', 'remote_ok']);

/**
 * @param {unknown} value
 * @returns {'local_only' | 'remote_ok' | null}
 */
function normalizeModelPolicy(value) {
  if (value == null || String(value).trim() === '') {
    return 'local_only';
  }
  const v = String(value).trim().toLowerCase();
  if (v === 'local_only') return 'local_only';
  if (v === 'remote_ok' || v === 'remote-approved' || v === 'remote_approved') return 'remote_ok';
  return null;
}

/**
 * Resolve CLI/env model policy input with explicit-unknown rejection (preflight parity).
 * @param {unknown} rawPolicy
 * @returns {{
 *   ok: true,
 *   policy: 'local_only' | 'remote_ok',
 *   explicit: boolean,
 * } | {
 *   ok: false,
 *   blocker: string,
 * }}
 */
function resolveModelPolicyInput(rawPolicy) {
  const explicit = rawPolicy != null && String(rawPolicy).trim() !== '';
  const normalized = normalizeModelPolicy(rawPolicy);
  if (explicit && normalized == null) {
    return {
      ok: false,
      blocker: `unknown model policy: ${String(rawPolicy).trim()}`,
    };
  }
  return {
    ok: true,
    policy: normalized ?? 'local_only',
    explicit,
  };
}

/**
 * @param {string | null} reasonCode
 * @param {string[]} blockers
 * @returns {string | null}
 */
function deriveModelRuntimeNextSafeAction(reasonCode, blockers) {
  if (reasonCode === MODEL_RUNTIME_REASON.OK) return null;
  if (reasonCode === MODEL_RUNTIME_REASON.NOT_FOUND) {
    return 'Pull the model on Ollama or pass --model with a name from doctor /api/tags inventory';
  }
  if (reasonCode === MODEL_RUNTIME_REASON.UNREACHABLE) {
    if (blockers.some((b) => /public_endpoint blocked/i.test(b))) {
      return 'Use a private LAN host or pass --allow-public-local-runtime to opt in explicitly';
    }
    return 'Verify Ollama is running at the configured host/port, then re-run: ai-minions doctor';
  }
  return 'Re-run: ai-minions doctor --model-policy local_only';
}

/**
 * @param {string} message
 * @returns {string | null}
 */
function classifySelectionReasonCode(message) {
  if (message.includes(MODEL_NOT_FOUND_PREFIX)) return MODEL_RUNTIME_REASON.NOT_FOUND;
  if (/missing local backend|unreachable|network egress denied/i.test(message)) {
    return MODEL_RUNTIME_REASON.UNREACHABLE;
  }
  return null;
}

/**
 * @param {{
 *   cwd?: string,
 *   modelPolicy?: string,
 *   model?: string | null,
 *   interactive?: boolean,
 *   localProvider?: string | null,
 *   ollamaHost?: string | null,
 *   ollamaPort?: number | string | null,
 *   ollamaBaseUrl?: string | null,
 *   allowPublicLocalRuntime?: boolean,
 *   discover?: typeof discoverLocalModels,
 *   selectLocalModel?: typeof selectLocalModel,
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   model_policy: 'local_only' | 'remote_ok',
 *   provider: string,
 *   selected_model: string | null,
 *   override_source: string | null,
 *   selection_reason: string | null,
 *   discovered_models: string[],
 *   ollama_reachable: boolean | null,
 *   model_runtime_reason_code: string | null,
 *   endpoint_scope: string | null,
 *   base_url: string | null,
 *   resolved_endpoint: { host: string, port: number, base_url: string, endpoint_scope: string, source?: string } | null,
 *   policy_source: string | null,
 *   config_path: string | null,
 *   config_target: string | null,
 *   selection_result: import('../../local-model-selection').LocalModelSelectionResult | null,
 *   next_safe_action: string | null,
 *   blockers: string[],
 * }>}
 */
async function buildRunPreflight(options = {}) {
  const policyCwd = resolvePolicyCwd(options.cwd || process.cwd());
  const configPath = path.join(policyCwd, '.ai-minions', 'model-policy.yaml');
  const discover = options.discover ?? discoverLocalModels;
  const selectFn = options.selectLocalModel ?? selectLocalModel;
  /** @type {string[]} */
  const blockers = [];
  const policyMeta = (resolvedEndpoint = null) => ({
    policy_source: resolvedEndpoint?.source ?? null,
    config_path: configPath,
    config_target: policyCwd,
  });

  if (options.localProvider != null && String(options.localProvider).trim().toLowerCase() !== 'ollama') {
    blockers.push(`unsupported --local-provider: ${String(options.localProvider).trim()} (only ollama is supported)`);
    return {
      ok: false,
      model_policy: 'local_only',
      provider: 'ollama',
      selected_model: null,
      override_source: null,
      selection_reason: null,
      discovered_models: [],
      ollama_reachable: null,
      model_runtime_reason_code: MODEL_RUNTIME_REASON.UNREACHABLE,
      endpoint_scope: null,
      base_url: null,
      resolved_endpoint: null,
      selection_result: null,
      next_safe_action: deriveModelRuntimeNextSafeAction(MODEL_RUNTIME_REASON.UNREACHABLE, blockers),
      blockers,
      ...policyMeta(),
    };
  }

  const resolvedPolicyInput = resolveModelPolicyInput(options.modelPolicy);
  if (!resolvedPolicyInput.ok) {
    blockers.push(resolvedPolicyInput.blocker);
    return {
      ok: false,
      model_policy: 'local_only',
      provider: 'ollama',
      selected_model: null,
      override_source: null,
      selection_reason: null,
      discovered_models: [],
      ollama_reachable: null,
      model_runtime_reason_code: null,
      endpoint_scope: null,
      base_url: null,
      resolved_endpoint: null,
      selection_result: null,
      next_safe_action: null,
      blockers,
      ...policyMeta(),
    };
  }

  const resolvedPolicy = resolvedPolicyInput.policy;

  if (resolvedPolicy === 'remote_ok') {
    return {
      ok: blockers.length === 0,
      model_policy: 'remote_ok',
      provider: 'claude',
      selected_model: null,
      override_source: null,
      selection_reason: 'remote_ok policy — local model selection not required',
      discovered_models: [],
      ollama_reachable: null,
      model_runtime_reason_code: null,
      endpoint_scope: null,
      base_url: null,
      resolved_endpoint: null,
      selection_result: null,
      next_safe_action: null,
      blockers,
      ...policyMeta(),
    };
  }

  /** @type {{ host: string, port: number, base_url: string, endpoint_scope: string } | null} */
  let resolvedEndpoint = null;
  try {
    const built = buildDiscoverOptions(policyCwd, {
      ollamaHost: options.ollamaHost,
      ollamaPort: options.ollamaPort,
      ollamaBaseUrl: options.ollamaBaseUrl,
      allowPublicLocalRuntime: options.allowPublicLocalRuntime,
    });
    resolvedEndpoint = built.endpoint;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    blockers.push(message);
    return {
      ok: false,
      model_policy: 'local_only',
      provider: 'ollama',
      selected_model: null,
      override_source: null,
      selection_reason: null,
      discovered_models: [],
      ollama_reachable: false,
      model_runtime_reason_code: MODEL_RUNTIME_REASON.UNREACHABLE,
      endpoint_scope: null,
      base_url: null,
      resolved_endpoint: null,
      selection_result: null,
      next_safe_action: deriveModelRuntimeNextSafeAction(MODEL_RUNTIME_REASON.UNREACHABLE, blockers),
      blockers,
      ...policyMeta(resolvedEndpoint),
    };
  }

  const discoverWithEndpoint = (extra = {}) => discover({
    host: resolvedEndpoint.host,
    port: resolvedEndpoint.port,
    cwd: policyCwd,
    endpoint: resolvedEndpoint,
    allowPublicLocalRuntime: options.allowPublicLocalRuntime,
    ...extra,
  });

  let selection = null;
  try {
    selection = await selectFn({
      cwd: policyCwd,
      cliModel: options.model ?? null,
      interactive: options.interactive === true,
      discover: discoverWithEndpoint,
      ollamaHost: options.ollamaHost,
      ollamaPort: options.ollamaPort,
      ollamaBaseUrl: options.ollamaBaseUrl,
      allowPublicLocalRuntime: options.allowPublicLocalRuntime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    blockers.push(message);
    const reasonCode = classifySelectionReasonCode(message) ?? MODEL_RUNTIME_REASON.UNREACHABLE;
    return {
      ok: false,
      model_policy: 'local_only',
      provider: 'ollama',
      selected_model: null,
      override_source: null,
      selection_reason: null,
      discovered_models: [],
      ollama_reachable: reasonCode === MODEL_RUNTIME_REASON.NOT_FOUND ? true : false,
      model_runtime_reason_code: reasonCode,
      endpoint_scope: resolvedEndpoint.endpoint_scope,
      base_url: resolvedEndpoint.base_url,
      resolved_endpoint: resolvedEndpoint,
      selection_result: null,
      next_safe_action: deriveModelRuntimeNextSafeAction(reasonCode, blockers),
      blockers,
      ...policyMeta(resolvedEndpoint),
    };
  }

  const discovery = await discoverWithEndpoint();
  const ollamaReachable = discovery.backends.some((b) => b.backend_id === 'ollama' && b.available);
  if (discovery.missing_local_backend) {
    blockers.push(discovery.missing_local_backend);
  } else if (!ollamaReachable) {
    blockers.push('ollama backend unreachable');
  }

  let modelRuntimeReason = MODEL_RUNTIME_REASON.OK;
  if (!ollamaReachable) {
    modelRuntimeReason = MODEL_RUNTIME_REASON.UNREACHABLE;
  } else if (blockers.some((b) => b.includes(MODEL_NOT_FOUND_PREFIX))) {
    modelRuntimeReason = MODEL_RUNTIME_REASON.NOT_FOUND;
  }

  return {
    ok: blockers.length === 0,
    model_policy: resolvedPolicy,
    provider: 'ollama',
    selected_model: selection.selected_model,
    override_source: selection.override_source,
    selection_reason: selection.selection_reason,
    discovered_models: selection.discovered_models?.length
      ? selection.discovered_models
      : discovery.models.map((m) => m.name),
    ollama_reachable: ollamaReachable,
    model_runtime_reason_code: modelRuntimeReason,
    endpoint_scope: selection.endpoint_scope ?? resolvedEndpoint.endpoint_scope,
    base_url: selection.base_url ?? resolvedEndpoint.base_url,
    resolved_endpoint: resolvedEndpoint,
    selection_result: selection,
    next_safe_action: deriveModelRuntimeNextSafeAction(modelRuntimeReason, blockers),
    blockers,
    ...policyMeta(resolvedEndpoint),
  };
}

/**
 * @param {Awaited<ReturnType<typeof buildRunPreflight>>} preflight
 * @returns {string}
 */
function formatPreflightText(preflight) {
  const lines = [
    'Runner preflight',
    `  model_policy:      ${preflight.model_policy}`,
    `  provider:          ${preflight.provider}`,
    `  selected_model:    ${preflight.selected_model ?? '(not applicable)'}`,
    `  override_source:   ${preflight.override_source ?? '(not applicable)'}`,
    `  ollama_reachable:  ${preflight.ollama_reachable == null ? '(not checked)' : preflight.ollama_reachable}`,
    `  ok:                ${preflight.ok}`,
  ];
  if (preflight.config_target) {
    lines.push(`  config_target:      ${preflight.config_target}`);
  }
  if (preflight.config_path) {
    lines.push(`  config_path:       ${preflight.config_path}`);
  }
  if (preflight.policy_source) {
    lines.push(`  policy_source:     ${preflight.policy_source}`);
  }
  if (preflight.endpoint_scope) {
    lines.push(`  endpoint_scope:    ${preflight.endpoint_scope}`);
  }
  if (preflight.base_url) {
    lines.push(`  base_url:          ${preflight.base_url}`);
  }
  if (preflight.model_runtime_reason_code) {
    lines.push(`  model_runtime:     ${preflight.model_runtime_reason_code}`);
  }
  if (preflight.selection_reason) {
    lines.push(`  selection_reason:  ${preflight.selection_reason}`);
  }
  if (preflight.discovered_models.length) {
    lines.push(`  discovered_models: ${preflight.discovered_models.join(', ')}`);
  }
  if (preflight.next_safe_action) {
    lines.push(`  next_safe_action:  ${preflight.next_safe_action}`);
  }
  if (preflight.blockers.length) {
    lines.push('  blockers:');
    for (const b of preflight.blockers) lines.push(`    - ${b}`);
  }
  return lines.join('\n');
}

module.exports = {
  VALID_MODEL_POLICIES,
  MODEL_RUNTIME_REASON,
  normalizeModelPolicy,
  resolveModelPolicyInput,
  buildRunPreflight,
  formatPreflightText,
  deriveModelRuntimeNextSafeAction,
};
