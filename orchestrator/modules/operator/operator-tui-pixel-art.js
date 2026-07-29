'use strict';

/**
 * Terminal-native arcade / pixel-art sprites for the Ink landing.
 * Deterministic cell matrices only — no Kitty/iTerm2/Sixel, no raster I/O,
 * no network, no subprocess on first paint.
 *
 * Semantic Guardians geometry is locked by Cerberus terminal pixel-art lock v2
 * (`terminal-pixel-art.js` + `assets/semantic-guardians-matrix.json`).
 */

const { resolveIconMode } = require('./operator-tui-icons');
const {
  ICONS: LOCK_ICONS,
  MATRIX_COLORS,
  WORDMARK_3X5,
  guardianRows: lockGuardianRows,
} = require('./terminal-pixel-art');

const ART_ENV = 'AI_MINIONS_TUI_ART';
const GUARDIAN_STYLE_ENV = 'AI_MINIONS_TUI_GUARDIAN';
const ART_MODES = Object.freeze(['auto', 'arcade', 'text', 'none']);
const GUARDIAN_STYLES = Object.freeze(['neon', 'semantic']);
/** Fail-closed documented default when ART_ENV is missing or invalid. */
const DEFAULT_ART_MODE = 'auto';
/**
 * Semantic Guardians (lock v2) is the operator default first paint.
 * Neon remains available via AI_MINIONS_TUI_GUARDIAN=neon (comparison checkpoint).
 */
const DEFAULT_GUARDIAN_STYLE = 'semantic';
/** Lock v2 3×5 block wordmark text (matches terminal-pixel-art drawWordmark). */
const BRAND_WORDMARK = 'AI-MINIONS';
/** Pixel wordmark terminal rows (3×5 glyphs). */
const PIXEL_WORDMARK_ROWS = 5;

/** Map lock palette hex → splash ArtTone for Ink theme coloring. */
const HEX_TO_TONE = Object.freeze({
  [MATRIX_COLORS.C]: 'validate',
  [MATRIX_COLORS.B]: 'validate',
  [MATRIX_COLORS.V]: 'trace',
  [MATRIX_COLORS.M]: 'trace',
  [MATRIX_COLORS.A]: 'enforce',
});

/**
 * @typedef {'auto'|'arcade'|'text'|'none'} ArtMode
 * @typedef {'neon'|'semantic'} GuardianStyle
 * @typedef {'wide'|'compact'|'minimal'} CerberusVariant
 * @typedef {'validate'|'trace'|'enforce'|'brand'|'accent'|'muted'|'core'|'wordmark'|'warn'|'gradient-cyan'|'gradient-violet'|'gradient-amber'} ArtTone
 * @typedef {{ text: string, tone?: ArtTone, bold?: boolean }} ArtSegment
 * @typedef {{ segments: ArtSegment[] }} ArtRow
 * @typedef {{
 *   requested: string,
 *   mode: ArtMode,
 *   effective: 'arcade'|'text'|'none',
 *   reason: string | null,
 *   guardianStyle: GuardianStyle,
 *   guardianStyleRequested: string,
 *   guardianStyleReason: string | null,
 * }} ArtResolution
 */

/**
 * Approximate terminal column width for sprite cells (no ANSI).
 * @param {string} text
 * @returns {number}
 */
function measureArtDisplayWidth(text) {
  let width = 0;
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) continue;
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
    guardianStyleRequested: styleRequested || DEFAULT_GUARDIAN_STYLE,
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
 * Map landing layout → lock matrix variant name.
 * @param {CerberusVariant} variant
 * @returns {'showcase'|'wide'|'compact'|null}
 */
function lockVariantForCerberus(variant) {
  if (variant === 'wide') return 'wide';
  if (variant === 'compact') return 'compact';
  return null;
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
 * Convert lock cell rows (char/fg) into Ink ArtRows (tone segments).
 * @param {Array<Array<{ char: string, fg: string | null }>>} cellRows
 * @returns {ArtRow[]}
 */
function cellRowsToArtRows(cellRows) {
  return (cellRows || []).map((cells) => {
    /** @type {ArtSegment[]} */
    const segments = [];
    for (const cell of cells) {
      const tone = cell.fg ? (HEX_TO_TONE[cell.fg] || 'muted') : 'muted';
      const prev = segments.at(-1);
      if (prev && prev.tone === tone && !prev.bold) {
        prev.text += cell.char;
      } else {
        segments.push({ text: cell.char, tone });
      }
    }
    return { segments };
  });
}

/**
 * Per-character brand gradient tones (cyan → violet → amber).
 * @param {number} index
 * @param {number} length
 * @param {boolean} useGradient
 * @returns {ArtTone}
 */
function wordmarkToneForIndex(index, length, useGradient) {
  if (!useGradient) return 'brand';
  const n = Math.max(1, length);
  const t = index / n;
  if (t < 1 / 3) return 'gradient-cyan';
  if (t < 2 / 3) return 'gradient-violet';
  return 'gradient-amber';
}

/**
 * Lock v2 3×5 block wordmark as ArtRows (arcade path).
 * Truecolor callers paint gradient tones; otherwise single brand tone.
 * ASCII / text paths return [] so Ink keeps readable uppercase text.
 *
 * @param {{
 *   icons?: string,
 *   iconMode?: string,
 *   truecolor?: boolean,
 *   art?: string,
 *   artMode?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 * @returns {ArtRow[]}
 */
function buildPixelWordmarkRows(options = {}) {
  const env = options.env ?? process.env;
  const resolution = resolveArtMode(options, env);
  if (resolution.effective !== 'arcade') return [];
  const iconMode = resolveIconMode(options, env);
  if (iconMode === 'ascii') return [];

  const useGradient = options.truecolor === true;
  const chars = BRAND_WORDMARK.split('');
  /** @type {ArtRow[]} */
  const rows = [];
  for (let r = 0; r < PIXEL_WORDMARK_ROWS; r += 1) {
    /** @type {ArtSegment[]} */
    const segments = [];
    chars.forEach((ch, idx) => {
      const glyph = WORDMARK_3X5[ch];
      if (!glyph) return;
      const tone = wordmarkToneForIndex(idx, chars.length, useGradient);
      const bits = glyph[r] || '';
      let block = '';
      for (const bit of bits) {
        block += bit === '1' ? '█' : ' ';
      }
      segments.push(seg(block, tone, true));
      if (idx < chars.length - 1) {
        segments.push(seg(' ', 'muted'));
      }
    });
    rows.push(row(...segments));
  }
  return rows;
}

/**
 * Plain per-character wordmark segments (gradient when truecolor).
 * @param {{ truecolor?: boolean, text?: string }} [options]
 * @returns {ArtSegment[]}
 */
function buildTextWordmarkSegments(options = {}) {
  const text = options.text == null || options.text === ''
    ? BRAND_WORDMARK
    : String(options.text);
  const useGradient = options.truecolor === true;
  const chars = text.split('');
  return chars.map((ch, i) => seg(
    ch,
    wordmarkToneForIndex(i, chars.length, useGradient),
    true,
  ));
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
 * Label offsets under lock heads (matches terminal-pixel-art drawGuardianLabels).
 * @param {'showcase'|'wide'|'compact'} lockVariant
 * @returns {ArtRow}
 */
function semanticLabelRow(lockVariant) {
  const positions = lockVariant === 'showcase'
    ? [
      ['VALIDATE', 5, 'validate'],
      ['TRACE', 32, 'trace'],
      ['ENFORCE', 55, 'enforce'],
    ]
    : lockVariant === 'wide'
      ? [
        ['VALIDATE', 4, 'validate'],
        ['TRACE', 27, 'trace'],
        ['ENFORCE', 47, 'enforce'],
      ]
      : [
        ['VALIDATE', 1, 'validate'],
        ['TRACE', 20, 'trace'],
        ['ENFORCE', 33, 'enforce'],
      ];
  const width = lockVariant === 'showcase' ? 68 : (lockVariant === 'wide' ? 58 : 42);
  /** @type {ArtSegment[]} */
  const segments = [];
  let cursor = 0;
  for (const [label, offset, tone] of positions) {
    if (offset > cursor) {
      segments.push({ text: ' '.repeat(offset - cursor), tone: 'muted' });
      cursor = offset;
    }
    segments.push({ text: label, tone: /** @type {ArtTone} */ (tone), bold: true });
    cursor += label.length;
  }
  if (cursor < width) {
    segments.push({ text: ' '.repeat(width - cursor), tone: 'muted' });
  }
  return { segments };
}

/**
 * Semantic Guardians — Cerberus lock v2 braille matrices (faithful heads).
 * Labels under heads replace the hero triad. No generic ▶/▣/◷ substitutes.
 * @param {CerberusVariant} variant
 * @param {string} iconMode
 * @returns {ArtRow[]}
 */
function semanticCerberusRows(variant, iconMode) {
  const ascii = resolveIconMode({ icons: iconMode }) === 'ascii';
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
  const lockVariant = lockVariantForCerberus(variant) || 'compact';
  if (ascii) {
    const textRows = lockGuardianRows(lockVariant, 'text');
    return [...cellRowsToArtRows(textRows), semanticLabelRow(lockVariant)];
  }
  const artRows = cellRowsToArtRows(lockGuardianRows(lockVariant, 'braille'));
  return [...artRows, semanticLabelRow(lockVariant)];
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
 * Lock v2 section icons — Braille dot matrices (not generic ▶/▣/◷).
 * Icons are two Braille rows; callers must render the full block (no silent truncate).
 * @param {'quick_start'|'readiness'|'recent_runs'} id
 * @param {{ icons?: string, iconMode?: string, art?: string, artMode?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string[]}
 */
function sectionPixelIconRows(id, options = {}) {
  const env = options.env ?? process.env;
  const resolution = resolveArtMode(options, env);
  if (resolution.effective !== 'arcade') return [];
  const iconMode = resolveIconMode(options, env);
  const ascii = iconMode === 'ascii';
  if (ascii) {
    if (id === 'quick_start') return ['>'];
    if (id === 'readiness') return ['#'];
    if (id === 'recent_runs') return ['o'];
    return [];
  }
  const lockIcon = id === 'quick_start'
    ? LOCK_ICONS.quickStart
    : (id === 'readiness'
      ? LOCK_ICONS.readiness
      : (id === 'recent_runs' ? LOCK_ICONS.recentRuns : null));
  if (!lockIcon || !lockIcon.length) return [];
  return lockIcon.map((row) => row.map((cell) => cell.char).join('').trimEnd());
}

/**
 * Single-line join of lock icon rows (tests / plain-text). Prefer sectionPixelIconRows
 * + block render in Ink so both Braille rows stay visible.
 * @param {'quick_start'|'readiness'|'recent_runs'} id
 * @param {{ icons?: string, iconMode?: string, art?: string, artMode?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string}
 */
function sectionPixelIcon(id, options = {}) {
  return sectionPixelIconRows(id, options).join('\n');
}

/**
 * Structured section title with full lock icon block (all Braille rows).
 * @param {string} label
 * @param {'quick_start'|'readiness'|'recent_runs'} id
 * @param {object} [options]
 * @returns {{ lines: string[], label: string } | string}
 */
function sectionTitleWithPixelIcon(label, id, options = {}) {
  const lines = sectionPixelIconRows(id, options);
  const text = String(label ?? '');
  if (!lines.length) return text;
  return { lines, label: text };
}

/**
 * Stable debug/evidence line for art resolution (survives remounts when
 * options carry `requested` or env still holds the invalid value).
 * @param {ArtResolution | null | undefined} resolution
 * @returns {string | null}
 */
function formatArtResolutionDebug(resolution) {
  if (!resolution || typeof resolution !== 'object') return null;
  const parts = [
    `art_requested=${resolution.requested}`,
    `art_mode=${resolution.mode}`,
    `art_effective=${resolution.effective}`,
    `guardian=${resolution.guardianStyle}`,
  ];
  if (resolution.reason) parts.push(`art_reason=${resolution.reason}`);
  if (resolution.guardianStyleReason) {
    parts.push(`guardian_reason=${resolution.guardianStyleReason}`);
  }
  return parts.join(' ');
}

module.exports = {
  ART_ENV,
  GUARDIAN_STYLE_ENV,
  ART_MODES,
  GUARDIAN_STYLES,
  DEFAULT_ART_MODE,
  DEFAULT_GUARDIAN_STYLE,
  BRAND_WORDMARK,
  PIXEL_WORDMARK_ROWS,
  measureArtDisplayWidth,
  measureArtRowsWidth,
  flattenArtRows,
  resolveArtMode,
  resolvePixelCerberusVariant,
  neonCerberusRows,
  semanticCerberusRows,
  buildPixelWordmarkRows,
  buildTextWordmarkSegments,
  buildLandingGuardianArt,
  sectionPixelIcon,
  sectionPixelIconRows,
  sectionTitleWithPixelIcon,
  formatArtResolutionDebug,
};
