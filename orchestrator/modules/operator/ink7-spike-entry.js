'use strict';

/**
 * Disposable Ink 7 framework spike entry.
 * Non-TTY path never loads Ink/React. Not wired into `ai-minions tui`.
 */

const path = require('path');
const fs = require('fs');

const { runOperatorRuns } = require('./operator-run-list');
const { runOperatorStatus } = require('./operator-trace-command');
const {
  adaptRunsPayload,
  adaptStatusPayload,
  buildSpikeShellModel,
  formatSpikeShellText,
} = require('./ink7-spike-view-model');
const { createTerminalGuard, withTerminalGuard } = require('./ink7-spike-cleanup');

const SPIKE_ENTRY_REASON = Object.freeze({
  NON_TTY: 'INK7_SPIKE_NON_TTY',
  OK: 'INK7_SPIKE_OK',
  RENDERER_EXCEPTION: 'INK7_SPIKE_RENDERER_EXCEPTION',
  CHILD_FAILURE: 'INK7_SPIKE_CHILD_FAILURE',
  ABORT: 'INK7_SPIKE_ABORT',
});

/**
 * @returns {string}
 */
function formatNonTtySpikeGuidance() {
  return [
    'ink7 framework spike requires a TTY for the interactive renderer.',
    'Non-TTY: operator modules remain available via CLI verbs (no Ink/React load):',
    '  ai-minions runs',
    '  ai-minions status --run-id <task_id>',
    '  ai-minions tui   # production fullscreen Ink shell (legacy: AI_MINIONS_TUI_LEGACY=1)',
    'Interactive spike (TTY only): npm run spike:ink7 --prefix orchestrator',
  ].join('\n');
}

/**
 * @param {{
 *   isTTY?: boolean,
 *   stdin?: NodeJS.ReadStream,
 *   stdout?: NodeJS.WriteStream,
 *   stderr?: NodeJS.WriteStream,
 *   tracesDir?: string,
 *   limit?: number,
 *   selectedRunId?: string | null,
 *   columns?: number,
 *   rows?: number,
 *   forceRenderLoad?: boolean,
 *   simulateLiveTicks?: number,
 *   autoQuitMs?: number,
 *   injectFailure?: 'renderer' | 'child' | null,
 *   loadRuns?: typeof runOperatorRuns,
 *   loadStatus?: typeof runOperatorStatus,
 *   importRenderer?: () => Promise<{ renderSpikeShell: Function }>,
 * }} [options]
 */
async function runInk7FrameworkSpike(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const isTTY = options.isTTY != null
    ? Boolean(options.isTTY)
    : Boolean(stdin.isTTY && stdout.isTTY);

  if (!isTTY && options.forceRenderLoad !== true) {
    const text = formatNonTtySpikeGuidance();
    return {
      ok: false,
      exitCode: 1,
      reason_code: SPIKE_ENTRY_REASON.NON_TTY,
      ink_loaded: false,
      react_loaded: false,
      text,
      model: null,
      guard: null,
    };
  }

  const loadRuns = options.loadRuns ?? runOperatorRuns;
  const loadStatus = options.loadStatus ?? runOperatorStatus;
  const runsResult = loadRuns({
    tracesDir: options.tracesDir,
    limit: options.limit ?? 20,
    json: true,
    useColor: false,
  });
  // runOperatorRuns nests the list under `.json`; tolerate a flat fixture shape in tests.
  const adapted = adaptRunsPayload(runsResult?.json ?? runsResult);
  let selectedRunId = options.selectedRunId ?? adapted.runs[0]?.run_id ?? null;
  let statusPayload = null;
  if (selectedRunId) {
    const statusResult = loadStatus({
      runId: selectedRunId,
      tracesDir: options.tracesDir,
      json: true,
      useColor: false,
    });
    const statusJson = statusResult.json && typeof statusResult.json === 'object'
      ? statusResult.json
      : {};
    statusPayload = adaptStatusPayload({
      run_id: statusJson.run_id ?? selectedRunId,
      result_code: statusResult.result_code ?? statusJson.result_code ?? null,
      status: statusJson.status ?? null,
      outcome: statusJson.operator_trace_summary?.outcome ?? null,
      reason_code: statusResult.reason_code
        ?? statusJson.run_state_visibility?.blocking_reason_code
        ?? null,
      next_safe_action: statusResult.next_safe_action
        ?? statusJson.operator_trace_summary?.next_safe_action
        ?? null,
    });
  }

  const columns = options.columns
    ?? (typeof stdout.columns === 'number' ? stdout.columns : 80);
  const rows = options.rows
    ?? (typeof stdout.rows === 'number' ? stdout.rows : 24);

  let model = buildSpikeShellModel({
    runs: adapted.runs,
    selectedRunId,
    status: statusPayload,
    columns,
    rows,
    focus: 'nav',
    commandInput: '',
    liveTick: 0,
    colorEnabled: process.env.NO_COLOR == null,
  });

  if (options.simulateLiveTicks && options.simulateLiveTicks > 0) {
    const { applyLiveTick } = require('./ink7-spike-view-model');
    for (let i = 0; i < options.simulateLiveTicks; i += 1) {
      model = applyLiveTick(model, 1);
    }
  }

  const guard = createTerminalGuard({ stdin, stdout });

  if (options.injectFailure === 'child') {
    try {
      await withTerminalGuard(guard, async () => {
        throw new Error('simulated child-process failure');
      }, 'child_process_failure');
    } catch (_err) {
      // expected — guard must restore before returning
    }
    return {
      ok: false,
      exitCode: 1,
      reason_code: SPIKE_ENTRY_REASON.CHILD_FAILURE,
      ink_loaded: false,
      react_loaded: false,
      text: formatSpikeShellText(model),
      model,
      guard,
    };
  }

  const importRenderer = options.importRenderer ?? (() => import('./ink7-spike-render.mjs'));

  let inkLoaded = false;
  let reactLoaded = false;
  try {
    const renderer = await importRenderer();
    inkLoaded = true;
    reactLoaded = true;
    if (options.injectFailure === 'renderer') {
      await withTerminalGuard(guard, async () => {
        throw new Error('simulated renderer exception');
      }, 'renderer_exception');
    }
    const result = await withTerminalGuard(guard, async () => renderer.renderSpikeShell({
      model,
      stdin,
      stdout,
      stderr: options.stderr ?? process.stderr,
      autoQuitMs: options.autoQuitMs,
      onModelChange: (next) => {
        model = next;
      },
    }), 'normal');
    return {
      ok: true,
      exitCode: 0,
      reason_code: result?.aborted ? SPIKE_ENTRY_REASON.ABORT : SPIKE_ENTRY_REASON.OK,
      ink_loaded: inkLoaded,
      react_loaded: reactLoaded,
      text: formatSpikeShellText(model),
      model,
      guard,
      frames: result?.frames ?? null,
    };
  } catch (err) {
    if (!guard.restored) guard.restore('renderer_exception');
    return {
      ok: false,
      exitCode: 1,
      reason_code: SPIKE_ENTRY_REASON.RENDERER_EXCEPTION,
      ink_loaded: inkLoaded,
      react_loaded: reactLoaded,
      text: formatSpikeShellText(model),
      model,
      guard,
      error: String(err && err.message ? err.message : err),
    };
  }
}

/**
 * Resolve whether Ink is resolvable without executing the interactive loop.
 * Used by packaging evidence; does not open a renderer.
 */
function probeInkPackage() {
  const orchRoot = path.join(__dirname, '..', '..');
  const inkPkgPath = path.join(orchRoot, 'node_modules', 'ink', 'package.json');
  const reactPkgPath = path.join(orchRoot, 'node_modules', 'react', 'package.json');
  const inkPkg = JSON.parse(fs.readFileSync(inkPkgPath, 'utf8'));
  const reactPkg = JSON.parse(fs.readFileSync(reactPkgPath, 'utf8'));
  return {
    ink_version: inkPkg.version,
    ink_engines: inkPkg.engines || null,
    react_version: reactPkg.version,
    ink_type: inkPkg.type || null,
  };
}

module.exports = {
  SPIKE_ENTRY_REASON,
  formatNonTtySpikeGuidance,
  runInk7FrameworkSpike,
  probeInkPackage,
};
