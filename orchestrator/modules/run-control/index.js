"use strict";

/**
 * Run-control bounded context — run loop orchestration, phase graph, helpers, in-memory run snapshot.
 * Partial physical slice: run-state, run-phases, run-loop-helpers, qa-spec-flow, and context-utils
 * are canonical under modules/run-control/; orchestrator.js remains at legacy path.
 *
 * Index export policy: run-state only — import run-phases and helpers via direct canonical paths
 * or root compat shims until a later slice widens the index surface deliberately.
 */
module.exports = {
  ...require("./run-state"),
};
