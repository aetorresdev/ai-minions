/**
 * Contract metrics for Ink landing snapshots (renderToString).
 * Not visual TTY proof — measures the full virtual tree string after strip-ANSI.
 */

import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';

/** CSI / OSC / common ANSI sequences (no /g — safe for repeated .test). */
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI8 = String.fromCharCode(0x9b);
const ANSI_RE = new RegExp(
  `${ESC}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[()][AB012]|[=>])|${CSI8}[0-9;?]*[ -/]*[@-~]`,
);

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasAnsiEscape(text) {
  return ANSI_RE.test(String(text));
}

/**
 * @param {string} text
 * @param {{ columns: number, rows: number }} viewport
 * @returns {{
 *   rendered_lines: number,
 *   max_display_width: number,
 *   viewport_columns: number,
 *   viewport_rows: number,
 *   has_ansi: boolean,
 *   has_start_new_run: boolean,
 *   has_overall: boolean,
 *   fits_viewport: boolean,
 * }}
 */
export function measureLandingRender(text, viewport) {
  const columns = Number(viewport.columns);
  const rows = Number(viewport.rows);
  const raw = String(text);
  const plain = stripAnsi(raw);
  const lines = plain.replace(/\s+$/, '').split('\n');
  const widths = lines.map((line) => stringWidth(line));
  const rendered_lines = lines.length;
  const max_display_width = widths.length ? Math.max(...widths) : 0;
  const has_start_new_run = /Start New Run/.test(plain);
  const has_overall = /Overall:/.test(plain);
  const fits_viewport =
    rendered_lines <= rows && max_display_width <= columns;
  return {
    rendered_lines,
    max_display_width,
    viewport_columns: columns,
    viewport_rows: rows,
    has_ansi: hasAnsiEscape(raw),
    has_start_new_run,
    has_overall,
    fits_viewport,
  };
}

/**
 * @param {string} text
 * @returns {string}
 */
export function normalizeLandingSnapshot(text) {
  return `${stripAnsi(String(text)).replace(/\s+$/, '')}\n`;
}
