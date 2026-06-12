#!/usr/bin/env node
"use strict";

/** @deprecated Import from `modules/operator/scenario-metrics-export` — compat shim (CLI entry). */
const mod = require("./modules/operator/scenario-metrics-export");
module.exports = mod;
if (require.main === module) {
  mod.main();
}
