'use strict';

/**
 * Ink fullscreen shell theme tokens (presentation only).
 * Respects colorEnabled / NO_COLOR; does not claim Web UI or mouse interaction.
 */

/** @typedef {{
 *   brand: string | undefined,
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
      titleBold: true,
      sectionBold: true,
    };
  }
  return {
    brand: 'cyan',
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
};
