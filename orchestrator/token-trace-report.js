#!/usr/bin/env node
"use strict";

/** @deprecated Import from `modules/budget/token-trace-report` — compat shim (CLI entry). */
const mod = require("./modules/budget/token-trace-report");
module.exports = mod;
if (require.main === module) {
  mod.main();
}
