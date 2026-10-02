'use strict';

/**
 * Revalidation of the fullscreen TUI on a tree that already contains the
 * corrective terminal-lifecycle merge. State and reason-code assertions.
 * Does not add product features and does not treat macOS evidence as a pass
 * when this process is not running on darwin.
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  TUI_QUALITY_RELEASE_COMMAND,
  buildPlatformEvidenceRecord,
  evaluateReleaseGateVerdict,
} = require('../../modules/operator/operator-tui-quality-harness');
const {
  resolveAbortedRequestOutcome,
  TUI_ACTION_REASON,
  TUI_ACTION_STATUS,
} = require('../../modules/operator/operator-tui-action-executor');
const { createTerminalGuard } = require('../../modules/operator/operator-tui-terminal-guard');
const {
  TUI_SHELL_REASON,
  runOperatorTuiShell,
} = require('../../modules/operator/operator-tui-shell-entry');
const {
  buildShellModel,
  shellModelToOptions,
} = require('../../modules/operator/operator-tui-shell-model');
const { resolveShellActionToken } = require('../../modules/operator/operator-tui-shell-actions');
const {
  parseSlashCommand,
  resolveSlashDispatch,
} = require('../../modules/operator/operator-tui-slash-commands');
const { NATIVE_LAUNCHER_EXECUTE_ACTION } = require('../../modules/operator/operator-tui-native-workflows');

/** Merge that closed the corrective terminal-lifecycle work. Evidence must name a descendant. */
const INTEGRATED_BASE = '9b0c862d7cb1025cd8310ad9d07a291308460afc';

function repoRoot() {
  return path.resolve(__dirname, '../../..');
}

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot(), encoding: 'utf8' }).trim();
}

function createFakeTtyStreams(columns = 100) {
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
  stdout.columns = columns;
  stdout.rows = 30;
  stdout.getColorDepth = () => 1;
  stdout.ref = () => stdout;
  stdout.unref = () => stdout;
  return { stdin, stdout };
}

function canonicalRunsResult(runs) {
  return {
    ok: true,
    exitCode: 0,
    result_code: runs.length ? 'RUNS_FOUND' : 'RUNS_EMPTY',
    next_safe_action: 'none',
    json: { result_code: runs.length ? 'RUNS_FOUND' : 'RUNS_EMPTY', runs, next_safe_action: 'none' },
  };
}

function shellDefaults(overrides = {}) {
  return {
    isTTY: true,
    skipSplash: true,
    maxLoops: 4,
    loadRuns: () => canonicalRunsResult([
      { run_id: 'run-a', status: 'running', result_code: 'RUN_FOUND' },
      { run_id: 'run-b', status: 'complete', result_code: 'RUN_FOUND' },
    ]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'revalidation' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    ...overrides,
  };
}

test('revalidation evidence names a descendant of the integrated merge', () => {
  execFileSync('git', ['merge-base', '--is-ancestor', INTEGRATED_BASE, 'HEAD'], {
    cwd: repoRoot(),
    stdio: 'pipe',
  });
  const head = git(['rev-parse', 'HEAD']);
  assert.match(head, /^[0-9a-f]{40}$/);
  const evidence = {
    integrated_base: INTEGRATED_BASE,
    head,
    release_command: TUI_QUALITY_RELEASE_COMMAND,
  };
  assert.equal(evidence.integrated_base, INTEGRATED_BASE);
  assert.equal(evidence.release_command, 'cd orchestrator && npm run test:tui-quality');
});

test('key and slash entry points share the status action id', () => {
  assert.equal(resolveShellActionToken('status'), 'status');
  const parsed = parseSlashCommand('/status');
  const dispatched = resolveSlashDispatch(parsed, { selectedRunId: 'run-a' });
  assert.equal(dispatched.action_id, 'status');
  assert.equal(dispatched.disposition, 'dispatch');
});

test('local navigation does not remount Ink or touch the terminal lease', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const result = await runOperatorTuiShell(shellDefaults({
    stdin,
    stdout,
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ onModelChange, model }) => {
        if (typeof onModelChange === 'function') {
          onModelChange(buildShellModel({
            ...shellModelToOptions(model),
            contentSurface: 'runs',
            selectedNavId: 'runs',
          }));
          onModelChange(buildShellModel({
            ...shellModelToOptions(model),
            contentSurface: 'help',
            selectedNavId: 'help',
          }));
        }
        return { aborted: false, requestedAction: null };
      },
    }),
  }));
  assert.equal(result.reason_code, TUI_SHELL_REASON.OK);
  assert.equal(result.guard.metrics.snapshot().remount_count, 1);
  assert.equal(result.guard.metrics.snapshot().intervals.runtime_action_ms.ms, null);
  assert.equal(result.guard.metrics.snapshot().intervals.runtime_action_ms.measured, false);
  stdin.destroy();
  stdout.destroy();
});

test('guard-level local navigation keeps remount and lease unchanged', () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const guard = createTerminalGuard({ stdin, stdout });
  guard.markMounted();
  const before = guard.metrics.snapshot().remount_count;
  const leaseBefore = guard.lease.snapshot().state;
  const noted = guard.noteLocalNavigation({ from: 'home', to: 'runs', surface: 'runs' });
  assert.equal(guard.metrics.snapshot().remount_count, before);
  assert.equal(noted.lease_touched, false);
  assert.equal(guard.lease.snapshot().state, leaseBefore);
  const runtime = guard.metrics.snapshot().intervals.runtime_action_ms;
  assert.equal(runtime.measured, false);
  assert.equal(runtime.ms, null);
});

test('duplicate launcher submit does not start a second mutating action', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  let executeCount = 0;
  /** @type {() => void} */
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  await runOperatorTuiShell(shellDefaults({
    stdin,
    stdout,
    loadRuns: () => canonicalRunsResult([]),
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ onNestedExecute }) => {
        const first = onNestedExecute({ actionId: NATIVE_LAUNCHER_EXECUTE_ACTION });
        const second = onNestedExecute({ actionId: NATIVE_LAUNCHER_EXECUTE_ACTION });
        releaseFirst();
        await first;
        const secondResult = await second;
        assert.equal(secondResult?.model?.actionResult?.reason_code, 'TUI_ACTION_DUPLICATE');
        return { aborted: false, requestedAction: null };
      },
    }),
    executeAction: async () => {
      executeCount += 1;
      if (executeCount === 1) await firstGate;
      return {
        quit: false,
        selectedRunId: 'run-new',
        contentSurface: 'action_result',
        actionResult: {
          action_id: NATIVE_LAUNCHER_EXECUTE_ACTION,
          ok: true,
          exit_code: 0,
          reason_code: 'LAUNCH_OK',
          text: 'ok',
        },
      };
    },
  }));
  assert.equal(executeCount, 1);
  stdin.destroy();
  stdout.destroy();
});

test('a late status result does not overwrite the newly selected run', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  /** @type {() => void} */
  let releaseStatus;
  const statusGate = new Promise((resolve) => {
    releaseStatus = resolve;
  });
  const result = await runOperatorTuiShell(shellDefaults({
    stdin,
    stdout,
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ onNestedExecute, onModelChange, model }) => {
        const pending = onNestedExecute({ actionId: 'status', runId: 'run-a' });
        await new Promise((resolve) => setImmediate(resolve));
        onModelChange(buildShellModel({
          ...shellModelToOptions(model),
          selectedRunId: 'run-b',
          contentSurface: 'monitor',
          selectedNavId: 'monitor',
        }));
        releaseStatus();
        const pendingResult = await pending;
        assert.equal(pendingResult?.model?.actionResult?.reason_code, 'TUI_ACTION_STALE_CONTEXT');
        return { aborted: false, requestedAction: null };
      },
    }),
    executeAction: async ({ actionId, selectedRunId }) => {
      if (actionId === 'status' && selectedRunId === 'run-a') {
        await statusGate;
        return {
          quit: false,
          selectedRunId: 'run-a',
          contentSurface: 'status',
          statusResult: {
            ok: true,
            exitCode: 0,
            json: { run_id: 'run-a', status: 'STALE_FROM_A' },
          },
          actionResult: {
            action_id: 'status',
            ok: true,
            exit_code: 0,
            reason_code: 'STATUS_OK',
            text: 'stale',
          },
        };
      }
      throw new Error(`unexpected ${actionId} ${selectedRunId}`);
    },
  }));
  assert.equal(result.model?.selectedRunId, 'run-b');
  assert.notEqual(result.model?.status?.status, 'STALE_FROM_A');
  stdin.destroy();
  stdout.destroy();
});

test('cancellation text does not claim runtime termination', () => {
  const outcome = resolveAbortedRequestOutcome({
    status: TUI_ACTION_STATUS.CANCELLED,
    reason_code: TUI_ACTION_REASON.CANCELLED,
  });
  assert.equal(outcome.reason_code, TUI_ACTION_REASON.CANCELLED);
  assert.doesNotMatch(String(outcome.text), /terminat|killed|stopped the run/i);
  const timedOut = resolveAbortedRequestOutcome({
    status: TUI_ACTION_STATUS.TIMED_OUT,
    reason_code: TUI_ACTION_REASON.TIMED_OUT,
  });
  assert.equal(timedOut.reason_code, TUI_ACTION_REASON.TIMED_OUT);
  assert.doesNotMatch(String(timedOut.text), /terminat|killed|stopped the run/i);
});

test('platform evidence on linux does not pass macOS or live fixture by omission', () => {
  const record = buildPlatformEvidenceRecord({
    automatedGateOk: true,
    nodeMajor: 24,
    platform: 'linux',
  });
  assert.equal(record.slots.linux_node24.status, 'pass');
  assert.notEqual(record.slots.macos_node22_tty.status, 'pass');
  assert.equal(record.slots.windows_interactive.status, 'deferred');
  assert.notEqual(record.slots.live_canonical_fixture.status, 'pass');
  assert.equal(record.live_fixture.replaced_by_mocks, false);
  const verdict = evaluateReleaseGateVerdict({
    automatedGateOk: true,
    platformEvidence: record,
  });
  assert.equal(verdict.verdict, 'blocked');
  assert.ok(verdict.reasons.some((reason) => reason.startsWith('macos_node22_tty:')));
});
