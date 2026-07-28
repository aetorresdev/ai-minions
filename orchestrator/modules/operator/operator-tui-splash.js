'use strict';

/**
 * Brand splash helpers for the Ink fullscreen shell (presentation only).
 * Cerberus option C direction: geometric three-headed ASCII mark
 * (Validate / Trace / Enforce), AI-MINIONS wordmark, triad tagline.
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
 * Flatten splash rows to plain lines (NO_COLOR / assertions).
 * @param {SplashRow[]} rows
 * @returns {string[]}
 */
function flattenSplashRows(rows) {
  return rows.map((row) => (row.segments || []).map((s) => s.text).join(''));
}

/**
 * Compact brand mark (readable at ≥56 columns) — Cerberus option C wide art.
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
 * @param {{ columns?: number, version?: string, readiness?: string }} [options]
 * @returns {{
 *   lines: string[],
 *   rows: SplashRow[],
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
  const version = options.version == null || options.version === ''
    ? 'unknown'
    : String(options.version);
  const readiness = options.readiness == null || options.readiness === ''
    ? 'unknown'
    : String(options.readiness);
  const narrow = columns < 56;
  const artRows = narrow ? splashArtRowsNarrow() : splashArtRowsWide();
  const lines = flattenSplashRows(artRows);
  const wmSegs = wordmarkSegments();
  const triadSegs = triadSegments();
  return {
    lines,
    rows: artRows,
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
  splashBannerLines,
  splashBannerLinesNarrow,
  flattenSplashRows,
  wordmarkSegments,
  triadSegments,
  buildSplashContent,
  shouldSkipSplash,
  resolveSplashDurationMs,
};
