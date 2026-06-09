"use strict";

const bvReviewer = require("./bv-reviewer-design");
const progressiveDisclosure = require("./progressive-disclosure-design");
const selfImprovementLoop = require("./self-improvement-loop-design");

module.exports = {
  ...bvReviewer,
  ...progressiveDisclosure,
  ...selfImprovementLoop,
  bvReviewer,
  progressiveDisclosure,
  selfImprovementLoop,
};
