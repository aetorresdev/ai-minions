#!/usr/bin/env node
/**
 * Run ruff on shared Python under repo root (hooks + MCP servers).
 * Paths do not depend on orchestrator/ nesting depth.
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const { getRepoRoot } = require("../repo-root.js");

const root = getRepoRoot();
const targets = [path.join(root, "scripts", "hooks"), path.join(root, "mcp-servers")];
const r = spawnSync("ruff", ["check", ...targets], { stdio: "inherit", env: process.env });
process.exit(r.status === null ? 1 : r.status);
