'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const {
  PRODUCT_VERSION,
  buildAboutInfo,
  formatVersionOneLine,
  formatVersionText,
  formatAboutText,
  buildAboutJson,
  resolveGitCommitShort,
  displayPath,
} = require('../../modules/operator/operator-about');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI_PATH = path.join(__dirname, '..', '..', 'ai-minions-cli.js');
const ORCH_CWD = path.join(__dirname, '..', '..');

function writePolicyTree(tmp, localBackend, modelPolicy = 'local_only') {
  const configDir = path.join(tmp, '.ai-minions');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'model-policy.yaml'),
    yaml.dump({
      model_policy_version: 1,
      local_backend: localBackend,
    }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(configDir, 'install-profile.json'),
    JSON.stringify({ install_profile_version: 1, model_policy: modelPolicy }),
    'utf8',
  );
}

describe('operator-about — buildAboutInfo', () => {
  it('distinguishes product version from package.json version', () => {
    const info = buildAboutInfo({
      resolveRepoRoot: () => REPO_ROOT,
      implementationRepoRoot: REPO_ROOT,
      spawnGit: () => ({ status: 0, stdout: 'abc1234\n' }),
    });
    assert.equal(info.version, PRODUCT_VERSION);
    assert.equal(info.version, 'v0.21.0-beta.1');
    assert.equal(info.package_version, '1.0.0');
    assert.notEqual(info.version, info.package_version);
  });

  it('returns git_commit unknown when git is unavailable', () => {
    assert.equal(
      resolveGitCommitShort(REPO_ROOT, () => ({ status: 1, stdout: '' })),
      'unknown',
    );
  });

  it('reads local_backend from model-policy.yaml without network', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'about-policy-'));
    writePolicyTree(tmp, {
      backend_id: 'ollama',
      host: '192.168.50.198',
      port: 11434,
      base_url: 'http://192.168.50.198:11434',
      endpoint_scope: 'private_lan',
    });
    const info = buildAboutInfo({
      cwd: tmp,
      resolveRepoRoot: () => tmp,
      implementationRepoRoot: REPO_ROOT,
      spawnGit: () => ({ status: 0, stdout: 'deadbeef\n' }),
    });
    assert.equal(info.model_policy, 'local_only');
    assert.equal(info.local_backend.provider, 'ollama');
    assert.equal(info.local_backend.host, '192.168.50.198');
    assert.equal(info.local_backend.port, 11434);
    assert.equal(info.local_backend.endpoint_scope, 'private_lan');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildAboutJson uses stable machine-readable shape', () => {
    const info = buildAboutInfo({
      resolveRepoRoot: () => REPO_ROOT,
      implementationRepoRoot: REPO_ROOT,
      spawnGit: () => ({ status: 0, stdout: 'abc1234\n' }),
    });
    const json = buildAboutJson(info);
    assert.equal(json.app, 'ai-minions');
    assert.equal(json.version, PRODUCT_VERSION);
    assert.equal(json.git_commit, 'abc1234');
    assert.equal(typeof json.repo_root, 'string');
    assert.equal(typeof json.install_home, 'string');
    assert.match(json.node, /^v\d/);
  });

  it('displayPath shortens home directory to tilde', () => {
    const home = os.homedir();
    assert.equal(displayPath(home), '~');
    assert.equal(displayPath(path.join(home, '.config', 'ai-minions', 'home')), '~/.config/ai-minions/home');
  });
});

describe('operator-about — formatters', () => {
  it('formatVersionOneLine is a single product version token', () => {
    const info = buildAboutInfo({
      resolveRepoRoot: () => REPO_ROOT,
      implementationRepoRoot: REPO_ROOT,
      spawnGit: () => ({ status: 0, stdout: 'abc1234\n' }),
    });
    assert.equal(formatVersionOneLine(info), PRODUCT_VERSION);
    assert.ok(!formatVersionOneLine(info).includes('\n'));
  });

  it('formatAboutText includes runtime and backend fields', () => {
    const info = buildAboutInfo({
      resolveRepoRoot: () => REPO_ROOT,
      implementationRepoRoot: REPO_ROOT,
      spawnGit: () => ({ status: 0, stdout: 'abc1234\n' }),
    });
    const text = formatAboutText(info);
    assert.match(text, /^ai-minions\n/);
    assert.match(text, /version:\s+v0\.21\.0-beta\.1/);
    assert.match(text, /package_version:\s+1\.0\.0/);
    assert.match(text, /node:\s+v/);
    assert.match(text, /platform:/);
  });

  it('formatVersionText includes install and config paths', () => {
    const info = buildAboutInfo({
      resolveRepoRoot: () => REPO_ROOT,
      implementationRepoRoot: REPO_ROOT,
      spawnGit: () => ({ status: 0, stdout: 'abc1234\n' }),
    });
    const text = formatVersionText(info);
    assert.match(text, /ai-minions version/);
    assert.match(text, /install_home:/);
    assert.match(text, /config_dir:/);
    assert.match(text, /git_commit:/);
  });
});

describe('ai-minions-cli version/about integration', () => {
  it('--version prints one-line product version via repo-local CLI', () => {
    const r = spawnSync(process.execPath, [CLI_PATH, '--version'], {
      cwd: ORCH_CWD,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.equal(String(r.stdout).trim(), PRODUCT_VERSION);
  });

  it('version subcommand prints extended operator output', () => {
    const r = spawnSync(process.execPath, [CLI_PATH, 'version', '--cwd', REPO_ROOT], {
      cwd: ORCH_CWD,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ai-minions version/);
    assert.match(r.stdout, /package_version:\s+1\.0\.0/);
    assert.match(r.stdout, /config_dir:/);
  });

  it('about prints human-readable config summary', () => {
    const r = spawnSync(process.execPath, [CLI_PATH, 'about', '--cwd', REPO_ROOT], {
      cwd: ORCH_CWD,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^ai-minions\n/);
    assert.match(r.stdout, /model_policy:/);
    assert.match(r.stdout, /local_backend:/);
    assert.match(r.stdout, /endpoint_scope:/);
  });

  it('about --json returns stable JSON without secrets', () => {
    const r = spawnSync(process.execPath, [CLI_PATH, 'about', '--cwd', REPO_ROOT, '--json'], {
      cwd: ORCH_CWD,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.app, 'ai-minions');
    assert.equal(parsed.version, PRODUCT_VERSION);
    assert.equal(parsed.package_version, '1.0.0');
    assert.ok(parsed.local_backend == null || typeof parsed.local_backend.host === 'string');
    const blob = JSON.stringify(parsed);
    assert.ok(!/api[_-]?key|secret|token/i.test(blob));
  });

  it('npm run ai-minions -- about works from orchestrator package', () => {
    const r = spawnSync('npm', ['run', 'ai-minions', '--', 'about', '--cwd', REPO_ROOT], {
      cwd: ORCH_CWD,
      encoding: 'utf8',
      shell: true,
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /version:\s+v0\.21\.0-beta\.1/);
  });
});
