/**
 * Minimal ANSI helpers for operator-facing CLI output.
 * Respects NO_COLOR and non-TTY stdout.
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {boolean} [isTTY]
 * @returns {boolean}
 */
export function shouldUseAnsiStdout(env = process.env, isTTY = process.stdout.isTTY) {
  if (env.NO_COLOR != null && String(env.NO_COLOR) !== "") return false;
  return !!isTTY;
}

/**
 * @param {boolean} use
 * @param {string} code SGR parameter(s), e.g. "1;31"
 * @param {string} text
 * @returns {string}
 */
export function ansi(use, code, text) {
  return use ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/**
 * @param {'pass' | 'fail' | 'warn'} status
 * @param {boolean} [useColor]
 * @returns {string}
 */
export function formatStatusTag(status, useColor = shouldUseAnsiStdout()) {
  const label = status === "pass" ? "PASS" : status === "warn" ? "WARN" : "FAIL";
  if (!useColor) return `[${label}]`;
  if (status === "pass") return ansi(true, "32", `[${label}]`);
  if (status === "warn") return ansi(true, "33", `[${label}]`);
  return ansi(true, "1;31", `[${label}]`);
}
