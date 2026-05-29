'use strict';

/**
 * Preflight checks before launching an orchestrator run from the runner TUI/CLI.
 */

const { discoverLocalModels } = require('./local-model-discovery');
const { selectLocalModel } = require('./local-model-selection');

const VALID_MODEL_POLICIES = new Set(['local_only', 'remote_ok']);

/**
 * @param {unknown} value
 * @returns {'local_only' | 'remote_ok'}
 */
function normalizeModelPolicy(value) {
  const v = String(value ?? 'local_only').trim().toLowerCase();
  if (v === 'remote_ok' || v === 'remote-approved' || v === 'remote_approved') return 'remote_ok';
  return 'local_only';
}

/**
 * @param {{
 *   cwd?: string,
 *   modelPolicy?: string,
 *   model?: string | null,
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
 *   blockers: string[],
 * }>}
 */
async function buildRunPreflight(options = {}) {
  const cwd = options.cwd || process.cwd();
  const modelPolicy = normalizeModelPolicy(options.modelPolicy);
  const discover = options.discover ?? discoverLocalModels;
  const selectFn = options.selectLocalModel ?? selectLocalModel;
  /** @type {string[]} */
  const blockers = [];

  if (options.modelPolicy != null && !VALID_MODEL_POLICIES.has(normalizeModelPolicy(options.modelPolicy))) {
    blockers.push(`unknown model policy: ${options.modelPolicy}`);
  }

  if (modelPolicy === 'remote_ok') {
    return {
      ok: blockers.length === 0,
      model_policy: 'remote_ok',
      provider: 'claude',
      selected_model: null,
      override_source: null,
      selection_reason: 'remote_ok policy — local model selection not required',
      discovered_models: [],
      ollama_reachable: null,
      blockers,
    };
  }

  let selection;
  try {
    selection = await selectFn({
      cwd,
      cliModel: options.model ?? null,
      interactive: false,
      discover,
    });
  } catch (err) {
    blockers.push(err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      model_policy: 'local_only',
      provider: 'ollama',
      selected_model: null,
      override_source: null,
      selection_reason: null,
      discovered_models: [],
      ollama_reachable: false,
      blockers,
    };
  }

  const discovery = await discover({ cwd });
  const ollamaReachable = discovery.backends.some((b) => b.backend_id === 'ollama' && b.available);
  if (discovery.missing_local_backend) {
    blockers.push(discovery.missing_local_backend);
  } else if (!ollamaReachable) {
    blockers.push('ollama backend unreachable');
  }

  return {
    ok: blockers.length === 0,
    model_policy: 'local_only',
    provider: 'ollama',
    selected_model: selection.selected_model,
    override_source: selection.override_source,
    selection_reason: selection.selection_reason,
    discovered_models: selection.discovered_models?.length
      ? selection.discovered_models
      : discovery.models.map((m) => m.name),
    ollama_reachable: ollamaReachable,
    blockers,
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
  if (preflight.selection_reason) {
    lines.push(`  selection_reason:  ${preflight.selection_reason}`);
  }
  if (preflight.discovered_models.length) {
    lines.push(`  discovered_models: ${preflight.discovered_models.join(', ')}`);
  }
  if (preflight.blockers.length) {
    lines.push('  blockers:');
    for (const b of preflight.blockers) lines.push(`    - ${b}`);
  }
  return lines.join('\n');
}

module.exports = {
  VALID_MODEL_POLICIES,
  normalizeModelPolicy,
  buildRunPreflight,
  formatPreflightText,
};
