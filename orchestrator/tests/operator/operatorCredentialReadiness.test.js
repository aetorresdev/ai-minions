'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

const {
  assessProviderCredentials,
  assessPathActivation,
  formatCredentialStatusLines,
  SUPPORTED_PROVIDER_CREDENTIALS,
  SUPPORTED_ENDPOINT_ENV_VARS,
} = require('../../modules/operator/operator-credential-readiness');

const {
  deriveDoctorNextSafeAction,
  formatOperatorDoctorText,
  buildOperatorDoctorJson,
} = require('../../modules/operator/operator-doctor-evidence');

describe('operator-credential-readiness', () => {
  it('reports present/missing without returning secret values', () => {
    const secret = 'sk-secret-MUST-NOT-LEAK';
    const assessment = assessProviderCredentials({
      modelPolicy: 'local_only',
      env: {
        ANTHROPIC_API_KEY: secret,
        OPENAI_API_KEY: '',
      },
    });

    assert.equal(assessment.local_only_tokens_not_required, true);
    assert.equal(assessment.remote_tokens_required, false);
    assert.match(assessment.note, /does not require remote provider tokens/);

    const anthropic = assessment.providers.find((p) => p.env_var === 'ANTHROPIC_API_KEY');
    const openai = assessment.providers.find((p) => p.env_var === 'OPENAI_API_KEY');
    assert.equal(anthropic.status, 'present');
    assert.equal(openai.status, 'missing');

    const serialized = JSON.stringify(assessment);
    assert.doesNotMatch(serialized, /sk-secret/);
    assert.doesNotMatch(serialized, new RegExp(secret));
  });

  it('marks remote tokens required under remote_ok when no provider key is present', () => {
    const assessment = assessProviderCredentials({
      modelPolicy: 'remote_ok',
      env: {},
    });
    assert.equal(assessment.remote_tokens_required, true);
    assert.equal(assessment.local_only_tokens_not_required, false);
    assert.deepEqual(
      assessment.missing_required_env_vars.sort(),
      ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'].sort(),
    );
    for (const p of assessment.providers) {
      assert.equal(p.required_for_policy, true);
      assert.equal(p.status, 'missing');
    }
  });

  it('remote_ok with one provider key present clears missing_required_env_vars', () => {
    const assessment = assessProviderCredentials({
      modelPolicy: 'remote_ok',
      env: { ANTHROPIC_API_KEY: 'sk-present-not-logged' },
    });
    assert.deepEqual(assessment.missing_required_env_vars, []);
    assert.equal(assessment.credential_sufficiency, 'any_provider');
    assert.match(assessment.note, /does not validate selected provider or remote connectivity/);
    const blob = JSON.stringify(assessment);
    assert.doesNotMatch(blob, /sk-present/);

    const lines = formatCredentialStatusLines(assessment).join('\n');
    assert.match(lines, /missing_required_env_vars: \[\] \(any_provider sufficiency\)/);
    assert.match(lines, /credential_sufficiency:\s+any_provider/);
  });

  it('formatCredentialStatusLines never embeds env values', () => {
    const secret = 'sk-leak-probe-value';
    const lines = formatCredentialStatusLines(
      assessProviderCredentials({
        modelPolicy: 'local_only',
        env: { ANTHROPIC_API_KEY: secret },
      }),
    ).join('\n');
    assert.match(lines, /local_only does not require remote provider tokens/);
    assert.match(lines, /ANTHROPIC_API_KEY: present/);
    assert.doesNotMatch(lines, /sk-leak/);
  });

  it('lists supported provider and endpoint env var names', () => {
    assert.ok(SUPPORTED_PROVIDER_CREDENTIALS.some((p) => p.env_var === 'ANTHROPIC_API_KEY'));
    assert.ok(SUPPORTED_PROVIDER_CREDENTIALS.some((p) => p.env_var === 'OPENAI_API_KEY'));
    assert.ok(SUPPORTED_ENDPOINT_ENV_VARS.includes('OLLAMA_HOST'));
    assert.ok(SUPPORTED_ENDPOINT_ENV_VARS.includes('AI_MINIONS_HOME'));
  });

  it('assessPathActivation reports activation_required when shim exists off PATH', () => {
    const binDir = path.join(os.tmpdir(), 'ai-minions-cred-bin-test');
    const result = assessPathActivation({
      binDir,
      pathEnv: '/usr/bin',
      existsSync: (p) => p === path.join(binDir, 'ai-minions'),
    });
    assert.equal(result.status, 'activation_required');
    assert.equal(result.on_path, false);
    assert.match(result.path_remediation, /export PATH=/);
  });
});

describe('doctor credential + next_safe_action surfaces', () => {
  const baseReport = {
    ok: true,
    layer_stopped: null,
    traces_dir: '/tmp/traces',
    bootstrap: { checks: [{ id: 'node_version', reason_code: 'PREFLIGHT_OK', status: 'pass', message: 'ok' }] },
    runtime_preflight: { overall_status: 'ok', runtime_host: 'claude_code', model_backend: 'ok' },
    checks: [
      {
        id: 'runner_layer',
        layer: 'runner',
        reason_code: null,
        operator_reason_code: 'OPERATOR_OK',
        status: 'pass',
        message: 'runner launch preflight passed',
      },
    ],
  };

  it('local_only doctor text includes token-not-required copy and smoke next action', () => {
    const credentials = assessProviderCredentials({
      modelPolicy: 'local_only',
      env: { ANTHROPIC_API_KEY: 'sk-should-not-appear' },
    });
    const runnerPreflight = {
      ok: true,
      model_policy: 'local_only',
      provider: 'ollama',
      selected_model: 'qwen2.5-coder:7b',
      discovered_models: ['qwen2.5-coder:7b'],
      base_url: 'http://127.0.0.1:11434',
      blockers: [],
    };
    const pathActivation = {
      status: 'ready',
      on_path: true,
      shim_present: true,
      bin_dir: '/tmp/bin',
      path_remediation: null,
      note: 'ok',
    };

    const text = formatOperatorDoctorText(baseReport, runnerPreflight, {
      pathActivation,
      credentials,
    });
    assert.match(text, /model_policy:\s+local_only/);
    assert.match(text, /discovered_models:\s+qwen2\.5-coder:7b/);
    assert.match(text, /local_only does not require remote provider tokens/);
    assert.match(text, /ANTHROPIC_API_KEY: present/);
    assert.match(text, /ai-minions smoke/);
    assert.doesNotMatch(text, /sk-should-not-appear/);

    const json = buildOperatorDoctorJson(baseReport, runnerPreflight, {
      pathActivation,
      credentials,
    });
    assert.equal(json.provider_credentials.local_only_tokens_not_required, true);
    assert.equal(json.discovered_models[0], 'qwen2.5-coder:7b');
    const blob = JSON.stringify(json);
    assert.doesNotMatch(blob, /sk-should-not-appear/);
  });

  it('remote_ok missing token yields export next_safe_action', () => {
    const credentials = assessProviderCredentials({
      modelPolicy: 'remote_ok',
      env: {},
    });
    const action = deriveDoctorNextSafeAction(baseReport, {
      credentials,
      pathActivation: { status: 'ready', path_remediation: null },
      runnerPreflight: { ok: true, model_policy: 'remote_ok', blockers: [], discovered_models: [] },
    });
    assert.match(action, /export ANTHROPIC_API_KEY=/);
    assert.match(action, /--model-policy remote_ok/);
    assert.doesNotMatch(action, /sk-/);
  });

  it('remote_ok ready path recommends smoke with remote_ok (not local_only)', () => {
    const credentials = assessProviderCredentials({
      modelPolicy: 'remote_ok',
      env: { ANTHROPIC_API_KEY: 'sk-should-not-appear' },
    });
    assert.equal(credentials.credential_sufficiency, 'any_provider');
    assert.deepEqual(credentials.missing_required_env_vars, []);

    const action = deriveDoctorNextSafeAction(baseReport, {
      credentials,
      pathActivation: { status: 'ready', path_remediation: null },
      runnerPreflight: {
        ok: true,
        model_policy: 'remote_ok',
        blockers: [],
        discovered_models: ['qwen2.5-coder:7b'],
      },
    });
    assert.match(action, /ai-minions smoke --model-policy remote_ok/);
    assert.doesNotMatch(action, /--model-policy local_only/);

    const text = formatOperatorDoctorText(baseReport, {
      ok: true,
      model_policy: 'remote_ok',
      provider: 'ollama',
      selected_model: 'qwen2.5-coder:7b',
      discovered_models: ['qwen2.5-coder:7b'],
      base_url: 'http://127.0.0.1:11434',
      blockers: [],
    }, {
      pathActivation: {
        status: 'ready',
        on_path: true,
        shim_present: true,
        bin_dir: '/tmp/bin',
        path_remediation: null,
        note: 'ok',
      },
      credentials,
    });
    assert.match(text, /model_policy:\s+remote_ok/);
    assert.match(text, /does not validate selected provider or remote connectivity/);
    assert.match(text, /ai-minions smoke --model-policy remote_ok/);
    assert.doesNotMatch(text, /sk-should-not-appear/);
  });

  it('unreachable local backend yields Ollama remediation', () => {
    const action = deriveDoctorNextSafeAction(
      { ...baseReport, ok: false, layer_stopped: 'runner' },
      {
        pathActivation: { status: 'ready', path_remediation: null },
        credentials: assessProviderCredentials({ modelPolicy: 'local_only', env: {} }),
        runnerPreflight: {
          ok: false,
          model_policy: 'local_only',
          blockers: ['ollama backend unreachable'],
          discovered_models: [],
        },
      },
    );
    assert.match(action, /Start Ollama/);
  });
});
