"use strict";

const bvReviewer = require("./bv-reviewer-design");
const selfImprovementLoop = require("./self-improvement-loop-design");

/** Contracts-owned validators only — progressive disclosure lives under disclosure module. */
module.exports = {
  ...bvReviewer,
  ...selfImprovementLoop,
  bvReviewer,
  selfImprovementLoop,
};
