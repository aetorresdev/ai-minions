'use strict';

/**
 * Static contract tests for capture-tui-landing-tty.sh.
 * Full PTY capture is host-dependent; these assert runner provenance + surface gate.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const stripAnsi = require('strip-ansi');
const stripAnsiFn = typeof stripAnsi === 'function' ? stripAnsi : stripAnsi.default;

const ORCH = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ORCH, 'scripts/capture-tui-landing-tty.sh');

/**
 * Same marker gate as capture-tui-landing-tty.sh (ANSI-tolerant).
 * @param {string} filePath
 * @returns {boolean}
 */
function landingSurfaceOk(filePath) {
  const plain = stripAnsiFn(fs.readFileSync(filePath, 'utf8'));
  return /Start New Run/.test(plain) && /Overall:/.test(plain);
}

describe('capture-tui-landing-tty.sh contracts', () => {
  it('ships executable shell with checkout-cli default (no auto global prefer)', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(src, /RUNNER_KIND="checkout-cli"/);
    assert.match(src, /ai-minions-cli\.js/);
    assert.match(src, /--use-installed/);
    assert.match(src, /AI_MINIONS_TUI_CAPTURE_BIN/);
    assert.match(src, /Start New Run/);
    assert.match(src, /Overall:/);
    // Must not auto-prefer PATH binary when present.
    assert.doesNotMatch(
      src,
      /if command -v ai-minions[\s\S]{0,80}CMD=\(timeout 3s ai-minions tui\)/,
    );
    assert.ok(
      (fs.statSync(SCRIPT).mode & 0o111) !== 0,
      'script must be executable',
    );
  });

  it('bash -n parses cleanly', () => {
    const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  it('rejects capture surface missing Start New Run / Overall:', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-capture-gate-'));
    const fakeOut = path.join(dir, 'bad.typescript');
    fs.writeFileSync(fakeOut, 'typescript of empty / unrelated TUI frame\n');
    assert.equal(landingSurfaceOk(fakeOut), false);
  });

  it('accepts surface that contains both required markers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-capture-ok-'));
    const okOut = path.join(dir, 'ok.typescript');
    fs.writeFileSync(
      okOut,
      `${String.fromCharCode(0x1b)}[32mAI-MINIONS${String.fromCharCode(0x1b)}[0m\n> 1. Start New Run\nOverall: Ready\n`,
    );
    assert.equal(landingSurfaceOk(okOut), true);
  });
});
