'use strict';

/**
 * Ink fullscreen shell theme tokens (presentation only).
 * Respects colorEnabled / NO_COLOR; does not claim Web UI or mouse interaction.
 *
 * Brand triad (Cerberus brand splash direction):
 *   brand.validate / triadValidate → cyan
 *   brand.trace    / triadTrace    → blueBright (core)
 *   brand.enforce  / triadEnforce  → magenta
 * Role / state tokens keep blocked ≠ failure (magentaBright vs red).
 */

/** @typedef {{
 *   brand: string | undefined,
 *   brandPrimary: string | undefined,
 *   brandSecondary: string | undefined,
 *   brandCore: string | undefined,
 *   accent: string | undefined,
 *   focus: string | undefined,
 *   selected: string | undefined,
 *   muted: string | undefined,
 *   ready: string | undefined,
 *   warn: string | undefined,
 *   danger: string | undefined,
 *   blocked: string | undefined,
 *   triadValidate: string | undefined,
 *   triadTrace: string | undefined,
 *   triadEnforce: string | undefined,
 *   roleOrchestrator: string | undefined,
 *   roleCerberus: string | undefined,
 *   titleBold: boolean,
 *   sectionBold: boolean,
 * }} ShellTheme */

/**
 * @param {{ colorEnabled?: boolean }} [options]
 * @returns {ShellTheme}
 */
function resolveShellTheme(options = {}) {
  const colorEnabled = options.colorEnabled !== false && process.env.NO_COLOR == null;
  if (!colorEnabled) {
    return {
      brand: undefined,
      brandPrimary: undefined,
      brandSecondary: undefined,
      brandCore: undefined,
      accent: undefined,
      focus: undefined,
      selected: undefined,
      muted: undefined,
      ready: undefined,
      warn: undefined,
      danger: undefined,
      blocked: undefined,
      triadValidate: undefined,
      triadTrace: undefined,
      triadEnforce: undefined,
      roleOrchestrator: undefined,
      roleCerberus: undefined,
      titleBold: true,
      sectionBold: true,
    };
  }
  return {
    brand: 'cyan',
    brandPrimary: 'cyan',
    brandSecondary: 'magenta',
    brandCore: 'blueBright',
    accent: 'blueBright',
    focus: 'cyan',
    selected: 'cyan',
    muted: 'gray',
    ready: 'green',
    warn: 'yellow',
    danger: 'red',
    blocked: 'magentaBright',
    triadValidate: 'cyan',
    triadTrace: 'blueBright',
    triadEnforce: 'magenta',
    roleOrchestrator: 'cyan',
    roleCerberus: 'magentaBright',
    titleBold: true,
    sectionBold: true,
  };
}

/**
 * Map landing readiness tone → theme color token.
 * @param {ShellTheme} theme
 * @param {string} tone
 * @returns {string | undefined}
 */
function toneColor(theme, tone) {
  switch (String(tone ?? '')) {
    case 'ok':
      return theme.ready;
    case 'warn':
    case 'loading':
      return theme.warn;
    case 'fail':
      return theme.danger;
    case 'blocked':
      return theme.blocked;
    default:
      return theme.muted;
  }
}

/**
 * Map splash segment tone → theme color (Validate / Trace / Enforce / brand).
 * @param {ShellTheme} theme
 * @param {string | undefined} tone
 * @returns {string | undefined}
 */
function splashToneColor(theme, tone) {
  switch (String(tone ?? '')) {
    case 'validate':
      return theme.triadValidate ?? theme.brandPrimary;
    case 'trace':
      return theme.triadTrace ?? theme.brandCore;
    case 'enforce':
      return theme.triadEnforce ?? theme.brandSecondary;
    case 'core':
      return theme.brandCore ?? theme.accent;
    case 'wordmark':
    case 'brand':
      return theme.brand ?? theme.brandPrimary;
    case 'accent':
      return theme.accent;
    case 'warn':
      return theme.warn;
    case 'muted':
      return theme.muted;
    default:
      return theme.muted;
  }
}

/**
 * Border color for a chrome pane when it holds focus.
 * @param {ShellTheme} theme
 * @param {boolean} focused
 * @returns {string | undefined}
 */
function focusBorderColor(theme, focused) {
  if (!focused) return theme.muted;
  return theme.focus;
}

module.exports = {
  resolveShellTheme,
  focusBorderColor,
  toneColor,
  splashToneColor,
};
