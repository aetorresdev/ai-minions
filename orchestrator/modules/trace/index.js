"use strict";

/**
 * Trace bounded context — JSONL schema, append/sanitize/redact, lifecycle events,
 * outcome summary, OTel mapper (derived).
 */
module.exports = {
  ...require("./trace-schema"),
  ...require("./trace-redact"),
  ...require("./trace-append"),
  ...require("./trace-writer"),
  ...require("./trace-lifecycle-events"),
  ...require("./context-hygiene-signals"),
  ...require("./run-outcome-summary"),
  ...require("./otel-genai-trace-map"),
  ...require("./model-selection-trace"),
};
