'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildShellModel,
  shellModelToOptions,
  isInkLocalRemountFallbackAction,
} = require('../../modules/operator/operator-tui-shell-model');
const {
  classifyShellActionEffect,
  normalizeInkLocalActionToken,
  selectedNavIdForSurface,
  buildInkLocalSurfaceTransition,
  applyInkLocalSurfaceTransition,
  buildNativeWorkflowTransition,
  applyNativeWorkflowTransition,
  buildSlashMessageTransition,
  resolveShellActionEffect,
  requiresNestedExecute,
  shouldHandleLeakedInkLocalAction,
} = require('../../modules/operator/operator-tui-shell-controller');
const { resolveSlashCommandPlan } = require('../../modules/operator/operator-tui-shell-actions');

function baseModel(overrides = {}) {
  return buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: {
      ok: true,
      exitCode: 0,
      result_code: 'RUNS_EMPTY',
      next_safe_action: 'none',
      json: { result_code: 'RUNS_EMPTY', runs: [], next_safe_action: 'none' },
    },
    contentSurface: 'home',
    selectedNavId: 'launcher',
    ...overrides,
  });
}

test('classifyShellActionEffect partitions session-end, ink-local, nested', () => {
  assert.equal(classifyShellActionEffect('q'), 'session_end');
  assert.equal(classifyShellActionEffect('help'), 'ink_local');
  assert.equal(classifyShellActionEffect('attach'), 'nested');
});

test('normalizeInkLocalActionToken maps /doctor to config', () => {
  assert.equal(normalizeInkLocalActionToken('/doctor'), 'config');
});

test('requiresNestedExecute covers attach/status/explain only', () => {
  assert.equal(requiresNestedExecute('attach'), true);
  assert.equal(requiresNestedExecute('status'), true);
  assert.equal(requiresNestedExecute('config'), false);
  assert.equal(requiresNestedExecute('evidence'), false);
});

test('resolveShellActionEffect routes /doctor slash to ink-local config', () => {
  const model = baseModel();
  const slashPlan = resolveSlashCommandPlan('/doctor', { selectedRunId: null });
  const effect = resolveShellActionEffect(model, '/doctor', { slashPlan });
  assert.equal(effect.kind, 'ink_local');
  assert.equal(effect.transition?.contentSurface, 'config');
});

test('resolveShellActionEffect routes /status slash to nested_execute', () => {
  const model = baseModel({ selectedRunId: 'run-1' });
  const slashPlan = resolveSlashCommandPlan('/status', { selectedRunId: 'run-1' });
  const effect = resolveShellActionEffect(model, '/status', { slashPlan });
  assert.equal(effect.kind, 'nested_execute');
  assert.equal(effect.actionId, 'status');
  assert.equal(effect.skipRunPrompt, true);
});

test('applyNativeWorkflowTransition opens launcher without remount fields', () => {
  const model = baseModel();
  const next = applyNativeWorkflowTransition(model, 'launcher');
  assert.ok(next);
  assert.equal(next.contentSurface, 'launcher_workflow');
  assert.ok(next.activeWorkflow);
  assert.equal(next.focus, 'content');
});

test('buildSlashMessageTransition keeps slash help in action_result surface', () => {
  const model = baseModel();
  const slashPlan = resolveSlashCommandPlan('/help', { selectedRunId: null });
  const next = buildSlashMessageTransition(model, slashPlan);
  assert.equal(next.contentSurface, 'action_result');
  assert.equal(next.actionResult.reason_code, 'TUI_SLASH_HELP');
});

test('buildNativeWorkflowTransition returns null for attach', () => {
  const model = baseModel();
  assert.equal(buildNativeWorkflowTransition(model, 'attach'), null);
});

test('normalizeInkLocalActionToken maps slash and bare tokens', () => {
  assert.equal(normalizeInkLocalActionToken('/home'), 'home');
  assert.equal(normalizeInkLocalActionToken('/diagnostics'), 'diagnostics');
  assert.equal(normalizeInkLocalActionToken('?'), 'help');
  assert.equal(normalizeInkLocalActionToken('/help'), 'help');
  assert.equal(normalizeInkLocalActionToken('status'), 'status');
});

test('selectedNavIdForSurface maps diagnostics, config, monitor', () => {
  assert.equal(selectedNavIdForSurface('diagnostics'), 'diagnostics');
  assert.equal(selectedNavIdForSurface('config'), 'config');
  assert.equal(selectedNavIdForSurface('monitor'), 'monitor');
  assert.equal(selectedNavIdForSurface('home'), 'home');
});

test('buildInkLocalSurfaceTransition returns null for nested actions', () => {
  const model = baseModel();
  assert.equal(buildInkLocalSurfaceTransition(model, 'attach'), null);
  assert.equal(buildInkLocalSurfaceTransition(model, 'runs'), null);
});

test('applyInkLocalSurfaceTransition switches home/help/diagnostics without unmount fields', () => {
  const model = baseModel({
    contentSurface: 'help',
    selectedNavId: 'help',
    helpSelectedTopicId: 'overview',
    helpOpenTopicId: 'overview',
    commandInput: 'x',
    activeWorkflow: { id: 'runs' },
  });
  const next = applyInkLocalSurfaceTransition(model, 'home');
  assert.ok(next);
  assert.equal(next.contentSurface, 'home');
  assert.equal(next.selectedNavId, 'home');
  assert.equal(next.focus, 'nav');
  assert.equal(next.commandInput, '');
  assert.equal(next.activeWorkflow, null);
  assert.equal(next.helpOpenTopicId, 'overview');
});

test('help transition clears open topic and preserves selected topic', () => {
  const model = baseModel({
    contentSurface: 'home',
    helpSelectedTopicId: 'monitor',
    helpOpenTopicId: 'monitor',
  });
  const next = applyInkLocalSurfaceTransition(model, '/help');
  assert.ok(next);
  assert.equal(next.contentSurface, 'help');
  assert.equal(next.helpOpenTopicId, null);
  assert.equal(next.helpSelectedTopicId, 'monitor');
});

test('config transition seeds configModel from shell home snapshot', () => {
  const model = baseModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    credentials: { credential_sufficiency: 'not_required', providers: [{ id: 'ollama' }] },
    pathActivation: { status: 'ready', on_path: true },
  });
  const next = applyInkLocalSurfaceTransition(model, 'settings');
  assert.ok(next);
  assert.equal(next.contentSurface, 'config');
  assert.equal(next.selectedNavId, 'config');
  assert.equal(next.config?.snapshot_ok, true);
  assert.equal(next.config?.doctor_status, 'not_run');
});

test('status transition seeds from selected run when authoritative snapshot missing', () => {
  const model = baseModel({
    selectedRunId: 'run-1',
    runsPayload: {
      ok: true,
      exitCode: 0,
      result_code: 'RUNS_FOUND',
      next_safe_action: 'none',
      json: {
        result_code: 'RUNS_FOUND',
        runs: [{ run_id: 'run-1', status: 'running', outcome: 'running' }],
        next_safe_action: 'none',
      },
    },
  });
  const next = applyInkLocalSurfaceTransition(model, 'status');
  assert.ok(next);
  assert.equal(next.contentSurface, 'status');
  assert.equal(next.status?.run_id, 'run-1');
  assert.equal(next.status?.status, 'running');
});

test('status transition keeps authoritative snapshot for selected run', () => {
  const model = baseModel({
    selectedRunId: 'run-1',
    statusResult: {
      result_code: 'STATUS_OK',
      json: {
        run_id: 'run-1',
        status: 'complete',
        operator_trace_summary: { outcome: null, next_safe_action: null },
        run_state_visibility: { blocking_reason_code: null },
      },
    },
  });
  const opts = buildInkLocalSurfaceTransition(model, 'overview');
  assert.ok(opts);
  assert.equal(opts.contentSurface, 'status');
  assert.equal(opts.statusResult?.result_code, 'STATUS_OK');
  assert.equal(opts.statusResult?.json?.run_id, 'run-1');
});

test('monitor transition seeds monitorSource from status snapshot', () => {
  const model = baseModel({
    selectedRunId: 'run-1',
    runsPayload: {
      ok: true,
      exitCode: 0,
      result_code: 'RUNS_FOUND',
      next_safe_action: 'none',
      json: {
        result_code: 'RUNS_FOUND',
        runs: [{ run_id: 'run-1', status: 'running', outcome: 'running' }],
        next_safe_action: 'none',
      },
    },
  });
  const next = applyInkLocalSurfaceTransition(model, 'monitor');
  assert.ok(next);
  assert.equal(next.contentSurface, 'monitor');
  assert.equal(next.selectedNavId, 'monitor');
  assert.equal(next.monitorSource?.run_id, 'run-1');
});

test('shouldHandleLeakedInkLocalAction covers remount fallback and other ink-local ids', () => {
  assert.equal(shouldHandleLeakedInkLocalAction('help'), true);
  assert.equal(shouldHandleLeakedInkLocalAction('/diagnostics'), true);
  assert.equal(shouldHandleLeakedInkLocalAction('status'), true);
  assert.equal(shouldHandleLeakedInkLocalAction('attach'), false);
  assert.equal(isInkLocalRemountFallbackAction('status'), false);
  assert.equal(shouldHandleLeakedInkLocalAction('status'), true);
});

test('applyInkLocalSurfaceTransition round-trips through shellModelToOptions', () => {
  const model = baseModel({ selectedRunId: 'run-1' });
  const next = applyInkLocalSurfaceTransition(model, 'diagnostics');
  assert.ok(next);
  const roundTrip = buildShellModel({
    ...shellModelToOptions(next),
    aboutInfo: {
      version: model.home.version,
      model_policy: model.home.model_policy,
    },
  });
  assert.equal(roundTrip.contentSurface, 'diagnostics');
  assert.equal(roundTrip.selectedNavId, 'diagnostics');
});
