#!/usr/bin/env node
"use strict";

/** @deprecated Import from `modules/operator/explain-run` — compat shim (CLI entry). */
const mod = require("./modules/operator/explain-run");
module.exports = mod;
if (require.main === module) {
  mod.main();
}
