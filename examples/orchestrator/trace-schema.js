"use strict";

/**
 * JSON Schema validation for trace JSONL lines (trace_schema_version "2").
 * Used at write time (orchestrator traceEvent) and optionally at read time (parseJsonl, CLI).
 */

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

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
 * @param {unknown} record - one parsed JSON object from a trace line
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
function validateTraceLine(record) {
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
  validateTraceLine,
  parseTraceLine,
  SCHEMA_PATH,
};
