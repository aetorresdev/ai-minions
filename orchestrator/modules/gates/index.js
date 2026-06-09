"use strict";

/**
 * Gates bounded context — human approval, policy gates, PR-boundary governance,
 * doubt review, and durable review records.
 */
module.exports = {
  ...require("./governance-gate"),
  ...require("./merge-governance"),
  ...require("./approval-policy-gate"),
  ...require("./doubt-review"),
  ...require("./review-record"),
};
