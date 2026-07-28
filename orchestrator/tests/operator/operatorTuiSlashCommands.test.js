'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');

const {
  IMPLEMENTED_COMMANDS,
  RESERVED_COMMANDS,
  parseSlashCommand,
  resolveSlashDispatch,
  formatSlashHelpText,
} = require('../../modules/operator/operator-tui-slash-commands');
const {
  executeShellAction,
  resolveShellActionToken,
  resolveSlashCommandPlan,
} = require('../../modules/operator/operator-tui-shell-actions');
const { buildShellModel, formatShellText } = require('../../modules/operator/operator-tui-shell-model');
const {
  TUI_SHELL_REASON,
  runOperatorTuiShell,
} = require('../../modules/operator/operator-tui-shell-entry');

function createFakeTtyStreams() {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (mode) => {
    stdin.isRaw = Boolean(mode);
    return stdin;
  };
  stdin.ref = () => stdin;
  stdin.unref = () => stdin;
  const stdout = new PassThrough();
  stdout.isTTY = true;
  stdout.columns = 100;
  stdout.rows = 30;
  stdout.getColorDepth = () => 1;
  stdout.ref = () => stdout;
  stdout.unref = () => stdout;
  return { stdin, stdout };
}

function emptyRunsPayload() {
  return {
    ok: true,
    exitCode: 0,
    result_code: 'RUNS_EMPTY',
    next_safe_action: 'none',
    json: { result_code: 'RUNS_EMPTY', runs: [], next_safe_action: 'none' },
  };
}

function shellEntryFixtures() {
  return {
    isTTY: true,
    loadRuns: () => emptyRunsPayload(),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
  };
}

describe('parseSlashCommand', () => {
  it('ignores non-slash tokens', () => {
    assert.equal(parseSlashCommand('status').kind, 'not_slash');
    assert.equal(parseSlashCommand('1').kind, 'not_slash');
    assert.equal(parseSlashCommand('').kind, 'not_slash');
  });

  it('parses implemented commands and args', () => {
    const p = parseSlashCommand('/status task-abc');
    assert.equal(p.kind, 'implemented');
    assert.equal(p.name, 'status');
    assert.deepEqual(p.args, ['task-abc']);
    assert.equal(p.command.action_id, 'status');
  });

  it('parses empty slash', () => {
    assert.equal(parseSlashCommand('/').kind, 'empty');
    assert.equal(parseSlashCommand('/   ').kind, 'empty');
  });

  it('classifies reserved without advertising as implemented', () => {
    for (const name of ['goal', 'limits', 'loop', 'schedule', 'resume', 'rerun']) {
      const p = parseSlashCommand(`/${name}`);
      assert.equal(p.kind, 'reserved', name);
      assert.equal(p.command.name, name);
    }
  });

  it('classifies unknown commands', () => {
    const p = parseSlashCommand('/foobar');
    assert.equal(p.kind, 'unknown');
    assert.equal(p.name, 'foobar');
  });
});

describe('resolveSlashDispatch', () => {
  it('help lists only implemented commands', () => {
    const plan = resolveSlashDispatch(parseSlashCommand('/help'));
    assert.equal(plan.disposition, 'help');
    assert.equal(plan.ok, true);
    assert.match(plan.text, /\/help/);
    assert.match(plan.text, /\/new/);
    assert.match(plan.text, /\/explain/);
    assert.doesNotMatch(plan.text, /\/loop/);
    assert.doesNotMatch(plan.text, /\/goal/);
    assert.doesNotMatch(plan.text, /\/resume/);
    const help = formatSlashHelpText();
    for (const cmd of IMPLEMENTED_COMMANDS) {
      assert.match(help, new RegExp(`/${cmd.name}\\b`));
    }
    for (const cmd of RESERVED_COMMANDS) {
      assert.doesNotMatch(help, new RegExp(`/${cmd.name}\\b`));
    }
  });

  it('reserved commands are honest and non-mutating', () => {
    const plan = resolveSlashDispatch(parseSlashCommand('/loop'));
    assert.equal(plan.disposition, 'message');
    assert.equal(plan.reason_code, 'TUI_SLASH_RESERVED');
    assert.equal(plan.ok, false);
    assert.match(plan.text, /not implemented/i);
    assert.doesNotMatch(plan.text, /dispatch|executed|running loop/i);
  });

  it('unknown commands do not map to similar behavior', () => {
    const plan = resolveSlashDispatch(parseSlashCommand('/statusx'));
    assert.equal(plan.disposition, 'message');
    assert.equal(plan.reason_code, 'TUI_SLASH_UNKNOWN');
    assert.match(plan.text, /Not mapped/);
  });

  it('requires selected run or arg for status/explain/attach', () => {
    for (const name of ['status', 'explain', 'attach']) {
      const missing = resolveSlashDispatch(parseSlashCommand(`/${name}`), {
        selectedRunId: null,
      });
      assert.equal(missing.disposition, 'message', name);
      assert.equal(missing.reason_code, 'TUI_SLASH_RUN_ID_REQUIRED', name);
      assert.match(missing.text, /selected run required/i);

      const withSelected = resolveSlashDispatch(parseSlashCommand(`/${name}`), {
        selectedRunId: 'run-1',
      });
      assert.equal(withSelected.disposition, 'dispatch', name);
      assert.equal(withSelected.run_id, 'run-1', name);
      assert.equal(withSelected.skip_run_prompt, true, name);

      const withArg = resolveSlashDispatch(parseSlashCommand(`/${name} run-arg`), {
        selectedRunId: 'run-1',
      });
      assert.equal(withArg.run_id, 'run-arg', name);
    }
  });

  it('maps /new to guided launcher and /doctor to config', () => {
    assert.equal(
      resolveSlashDispatch(parseSlashCommand('/new')).action_id,
      'launcher',
    );
    assert.equal(
      resolveSlashDispatch(parseSlashCommand('/doctor')).action_id,
      'config',
    );
    assert.equal(
      resolveSlashDispatch(parseSlashCommand('/quit')).action_id,
      'quit',
    );
    assert.equal(
      resolveSlashDispatch(parseSlashCommand('/runs')).action_id,
      'runs',
    );
  });

  it('preserves absent selected run as null (not zero)', () => {
    const plan = resolveSlashDispatch(parseSlashCommand('/runs'), {
      selectedRunId: null,
    });
    assert.equal(plan.disposition, 'dispatch');
    assert.equal(plan.run_id, null);
  });
});

describe('shell token + slash plan wiring', () => {
  it('resolveShellActionToken does not swallow slash tokens as cockpit keys', () => {
    assert.equal(resolveShellActionToken('/status'), null);
    assert.equal(resolveShellActionToken('/new'), null);
    assert.equal(resolveShellActionToken('1'), 'launcher');
    assert.equal(resolveShellActionToken('q'), 'quit');
  });

  it('resolveSlashCommandPlan returns null for cockpit keys', () => {
    assert.equal(resolveSlashCommandPlan('1'), null);
    assert.equal(resolveSlashCommandPlan('status'), null);
    const plan = resolveSlashCommandPlan('/help');
    assert.equal(plan.plan.disposition, 'help');
  });
});

describe('slash dispatch adapters call operator modules', () => {
  it('/status uses runOperatorStatus with skip prompt and selected run', async () => {
    let called = null;
    const outcome = await executeShellAction({
      actionId: 'status',
      selectedRunId: 'run-ok',
      skipRunPrompt: true,
      question: async () => {
        throw new Error('status must not prompt when skipRunPrompt');
      },
      write: () => {},
      runStatus: (opts) => {
        called = opts;
        return {
          ok: true,
          exitCode: 0,
          result_code: 'RUN_FOUND',
          text: 'status ok',
          json: {
            run_id: 'run-ok',
            status: 'complete',
            operator_trace_summary: { outcome: 'complete', next_safe_action: 'ai-minions attach --run-id run-ok' },
            run_state_visibility: {
              blocking_reason_code: null,
              current_phase: 'complete',
            },
            loop_envelope: {
              current_iteration: 1,
              max_iteration: null,
              provenance: { max_iteration: 'absent' },
            },
          },
        };
      },
    });
    assert.equal(called.runId, 'run-ok');
    assert.equal(outcome.contentSurface, 'status');
    assert.equal(outcome.actionResult.ok, true);
    assert.equal(outcome.statusResult.json.loop_envelope.provenance.max_iteration, 'absent');
  });

  it('/explain uses runOperatorExplain and does not invent success from text', async () => {
    let called = null;
    const outcome = await executeShellAction({
      actionId: 'explain',
      selectedRunId: 'run-blocked',
      skipRunPrompt: true,
      question: async () => {
        throw new Error('explain must not prompt when skipRunPrompt');
      },
      write: () => {},
      runExplain: (opts) => {
        called = opts;
        return {
          ok: false,
          exitCode: 2,
          reason_code: 'RUN_NOT_FOUND',
          next_safe_action: 'ai-minions runs',
          text: 'looks fine but authoritative fields say otherwise',
          json: {
            command: 'explain',
            reason_codes: ['RUN_NOT_FOUND'],
            remediation: 'ai-minions runs',
          },
        };
      },
    });
    assert.equal(called.runId, 'run-blocked');
    assert.equal(outcome.actionResult.ok, false);
    assert.equal(outcome.actionResult.reason_code, 'RUN_NOT_FOUND');
    assert.equal(outcome.actionResult.next_safe_action, 'ai-minions runs');
    assert.equal(outcome.contentSurface, 'action_result');
  });

  it('/attach requires run when skip prompt and none selected', async () => {
    const outcome = await executeShellAction({
      actionId: 'attach',
      selectedRunId: null,
      skipRunPrompt: true,
      question: async () => {
        throw new Error('must not prompt');
      },
      write: () => {},
      runAttachFn: async () => {
        throw new Error('attach must not run');
      },
    });
    assert.equal(outcome.actionResult.ok, false);
    assert.equal(outcome.actionResult.reason_code, 'TUI_SHELL_RUN_ID_REQUIRED');
  });
});

describe('disclaimer honesty after slash commands', () => {
  it('does not claim slash commands as missing', () => {
    const model = buildShellModel({
      aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
      pathActivation: { status: 'ready', on_path: true },
      credentials: { credential_sufficiency: 'not_required', providers: [] },
      columns: 100,
    });
    const text = formatShellText(model);
    assert.match(text, /slash commands/i);
    assert.doesNotMatch(text, /Not claimed:.*slash commands/i);
    assert.match(text, /Not claimed:.*Web UI/i);
  });
});

describe('slash help/message remount recreates terminal guard', () => {
  it('reserved slash → second Ink mount → q restores final mount', async () => {
    const { stdin, stdout } = createFakeTtyStreams();
    let mounts = 0;
    const result = await runOperatorTuiShell({
      ...shellEntryFixtures(),
      stdin,
      stdout,
      maxLoops: 5,
      importRenderer: async () => ({
        renderOperatorTuiShell: async ({ onRequestAction }) => {
          mounts += 1;
          if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
          if (mounts === 1) {
            // /help stays in Ink for real routes; reserved slash still remounts message.
            onRequestAction('/goal');
            return { aborted: false, requestedAction: '/goal' };
          }
          onRequestAction('q');
          return { aborted: false, requestedAction: 'q' };
        },
      }),
      executeAction: async ({ actionId }) => {
        if (actionId === 'quit') {
          return {
            quit: true,
            selectedRunId: null,
            contentSurface: 'action_result',
            actionResult: {
              action_id: 'quit',
              ok: true,
              exit_code: 0,
              reason_code: null,
              text: 'quit',
            },
          };
        }
        throw new Error(`unexpected action ${actionId}`);
      },
    });
    assert.equal(mounts, 2);
    assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
    assert.equal(result.guard.restored, true);
    assert.equal(stdin.isRaw, false);
    assert.ok(
      result.guard.mutations.some((m) => m.kind === 'restore_sequence'),
      'final mount must execute restore_sequence (not skip a spent guard)',
    );
    assert.equal(
      result.guard.mutations.some((m) => m.kind === 'restore_skipped'),
      false,
      'fresh guard for remount must not skip restore',
    );
    stdin.destroy();
    stdout.destroy();
  });

  it('/unknown → second Ink mount → Ctrl+C restores final mount', async () => {
    const { stdin, stdout } = createFakeTtyStreams();
    let mounts = 0;
    /** @type {() => void} */
    let markSecondMountReady = () => {};
    const secondMountReady = new Promise((resolve) => {
      markSecondMountReady = resolve;
    });
    const promise = runOperatorTuiShell({
      ...shellEntryFixtures(),
      stdin,
      stdout,
      maxLoops: 5,
      importRenderer: async () => ({
        renderOperatorTuiShell: async ({ onRequestAction }) => {
          mounts += 1;
          if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
          if (mounts === 1) {
            onRequestAction('/foobar');
            return { aborted: false, requestedAction: '/foobar' };
          }
          markSecondMountReady();
          await new Promise((resolve) => {
            const onData = (chunk) => {
              if (String(chunk).includes('\u0003')) {
                stdin.off('data', onData);
                resolve();
              }
            };
            stdin.on('data', onData);
          });
          return { aborted: true };
        },
      }),
    });
    await secondMountReady;
    stdin.write('\u0003');
    const result = await promise;
    assert.equal(mounts, 2);
    assert.equal(result.reason_code, TUI_SHELL_REASON.ABORT);
    assert.equal(result.guard.restored, true);
    assert.equal(stdin.isRaw, false);
    assert.ok(
      result.guard.mutations.some((m) => m.kind === 'restore_sequence'),
      'Ctrl+C on remount must execute restore_sequence',
    );
    assert.equal(
      result.guard.mutations.some((m) => m.kind === 'restore_skipped'),
      false,
      'fresh guard for remount must not skip restore',
    );
    stdin.destroy();
    stdout.destroy();
  });
});
