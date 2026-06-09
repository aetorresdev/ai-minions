"use strict";

/**
 * Gates bounded context — human approval, policy gates, PR-boundary governance.
 * Slice 1 (A2.1): physical home for governance-gate + merge-governance.
 */
module.exports = {
  ...require("./governance-gate"),
  ...require("./merge-governance"),
  ...require("./approval-policy-gate"),
  ...require("./doubt-review"),
  ...require("./review-record"),
};
