#!/usr/bin/env node
/**
 * Regenerate textual landing contract fixtures under tests/fixtures/tui/landing/.
 *
 * These snapshots come from Ink `renderToString()` — full virtual tree, not a
 * clipped TTY frame. Do NOT treat them as visual UX / composition screenshots.
 * For real terminal capture, see docs/evidence/tui-task-first-landing/README.md
 * and scripts/capture-tui-landing-tty.sh.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  measureLandingRender,
  normalizeLandingSnapshot,
} from './lib/tui-landing-render-metrics.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const orchRoot = path.join(__dirname, '..');
const fixturesDir = path.join(orchRoot, 'tests', 'fixtures', 'tui', 'landing');

const { buildShellModel } = require('../modules/operator/operator-tui-shell-model.js');
const { renderOperatorTuiShellToString } = await import(
  '../modules/operator/operator-tui-shell-render.mjs'
);

function tipSha() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: path.join(orchRoot, '..'),
    encoding: 'utf8',
  });
  return r.status === 0 ? String(r.stdout).trim() : 'unknown';
}

function inkVersion() {
  try {
    return require('../node_modules/ink/package.json').version;
  } catch {
    return 'unknown';
  }
}

function readyShellOptions(overrides = {}) {
  return {
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [], result_code: 'RUNS_EMPTY' },
    contentSurface: 'home',
    selectedNavId: 'launcher',
    // Portable unicode for reviewable contract fixtures (runtime default remains nerd).
    icons: 'unicode',
    truecolor: false,
    ...overrides,
  };
}

/** @type {Array<{ id: string, file: string, columns: number, rows: number, env?: Record<string, string|undefined>, options: object }>} */
const CASES = [
  {
    id: 'ready_120x36',
    file: 'ready-120x36.txt',
    columns: 120,
    rows: 36,
    options: readyShellOptions({ columns: 120, rows: 36 }),
  },
  {
    id: 'ready_80x24',
    file: 'ready-80x24.txt',
    columns: 80,
    rows: 24,
    options: readyShellOptions({ columns: 80, rows: 24 }),
  },
  {
    // Runtime default icons=nerd — width/height gates must hold with Nerd glyphs too.
    id: 'ready_nerd_120x36',
    file: 'ready-nerd-120x36.txt',
    columns: 120,
    rows: 36,
    options: readyShellOptions({ columns: 120, rows: 36, icons: 'nerd' }),
  },
  {
    id: 'ready_nerd_80x24',
    file: 'ready-nerd-80x24.txt',
    columns: 80,
    rows: 24,
    options: readyShellOptions({ columns: 80, rows: 24, icons: 'nerd' }),
  },
  {
    id: 'ready_50x16',
    file: 'ready-50x16.txt',
    columns: 50,
    rows: 16,
    options: readyShellOptions({ columns: 50, rows: 16 }),
  },
  {
    id: 'blocked_120x36',
    file: 'blocked-120x36.txt',
    columns: 120,
    rows: 36,
    options: readyShellOptions({
      columns: 120,
      rows: 36,
      aboutInfo: { version: '0.26.0-beta.1', model_policy: 'cloud_preferred' },
      credentials: { credential_sufficiency: 'insufficient', providers: [] },
    }),
  },
  {
    id: 'loading_50x16',
    file: 'loading-50x16.txt',
    columns: 50,
    rows: 16,
    options: readyShellOptions({
      columns: 50,
      rows: 16,
      pathActivation: { status: 'loading' },
      credentials: { credential_sufficiency: 'unavailable', providers: [] },
    }),
  },
  {
    id: 'nocolor_120x36',
    file: 'nocolor-120x36.txt',
    columns: 120,
    rows: 36,
    env: { NO_COLOR: '1' },
    options: readyShellOptions({
      columns: 120,
      rows: 36,
      colorEnabled: true,
    }),
  },
];

function withEnv(envPatch, fn) {
  const saved = {};
  for (const key of Object.keys(envPatch || {})) {
    saved[key] = process.env[key];
    const v = envPatch[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

fs.mkdirSync(fixturesDir, { recursive: true });

const tip = tipSha();
const ink = inkVersion();
const collected_at = new Date().toISOString();
/** @type {Record<string, object>} */
const metrics = {
  meta: {
    tip_sha: tip,
    ink_version: ink,
    node: process.version,
    collected_at,
    method: 'ink.renderToString',
    note:
      'Contract snapshots only — not clipped TTY / visual UX evidence. Use capture-tui-landing-tty.sh for real terminal frames.',
  },
  cases: {},
};

for (const c of CASES) {
  const out = withEnv(c.env || {}, () => {
    const model = buildShellModel(c.options);
    return renderOperatorTuiShellToString(model, {
      columns: c.columns,
      rows: c.rows,
    });
  });
  const snapshot = normalizeLandingSnapshot(out);
  const m = measureLandingRender(out, { columns: c.columns, rows: c.rows });
  if (!m.fits_viewport) {
    console.error(`FAIL ${c.id}: does not fit viewport`, m);
    process.exitCode = 1;
  }
  if (!m.has_start_new_run || !m.has_overall) {
    console.error(`FAIL ${c.id}: missing Start New Run or Overall:`, m);
    process.exitCode = 1;
  }
  if (c.id.startsWith('nocolor') && m.has_ansi) {
    console.error(`FAIL ${c.id}: ANSI present under NO_COLOR`, m);
    process.exitCode = 1;
  }
  fs.writeFileSync(path.join(fixturesDir, c.file), snapshot, 'utf8');
  metrics.cases[c.id] = {
    fixture: `tests/fixtures/tui/landing/${c.file}`,
    columns: c.columns,
    rows: c.rows,
    ...m,
  };
  process.stdout.write(
    `${c.id}: lines=${m.rendered_lines} width=${m.max_display_width} ansi=${m.has_ansi} fit=${m.fits_viewport}\n`,
  );
}

fs.writeFileSync(
  path.join(fixturesDir, 'metrics.json'),
  `${JSON.stringify(metrics, null, 2)}\n`,
  'utf8',
);

if (process.exitCode) {
  console.error('Fixture capture failed one or more gates.');
  process.exit(process.exitCode);
}

console.error(`Wrote fixtures + metrics.json under ${fixturesDir}`);
console.error(`tip=${tip} ink=${ink}`);
