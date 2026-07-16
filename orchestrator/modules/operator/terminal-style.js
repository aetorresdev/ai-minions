"use strict";

/**
 * Shared ANSI policy for operator CLI human stdout.
 * NO_COLOR wins over --color=always. JSON / markdown writers must pass useColor=false.
 */

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'auto'|'always'|'never'}
 */
function resolveColorMode(argv = process.argv.slice(2), env = process.env) {
  if (env.NO_COLOR != null && String(env.NO_COLOR) !== "") return "never";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--color=")) {
      const v = a.slice("--color=".length).trim().toLowerCase();
      if (v === "auto" || v === "always" || v === "never") return v;
    }
    if (a === "--color" && argv[i + 1]) {
      const v = String(argv[i + 1]).trim().toLowerCase();
      if (v === "auto" || v === "always" || v === "never") return v;
    }
  }
  return "auto";
}

/**
 * @param {'auto'|'always'|'never'} mode
 * @param {boolean} [isTTY]
 * @returns {boolean}
 */
function shouldUseAnsi(mode, isTTY = process.stdout.isTTY) {
  if (mode === "never") return false;
  if (mode === "always") return true;
  return !!isTTY;
}

/**
 * @param {boolean} use
 * @param {string} code
 * @param {string} text
 * @returns {string}
 */
function ansi(use, code, text) {
  return use ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/**
 * @param {'pass'|'fail'|'warn'} status
 * @param {boolean} [useColor]
 * @returns {string}
 */
function formatStatusTag(status, useColor = false) {
  const label = status === "pass" ? "PASS" : status === "warn" ? "WARN" : "FAIL";
  if (!useColor) return `[${label}]`;
  if (status === "pass") return ansi(true, "32", `[${label}]`);
  if (status === "warn") return ansi(true, "33", `[${label}]`);
  return ansi(true, "1;31", `[${label}]`);
}

/**
 * @param {string} outcome
 * @param {boolean} useColor
 * @returns {string}
 */
function colorOutcome(outcome, useColor) {
  const o = String(outcome || "");
  if (!useColor) return o;
  if (o === "complete" || o === "ok" || o === "success") return ansi(true, "32", o);
  if (o === "blocked" || o === "failed" || o === "fail") return ansi(true, "1;31", o);
  if (o === "degraded" || o === "warn") return ansi(true, "33", o);
  return o;
}

/**
 * @param {boolean} ok
 * @param {boolean} useColor
 * @returns {string}
 */
function colorOk(ok, useColor) {
  const s = String(ok);
  if (!useColor) return s;
  return ok ? ansi(true, "32", s) : ansi(true, "1;31", s);
}

/**
 * @param {string[]} argv
 * @param {{ json?: boolean, isTTY?: boolean, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {boolean}
 */
function resolveUseColorForCli(argv, opts = {}) {
  if (opts.json === true) return false;
  const mode = resolveColorMode(argv, opts.env ?? process.env);
  return shouldUseAnsi(mode, opts.isTTY ?? process.stdout.isTTY);
}

module.exports = {
  resolveColorMode,
  shouldUseAnsi,
  ansi,
  formatStatusTag,
  colorOutcome,
  colorOk,
  resolveUseColorForCli,
};
