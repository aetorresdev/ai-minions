#!/usr/bin/env node
"use strict";

/**
 * Static import boundary guard for the modular monolith boundary map.
 * Enforces docs/orchestrator/module-boundaries.md adjacency matrix + hard rules.
 */

const fs = require("fs");
const path = require("path");
const {
  classifyModule,
  resolveLocalImport,
  matrixAllows,
  checkHardRules,
} = require("./lib/module-boundary-rules");
const { runRootImportGuard } = require("./check-root-import-guard");

const ORCH_ROOT = path.join(__dirname, "..");
const ALLOWLIST_PATH = path.join(ORCH_ROOT, "module-boundary-allowlist.json");

const REQUIRE_RE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
const IMPORT_RE = /\bimport\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g;

const SCAN_IGNORE = new Set([
  "node_modules",
  "tests",
]);

/**
 * @param {string} dir
 * @param {string[]} acc
 */
function collectJsFiles(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SCAN_IGNORE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(full, acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) acc.push(full);
  }
}

/**
 * @param {string} content
 * @returns {string[]}
 */
function extractSpecifiers(content) {
  const specs = [];
  for (const re of [REQUIRE_RE, IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      specs.push(m[1]);
    }
  }
  return specs;
}

/**
 * @returns {{ matrix: string[], hard: string[] }}
 */
function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return { matrix: [], hard: [] };
  }
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
  return {
    matrix: Array.isArray(raw.matrix) ? raw.matrix : [],
    hard: Array.isArray(raw.hard) ? raw.hard : [],
  };
}

/**
 * @param {string} relFrom
 * @param {string} specifier
 * @param {string} relTo
 * @param {string} rule
 * @returns {string}
 */
function violationKey(relFrom, specifier, relTo, rule) {
  return `${relFrom}::${specifier}::${relTo}::${rule}`;
}

/**
 * @param {object} opts
 * @param {boolean} [opts.updateAllowlist]
 * @returns {{ violations: object[], scanned: number }}
 */
function runCheck(opts = {}) {
  const allowlist = loadAllowlist();
  const allowMatrix = new Set(allowlist.matrix);
  const allowHard = new Set(allowlist.hard);

  const files = [];
  collectJsFiles(ORCH_ROOT, files);

  /** @type {object[]} */
  const violations = [];

  for (const file of files) {
    const relFrom = path.relative(ORCH_ROOT, file).replace(/\\/g, "/");
    const fromMod = classifyModule(relFrom);
    const content = fs.readFileSync(file, "utf8");
    const specs = extractSpecifiers(content);

    for (const specifier of specs) {
      const resolved = resolveLocalImport(file, specifier, ORCH_ROOT);
      const relTo = resolved
        ? path.relative(ORCH_ROOT, resolved).replace(/\\/g, "/")
        : specifier;
      const toMod = resolved ? classifyModule(relTo) : "external";

      const hard = checkHardRules(relFrom, fromMod, specifier, toMod);
      if (hard) {
        const key = violationKey(relFrom, specifier, relTo, hard.rule);
        if (!allowHard.has(key)) {
          violations.push({
            kind: "hard",
            rule: hard.rule,
            from: relFrom,
            fromModule: fromMod,
            to: relTo,
            toModule: toMod,
            specifier,
            message: hard.message,
          });
        }
        continue;
      }

      if (!resolved) continue;

      const underModules = relFrom.startsWith("modules/");
      const enforceMatrix = underModules || fromMod !== "unclassified";

      if (enforceMatrix && !matrixAllows(fromMod, toMod)) {
        const key = violationKey(relFrom, specifier, relTo, "matrix");
        if (!allowMatrix.has(key)) {
          violations.push({
            kind: "matrix",
            rule: "matrix",
            from: relFrom,
            fromModule: fromMod,
            to: relTo,
            toModule: toMod,
            specifier,
            message: `${fromMod} must not import ${toMod}`,
          });
        }
      }
    }
  }

  if (opts.updateAllowlist) {
    const matrixKeys = new Set(allowlist.matrix);
    const hardKeys = new Set(allowlist.hard);
    for (const v of violations) {
      const key = violationKey(v.from, v.specifier, v.to, v.rule);
      if (v.kind === "hard") hardKeys.add(key);
      else matrixKeys.add(key);
    }
    const payload = {
      _comment: "Grandfathered legacy violations. New imports must not add keys — CI fails on unlisted violations.",
      matrix: [...matrixKeys].sort(),
      hard: [...hardKeys].sort(),
    };
    fs.writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  }

  return { violations, scanned: files.length };
}

function main() {
  const updateAllowlist = process.argv.includes("--update-allowlist");
  const { violations, scanned } = runCheck({ updateAllowlist });

  if (updateAllowlist) {
    console.log(`module-boundary allowlist updated (${scanned} files scanned)`);
    return;
  }

  const rootViolations = runRootImportGuard();

  if (violations.length === 0 && rootViolations.length === 0) {
    console.log(`module-boundary check OK (${scanned} files)`);
    return;
  }

  if (rootViolations.length) {
    console.error(`root-import-guard FAILED: ${rootViolations.length} violation(s)`);
    for (const v of rootViolations) {
      console.error(`  [${v.rule}] ${v.file}: ${v.message}`);
    }
  }

  if (violations.length === 0) {
    process.exit(1);
  }

  console.error(`module-boundary check FAILED: ${violations.length} violation(s) in ${scanned} files`);
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.from} (${v.fromModule}) -> ${v.to} (${v.toModule}) via ${v.specifier}`);
    console.error(`    ${v.message}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { runCheck, violationKey, ALLOWLIST_PATH, ORCH_ROOT };
