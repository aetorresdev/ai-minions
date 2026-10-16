'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildInstallModelConfig } = require('../install-model-config');
const {
  classifyLocalOutputCaps,
  migrateLegacyLocalOutputCaps,
  formatLegacyLocalOutputCapsReport,
} = require('../modules/model-runtime/legacy-local-output-caps');
const { resolveOllamaNumPredict } = require('../modules/model-runtime/inference-profile-resolve');
const { main } = require('../scripts/migrate-legacy-local-output-caps');

const DISCOVERY = {
  backends: [{ backend_id: 'ollama', support_status: 'supported', host: 'localhost', port: 11434 }],
  models: [{ name: 'qwen2.5-coder:7b', backend_id: 'ollama', family: 'qwen2', size_bytes: 4_683_087_332 }],
};
const FIXED_NOW = () => '2026-10-16T12:00:00.000Z';

/** Current installer output (no local caps). */
function currentPolicy() {
  return buildInstallModelConfig(DISCOVERY, 'local_only').jsonPolicy;
}

/** What older installers wrote: the same profiles plus max_tokens 8192 on the three ollama entries. */
function legacyPolicy() {
  const p = currentPolicy();
  const o = p.provider_inference_profiles.ollama;
  o.default.max_tokens = 8192;
  o.by_role.ARCHITECT.max_tokens = 8192;
  o.by_role.CERBERUS.max_tokens = 8192;
  return p;
}

/**
 * @param {string} root
 * @param {unknown} policy
 */
function writeWorkspace(root, policy) {
  const dir = path.join(root, '.ai-minions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'model_policy.json');
  fs.writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  return file;
}

function listBackups(root) {
  return fs.readdirSync(path.join(root, '.ai-minions')).filter((n) => n.includes('.bak-'));
}

describe('legacy local output caps — classification', () => {
  it('flags only installer-attributed ollama caps; ignores remote profiles', () => {
    const c = classifyLocalOutputCaps(legacyPolicy());
    assert.deepEqual(
      c.legacy_caps.map((x) => x.path).sort(),
      [
        'provider_inference_profiles.ollama.by_role.ARCHITECT',
        'provider_inference_profiles.ollama.by_role.CERBERUS',
        'provider_inference_profiles.ollama.default',
      ],
    );
    assert.equal(c.custom_caps.length, 0);
  });

  it('current installer output is clean', () => {
    const c = classifyLocalOutputCaps(currentPolicy());
    assert.deepEqual(c, { legacy_caps: [], custom_caps: [] });
  });

  it('non-object input is clean, not an error', () => {
    assert.deepEqual(classifyLocalOutputCaps(null), { legacy_caps: [], custom_caps: [] });
  });
});

describe('legacy local output caps — workspace migration', () => {
  /** @type {string} */
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-local-caps-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('report mode detects legacy caps without writing anything', () => {
    const file = writeWorkspace(root, legacyPolicy());
    const before = fs.readFileSync(file, 'utf8');
    const r = migrateLegacyLocalOutputCaps(root, { now: FIXED_NOW });
    assert.equal(r.status, 'legacy_caps_found');
    assert.equal(r.applied, false);
    assert.equal(r.legacy_caps.length, 3);
    assert.match(r.remediation, /migrate-legacy-local-output-caps\.js --repo .+ --apply$/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(listBackups(root), []);
    assert.match(formatLegacyLocalOutputCapsReport(r), /remediation: node .+--apply/);
  });

  it('apply backs up, removes legacy caps, and leaves the rest intact', () => {
    const file = writeWorkspace(root, legacyPolicy());
    const original = fs.readFileSync(file, 'utf8');
    const env = { OLLAMA_NUM_PREDICT: '' };
    assert.equal(resolveOllamaNumPredict({ cwd: root, env, role: 'DEV' }).num_predict, 8192);

    const r = migrateLegacyLocalOutputCaps(root, { apply: true, now: FIXED_NOW });
    assert.equal(r.status, 'migrated');
    assert.equal(r.applied, true);
    assert.equal(path.basename(r.backup_path), 'model_policy.json.bak-2026-10-16T12-00-00-000Z');
    assert.equal(fs.readFileSync(r.backup_path, 'utf8'), original);

    const migrated = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(migrated, currentPolicy());
    assert.equal(migrated.provider_inference_profiles.anthropic.default.max_tokens, 8192);
    assert.equal(migrated.provider_inference_profiles.anthropic.by_role.ARCHITECT.max_tokens, 16384);

    for (const role of ['DEV', 'ARCHITECT', 'CERBERUS']) {
      const resolved = resolveOllamaNumPredict({ cwd: root, env, role });
      assert.equal(resolved.num_predict_unlimited, true, role);
    }
  });

  it('re-running after migration is a no-op (no write, no new backup)', () => {
    const file = writeWorkspace(root, legacyPolicy());
    migrateLegacyLocalOutputCaps(root, { apply: true, now: FIXED_NOW });
    const afterFirst = fs.readFileSync(file, 'utf8');
    const mtime = fs.statSync(file).mtimeMs;

    const second = migrateLegacyLocalOutputCaps(root, {
      apply: true,
      now: () => '2026-10-17T00:00:00.000Z',
    });
    assert.equal(second.status, 'clean');
    assert.equal(second.applied, false);
    assert.equal(second.backup_path, null);
    assert.equal(fs.readFileSync(file, 'utf8'), afterFirst);
    assert.equal(fs.statSync(file).mtimeMs, mtime);
    assert.equal(listBackups(root).length, 1);
  });

  it('clean workspace (current installer) is untouched', () => {
    const file = writeWorkspace(root, currentPolicy());
    const before = fs.readFileSync(file, 'utf8');
    const r = migrateLegacyLocalOutputCaps(root, { apply: true, now: FIXED_NOW });
    assert.equal(r.status, 'clean');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(listBackups(root), []);
  });

  it('workspace without model_policy.json reports no_config and creates nothing', () => {
    const r = migrateLegacyLocalOutputCaps(root, { apply: true, now: FIXED_NOW });
    assert.equal(r.status, 'no_config');
    assert.equal(fs.existsSync(path.join(root, '.ai-minions')), false);
  });

  it('user-set caps are preserved and flagged, legacy caps beside them are removed', () => {
    const p = legacyPolicy();
    const o = p.provider_inference_profiles.ollama;
    o.default.max_tokens = 4096; // user changed the value
    o.by_role.ARCHITECT.profile_source = 'operator_tuned'; // user re-attributed, value still 8192
    o.by_role.DEV = { effort: 'low', thinking_mode: 'disabled', thinking_display: 'omit', max_tokens: 8192, profile_source: 'installer_default' }; // role the installer never wrote
    const file = writeWorkspace(root, p);

    const r = migrateLegacyLocalOutputCaps(root, { apply: true, now: FIXED_NOW });
    assert.equal(r.status, 'migrated');
    assert.deepEqual(r.legacy_caps.map((x) => x.path), ['provider_inference_profiles.ollama.by_role.CERBERUS']);
    const reasons = Object.fromEntries(r.custom_caps.map((x) => [x.path.split('.').pop(), x.reason]));
    assert.deepEqual(reasons, {
      default: 'value_differs_from_installer_default',
      ARCHITECT: 'profile_source_not_installer_default',
      DEV: 'role_not_written_by_installer',
    });

    const after = JSON.parse(fs.readFileSync(file, 'utf8')).provider_inference_profiles.ollama;
    assert.equal(after.default.max_tokens, 4096);
    assert.equal(after.by_role.ARCHITECT.max_tokens, 8192);
    assert.equal(after.by_role.DEV.max_tokens, 8192);
    assert.equal('max_tokens' in after.by_role.CERBERUS, false);
    assert.match(formatLegacyLocalOutputCapsReport(r), /preserved: +provider_inference_profiles\.ollama\.default\.max_tokens=4096/);
  });

  it('only user-set caps: reported as clean, file untouched', () => {
    const p = currentPolicy();
    p.provider_inference_profiles.ollama.default.max_tokens = 2048;
    const file = writeWorkspace(root, p);
    const before = fs.readFileSync(file, 'utf8');
    const r = migrateLegacyLocalOutputCaps(root, { apply: true, now: FIXED_NOW });
    assert.equal(r.status, 'clean');
    assert.equal(r.custom_caps.length, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(listBackups(root), []);
  });

  it('unparseable config throws and is not modified', () => {
    const file = path.join(root, '.ai-minions', 'model_policy.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json', 'utf8');
    assert.throws(() => migrateLegacyLocalOutputCaps(root, { apply: true }), /cannot parse/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
  });
});

describe('legacy local output caps — script', () => {
  /** @type {string} */
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-local-caps-cli-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function run(args) {
    let out = '';
    let err = '';
    const code = main(args, { stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, now: FIXED_NOW });
    return { code, out, err };
  }

  it('exit 1 in report mode with legacy caps, 0 after --apply, 0 on re-run', () => {
    writeWorkspace(root, legacyPolicy());
    const report = run(['--repo', root]);
    assert.equal(report.code, 1);
    assert.match(report.out, /status: +legacy_caps_found/);

    const applied = run(['--repo', root, '--apply', '--json']);
    assert.equal(applied.code, 0);
    assert.equal(JSON.parse(applied.out).status, 'migrated');

    const again = run(['--repo', root, '--apply']);
    assert.equal(again.code, 0);
    assert.match(again.out, /status: +clean/);
  });

  it('exit 2 on unknown argument', () => {
    const r = run(['--bogus']);
    assert.equal(r.code, 2);
    assert.match(r.err, /unknown argument/);
  });
});
