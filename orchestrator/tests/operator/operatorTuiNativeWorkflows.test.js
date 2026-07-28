'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSelectState,
  moveSelectCursor,
  resolveSelectKeypress,
  formatSelectLines,
} = require('../../modules/operator/operator-tui-select-controller');
const {
  createLauncherWorkflow,
  applyLauncherWorkflowKeypress,
  formatLauncherWorkflowLines,
  completeFixtureLoad,
  LAUNCHER_WORKFLOW_KIND,
} = require('../../modules/operator/operator-tui-launcher-workflow');
const {
  createRunBrowserWorkflow,
  applyRunBrowserWorkflowKeypress,
  formatRunBrowserWorkflowLines,
} = require('../../modules/operator/operator-tui-run-browser-workflow');
const {
  isNativeWorkflowAction,
  openNativeWorkflow,
  surfaceForWorkflow,
  createAsyncTransitionGate,
  NATIVE_LAUNCHER_EXECUTE_ACTION,
} = require('../../modules/operator/operator-tui-native-workflows');
const {
  buildShellModel,
  resolveShellKeypress,
} = require('../../modules/operator/operator-tui-shell-model');
const { LAUNCHER_REASON, CANONICAL_FIXTURE_OPTIONS } = require('../../modules/operator/operator-guided-launcher-model');

describe('operator-tui-select-controller', () => {
  it('moves cursor with arrows and j/k', () => {
    const state = createSelectState([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]);
    assert.equal(moveSelectCursor(state, 'next').cursorIndex, 1);
    assert.equal(moveSelectCursor(state, 'prev').cursorIndex, 2);
    const down = resolveSelectKeypress('', { downArrow: true }, state);
    assert.equal(down.type, 'move');
    assert.equal(down.state.cursorIndex, 1);
    const up = resolveSelectKeypress('k', {}, state);
    assert.equal(up.type, 'move');
    assert.equal(up.state.cursorIndex, 2);
  });

  it('confirms enabled choice and reports disabled', () => {
    const state = createSelectState([
      { id: 'ok', label: 'OK' },
      { id: 'no', label: 'NO', disabled: true, reason_code: 'X' },
    ], { cursorIndex: 1 });
    const disabled = resolveSelectKeypress('', { return: true }, state);
    assert.equal(disabled.type, 'disabled');
    assert.equal(disabled.option.reason_code, 'X');
    const enabled = resolveSelectKeypress('', { return: true }, { ...state, cursorIndex: 0 });
    assert.equal(enabled.type, 'confirm');
    assert.equal(enabled.option.id, 'ok');
  });

  it('cancels on Esc', () => {
    const state = createSelectState([{ id: 'a', label: 'A' }]);
    assert.equal(resolveSelectKeypress('', { escape: true }, state).type, 'cancel');
  });

  it('formats disabled reason codes inline', () => {
    const state = createSelectState([
      { id: 'h', label: 'hybrid', disabled: true, reason_code: 'MATRIX_SKIP_HYBRID_UNSUPPORTED' },
    ]);
    const text = formatSelectLines(state).join('\n');
    assert.match(text, /MATRIX_SKIP_HYBRID_UNSUPPORTED/);
    assert.match(text, /disabled/);
  });
});

describe('operator-tui-launcher-workflow', () => {
  it('navigates agent → lane → gate → goal → preview without remount markers', async () => {
    let wf = createLauncherWorkflow();
    assert.equal(wf.kind, LAUNCHER_WORKFLOW_KIND);
    assert.equal(wf.step, 'agent_flow');

    let r = await applyLauncherWorkflowKeypress(wf, '', { return: true });
    assert.equal(r.action, 'update');
    wf = r.workflow;
    assert.equal(wf.step, 'inference_lane');

    r = await applyLauncherWorkflowKeypress(wf, '', { return: true });
    wf = r.workflow;
    assert.equal(wf.step, 'gate_posture');

    r = await applyLauncherWorkflowKeypress(wf, '', { return: true });
    wf = r.workflow;
    assert.equal(wf.step, 'goal_source');

    r = await applyLauncherWorkflowKeypress(wf, '', { return: true });
    wf = r.workflow;
    assert.equal(wf.step, 'preview');
    assert.ok(Array.isArray(wf.previewLines) && wf.previewLines.length > 0);

    const lines = formatLauncherWorkflowLines(wf).join('\n');
    assert.match(lines, /Pre-launch execution summary/);
    assert.doesNotMatch(lines, /nested readline/);
  });

  it('surfaces hybrid skip with authoritative reason code', async () => {
    let wf = createLauncherWorkflow();
    // agent
    wf = (await applyLauncherWorkflowKeypress(wf, '', { return: true })).workflow;
    // move to hybrid (index 2)
    wf = (await applyLauncherWorkflowKeypress(wf, '', { downArrow: true })).workflow;
    wf = (await applyLauncherWorkflowKeypress(wf, '', { downArrow: true })).workflow;
    const blocked = await applyLauncherWorkflowKeypress(wf, '', { return: true });
    assert.equal(blocked.action, 'blocked');
    assert.equal(blocked.reason_code, LAUNCHER_REASON.HYBRID_UNSUPPORTED);
    assert.equal(blocked.workflow.blockedReasonCode, LAUNCHER_REASON.HYBRID_UNSUPPORTED);
    assert.match(formatLauncherWorkflowLines(blocked.workflow).join('\n'), /MATRIX_SKIP_HYBRID_UNSUPPORTED/);
  });

  it('Esc from first step cancels', async () => {
    const wf = createLauncherWorkflow();
    const r = await applyLauncherWorkflowKeypress(wf, '', { escape: true });
    assert.equal(r.action, 'cancel');
  });

  it('confirm launch returns execute selections', async () => {
    let wf = createLauncherWorkflow();
    for (let i = 0; i < 4; i += 1) {
      wf = (await applyLauncherWorkflowKeypress(wf, '', { return: true })).workflow;
    }
    assert.equal(wf.step, 'preview');
    wf = (await applyLauncherWorkflowKeypress(wf, '', { return: true })).workflow;
    assert.equal(wf.step, 'confirm');
    const exec = await applyLauncherWorkflowKeypress(wf, '', { return: true });
    assert.equal(exec.action, 'execute');
    assert.equal(exec.selections.confirm, true);
    assert.equal(exec.selections.agentFlow, 'single_agent');
    assert.equal(exec.selections.inferenceLane, 'local_only');
  });

  it('types custom goal including q key-by-key without quitting', async () => {
    let wf = createLauncherWorkflow();
    // agent → lane → gate → goal_source
    for (let i = 0; i < 3; i += 1) {
      wf = (await applyLauncherWorkflowKeypress(wf, '', { return: true })).workflow;
    }
    // move to custom (index 2)
    wf = (await applyLauncherWorkflowKeypress(wf, '', { downArrow: true })).workflow;
    wf = (await applyLauncherWorkflowKeypress(wf, '', { downArrow: true })).workflow;
    wf = (await applyLauncherWorkflowKeypress(wf, '', { return: true })).workflow;
    assert.equal(wf.step, 'custom_goal');

    const model = buildShellModel({
      activeWorkflow: wf,
      contentSurface: 'launcher_workflow',
      focus: 'content',
    });
    const goal = 'quality gate check';
    for (const ch of goal) {
      const intent = resolveShellKeypress(ch, {}, model);
      assert.equal(intent.type, 'workflow_key', `char ${JSON.stringify(ch)} must route to workflow`);
      assert.equal(intent.endsSession, false);
      const r = await applyLauncherWorkflowKeypress(wf, ch, {});
      assert.equal(r.action, 'update');
      wf = r.workflow;
      model.activeWorkflow = wf;
    }
    assert.equal(wf.textBuffer, goal);
    assert.match(formatLauncherWorkflowLines(wf).join('\n'), /quality gate check/);
  });

  it('discards stale fixture load after Esc (no preview/execute handoff)', async () => {
    let resolveLoad;
    const deferred = new Promise((resolve) => {
      resolveLoad = resolve;
    });
    const gate = createAsyncTransitionGate();

    let wf = createLauncherWorkflow();
    for (let i = 0; i < 3; i += 1) {
      wf = (await applyLauncherWorkflowKeypress(wf, '', { return: true })).workflow;
    }
    // goal_source → fixture
    wf = (await applyLauncherWorkflowKeypress(wf, '', { downArrow: true })).workflow;
    wf = (await applyLauncherWorkflowKeypress(wf, '', { return: true })).workflow;
    assert.equal(wf.step, 'fixture');
    assert.ok(CANONICAL_FIXTURE_OPTIONS.length > 0);

    const token = gate.begin();
    const busy = await applyLauncherWorkflowKeypress(wf, '', { return: true }, {
      deferFixtureLoad: true,
      loadFixturePrompt: async () => deferred,
    });
    assert.equal(busy.action, 'busy');
    assert.equal(busy.workflow.busy, true);
    assert.equal(busy.pending.type, 'fixture_load');
    assert.match(formatLauncherWorkflowLines(busy.workflow).join('\n'), /Loading fixture/);

    // Incompatible keys ignored while busy
    const ignored = await applyLauncherWorkflowKeypress(busy.workflow, '', { return: true });
    assert.equal(ignored.action, 'ignore');

    // Esc cancels and invalidates the in-flight load
    gate.invalidate();
    const back = await applyLauncherWorkflowKeypress(busy.workflow, '', { escape: true });
    assert.equal(back.action, 'update');
    assert.equal(back.workflow.step, 'goal_source');
    assert.equal(back.workflow.busy, false);
    assert.equal(gate.isCurrent(token), false);

    // Stale loader resolves — must not be applied when gate rejects the token
    resolveLoad('STALE_FIXTURE_GOAL_SHOULD_NOT_APPLY');
    await deferred;
    assert.equal(gate.isCurrent(token), false);
    // Simulate ShellApp discard: only complete when token current
    let executed = false;
    let previewed = false;
    if (gate.isCurrent(token)) {
      const completed = completeFixtureLoad(busy.workflow, 'STALE_FIXTURE_GOAL_SHOULD_NOT_APPLY', {});
      previewed = completed.workflow.step === 'preview';
      executed = completed.action === 'execute';
    }
    assert.equal(previewed, false);
    assert.equal(executed, false);
    assert.equal(back.workflow.step, 'goal_source');
  });
});

describe('operator-tui-run-browser-workflow', () => {
  it('handles empty runs', () => {
    const wf = createRunBrowserWorkflow({ runs: [] });
    assert.equal(wf.step, 'empty');
    const emptyText = formatRunBrowserWorkflowLines(wf).join('\n');
    assert.match(emptyText, /none/);
    assert.match(emptyText, /Startup snapshot/);
    assert.match(emptyText, /refreshes on remount\/refresh/);
    assert.equal(applyRunBrowserWorkflowKeypress(wf, '', { escape: true }).action, 'cancel');
  });

  it('selects a run into overview and preserves selection on back', () => {
    const runs = [
      { run_id: 'run-a', status: 'done', outcome: 'pass', result_code: 'OK', trace_file: null },
      { run_id: 'run-b', status: 'failed', outcome: 'fail', result_code: 'X', trace_file: null },
    ];
    const wf = createRunBrowserWorkflow({ runs });
    assert.equal(wf.step, 'browse');
    const listText = formatRunBrowserWorkflowLines(wf).join('\n');
    assert.match(listText, /Startup snapshot/);
    assert.match(listText, /refreshes on remount\/refresh/);
    const selected = applyRunBrowserWorkflowKeypress(wf, '', { return: true }, {
      loadPane: (entry) => ({
        ok: false,
        run_id: entry.run_id,
        result_code: 'RUN_TRACE_INVALID',
        pane: {
          run_id: entry.run_id,
          result_code: 'RUN_TRACE_INVALID',
          reason_code: 'OPERATOR_TRACE_INVALID',
          status: 'invalid',
          outcome: null,
          next_safe_action: 'inspect',
        },
      }),
    });
    assert.equal(selected.action, 'selected');
    assert.equal(selected.selectedRunId, 'run-a');
    assert.equal(selected.workflow.step, 'overview');
    assert.match(formatRunBrowserWorkflowLines(selected.workflow).join('\n'), /RUN_TRACE_INVALID/);

    const back = applyRunBrowserWorkflowKeypress(selected.workflow, '', { escape: true });
    assert.equal(back.action, 'update');
    assert.equal(back.workflow.step, 'browse');
    assert.equal(back.selectedRunId, 'run-a');
  });
});

describe('native workflow shell bridge', () => {
  it('maps Phase-1 actions and surfaces', () => {
    assert.equal(isNativeWorkflowAction('launcher'), true);
    assert.equal(isNativeWorkflowAction('select'), true);
    assert.equal(isNativeWorkflowAction('runs'), true);
    assert.equal(isNativeWorkflowAction('evidence'), false);
    assert.equal(NATIVE_LAUNCHER_EXECUTE_ACTION.startsWith('__native_'), true);

    const model = buildShellModel({
      runsPayload: { runs: [{ run_id: 'r1', status: 'done' }], result_code: 'OK' },
      contentSurface: 'home',
      focus: 'nav',
    });
    const launcher = openNativeWorkflow(model, 'launcher');
    assert.equal(launcher.kind, 'launcher');
    assert.equal(surfaceForWorkflow(launcher), 'launcher_workflow');
    const browser = openNativeWorkflow(model, 'select');
    assert.equal(browser.kind, 'run_browser');
    assert.equal(surfaceForWorkflow(browser), 'run_browser');
  });

  it('run browser opens from startup snapshot (does not re-discover)', () => {
    const snapshotRuns = [
      { run_id: 'snap-1', status: 'done', outcome: 'pass' },
      { run_id: 'snap-2', status: 'failed', outcome: 'fail' },
    ];
    const model = buildShellModel({
      runsPayload: { runs: snapshotRuns, result_code: 'OK', next_safe_action: 'inspect' },
      selectedRunId: 'snap-2',
      contentSurface: 'home',
      focus: 'nav',
    });
    const browser = openNativeWorkflow(model, 'runs');
    assert.equal(browser.kind, 'run_browser');
    assert.equal(browser.runs.length, 2);
    assert.equal(browser.runs[0].run_id, 'snap-1');
    assert.equal(browser.select.cursorIndex, 1);
    // openNativeWorkflow only reads model.runs at call time (startup snapshot contract).
    const again = openNativeWorkflow(
      buildShellModel({
        runsPayload: { runs: snapshotRuns, result_code: 'OK' },
        contentSurface: 'home',
      }),
      'select',
    );
    assert.equal(again.runs.length, 2);
    assert.deepEqual(
      again.runs.map((r) => r.run_id),
      ['snap-1', 'snap-2'],
    );
  });

  it('routes Esc to workflow; q quits outside custom_goal; Ctrl+C always aborts', () => {
    const model = buildShellModel({
      activeWorkflow: createLauncherWorkflow(),
      contentSurface: 'launcher_workflow',
      focus: 'content',
    });
    const esc = resolveShellKeypress('', { escape: true }, model);
    assert.equal(esc.type, 'workflow_key');
    assert.equal(esc.endsSession, false);
    const quit = resolveShellKeypress('q', {}, model);
    assert.equal(quit.type, 'quit');
    assert.equal(quit.endsSession, true);
    const abort = resolveShellKeypress('c', { ctrl: true }, model);
    assert.equal(abort.type, 'abort');
    assert.equal(abort.endsSession, true);
  });

  it('quit-path: q ends session when workflow is not in custom_goal text entry', () => {
    const model = buildShellModel({
      activeWorkflow: createLauncherWorkflow(),
      contentSurface: 'launcher_workflow',
      focus: 'content',
    });
    assert.equal(model.activeWorkflow.step, 'agent_flow');
    const quit = resolveShellKeypress('q', {}, model);
    assert.equal(quit.type, 'quit');
    assert.equal(quit.actionId, 'quit');
    assert.equal(quit.endsSession, true);
  });
});
