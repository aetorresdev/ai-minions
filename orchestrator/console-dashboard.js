#!/usr/bin/env node
"use strict";

/** @deprecated Import from `modules/operator/console-dashboard` — compat shim (CLI entry). */
const mod = require("./modules/operator/console-dashboard");
module.exports = mod;
if (require.main === module) {
  mod.main();
}
