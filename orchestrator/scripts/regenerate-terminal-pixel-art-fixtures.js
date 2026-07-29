#!/usr/bin/env node
'use strict';

/**
 * Intentional fixture regeneration for the Semantic Guardians terminal lock.
 * Validation tests must never call this — review and commit the fixture diff.
 *
 * Usage (from orchestrator/):
 *   node scripts/regenerate-terminal-pixel-art-fixtures.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { buildLandingCanvas } = require('../modules/operator/terminal-pixel-art');

const fixtures = path.join(
  __dirname,
  '..',
  'tests',
  'fixtures',
  'tui',
  'terminal-pixel-art',
);
fs.mkdirSync(fixtures, { recursive: true });

const viewports = [
  [144, 40],
  [120, 36],
  [80, 24],
  [50, 16],
];

for (const [columns, rows] of viewports) {
  const canvas = buildLandingCanvas({ columns, rows });
  const name = `landing-${columns}x${rows}.txt`;
  fs.writeFileSync(
    path.join(fixtures, name),
    `${canvas.plainLines().join('\n')}\n`,
    'utf8',
  );
  process.stdout.write(`wrote ${name}\n`);
}
