#!/usr/bin/env node
'use strict';

/** @deprecated Import from `modules/operator/ai-minions-cli` — compat shim (CLI entry). */
const mod = require('./modules/operator/ai-minions-cli');
module.exports = mod;
if (require.main === module) {
  mod.main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
