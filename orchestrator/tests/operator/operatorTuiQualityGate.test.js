'use strict';

/**
 * Operator TUI MVP quality gate — mandatory acceptance matrix when TUI code ships.
 * Covers render/state models + command dispatch; not pixel-perfect terminal tests.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  TUI_QUALITY_SCENARIOS,
  assertAnsiPolicy,
  assertNoAnsiInShareable,
  assertNoSecretSurfaces,
  assertMvpClaimHonesty,
  makeTempTracesDir,
  seedQualityGateScenarios,
  writeTraceFixture,
} = require('../../modules/operator/operator-tui-quality-harness');

const {
  formatNonTtyGuidance,
  buildCockpitHomeText,
  resolveCockpitAction,
  runOperatorCockpit,
} = require('../../modules/operator/operator-cockpit-tui');

const {
  buildRunSelectorListText,
  formatRunStatusPaneText,
  loadRunStatusPane,
  runOperatorRunSelector,
} = require('../../modules/operator/operator-run-selector-tui');

const {
  buildEvidenceAttachPaneModel,
  formatEvidenceAttachPaneText,
  formatCopyableAttachBlock,
  loadEvidenceAttachPane,
  resolveEvidenceAttachPaneInput,
} = require('../../modules/operator/operator-evidence-attach-pane-tui');

const {
  buildConfigReadinessPaneModel,
  formatConfigReadinessPaneText,
  formatCopyableRemediationBlock,
  resolveConfigReadinessPaneInput,
} = require('../../modules/operator/operator-config-readiness-pane-tui');

const { assessProviderCredentials } = require('../../modules/operator/operator-credential-readiness');
const {
  buildOperatorEvidenceTuiText,
  buildOperatorEvidenceTuiJson,
  runOperatorEvidenceTui,
} = require('../../modules/operator/operator-evidence-tui');
const { resolveUseColorForCli } = require('../../modules/operator/terminal-style');
const { loadOperatorTraceContext } = require('../../modules/operator/operator-trace-command');

const CLI_PATH = path.join(__dirname, '..', '..', 'ai-minions-cli.js');
const ORCH_CWD = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'operator-trace-summary');

const BASE_DOCTOR = {
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

const PATH_READY = {
  status: 'ready',
  on_path: true,
  shim_present: true,
  path_remediation: null,
  note: 'ok',
};

test('quality gate inventory lists required TUI MVP scenarios', () => {
  assert.ok(TUI_QUALITY_SCENARIOS.includes('empty_run_store'));
  assert.ok(TUI_QUALITY_SCENARIOS.includes('non_tty_fallback'));
  assert.ok(TUI_QUALITY_SCENARIOS.includes('unknown_action_command'));
  assert.ok(TUI_QUALITY_SCENARIOS.includes('no_ansi_in_shareables'));
  assert.equal(TUI_QUALITY_SCENARIOS.length >= 12, true);
});

test('empty run store — selector guidance without ANSI', async () => {
  const tracesDir = makeTempTracesDir();
  try {
    const list = buildRunSelectorListText([], { useColor: false });
    assert.match(list, /runs: \(none\)/);
    assert.match(list, /ai-minions smoke/);
    assertAnsiPolicy(list, { useColor: false });

    /** @type {string[]} */
    const out = [];
    const result = await runOperatorRunSelector({
      tracesDir,
      question: async () => 'b',
      write: (t) => out.push(String(t)),
      useColor: false,
    });
    assert.equal(result.reason_code, 'RUN_SELECTOR_EMPTY');
    assert.equal(result.selected_run_id, null);
  } finally {
    fs.rmSync(tracesDir, { recursive: true, force: true });
  }
});

test('invalid / successful / failed / blocked run status panes', () => {
  const tracesDir = makeTempTracesDir();
  try {
    seedQualityGateScenarios(tracesDir);

    const ok = loadRunStatusPane(
      {
        run_id: 'ok-run',
        result_code: 'RUN_FOUND',
        trace_file: path.join(tracesDir, 'ok-run.jsonl'),
        select_command: 'ai-minions status --run-id ok-run',
      },
      { tracesDir },
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.pane.outcome, 'complete');

    const failed = loadRunStatusPane(
      {
        run_id: 'fail-run',
        result_code: 'RUN_FOUND',
        trace_file: path.join(tracesDir, 'fail-run.jsonl'),
        select_command: 'ai-minions status --run-id fail-run',
      },
      { tracesDir },
    );
    assert.equal(failed.ok, true);
    assert.equal(failed.pane.outcome, 'failed');

    const blocked = loadRunStatusPane(
      {
        run_id: 'blocked-run',
        result_code: 'RUN_FOUND',
        trace_file: path.join(tracesDir, 'blocked-run.jsonl'),
        select_command: 'ai-minions status --run-id blocked-run',
      },
      { tracesDir },
    );
    assert.equal(blocked.ok, true);
    assert.ok(['failed', 'blocked'].includes(String(blocked.pane.outcome)));

    const invalid = loadRunStatusPane(
      {
        run_id: 'bad-run',
        result_code: 'RUN_TRACE_INVALID',
        trace_file: path.join(tracesDir, 'bad-run.jsonl'),
        select_command: 'ai-minions status --run-id bad-run',
      },
      { tracesDir },
    );
    assert.equal(invalid.ok, false);
    assert.equal(invalid.result_code, 'RUN_TRACE_INVALID');
    assert.equal(invalid.pane.outcome, null);

    const invalidText = formatRunStatusPaneText(invalid.pane, { useColor: false });
    assert.match(invalidText, /RUN_TRACE_INVALID/);
    assertAnsiPolicy(invalidText, { useColor: false });
  } finally {
    fs.rmSync(tracesDir, { recursive: true, force: true });
  }
});

test('attach bundle present and missing — copyable paths ANSI-free', () => {
  const tracesDir = makeTempTracesDir();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-tui-qg-repo-'));
  try {
    writeTraceFixture(tracesDir, 'no-bundle', [
      { event: 'session_start', task_id: 'no-bundle', flow_mode: 'single_agent', ts_ms: 1 },
      { event: 'session_end', task_id: 'no-bundle', done: true, gate_blocks: 0, ts_ms: 2 },
    ]);
    writeTraceFixture(tracesDir, 'with-bundle', [
      { event: 'session_start', task_id: 'with-bundle', flow_mode: 'single_agent', ts_ms: 1 },
      { event: 'session_end', task_id: 'with-bundle', done: true, gate_blocks: 0, ts_ms: 2 },
    ]);
    const bundleDir = path.join(repoRoot, 'report-bundles', 'with-bundle-20260101T000000Z');
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.writeFileSync(path.join(bundleDir, 'inspect-report.json'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(bundleDir, 'ATTACH.md'), '# attach\n', 'utf8');

    const missing = loadEvidenceAttachPane('no-bundle', { tracesDir, repoRoot });
    assert.equal(missing.ok, true);
    assert.equal(missing.pane.attach_available, false);
    assert.equal(missing.pane.attach_action_available, true);
    const missingText = formatEvidenceAttachPaneText(missing.pane, { useColor: false });
    assertAnsiPolicy(missingText, { useColor: false });
    assertNoAnsiInShareable(formatCopyableAttachBlock(missing.pane));

    const present = loadEvidenceAttachPane('with-bundle', { tracesDir, repoRoot });
    assert.equal(present.ok, true);
    assert.equal(present.pane.attach_available, true);
    assert.ok(present.pane.output_paths.includes(bundleDir));
    const presentText = formatEvidenceAttachPaneText(present.pane, { useColor: false });
    assertAnsiPolicy(presentText, { useColor: false });
    assertNoAnsiInShareable(formatCopyableAttachBlock(present.pane));
  } finally {
    fs.rmSync(tracesDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('missing credentials and local_only token-not-required copy — no secrets', () => {
  const secret = 'sk-secret-MUST-NOT-LEAK-quality-gate';

  const localCreds = assessProviderCredentials({
    modelPolicy: 'local_only',
    env: { ANTHROPIC_API_KEY: secret, OPENAI_API_KEY: '' },
  });
  const localPane = buildConfigReadinessPaneModel({
    report: BASE_DOCTOR,
    runnerPreflight: {
      ok: true,
      model_policy: 'local_only',
      discovered_models: ['qwen2.5-coder:7b'],
      base_url: 'http://127.0.0.1:11434',
      blockers: [],
    },
    pathActivation: PATH_READY,
    credentials: localCreds,
    env: { ANTHROPIC_API_KEY: secret },
  });
  assert.equal(localPane.credentials.local_only_tokens_not_required, true);
  assert.match(localPane.policy_note, /remote provider tokens are not required/i);
  const localText = formatConfigReadinessPaneText(localPane, { useColor: false });
  assert.match(localText, /local_only: remote provider tokens are not required/i);
  assertAnsiPolicy(localText, { useColor: false });
  assertNoSecretSurfaces(localText, [secret]);
  assertNoAnsiInShareable(localPane);
  assertNoAnsiInShareable(formatCopyableRemediationBlock(localPane));

  const remoteCreds = assessProviderCredentials({ modelPolicy: 'remote_ok', env: {} });
  const remotePane = buildConfigReadinessPaneModel({
    report: BASE_DOCTOR,
    runnerPreflight: {
      ok: true,
      model_policy: 'remote_ok',
      discovered_models: [],
      blockers: [],
    },
    pathActivation: PATH_READY,
    credentials: remoteCreds,
    env: {},
  });
  assert.equal(remotePane.credentials.credential_sufficiency, 'insufficient');
  assert.match(remotePane.next_safe_action, /export ANTHROPIC_API_KEY=/);
  const remoteText = formatConfigReadinessPaneText(remotePane, { useColor: false });
  assert.match(remoteText, /ANTHROPIC_API_KEY: missing/);
  assertNoSecretSurfaces(remoteText);
});

test('non-TTY fallback exits with CLI guidance (no hang)', async () => {
  const guidance = formatNonTtyGuidance();
  assert.match(guidance, /requires a TTY/i);
  assert.match(guidance, /ai-minions smoke/);
  assert.match(guidance, /ai-minions doctor/);

  const result = await runOperatorCockpit({ isTTY: false });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.reason_code, 'COCKPIT_TTY_REQUIRED');
  assert.match(result.text, /ai-minions runs/);

  const cli = spawnSync(process.execPath, [CLI_PATH, 'tui'], {
    encoding: 'utf8',
    cwd: ORCH_CWD,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /requires a TTY/i);
});

test('unknown cockpit action and pane slash-like input stay safe', async () => {
  assert.equal(resolveCockpitAction('9'), null);
  assert.equal(resolveCockpitAction('/fullscreen'), null);
  assert.equal(resolveCockpitAction('xyzzy'), null);
  assert.equal(resolveEvidenceAttachPaneInput('/launch').action, 'unknown');
  assert.equal(resolveConfigReadinessPaneInput('/unknown').action, 'unknown');

  /** @type {string[]} */
  const answers = ['/fullscreen', '9', 'q'];
  /** @type {string[]} */
  const out = [];
  const result = await runOperatorCockpit({
    isTTY: true,
    useColor: false,
    question: async () => answers.shift() ?? 'q',
    write: (t) => out.push(String(t)),
    buildAbout: () => ({
      version: 'test',
      git_commit: 'abc',
      model_policy: 'local_only',
    }),
    assessCredentials: () => ({
      model_policy: 'local_only',
      remote_tokens_required: false,
      credential_sufficiency: 'not_required',
      note: 'n',
      providers: [],
      missing_required_env_vars: [],
    }),
    assessPath: () => ({ status: 'ready', on_path: true }),
  });
  assert.equal(result.reason_code, 'COCKPIT_QUIT');
  assert.ok(out.filter((l) => /Unknown action/i.test(l)).length >= 2);
});

test('JSON / Markdown / shareable evidence paths never emit ANSI', () => {
  const ctx = loadOperatorTraceContext({
    filePath: path.join(FIXTURES, 'complete.v1.jsonl'),
    existsSync: (p) => !String(p).includes('report-bundles'),
    readFileSync: (p) => fs.readFileSync(p, 'utf8'),
    repoRoot: '/tmp/repo',
  });
  assert.equal(ctx.ok, true);

  const json = buildOperatorEvidenceTuiJson(ctx);
  assertNoAnsiInShareable(json);

  const coloredHuman = buildOperatorEvidenceTuiText(ctx, { useColor: true });
  assertAnsiPolicy(coloredHuman, { useColor: true });

  const plainHuman = buildOperatorEvidenceTuiText(ctx, { useColor: false });
  assertAnsiPolicy(plainHuman, { useColor: false });

  const asJson = runOperatorEvidenceTui({
    filePath: path.join(FIXTURES, 'complete.v1.jsonl'),
    json: true,
    useColor: true,
    loadContext: () => ctx,
  });
  assert.equal(asJson.ok, true);
  assertAnsiPolicy(asJson.text, { useColor: false });
  assertNoAnsiInShareable(asJson.json);

  const cli = spawnSync(
    process.execPath,
    [CLI_PATH, 'tui', '--file', path.join(FIXTURES, 'complete.v1.jsonl'), '--json', '--color=always'],
    { encoding: 'utf8', cwd: ORCH_CWD },
  );
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  assertNoAnsiInShareable(cli.stdout);
  JSON.parse(cli.stdout);
});

test('NO_COLOR / color policy for human TUI stdout', () => {
  assert.equal(
    resolveUseColorForCli(['--color=always'], { env: { NO_COLOR: '1' }, isTTY: true }),
    false,
  );
  assert.equal(
    resolveUseColorForCli(['--color=always'], { env: {}, isTTY: true, json: true }),
    false,
  );

  const homeColor = buildCockpitHomeText({
    useColor: true,
    aboutInfo: { version: 'v', git_commit: 'c', model_policy: 'local_only' },
    credentials: {
      model_policy: 'local_only',
      remote_tokens_required: false,
      credential_sufficiency: 'not_required',
      note: 'n',
      providers: [],
      missing_required_env_vars: [],
    },
    pathActivation: { status: 'ready', on_path: true },
  });
  assertAnsiPolicy(homeColor, { useColor: true });

  const homePlain = buildCockpitHomeText({
    useColor: false,
    aboutInfo: { version: 'v', git_commit: 'c', model_policy: 'local_only' },
    credentials: {
      model_policy: 'local_only',
      remote_tokens_required: false,
      credential_sufficiency: 'not_required',
      note: 'n',
      providers: [],
      missing_required_env_vars: [],
    },
    pathActivation: { status: 'ready', on_path: true },
  });
  assertAnsiPolicy(homePlain, { useColor: false });
});

test('cockpit home claim honesty and no secret surfaces', () => {
  const secret = 'sk-ant-quality-gate-leak';
  const text = buildCockpitHomeText({
    useColor: false,
    aboutInfo: {
      version: '0.25.0-beta.1',
      git_commit: 'deadbeef',
      model_policy: 'local_only',
    },
    credentials: {
      model_policy: 'local_only',
      remote_tokens_required: false,
      credential_sufficiency: 'not_required',
      note: 'local_only does not require remote provider tokens',
      providers: [
        {
          provider: 'anthropic',
          env_var: 'ANTHROPIC_API_KEY',
          status: 'present',
          required_for_policy: false,
        },
      ],
      missing_required_env_vars: [],
    },
    pathActivation: { status: 'ready', on_path: true },
  });
  assertMvpClaimHonesty(text);
  assert.match(text, /not fullscreen/i);
  assert.match(text, /ANTHROPIC_API_KEY: present/);
  assertNoSecretSurfaces(text, [secret]);
  assert.doesNotMatch(text, /sk-ant-/);
});

test('readiness remediations do not mutate shell rc files', () => {
  const home = os.homedir();
  const rcCandidates = ['.bashrc', '.zshrc', '.profile'].map((n) => path.join(home, n));
  /** @type {Map<string, number|null>} */
  const before = new Map();
  for (const p of rcCandidates) {
    try {
      before.set(p, fs.statSync(p).mtimeMs);
    } catch {
      before.set(p, null);
    }
  }

  const credentials = assessProviderCredentials({ modelPolicy: 'remote_ok', env: {} });
  const pane = buildConfigReadinessPaneModel({
    report: BASE_DOCTOR,
    runnerPreflight: {
      ok: true,
      model_policy: 'remote_ok',
      discovered_models: [],
      blockers: [],
    },
    pathActivation: PATH_READY,
    credentials,
    env: {},
  });
  const block = formatCopyableRemediationBlock(pane);
  assert.match(block, /export ANTHROPIC_API_KEY=/);
  assert.doesNotMatch(block, /\.bashrc|\.zshrc|>>\s*~/);
  assertNoAnsiInShareable(block);

  for (const p of rcCandidates) {
    let after = null;
    try {
      after = fs.statSync(p).mtimeMs;
    } catch {
      after = null;
    }
    assert.equal(after, before.get(p), `shell rc mutated: ${p}`);
  }
});

test('evidence attach model snapshot stays ANSI-free when useColor false', () => {
  const model = buildEvidenceAttachPaneModel({
    run_id: 'snap',
    ctx: {
      ok: true,
      result_code: 'RUN_FOUND',
      reason_code: null,
      next_safe_action: 'attach',
      trace_file: '/tmp/snap.jsonl',
      status_label: 'complete',
      summary: { outcome: 'complete' },
    },
  });
  const text = formatEvidenceAttachPaneText(model, { useColor: false });
  assertAnsiPolicy(text, { useColor: false });
  assertNoAnsiInShareable(model);
});
