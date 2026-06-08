"use strict";

/**
 * Match branch name against explicit name or simple glob (`prefix/*`).
 *
 * @param {string} branch
 * @param {string} pattern
 * @returns {boolean}
 */
function branchMatchesPattern(branch, pattern) {
  const b = String(branch || "").trim();
  const p = String(pattern || "").trim();
  if (!b || !p) return false;
  if (!p.includes("*")) return b === p;
  if (p.endsWith("/*")) {
    const prefix = p.slice(0, -1);
    return b.startsWith(prefix) && b.length > prefix.length;
  }
  return false;
}

/**
 * @param {string} branch
 * @param {string[]} patterns
 * @returns {boolean}
 */
function branchMatchesAnyPattern(branch, patterns) {
  if (!Array.isArray(patterns)) return false;
  return patterns.some((p) => branchMatchesPattern(branch, p));
}

module.exports = {
  branchMatchesPattern,
  branchMatchesAnyPattern,
};
