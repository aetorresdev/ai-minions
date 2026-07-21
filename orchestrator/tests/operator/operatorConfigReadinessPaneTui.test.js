'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assessEndpointEnvStatus,
  deriveRemediationCandidates,
  buildConfigReadinessPaneModel,
  formatConfigReadinessPaneText,
  formatCopyableRemediationBlock,
  resolveConfigReadinessPaneInput,
  runOperatorConfigReadinessPane,
} = require('../../modules/operator/operator-config-readiness-pane-tui');
const { assessProviderCredentials } = require('../../modules/operator/operator-credential-readiness');

const BASE_REPORT = {
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

test('resolveConfigReadinessPaneInput maps r/c/d/b', () => {
  assert.equal(resolveConfigReadinessPaneInput('r').action, 'refresh');
  assert.equal(resolveConfigReadinessPaneInput('refresh').action, 'refresh');
  assert.equal(resolveConfigReadinessPaneInput('c').action, 'copy');
  assert.equal(resolveConfigReadinessPaneInput('d').action, 'doctor');
  assert.equal(resolveConfigReadinessPaneInput('b').action, 'back');
  assert.equal(resolveConfigReadinessPaneInput('x').action, 'unknown');
});

test('assessEndpointEnvStatus reports present/missing without values', () => {
  const rows = assessEndpointEnvStatus({
    OLLAMA_HOST: '127.0.0.1',
    OLLAMA_PORT: '',
  });
  const host = rows.find((r) => r.env_var === 'OLLAMA_HOST');
  const port = rows.find((r) => r.env_var === 'OLLAMA_PORT');
  assert.equal(host.status, 'present');
  assert.equal(port.status, 'missing');
  assert.equal(JSON.stringify(rows).includes('127.0.0.1'), false);
});

test('local_only pane shows token-not-required copy and never leaks secrets', () => {
  const secret = 'sk-secret-MUST-NOT-LEAK';
  const credentials = assessProviderCredentials({
    modelPolicy: 'local_only',
    env: { ANTHROPIC_API_KEY: secret, OPENAI_API_KEY: '' },
  });
  const pane = buildConfigReadinessPaneModel({
    report: BASE_REPORT,
    runnerPreflight: {
      ok: true,
      model_policy: 'local_only',
      discovered_models: ['qwen2.5-coder:7b'],
      base_url: 'http://127.0.0.1:11434',
      blockers: [],
    },
    pathActivation: {
      status: 'ready',
      on_path: true,
      shim_present: true,
      path_remediation: null,
      note: 'ok',
    },
    credentials,
    env: { ANTHROPIC_API_KEY: secret },
  });

  assert.equal(pane.credentials.local_only_tokens_not_required, true);
  assert.match(pane.policy_note, /remote provider tokens are not required/i);
  assert.match(pane.discovered_models.join(','), /qwen2\.5-coder:7b/);
  assert.match(pane.next_safe_action, /ai-minions smoke/);
  assert.ok(pane.remediation_candidates.some((c) => /smoke/i.test(c)));

  const text = formatConfigReadinessPaneText(pane, { useColor: false });
  assert.match(text, /local_only: remote provider tokens are not required/i);
  assert.match(text, /ANTHROPIC_API_KEY: present/);
  assert.match(text, /OPENAI_API_KEY: missing/);
  assert.match(text, /discovered_models:\s+qwen2\.5-coder:7b/);
  assert.match(text, /local_backend_url:\s+http:\/\/127\.0\.0\.1:11434/);
  assert.equal(text.includes('\x1b['), false);
  assert.doesNotMatch(text, /sk-secret/);
  assert.doesNotMatch(JSON.stringify(pane), /sk-secret/);
});

test('remote_ok missing credentials shows export remediation', () => {
  const credentials = assessProviderCredentials({
    modelPolicy: 'remote_ok',
    env: {},
  });
  const pane = buildConfigReadinessPaneModel({
    report: { ...BASE_REPORT, ok: true },
    runnerPreflight: {
      ok: true,
      model_policy: 'remote_ok',
      discovered_models: [],
      blockers: [],
    },
    pathActivation: {
      status: 'ready',
      on_path: true,
      shim_present: true,
      path_remediation: null,
      note: 'ok',
    },
    credentials,
    env: {},
  });

  assert.equal(pane.credentials.remote_tokens_required, true);
  assert.equal(pane.credentials.credential_sufficiency, 'insufficient');
  assert.match(pane.next_safe_action, /export ANTHROPIC_API_KEY=/);
  assert.ok(pane.remediation_candidates.some((c) => /export ANTHROPIC_API_KEY=/.test(c)));

  const text = formatConfigReadinessPaneText(pane, { useColor: false });
  assert.match(text, /remote_ok: at least one supported provider token/i);
  assert.match(text, /ANTHROPIC_API_KEY: missing/);
  assert.match(text, /export ANTHROPIC_API_KEY=/);
  assert.doesNotMatch(text, /sk-/);
});

test('remote_ok with any_provider present clears missing list', () => {
  const credentials = assessProviderCredentials({
    modelPolicy: 'remote_ok',
    env: { OPENAI_API_KEY: 'sk-present-not-logged' },
  });
  const pane = buildConfigReadinessPaneModel({
    report: BASE_REPORT,
    runnerPreflight: {
      ok: true,
      model_policy: 'remote_ok',
      discovered_models: ['qwen2.5-coder:7b'],
      blockers: [],
    },
    pathActivation: {
      status: 'ready',
      on_path: true,
      shim_present: true,
      path_remediation: null,
      note: 'ok',
    },
    credentials,
  });

  assert.equal(pane.credentials.credential_sufficiency, 'any_provider');
  assert.deepEqual(pane.credentials.missing_required_env_vars, []);
  assert.match(pane.next_safe_action, /smoke --model-policy remote_ok/);

  const text = formatConfigReadinessPaneText(pane, { useColor: false });
  assert.match(text, /credential_sufficiency:\s+any_provider/);
  assert.match(text, /OPENAI_API_KEY: present/);
  assert.doesNotMatch(text, /sk-present/);
});

test('hybrid missing credentials surfaces required tokens', () => {
  const credentials = assessProviderCredentials({
    modelPolicy: 'hybrid',
    env: {},
  });
  const pane = buildConfigReadinessPaneModel({
    report: BASE_REPORT,
    runnerPreflight: { ok: true, model_policy: 'hybrid', discovered_models: [], blockers: [] },
    pathActivation: {
      status: 'ready',
      on_path: true,
      shim_present: true,
      path_remediation: null,
      note: 'ok',
    },
    credentials,
  });
  assert.equal(pane.credentials.remote_tokens_required, true);
  assert.match(pane.policy_note, /hybrid/i);
  assert.match(pane.next_safe_action, /export /);
  const text = formatConfigReadinessPaneText(pane, { useColor: false });
  assert.match(text, /ANTHROPIC_API_KEY: missing \(required for hybrid\)/);
});

test('unreachable backend yields start-backend remediation', () => {
  const credentials = assessProviderCredentials({ modelPolicy: 'local_only', env: {} });
  const pane = buildConfigReadinessPaneModel({
    report: { ...BASE_REPORT, ok: false, layer_stopped: 'runner' },
    runnerPreflight: {
      ok: false,
      model_policy: 'local_only',
      discovered_models: [],
      blockers: ['ollama backend unreachable'],
    },
    pathActivation: {
      status: 'ready',
      on_path: true,
      shim_present: true,
      path_remediation: null,
      note: 'ok',
    },
    credentials,
  });
  assert.ok(pane.remediation_candidates.some((c) => /Start backend/i.test(c)));
  assert.match(pane.next_safe_action, /ollama serve/i);
});

test('empty models yields pull/configure remediation', () => {
  const remediations = deriveRemediationCandidates({
    pathActivation: { status: 'ready', path_remediation: null },
    credentials: assessProviderCredentials({ modelPolicy: 'local_only', env: {} }),
    runnerPreflight: {
      ok: false,
      model_policy: 'local_only',
      blockers: ['no local models discovered'],
      discovered_models: [],
    },
    doctorOk: false,
  });
  assert.ok(remediations.some((c) => /Pull\/configure model/i.test(c)));
});

test('formatConfigReadinessPaneText ANSI when useColor', () => {
  const pane = buildConfigReadinessPaneModel({
    report: BASE_REPORT,
    runnerPreflight: {
      ok: true,
      model_policy: 'local_only',
      discovered_models: ['m1'],
      blockers: [],
    },
    pathActivation: {
      status: 'ready',
      on_path: true,
      shim_present: true,
      path_remediation: null,
      note: 'ok',
    },
    credentials: assessProviderCredentials({ modelPolicy: 'local_only', env: {} }),
  });
  const colored = formatConfigReadinessPaneText(pane, { useColor: true });
  assert.equal(colored.includes('\x1b['), true);
  const plain = formatConfigReadinessPaneText(pane, { useColor: false });
  assert.equal(plain.includes('\x1b['), false);
});

test('formatCopyableRemediationBlock has commands without secrets', () => {
  const secret = 'sk-copy-leak';
  const pane = buildConfigReadinessPaneModel({
    report: BASE_REPORT,
    runnerPreflight: {
      ok: true,
      model_policy: 'local_only',
      discovered_models: [],
      blockers: [],
    },
    pathActivation: {
      status: 'ready',
      on_path: true,
      shim_present: true,
      path_remediation: null,
      note: 'ok',
    },
    credentials: assessProviderCredentials({
      modelPolicy: 'local_only',
      env: { ANTHROPIC_API_KEY: secret },
    }),
  });
  const block = formatCopyableRemediationBlock(pane);
  assert.match(block, /smoke_command:/);
  assert.match(block, /doctor_command:/);
  assert.doesNotMatch(block, /sk-copy/);
});

test('runOperatorConfigReadinessPane refresh then back', async () => {
  let doctorCalls = 0;
  const fakeDoctor = async () => {
    doctorCalls += 1;
    const credentials = assessProviderCredentials({ modelPolicy: 'local_only', env: {} });
    const runnerPreflight = {
      ok: true,
      model_policy: 'local_only',
      discovered_models: ['m1'],
      base_url: 'http://127.0.0.1:11434',
      blockers: [],
    };
    const pathActivation = {
      status: 'ready',
      on_path: true,
      shim_present: true,
      path_remediation: null,
      note: 'ok',
    };
    const pane = buildConfigReadinessPaneModel({
      report: BASE_REPORT,
      runnerPreflight,
      pathActivation,
      credentials,
    });
    return {
      ok: true,
      exitCode: 0,
      report: BASE_REPORT,
      runnerPreflight,
      pathActivation,
      credentials,
      text: formatConfigReadinessPaneText(pane, { useColor: false }),
    };
  };

  const answers = ['r', 'b'];
  const writes = [];
  const result = await runOperatorConfigReadinessPane({
    question: async () => answers.shift() ?? 'b',
    write: (t) => writes.push(String(t)),
    useColor: false,
    runDoctorFn: fakeDoctor,
    maxLoops: 5,
  });

  assert.equal(result.reason_code, 'CONFIG_READINESS_PANE_BACK');
  assert.equal(doctorCalls, 2);
  assert.equal(result.ok, true);
  assert.match(writes.join('\n'), /config \/ credentials readiness/i);
  assert.match(writes.join('\n'), /discovered_models:\s+m1/);
});
