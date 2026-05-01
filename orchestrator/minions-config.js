"use strict";

/**
 * Optional project-level minions.md contract (OC-MINIONS-1).
 * Missing file → no effect. Invalid file → validation error for callers.
 */

const fs = require("fs");
const path = require("path");

const FILENAME = "minions.md";

/** @type {readonly string[]} */
const ALLOWED_TOP_KEYS = Object.freeze(["minions_contract_version", "orchestrator"]);

/**
 * Extract first ```json ... ``` fenced block or parse whole file as JSON.
 * @param {string} text
 * @returns {string | null}
 */
function extractJsonPayload(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/m.exec(t);
  if (fence) return fence[1].trim();
  if (t.startsWith("{") && t.endsWith("}")) return t;
  return null;
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, config: object } | { ok: false, error: string }}
 */
function validateMinionsShape(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "minions.md: root must be a JSON object" };
  }
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (!ALLOWED_TOP_KEYS.includes(k)) {
      return { ok: false, error: `minions.md: unknown top-level key "${k}" (allowed: ${ALLOWED_TOP_KEYS.join(", ")})` };
    }
  }
  const ver = obj.minions_contract_version;
  if (ver !== "0.1") {
    return {
      ok: false,
      error: `minions.md: minions_contract_version must be "0.1" (got ${JSON.stringify(ver)})`,
    };
  }
  const orch = obj.orchestrator;
  if (orch !== undefined) {
    if (!orch || typeof orch !== "object" || Array.isArray(orch)) {
      return { ok: false, error: "minions.md: orchestrator must be an object when present" };
    }
    for (const k of Object.keys(orch)) {
      if (k !== "trace_scenario_id") {
        return { ok: false, error: `minions.md: orchestrator.${k} is not allowed (supported: trace_scenario_id)` };
      }
    }
    if (orch.trace_scenario_id !== undefined && typeof orch.trace_scenario_id !== "string") {
      return { ok: false, error: "minions.md: orchestrator.trace_scenario_id must be a string" };
    }
    if (typeof orch.trace_scenario_id === "string" && orch.trace_scenario_id.length > 128) {
      return { ok: false, error: "minions.md: orchestrator.trace_scenario_id exceeds 128 chars" };
    }
  }
  return { ok: true, config: obj };
}

/**
 * Load and validate minions.md from cwd. Does not read orchestrator state.
 * @param {string} cwd
 * @returns {{ path: string | null, config: object | null, error: string | null }}
 */
function loadMinionsProjectConfig(cwd) {
  const root = path.resolve(cwd || ".");
  const p = path.join(root, FILENAME);
  if (!fs.existsSync(p)) {
    return { path: null, config: null, error: null };
  }
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { path: p, config: null, error: `minions.md: cannot read file: ${msg}` };
  }
  const payload = extractJsonPayload(raw);
  if (!payload) {
    return {
      path: p,
      config: null,
      error:
        "minions.md: expected whole-file JSON object or a ```json ... ``` fenced block with the contract object",
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { path: p, config: null, error: `minions.md: JSON parse error: ${msg}` };
  }
  const v = validateMinionsShape(parsed);
  if (!v.ok) {
    return { path: p, config: null, error: v.error };
  }
  return { path: p, config: v.config, error: null };
}

module.exports = {
  FILENAME,
  loadMinionsProjectConfig,
  validateMinionsShape,
  extractJsonPayload,
};
