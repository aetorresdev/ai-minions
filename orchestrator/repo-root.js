/**
 * Resolve the repository root (sibling of orchestrator/ containing shared assets).
 * Used by lint scripts, CI helpers, and documentation — same rules as mcp-direct.py.
 *
 * Override (optional): set REPO_ROOT or ORCH_REPO_ROOT to an absolute path; it must
 * contain mcp-servers/orchestrator-state and scripts/hooks.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function isRepoRoot(dir) {
  const mcp = path.join(dir, "mcp-servers", "orchestrator-state");
  const hooks = path.join(dir, "scripts", "hooks");
  return fs.existsSync(mcp) && fs.existsSync(hooks);
}

/**
 * @param {string} startDir - directory to start walking upward from
 * @returns {string} absolute repo root
 */
function findRepoRoot(startDir) {
  const fromEnv = process.env.REPO_ROOT || process.env.ORCH_REPO_ROOT;
  if (fromEnv) {
    const resolved = path.resolve(fromEnv.trim());
    if (isRepoRoot(resolved)) {
      return resolved;
    }
    throw new Error(
      `REPO_ROOT / ORCH_REPO_ROOT is set but invalid (missing mcp-servers/orchestrator-state or scripts/hooks): ${resolved}`
    );
  }

  let dir = path.resolve(startDir);
  for (;;) {
    if (isRepoRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find repository root (markers: mcp-servers/orchestrator-state + scripts/hooks) starting from ${startDir}`
      );
    }
    dir = parent;
  }
}

/** Repo root for this orchestrator package clone. */
function getRepoRoot() {
  return findRepoRoot(__dirname);
}

module.exports = { findRepoRoot, getRepoRoot, isRepoRoot };
