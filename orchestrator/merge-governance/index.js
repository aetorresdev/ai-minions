"use strict";

const constants = require("./constants");
const { branchMatchesPattern, branchMatchesAnyPattern } = require("./branch-pattern");
const {
  loadMergeGovernanceConfig,
  validateMergeGovernanceConfig,
} = require("./load-merge-governance-config");
const { discoverBranchPolicyPosture } = require("./branch-policy-discovery");
const { inspectActorCapabilities } = require("./actor-capability-check");
const { buildProductionBoundaryCheckPayload } = require("./build-production-boundary-check");
const {
  evaluatePrBoundaryGovernance,
  isProhibitedAgentAction,
} = require("./pr-boundary-governance-gate");

module.exports = {
  ...constants,
  branchMatchesPattern,
  branchMatchesAnyPattern,
  loadMergeGovernanceConfig,
  validateMergeGovernanceConfig,
  discoverBranchPolicyPosture,
  inspectActorCapabilities,
  buildProductionBoundaryCheckPayload,
  evaluatePrBoundaryGovernance,
  isProhibitedAgentAction,
};
