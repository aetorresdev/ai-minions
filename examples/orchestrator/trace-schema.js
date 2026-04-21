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
const SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ = _buildSupportedVersions();

function _buildSupportedVersions() {
  const raw = process.env.ORCH_TRACE_SUPPORTED_VERSIONS;
  if (!raw) return new Set([TRACE_LINE_WRITER_VERSION]);
  const versions = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (versions.length === 0) {
    throw new Error('ORCH_TRACE_SUPPORTED_VERSIONS is set but contains no valid version tokens');
  }
  return new Set(versions);
}

const SCHEMA_PATH = path.join(__dirname, "schemas", "trace-v2-line.schema.json");
let _validate = null;

const _metrics = {
  policy_missing_version: 0,
  policy_unsupported_version: 0,
  ajv_schema_error: 0,
};

function getValidationMetrics() {
  return { ..._metrics };
}

function resetValidationMetrics() {
  _metrics.policy_missing_version = 0;
  _metrics.policy_unsupported_version = 0;
  _metrics.ajv_schema_error = 0;
}

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
  if (typeof v !== "string") {
    const allowed = [...SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ].join(", ");
    const got = v === undefined || v === null ? "missing" : `<${typeof v}>`;
    return { errors: [`trace_schema_version: this binary only accepts ${allowed}; got ${got}`], reason: "missing_version" };
  }
  if (!SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ.has(v)) {
    const allowed = [...SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ].join(", ");
    return { errors: [`trace_schema_version: this binary only accepts ${allowed}; got <string>`], reason: "unsupported_version" };
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
    if (policy.reason === "missing_version") _metrics.policy_missing_version++;
    else _metrics.policy_unsupported_version++;
    return { ok: false, errors: policy.errors };
  }
  const validate = getValidator();
  if (!validate(record)) {
    _metrics.ajv_schema_error++;
    const errs = (validate.errors || []).map((e) => {
      const rootPath = e.instancePath ? `/${e.instancePath.split("/")[1]}` : "/";
      return `${rootPath} ${e.message || "invalid"}`.trim();
    });
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
  traceSchemaVersionPolicyErrors,
  validateTraceLine,
  parseTraceLine,
  getValidationMetrics,
  resetValidationMetrics,
  SCHEMA_PATH,
};
