'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TUI_ACTION_STATUS,
  TUI_ACTION_KIND,
  TUI_ACTION_REASON,
  buildPendingOperatorAction,
  mapShellActionToActionKind,
  createTuiActionExecutor,
} = require('../../modules/operator/operator-tui-action-executor');
const { buildShellModel } = require('../../modules/operator/operator-tui-shell-model');
const { NATIVE_LAUNCHER_EXECUTE_ACTION } = require('../../modules/operator/operator-tui-native-workflows');

test('buildPendingOperatorAction exposes operator-facing label', () => {
  const pending = buildPendingOperatorAction('attach');
  assert.equal(pending.action_kind, TUI_ACTION_KIND.ATTACH_GENERATION);
  assert.match(pending.label, /Attaching generation/i);
});

test('buildShellModel footer shows pending operator action', () => {
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [], result_code: 'OK', next_safe_action: null },
    pendingOperatorAction: buildPendingOperatorAction('status'),
    columns: 80,
    rows: 40,
  });
  assert.match(model.footerHints, /Refreshing status/i);
  assert.match(model.footerHints, /action in progress/i);
});

test('mapShellActionToActionKind maps nested operator actions', () => {
  assert.equal(mapShellActionToActionKind(NATIVE_LAUNCHER_EXECUTE_ACTION), TUI_ACTION_KIND.START_RUN);
  assert.equal(mapShellActionToActionKind('attach'), TUI_ACTION_KIND.ATTACH_GENERATION);
  assert.equal(mapShellActionToActionKind('status'), TUI_ACTION_KIND.STATUS_REFRESH);
  assert.equal(mapShellActionToActionKind('explain'), TUI_ACTION_KIND.STATUS_REFRESH);
  assert.equal(mapShellActionToActionKind('monitor'), TUI_ACTION_KIND.MONITOR_REFRESH);
});

test('serialize policy rejects duplicate START_RUN while pending', () => {
  const executor = createTuiActionExecutor({ createId: () => 'req-1' });
  const first = executor.beginRequest({
    actionKind: TUI_ACTION_KIND.START_RUN,
    context: { runId: null, surface: 'launcher_workflow' },
  });
  assert.equal(first.accepted, true);
  const dup = executor.beginRequest({
    actionKind: TUI_ACTION_KIND.START_RUN,
    context: { runId: null, surface: 'launcher_workflow' },
  });
  assert.equal(dup.accepted, false);
  assert.equal(dup.reason_code, TUI_ACTION_REASON.DUPLICATE_REJECTED);
  assert.equal(dup.duplicate_of, 'req-1');
});

test('serialize policy rejects duplicate attach per run', () => {
  const executor = createTuiActionExecutor();
  assert.equal(executor.beginRequest({
    actionKind: TUI_ACTION_KIND.ATTACH_GENERATION,
    context: { runId: 'run-a', surface: 'home' },
  }).accepted, true);
  const dup = executor.beginRequest({
    actionKind: TUI_ACTION_KIND.ATTACH_GENERATION,
    context: { runId: 'run-a', surface: 'home' },
  });
  assert.equal(dup.accepted, false);
  assert.equal(executor.beginRequest({
    actionKind: TUI_ACTION_KIND.ATTACH_GENERATION,
    context: { runId: 'run-b', surface: 'home' },
  }).accepted, true);
});

test('latest-wins supersedes older pending STATUS_REFRESH for same run', () => {
  const executor = createTuiActionExecutor({
    createId: (() => {
      let n = 0;
      return () => `req-${++n}`;
    })(),
  });
  const first = executor.beginRequest({
    actionKind: TUI_ACTION_KIND.STATUS_REFRESH,
    context: { runId: 'run-a', surface: 'status' },
  });
  const second = executor.beginRequest({
    actionKind: TUI_ACTION_KIND.STATUS_REFRESH,
    context: { runId: 'run-a', surface: 'status' },
  });
  assert.equal(first.request.request_id, 'req-1');
  assert.equal(second.accepted, true);
  assert.equal(executor.getRequest('req-1').status, TUI_ACTION_STATUS.SUPERSEDED);
  assert.equal(executor.getRequest('req-2').status, TUI_ACTION_STATUS.PENDING);
});

test('noteContextChange supersedes pending read scoped to prior run', () => {
  const executor = createTuiActionExecutor({ createId: () => 'req-status' });
  executor.beginRequest({
    actionKind: TUI_ACTION_KIND.STATUS_REFRESH,
    context: { runId: 'run-a', surface: 'status' },
  });
  executor.noteContextChange({ runId: 'run-b', surface: 'status' });
  const gate = executor.shouldApplyResult('req-status', { runId: 'run-b', surface: 'status' });
  assert.equal(gate.apply, false);
  assert.equal(gate.reason_code, TUI_ACTION_REASON.STALE_CONTEXT);
  assert.equal(executor.getRequest('req-status').status, TUI_ACTION_STATUS.SUPERSEDED);
});

test('shouldApplyResult rejects completion after context switch (slow response race)', () => {
  const executor = createTuiActionExecutor({ createId: () => 'slow-req' });
  executor.beginRequest({
    actionKind: TUI_ACTION_KIND.STATUS_REFRESH,
    context: { runId: 'run-a', surface: 'status' },
  });
  executor.noteContextChange({ runId: 'run-b', surface: 'monitor' });
  const done = executor.completeRequest('slow-req', {
    status: TUI_ACTION_STATUS.SUCCESS,
    context: { runId: 'run-b', surface: 'monitor' },
  });
  assert.equal(done.applied, false);
  assert.equal(done.reason_code, TUI_ACTION_REASON.STALE_CONTEXT);
});

test('completeRequest clears serialize slot so a later request is accepted', () => {
  const executor = createTuiActionExecutor({
    createId: (() => {
      let n = 0;
      return () => `req-${++n}`;
    })(),
  });
  const first = executor.beginRequest({
    actionKind: TUI_ACTION_KIND.ATTACH_GENERATION,
    context: { runId: 'run-a', surface: 'home' },
  });
  executor.completeRequest(first.request.request_id, { status: TUI_ACTION_STATUS.SUCCESS });
  const second = executor.beginRequest({
    actionKind: TUI_ACTION_KIND.ATTACH_GENERATION,
    context: { runId: 'run-a', surface: 'home' },
  });
  assert.equal(second.accepted, true);
});

test('scheduleTimeout marks request timed_out without claiming runtime termination', () => {
  const timers = {
    handles: [],
    setTimeout(fn, ms) {
      const id = timers.handles.length + 1;
      timers.handles.push({ id, fn, ms });
      return id;
    },
    clearTimeout() {},
  };
  const executor = createTuiActionExecutor({ createId: () => 'timed-req' });
  executor.beginRequest({
    actionKind: TUI_ACTION_KIND.STATUS_REFRESH,
    context: { runId: 'run-a', surface: 'status' },
  });
  executor.scheduleTimeout('timed-req', 50, timers);
  assert.equal(timers.handles.length, 1);
  timers.handles[0].fn();
  const req = executor.getRequest('timed-req');
  assert.equal(req.status, TUI_ACTION_STATUS.TIMED_OUT);
  assert.equal(req.reason_code, TUI_ACTION_REASON.TIMED_OUT);
});

test('cancelRequest aborts signal and marks cancelled', () => {
  if (typeof AbortController !== 'function') return;
  const executor = createTuiActionExecutor({ createId: () => 'cancel-req' });
  const begun = executor.beginRequest({
    actionKind: TUI_ACTION_KIND.ATTACH_GENERATION,
    context: { runId: 'run-a', surface: 'home' },
  });
  const signal = begun.request.abortController.signal;
  const cancelled = executor.cancelRequest('cancel-req');
  assert.equal(cancelled.ok, true);
  assert.equal(signal.aborted, true);
  assert.equal(executor.getRequest('cancel-req').status, TUI_ACTION_STATUS.CANCELLED);
});

test('deferred completion applies only when request still current', async () => {
  const executor = createTuiActionExecutor({
    createId: (() => {
      let n = 0;
      return () => `req-${++n}`;
    })(),
  });
  const first = executor.beginRequest({
    actionKind: TUI_ACTION_KIND.STATUS_REFRESH,
    context: { runId: 'run-a', surface: 'status' },
  });
  let resolveSlow;
  const slow = new Promise((resolve) => {
    resolveSlow = resolve;
  });
  executor.noteContextChange({ runId: 'run-b', surface: 'monitor' });
  resolveSlow('payload');
  await slow;
  const applied = executor.completeRequest(first.request.request_id, {
    status: TUI_ACTION_STATUS.SUCCESS,
    context: { runId: 'run-b', surface: 'monitor' },
  });
  assert.equal(applied.applied, false);
});
