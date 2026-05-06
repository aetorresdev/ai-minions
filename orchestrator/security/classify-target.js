"use strict";

/**
 * Normalize caller-provided target hints for evaluation and traces.
 * No policy logic — shape normalization only.
 *
 * @param {unknown} raw
 * @returns {{ target_class: string | null, normalized: unknown }}
 */
function classifyTarget(raw) {
  if (raw == null || raw === "") {
    return { target_class: null, normalized: null };
  }
  if (typeof raw === "string") {
    return { target_class: raw, normalized: { kind: "opaque_string", value: raw } };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const tc = raw.target_class != null ? String(raw.target_class) : null;
    return { target_class: tc, normalized: raw };
  }
  return { target_class: null, normalized: raw };
}

module.exports = { classifyTarget };
