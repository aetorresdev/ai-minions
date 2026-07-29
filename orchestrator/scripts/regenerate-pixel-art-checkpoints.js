#!/usr/bin/env node
'use strict';

/**
 * Intentional regeneration of Neon vs Semantic shell checkpoint renders.
 * Validation tests read fixtures only — they must never rewrite them.
 *
 * Usage (from orchestrator/):
 *   node scripts/regenerate-pixel-art-checkpoints.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { buildShellModel } = require('../modules/operator/operator-tui-shell-model');

async function main() {
  const { renderOperatorTuiShellToString } = await import(
    '../modules/operator/operator-tui-shell-render.mjs'
  );
  const outDir = path.join(
    __dirname,
    '..',
    'tests',
    'fixtures',
    'tui',
    'pixel-art-checkpoint',
  );
  fs.mkdirSync(outDir, { recursive: true });

  const base = {
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [], result_code: 'RUNS_EMPTY' },
    contentSurface: 'home',
    selectedNavId: 'launcher',
    columns: 120,
    rows: 36,
    icons: 'unicode',
    truecolor: false,
    art: 'arcade',
  };

  for (const [style, file] of [
    ['neon', 'neon-120x36.txt'],
    ['semantic', 'semantic-guardians-120x36.txt'],
  ]) {
    const model = buildShellModel({ ...base, guardianStyle: style });
    const out = renderOperatorTuiShellToString(model, { columns: 120, rows: 36 });
    fs.writeFileSync(path.join(outDir, file), out, 'utf8');
    process.stdout.write(`wrote ${file}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
