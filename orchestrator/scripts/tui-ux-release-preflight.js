#!/usr/bin/env node
'use strict';

/**
 * Release preflight for the UX companion gate.
 * Loads the explicit evidence registry and evaluates evaluateUxAcceptanceVerdict.
 * Non-pass (missing / blocked / fail) → non-zero exit with reasons on stderr.
 */

const path = require('node:path');

const {
  evaluateUxAcceptanceEvidenceRegistry,
  TUI_UX_EVIDENCE_REGISTRY_RELATIVE,
} = require('../modules/operator/operator-tui-ux-acceptance');

function main(argv = process.argv.slice(2)) {
  const registryArgIdx = argv.indexOf('--registry');
  const registryPath = registryArgIdx >= 0 && argv[registryArgIdx + 1]
    ? path.resolve(argv[registryArgIdx + 1])
    : undefined;

  const result = evaluateUxAcceptanceEvidenceRegistry({ registryPath });
  const { verdict } = result;

  const payload = {
    schema: '1',
    kind: 'tui_ux_release_preflight',
    registry_path: result.registryPath,
    registry_relative: TUI_UX_EVIDENCE_REGISTRY_RELATIVE,
    verdict: verdict.verdict,
    reasons: verdict.reasons,
    command_set: verdict.command_set,
  };

  if (verdict.verdict === 'pass') {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  process.stderr.write(
    `tui-ux-release-preflight: ${verdict.verdict}\n`
    + `reasons:\n${verdict.reasons.map((r) => `  - ${r}`).join('\n')}\n`
    + `registry: ${result.registryPath}\n`,
  );
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
