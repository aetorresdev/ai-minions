/**
 * ESM bridge to shared operator ANSI policy (CJS SoT).
 * Prefer orchestrator/modules/operator/terminal-style.js for new CJS callers.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const style = require("../../orchestrator/modules/operator/terminal-style.js");

export const resolveColorMode = style.resolveColorMode;
export const shouldUseAnsi = style.shouldUseAnsi;
export const ansi = style.ansi;
export const formatStatusTag = style.formatStatusTag;
export const colorOutcome = style.colorOutcome;
export const colorOk = style.colorOk;
export const resolveUseColorForCli = style.resolveUseColorForCli;

/** @deprecated Prefer shouldUseAnsi(resolveColorMode(), isTTY) */
export function shouldUseAnsiStdout(env = process.env, isTTY = process.stdout.isTTY) {
  return style.shouldUseAnsi(style.resolveColorMode([], env), isTTY);
}
