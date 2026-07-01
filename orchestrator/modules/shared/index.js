"use strict";

/**
 * Shared / legacy bounded context — cross-cutting facades and helpers not yet split into true owners.
 */
const agents = require("./agents");
const decisionEngine = require("./decision-engine");
const repoRoot = require("./repo-root");
const minionsConfig = require("./minions-config");

module.exports = {
  ...agents,
  ...decisionEngine,
  ...repoRoot,
  ...minionsConfig,
};
