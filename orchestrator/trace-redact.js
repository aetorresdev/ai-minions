"use strict";

/**
 * Deterministic secret-shaped redaction for trace JSONL read/write paths.
 * Shared by orchestrator writer (`_sanitize`) and trace consumers (export, dashboard, CLIs).
 */

/** When `1`, skip deterministic secret-shaped redaction (local debugging only). Read at call time for tests. */
function traceSecretRedactDisabled() {
  return process.env.ORCH_TRACE_SKIP_SECRET_REDACT === "1";
}

/**
 * Replace high-risk secret-shaped substrings (deterministic placeholders).
 * Conservative: only well-scoped patterns; does not attempt NLP or PII detection.
 * @param {string} s
 * @returns {string}
 */
function redactSensitivePlaintext(s) {
  if (traceSecretRedactDisabled()) return String(s);
  let t = String(s);
  t = t.replace(/\bBearer\s+[A-Za-z0-9\-._~+/=*]{16,}\b/gi, "[REDACTED:bearer]");
  t = t.replace(/\bsk-[a-zA-Z0-9]{20,}\b/g, "[REDACTED:api_token]");
  t = t.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED:aws_access_key]");
  t = t.replace(/\bghp_[A-Za-z0-9]{30,}\b/g, "[REDACTED:github_pat]");
  t = t.replace(/\bxox[bpa]-[0-9]{10,12}-[0-9]{10,12}-[a-zA-Z0-9]{20,}\b/gi, "[REDACTED:slack_token]");
  t = t.replace(/\/\/(?:[^\s/@]+):(?:[^\s/@]+)@/g, "//[REDACTED-url-creds]@");
  return t;
}

const MAX_READ_SANITIZE_DEPTH = 32;

/**
 * Deep-clone JSON-like trace row values and redact every string (read-time defense-in-depth).
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
function sanitizeTraceValueForRead(value, depth = 0) {
  if (depth > MAX_READ_SANITIZE_DEPTH) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitivePlaintext(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((x) => sanitizeTraceValueForRead(x, depth + 1));
  }
  const out = {};
  for (const k of Object.keys(value)) {
    out[k] = sanitizeTraceValueForRead(value[k], depth + 1);
  }
  return out;
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function sanitizeTraceRowsForRead(rows) {
  if (!Array.isArray(rows) || traceSecretRedactDisabled()) return rows;
  return rows.map((r) => /** @type {object} */ (sanitizeTraceValueForRead(r, 0)));
}

module.exports = {
  traceSecretRedactDisabled,
  redactSensitivePlaintext,
  sanitizeTraceValueForRead,
  sanitizeTraceRowsForRead,
};
