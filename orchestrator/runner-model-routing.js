'use strict';

/**
 * Runner model routing UX — policy catalog, per-role preview, trace extraction.
 */

const readline = require('readline');

const ROLE_DISPLAY_ORDER = [
  'orchestrator',
  'owner',
  'architect',
  'dev-backend',
  'dev-frontend',
  'dev-devops',
  'qa',
  'cerberus',
];

const { resolveModelPolicyInput, normalizeModelPolicy } = require('./runner-preflight');

/** @typedef {{ id: 'local_only' | 'remote_ok', label: string, description: string }} ModelPolicyOption */

/** @type {ModelPolicyOption[]} */
const MODEL_POLICY_CATALOG = [
  {
    id: 'local_only',
    label: 'Local only',
    description: 'All agent roles route through Ollama; remote providers blocked.',
  },
  {
    id: 'remote_ok',
    label: 'Remote OK',
    description: 'Default role routing (Claude CLI + optional Ollama for orchestrator/summarizer).',
  },
];

/** Lazy-load agents (heavy module graph) only when building previews. */
function loadAgentsRouting() {
  // eslint-disable-next-line global-require
  return require('./agents');
}

/**
 * @returns {ModelPolicyOption[]}
 */
function getModelPolicyCatalog() {
  return MODEL_POLICY_CATALOG.slice();
}

/**
 * @returns {string[]}
 */
function listRoutingRoleIds() {
  const { listAgents } = loadAgentsRouting();
  const ids = listAgents().map((a) => a.id);
  return ROLE_DISPLAY_ORDER.filter((id) => ids.includes(id)).concat(
    ids.filter((id) => !ROLE_DISPLAY_ORDER.includes(id)).sort(),
  );
}

/**
 * @param {{
 *   modelPolicy?: string,
 *   localModel?: string | null,
 *   flowMode?: string,
 * }} [options]
 * @returns {{
 *   model_policy: 'local_only' | 'remote_ok',
 *   flow_mode: string,
 *   local_model: string | null,
 *   roles: Array<{
 *     role: string,
 *     mode: string | null,
 *     provider: string,
 *     model: string,
 *     note: string | null,
 *   }>,
 * }}
 */
function buildRoleRoutingPreview(options = {}) {
  const resolvedPolicyInput = resolveModelPolicyInput(options.modelPolicy);
  if (!resolvedPolicyInput.ok) {
    const err = new Error(resolvedPolicyInput.blocker);
    err.code = 'RUNNER_UNKNOWN_MODEL_POLICY';
    throw err;
  }

  const { AGENTS, resolveModel, MODEL_ROUTING } = loadAgentsRouting();
  const modelPolicy = resolvedPolicyInput.policy;
  const flowMode = options.flowMode || 'single_agent';
  const localModel = options.localModel != null && String(options.localModel).trim()
    ? String(options.localModel).trim()
    : null;

  /** @type {ReturnType<typeof buildRoleRoutingPreview>['roles']} */
  const roles = [];

  for (const roleId of listRoutingRoleIds()) {
    const agent = AGENTS[roleId];
    const routing = MODEL_ROUTING[roleId];
    if (modelPolicy === 'local_only') {
      roles.push({
        role: roleId,
        mode: agent?.mode ?? null,
        provider: 'ollama',
        model: localModel || '(unresolved — run preflight or pass --model)',
        note: 'local_only routes all roles via Ollama HTTP',
      });
      continue;
    }

    let provider = 'claude';
    if (routing?.provider) provider = routing.provider;
    else if (agent && typeof agent.provider === 'string') provider = agent.provider;

    roles.push({
      role: roleId,
      mode: agent?.mode ?? null,
      provider,
      model: resolveModel(roleId),
      note: routing?.localSafe ? 'localSafe in default routing' : null,
    });
  }

  return {
    model_policy: modelPolicy,
    flow_mode: flowMode,
    local_model: localModel,
    roles,
  };
}

/**
 * @param {ModelPolicyOption[]} [catalog]
 * @returns {string}
 */
function formatModelPolicyCatalogText(catalog = getModelPolicyCatalog()) {
  const lines = ['Model policies'];
  for (const item of catalog) {
    lines.push(`  ${item.id.padEnd(12)} ${item.label} — ${item.description}`);
  }
  return lines.join('\n');
}

/**
 * @param {ReturnType<typeof buildRoleRoutingPreview>} preview
 * @returns {string}
 */
function formatRoleRoutingText(preview) {
  const lines = [
    'Role routing preview',
    `  model_policy:  ${preview.model_policy}`,
    `  flow_mode:     ${preview.flow_mode}`,
  ];
  if (preview.local_model) {
    lines.push(`  local_model:   ${preview.local_model}`);
  }
  lines.push('  roles:');
  for (const row of preview.roles) {
    const modeSuffix = row.mode ? ` (${row.mode})` : '';
    lines.push(`    ${row.role.padEnd(14)} ${row.provider.padEnd(8)} ${row.model}${modeSuffix}`);
    if (row.note) lines.push(`      ↳ ${row.note}`);
  }
  lines.push('  note: summarizer uses the same local/remote path as orchestrator when invoked.');
  return lines.join('\n');
}

/**
 * @param {(question: string) => Promise<string>} promptFn
 * @param {ModelPolicyOption[]} [catalog]
 * @returns {Promise<'local_only' | 'remote_ok' | null>}
 */
async function promptModelPolicy(promptFn, catalog = getModelPolicyCatalog()) {
  const lines = catalog.map((item, i) => `  ${i + 1}. ${item.id} — ${item.description}`);
  const answer = await promptFn(
    `Select model policy:\n${lines.join('\n')}\nEnter number or id [default: local_only]: `,
  );
  const trimmed = String(answer ?? '').trim().toLowerCase();
  if (!trimmed) return 'local_only';
  const asNum = parseInt(trimmed, 10);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= catalog.length) {
    return catalog[asNum - 1].id;
  }
  const byId = normalizeModelPolicy(trimmed);
  return byId;
}

/**
 * @param {{ interactive?: boolean, promptFn?: (q: string) => Promise<string> }} [options]
 * @returns {Promise<'local_only' | 'remote_ok' | null>}
 */
async function resolveInteractiveModelPolicy(options = {}) {
  if (options.interactive !== true) return null;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  const promptFn = options.promptFn ?? defaultPromptFn;
  return promptModelPolicy(promptFn);
}

/**
 * @param {string} question
 * @returns {Promise<string>}
 */
function defaultPromptFn(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {{
 *   model_policy: 'local_only' | 'remote_ok' | 'unknown',
 *   selected_model: string | null,
 *   override_source: string | null,
 *   roles: Array<{ role: string, model: string | null, provider: string | null }>,
 * }}
 */
function extractRoleRoutingFromTrace(rows) {
  const session = rows.find((r) => r && r.event === 'session_start');
  const modelPolicy = session && session.local_only_mode === true
    ? 'local_only'
    : session
      ? 'remote_ok'
      : 'unknown';
  const selectedModel = session && typeof session.selected_model === 'string'
    ? session.selected_model
    : null;
  const overrideSource = session && typeof session.override_source === 'string'
    ? session.override_source
    : null;

  /** @type {Map<string, { role: string, model: string | null, provider: string | null }>} */
  const byRole = new Map();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (row.event === 'context_stats' && typeof row.agent === 'string') {
      const role = String(row.agent);
      const model = typeof row.model === 'string' ? row.model : selectedModel;
      const provider = typeof row.model_backend === 'string'
        ? row.model_backend
        : (modelPolicy === 'local_only' ? 'ollama' : null);
      byRole.set(role, { role, model, provider });
    }
  }

  if (modelPolicy === 'local_only' && selectedModel) {
    for (const row of rows) {
      if (row.event === 'agent_start' && typeof row.agent === 'string' && !byRole.has(row.agent)) {
        byRole.set(row.agent, {
          role: row.agent,
          model: selectedModel,
          provider: 'ollama',
        });
      }
    }
  }

  return {
    model_policy: modelPolicy,
    selected_model: selectedModel,
    override_source: overrideSource,
    roles: [...byRole.values()].sort((a, b) => a.role.localeCompare(b.role)),
  };
}

/**
 * @param {ReturnType<typeof extractRoleRoutingFromTrace>} routing
 * @returns {string}
 */
function formatTraceRoleRoutingText(routing) {
  const lines = [
    'Trace role routing',
    `  model_policy:     ${routing.model_policy}`,
  ];
  if (routing.selected_model) {
    lines.push(`  selected_model:   ${routing.selected_model}`);
  }
  if (routing.override_source) {
    lines.push(`  override_source:  ${routing.override_source}`);
  }
  if (!routing.roles.length) {
    lines.push('  roles:            (none recorded in trace yet)');
    return lines.join('\n');
  }
  lines.push('  roles:');
  for (const row of routing.roles) {
    lines.push(
      `    ${row.role.padEnd(16)} ${(row.provider || '?').padEnd(8)} ${row.model || '(unknown)'}`,
    );
  }
  return lines.join('\n');
}

module.exports = {
  MODEL_POLICY_CATALOG,
  getModelPolicyCatalog,
  listRoutingRoleIds,
  buildRoleRoutingPreview,
  formatModelPolicyCatalogText,
  formatRoleRoutingText,
  promptModelPolicy,
  resolveInteractiveModelPolicy,
  defaultPromptFn,
  extractRoleRoutingFromTrace,
  formatTraceRoleRoutingText,
};
