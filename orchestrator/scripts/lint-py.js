#!/usr/bin/env node
/**
 * Run ruff on shared Python under repo root (hooks + MCP servers).
 * Paths do not depend on orchestrator/ nesting depth.
 * Ruff is pinned in scripts/ruff-version.txt: PATH ruff is used when it
 * matches the pin, otherwise uvx runs the pinned release so local == CI.
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getRepoRoot } = require("../repo-root.js");

const root = getRepoRoot();
const targets = [path.join(root, "scripts", "hooks"), path.join(root, "mcp-servers")];
const pinned = fs.readFileSync(path.join(__dirname, "ruff-version.txt"), "utf8").trim();

function pathRuffVersion() {
  const r = spawnSync("ruff", ["--version"], { encoding: "utf8", env: process.env });
  if (r.status !== 0 || !r.stdout) {
    return null;
  }
  const m = r.stdout.match(/ruff (\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  process.exit(r.status === null ? 1 : r.status);
}

const local = pathRuffVersion();
if (local === pinned) {
  run("ruff", ["check", ...targets]);
}

if (local !== null) {
  console.error(`lint:py: PATH ruff is ${local}, pinned is ${pinned} — falling back to uvx ruff@${pinned}`);
}

const uvx = spawnSync("uvx", ["--version"], { stdio: "ignore", env: process.env });
if (uvx.status === 0) {
  run("uvx", [`ruff@${pinned}`, "check", ...targets]);
}

console.error(
  `lint:py: ruff ${pinned} not available and uvx is missing.\n` +
    `Install the pinned linter: pip install "ruff==${pinned}"  (or: uv tool install ruff@${pinned})`
);
process.exit(1);
