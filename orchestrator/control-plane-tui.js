#!/usr/bin/env node
"use strict";

/** @deprecated Import from `modules/operator/control-plane-tui` — compat shim (CLI entry). */
const mod = require("./modules/operator/control-plane-tui");
module.exports = mod;
if (require.main === module) {
  mod.main();
}
