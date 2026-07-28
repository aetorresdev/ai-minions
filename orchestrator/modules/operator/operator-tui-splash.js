'use strict';

/**
 * Brand splash helpers for the Ink fullscreen shell (presentation only).
 * Cerberus brand splash: geometric three-headed ASCII mark
 * (Validate / Trace / Enforce), AI-MINIONS wordmark, triad tagline.
 * Vertically degrades for short TTYs so first paint fits the reported viewport.
 * No image assets, no mouse, no capability claims.
 */

const SKIP_ENV = 'AI_MINIONS_TUI_SKIP_SPLASH';
const DEFAULT_SPLASH_MS = 1600;

const WORDMARK = 'AI-MINIONS';
const PRODUCT_TAGLINE = 'Contract-First Multi-Agent Orchestration Harness';
const TRIAD_LABEL = 'Validate • Trace • Enforce';
const GUARDIAN_MARK = 'CERBERUS';

/**
 * @typedef {'validate' | 'trace' | 'enforce' | 'brand' | 'accent' | 'muted' | 'core' | 'wordmark' | 'warn'} SplashTone
 * @typedef {{ text: string, tone?: SplashTone, bold?: boolean }} SplashSegment
 * @typedef {{ segments: SplashSegment[] }} SplashRow
 */

/**
 * Wide geometric Cerberus (three heads + hex core). Readable at ≥56 columns.
 * Markers VALIDATE / TRACE / ENFORCE / CERBERUS / AI-MINIONS stay in plain text
 * so NO_COLOR remains scannable without color alone.
 * @returns {SplashRow[]}
 */
function splashArtRowsWide() {
  return [
    {
      segments: [
        { text: '           /\\             /\\             /\\', tone: 'muted' },
      ],
    },
    {
      segments: [
        { text: '          /', tone: 'validate' },
        { text: 'V✓', tone: 'validate', bold: true },
        { text: '\\           /', tone: 'muted' },
        { text: 'T◈', tone: 'trace', bold: true },
        { text: '\\           /', tone: 'muted' },
        { text: 'E⬡', tone: 'enforce', bold: true },
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
        { text: ' ◇  ◇ ', tone: 'validate' },
        { text: '|       |', tone: 'trace' },
        { text: ' ◇  ◇ ', tone: 'trace' },
        { text: '|       |', tone: 'enforce' },
        { text: ' ◇  ◇ ', tone: 'enforce' },
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
        { text: '  ◆  ', tone: 'core', bold: true },
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
 * Narrow geometric Cerberus (≥40 columns).
 * @returns {SplashRow[]}
 */
function splashArtRowsNarrow() {
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
        { text: '◆', tone: 'core', bold: true },
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
 * Compact geometric Cerberus for the landing secondary (left) region — no wordmark.
 * Wordmark belongs in the primary content column.
 * @returns {SplashRow[]}
 */
function landingGuardianRowsWide() {
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
        { text: '◇◇', tone: 'validate' },
        { text: '|', tone: 'muted' },
        { text: '◇◇', tone: 'trace' },
        { text: '|', tone: 'muted' },
        { text: '◇◇', tone: 'enforce' },
        { text: '|', tone: 'enforce' },
      ],
    },
    {
      segments: [
        { text: ' \\/ -', tone: 'validate' },
        { text: '◆', tone: 'core', bold: true },
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
 * Reduced guardian for mid-width landing (80–99 cols) — stack-friendly.
 * @returns {SplashRow[]}
 */
function landingGuardianRowsMid() {
  return [
    {
      segments: [
        { text: '/\\ /\\ /\\', tone: 'muted' },
      ],
    },
    {
      segments: [
        { text: 'V', tone: 'validate', bold: true },
        { text: '·', tone: 'muted' },
        { text: 'T', tone: 'trace', bold: true },
        { text: '·', tone: 'muted' },
        { text: 'E', tone: 'enforce', bold: true },
        { text: ' ', tone: 'muted' },
        { text: '◆', tone: 'core', bold: true },
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
 * Plain guardian lines for landing layout mode.
 * @param {'wide'|'mid'|'compact'} layout
 * @returns {string[]}
 */
function landingGuardianPlainLines(layout) {
  if (layout === 'wide') return flattenSplashRows(landingGuardianRowsWide());
  if (layout === 'mid') return flattenSplashRows(landingGuardianRowsMid());
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
 * @returns {string[]}
 */
function splashBannerLines() {
  return flattenSplashRows(splashArtRowsWide());
}

/**
 * Narrow fallback when columns are tight.
 * @returns {string[]}
 */
function splashBannerLinesNarrow() {
  return flattenSplashRows(splashArtRowsNarrow());
}

/**
 * Wordmark as per-character tones (cyan → blue → magenta) when color is on.
 * @returns {SplashSegment[]}
 */
function wordmarkSegments() {
  const chars = WORDMARK.split('');
  const tones = /** @type {SplashTone[]} */ ([
    'validate', 'validate', 'validate',
    'trace', 'trace', 'trace',
    'enforce', 'enforce', 'enforce', 'enforce',
  ]);
  return chars.map((ch, i) => ({
    text: ch,
    tone: tones[i] || 'brand',
    bold: true,
  }));
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
 * @param {{ columns?: number, rows?: number, version?: string, readiness?: string }} [options]
 * @returns {{
 *   lines: string[],
 *   rows: SplashRow[],
 *   density: 'full' | 'compact' | 'minimal',
 *   frameHeight: number,
 *   showProductTagline: boolean,
 *   showSpacers: boolean,
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
  const density = resolveSplashDensity(frameHeight, columns);
  const artRows = density === 'minimal'
    ? splashArtRowsMinimal()
    : (density === 'compact' ? splashArtRowsNarrow() : splashArtRowsWide());
  const lines = flattenSplashRows(artRows);
  const wmSegs = wordmarkSegments();
  const triadSegs = triadSegments();
  return {
    lines,
    rows: artRows,
    density,
    frameHeight,
    showProductTagline: density !== 'minimal',
    showSpacers: density === 'full',
    wordmark: WORDMARK,
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
