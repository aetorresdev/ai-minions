'use strict';

/**
 * CLI for the disposable Ink 7 framework spike.
 * Not registered under `ai-minions tui`.
 */

const { runInk7FrameworkSpike } = require('./ink7-spike-entry');

async function main(argv = process.argv.slice(2)) {
  const autoQuitIdx = argv.indexOf('--auto-quit');
  const autoQuitMs = autoQuitIdx >= 0
    ? Number(argv[autoQuitIdx + 1] ?? 80)
    : 120;
  const result = await runInk7FrameworkSpike({
    autoQuitMs: Number.isFinite(autoQuitMs) ? autoQuitMs : 120,
    simulateLiveTicks: argv.includes('--live-tick') ? 1 : 0,
  });
  if (!result.ok && result.text) {
    process.stderr.write(`${result.text}\n`);
  }
  process.exitCode = result.exitCode;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
