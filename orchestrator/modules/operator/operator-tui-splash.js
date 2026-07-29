'use strict';

/**
 * Brand splash helpers for the Ink fullscreen shell (presentation only).
 * Cerberus textual / Nerd component (wide | compact | minimal) — never PNG.
 * Icon modes: nerd | unicode | ascii (explicit operator choice; no auto-tofu claims).
 * Vertically degrades for short TTYs so first paint fits the reported viewport.
 */

const {
  resolveIconMode,
  chromeIconsFor,
  DEFAULT_ICON_MODE,
} = require('./operator-tui-icons');
const {
  resolveArtMode,
  resolvePixelCerberusVariant,
  neonCerberusRows,
  semanticCerberusRows,
  buildPixelWordmarkRows,
  buildTextWordmarkSegments,
  flattenArtRows,
  BRAND_WORDMARK,
} = require('./operator-tui-pixel-art');

const SKIP_ENV = 'AI_MINIONS_TUI_SKIP_SPLASH';
const DEFAULT_SPLASH_MS = 1600;

const WORDMARK = 'AI-MINIONS';
const PRODUCT_TAGLINE = 'Contract-First Multi-Agent Orchestration Harness';
const TRIAD_LABEL = 'Validate • Trace • Enforce';
const GUARDIAN_MARK = 'CERBERUS';

/**
 * @typedef {'validate' | 'trace' | 'enforce' | 'brand' | 'accent' | 'muted' | 'core' | 'wordmark' | 'warn' | 'gradient-cyan' | 'gradient-violet' | 'gradient-amber'} SplashTone
 * @typedef {{ text: string, tone?: SplashTone, bold?: boolean }} SplashSegment
 * @typedef {{ segments: SplashSegment[] }} SplashRow
 */

/**
 * Glyph accents for Cerberus art by icon mode.
 * @param {string} [iconMode]
 */
function artGlyphs(iconMode) {
  const icons = chromeIconsFor(iconMode || DEFAULT_ICON_MODE);
  const mode = resolveIconMode({ icons: iconMode });
  if (mode === 'ascii') {
    return {
      ok: '+',
      traceMark: '*',
      enforceMark: '#',
      eye: 'o',
      core: '*',
      sep: '-',
      mid: '.',
    };
  }
  if (mode === 'nerd') {
    return {
      ok: icons.ok,
      traceMark: '\uf1db', // nf-fa-circle-o / ring-ish
      enforceMark: '\uf0e7', // nf-fa-bolt
      eye: icons.eye,
      core: icons.core,
      sep: '-',
      mid: '·',
    };
  }
  // unicode (portable mid set)
  return {
    ok: '✓',
    traceMark: '◈',
    enforceMark: '⬡',
    eye: '◇',
    core: '◆',
    sep: '-',
    mid: '·',
  };
}

/**
 * Wide geometric Cerberus (three heads + core). Readable at ≥56 columns.
 * Markers VALIDATE / TRACE / ENFORCE / CERBERUS / AI-MINIONS stay in plain text
 * so NO_COLOR remains scannable without color alone.
 * @param {string} [iconMode]
 * @returns {SplashRow[]}
 */
function splashArtRowsWide(iconMode) {
  const g = artGlyphs(iconMode);
  return [
    {
      segments: [
        { text: '           /\\             /\\             /\\', tone: 'muted' },
      ],
    },
    {
      segments: [
        { text: '          /', tone: 'validate' },
        { text: `V${g.ok}`, tone: 'validate', bold: true },
        { text: '\\           /', tone: 'muted' },
        { text: `T${g.traceMark}`, tone: 'trace', bold: true },
        { text: '\\           /', tone: 'muted' },
        { text: `E${g.enforceMark}`, tone: 'enforce', bold: true },
        { text: '\\', tone: 'enforce' },
      ],
    },
    {
      segments: [
        { text: '         /', tone: 'validate' },
        { text: ' /\\ ', tone: 'validate' },
        { text: '\\         /', tone: 'trace' },
        { text: ' /\\ ', tone: 'trace' },
        { text: '\\         /', tone: 'enforce' },
        { text: ' /\\ ', tone: 'enforce' },
        { text: '\\', tone: 'enforce' },
      ],
    },
    {
      segments: [
        { text: '        |', tone: 'validate' },
        { text: ` ${g.eye}  ${g.eye} `, tone: 'validate' },
        { text: '|       |', tone: 'trace' },
        { text: ` ${g.eye}  ${g.eye} `, tone: 'trace' },
        { text: '|       |', tone: 'enforce' },
        { text: ` ${g.eye}  ${g.eye} `, tone: 'enforce' },
        { text: '|', tone: 'enforce' },
      ],
    },
    {
      segments: [
        { text: '         \\', tone: 'validate' },
        { text: ' \\/ ', tone: 'validate' },
        { text: '/---------\\', tone: 'core' },
        { text: ' \\/ ', tone: 'trace' },
        { text: '/---------\\', tone: 'core' },
        { text: ' \\/ ', tone: 'enforce' },
        { text: '/', tone: 'enforce' },
      ],
    },
    {
      segments: [
        { text: '          \\  /     ', tone: 'muted' },
        { text: '___/ \\___', tone: 'core' },
        { text: '     \\  /', tone: 'muted' },
      ],
    },
    {
      segments: [
        { text: '           \\/     /', tone: 'muted' },
        { text: `  ${g.core}  `, tone: 'core', bold: true },
        { text: '\\     \\/', tone: 'muted' },
      ],
    },
    {
      segments: [
        { text: '                 | ', tone: 'muted' },
        { text: 'CORE', tone: 'core', bold: true },
        { text: ' |', tone: 'muted' },
      ],
    },
    {
      segments: [
        { text: '                  \\___/', tone: 'core' },
      ],
    },
    {
      segments: [
        { text: '     ', tone: 'muted' },
        { text: 'VALIDATE', tone: 'validate', bold: true },
        { text: '        ', tone: 'muted' },
        { text: 'TRACE', tone: 'trace', bold: true },
        { text: '         ', tone: 'muted' },
        { text: 'ENFORCE', tone: 'enforce', bold: true },
      ],
    },
    {
      segments: [
        { text: '                    ', tone: 'muted' },
        { text: GUARDIAN_MARK, tone: 'brand', bold: true },
      ],
    },
    {
      segments: [
        { text: '                   ', tone: 'muted' },
        { text: WORDMARK, tone: 'brand', bold: true },
      ],
    },
  ];
}

/**
 * Narrow geometric Cerberus (≥40 columns) — compact variant.
 * @param {string} [iconMode]
 * @returns {SplashRow[]}
 */
function splashArtRowsNarrow(iconMode) {
  const g = artGlyphs(iconMode);
  return [
    {
      segments: [
        { text: '  /\\   /\\   /\\', tone: 'muted' },
      ],
    },
    {
      segments: [
        { text: ' /', tone: 'validate' },
        { text: 'V', tone: 'validate', bold: true },
        { text: '\\ /', tone: 'muted' },
        { text: 'T', tone: 'trace', bold: true },
        { text: '\\ /', tone: 'muted' },
        { text: 'E', tone: 'enforce', bold: true },
        { text: '\\', tone: 'enforce' },
      ],
    },
    {
      segments: [
        { text: ' \\/ -', tone: 'validate' },
        { text: g.core, tone: 'core', bold: true },
        { text: '- \\/', tone: 'enforce' },
      ],
    },
    {
      segments: [
        { text: ' ', tone: 'muted' },
        { text: 'VALIDATE', tone: 'validate', bold: true },
        { text: ' ', tone: 'muted' },
        { text: 'TRACE', tone: 'trace', bold: true },
        { text: ' ', tone: 'muted' },
        { text: 'ENFORCE', tone: 'enforce', bold: true },
      ],
    },
    {
      segments: [
        { text: '    ', tone: 'muted' },
        { text: GUARDIAN_MARK, tone: 'brand', bold: true },
      ],
    },
    {
      segments: [
        { text: '   ', tone: 'muted' },
        { text: WORDMARK, tone: 'brand', bold: true },
      ],
    },
  ];
}

/**
 * Minimal brand mark for short viewports (few rows).
 * @returns {SplashRow[]}
 */
function splashArtRowsMinimal() {
  return [
    {
      segments: [
        { text: GUARDIAN_MARK, tone: 'brand', bold: true },
      ],
    },
    {
      segments: [
        { text: WORDMARK, tone: 'brand', bold: true },
      ],
    },
  ];
}

/**
 * Wide landing secondary Cerberus — no wordmark (wordmark stays in primary column).
 * @param {string} [iconMode]
 * @returns {SplashRow[]}
 */
function landingGuardianRowsWide(iconMode) {
  const g = artGlyphs(iconMode);
  return [
    {
      segments: [
        { text: '  /\\   /\\   /\\', tone: 'muted' },
      ],
    },
    {
      segments: [
        { text: ' /', tone: 'validate' },
        { text: 'V', tone: 'validate', bold: true },
        { text: '\\ /', tone: 'muted' },
        { text: 'T', tone: 'trace', bold: true },
        { text: '\\ /', tone: 'muted' },
        { text: 'E', tone: 'enforce', bold: true },
        { text: '\\', tone: 'enforce' },
      ],
    },
    {
      segments: [
        { text: ' |', tone: 'validate' },
        { text: `${g.eye}${g.eye}`, tone: 'validate' },
        { text: '|', tone: 'muted' },
        { text: `${g.eye}${g.eye}`, tone: 'trace' },
        { text: '|', tone: 'muted' },
        { text: `${g.eye}${g.eye}`, tone: 'enforce' },
        { text: '|', tone: 'enforce' },
      ],
    },
    {
      segments: [
        { text: ' \\/ -', tone: 'validate' },
        { text: g.core, tone: 'core', bold: true },
        { text: '- \\/', tone: 'enforce' },
      ],
    },
    {
      segments: [
        { text: ' ', tone: 'muted' },
        { text: 'VALIDATE', tone: 'validate', bold: true },
        { text: ' ', tone: 'muted' },
        { text: 'TRACE', tone: 'trace', bold: true },
        { text: ' ', tone: 'muted' },
        { text: 'ENFORCE', tone: 'enforce', bold: true },
      ],
    },
    {
      segments: [
        { text: '    ', tone: 'muted' },
        { text: GUARDIAN_MARK, tone: 'brand', bold: true },
      ],
    },
  ];
}

/**
 * Compact landing guardian (mid-width) — stack-friendly.
 * @param {string} [iconMode]
 * @returns {SplashRow[]}
 */
function landingGuardianRowsMid(iconMode) {
  const g = artGlyphs(iconMode);
  return [
    {
      segments: [
        { text: '/\\ /\\ /\\', tone: 'muted' },
      ],
    },
    {
      segments: [
        { text: 'V', tone: 'validate', bold: true },
        { text: g.mid, tone: 'muted' },
        { text: 'T', tone: 'trace', bold: true },
        { text: g.mid, tone: 'muted' },
        { text: 'E', tone: 'enforce', bold: true },
        { text: ' ', tone: 'muted' },
        { text: g.core, tone: 'core', bold: true },
      ],
    },
    {
      segments: [
        { text: GUARDIAN_MARK, tone: 'brand', bold: true },
      ],
    },
  ];
}

/**
 * Minimal landing / splash guardian (label only).
 * @returns {SplashRow[]}
 */
function landingGuardianRowsMinimal() {
  return [
    {
      segments: [
        { text: GUARDIAN_MARK, tone: 'brand', bold: true },
      ],
    },
  ];
}

/**
 * Plain guardian lines for landing layout mode.
 * @param {'wide'|'mid'|'compact'} layout
 * @param {string} [iconMode]
 * @returns {string[]}
 */
function landingGuardianPlainLines(layout, iconMode) {
  if (layout === 'wide') return flattenSplashRows(landingGuardianRowsWide(iconMode));
  if (layout === 'mid') return flattenSplashRows(landingGuardianRowsMid(iconMode));
  return [];
}

/**
 * Flatten splash rows to plain lines (NO_COLOR / assertions).
 * @param {SplashRow[]} rows
 * @returns {string[]}
 */
function flattenSplashRows(rows) {
  return rows.map((row) => (row.segments || []).map((s) => s.text).join(''));
}

/**
 * Resolve splash frame height from the reported TTY row count.
 * Fits the viewport — never pads up to a 24-row minimum.
 * @param {unknown} rows
 * @param {number} [fallback]
 * @returns {number}
 */
function resolveSplashFrameHeight(rows, fallback = 24) {
  const n = Number(rows);
  if (!Number.isFinite(n) || n < 1) {
    const fb = Number(fallback);
    return Number.isFinite(fb) && fb >= 1 ? Math.floor(fb) : 24;
  }
  return Math.floor(n);
}

/**
 * Vertical density for splash art + chrome given reported rows.
 * @param {number} rows
 * @param {number} columns
 * @returns {'full' | 'compact' | 'minimal'}
 */
function resolveSplashDensity(rows, columns) {
  const r = resolveSplashFrameHeight(rows);
  const narrow = columns < 56;
  if (r < 16) return 'minimal';
  if (r < 24 || narrow) return 'compact';
  return 'full';
}

/**
 * Compact brand mark (readable at ≥56 columns) — Cerberus brand splash wide art.
 * @param {string} [iconMode]
 * @returns {string[]}
 */
function splashBannerLines(iconMode) {
  return flattenSplashRows(splashArtRowsWide(iconMode));
}

/**
 * Narrow fallback when columns are tight.
 * @param {string} [iconMode]
 * @returns {string[]}
 */
function splashBannerLinesNarrow(iconMode) {
  return flattenSplashRows(splashArtRowsNarrow(iconMode));
}

/**
 * Wordmark as per-character tones. When truecolor is available, cyan→violet→amber
 * gradient tones; otherwise a single brand tone (hierarchy still works under NO_COLOR).
 * @param {{ truecolor?: boolean }} [options]
 * @returns {SplashSegment[]}
 */
function wordmarkSegments(options = {}) {
  return buildTextWordmarkSegments({
    truecolor: options.truecolor === true,
    text: WORDMARK,
  });
}

/**
 * Triad tagline segments with explicit Validate / Trace / Enforce colors.
 * @returns {SplashSegment[]}
 */
function triadSegments() {
  return [
    { text: 'Validate', tone: 'validate', bold: true },
    { text: ' • ', tone: 'muted' },
    { text: 'Trace', tone: 'trace', bold: true },
    { text: ' • ', tone: 'muted' },
    { text: 'Enforce', tone: 'enforce', bold: true },
  ];
}

/**
 * @param {{
 *   columns?: number,
 *   rows?: number,
 *   version?: string,
 *   readiness?: string,
 *   icons?: string,
 *   iconMode?: string,
 *   truecolor?: boolean,
 *   art?: string,
 *   artMode?: string,
 *   guardianStyle?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 * @returns {{
 *   lines: string[],
 *   rows: SplashRow[],
 *   wordmarkRows: SplashRow[],
 *   density: 'full' | 'compact' | 'minimal',
 *   cerberusVariant: 'wide' | 'compact' | 'minimal',
 *   iconMode: string,
 *   guardianStyle: string,
 *   frameHeight: number,
 *   showProductTagline: boolean,
 *   showSpacers: boolean,
 *   showTriad: boolean,
 *   wordmark: string,
 *   wordmarkSegments: SplashSegment[],
 *   productTagline: string,
 *   triad: string,
 *   triadSegments: SplashSegment[],
 *   guardian: string,
 *   subtitle: string,
 *   hint: string,
 *   tagline: string,
 *   disclaimer: string,
 * }}
 */
function buildSplashContent(options = {}) {
  const columns = Number.isFinite(Number(options.columns)) ? Number(options.columns) : 80;
  const frameHeight = resolveSplashFrameHeight(options.rows);
  const version = options.version == null || options.version === ''
    ? 'unknown'
    : String(options.version);
  const readiness = options.readiness == null || options.readiness === ''
    ? 'unknown'
    : String(options.readiness);
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const iconMode = resolveIconMode(options, env);
  const density = resolveSplashDensity(frameHeight, columns);
  const cerberusVariant = density === 'minimal'
    ? 'minimal'
    : (density === 'compact' ? 'compact' : 'wide');
  const truecolor = options.truecolor === true;
  const resolution = resolveArtMode({
    art: options.art,
    artMode: options.artMode,
    guardianStyle: options.guardianStyle,
  }, env);
  const pixelVariant = resolvePixelCerberusVariant(
    density === 'full' ? 'wide' : (density === 'compact' ? 'mid' : 'compact'),
  );

  /** @type {SplashRow[]} */
  let artRows;
  if (resolution.effective === 'arcade') {
    artRows = resolution.guardianStyle === 'semantic'
      ? semanticCerberusRows(pixelVariant, iconMode)
      : neonCerberusRows(pixelVariant, iconMode);
  } else if (density === 'minimal') {
    artRows = splashArtRowsMinimal();
  } else if (density === 'compact') {
    artRows = splashArtRowsNarrow(iconMode);
  } else {
    artRows = splashArtRowsWide(iconMode);
  }

  /** @type {SplashRow[]} */
  let wordmarkRows = [];
  if (resolution.effective === 'arcade' && density === 'full' && columns >= 56) {
    wordmarkRows = buildPixelWordmarkRows({
      icons: iconMode,
      art: 'arcade',
      truecolor,
      env,
    });
  }
  if (resolution.effective === 'arcade') {
    artRows = artRows.filter((row) => {
      const line = (row.segments || []).map((s) => s.text).join('');
      return !/\bAI-MINIONS\b/.test(line);
    });
    const flatArt = flattenArtRows(artRows).join('\n');
    if (!/\bCERBERUS\b/.test(flatArt)) {
      artRows = [
        ...artRows,
        { segments: [{ text: GUARDIAN_MARK, tone: 'brand', bold: true }] },
      ];
    }
  }

  const wmSegs = wordmarkSegments({ truecolor });
  // Pixel art + scannable uppercase line (gradient when truecolor; plain under NO_COLOR).
  wordmarkRows = [...wordmarkRows, { segments: wmSegs }];

  const lines = [
    ...flattenArtRows(artRows),
    ...flattenArtRows(wordmarkRows),
  ];
  const triadSegs = triadSegments();
  const showTriad = !(
    resolution.effective === 'arcade'
    && resolution.guardianStyle === 'semantic'
    && pixelVariant !== 'minimal'
  );
  return {
    lines,
    rows: artRows,
    wordmarkRows,
    density,
    cerberusVariant,
    iconMode,
    guardianStyle: resolution.guardianStyle,
    frameHeight,
    showProductTagline: density !== 'minimal',
    showSpacers: density === 'full',
    showTriad,
    wordmark: BRAND_WORDMARK,
    wordmarkSegments: wmSegs,
    productTagline: PRODUCT_TAGLINE,
    triad: TRIAD_LABEL,
    triadSegments: triadSegs,
    guardian: GUARDIAN_MARK,
    subtitle: `v${version.replace(/^v/i, '')} · readiness=${readiness}`,
    tagline: PRODUCT_TAGLINE,
    hint: 'Press any key to continue · Esc / q skips · auto-continues',
    disclaimer: 'Presentation polish only — not Web UI · not mouse · not durable resume',
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function shouldSkipSplash(env = process.env) {
  const raw = String(env[SKIP_ENV] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'skip';
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function resolveSplashDurationMs(value, fallback = DEFAULT_SPLASH_MS) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), 30_000);
}

module.exports = {
  SKIP_ENV,
  DEFAULT_SPLASH_MS,
  WORDMARK,
  PRODUCT_TAGLINE,
  TRIAD_LABEL,
  GUARDIAN_MARK,
  splashArtRowsWide,
  splashArtRowsNarrow,
  splashArtRowsMinimal,
  landingGuardianRowsWide,
  landingGuardianRowsMid,
  landingGuardianRowsMinimal,
  landingGuardianPlainLines,
  splashBannerLines,
  splashBannerLinesNarrow,
  flattenSplashRows,
  resolveSplashFrameHeight,
  resolveSplashDensity,
  wordmarkSegments,
  triadSegments,
  buildSplashContent,
  shouldSkipSplash,
  resolveSplashDurationMs,
};
