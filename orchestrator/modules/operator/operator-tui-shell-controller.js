'use strict';

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

/**
 * @typedef {'ink_local'|'session_end'|'nested'} ShellActionEffectKind
 */

/**
 * @param {unknown} actionId
 * @returns {ShellActionEffectKind}
 */
function classifyShellActionEffect(actionId) {
  if (isShellSessionEndAction(actionId)) return 'session_end';
  if (isInkLocalShellAction(actionId)) return 'ink_local';
  return 'nested';
}

/**
 * Normalize slash/bare tokens to ink-local action ids (help/home/diagnostics).
 * @param {unknown} actionId
 * @returns {string}
 */
function normalizeInkLocalActionToken(actionId) {
  const token = String(actionId ?? '').trim().toLowerCase();
  if (token === '/home' || token === 'home') return 'home';
  if (token === '/diagnostics' || token === 'diagnostics') return 'diagnostics';
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
 * Entry remount fallback: landing chrome always; other ink-local surfaces when leaked.
 * @param {unknown} actionId
 * @returns {boolean}
 */
function shouldHandleLeakedInkLocalAction(actionId) {
  const token = normalizeInkLocalActionToken(actionId);
  return isInkLocalRemountFallbackAction(token) || isInkLocalShellAction(token);
}

module.exports = {
  classifyShellActionEffect,
  normalizeInkLocalActionToken,
  selectedNavIdForSurface,
  buildInkLocalSurfaceTransition,
  applyInkLocalSurfaceTransition,
  shouldHandleLeakedInkLocalAction,
};
