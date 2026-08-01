'use strict';

/**
 * Dynamic tests for capture-tui-landing-tty.sh using a simulated repo + runners.
 * Exercises the real bash script (not regex-only contract checks).
 * Uses a PATH-injected script(1) stub so gates run without a host PTY.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ORCH = path.resolve(__dirname, '../..');
const SCRIPT_SRC = path.join(ORCH, 'scripts/capture-tui-landing-tty.sh');
const REAL_STRIP_ANSI = path.join(ORCH, 'node_modules/strip-ansi');
const REAL_INK = path.join(ORCH, 'node_modules/ink');

const MARKERS = '> 1. Start New Run\nOverall: Ready\n';

/**
 * @param {string} dir
 * @param {string} rel
 * @param {string} body
 * @param {{ mode?: number }} [opts]
 */
function writeFile(dir, rel, body, opts = {}) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, { mode: opts.mode });
  return full;
}

/**
 * util-linux-compatible script(1) stub: run -c / -- command, write stdout to file, return child rc.
 * @returns {string} directory to prepend to PATH
 */
function makeFakeScriptDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-fake-script-'));
  const body = `#!/usr/bin/env bash
set -euo pipefail
cmd=""
out=""
use_cmd=0
args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -q|--quiet|-e|--return|-f|--flush|--force) shift ;;
    -c|--command)
      cmd="\${2:-}"
      use_cmd=1
      shift 2
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do args+=("$1"); shift; done
      break
      ;;
    -*)
      shift
      ;;
    *)
      if [[ -z "$out" ]]; then
        out="$1"
        shift
      else
        args+=("$1")
        shift
      fi
      ;;
  esac
done
# Capability probes used by capture-tui-landing-tty.sh
if [[ "$use_cmd" -eq 1 && "$cmd" == "true" ]]; then
  exit 0
fi
mkdir -p "$(dirname "$out")"
set +e
if [[ "$use_cmd" -eq 1 ]]; then
  bash -c "$cmd" >"$out" 2>/dev/null
  rc=$?
else
  "\${args[@]}" >"$out" 2>/dev/null
  rc=$?
fi
set -e
exit "$rc"
`;
  fs.writeFileSync(path.join(dir, 'script'), body, { mode: 0o755 });
  return dir;
}

/**
 * Build an isolated git repo that mirrors the script's expected layout.
 * @param {{ cliBody?: string, commit?: boolean }} [opts]
 */
function makeHarness(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-capture-harness-'));
  const orch = path.join(root, 'orchestrator');
  fs.mkdirSync(orch, { recursive: true });

  const cliBody =
    opts.cliBody ||
    `#!/usr/bin/env node
'use strict';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write(process.env.FAKE_CHECKOUT_VERSION || 'v0.99.0-checkout\\n');
  process.exit(0);
}
if (args[0] === 'tui') {
  process.stdout.write(process.env.FAKE_TUI_FRAME || ${JSON.stringify(MARKERS)});
  const code = Number(process.env.FAKE_TUI_EXIT || '0');
  process.exit(Number.isFinite(code) ? code : 0);
}
process.stderr.write('usage: fake-cli --version|tui\\n');
process.exit(2);
`;

  writeFile(root, 'orchestrator/ai-minions-cli.js', cliBody);
  writeFile(
    root,
    'orchestrator/package.json',
    JSON.stringify({ name: 'fake-orch', version: '1.0.0' }, null, 2) + '\n',
  );

  const nm = path.join(orch, 'node_modules');
  fs.mkdirSync(nm, { recursive: true });
  fs.symlinkSync(REAL_STRIP_ANSI, path.join(nm, 'strip-ansi'), 'dir');
  fs.symlinkSync(REAL_INK, path.join(nm, 'ink'), 'dir');

  const scriptDst = writeFile(
    root,
    'orchestrator/scripts/capture-tui-landing-tty.sh',
    fs.readFileSync(SCRIPT_SRC, 'utf8'),
    { mode: 0o755 },
  );
  fs.chmodSync(scriptDst, 0o755);

  const git = (args) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(git(['init', '-q']).status, 0, 'git init');
  // Isolate from global commit.gpgsign / user identity.
  assert.equal(git(['config', 'user.email', 'test@example.com']).status, 0);
  assert.equal(git(['config', 'user.name', 'Capture Test']).status, 0);
  assert.equal(git(['config', 'commit.gpgsign', 'false']).status, 0);
  assert.equal(git(['add', '-A']).status, 0, 'git add');
  if (opts.commit !== false) {
    const c = git(['commit', '-q', '-m', 'harness']);
    assert.equal(c.status, 0, c.stderr || c.stdout || 'git commit failed');
  }

  const tip = git(['rev-parse', 'HEAD']);
  assert.equal(tip.status, 0, tip.stderr || 'rev-parse');
  return {
    root,
    script: scriptDst,
    checkoutCli: path.join(orch, 'ai-minions-cli.js'),
    tipSha: (tip.stdout || '').trim(),
  };
}

/**
 * Fake installed binary (executable, product --version).
 * @param {string} dir
 * @param {{ version?: string, frame?: string, exitCode?: number, name?: string }} [opts]
 */
function makeInstalledBin(dir, opts = {}) {
  const name = opts.name || 'ai-minions';
  const bin = path.join(dir, name);
  const version = opts.version || 'v0.26.0-installed';
  const frame = opts.frame || MARKERS;
  const exitCode = opts.exitCode ?? 0;
  const body = `#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then
  echo ${JSON.stringify(version)}
  exit 0
fi
if [[ "\${1:-}" == "tui" ]]; then
  printf '%s' ${JSON.stringify(frame)}
  exit ${exitCode}
fi
echo "usage: $name --version|tui" >&2
exit 2
`;
  fs.writeFileSync(bin, body, { mode: 0o755 });
  return bin;
}

/**
 * Build a bin directory with symlinks to the host tools the capture script
 * needs — deliberately WITHOUT timeout/gtimeout, simulating stock macOS so the
 * bash watchdog fallback is exercised on any host.
 * @returns {string} directory to use as the full PATH suffix
 */
function makeRestrictedBinDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-restricted-bin-'));
  const tools = [
    'bash', 'cat', 'chmod', 'dirname', 'env', 'git', 'head', 'mkdir',
    'mktemp', 'node', 'rm', 'sleep', 'tr',
  ];
  for (const tool of tools) {
    const found = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
    assert.equal(found.status, 0, `host tool required for restricted-PATH test: ${tool}`);
    fs.symlinkSync(found.stdout.trim(), path.join(dir, tool));
  }
  return dir;
}

/**
 * @param {string} script
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string[]} [pathPrefix]
 */
function runCapture(script, args, env = {}, pathPrefix = []) {
  const fakeScriptDir = makeFakeScriptDir();
  const prefix = [...pathPrefix, fakeScriptDir].join(path.delimiter);
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      PATH: `${prefix}${path.delimiter}${env.PATH || process.env.PATH || ''}`,
    },
  });
}

describe('capture-tui-landing-tty.sh (executed)', () => {
  it('bash -n parses cleanly', () => {
    const r = spawnSync('bash', ['-n', SCRIPT_SRC], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  it('default uses checkout-cli even when ai-minions is on PATH', () => {
    const h = makeHarness();
    const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-path-'));
    makeInstalledBin(pathDir, {
      version: 'v0.0.0-path-should-not-win',
      frame: 'PATH BIN Start New Run\nOverall: from-path\n',
    });
    const out = path.join(h.root, 'cap-default.typescript');
    const r = runCapture(
      h.script,
      ['80', '24', out],
      {
        FAKE_CHECKOUT_VERSION: 'v0.99.0-checkout',
        FAKE_TUI_EXIT: '0',
        FAKE_TUI_FRAME: MARKERS,
      },
      [pathDir],
    );
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
    assert.match(r.stdout, /runner_kind=checkout-cli/);
    assert.match(r.stdout, /runner_version=v0\.99\.0-checkout/);
    assert.doesNotMatch(r.stdout, /v0\.0\.0-path-should-not-win/);
    const meta = JSON.parse(fs.readFileSync(`${out}.meta.json`, 'utf8'));
    assert.equal(meta.runner_kind, 'checkout-cli');
    assert.equal(meta.runner_path, h.checkoutCli);
    assert.equal(meta.runner_version, 'v0.99.0-checkout');
    assert.equal(meta.source_tip_sha, h.tipSha);
    assert.equal(meta.script_rc, 0);
    assert.ok(fs.readFileSync(out, 'utf8').includes('Start New Run'));
  });

  it('fails when surface markers are missing', () => {
    const h = makeHarness();
    const out = path.join(h.root, 'cap-nomarkers.typescript');
    const r = runCapture(h.script, ['80', '24', out], {
      FAKE_TUI_FRAME: 'typescript of empty / unrelated TUI frame\n',
      FAKE_TUI_EXIT: '0',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing required markers/);
    assert.equal(fs.existsSync(`${out}.meta.json`), false);
  });

  it('accepts script_rc 124 (timeout) when markers exist', () => {
    const h = makeHarness();
    const out = path.join(h.root, 'cap-timeout.typescript');
    const r = runCapture(h.script, ['80', '24', out], {
      FAKE_TUI_FRAME: MARKERS,
      FAKE_TUI_EXIT: '124',
      FAKE_CHECKOUT_VERSION: 'v0.99.0-checkout',
    });
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
    assert.match(r.stdout, /script_rc=124/);
    const meta = JSON.parse(fs.readFileSync(`${out}.meta.json`, 'utf8'));
    assert.equal(meta.script_rc, 124);
    assert.equal(meta.runner_version, 'v0.99.0-checkout');
  });

  it('rejects non-zero script_rc other than 124 even when markers exist', () => {
    const h = makeHarness();
    const out = path.join(h.root, 'cap-crash.typescript');
    const r = runCapture(h.script, ['80', '24', out], {
      FAKE_TUI_FRAME: MARKERS,
      FAKE_TUI_EXIT: '1',
      FAKE_CHECKOUT_VERSION: 'v0.99.0-checkout',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unexpected script_rc=1/);
    assert.equal(fs.existsSync(`${out}.meta.json`), false);
  });

  it('writes correct sidecar metadata for installed-runner opt-in', () => {
    const h = makeHarness();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-installed-'));
    const bin = makeInstalledBin(binDir, {
      version: 'v0.26.0-beta.1',
      frame: MARKERS,
      exitCode: 0,
    });
    const out = path.join(h.root, 'cap-installed.typescript');
    const r = runCapture(
      h.script,
      ['80', '24', out],
      { AI_MINIONS_TUI_CAPTURE_BIN: bin },
      [binDir],
    );
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
    assert.match(r.stdout, /runner_kind=installed-bin/);
    const meta = JSON.parse(fs.readFileSync(`${out}.meta.json`, 'utf8'));
    assert.equal(meta.runner_kind, 'installed-bin');
    assert.equal(meta.runner_version, 'v0.26.0-beta.1');
    assert.equal(meta.source_tip_sha, h.tipSha);
    const resolvedBin = fs.realpathSync(bin);
    assert.equal(fs.realpathSync(meta.runner_path), resolvedBin);
  });

  it('fails on dirty worktree', () => {
    const h = makeHarness();
    fs.writeFileSync(path.join(h.root, 'dirty.txt'), 'uncommitted\n');
    const out = path.join(h.root, 'cap-dirty.typescript');
    const r = runCapture(h.script, ['80', '24', out], {
      FAKE_TUI_FRAME: MARKERS,
      FAKE_TUI_EXIT: '0',
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /dirty worktree/);
    assert.equal(fs.existsSync(`${out}.meta.json`), false);
  });

  it('falls back to the bash watchdog when timeout(1) is absent (stock macOS)', () => {
    const h = makeHarness();
    const out = path.join(h.root, 'cap-watchdog.typescript');
    const r = runCapture(h.script, ['80', '24', out], {
      PATH: makeRestrictedBinDir(),
      FAKE_TUI_FRAME: MARKERS,
      FAKE_TUI_EXIT: '0',
      FAKE_CHECKOUT_VERSION: 'v0.99.0-checkout',
    });
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
    assert.match(r.stdout, /runner_kind=checkout-cli/);
    const meta = JSON.parse(fs.readFileSync(`${out}.meta.json`, 'utf8'));
    assert.equal(meta.script_rc, 0);
    assert.equal(meta.runner_version, 'v0.99.0-checkout');
    assert.ok(fs.readFileSync(out, 'utf8').includes('Start New Run'));
  });

  it('watchdog kills a hung runner at the deadline and reports script_rc=124', () => {
    const hangCli = `#!/usr/bin/env node
'use strict';
if (process.argv[2] === '--version') {
  process.stdout.write('v0.99.0-checkout\\n');
  process.exit(0);
}
process.stdout.write(${JSON.stringify(MARKERS)});
setTimeout(() => process.exit(0), 30000);
`;
    const h = makeHarness({ cliBody: hangCli });
    const out = path.join(h.root, 'cap-watchdog-kill.typescript');
    const r = runCapture(h.script, ['80', '24', out], {
      PATH: makeRestrictedBinDir(),
      FAKE_CHECKOUT_VERSION: 'v0.99.0-checkout',
    });
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
    assert.match(r.stdout, /script_rc=124/);
    const meta = JSON.parse(fs.readFileSync(`${out}.meta.json`, 'utf8'));
    assert.equal(meta.script_rc, 124);
    assert.equal(meta.runner_version, 'v0.99.0-checkout');
  });
});
