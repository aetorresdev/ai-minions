"use strict";

/**
 * Run-control bounded context — run loop orchestration, phase graph, in-memory run snapshot.
 * Partial physical slice: run-state + run-phases canonical under modules/run-control/;
 * run-loop-helpers and orchestrator.js remain at legacy paths.
 */
module.exports = {
  ...require("./run-state"),
};
