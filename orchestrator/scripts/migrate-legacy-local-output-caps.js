#!/usr/bin/env node
'use strict';

/**
 * Report (default) or remove (--apply) local Ollama max_tokens caps that older
 * installers wrote into <repo>/.ai-minions/model_policy.json.
 *
 * Usage: node orchestrator/scripts/migrate-legacy-local-output-caps.js [--repo <path>] [--apply] [--json]
 *
 * Exit codes: 0 report/migration completed; 1 legacy caps found in report mode; 2 error.
 */

const {
  migrateLegacyLocalOutputCaps,
  formatLegacyLocalOutputCapsReport,
} = require('../modules/model-runtime/legacy-local-output-caps');

/**
 * @param {string[]} argv
 * @returns {{ repo: string, apply: boolean, json: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const out = { repo: process.cwd(), apply: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--repo') {
      const v = argv[i + 1];
      if (!v) throw new Error('--repo requires a path');
      out.repo = v;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

/**
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, now?: () => string }} [io]
 * @returns {number}
 */
function main(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s) => process.stderr.write(s));
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  if (args.help) {
    stdout(
      'Usage: migrate-legacy-local-output-caps.js [--repo <path>] [--apply] [--json]\n'
        + '  Without --apply: report installer-written local max_tokens caps (no writes).\n'
        + '  With --apply: back up model_policy.json, then remove only installer-written caps.\n'
        + '  User-set caps are reported and never changed.\n',
    );
    return 0;
  }
  try {
    const result = migrateLegacyLocalOutputCaps(args.repo, { apply: args.apply, now: io.now });
    stdout(`${args.json ? JSON.stringify(result, null, 2) : formatLegacyLocalOutputCapsReport(result)}\n`);
    return result.status === 'legacy_caps_found' ? 1 : 0;
  } catch (err) {
    stderr(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, parseArgs };
