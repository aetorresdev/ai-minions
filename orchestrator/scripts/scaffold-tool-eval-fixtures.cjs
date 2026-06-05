#!/usr/bin/env node
'use strict';

/**
 * Scaffold placeholder tool-eval fixtures for manifest tools missing coverage.
 *
 * Usage:
 *   npm run scaffold:tool-eval-fixtures -- --dry-run
 *   npm run scaffold:tool-eval-fixtures
 *   npm run scaffold:tool-eval-fixtures -- --tool-id my_tool
 */

const path = require('path');
const { scaffoldToolEvalFixtures } = require('../security/scaffold-tool-eval-fixtures');

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ dryRun: boolean, outputPath?: string, toolIds: string[] }} */
  const out = { dryRun: false, toolIds: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--output' && argv[i + 1]) out.outputPath = argv[++i];
    else if (a === '--tool-id' && argv[i + 1]) out.toolIds.push(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`Usage: npm run scaffold:tool-eval-fixtures -- [options]

Options:
  --dry-run           Print scaffold JSON to stdout; do not write file
  --output <path>     Output path (default: security/tool-eval-fixtures.scaffold.pending.json)
  --tool-id <id>      Scaffold only this manifest tool (repeatable)
  -h, --help          Show help

Workflow:
  1. scaffold (dry-run or write pending file)
  2. human replaces TODO_* expected values
  3. merge scenarios into security/tool-eval-fixtures.v1.json
  4. cd orchestrator && npm test`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const result = scaffoldToolEvalFixtures({
    dryRun: opts.dryRun,
    outputPath: opts.outputPath
      ? path.resolve(opts.outputPath)
      : undefined,
    toolIds: opts.toolIds.length ? opts.toolIds : undefined,
  });

  if (!result.ok) {
    if (result.error === 'unknown_tool_id' && result.unknown_tool_ids?.length) {
      console.error(`unknown manifest tool_id(s): ${result.unknown_tool_ids.join(', ')}`);
    } else {
      console.error(result.error || 'scaffold failed');
    }
    if (result.errors) console.error(result.errors.join(', '));
    process.exit(1);
  }

  if (result.dry_run) {
    process.stdout.write(result.json);
    console.error(
      `scaffold dry-run: ${result.scenario_count} scenario(s) for `
      + `${result.missing_tools.length ? result.missing_tools.join(', ') : '(none)'}`,
    );
    process.exit(0);
  }

  if (!result.wrote) {
    console.log(result.message || 'no scaffold output written');
    process.exit(0);
  }

  console.log(`wrote ${result.scenario_count} scenario(s) → ${result.output_path}`);
  console.log(`missing tools: ${result.missing_tools.join(', ')}`);
  process.exit(0);
}

main();
