#!/usr/bin/env node
"use strict";

/**
 * Fail on new runtime/domain files directly under orchestrator/ root.
 * Complements import-matrix checks in check-module-boundaries.js.
 */

const fs = require("fs");
const path = require("path");

const ORCH_ROOT = path.join(__dirname, "..");
const ALLOWLIST_PATH = path.join(ORCH_ROOT, "root-import-allowlist.json");

const SHIM_HEADER_RE = /@deprecated\s+Import from `modules\//;
const ALLOWED_KINDS = new Set(["entrypoint", "config", "shim", "legacy"]);

/**
 * @returns {Record<string, string>}
 */
function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    throw new Error(`missing ${ALLOWLIST_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
  const files = raw.files;
  if (!files || typeof files !== "object") {
    throw new Error("root-import-allowlist.json must define files map");
  }
  return files;
}

/**
 * @returns {string[]}
 */
function listRootJsFiles() {
  return fs
    .readdirSync(ORCH_ROOT, { withFileTypes: true })
    .filter((ent) => ent.isFile() && ent.name.endsWith(".js"))
    .map((ent) => ent.name)
    .sort();
}

/**
 * @param {Record<string, string>} allowlist
 * @param {string[]} rootFiles
 * @returns {{ file: string, rule: string, message: string }[]}
 */
function runRootImportGuard(allowlist = loadAllowlist(), rootFiles = listRootJsFiles()) {
  /** @type {{ file: string, rule: string, message: string }[]} */
  const violations = [];

  for (const name of rootFiles) {
    const kind = allowlist[name];
    if (!kind) {
      violations.push({
        file: name,
        rule: "root_file_not_allowlisted",
        message: "new root-level .js file — add to root-import-allowlist.json with review or move under modules/",
      });
      continue;
    }
    if (!ALLOWED_KINDS.has(kind)) {
      violations.push({
        file: name,
        rule: "invalid_allowlist_kind",
        message: `unknown kind "${kind}" in root-import-allowlist.json`,
      });
      continue;
    }
    if (kind === "shim") {
      const content = fs.readFileSync(path.join(ORCH_ROOT, name), "utf8");
      if (!SHIM_HEADER_RE.test(content)) {
        violations.push({
          file: name,
          rule: "shim_header_missing",
          message: "shim allowlist entry must include @deprecated Import from `modules/...` header",
        });
      }
    }
  }

  for (const name of Object.keys(allowlist)) {
    if (!rootFiles.includes(name)) {
      violations.push({
        file: name,
        rule: "stale_allowlist_entry",
        message: "allowlisted root file no longer exists — remove from root-import-allowlist.json",
      });
    }
  }

  return violations;
}

function main() {
  const violations = runRootImportGuard();
  if (violations.length === 0) {
    console.log(`root-import-guard OK (${listRootJsFiles().length} root .js files)`);
    return;
  }
  console.error(`root-import-guard FAILED: ${violations.length} violation(s)`);
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.file}: ${v.message}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  runRootImportGuard,
  loadAllowlist,
  listRootJsFiles,
  ALLOWLIST_PATH,
  ORCH_ROOT,
  SHIM_HEADER_RE,
};
