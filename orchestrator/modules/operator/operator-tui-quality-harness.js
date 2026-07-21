'use strict';

/**
 * Shared helpers for Operator TUI MVP quality-gate tests.
 * Prefer render/state model assertions over fullscreen terminal pixels.
 * Not a product pane — harness only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ANSI_CSI = '\x1b[';

/**
 * @param {string} text
 * @returns {boolean}
 */
function containsAnsi(text) {
  return String(text ?? '').includes(ANSI_CSI);
}

/**
 * Assert human text may use ANSI only when useColor is true.
 * @param {string} text
 * @param {{ useColor?: boolean }} [opts]
 */
function assertAnsiPolicy(text, opts = {}) {
  const useColor = opts.useColor === true;
  if (useColor) {
    if (!containsAnsi(text)) {
      throw new Error('expected ANSI escapes when useColor=true');
    }
    return;
  }
  if (containsAnsi(text)) {
    throw new Error('ANSI escapes forbidden when useColor=false / shareable path');
  }
}

/**
 * Shareable surfaces (JSON stringify, Markdown, copy blocks) must never carry ANSI.
 * @param {unknown} value
 */
function assertNoAnsiInShareable(value) {
  const blob = typeof value === 'string' ? value : JSON.stringify(value);
  if (containsAnsi(blob)) {
    throw new Error('ANSI escapes forbidden in JSON/Markdown/shareable outputs');
  }
}

/**
 * Credential / secret honesty: status labels only; never echo known secret substrings.
 * @param {string} text
 * @param {string[]} [forbiddenSubstrings]
 */
function assertNoSecretSurfaces(text, forbiddenSubstrings = []) {
  const hay = String(text ?? '');
  for (const needle of forbiddenSubstrings) {
    if (needle && hay.includes(needle)) {
      throw new Error(`secret-like substring leaked into TUI surface: ${needle.slice(0, 8)}…`);
    }
  }
  if (/sk-ant-|sk-proj-|sk-[a-zA-Z0-9]{16,}/.test(hay)) {
    throw new Error('provider-token-shaped substring leaked into TUI surface');
  }
}

/**
 * Claim honesty for MVP cockpit — must not invent fullscreen / production TUI.
 * @param {string} text
 */
function assertMvpClaimHonesty(text) {
  const hay = String(text ?? '').toLowerCase();
  if (!/not claimed|not fullscreen|not (a )?production/.test(hay)) {
    throw new Error('MVP surface missing Not claimed / not-fullscreen honesty');
  }
  if (/\bfullscreen product\b|\bproduction tui shipped\b/.test(hay)) {
    throw new Error('MVP surface invents fullscreen/production TUI claim');
  }
}

/**
 * @param {string} dir
 * @param {string} name
 * @param {object[]} rows
 */
function writeTraceFixture(dir, name, rows) {
  fs.writeFileSync(
    path.join(dir, `${name}.jsonl`),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
}

/**
 * Temp traces dir for quality-gate scenarios (cleaned by caller via fs.rmSync).
 * @returns {string}
 */
function makeTempTracesDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-tui-qg-'));
}

/**
 * Scenario builders — state snapshots for the TUI MVP quality matrix.
 * @param {string} tracesDir
 */
function seedQualityGateScenarios(tracesDir) {
  writeTraceFixture(tracesDir, 'ok-run', [
    { event: 'session_start', task_id: 'ok-run', flow_mode: 'single_agent', ts_ms: 1 },
    { event: 'session_end', task_id: 'ok-run', done: true, gate_blocks: 0, ts_ms: 2 },
  ]);
  writeTraceFixture(tracesDir, 'fail-run', [
    { event: 'session_start', task_id: 'fail-run', flow_mode: 'single_agent', ts_ms: 10 },
    {
      event: 'session_end',
      task_id: 'fail-run',
      done: false,
      iterations: 2,
      gate_blocks: 0,
      ts_ms: 11,
    },
  ]);
  writeTraceFixture(tracesDir, 'blocked-run', [
    { event: 'session_start', task_id: 'blocked-run', flow_mode: 'single_agent', ts_ms: 20 },
    {
      event: 'gate_block',
      gate: 'CERBERUS',
      reason_code: 'CERBERUS_REJECT',
      task_id: 'blocked-run',
      ts_ms: 21,
    },
    {
      event: 'session_end',
      task_id: 'blocked-run',
      done: false,
      gate_blocks: 1,
      iterations: 1,
      ts_ms: 22,
    },
  ]);
  fs.writeFileSync(path.join(tracesDir, 'bad-run.jsonl'), '\n', 'utf8');
}

/**
 * Quality-gate inventory — maps acceptance scenarios to owning test surfaces.
 * Neutral identifiers only (no backlog ticket tokens in shipped source).
 */
const TUI_QUALITY_SCENARIOS = Object.freeze([
  'empty_run_store',
  'invalid_trace',
  'successful_run',
  'failed_or_blocked_run',
  'attach_bundle_present_or_missing',
  'missing_credentials',
  'local_only_tokens_not_required',
  'non_tty_fallback',
  'unknown_action_command',
  'no_ansi_in_shareables',
  'no_color_human_stdout_policy',
  'no_secret_surfaces',
  'mvp_claim_honesty',
  'no_shell_rc_mutation',
]);

module.exports = {
  ANSI_CSI,
  TUI_QUALITY_SCENARIOS,
  containsAnsi,
  assertAnsiPolicy,
  assertNoAnsiInShareable,
  assertNoSecretSurfaces,
  assertMvpClaimHonesty,
  writeTraceFixture,
  makeTempTracesDir,
  seedQualityGateScenarios,
};
