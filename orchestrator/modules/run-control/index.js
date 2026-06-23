"use strict";

/**
 * Run-control bounded context — run loop orchestration and in-memory run snapshot.
 * Partial physical slice: run-state only; run-phases and hub remain at legacy paths.
 */
module.exports = {
  ...require("./run-state"),
};
