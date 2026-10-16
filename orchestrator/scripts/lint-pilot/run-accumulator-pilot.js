#!/usr/bin/env node
// Advisory runner for the accumulator lint pilot. Reuses orchestrator/eslint.config.js
// for parsing and file scope, runs only the two pilot rules, and prints a JSON report.
// Always exits 0 unless the pilot itself fails to execute; findings never fail it.
//
// Usage: node scripts/lint-pilot/run-accumulator-pilot.js [--out <file>]

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ESLint } = require("eslint");
const { plugin, PROVENANCE } = require("./accumulator-rules");

const ROOT = path.resolve(__dirname, "..", "..");
const SUPPORTED = [".js", ".mjs", ".cjs"];
const UNSUPPORTED = [".ts", ".tsx", ".mts", ".cts", ".jsx"];
const EXCLUDED_DIRS = ["node_modules", ".git"];
const RULES = Object.keys(plugin.rules).map((name) => `lint-pilot/${name}`);

function sha256(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.includes(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function gitCommit() {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "."], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
    return { head, dirty };
  } catch {
    return { head: null, dirty: null };
  }
}

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const outFile = outIndex > -1 ? process.argv[outIndex + 1] : null;

  const started = process.hrtime.bigint();
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfig: [{
      // ruleFilter hides every other rule, so existing disable directives would look unused.
      linterOptions: { reportUnusedDisableDirectives: "off" },
      plugins: { "lint-pilot": plugin },
      rules: Object.fromEntries(RULES.map((rule) => [rule, "warn"])),
    }],
    ruleFilter: ({ ruleId }) => RULES.includes(ruleId),
  });
  const results = await eslint.lintFiles(["."]);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const scanned = results.map((result) => path.relative(ROOT, result.filePath));
  const fatal = [];
  const findings = [];
  for (const result of results) {
    for (const message of result.messages) {
      const file = path.relative(ROOT, result.filePath);
      if (message.fatal || !message.ruleId) {
        fatal.push({ file, line: message.line, message: message.message });
      } else {
        findings.push({ rule: message.ruleId, file, line: message.line, column: message.column, messageId: message.messageId });
      }
    }
  }

  const all = walk(ROOT, []).map((file) => path.relative(ROOT, file));
  const supportedOnDisk = all.filter((file) => SUPPORTED.includes(path.extname(file)));
  const scannedSet = new Set(scanned);
  const notScanned = supportedOnDisk.filter((file) => !scannedSet.has(file));
  const unsupported = all.filter((file) => UNSUPPORTED.includes(path.extname(file)));

  const perRule = Object.fromEntries(RULES.map((rule) => [rule, findings.filter((f) => f.rule === rule).length]));
  let status = "executed-clean";
  if (fatal.length > 0) status = "error";
  else if (findings.length > 0) status = "executed-with-findings";

  const report = {
    status,
    advisory: true,
    source: { root: "orchestrator/", commit: gitCommit() },
    tool: {
      eslint: ESLint.version,
      node: process.version,
      configSha256: sha256([path.join(ROOT, "eslint.config.js"), path.join(__dirname, "accumulator-rules.js")]),
      provenance: PROVENANCE,
    },
    scope: {
      supportedExtensions: SUPPORTED,
      excludedDirectories: EXCLUDED_DIRS,
      scannedFiles: scanned.length,
      supportedButNotScanned: notScanned,
      unsupportedFiles: unsupported,
    },
    elapsedMs: Math.round(elapsedMs),
    findingsPerRule: perRule,
    findings,
    errors: fatal,
  };

  const json = JSON.stringify(report, null, 2);
  if (outFile) fs.writeFileSync(outFile, json + "\n");
  process.stdout.write(json + "\n");
  if (status === "error") process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`accumulator pilot failed to execute: ${error.message}\n`);
  process.exitCode = 2;
});
