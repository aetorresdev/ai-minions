#!/usr/bin/env node
"use strict";

/** @deprecated Import from `modules/operator/project-template-cli` — compat shim (CLI entry). */
const mod = require("./modules/operator/project-template-cli");
module.exports = mod;
if (require.main === module) {
  mod.main();
}
