'use strict';

/**
 * TUI icon mode resolver + chrome glyph maps.
 * Config: icons=nerd|unicode|ascii (default nerd) — explicit operator choice.
 * Font / glyph coverage is NOT auto-detected; NO_COLOR / CI / SSH do not prove
 * coverage and do not auto-degrade icons. Prefer documenting ascii|unicode in
 * operator profiles for those environments. No “never tofu” runtime claim.
 */

const ICON_MODES = Object.freeze(['nerd', 'unicode', 'ascii']);
const DEFAULT_ICON_MODE = 'nerd';
/** Env override for icons=nerd|unicode|ascii (presentation only). */
const ICONS_ENV = 'AI_MINIONS_TUI_ICONS';

/**
 * @typedef {'nerd' | 'unicode' | 'ascii'} IconMode
 * @typedef {{
 *   selected: string,
 *   ok: string,
 *   warn: string,
 *   fail: string,
 *   blocked: string,
 *   bullet: string,
 *   core: string,
 *   eye: string,
 * }} ChromeIcons
 */

/** @type {Record<IconMode, ChromeIcons>} */
const CHROME_ICONS = Object.freeze({
  // Nerd Font Private Use Area — requires JetBrainsMono Nerd Font (or equivalent).
  // May tofu without that face; not auto-detected.
  nerd: Object.freeze({
    selected: '\uf054', // nf-fa-chevron-right
    ok: '\uf00c', // nf-fa-check
    warn: '\uf071', // nf-fa-exclamation-triangle
    fail: '\uf00d', // nf-fa-times
    blocked: '\uf023', // nf-fa-lock
    bullet: '\uf111', // nf-fa-circle
    core: '\uf219', // nf-fa-diamond
    eye: '\uf06e', // nf-fa-eye
  }),
  unicode: Object.freeze({
    selected: '›',
    ok: '✓',
    warn: '!',
    fail: '×',
    blocked: '⊘',
    bullet: '●',
    core: '◆',
    eye: '◇',
  }),
  ascii: Object.freeze({
    selected: '>',
    ok: '+',
    warn: '!',
    fail: 'x',
    blocked: '#',
    bullet: '*',
    core: '*',
    eye: 'o',
  }),
});

/**
 * Resolve icon mode from options or env. Invalid values fall back to default nerd.
 * Does not inspect NO_COLOR / TERM for auto-fallback (honest: operator choice).
 * @param {{ icons?: string, iconMode?: string }} [options]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {IconMode}
 */
function resolveIconMode(options = {}, env = process.env) {
  const raw = options.icons ?? options.iconMode ?? env[ICONS_ENV] ?? DEFAULT_ICON_MODE;
  const normalized = String(raw ?? '').trim().toLowerCase();
  if (ICON_MODES.includes(normalized)) {
    return /** @type {IconMode} */ (normalized);
  }
  return DEFAULT_ICON_MODE;
}

/**
 * @param {IconMode | string} mode
 * @returns {ChromeIcons}
 */
function chromeIconsFor(mode) {
  const resolved = resolveIconMode({ icons: mode });
  return CHROME_ICONS[resolved];
}

/**
 * @param {IconMode | string} mode
 * @param {keyof ChromeIcons} key
 * @returns {string}
 */
function chromeIcon(mode, key) {
  const icons = chromeIconsFor(mode);
  return icons[key] ?? CHROME_ICONS.ascii[key] ?? '';
}

/**
 * Cerberus guardian density for landing / splash secondary mark.
 * @param {'wide' | 'mid' | 'compact' | 'full' | 'minimal' | string} layoutOrDensity
 * @returns {'wide' | 'compact' | 'minimal'}
 */
function resolveCerberusVariant(layoutOrDensity) {
  const v = String(layoutOrDensity ?? '');
  if (v === 'wide' || v === 'full') return 'wide';
  if (v === 'minimal') return 'minimal';
  // mid / compact / unknown → compact textual guardian
  return 'compact';
}

module.exports = {
  ICON_MODES,
  DEFAULT_ICON_MODE,
  ICONS_ENV,
  CHROME_ICONS,
  resolveIconMode,
  chromeIconsFor,
  chromeIcon,
  resolveCerberusVariant,
};
