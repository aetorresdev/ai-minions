'use strict';

/**
 * Terminal-native arcade / pixel-art sprites for the Ink landing.
 * Deterministic cell matrices only — no Kitty/iTerm2/Sixel, no raster I/O,
 * no network, no subprocess on first paint.
 */

const { resolveIconMode } = require('./operator-tui-icons');

const ART_ENV = 'AI_MINIONS_TUI_ART';
const GUARDIAN_STYLE_ENV = 'AI_MINIONS_TUI_GUARDIAN';
const ART_MODES = Object.freeze(['auto', 'arcade', 'text', 'none']);
const GUARDIAN_STYLES = Object.freeze(['neon', 'semantic']);
/** Fail-closed documented default when ART_ENV is missing or invalid. */
const DEFAULT_ART_MODE = 'auto';
const DEFAULT_GUARDIAN_STYLE = 'neon';

/**
 * @typedef {'auto'|'arcade'|'text'|'none'} ArtMode
 * @typedef {'neon'|'semantic'} GuardianStyle
 * @typedef {'wide'|'compact'|'minimal'} CerberusVariant
 * @typedef {'validate'|'trace'|'enforce'|'brand'|'accent'|'muted'|'core'|'wordmark'|'warn'} ArtTone
 * @typedef {{ text: string, tone?: ArtTone, bold?: boolean }} ArtSegment
 * @typedef {{ segments: ArtSegment[] }} ArtRow
 * @typedef {{
 *   requested: string,
 *   mode: ArtMode,
 *   effective: 'arcade'|'text'|'none',
 *   reason: string | null,
 *   guardianStyle: GuardianStyle,
 *   guardianStyleReason: string | null,
 * }} ArtResolution
 */

/**
 * Approximate terminal column width for sprite cells (no ANSI).
 * Block / half-block glyphs used here are width 1; CJK-wide rarely appears.
 * @param {string} text
 * @returns {number}
 */
function measureArtDisplayWidth(text) {
  let width = 0;
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) continue;
    // Fullwidth / emoji presentation ranges — treat as 2 when present.
    if (
      (cp >= 0x1100 && cp <= 0x115f)
      || (cp >= 0x2e80 && cp <= 0xa4cf)
      || (cp >= 0xac00 && cp <= 0xd7a3)
      || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0xfe10 && cp <= 0xfe6f)
      || (cp >= 0xff01 && cp <= 0xff60)
      || (cp >= 0xffe0 && cp <= 0xffe6)
      || (cp >= 0x1f300 && cp <= 0x1faff)
    ) {
      width += 2;
      continue;
    }
    width += 1;
  }
  return width;
}

/**
 * @param {ArtRow[]} rows
 * @returns {number}
 */
function measureArtRowsWidth(rows) {
  let max = 0;
  for (const row of rows || []) {
    const line = (row.segments || []).map((s) => s.text).join('');
    max = Math.max(max, measureArtDisplayWidth(line));
  }
  return max;
}

/**
 * @param {ArtRow[]} rows
 * @returns {string[]}
 */
function flattenArtRows(rows) {
  return (rows || []).map((row) => (row.segments || []).map((s) => s.text).join(''));
}

/**
 * @param {{ art?: string, artMode?: string }} [options]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ArtResolution}
 */
function resolveArtMode(options = {}, env = process.env) {
  const raw = options.art ?? options.artMode ?? env[ART_ENV] ?? DEFAULT_ART_MODE;
  const requested = String(raw ?? '').trim().toLowerCase();
  let mode = /** @type {ArtMode} */ (DEFAULT_ART_MODE);
  let reason = null;
  if (ART_MODES.includes(requested)) {
    mode = /** @type {ArtMode} */ (requested);
  } else if (requested !== '') {
    mode = DEFAULT_ART_MODE;
    reason = `invalid_art_mode:${requested}`;
  }

  const iconMode = resolveIconMode(options, env);
  let effective = /** @type {'arcade'|'text'|'none'} */ ('text');
  if (mode === 'none') {
    effective = 'none';
  } else if (mode === 'text') {
    effective = 'text';
  } else if (mode === 'arcade') {
    effective = 'arcade';
  } else {
    // auto: arcade for nerd/unicode; text/ascii path for ascii icons.
    effective = iconMode === 'ascii' ? 'text' : 'arcade';
  }

  const styleRaw = options.guardianStyle ?? env[GUARDIAN_STYLE_ENV] ?? DEFAULT_GUARDIAN_STYLE;
  const styleRequested = String(styleRaw ?? '').trim().toLowerCase();
  let guardianStyle = /** @type {GuardianStyle} */ (DEFAULT_GUARDIAN_STYLE);
  let guardianStyleReason = null;
  if (GUARDIAN_STYLES.includes(styleRequested)) {
    guardianStyle = /** @type {GuardianStyle} */ (styleRequested);
  } else if (styleRequested !== '') {
    guardianStyle = DEFAULT_GUARDIAN_STYLE;
    guardianStyleReason = `invalid_guardian_style:${styleRequested}`;
  }

  return {
    requested: requested || DEFAULT_ART_MODE,
    mode,
    effective,
    reason,
    guardianStyle,
    guardianStyleReason,
  };
}

/**
 * Resolve Cerberus sprite density from landing layout.
 * @param {'wide'|'mid'|'compact'|string} layout
 * @returns {CerberusVariant}
 */
function resolvePixelCerberusVariant(layout) {
  const v = String(layout ?? '');
  if (v === 'wide' || v === 'full') return 'wide';
  if (v === 'minimal' || v === 'compact') return 'minimal';
  return 'compact';
}

/**
 * @param {string} text
 * @param {ArtTone} [tone]
 * @param {boolean} [bold]
 * @returns {ArtSegment}
 */
function seg(text, tone = 'muted', bold = false) {
  return bold ? { text, tone, bold: true } : { text, tone };
}

/**
 * @param {ArtSegment[]} segments
 * @returns {ArtRow}
 */
function row(...segments) {
  return { segments };
}

/**
 * Neon baseline — block Cerberus; triad stays on the wordmark column.
 * @param {CerberusVariant} variant
 * @param {string} iconMode
 * @returns {ArtRow[]}
 */
function neonCerberusRows(variant, iconMode) {
  const ascii = resolveIconMode({ icons: iconMode }) === 'ascii';
  if (variant === 'minimal') {
    return [row(seg(ascii ? '[CERBERUS]' : 'CERBERUS', 'brand', true))];
  }
  if (variant === 'compact' || ascii) {
    if (ascii) {
      return [
        row(seg('/\\ /\\ /\\', 'muted')),
        row(
          seg('V', 'validate', true),
          seg('.', 'muted'),
          seg('T', 'trace', true),
          seg('.', 'muted'),
          seg('E', 'enforce', true),
          seg(' *', 'core', true),
        ),
        row(seg('CERBERUS', 'brand', true)),
      ];
    }
    return [
      row(seg('▄▀▄ ▄▀▄ ▄▀▄', 'muted')),
      row(
        seg('█', 'validate'),
        seg('V', 'validate', true),
        seg('█', 'validate'),
        seg(' ', 'muted'),
        seg('█', 'trace'),
        seg('T', 'trace', true),
        seg('█', 'trace'),
        seg(' ', 'muted'),
        seg('█', 'enforce'),
        seg('E', 'enforce', true),
        seg('█', 'enforce'),
      ),
      row(seg('CERBERUS', 'brand', true)),
    ];
  }
  // wide arcade
  return [
    row(seg(' ▄██▄ ▄██▄ ▄██▄', 'muted')),
    row(
      seg(' █', 'validate'),
      seg('V', 'validate', true),
      seg('██', 'validate'),
      seg(' █', 'trace'),
      seg('T', 'trace', true),
      seg('██', 'trace'),
      seg(' █', 'enforce'),
      seg('E', 'enforce', true),
      seg('██', 'enforce'),
    ),
    row(seg(' ▀██▀ ▀██▀ ▀██▀', 'muted')),
    row(
      seg('   └────', 'muted'),
      seg('◆', 'core', true),
      seg('────┘', 'muted'),
    ),
    row(
      seg('    ', 'muted'),
      seg('CERBERUS', 'brand', true),
    ),
  ];
}

/**
 * Semantic Guardians — closed mouths; labels under heads replace hero triad.
 * Meaning must not depend on color alone (labels + distinct marks).
 * @param {CerberusVariant} variant
 * @param {string} iconMode
 * @returns {ArtRow[]}
 */
function semanticCerberusRows(variant, iconMode) {
  const ascii = resolveIconMode({ icons: iconMode }) === 'ascii';
  // Facial marks: shield/check · path/nodes · lock/gate
  const markV = ascii ? '+' : '▣';
  const markT = ascii ? '*' : '◈';
  const markE = ascii ? '#' : '▤';
  if (variant === 'minimal') {
    return [
      row(
        seg('V', 'validate', true),
        seg('/', 'muted'),
        seg('T', 'trace', true),
        seg('/', 'muted'),
        seg('E', 'enforce', true),
      ),
    ];
  }
  if (variant === 'compact' || ascii) {
    return [
      row(
        seg(markV, 'validate', true),
        seg(' ', 'muted'),
        seg(markT, 'trace', true),
        seg(' ', 'muted'),
        seg(markE, 'enforce', true),
      ),
      row(
        seg('VAL', 'validate', true),
        seg(' ', 'muted'),
        seg('TRC', 'trace', true),
        seg(' ', 'muted'),
        seg('ENF', 'enforce', true),
      ),
      row(seg('CERBERUS', 'brand', true)),
    ];
  }
  return [
    row(seg(' ▄██▄ ▄██▄ ▄██▄', 'muted')),
    row(
      seg(' █', 'validate'),
      seg(markV, 'validate', true),
      seg('██', 'validate'),
      seg(' █', 'trace'),
      seg(markT, 'trace', true),
      seg('██', 'trace'),
      seg(' █', 'enforce'),
      seg(markE, 'enforce', true),
      seg('██', 'enforce'),
    ),
    row(seg(' ▀██▀ ▀██▀ ▀██▀', 'muted')),
    row(
      seg('VALIDATE', 'validate', true),
      seg(' ', 'muted'),
      seg('TRACE', 'trace', true),
      seg(' ', 'muted'),
      seg('ENFORCE', 'enforce', true),
    ),
    row(
      seg('      ', 'muted'),
      seg('CERBERUS', 'brand', true),
    ),
  ];
}

/**
 * @param {{
 *   layout?: string,
 *   icons?: string,
 *   iconMode?: string,
 *   art?: string,
 *   artMode?: string,
 *   guardianStyle?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 * @returns {{
 *   resolution: ArtResolution,
 *   variant: CerberusVariant,
 *   rows: ArtRow[],
 *   lines: string[],
 *   display_width: number,
 *   hide_hero_triad: boolean,
 * }}
 */
function buildLandingGuardianArt(options = {}) {
  const env = options.env ?? process.env;
  const resolution = resolveArtMode(options, env);
  const iconMode = resolveIconMode(options, env);
  const variant = resolvePixelCerberusVariant(options.layout);
  if (resolution.effective === 'none') {
    return {
      resolution,
      variant,
      rows: [],
      lines: [],
      display_width: 0,
      hide_hero_triad: false,
    };
  }
  if (resolution.effective === 'text') {
    return {
      resolution,
      variant,
      rows: [],
      lines: [],
      display_width: 0,
      hide_hero_triad: false,
    };
  }
  const rows = resolution.guardianStyle === 'semantic'
    ? semanticCerberusRows(variant, iconMode)
    : neonCerberusRows(variant, iconMode);
  return {
    resolution,
    variant,
    rows,
    lines: flattenArtRows(rows),
    display_width: measureArtRowsWidth(rows),
    hide_hero_triad: resolution.guardianStyle === 'semantic' && variant !== 'minimal',
  };
}

/**
 * Small decorative section icons (always keep text labels in the UI).
 * @param {'quick_start'|'readiness'|'recent_runs'} id
 * @param {{ icons?: string, iconMode?: string, art?: string, artMode?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string}
 */
function sectionPixelIcon(id, options = {}) {
  const env = options.env ?? process.env;
  const resolution = resolveArtMode(options, env);
  if (resolution.effective !== 'arcade') return '';
  const iconMode = resolveIconMode(options, env);
  const ascii = iconMode === 'ascii';
  if (id === 'quick_start') return ascii ? '>' : '▶';
  if (id === 'readiness') return ascii ? '#' : '▣';
  if (id === 'recent_runs') return ascii ? 'o' : '◷';
  return '';
}

/**
 * Prefix a section title with a pixel icon when arcade art is active.
 * @param {string} label
 * @param {'quick_start'|'readiness'|'recent_runs'} id
 * @param {object} [options]
 * @returns {string}
 */
function sectionTitleWithPixelIcon(label, id, options = {}) {
  const icon = sectionPixelIcon(id, options);
  if (!icon) return String(label ?? '');
  return `${icon} ${label}`;
}

module.exports = {
  ART_ENV,
  GUARDIAN_STYLE_ENV,
  ART_MODES,
  GUARDIAN_STYLES,
  DEFAULT_ART_MODE,
  DEFAULT_GUARDIAN_STYLE,
  measureArtDisplayWidth,
  measureArtRowsWidth,
  flattenArtRows,
  resolveArtMode,
  resolvePixelCerberusVariant,
  neonCerberusRows,
  semanticCerberusRows,
  buildLandingGuardianArt,
  sectionPixelIcon,
  sectionTitleWithPixelIcon,
};
