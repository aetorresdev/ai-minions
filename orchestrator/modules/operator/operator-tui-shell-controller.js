'use strict';

const { adaptActionResult } = require('./operator-tui-adapters');
const {
  buildShellModel,
  shellModelToOptions,
  isInkLocalShellAction,
  isInkLocalRemountFallbackAction,
  isShellSessionEndAction,
  contentSurfaceForLocalAction,
  seedConfigModelFromShell,
  seedStatusResultFromSelectedRun,
} = require('./operator-tui-shell-model');
const {
  isNativeWorkflowAction,
  openNativeWorkflow,
  surfaceForWorkflow,
  NATIVE_LAUNCHER_EXECUTE_ACTION,
} = require('./operator-tui-native-workflows');

/**
 * @typedef {'none'|'session_end'|'ink_local'|'ink_local_remount'|'native_workflow'|'slash_message'|'nested_execute'} ShellActionEffectKind
 */

/** @typedef {'session_end'|'ink_local'|'native_workflow'|'nested_execute'} ShellPresentationRouteKind */

/** Actions that require nested operator modules (fresh query / prompts). */
const NESTED_EXECUTE_ACTIONS = Object.freeze(new Set([
  'attach',
  'status',
  'explain',
]));

/**
 * Hotkey / nav presentation route for Ink render (seeded surfaces stay mounted).
 * Slash tokens and explicit operator queries use resolveShellActionEffect instead.
 * @param {unknown} actionId
 * @returns {ShellPresentationRouteKind}
 */
function classifyShellPresentationRoute(actionId) {
  if (isShellSessionEndAction(actionId)) return 'session_end';
  const id = String(actionId ?? '').trim().toLowerCase();
  if (isNativeWorkflowAction(id) && id !== NATIVE_LAUNCHER_EXECUTE_ACTION) return 'native_workflow';
  if (requiresNestedExecute(id)) return 'nested_execute';
  if (isInkLocalShellAction(id)) return 'ink_local';
  return 'nested_execute';
}

/**
 * @param {unknown} actionId
 * @returns {boolean}
 */
function requiresNestedExecute(actionId) {
  return NESTED_EXECUTE_ACTIONS.has(String(actionId ?? '').trim().toLowerCase());
}

/**
 * Normalize slash/bare tokens to ink-local action ids (help/home/diagnostics/config).
 * @param {unknown} actionId
 * @returns {string}
 */
function normalizeInkLocalActionToken(actionId) {
  const token = String(actionId ?? '').trim().toLowerCase();
  if (token === '/home' || token === 'home') return 'home';
  if (token === '/diagnostics' || token === 'diagnostics') return 'diagnostics';
  if (token === '/doctor' || token === 'doctor') return 'config';
  if (token === 'help' || token === '?' || token === '/help') return 'help';
  return token;
}

/**
 * @param {'home'|'help'|'diagnostics'|'status'|'evidence'|'monitor'|'config'} surface
 * @returns {string}
 */
function selectedNavIdForSurface(surface) {
  if (surface === 'diagnostics') return 'diagnostics';
  if (surface === 'config') return 'config';
  if (surface === 'monitor') return 'monitor';
  return surface;
}

/**
 * Build shell model options for an Ink-local surface transition.
 * Returns null when actionId is not ink-local.
 * @param {object} model — current shell model
 * @param {unknown} actionId
 * @returns {ReturnType<typeof shellModelToOptions> | null}
 */
function buildInkLocalSurfaceTransition(model, actionId) {
  const token = normalizeInkLocalActionToken(actionId);
  if (!isInkLocalShellAction(token)) return null;
  const surface = contentSurfaceForLocalAction(token) ?? 'home';
  const opts = {
    ...shellModelToOptions(model),
    contentSurface: surface,
    selectedNavId: selectedNavIdForSurface(surface),
    focus: 'nav',
    commandInput: '',
    activeWorkflow: null,
    helpOpenTopicId: surface === 'help' ? null : model.helpOpenTopicId,
    helpSelectedTopicId: surface === 'help'
      ? (model.helpSelectedTopicId ?? undefined)
      : model.helpSelectedTopicId,
  };
  if (surface === 'config') {
    opts.configModel = seedConfigModelFromShell(model);
  }
  if (surface === 'status' || surface === 'monitor') {
    const keepAuthoritative = model.status?.available === true
      && model.selectedRunId
      && String(model.status.run_id) === String(model.selectedRunId);
    if (!keepAuthoritative) {
      const seeded = seedStatusResultFromSelectedRun(model);
      if (seeded) opts.statusResult = seeded;
    }
    if (surface === 'monitor') {
      opts.monitorSource = opts.statusResult ?? model.statusResult ?? model.monitorSource;
      opts.selectedNavId = 'monitor';
    }
  }
  return opts;
}

/**
 * Apply ink-local transition and return the next model.
 * @param {object} model
 * @param {unknown} actionId
 * @returns {object | null}
 */
function applyInkLocalSurfaceTransition(model, actionId) {
  const opts = buildInkLocalSurfaceTransition(model, actionId);
  if (!opts) return null;
  return buildShellModel(opts);
}

/**
 * Build options for opening a Phase-1 native Ink workflow in-process.
 * @param {object} model
 * @param {unknown} actionId
 * @param {object} [overrides]
 * @returns {ReturnType<typeof shellModelToOptions> | null}
 */
function buildNativeWorkflowTransition(model, actionId, overrides = {}) {
  const id = String(actionId ?? '');
  if (!isNativeWorkflowAction(id) || id === NATIVE_LAUNCHER_EXECUTE_ACTION) return null;
  const workflow = openNativeWorkflow(model, id);
  if (!workflow) return null;
  return {
    ...shellModelToOptions(model),
    activeWorkflow: workflow,
    contentSurface: surfaceForWorkflow(workflow),
    focus: 'content',
    selectedNavId: id === 'smoke' ? 'launcher' : id,
    commandInput: '',
    pendingLauncherSelections: null,
    ...overrides,
  };
}

/**
 * @param {object} model
 * @param {unknown} actionId
 * @param {object} [overrides]
 * @returns {object | null}
 */
function applyNativeWorkflowTransition(model, actionId, overrides = {}) {
  const opts = buildNativeWorkflowTransition(model, actionId, overrides);
  if (!opts) return null;
  return buildShellModel(opts);
}

/**
 * Slash help/message surfaces stay in-process (no nested readline).
 * @param {object} model
 * @param {{ plan: object, parsed: object }} slash
 * @returns {object}
 */
function buildSlashMessageTransition(model, slash) {
  const { plan, parsed } = slash;
  const actionId = parsed?.name ? `/${parsed.name}` : '/';
  return buildShellModel({
    ...shellModelToOptions(model),
    contentSurface: 'action_result',
    actionResult: adaptActionResult({
      action_id: actionId,
      ok: plan.ok !== false,
      exitCode: plan.exitCode ?? 1,
      reason_code: plan.reason_code ?? null,
      next_safe_action: plan.next_safe_action ?? null,
      text: plan.text || '',
    }),
    focus: plan.disposition === 'help' ? 'nav' : 'input',
    commandInput: '',
    activeWorkflow: null,
  });
}

/**
 * Resolve a requested action into a controller effect for render or entry.
 * @param {object} model
 * @param {unknown} actionId
 * @param {{
 *   slashPlan?: { plan: object, parsed: object } | null,
 *   launcherSelections?: object | null,
 * }} [ctx]
 * @returns {{
 *   kind: ShellActionEffectKind,
 *   transition?: object,
 *   opts?: object,
 *   plan?: object,
 *   parsed?: object,
 *   actionId?: string,
 *   runId?: string | null,
 *   skipRunPrompt?: boolean,
 *   launcherSelections?: object | null,
 * }}
 */
function resolveShellActionEffect(model, actionId, ctx = {}) {
  const raw = String(actionId ?? '').trim();
  if (!raw) return { kind: 'none' };
  if (isShellSessionEndAction(raw)) return { kind: 'session_end', actionId: raw };

  const slashPlan = ctx.slashPlan ?? null;
  if (slashPlan) {
    const { plan, parsed } = slashPlan;
    if (plan.disposition === 'help' || plan.disposition === 'message') {
      return { kind: 'slash_message', plan, parsed };
    }
    if (plan.disposition === 'dispatch' && plan.action_id) {
      return resolveDispatchEffect(model, plan.action_id, {
        runId: plan.run_id ?? null,
        skipRunPrompt: plan.skip_run_prompt === true,
      });
    }
  }

  if (raw === NATIVE_LAUNCHER_EXECUTE_ACTION) {
    return {
      kind: 'nested_execute',
      actionId: raw,
      launcherSelections: ctx.launcherSelections ?? model.pendingLauncherSelections ?? null,
    };
  }

  return resolveDispatchEffect(model, raw, {});
}

/**
 * @param {object} model
 * @param {string} actionId
 * @param {{ runId?: string | null, skipRunPrompt?: boolean }} ctx
 */
function resolveDispatchEffect(model, actionId, ctx) {
  const id = String(actionId ?? '');

  const nativeOpts = buildNativeWorkflowTransition(model, id, ctx.runId
    ? { selectedRunId: ctx.runId }
    : {});
  if (nativeOpts) {
    return { kind: 'native_workflow', opts: nativeOpts, actionId: id, runId: ctx.runId ?? null };
  }

  if (requiresNestedExecute(id)) {
    return {
      kind: 'nested_execute',
      actionId: id,
      runId: ctx.runId ?? null,
      skipRunPrompt: ctx.skipRunPrompt === true,
    };
  }

  const inkTransition = buildInkLocalSurfaceTransition(model, id);
  if (inkTransition) {
    return { kind: 'ink_local', transition: inkTransition, actionId: id, runId: ctx.runId ?? null };
  }

  if (shouldHandleLeakedInkLocalAction(id)) {
    const transition = buildInkLocalSurfaceTransition(model, id);
    return { kind: 'ink_local_remount', transition, actionId: id };
  }

  return {
    kind: 'nested_execute',
    actionId: id,
    runId: ctx.runId ?? null,
    skipRunPrompt: ctx.skipRunPrompt === true,
  };
}

/**
 * Entry remount fallback: landing chrome always; other ink-local surfaces when leaked.
 * @param {unknown} actionId
 * @returns {boolean}
 */
function shouldHandleLeakedInkLocalAction(actionId) {
  const token = normalizeInkLocalActionToken(actionId);
  return isInkLocalRemountFallbackAction(token) || isInkLocalShellAction(token);
}

/**
 * Merge executeAction outcome fields into entry-loop mutable state.
 * @param {object} state
 * @param {object} outcome
 * @returns {object}
 */
function mergeActionOutcomeIntoEntryState(state, outcome) {
  const next = { ...state };
  if (outcome.selectedRunId != null) next.selectedRunId = outcome.selectedRunId;
  if (outcome.actionResult) next.actionResult = outcome.actionResult;
  if (outcome.contentSurface) next.contentSurface = outcome.contentSurface;
  if (outcome.runsPayload) next.runsPayload = outcome.runsPayload;
  if (outcome.statusResult) {
    next.statusResult = outcome.statusResult;
    next.lifecycleSource = outcome.statusResult.json ?? outcome.statusResult;
    next.monitorSource = outcome.statusResult;
  }
  if (outcome.monitorSource) next.monitorSource = outcome.monitorSource;
  if (outcome.evidenceModel) next.evidenceModel = outcome.evidenceModel;
  if (outcome.configModel) next.configModel = outcome.configModel;
  if (Object.prototype.hasOwnProperty.call(outcome, 'launcherModel')) {
    next.launcherModel = outcome.launcherModel;
  }
  if (outcome.actionResult?.exit_code != null) {
    next.lastExitCode = outcome.actionResult.exit_code;
  }
  return next;
}

/**
 * Build a shell model from entry-loop authoritative snapshots plus optional patch.
 * @param {object} snapshot
 * @param {object} [patch]
 * @returns {object}
 */
function buildEntryShellModel(snapshot, patch = {}) {
  return buildShellModel({
    aboutInfo: snapshot.aboutInfo,
    credentials: snapshot.credentials,
    pathActivation: snapshot.pathActivation,
    runsPayload: snapshot.runsPayload,
    statusResult: snapshot.statusResult,
    evidenceModel: snapshot.evidenceModel,
    configModel: snapshot.configModel,
    launcherModel: snapshot.launcherModel,
    actionResult: snapshot.actionResult,
    lifecycleSource: snapshot.lifecycleSource,
    monitorSource: snapshot.monitorSource,
    selectedRunId: snapshot.selectedRunId,
    columns: snapshot.columns,
    rows: snapshot.rows,
    colorEnabled: snapshot.colorEnabled,
    productVersion: snapshot.aboutInfo.version,
    ...patch,
  });
}

/**
 * Apply a controller effect to entry-loop state for the next Ink remount.
 * Returns null when the effect cannot be materialized here.
 * @param {object} effect
 * @param {object} snapshot
 * @param {object} model — current shell model (for fallbacks)
 * @returns {{ model: object, statePatch: object } | null}
 */
function materializeEntryRemountFromEffect(effect, snapshot, model) {
  if (effect.kind === 'native_workflow' && effect.opts) {
    return {
      model: buildEntryShellModel(snapshot, {
        ...effect.opts,
        selectedRunId: effect.runId ?? snapshot.selectedRunId,
        focus: 'content',
      }),
      statePatch: {},
    };
  }
  if ((effect.kind === 'ink_local' || effect.kind === 'ink_local_remount') && effect.transition) {
    const transition = effect.transition;
    const surface = transition.contentSurface ?? 'home';
    const statePatch = { contentSurface: surface };
    if (transition.configModel) statePatch.configModel = transition.configModel;
    if (transition.statusResult) statePatch.statusResult = transition.statusResult;
    if (transition.monitorSource) statePatch.monitorSource = transition.monitorSource;
    return {
      model: buildEntryShellModel(snapshot, {
        ...transition,
        selectedRunId: effect.runId ?? snapshot.selectedRunId,
        selectedNavId: transition.selectedNavId ?? selectedNavIdForSurface(surface),
        contentSurface: surface,
        focus: 'nav',
        activeWorkflow: null,
      }),
      statePatch,
    };
  }
  if (effect.kind === 'slash_message') {
    const next = buildSlashMessageTransition(model, {
      plan: effect.plan,
      parsed: effect.parsed,
    });
    return {
      model: next,
      statePatch: {
        contentSurface: next.contentSurface,
        actionResult: next.actionResult,
      },
    };
  }
  return null;
}

module.exports = {
  NESTED_EXECUTE_ACTIONS,
  classifyShellPresentationRoute,
  requiresNestedExecute,
  normalizeInkLocalActionToken,
  selectedNavIdForSurface,
  buildInkLocalSurfaceTransition,
  applyInkLocalSurfaceTransition,
  buildNativeWorkflowTransition,
  applyNativeWorkflowTransition,
  buildSlashMessageTransition,
  resolveShellActionEffect,
  shouldHandleLeakedInkLocalAction,
  mergeActionOutcomeIntoEntryState,
  buildEntryShellModel,
  materializeEntryRemountFromEffect,
};
