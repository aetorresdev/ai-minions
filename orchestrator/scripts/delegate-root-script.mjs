#!/usr/bin/env node
/**
 * Run a repo-root script with cwd = clone root (safe when invoked from orchestrator/).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORCH_SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(ORCH_SCRIPTS_DIR, "..", "..");

/**
 * @param {string} scriptRel Path relative to repo root (e.g. scripts/run-install-evidence.mjs)
 * @param {string[]} [argv]
 */
export function delegateRootScript(scriptRel, argv = process.argv.slice(2)) {
  const abs = path.join(REPO_ROOT, scriptRel);
  const result = spawnSync(process.execPath, [abs, ...argv], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}
