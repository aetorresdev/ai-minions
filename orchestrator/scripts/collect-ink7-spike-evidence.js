'use strict';

/**
 * Packaging / runtime evidence for the Ink 7 framework spike.
 * Prints JSON to stdout for ADR attachment (no secrets).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { probeInkPackage, runInk7FrameworkSpike } = require('../modules/operator/ink7-spike-entry');

async function main() {
  const orchRoot = path.join(__dirname, '..');
  const inkDir = path.join(orchRoot, 'node_modules', 'ink');
  const reactDir = path.join(orchRoot, 'node_modules', 'react');
  const nmDir = path.join(orchRoot, 'node_modules');

  const du = (target) => {
    const r = spawnSync('du', ['-sk', target], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    const kb = Number(String(r.stdout).trim().split(/\s+/)[0]);
    return Number.isFinite(kb) ? kb : null;
  };

  const coldStartMs = (() => {
    const started = Date.now();
    const r = spawnSync(process.execPath, ['-e', "import('ink').then(() => import('react')).then(() => process.exit(0))"], {
      cwd: orchRoot,
      encoding: 'utf8',
      env: process.env,
    });
    return { ms: Date.now() - started, status: r.status };
  })();

  const nonTty = await runInk7FrameworkSpike({ isTTY: false });
  const probe = probeInkPackage();

  const evidence = {
    collected_at: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    probe,
    installed_size_kb: {
      ink: du(inkDir),
      react: du(reactDir),
      node_modules: du(nmDir),
    },
    cold_import: coldStartMs,
    non_tty: {
      reason_code: nonTty.reason_code,
      ink_loaded: nonTty.ink_loaded,
      react_loaded: nonTty.react_loaded,
    },
    windows: {
      status: 'deferred',
      note: 'Windows interactive spike not exercised in this evidence run; treat as unsupported until dedicated evidence lands.',
    },
    macos: {
      status: 'deferred_host',
      note: 'macOS interactive evidence required before release-tag closeout; Linux exercised in CI/unit hosts.',
    },
  };

  const outPath = path.join(orchRoot, 'tests', 'fixtures', 'ink7-spike-evidence.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
