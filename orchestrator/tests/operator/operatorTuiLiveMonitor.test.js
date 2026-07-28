'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MONITOR_SCHEMA,
  buildLoopEnvelopeFromRows,
  classifyMonitorPhase,
  classifyGuardExit,
  adaptLiveMonitor,
  formatLiveMonitorLines,
  buildLiveMonitorFromStatusResult,
} = require('../../modules/operator/operator-tui-live-monitor');
const { formatProvenanceField } = require('../../modules/operator/operator-tui-adapters');
const { buildShellModel, formatShellText } = require('../../modules/operator/operator-tui-shell-model');
const { executeShellAction } = require('../../modules/operator/operator-tui-shell-actions');
const { runOperatorTuiShell, TUI_SHELL_REASON } = require('../../modules/operator/operator-tui-shell-entry');

function envelopeFixture(overrides = {}) {
  return {
    schema: MONITOR_SCHEMA,
    kind: 'loop_envelope',
    goal_summary: 'ship honest monitor',
    current_iteration: 1,
    max_iterations: 3,
    current_phase: 'DEV',
    latest_gate: null,
    latest_verdict: null,
    latest_blocker: null,
    retry_count: 0,
    retry_limit: undefined,
    measured_cost: 0,
    configured_budget: 'unlimited',
    elapsed: 1200,
    time_limit: undefined,
    terminal_stop_reason: null,
    human_action_required: false,
    outcome: 'complete',
    status_label: 'complete',
    failure_type: null,
    latest_event_summary: 'session_end outcome=done',
    blocker_history: [],
    attach_ready: true,
    has_session_start: true,
    has_session_end: true,
    ...overrides,
  };
}

test('absent vs zero vs unavailable vs not_configured remain distinct on monitor', () => {
  const zero = adaptLiveMonitor({
    loop_envelope: envelopeFixture({
      measured_cost: 0,
      current_iteration: 0,
      configured_budget: 'unlimited',
      time_limit: 'not_configured',
      elapsed: 'unavailable',
    }),
  });
  assert.equal(zero.loop.measured_cost.availability, 'available');
  assert.equal(zero.loop.measured_cost.value, 0);
  assert.equal(zero.loop.current_iteration.value, 0);
  assert.equal(zero.loop.configured_budget.availability, 'unlimited');
  assert.equal(zero.loop.time_limit.availability, 'not_configured');
  assert.equal(zero.loop.elapsed.availability, 'unavailable');
  assert.notEqual(formatProvenanceField(zero.loop.measured_cost), 'absent');
  assert.notEqual(formatProvenanceField(zero.loop.elapsed), '0');

  const absent = adaptLiveMonitor({
    loop_envelope: envelopeFixture({
      measured_cost: undefined,
      current_iteration: undefined,
      max_iterations: undefined,
      configured_budget: undefined,
    }),
  });
  assert.equal(absent.loop.measured_cost.availability, 'absent');
  assert.equal(absent.loop.current_iteration.availability, 'absent');
  assert.equal(absent.loop.max_iteration.availability, 'absent');
  assert.equal(absent.loop.configured_budget.availability, 'absent');
});

test('successful run → done / evidence_ready with loop fields', () => {
  const done = adaptLiveMonitor({
    loop_envelope: envelopeFixture({ attach_ready: false, outcome: 'complete' }),
  });
  assert.equal(done.monitor_phase, 'done');
  assert.equal(done.guard_class, 'none');
  assert.equal(done.progress_percent.availability, 'absent');

  const evidence = adaptLiveMonitor({
    loop_envelope: envelopeFixture({ attach_ready: true, outcome: 'complete' }),
  });
  assert.equal(evidence.monitor_phase, 'evidence_ready');
  const text = formatLiveMonitorLines(evidence).join('\n');
  assert.match(text, /monitor_phase: evidence_ready/);
  assert.match(text, /goal: ship honest monitor/);
  assert.match(text, /progress_percent: absent/);
});

test('failed run preserves outcome and does not invent progress', () => {
  const failed = adaptLiveMonitor({
    loop_envelope: envelopeFixture({
      outcome: 'failed',
      status_label: 'failed',
      attach_ready: false,
      terminal_stop_reason: 'CONTRACT_OR_DECIDE_FAILURE',
    }),
  });
  assert.equal(failed.monitor_phase, 'failed');
  assert.equal(failed.progress_percent.availability, 'absent');
});

test('blocked run surfaces CERBERUS reason and human action', () => {
  const blocked = adaptLiveMonitor({
    loop_envelope: envelopeFixture({
      outcome: 'blocked',
      status_label: 'blocked',
      latest_blocker: 'CERBERUS_BLOCKERS_ITERATE',
      human_action_required: true,
      attach_ready: false,
      blocker_history: [{ reason_code: 'CERBERUS_BLOCKERS_ITERATE', count: 2 }],
    }),
  });
  assert.equal(blocked.monitor_phase, 'blocked');
  assert.equal(blocked.guard_class, 'cerberus_block');
  assert.equal(blocked.guard_visually_distinct, true);
  assert.equal(blocked.loop.human_action_required.value, true);
  assert.equal(blocked.blocker_history[0].count, 2);
  assert.match(formatLiveMonitorLines(blocked).join('\n'), /GUARD_EXIT/);
});

test('exhausted run is visually distinct from generic failure', () => {
  const exhausted = adaptLiveMonitor({
    loop_envelope: envelopeFixture({
      outcome: 'failed',
      status_label: 'failed',
      current_iteration: 3,
      max_iterations: 3,
      terminal_stop_reason: 'MAX_ITERATIONS_LOOP_EXHAUSTED',
      failure_type: 'retry_exceeded',
      attach_ready: false,
    }),
  });
  assert.equal(exhausted.monitor_phase, 'exhausted');
  assert.equal(exhausted.guard_class, 'max_iterations');
  assert.equal(exhausted.guard_visually_distinct, true);
});

test('unavailable live state falls back honestly', () => {
  const empty = adaptLiveMonitor(null);
  assert.equal(empty.available, false);
  assert.equal(empty.monitor_phase, 'unavailable');
  assert.equal(empty.fallback_source, 'unavailable');
  assert.match(formatLiveMonitorLines(empty).join('\n'), /unavailable/);

  const statusOnly = adaptLiveMonitor({
    result_code: 'RUN_FOUND',
    json: {
      run_id: 'r1',
      status: 'complete',
      operator_trace_summary: { outcome: 'complete' },
      run_state_visibility: { current_phase: 'complete', blocking_reason_code: null },
    },
  });
  assert.equal(statusOnly.fallback_source, 'status');
  assert.equal(statusOnly.live_state.value, 'status_fallback');
  assert.ok(['done', 'evidence_ready'].includes(statusOnly.monitor_phase));
});

test('status-only running stays running with status_fallback (not unavailable)', () => {
  const statusOnlyRunning = adaptLiveMonitor({
    result_code: 'RUN_FOUND',
    json: {
      run_id: 'live-r1',
      status: 'running',
      operator_trace_summary: { outcome: 'unknown' },
      run_state_visibility: { current_phase: 'DEV', blocking_reason_code: null },
    },
  });
  assert.equal(statusOnlyRunning.available, true);
  assert.equal(statusOnlyRunning.live_state.value, 'status_fallback');
  assert.equal(statusOnlyRunning.fallback_source, 'status');
  assert.equal(statusOnlyRunning.monitor_phase, 'running');
  assert.notEqual(statusOnlyRunning.monitor_phase, 'unavailable');
});

test('intermediate failure_type cleared after later successful terminal', () => {
  const rows = [
    { event: 'session_start', task_id: 'recover', max_iterations: 5, ts_ms: 1, goal: 'recover' },
    {
      event: 'iteration_done',
      outcome: 'iterate',
      iteration: 0,
      failure_type: 'contract_mismatch',
      transition_reason: { type: 'CONTRACT_FAIL', reason_code: 'orchestrator_json' },
      ts_ms: 2,
    },
    {
      event: 'iteration_done',
      outcome: 'done',
      iteration: 1,
      ts_ms: 3,
    },
    {
      event: 'session_end',
      done: true,
      outcome: 'done',
      iterations: 2,
      ts_ms: 4,
    },
  ];
  const envelope = buildLoopEnvelopeFromRows(rows, {
    summary: { outcome: 'complete', current_phase: 'complete' },
    explain: { goal: 'recover', failure_type: 'contract_mismatch' },
    status_label: 'complete',
    run_state: { attach_action_available: true, current_phase: 'complete' },
  });
  assert.equal(envelope.failure_type, undefined);
  assert.ok(Array.isArray(envelope.historical_failure_types));
  assert.ok(envelope.historical_failure_types.includes('contract_mismatch'));
  assert.ok(envelope.blocker_history.some((b) => b.reason_code === 'orchestrator_json'));

  const monitor = adaptLiveMonitor({ loop_envelope: envelope });
  assert.equal(monitor.monitor_phase, 'evidence_ready');
  assert.equal(monitor.guard_class, 'none');
  assert.equal(monitor.guard_visually_distinct, false);
});

test('output-contract failure never stays visually running', () => {
  const midRunContract = adaptLiveMonitor({
    loop_envelope: envelopeFixture({
      outcome: 'unknown',
      status_label: 'running',
      has_session_end: false,
      has_session_start: true,
      latest_blocker: 'orchestrator_json',
      failure_type: 'contract_mismatch',
      attach_ready: false,
      current_phase: 'DEV',
    }),
  });
  assert.notEqual(midRunContract.monitor_phase, 'running');
  assert.equal(midRunContract.monitor_phase, 'failed');
  assert.equal(midRunContract.guard_class, 'output_contract');
});

test('repeated blockers remain visible across iterations', () => {
  const rows = [
    { event: 'session_start', task_id: 'rep', max_iterations: 5, ts_ms: 1, goal: 'fix blockers' },
    {
      event: 'iteration_done',
      outcome: 'iterate',
      iteration: 1,
      transition_reason: { type: 'GATE_BLOCK', reason_code: 'CERBERUS_BLOCKERS_ITERATE' },
      ts_ms: 2,
    },
    {
      event: 'iteration_done',
      outcome: 'iterate',
      iteration: 2,
      transition_reason: { type: 'GATE_BLOCK', reason_code: 'CERBERUS_BLOCKERS_ITERATE' },
      ts_ms: 3,
    },
    {
      event: 'session_end',
      done: false,
      iterations: 2,
      gate_blocks: 2,
      ts_ms: 4,
    },
  ];
  const envelope = buildLoopEnvelopeFromRows(rows, {
    summary: {
      outcome: 'blocked',
      current_phase: 'cerberus',
      blocking_reason_code: 'CERBERUS_BLOCKERS_ITERATE',
      cerberus: { verdict: 'request_changes' },
    },
    explain: { goal: 'fix blockers', retries: 2 },
    status_label: 'blocked',
  });
  assert.equal(envelope.blocker_history[0].reason_code, 'CERBERUS_BLOCKERS_ITERATE');
  assert.ok(envelope.blocker_history[0].count >= 2);
  const monitor = adaptLiveMonitor({ loop_envelope: envelope });
  assert.match(formatLiveMonitorLines(monitor).join('\n'), /CERBERUS_BLOCKERS_ITERATE ×/);
});

test('cost-limit display: configured vs absent budget', () => {
  const withCost = adaptLiveMonitor({
    loop_envelope: envelopeFixture({
      measured_cost: 1.25,
      configured_budget: 5,
      terminal_stop_reason: 'GUARD_COST_LIMIT',
      failure_type: 'cost_abort',
      outcome: 'failed',
      attach_ready: false,
    }),
  });
  assert.equal(withCost.loop.measured_cost.value, 1.25);
  assert.equal(withCost.loop.configured_budget.value, 5);
  assert.equal(withCost.guard_class, 'cost_abort');

  const noBudget = adaptLiveMonitor({
    loop_envelope: envelopeFixture({
      measured_cost: 0,
      configured_budget: undefined,
      outcome: 'complete',
    }),
  });
  assert.equal(noBudget.loop.configured_budget.availability, 'absent');
  assert.equal(noBudget.loop.measured_cost.value, 0);
});

test('classifyMonitorPhase covers planning / verifying / iterating / cancelled', () => {
  assert.equal(classifyMonitorPhase({
    has_session_start: true,
    has_session_end: false,
    current_phase: 'OWNER',
  }), 'planning');
  assert.equal(classifyMonitorPhase({
    has_session_start: true,
    has_session_end: false,
    current_phase: 'QA',
  }), 'verifying');
  assert.equal(classifyMonitorPhase({
    has_session_start: true,
    has_session_end: false,
    retry_count: 2,
    latest_blocker: 'GATE_ARTIFACT_OR_HANDOFF',
  }), 'iterating');
  assert.equal(classifyMonitorPhase({
    outcome: 'cancelled',
    terminal_stop_reason: 'RUN_CANCELLED',
  }), 'cancelled');
});

test('classifyGuardExit preserves stable reason codes', () => {
  assert.equal(classifyGuardExit({
    terminal_stop_reason: 'GUARD_COST_LIMIT',
    failure_type: 'cost_abort',
  }).guard_class, 'cost_abort');
  assert.equal(classifyGuardExit({
    terminal_stop_reason: 'GUARD_STEP_RETRY_LIMIT',
    failure_type: 'retry_exceeded',
  }).guard_class, 'retry_exhausted');
  assert.equal(classifyGuardExit({
    failure_type: 'timeout',
    latest_blocker: 'TIMEOUT',
  }).guard_class, 'timeout');
  assert.equal(classifyGuardExit({
    terminal_stop_reason: 'RUN_CANCELLED',
  }).guard_class, 'cancelled');
});

test('shell model monitor surface + disclaimer honesty', () => {
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    monitorSource: { loop_envelope: envelopeFixture() },
    contentSurface: 'lifecycle',
    columns: 100,
  });
  assert.equal(model.contentSurface, 'monitor');
  assert.equal(model.monitor.monitor_phase, 'evidence_ready');
  const text = formatShellText(model);
  assert.match(text, /monitor_phase: evidence_ready/);
  assert.match(text, /operator modules remain authoritative/i);
  assert.match(text, /slash commands/i);
  assert.doesNotMatch(text, /Not claimed:.*slash commands/i);
  assert.doesNotMatch(text, /Not claimed:.*guided launcher/i);
  assert.doesNotMatch(text, /Not claimed:.*live run monitor/i);
  assert.doesNotMatch(text, /progress=\d+%/i);
});

test('monitor action loads status snapshot without inventing success', async () => {
  const result = await executeShellAction({
    actionId: 'monitor',
    selectedRunId: 'ok-run',
    question: async () => '',
    write: () => {},
    runStatus: () => ({
      ok: true,
      exitCode: 0,
      result_code: 'RUN_FOUND',
      json: {
        run_id: 'ok-run',
        status: 'complete',
        operator_trace_summary: { outcome: 'complete' },
        run_state_visibility: {
          current_phase: 'complete',
          blocking_reason_code: null,
          attach_action_available: true,
        },
        loop_envelope: envelopeFixture({
          outcome: 'complete',
          status_label: 'complete',
          attach_ready: true,
        }),
      },
      text: 'status ok',
    }),
  });
  assert.equal(result.contentSurface, 'monitor');
  assert.equal(result.actionResult.ok, true);
  assert.match(result.actionResult.text, /monitor_phase/);
});

test('quit / abort remains detach-safe (no success mutation claim)', async () => {
  let tracesMutated = false;
  const quit = await executeShellAction({
    actionId: 'quit',
    write: () => {},
  });
  assert.equal(quit.quit, true);
  assert.equal(quit.actionResult.reason_code, 'TUI_SHELL_QUIT');

  const abort = await runOperatorTuiShell({
    isTTY: true,
    loadRuns: () => ({ ok: true, runs: [], result_code: 'RUNS_EMPTY', json: { runs: [] } }),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async (opts) => {
        if (typeof opts.onRequestAction === 'function') {
          // Simulate Ctrl+C abort path via aborted flag without action.
        }
        return { aborted: true };
      },
    }),
    executeAction: async () => {
      tracesMutated = true;
      throw new Error('must not execute on abort');
    },
  });
  assert.equal(abort.reason_code, TUI_SHELL_REASON.ABORT);
  assert.equal(tracesMutated, false);
  assert.equal(abort.ok, true);
});

test('buildLiveMonitorFromStatusResult handles missing json', () => {
  const missing = buildLiveMonitorFromStatusResult({
    ok: false,
    reason_code: 'OPERATOR_TRACE_NOT_FOUND',
  });
  assert.equal(missing.available, false);
  assert.equal(missing.monitor_phase, 'unavailable');
});
