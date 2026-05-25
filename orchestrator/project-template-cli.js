#!/usr/bin/env node
/**
 * Export / import dry-run for portable ai-minions project templates.
 *
 * Usage:
 *   node project-template-cli.js export --cwd <dir> --out <bundle.json>
 *   node project-template-cli.js import --dry-run --cwd <dir> --file <bundle.json>
 */

"use strict";

const fs = require("fs");
const path = require("path");

const {
  buildExportBundle,
  dryRunImport,
  formatDryRunReport,
} = require("./portable-project-template");

function usage() {
  console.error(`Usage:
  node project-template-cli.js export --cwd <dir> [--out <bundle.json>]
  node project-template-cli.js import --dry-run --cwd <dir> --file <bundle.json>

Export writes a scrubbed JSON bundle. Import --dry-run reports create/unchanged/conflict; never writes files.`);
}

/**
 * @param {string[]} argv
 * @returns {{ command: string | null, cwd: string, out: string | null, file: string | null, dryRun: boolean }}
 */
function parseArgs(argv) {
  let command = null;
  let cwd = process.cwd();
  let out = null;
  let file = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "export" || a === "import") {
      command = a;
      continue;
    }
    if (a === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
      continue;
    }
    if (a === "--out" && argv[i + 1]) {
      out = argv[++i];
      continue;
    }
    if (a === "--file" && argv[i + 1]) {
      file = argv[++i];
      continue;
    }
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "-h" || a === "--help") {
      usage();
      process.exit(0);
    }
    console.error(`Unknown argument: ${a}`);
    usage();
    process.exit(1);
  }

  return { command, cwd, out, file, dryRun };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "export") {
    let bundle;
    try {
      bundle = buildExportBundle(args.cwd);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Export failed: ${msg}`);
      process.exit(2);
    }
    const json = `${JSON.stringify(bundle, null, 2)}\n`;
    if (args.out) {
      fs.writeFileSync(path.resolve(args.out), json, "utf8");
      console.log(`Wrote portable project template: ${path.resolve(args.out)}`);
    } else {
      process.stdout.write(json);
    }
    process.exit(0);
  }

  if (args.command === "import") {
    if (!args.dryRun) {
      console.error("Only --dry-run import is supported (no file writes in this CLI).");
      process.exit(1);
    }
    if (!args.file) {
      console.error("import --dry-run requires --file <bundle.json>");
      process.exit(1);
    }
    let bundle;
    try {
      bundle = JSON.parse(fs.readFileSync(path.resolve(args.file), "utf8"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Cannot read bundle: ${msg}`);
      process.exit(2);
    }
    const result = dryRunImport(args.cwd, bundle);
    console.log(formatDryRunReport(bundle, result));
    process.exit(result.ok ? 0 : 2);
  }

  usage();
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
