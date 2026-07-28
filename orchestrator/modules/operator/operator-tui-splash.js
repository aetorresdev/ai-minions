'use strict';

/**
 * Brand splash helpers for the Ink fullscreen shell (presentation only).
 * ASCII art — no image assets, no mouse, no capability claims.
 */

const SKIP_ENV = 'AI_MINIONS_TUI_SKIP_SPLASH';
const DEFAULT_SPLASH_MS = 1600;

/**
 * Compact brand mark (readable at ≥40 columns).
 * @returns {string[]}
 */
function splashBannerLines() {
  return [
    '     ╔══════════════════════════════════════╗',
    '     ║            ai-minions               ║',
    '     ║     agent harness · bounded runs     ║',
    '     ╚══════════════════════════════════════╝',
  ];
}

/**
 * Narrow fallback when columns are tight.
 * @returns {string[]}
 */
function splashBannerLinesNarrow() {
  return [
    '  ┌─────────────────────┐',
    '  │    ai-minions       │',
    '  │  agent harness TUI  │',
    '  └─────────────────────┘',
  ];
}

/**
 * @param {{ columns?: number, version?: string, readiness?: string }} [options]
 * @returns {{ lines: string[], subtitle: string, hint: string, tagline: string }}
 */
function buildSplashContent(options = {}) {
  const columns = Number.isFinite(Number(options.columns)) ? Number(options.columns) : 80;
  const version = options.version == null || options.version === ''
    ? 'unknown'
    : String(options.version);
  const readiness = options.readiness == null || options.readiness === ''
    ? 'unknown'
    : String(options.readiness);
  const lines = columns < 56 ? splashBannerLinesNarrow() : splashBannerLines();
  return {
    lines,
    subtitle: `v${version.replace(/^v/i, '')} · readiness=${readiness}`,
    tagline: 'Fullscreen operator shell — keyboard driven',
    hint: 'Press any key to continue · Esc / q skips · auto-continues',
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
  splashBannerLines,
  splashBannerLinesNarrow,
  buildSplashContent,
  shouldSkipSplash,
  resolveSplashDurationMs,
};
