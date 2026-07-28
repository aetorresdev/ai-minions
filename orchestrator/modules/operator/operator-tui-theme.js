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
    titleBold: true,
    sectionBold: true,
  };
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
};
