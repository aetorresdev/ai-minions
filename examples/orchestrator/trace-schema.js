"use strict";

/**
 * JSON Schema validation for trace JSONL lines (trace_schema_version "2").
 * Used at write time (orchestrator traceEvent) and optionally at read time (parseJsonl, CLI).
 *
 * Runtime policy: only versions in SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ are accepted
 * by validateTraceLine / parseTraceLine strict (before Ajv), so mismatches fail with an
 * explicit policy message — see docs/orchestrator/schema-versioning.md.
 */

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

/** Writer version this build emits; must match bundled `trace-v2-line.schema.json` enum. */
const TRACE_LINE_WRITER_VERSION = "2";

/** Versions this binary can validate with the bundled schema (multi-version readers: extend here + loaders). */
const SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ = new Set([TRACE_LINE_WRITER_VERSION]);

/**
 * Versions accepted for reading when ORCH_TRACE_ACCEPT_OLD=1.
 * Allows ingesting v1 traces produced by older builds without failing the version policy check.
 * Forward-compat (unknown future versions) is handled separately.
 */
const LEGACY_TRACE_SCHEMA_VERSIONS = Object.freeze(new Set(["1"]));

/**
 * Returns the effective set of accepted read versions, merging legacy versions
 * when ORCH_TRACE_ACCEPT_OLD=1. Evaluated per-call so env changes in tests take effect.
 * @returns {Set<string>}
 */
function effectiveSupportedVersions() {
  if (process.env.ORCH_TRACE_ACCEPT_OLD !== "1") return SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ;
  const merged = new Set(SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ);
  for (const v of LEGACY_TRACE_SCHEMA_VERSIONS) merged.add(v);
  return merged;
}

const SCHEMA_PATH = path.join(__dirname, "schemas", "trace-v2-line.schema.json");
let _validate = null;

function getValidator() {
  if (_validate) return _validate;
  const raw = fs.readFileSync(SCHEMA_PATH, "utf8");
  const schema = JSON.parse(raw);
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  _validate = ajv.compile(schema);
  return _validate;
}

/**
 * @param {unknown} record
 * @returns {string[] | null} policy errors, or null if OK
 */
function traceSchemaVersionPolicyErrors(record) {
  const v = record && record.trace_schema_version;
  const supported = effectiveSupportedVersions();
  if (typeof v !== "string" || !supported.has(v)) {
    const allowed = [...supported].join(", ");
    const got = v === undefined || v === null ? "missing" : JSON.stringify(v);
    return [`trace_schema_version: this binary only accepts ${allowed}; got ${got}`];
  }
  return null;
}

/**
 * @param {unknown} record - one parsed JSON object from a trace line
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
function validateTraceLine(record) {
  const policy = traceSchemaVersionPolicyErrors(record);
  if (policy) {
    return { ok: false, errors: policy };
  }
  const validate = getValidator();
  if (!validate(record)) {
    const errs = (validate.errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`.trim());
    return { ok: false, errors: errs.length ? errs : ["unknown schema error"] };
  }
  return { ok: true };
}

/**
 * @param {string} line
 * @param {{ strict?: boolean }} [opts]
 * @returns {object}
 */
function parseTraceLine(line, opts = {}) {
  const o = JSON.parse(line);
  if (opts.strict) {
    const v = validateTraceLine(o);
    if (!v.ok) {
      throw new Error(v.errors.join("; "));
    }
  }
  return o;
}

module.exports = {
  TRACE_LINE_WRITER_VERSION,
  SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ,
  LEGACY_TRACE_SCHEMA_VERSIONS,
  effectiveSupportedVersions,
  traceSchemaVersionPolicyErrors,
  validateTraceLine,
  parseTraceLine,
  SCHEMA_PATH,
};
