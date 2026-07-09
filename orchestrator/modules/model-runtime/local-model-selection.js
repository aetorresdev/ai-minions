'use strict';

/**
 * Local model selection: precedence CLI → env → model-policy.yaml → auto-detect → TTY.
 * Consumes discoverLocalModels(); no inference.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const yaml = require('js-yaml');
const { discoverLocalModels } = require('./local-model-discovery');
const { buildDiscoverOptions, endpointFromYamlPolicy } = require('./local-runtime-endpoint');

const SUPPORTED_POLICY_VERSION = 1;
const MODEL_NOT_FOUND_PREFIX = 'MODEL_NOT_FOUND';

/**
 * @typedef {Object} LocalModelSelectionResult
 * @property {string} selected_model
 * @property {string} override_source
 * @property {string} selection_reason
 * @property {string[]} discovered_models
 */

function normalizeModelName(name) {
  const s = String(name ?? '').trim();
  return s || null;
}

/**
 * @param {unknown} policy
 */
function validateModelPolicy(policy) {
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
    throw new Error('model-policy.yaml: root must be a YAML object');
  }
  if (policy.model_policy_version !== SUPPORTED_POLICY_VERSION) {
    throw new Error(
      `model-policy.yaml: unsupported model_policy_version ${policy.model_policy_version} (expected ${SUPPORTED_POLICY_VERSION})`,
    );
  }
  if (policy.default_model != null && typeof policy.default_model !== 'string') {
    throw new Error('model-policy.yaml: default_model must be a string when set');
  }
  if (policy.prefer_families != null) {
    if (!Array.isArray(policy.prefer_families)) {
      throw new Error('model-policy.yaml: prefer_families must be an array when set');
    }
    for (const f of policy.prefer_families) {
      if (typeof f !== 'string' || !f.trim()) {
        throw new Error('model-policy.yaml: prefer_families entries must be non-empty strings');
      }
    }
  }
  if (policy.max_size_bytes != null) {
    const n = Number(policy.max_size_bytes);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error('model-policy.yaml: max_size_bytes must be a positive number when set');
    }
  }
  if (policy.local_backend != null) {
    if (typeof policy.local_backend !== 'object' || Array.isArray(policy.local_backend)) {
      throw new Error('model-policy.yaml: local_backend must be an object when set');
    }
    const lb = /** @type {Record<string, unknown>} */ (policy.local_backend);
    if (typeof lb.backend_id !== 'string' || !lb.backend_id.trim()) {
      throw new Error('model-policy.yaml: local_backend.backend_id must be a non-empty string');
    }
    const supportStatus = String(lb.support_status ?? '');
    if (!['supported', 'experimental', 'unsupported'].includes(supportStatus)) {
      throw new Error(
        'model-policy.yaml: local_backend.support_status must be supported|experimental|unsupported',
      );
    }
    if (typeof lb.host !== 'string' || !lb.host.trim()) {
      throw new Error('model-policy.yaml: local_backend.host must be a non-empty string');
    }
    const port = Number(lb.port);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new Error('model-policy.yaml: local_backend.port must be a valid TCP port');
    }
    if (lb.base_url != null) {
      if (typeof lb.base_url !== 'string' || !lb.base_url.trim()) {
        throw new Error('model-policy.yaml: local_backend.base_url must be a non-empty string when set');
      }
    }
    if (lb.endpoint_scope != null) {
      const scope = String(lb.endpoint_scope);
      if (!['localhost', 'private_lan', 'public_endpoint'].includes(scope)) {
        throw new Error(
          'model-policy.yaml: local_backend.endpoint_scope must be localhost|private_lan|public_endpoint',
        );
      }
    }
  }
}

/**
 * @param {string} cwd
 * @returns {Record<string, unknown> | null}
 */
function loadModelPolicy(cwd) {
  const policyPath = path.join(path.resolve(cwd || '.'), '.ai-minions', 'model-policy.yaml');
  if (!fs.existsSync(policyPath)) return null;
  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(policyPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to parse model policy at ${policyPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  validateModelPolicy(parsed);
  return parsed;
}

/**
 * @param {{ interactive?: boolean }} [options]
 */
function isInteractiveSelectionAllowed(options = {}) {
  if (options.interactive === false) return false;
  if (options.interactive === true) return true;
  if (process.env.ORCH_NON_INTERACTIVE === '1') return false;
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  return !!(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Deterministic ranking — higher score wins; tie-break by name ascending.
 * @param {import('./local-model-discovery').LocalModelDescriptor[]} models
 * @param {Record<string, unknown> | null} policy
 * @param {{ taskHint?: string }} [opts]
 * @returns {import('./local-model-discovery').LocalModelDescriptor[]}
 */
function rankDiscoveredModels(models, policy, opts = {}) {
  const preferFamilies = Array.isArray(policy?.prefer_families)
    ? policy.prefer_families.map((f) => String(f).toLowerCase())
    : [];
  const maxSize =
    policy?.max_size_bytes != null ? Number(policy.max_size_bytes) : null;
  const defaultModel =
    typeof policy?.default_model === 'string' ? policy.default_model : null;
  const taskHint = String(opts.taskHint ?? 'code').toLowerCase();

  const filtered = models.filter((m) => {
    if (maxSize != null && m.size_bytes != null && m.size_bytes > maxSize) return false;
    return !!m.name;
  });

  const scored = filtered.map((m) => {
    let score = 0;
    if (defaultModel && m.name === defaultModel) score += 1000;
    if (m.family && preferFamilies.includes(String(m.family).toLowerCase())) score += 100;
    if (taskHint.includes('code') && /coder|code|dev/i.test(m.name)) score += 50;
    if (m.size_bytes != null) score -= m.size_bytes / 1e10;
    return { m, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.m.name.localeCompare(b.m.name);
  });

  return scored.map((row) => row.m);
}

/**
 * @param {string[]} models
 * @param {(question: string) => Promise<string>} promptFn
 */
async function promptForModel(models, promptFn) {
  const lines = models.map((name, i) => `  ${i + 1}. ${name}`).join('\n');
  const question = `Multiple local models available — choose one:\n${lines}\nEnter number (1-${models.length}): `;
  const answer = String(await promptFn(question)).trim();
  const idx = parseInt(answer, 10);
  if (Number.isFinite(idx) && idx >= 1 && idx <= models.length) {
    return models[idx - 1];
  }
  const byName = models.find((m) => m === answer);
  if (byName) return byName;
  throw new Error(`Invalid model selection input: ${answer}`);
}

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
 * @param {string} model
 * @param {string[]} discoveredNames
 */
function assertModelInInventory(model, discoveredNames) {
  if (discoveredNames.includes(model)) return;
  const hint = discoveredNames.length
    ? `available: ${discoveredNames.slice(0, 8).join(', ')}`
    : 'no models returned from Ollama /api/tags';
  throw new Error(
    `[local-model-selection] ${MODEL_NOT_FOUND_PREFIX}: "${model}" not in Ollama inventory — ${hint}`,
  );
}

/**
 * @param {{
 *   cwd?: string,
 *   ollamaHost?: string | null,
 *   ollamaPort?: number | string | null,
 *   ollamaBaseUrl?: string | null,
 *   allowPublicLocalRuntime?: boolean,
 *   loadPolicy?: (cwd: string) => Record<string, unknown> | null,
 * }} options
 */
function createDiscoverFn(options) {
  const cwd = options.cwd || process.cwd();
  const loadPolicy = options.loadPolicy ?? loadModelPolicy;
  const baseDiscover = options.discover ?? discoverLocalModels;
  const hasInjectedDiscover = Object.prototype.hasOwnProperty.call(options, 'discover');
  const hasExplicitEndpoint = Boolean(
    options.ollamaHost || options.ollamaPort != null || options.ollamaBaseUrl,
  );
  const policyEndpoint = endpointFromYamlPolicy(loadPolicy(cwd));

  if (hasInjectedDiscover && !hasExplicitEndpoint && !policyEndpoint) {
    const host = 'localhost';
    const port = 11434;
    return {
      discover: (extra = {}) => baseDiscover({ host, port, cwd, ...extra }),
      endpoint: {
        provider: 'ollama',
        host,
        port,
        base_url: `http://${host}:${port}`,
        endpoint_scope: 'localhost',
        source: 'test_localhost_default',
      },
    };
  }

  const built = buildDiscoverOptions(cwd, {
    ollamaHost: options.ollamaHost,
    ollamaPort: options.ollamaPort,
    ollamaBaseUrl: options.ollamaBaseUrl,
    allowPublicLocalRuntime: options.allowPublicLocalRuntime,
    loadPolicy,
  });
  return {
    discover: (extra = {}) => baseDiscover({
      host: built.host,
      port: built.port,
      cwd,
      endpoint: built.endpoint,
      allowPublicLocalRuntime: options.allowPublicLocalRuntime,
      ...extra,
    }),
    endpoint: built.endpoint,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   cliModel?: string | null,
 *   taskHint?: string,
 *   interactive?: boolean,
 *   ollamaHost?: string | null,
 *   ollamaPort?: number | string | null,
 *   ollamaBaseUrl?: string | null,
 *   allowPublicLocalRuntime?: boolean,
 *   discover?: typeof discoverLocalModels,
 *   promptFn?: (question: string) => Promise<string>,
 *   loadPolicy?: (cwd: string) => Record<string, unknown> | null,
 * }} [options]
 * @returns {Promise<LocalModelSelectionResult>}
 */
async function selectLocalModel(options = {}) {
  const cwd = options.cwd || process.cwd();
  const loadPolicy = options.loadPolicy ?? loadModelPolicy;
  const promptFn = options.promptFn ?? defaultPromptFn;
  const requireInventoryCheck = !isInteractiveSelectionAllowed(options);
  /** @type {ReturnType<typeof createDiscoverFn> | null} */
  let discoverBundle = null;
  const getDiscoverBundle = () => {
    if (!discoverBundle) discoverBundle = createDiscoverFn(options);
    return discoverBundle;
  };
  const endpointFields = () => {
    const { endpoint } = getDiscoverBundle();
    return {
      endpoint_scope: endpoint.endpoint_scope,
      base_url: endpoint.base_url,
      model_backend: 'ollama',
    };
  };

  const cliModel = normalizeModelName(options.cliModel);
  if (cliModel) {
    if (requireInventoryCheck) {
      const { discover, endpoint } = getDiscoverBundle();
      const discovery = await discover();
      if (discovery.missing_local_backend) {
        throw new Error(`[local-model-selection] ${discovery.missing_local_backend}`);
      }
      const discoveredNames = discovery.models.map((m) => m.name).filter(Boolean);
      assertModelInInventory(cliModel, discoveredNames);
      return {
        selected_model: cliModel,
        override_source: 'cli',
        selection_reason: 'explicit CLI --model override',
        discovered_models: discoveredNames,
        endpoint_scope: endpoint.endpoint_scope,
        base_url: endpoint.base_url,
        model_backend: 'ollama',
      };
    }
    return {
      selected_model: cliModel,
      override_source: 'cli',
      selection_reason: 'explicit CLI --model override',
      discovered_models: [],
      ...endpointFields(),
    };
  }

  const envLocal = normalizeModelName(process.env.ORCH_LOCAL_MODEL);
  if (envLocal) {
    return {
      selected_model: envLocal,
      override_source: 'env_orchestr_local_model',
      selection_reason: 'ORCH_LOCAL_MODEL environment override',
      discovered_models: [],
      ...endpointFields(),
    };
  }

  const ollamaEnv = normalizeModelName(process.env.OLLAMA_MODEL);
  if (ollamaEnv) {
    return {
      selected_model: ollamaEnv,
      override_source: 'env_ollama_model',
      selection_reason: 'OLLAMA_MODEL environment override',
      discovered_models: [],
      ...endpointFields(),
    };
  }

  let policy = null;
  policy = loadPolicy(cwd);
  const { discover, endpoint } = getDiscoverBundle();

  if (policy && typeof policy.default_model === 'string' && policy.default_model.trim()) {
    const defaultModel = policy.default_model.trim();
    if (requireInventoryCheck) {
      const discovery = await discover();
      if (discovery.missing_local_backend) {
        throw new Error(`[local-model-selection] ${discovery.missing_local_backend}`);
      }
      const discoveredNames = discovery.models.map((m) => m.name).filter(Boolean);
      assertModelInInventory(defaultModel, discoveredNames);
      return {
        selected_model: defaultModel,
        override_source: 'model_policy_yaml',
        selection_reason: 'default_model from .ai-minions/model-policy.yaml',
        discovered_models: discoveredNames,
        endpoint_scope: endpoint.endpoint_scope,
        base_url: endpoint.base_url,
        model_backend: 'ollama',
      };
    }
    return {
      selected_model: defaultModel,
      override_source: 'model_policy_yaml',
      selection_reason: 'default_model from .ai-minions/model-policy.yaml',
      discovered_models: [],
      endpoint_scope: endpoint.endpoint_scope,
      base_url: endpoint.base_url,
      model_backend: 'ollama',
    };
  }

  const discovery = await discover();
  const discoveredNames = discovery.models.map((m) => m.name).filter(Boolean);

  if (discovery.missing_local_backend) {
    throw new Error(
      `[local-model-selection] ${discovery.missing_local_backend}`,
    );
  }

  if (discoveredNames.length === 0) {
    throw new Error(
      '[local-model-selection] No local models discovered. Pull a model into Ollama or set an explicit override.',
    );
  }

  const ranked = rankDiscoveredModels(discovery.models, policy, {
    taskHint: options.taskHint,
  });
  if (ranked.length === 0) {
    throw new Error(
      '[local-model-selection] No local models match model-policy hardware constraints (max_size_bytes).',
    );
  }

  if (ranked.length === 1 || !isInteractiveSelectionAllowed(options)) {
    const pick = ranked[0];
    return {
      selected_model: pick.name,
      override_source: 'auto_detect',
      selection_reason:
        ranked.length === 1
          ? 'single model discovered via Ollama /api/tags'
          : 'deterministic auto-select (non-interactive): highest ranked discovered model',
      discovered_models: discoveredNames,
      endpoint_scope: endpoint.endpoint_scope,
      base_url: endpoint.base_url,
      model_backend: 'ollama',
    };
  }

  const names = ranked.map((m) => m.name);
  const chosen = await promptForModel(names, promptFn);
  return {
    selected_model: chosen,
    override_source: 'tty_prompt',
    selection_reason: 'operator selected model from interactive TTY prompt',
    discovered_models: discoveredNames,
    endpoint_scope: endpoint.endpoint_scope,
    base_url: endpoint.base_url,
    model_backend: 'ollama',
  };
}

module.exports = {
  SUPPORTED_POLICY_VERSION,
  MODEL_NOT_FOUND_PREFIX,
  loadModelPolicy,
  validateModelPolicy,
  isInteractiveSelectionAllowed,
  rankDiscoveredModels,
  selectLocalModel,
  promptForModel,
  createDiscoverFn,
  assertModelInInventory,
};
