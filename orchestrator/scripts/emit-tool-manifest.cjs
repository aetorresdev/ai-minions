#!/usr/bin/env node
"use strict";

/**
 * Writes ../security/tool-action-manifest.v1.json from default-tool-manifest-data.js
 */
const fs = require("fs");
const path = require("path");

const data = require("./default-tool-manifest-data.js");
const outPath = path.join(__dirname, "..", "security", "tool-action-manifest.v1.json");

const payload = {
  version: data.version,
  tools: data.tools,
};

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.error(`wrote ${outPath}`);
