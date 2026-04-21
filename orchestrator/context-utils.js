/**
 * Context shaping utilities: fewer tokens on Claude worker steps.
 */

const TRUNCATE_FOOTER =
  "\n\n[... output truncated for context budget; inspect cwd / git / files mentioned above for full detail ...]";

/**
 * Truncate text to maxChars (0 or negative = no truncation).
 * @param {string} text
 * @param {number} maxChars
 * @returns {{ text: string, truncated: boolean }}
 */
function truncateForContext(text, maxChars) {
  if (maxChars == null || maxChars <= 0 || !text) return { text: text || "", truncated: false };
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars) + TRUNCATE_FOOTER, truncated: true };
}

/**
 * Format one artifact for inclusion in the next agent's context.
 * @param {{ agentId: string, task: string, result: string }} artifact
 * @param {number} maxChars
 */
function formatArtifactLine(artifact, maxChars) {
  const { text } = truncateForContext(artifact.result, maxChars);
  return `[${artifact.agentId}] ${artifact.task}\n${text}`;
}

/**
 * Read a numeric env var; returns defaultVal if missing or invalid.
 * @param {string} name
 * @param {number} defaultVal
 */
function envInt(name, defaultVal) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultVal;
}

module.exports = { truncateForContext, formatArtifactLine, envInt };
