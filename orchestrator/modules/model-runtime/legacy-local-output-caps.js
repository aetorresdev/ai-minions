'use strict';

/**
 * Detect and remove local Ollama output caps that older installers wrote into
 * .ai-minions/model_policy.json.
 *
 * Older installers wrote `max_tokens: 8192` with `profile_source: "installer_default"`
 * into provider_inference_profiles.ollama.default and .by_role.{ARCHITECT,CERBERUS}.
 * Current installers write no local cap, so the resolved local output budget is
 * unlimited. Existing workspaces keep the old cap until it is removed.
 *
 * Attribution is strict: only an entry at one of those three paths whose
 * max_tokens is exactly 8192 AND whose profile_source is still "installer_default"
 * counts as installer-written. Any other local max_tokens is treated as a user
 * choice: reported, never changed. Remote provider profiles are never touched.
 */

const fs = require('node:fs');
const path = require('node:path');
const { validateModelPolicy } = require('./model-policy-config');

const LEGACY_LOCAL_MAX_TOKENS = 8192;
const LEGACY_PROFILE_SOURCE = 'installer_default';
const LOCAL_PROVIDER = 'ollama';
const LEGACY_BY_ROLE_KEYS = Object.freeze(['ARCHITECT', 'CERBERUS']);
const MODEL_POLICY_REL_PATH = path.join('.ai-minions', 'model_policy.json');
const MIGRATION_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'migrate-legacy-local-output-caps.js');

/**
 * @param {string} repoRoot
 * @returns {string}
 */
function buildRemediationCommand(repoRoot) {
  return `node ${MIGRATION_SCRIPT} --repo ${path.resolve(repoRoot)} --apply`;
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * List every ollama profile entry that carries max_tokens, with its dotted path.
 * @param {Record<string, unknown>} ollama
 * @returns {Array<{ path: string, entry: Record<string, unknown>, legacyEligible: boolean }>}
 */
function listLocalCapEntries(ollama) {
  /** @type {Array<{ path: string, entry: Record<string, unknown>, legacyEligible: boolean }>} */
  const out = [];
  const base = `provider_inference_profiles.${LOCAL_PROVIDER}`;
  if (isPlainObject(ollama.default) && ollama.default.max_tokens != null) {
    out.push({ path: `${base}.default`, entry: ollama.default, legacyEligible: true });
  }
  if (isPlainObject(ollama.by_role)) {
    for (const [role, entry] of Object.entries(ollama.by_role)) {
      if (isPlainObject(entry) && entry.max_tokens != null) {
        out.push({
          path: `${base}.by_role.${role}`,
          entry,
          legacyEligible: LEGACY_BY_ROLE_KEYS.includes(role),
        });
      }
    }
  }
  return out;
}

/**
 * Pure classification of a parsed model_policy.json object.
 * @param {unknown} policy
 * @returns {{
 *   legacy_caps: Array<{ path: string, max_tokens: unknown, profile_source: unknown }>,
 *   custom_caps: Array<{ path: string, max_tokens: unknown, profile_source: unknown, reason: string }>,
 * }}
 */
function classifyLocalOutputCaps(policy) {
  /** @type {ReturnType<typeof classifyLocalOutputCaps>} */
  const result = { legacy_caps: [], custom_caps: [] };
  if (!isPlainObject(policy) || !isPlainObject(policy.provider_inference_profiles)) {
    return result;
  }
  const ollama = policy.provider_inference_profiles[LOCAL_PROVIDER];
  if (!isPlainObject(ollama)) return result;

  for (const { path: p, entry, legacyEligible } of listLocalCapEntries(ollama)) {
    const row = { path: p, max_tokens: entry.max_tokens, profile_source: entry.profile_source ?? null };
    const valueMatches = entry.max_tokens === LEGACY_LOCAL_MAX_TOKENS;
    const sourceMatches = entry.profile_source === LEGACY_PROFILE_SOURCE;
    if (legacyEligible && valueMatches && sourceMatches) {
      result.legacy_caps.push(row);
      continue;
    }
    let reason;
    if (!legacyEligible) reason = 'role_not_written_by_installer';
    else if (!sourceMatches) reason = 'profile_source_not_installer_default';
    else reason = 'value_differs_from_installer_default';
    result.custom_caps.push({ ...row, reason });
  }
  return result;
}

/**
 * @param {string} repoRoot
 * @returns {string}
 */
function resolveWorkspaceModelPolicyPath(repoRoot) {
  return path.join(path.resolve(repoRoot), MODEL_POLICY_REL_PATH);
}

/**
 * @param {string} isoNow
 * @returns {string}
 */
function backupSuffix(isoNow) {
  return isoNow.replace(/[:.]/g, '-');
}

/**
 * Detect (and with apply=true, remove) installer-written local output caps.
 *
 * Idempotent: once the legacy caps are gone a re-run finds nothing, writes
 * nothing, and creates no backup.
 *
 * @param {string} repoRoot
 * @param {{ apply?: boolean, now?: () => string }} [options]
 * @returns {{
 *   status: 'no_config' | 'clean' | 'legacy_caps_found' | 'migrated',
 *   config_path: string,
 *   applied: boolean,
 *   backup_path: string | null,
 *   legacy_caps: Array<{ path: string, max_tokens: unknown, profile_source: unknown }>,
 *   custom_caps: Array<{ path: string, max_tokens: unknown, profile_source: unknown, reason: string }>,
 *   remediation: string | null,
 * }}
 */
function migrateLegacyLocalOutputCaps(repoRoot, options = {}) {
  const apply = options.apply === true;
  const now = options.now ?? (() => new Date().toISOString());
  const configPath = resolveWorkspaceModelPolicyPath(repoRoot);

  if (!fs.existsSync(configPath)) {
    return {
      status: 'no_config',
      config_path: configPath,
      applied: false,
      backup_path: null,
      legacy_caps: [],
      custom_caps: [],
      remediation: null,
    };
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  /** @type {unknown} */
  let policy;
  try {
    policy = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`legacy-local-output-caps: cannot parse ${configPath}: ${msg}`);
  }

  const { legacy_caps: legacyCaps, custom_caps: customCaps } = classifyLocalOutputCaps(policy);

  if (legacyCaps.length === 0) {
    return {
      status: 'clean',
      config_path: configPath,
      applied: false,
      backup_path: null,
      legacy_caps: [],
      custom_caps: customCaps,
      remediation: null,
    };
  }

  if (!apply) {
    return {
      status: 'legacy_caps_found',
      config_path: configPath,
      applied: false,
      backup_path: null,
      legacy_caps: legacyCaps,
      custom_caps: customCaps,
      remediation: buildRemediationCommand(repoRoot),
    };
  }

  const next = /** @type {Record<string, any>} */ (JSON.parse(raw));
  const ollama = next.provider_inference_profiles[LOCAL_PROVIDER];
  for (const cap of legacyCaps) {
    const key = cap.path.slice(`provider_inference_profiles.${LOCAL_PROVIDER}.`.length);
    const entry = key === 'default' ? ollama.default : ollama.by_role[key.slice('by_role.'.length)];
    delete entry.max_tokens;
  }

  // Refuse to write a config the runtime would reject (also validates inference profiles).
  validateModelPolicy(next);

  const backupPath = `${configPath}.bak-${backupSuffix(now())}`;
  fs.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL);
  const tmpPath = `${configPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, configPath);

  return {
    status: 'migrated',
    config_path: configPath,
    applied: true,
    backup_path: backupPath,
    legacy_caps: legacyCaps,
    custom_caps: customCaps,
    remediation: null,
  };
}

/**
 * Human-readable report lines for a migrateLegacyLocalOutputCaps result.
 * @param {ReturnType<typeof migrateLegacyLocalOutputCaps>} result
 * @returns {string}
 */
function formatLegacyLocalOutputCapsReport(result) {
  const lines = [
    'legacy local output caps',
    `  config_path: ${result.config_path}`,
    `  status:      ${result.status}`,
  ];
  if (result.status === 'no_config') {
    lines.push('  note:        no model_policy.json in this workspace; nothing to migrate');
  }
  for (const cap of result.legacy_caps) {
    const verb = result.applied ? 'removed' : 'found';
    lines.push(`  ${verb}:       ${cap.path}.max_tokens=${String(cap.max_tokens)} (installer-written)`);
  }
  for (const cap of result.custom_caps) {
    lines.push(
      `  preserved:   ${cap.path}.max_tokens=${String(cap.max_tokens)} (${cap.reason}; not changed)`,
    );
  }
  if (result.backup_path) {
    lines.push(`  backup:      ${result.backup_path}`);
  }
  if (result.status === 'legacy_caps_found') {
    lines.push(
      '  warning:     installer-written local caps still limit Ollama output; new installs leave it unlimited',
      `  remediation: ${result.remediation}`,
    );
  }
  return lines.join('\n');
}

module.exports = {
  LEGACY_LOCAL_MAX_TOKENS,
  LEGACY_PROFILE_SOURCE,
  LEGACY_BY_ROLE_KEYS,
  buildRemediationCommand,
  classifyLocalOutputCaps,
  migrateLegacyLocalOutputCaps,
  formatLegacyLocalOutputCapsReport,
};
