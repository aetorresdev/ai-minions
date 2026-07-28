'use strict';

/**
 * Ink fullscreen shell theme tokens (presentation only).
 * Hex palette locked in docs/design/tui-visual-system.md.
 * Respects colorEnabled / NO_COLOR; gradient only when truecolor is available.
 * Does not claim Web UI, mouse interaction, or auto glyph-coverage detection.
 */

/** Locked visual-system palette (hex contract). */
const PALETTE = Object.freeze({
  bg: '#0B1020',
  surface: '#121A2B',
  border: '#26344D',
  text: '#E6EDF7',
  muted: '#92A0B8',
  cyan: '#67D9F5',
  violet: '#9B8CFF',
  amber: '#F4B860',
  success: '#55D6A5',
  warn: '#E8C547',
  danger: '#F07178',
  blocked: '#D27BEA',
});

/** Brand gradient stops (decorative): cyan → violet → amber. */
const BRAND_GRADIENT = Object.freeze([PALETTE.cyan, PALETTE.violet, PALETTE.amber]);

/**
 * Truecolor when the terminal advertises it. Optional enhancement only —
 * hierarchy must still work under NO_COLOR / 256-color without gradients.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ truecolor?: boolean, colorEnabled?: boolean }} [options]
 * @returns {boolean}
 */
function detectTruecolor(env = process.env, options = {}) {
  if (options.truecolor === true) return true;
  if (options.truecolor === false) return false;
  if (options.colorEnabled === false) return false;
  if (env.NO_COLOR != null) return false;
  const colorterm = String(env.COLORTERM ?? '').toLowerCase();
  if (colorterm.includes('truecolor') || colorterm.includes('24bit')) return true;
  const term = String(env.TERM ?? '').toLowerCase();
  if (term.includes('truecolor') || term.includes('direct')) return true;
  return false;
}

/** @typedef {{
 *   palette: typeof PALETTE,
 *   brandGradient: ReadonlyArray<string> | null,
 *   truecolor: boolean,
 *   bg: string | undefined,
 *   surface: string | undefined,
 *   border: string | undefined,
 *   text: string | undefined,
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
 * @param {{ colorEnabled?: boolean, truecolor?: boolean }} [options]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ShellTheme}
 */
function resolveShellTheme(options = {}, env = process.env) {
  const colorEnabled = options.colorEnabled !== false && env.NO_COLOR == null;
  const truecolor = colorEnabled && detectTruecolor(env, options);
  if (!colorEnabled) {
    return {
      palette: PALETTE,
      brandGradient: null,
      truecolor: false,
      bg: undefined,
      surface: undefined,
      border: undefined,
      text: undefined,
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
    palette: PALETTE,
    brandGradient: truecolor ? BRAND_GRADIENT : null,
    truecolor,
    bg: PALETTE.bg,
    surface: PALETTE.surface,
    border: PALETTE.border,
    text: PALETTE.text,
    brand: PALETTE.cyan,
    brandPrimary: PALETTE.cyan,
    brandSecondary: PALETTE.violet,
    brandCore: PALETTE.violet,
    accent: PALETTE.violet,
    focus: PALETTE.cyan,
    selected: PALETTE.cyan,
    muted: PALETTE.muted,
    ready: PALETTE.success,
    warn: PALETTE.warn,
    danger: PALETTE.danger,
    blocked: PALETTE.blocked,
    triadValidate: PALETTE.cyan,
    triadTrace: PALETTE.violet,
    triadEnforce: PALETTE.amber,
    roleOrchestrator: PALETTE.cyan,
    roleCerberus: PALETTE.blocked,
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
 * Gradient stops are decorative (wordmark/accent only).
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
    case 'gradient-cyan':
      return theme.truecolor ? theme.palette.cyan : (theme.brand ?? theme.brandPrimary);
    case 'gradient-violet':
      return theme.truecolor ? theme.palette.violet : (theme.brand ?? theme.brandPrimary);
    case 'gradient-amber':
      return theme.truecolor ? theme.palette.amber : (theme.brand ?? theme.brandPrimary);
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
 * Pick a brand-gradient stop for character index (truecolor only).
 * @param {ShellTheme} theme
 * @param {number} index
 * @param {number} length
 * @returns {string | undefined}
 */
function brandGradientStop(theme, index, length) {
  if (!theme.truecolor || !theme.brandGradient || theme.brandGradient.length === 0) {
    return theme.brand;
  }
  const n = Math.max(1, Number(length) || 1);
  const i = Math.max(0, Number(index) || 0);
  const t = n <= 1 ? 0 : i / (n - 1);
  if (t < 1 / 3) return theme.brandGradient[0];
  if (t < 2 / 3) return theme.brandGradient[1];
  return theme.brandGradient[2];
}

/**
 * Border color for a chrome pane when it holds focus.
 * @param {ShellTheme} theme
 * @param {boolean} focused
 * @returns {string | undefined}
 */
function focusBorderColor(theme, focused) {
  if (!focused) return theme.muted ?? theme.border;
  return theme.focus;
}

module.exports = {
  PALETTE,
  BRAND_GRADIENT,
  detectTruecolor,
  resolveShellTheme,
  focusBorderColor,
  toneColor,
  splashToneColor,
  brandGradientStop,
};
