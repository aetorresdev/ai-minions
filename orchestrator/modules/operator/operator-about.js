'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { PRODUCT_VERSION } = require('./product-version');
const {
  resolveLocalRuntimeEndpoint,
  resolvePolicyCwd,
} = require('../model-runtime/local-runtime-endpoint');

const IMPLEMENTATION_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * @param {string} p
 * @returns {string}
 */
function displayPath(p) {
  const resolved = path.resolve(String(p));
  const home = os.homedir();
  if (resolved === home) return '~';
  if (resolved.startsWith(`${home}${path.sep}`)) {
    return `~${resolved.slice(home.length)}`;
  }
  return resolved;
}

/**
 * @param {string} [homeDir]
 * @returns {string}
 */
function resolveInstallHomeConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.config', 'ai-minions', 'home');
}

/**
 * @param {string} configPath
 * @returns {string | null}
 */
function readInstallHomeTarget(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} repoRoot
 * @param {typeof spawnSync} [spawnFn]
 * @returns {string}
 */
function resolveGitCommitShort(repoRoot, spawnFn = spawnSync) {
  try {
    const result = spawnFn('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status === 0 && result.stdout) {
      const sha = String(result.stdout).trim();
      if (sha) return sha;
    }
  } catch {
    // fall through
  }
  return 'unknown';
}

/**
 * @param {string} repoRoot
 * @returns {string}
 */
function readPackageVersion(repoRoot) {
  try {
    const pkgPath = path.join(repoRoot, 'orchestrator', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return String(pkg.version || 'unknown');
  } catch {
    return 'unknown';
  }
}

/**
 * @param {string} configDir
 * @returns {string | null}
 */
function readModelPolicyMode(configDir) {
  const profilePath = path.join(configDir, 'install-profile.json');
  try {
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    if (profile.model_policy === 'local_only' || profile.model_policy === 'remote_ok') {
      return profile.model_policy;
    }
  } catch {
    // fall through
  }
  const mode = String(process.env.ORCH_MODEL_MODE ?? '').trim().toLowerCase();
  if (mode === 'local_only' || mode === 'remote_ok') return mode;
  if (process.env.ORCH_ALLOW_REMOTE_MODELS === '0'
    || String(process.env.ORCH_ALLOW_REMOTE_MODELS ?? '').toLowerCase() === 'false') {
    return 'local_only';
  }
  return 'local_only';
}

/**
 * @param {string} configDir
 * @returns {{ provider: string, host: string, port: number, endpoint_scope: string } | null}
 */
function readLocalBackendSummary(configDir) {
  try {
    const ep = resolveLocalRuntimeEndpoint({ cwd: path.dirname(configDir) });
    return {
      provider: ep.provider,
      host: ep.host,
      port: ep.port,
      endpoint_scope: ep.endpoint_scope,
    };
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   cwd?: string,
 *   resolveRepoRoot?: (cwd?: string) => string,
 *   implementationRepoRoot?: string,
 *   spawnGit?: typeof spawnSync,
 * }} [options]
 */
function buildAboutInfo(options = {}) {
  const resolveRepoRoot = options.resolveRepoRoot
    ?? ((cwd) => resolvePolicyCwd(cwd || process.cwd()));
  const repoRoot = resolveRepoRoot(options.cwd);
  const configDir = path.join(repoRoot, '.ai-minions');
  const installHome = resolveInstallHomeConfigPath();
  const implementationRepo = options.implementationRepoRoot ?? IMPLEMENTATION_REPO_ROOT;
  const installTarget = readInstallHomeTarget(installHome);
  const localBackend = readLocalBackendSummary(configDir);

  return {
    app: 'ai-minions',
    version: PRODUCT_VERSION,
    package_version: readPackageVersion(implementationRepo),
    git_commit: resolveGitCommitShort(implementationRepo, options.spawnGit),
    repo_root: repoRoot,
    implementation_repo: implementationRepo,
    install_home: installHome,
    install_home_target: installTarget,
    config_dir: configDir,
    node: `v${process.versions.node}`,
    platform: process.platform,
    arch: process.arch,
    model_policy: readModelPolicyMode(configDir),
    local_backend: localBackend,
    endpoint_scope: localBackend?.endpoint_scope ?? null,
  };
}

/**
 * @param {ReturnType<typeof buildAboutInfo>} info
 * @returns {string}
 */
function formatVersionOneLine(info) {
  return info.version;
}

/**
 * @param {ReturnType<typeof buildAboutInfo>} info
 * @returns {string}
 */
function formatVersionText(info) {
  const lines = [
    'ai-minions version',
    `  version:           ${info.version}`,
    `  package_version:   ${info.package_version}`,
    `  git_commit:        ${info.git_commit}`,
    `  install_home:      ${displayPath(info.install_home)}`,
    `  repo_root:         ${displayPath(info.repo_root)}`,
    `  config_dir:        ${displayPath(info.config_dir)}`,
  ];
  if (info.install_home_target) {
    lines.push(`  install_home_target: ${displayPath(info.install_home_target)}`);
  }
  return lines.join('\n');
}

/**
 * @param {ReturnType<typeof buildAboutInfo>} info
 * @returns {string}
 */
function formatAboutText(info) {
  const lines = [
    'ai-minions',
    `  version:           ${info.version}`,
    `  package_version:   ${info.package_version}`,
    `  git_commit:        ${info.git_commit}`,
    `  install_home:      ${displayPath(info.install_home)}`,
    `  repo_root:         ${displayPath(info.repo_root)}`,
    `  config_dir:        ${displayPath(info.config_dir)}`,
    `  node:              ${info.node}`,
    `  platform:          ${info.platform} ${info.arch}`,
    `  model_policy:      ${info.model_policy}`,
  ];
  if (info.local_backend) {
    lines.push(`  local_backend:     ${info.local_backend.provider}`);
    lines.push(`  endpoint_scope:    ${info.local_backend.endpoint_scope}`);
    lines.push(`  backend_host:      ${info.local_backend.host}`);
    lines.push(`  backend_port:      ${info.local_backend.port}`);
  } else {
    lines.push('  local_backend:     (not configured)');
    lines.push('  endpoint_scope:    (not configured)');
  }
  if (info.install_home_target && path.resolve(info.install_home_target) !== path.resolve(info.repo_root)) {
    lines.push(`  install_home_target: ${displayPath(info.install_home_target)}`);
    lines.push('  config_mismatch:     install_home_target differs from repo_root');
  }
  return lines.join('\n');
}

/**
 * @param {ReturnType<typeof buildAboutInfo>} info
 * @returns {Record<string, unknown>}
 */
function buildAboutJson(info) {
  return {
    app: info.app,
    version: info.version,
    package_version: info.package_version,
    git_commit: info.git_commit,
    repo_root: info.repo_root,
    install_home: info.install_home,
    config_dir: info.config_dir,
    node: info.node,
    platform: info.platform,
    arch: info.arch,
    model_policy: info.model_policy,
    local_backend: info.local_backend
      ? {
        provider: info.local_backend.provider,
        host: info.local_backend.host,
        port: info.local_backend.port,
        endpoint_scope: info.local_backend.endpoint_scope,
      }
      : null,
  };
}

/**
 * @param {{ cwd?: string, json?: boolean, resolveRepoRoot?: (cwd?: string) => string }} [options]
 */
function runOperatorVersion(options = {}) {
  const info = buildAboutInfo(options);
  return {
    ok: true,
    exitCode: 0,
    info,
    text: formatVersionText(info),
    json: buildAboutJson(info),
  };
}

/**
 * @param {{ cwd?: string, json?: boolean, resolveRepoRoot?: (cwd?: string) => string }} [options]
 */
function runOperatorAbout(options = {}) {
  const info = buildAboutInfo(options);
  if (options.json === true) {
    return {
      ok: true,
      exitCode: 0,
      info,
      text: JSON.stringify(buildAboutJson(info), null, 2),
      json: buildAboutJson(info),
    };
  }
  return {
    ok: true,
    exitCode: 0,
    info,
    text: formatAboutText(info),
    json: buildAboutJson(info),
  };
}

module.exports = {
  PRODUCT_VERSION,
  IMPLEMENTATION_REPO_ROOT,
  displayPath,
  resolveInstallHomeConfigPath,
  readInstallHomeTarget,
  resolveGitCommitShort,
  buildAboutInfo,
  formatVersionOneLine,
  formatVersionText,
  formatAboutText,
  buildAboutJson,
  runOperatorVersion,
  runOperatorAbout,
};
