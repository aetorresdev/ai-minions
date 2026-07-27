'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const {
  COCKPIT_ACTIONS,
  formatNonTtyGuidance,
  buildCockpitHomeText,
  resolveCockpitAction,
  runOperatorCockpit,
} = require('../../modules/operator/operator-cockpit-tui');

const CLI_PATH = path.join(__dirname, '..', '..', 'ai-minions-cli.js');
const ORCH_CWD = path.join(__dirname, '..', '..');

test('formatNonTtyGuidance lists equivalent CLI verbs', () => {
  const text = formatNonTtyGuidance();
  assert.match(text, /requires a TTY/i);
  assert.match(text, /ai-minions smoke/);
  assert.match(text, /ai-minions runs/);
  assert.match(text, /ai-minions status --run-id/);
  assert.match(text, /ai-minions attach --run-id/);
  assert.match(text, /ai-minions doctor/);
  assert.match(text, /tui --run-id/);
});

test('buildCockpitHomeText shows status and actions without secrets', () => {
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
          status: 'missing',
          required_for_policy: false,
        },
      ],
      missing_required_env_vars: [],
    },
    pathActivation: {
      status: 'activation_required',
      on_path: false,
    },
  });
  assert.match(text, /ai-minions cockpit/);
  assert.match(text, /Product status/);
  assert.match(text, /version:\s+0\.25\.0-beta\.1/);
  assert.match(text, /ANTHROPIC_API_KEY: missing/);
  assert.match(text, /\[1\].*smoke/);
  assert.match(text, /\[2\].*runs/);
  assert.match(text, /\[s\].*select run/);
  assert.match(text, /\[e\].*evidence \/ attach pane/);
  assert.match(text, /\[3\].*status/);
  assert.match(text, /\[4\].*attach/);
  assert.match(text, /\[5\].*config \/ credentials readiness/);
  assert.match(text, /\[q\].*quit/);
  assert.match(text, /RUN_TRACE_INVALID/);
  assert.match(text, /disk-only/);
  assert.match(text, /Config \(5\):/);
  assert.match(text, /legacy readline/i);
  assert.match(text, /AI_MINIONS_TUI_LEGACY/);
  assert.doesNotMatch(text, /sk-ant-/);
  assert.doesNotMatch(text, /sk-proj-/);
});

test('resolveCockpitAction accepts keys and aliases', () => {
  assert.equal(resolveCockpitAction('1').id, 'smoke');
  assert.equal(resolveCockpitAction('smoke').id, 'smoke');
  assert.equal(resolveCockpitAction('new-run').id, 'smoke');
  assert.equal(resolveCockpitAction('2').id, 'runs');
  assert.equal(resolveCockpitAction('s').id, 'select');
  assert.equal(resolveCockpitAction('select').id, 'select');
  assert.equal(resolveCockpitAction('pick').id, 'select');
  assert.equal(resolveCockpitAction('e').id, 'evidence');
  assert.equal(resolveCockpitAction('evidence').id, 'evidence');
  assert.equal(resolveCockpitAction('attach-pane').id, 'evidence');
  assert.equal(resolveCockpitAction('q').id, 'quit');
  assert.equal(resolveCockpitAction('quit').id, 'quit');
  assert.equal(resolveCockpitAction('5').id, 'config');
  assert.equal(resolveCockpitAction('doctor').id, 'config');
  assert.equal(resolveCockpitAction('config').id, 'config');
  assert.equal(resolveCockpitAction('readiness').id, 'config');
  assert.equal(resolveCockpitAction('c').id, 'config');
  assert.equal(resolveCockpitAction('m').id, 'monitor');
  assert.equal(resolveCockpitAction('live-monitor').id, 'monitor');
  assert.equal(resolveCockpitAction(''), null);
  assert.equal(resolveCockpitAction('9'), null);
  assert.equal(COCKPIT_ACTIONS.length, 9);
});

test('runOperatorCockpit non-TTY exits with guidance', async () => {
  const result = await runOperatorCockpit({ isTTY: false });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.reason_code, 'COCKPIT_TTY_REQUIRED');
  assert.match(result.text, /ai-minions smoke/);
});

test('runOperatorCockpit quit exits cleanly without invoking operators', async () => {
  let smokeCalls = 0;
  let configCalls = 0;
  let runsCalls = 0;
  const result = await runOperatorCockpit({
    isTTY: true,
    useColor: false,
    question: async () => 'q',
    write: () => {},
    runSmokeFn: async () => {
      smokeCalls += 1;
      return { ok: true, exitCode: 0, text: 'smoke' };
    },
    runConfigPane: async () => {
      configCalls += 1;
      return { ok: true, exitCode: 0, text: 'config' };
    },
    runRuns: () => {
      runsCalls += 1;
      return { ok: true, exitCode: 0, text: 'runs' };
    },
    buildAbout: () => ({
      version: 'test',
      git_commit: 'abc',
      model_policy: 'local_only',
    }),
    assessCredentials: () => ({
      model_policy: 'local_only',
      remote_tokens_required: false,
      credential_sufficiency: 'not_required',
      note: 'local_only does not require remote provider tokens',
      providers: [],
      missing_required_env_vars: [],
    }),
    assessPath: () => ({ status: 'ready', on_path: true }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.reason_code, 'COCKPIT_QUIT');
  assert.equal(smokeCalls, 0);
  assert.equal(configCalls, 0);
  assert.equal(runsCalls, 0);
});

test('runOperatorCockpit config action opens readiness pane', async () => {
  /** @type {string[]} */
  const answers = ['5', 'q'];
  let configCalls = 0;
  /** @type {string[]} */
  const out = [];
  const result = await runOperatorCockpit({
    isTTY: true,
    useColor: false,
    question: async () => answers.shift() ?? 'q',
    write: (t) => out.push(String(t)),
    runConfigPane: async () => {
      configCalls += 1;
      return {
        ok: true,
        exitCode: 0,
        reason_code: 'CONFIG_READINESS_PANE_BACK',
        text: 'config-pane',
      };
    },
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
  assert.equal(configCalls, 1);
  assert.ok(out.some((l) => l.includes('config / credentials readiness')));
});

test('runOperatorCockpit runs action reuses runOperatorRuns contract', async () => {
  /** @type {string[]} */
  const answers = ['2', 'q'];
  /** @type {string[]} */
  const out = [];
  const result = await runOperatorCockpit({
    isTTY: true,
    useColor: false,
    question: async () => answers.shift() ?? 'q',
    write: (t) => out.push(String(t)),
    runRuns: () => ({
      ok: true,
      exitCode: 0,
      text: 'RUNS_CONTRACT_OK',
    }),
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
  assert.ok(out.some((l) => l.includes('RUNS_CONTRACT_OK')));
});

test('runOperatorCockpit status prompts for run-id then calls status module', async () => {
  /** @type {string[]} */
  const answers = ['3', 'task-from-cockpit', 'q'];
  let seenRunId = null;
  const result = await runOperatorCockpit({
    isTTY: true,
    useColor: false,
    question: async () => answers.shift() ?? 'q',
    write: () => {},
    runStatus: ({ runId }) => {
      seenRunId = runId;
      return { ok: true, exitCode: 0, text: `status:${runId}` };
    },
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
  assert.equal(seenRunId, 'task-from-cockpit');
});

test('runOperatorCockpit select action remembers run for status default', async () => {
  /** @type {string[]} */
  const answers = ['s', '3', '', 'q'];
  let seenRunId = null;
  /** @type {string[]} */
  const out = [];
  const result = await runOperatorCockpit({
    isTTY: true,
    useColor: false,
    question: async () => answers.shift() ?? 'q',
    write: (t) => out.push(String(t)),
    runSelector: async () => ({
      ok: true,
      exitCode: 0,
      reason_code: 'RUN_SELECTOR_SELECTED',
      selected_run_id: 'from-selector',
      text: 'pane',
    }),
    runStatus: ({ runId }) => {
      seenRunId = runId;
      return { ok: true, exitCode: 0, text: `status:${runId}` };
    },
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
  assert.equal(seenRunId, 'from-selector');
  assert.ok(out.some((l) => l.includes('Selected run: from-selector')));
});

test('runOperatorCockpit evidence action uses selected run default', async () => {
  /** @type {string[]} */
  const answers = ['s', 'e', '', 'q'];
  let seenRunId = null;
  /** @type {string[]} */
  const out = [];
  const result = await runOperatorCockpit({
    isTTY: true,
    useColor: false,
    question: async () => answers.shift() ?? 'q',
    write: (t) => out.push(String(t)),
    runSelector: async () => ({
      ok: true,
      exitCode: 0,
      reason_code: 'RUN_SELECTOR_SELECTED',
      selected_run_id: 'ev-selected',
      text: 'pane',
    }),
    runEvidencePane: async ({ runId }) => {
      seenRunId = runId;
      return {
        ok: true,
        exitCode: 0,
        reason_code: 'EVIDENCE_ATTACH_PANE_BACK',
        selected_run_id: runId,
        text: 'evidence-pane',
      };
    },
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
  assert.equal(seenRunId, 'ev-selected');
  assert.ok(out.some((l) => l.includes('evidence / attach pane')));
});

test('runOperatorCockpit NO_COLOR path keeps home text without ANSI when useColor false', () => {
  const text = buildCockpitHomeText({
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
  assert.equal(text.includes('\x1b['), false);
});

test('ai-minions tui without selector on non-TTY exits with CLI guidance', () => {
  const r = spawnSync(process.execPath, [CLI_PATH, 'tui'], {
    encoding: 'utf8',
    cwd: ORCH_CWD,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires a TTY/i);
  assert.match(r.stderr, /ai-minions smoke/);
  assert.match(r.stderr, /ai-minions doctor/);
});

test('ai-minions --help documents fullscreen shell', () => {
  const r = spawnSync(process.execPath, [CLI_PATH, '--help'], {
    encoding: 'utf8',
    cwd: ORCH_CWD,
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /tui\s+Fullscreen Ink shell/);
  assert.match(r.stdout, /not guided launcher|Web UI/i);
  assert.match(r.stdout, /AI_MINIONS_TUI_LEGACY/);
});
