'use strict';

/**
 * Production fullscreen TUI shell entry for `ai-minions tui`.
 * Ink/React load only behind an explicit TTY (or test force) gate.
 * Operator modules remain authoritative; legacy readline cockpit is a rollback path.
 */

const { buildAboutInfo } = require('./operator-about');
const {
  assessProviderCredentials,
  assessPathActivation,
} = require('./operator-credential-readiness');
const { runOperatorRuns } = require('./operator-run-list');
const { formatNonTtyGuidance } = require('./operator-cockpit-tui');
const { runOperatorCockpit } = require('./operator-cockpit-tui');
const {
  buildShellModel,
  formatShellText,
  isShellSessionEndAction,
  shellModelToOptions,
} = require('./operator-tui-shell-model');
const {
  mergeActionOutcomeIntoEntryState,
  buildEntryModelAfterNestedExecute,
} = require('./operator-tui-shell-controller');
const {
  executeShellAction,
} = require('./operator-tui-shell-actions');
const {
  createTerminalGuard,
  withTerminalGuard,
  prepareNestedPaneIo,
  resumeInkSession,
  drainStdinColdStart,
} = require('./operator-tui-terminal-guard');
const { adaptActionResult } = require('./operator-tui-adapters');
const { shouldSkipSplash } = require('./operator-tui-splash');
const {
  NATIVE_LAUNCHER_EXECUTE_ACTION,
} = require('./operator-tui-native-workflows');

const TUI_SHELL_REASON = Object.freeze({
  NON_TTY: 'COCKPIT_TTY_REQUIRED',
  OK: 'TUI_SHELL_OK',
  QUIT: 'TUI_SHELL_QUIT',
  ABORT: 'TUI_SHELL_ABORT',
  RENDERER_EXCEPTION: 'TUI_SHELL_RENDERER_EXCEPTION',
  CHILD_FAILURE: 'TUI_SHELL_CHILD_FAILURE',
  ACTION_FAILURE: 'TUI_SHELL_ACTION_FAILURE',
  LEGACY: 'TUI_SHELL_LEGACY',
  MAX_LOOPS: 'TUI_SHELL_MAX_LOOPS',
  COLD_START_DRAIN_TRUNCATED: 'TUI_SHELL_COLD_START_DRAIN_TRUNCATED',
});

/**
 * @returns {boolean}
 */
function legacyShellRequested() {
  const raw = String(process.env.AI_MINIONS_TUI_LEGACY ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'readline';
}

/**
 * Production first-paint: version + explicit loading/unavailable readiness only.
 * Credential/path assessment and run discovery must not run before this model paints.
 * @param {{
 *   aboutInfo?: object,
 *   columns?: number,
 *   rows?: number,
 *   colorEnabled?: boolean,
 *   icons?: string,
 *   iconMode?: string,
 * }} [options]
 */
function buildFirstPaintShellModel(options = {}) {
  const aboutInfo = options.aboutInfo && typeof options.aboutInfo === 'object'
    ? options.aboutInfo
    : {};
  return buildShellModel({
    aboutInfo,
    credentials: {
      credential_sufficiency: 'unavailable',
      providers: [],
    },
    pathActivation: {
      status: 'loading',
      on_path: null,
    },
    runsPayload: {
      ok: true,
      exitCode: 0,
      result_code: 'RUNS_UNAVAILABLE',
      next_safe_action: 'none',
      json: {
        result_code: 'RUNS_UNAVAILABLE',
        runs: [],
        next_safe_action: 'none',
      },
    },
    selectedNavId: 'launcher',
    contentSurface: 'home',
    columns: options.columns,
    rows: options.rows,
    focus: 'nav',
    colorEnabled: options.colorEnabled !== false,
    icons: options.icons ?? options.iconMode,
    iconMode: options.iconMode ?? options.icons,
    productVersion: aboutInfo.version,
  });
}

/**
 * Cold start / new TUI process always boots to landing home unless the operator
 * explicitly requested start-run (CLI / confirmed handoff flag).
 * Ignores stale contentSurface / activeWorkflow residues that would skip landing.
 * @param {{
 *   contentSurface?: string,
 *   activeWorkflow?: object | null,
 *   explicitStartRun?: boolean,
 * }} [options]
 * @returns {{ contentSurface: string, activeWorkflow: null | object }}
 */
function resolveColdStartShellSurface(options = {}) {
  if (options.explicitStartRun === true) {
    const wf = options.activeWorkflow && typeof options.activeWorkflow === 'object'
      ? options.activeWorkflow
      : null;
    return {
      contentSurface: wf ? 'launcher_workflow' : 'home',
      activeWorkflow: wf,
    };
  }
  return {
    contentSurface: 'home',
    activeWorkflow: null,
  };
}

/**
 * Whether the production splash gate should run (skipped for harness finite loops / auto-quit).
 * @param {{
 *   skipSplash?: boolean,
 *   autoQuitMs?: number,
 *   maxLoops?: number — max nested execute invocations per session (not Ink remount count),
 * }} options
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function shouldShowProductionSplash(options = {}, env = process.env) {
  if (options.skipSplash === true) return false;
  if (shouldSkipSplash(env)) return false;
  if (Number.isFinite(options.autoQuitMs) && options.autoQuitMs >= 0) return false;
  if (Number.isInteger(options.maxLoops) && options.maxLoops > 0
    && options.maxLoops < Number.POSITIVE_INFINITY) {
    return false;
  }
  return true;
}

/**
 * @param {{
 *   isTTY?: boolean,
 *   useColor?: boolean,
 *   cwd?: string,
 *   stdin?: NodeJS.ReadStream,
 *   stdout?: NodeJS.WriteStream,
 *   stderr?: NodeJS.WriteStream,
 *   tracesDir?: string,
 *   columns?: number,
 *   rows?: number,
 *   forceRenderLoad?: boolean,
 *   autoQuitMs?: number,
 *   skipSplash?: boolean,
 *   splashMs?: number,
 *   maxLoops?: number — max nested execute invocations per session (not Ink remount count),
 *   injectFailure?: 'renderer' | 'child' | null,
 *   preferLegacy?: boolean,
 *   buildAbout?: typeof buildAboutInfo,
 *   assessCredentials?: typeof assessProviderCredentials,
 *   assessPath?: typeof assessPathActivation,
 *   loadRuns?: typeof runOperatorRuns,
 *   executeAction?: typeof executeShellAction,
 *   importRenderer?: () => Promise<{ renderOperatorTuiShell: Function }>,
 *   runLegacyCockpit?: typeof runOperatorCockpit,
 *   selectedRunId?: string | null,
 *   statusResult?: object | null,
 *   evidenceModel?: object | null,
 * }} [options]
 */
async function runOperatorTuiShell(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const isTTY = options.isTTY != null
    ? Boolean(options.isTTY)
    : Boolean(stdin.isTTY && stdout.isTTY);

  if (!isTTY && options.forceRenderLoad !== true) {
    const text = formatNonTtyGuidance();
    return {
      ok: false,
      exitCode: 1,
      reason_code: TUI_SHELL_REASON.NON_TTY,
      ink_loaded: false,
      react_loaded: false,
      text,
      model: null,
      guard: null,
    };
  }

  if (options.preferLegacy === true || legacyShellRequested()) {
    const legacy = options.runLegacyCockpit ?? runOperatorCockpit;
    const result = await legacy({
      isTTY: true,
      useColor: options.useColor,
      cwd: options.cwd,
      stdin,
      stdout,
    });
    return {
      ...result,
      reason_code: result.reason_code ?? TUI_SHELL_REASON.LEGACY,
      ink_loaded: false,
      react_loaded: false,
      legacy: true,
    };
  }

  const buildAbout = options.buildAbout ?? buildAboutInfo;
  const assessCredentials = options.assessCredentials ?? assessProviderCredentials;
  const assessPath = options.assessPath ?? assessPathActivation;
  const loadRuns = options.loadRuns ?? runOperatorRuns;
  const executeAction = options.executeAction ?? executeShellAction;
  const useColor = options.useColor === true;

  // Version only before first paint — defer credential/path assessment and run discovery.
  let aboutInfo = buildAbout({ cwd: options.cwd });

  const columns = options.columns
    ?? (typeof stdout.columns === 'number' ? stdout.columns : 80);
  const rows = options.rows
    ?? (typeof stdout.rows === 'number' ? stdout.rows : 24);

  let selectedRunId = options.selectedRunId == null || options.selectedRunId === ''
    ? null
    : String(options.selectedRunId);
  const coldStart = resolveColdStartShellSurface({
    contentSurface: options.contentSurface,
    activeWorkflow: options.activeWorkflow,
    explicitStartRun: options.explicitStartRun === true,
  });
  let contentSurface = coldStart.contentSurface;
  /** @type {object | null} */
  let statusResult = options.statusResult && typeof options.statusResult === 'object'
    ? options.statusResult
    : null;
  /** @type {object | null} */
  let evidenceModel = options.evidenceModel && typeof options.evidenceModel === 'object'
    ? options.evidenceModel
    : null;
  /** @type {object | null} */
  let configModel = null;
  /** @type {object | null} */
  let actionResult = null;
  /** @type {object | null} */
  let lifecycleSource = null;
  /** @type {object | null} */
  let monitorSource = null;
  let launcherModel = null;
  /** @type {object | null} */
  let credentials = null;
  /** @type {object | null} */
  let pathActivation = null;
  /** @type {object | null} */
  let runsPayload = null;

  const colorEnabled = useColor && process.env.NO_COLOR == null;
  const iconMode = options.icons ?? options.iconMode;
  const wantsSplash = shouldShowProductionSplash(options);

  let model = buildFirstPaintShellModel({
    aboutInfo,
    columns,
    rows,
    colorEnabled,
    icons: iconMode,
  });
  selectedRunId = model.selectedRunId;

  /**
   * Populate readiness + runs after splash continuation (or immediately when splash is skipped).
   */
  function discoverShellBootstrap() {
    credentials = assessCredentials({ modelPolicy: aboutInfo.model_policy });
    pathActivation = assessPath();
    runsPayload = loadRuns({
      tracesDir: options.tracesDir,
      limit: 20,
      json: true,
      useColor: false,
    });
    if (options.selectedRunId != null && options.selectedRunId !== '') {
      selectedRunId = String(options.selectedRunId);
    }
    model = buildShellModel({
      aboutInfo,
      credentials,
      pathActivation,
      runsPayload,
      statusResult,
      evidenceModel,
      configModel,
      launcherModel,
      actionResult,
      lifecycleSource,
      monitorSource,
      selectedRunId,
      selectedNavId: 'launcher',
      contentSurface,
      columns,
      rows,
      focus: 'nav',
      colorEnabled,
      icons: iconMode ?? model.iconMode,
      productVersion: aboutInfo.version,
      activeWorkflow: coldStart.activeWorkflow,
    });
    selectedRunId = model.selectedRunId;
  }

  let guard = createTerminalGuard({ stdin, stdout });
  const maxLoops = Number.isInteger(options.maxLoops) && options.maxLoops > 0
    ? options.maxLoops
    : Number.POSITIVE_INFINITY;

  if (options.injectFailure === 'child') {
    try {
      await withTerminalGuard(guard, async () => {
        throw new Error('simulated child-process failure');
      }, 'child_process_failure');
    } catch {
      // expected — guard must restore before returning
    }
    return {
      ok: false,
      exitCode: 1,
      reason_code: TUI_SHELL_REASON.CHILD_FAILURE,
      ink_loaded: false,
      react_loaded: false,
      text: formatShellText(model),
      model,
      guard,
    };
  }

  const importRenderer = options.importRenderer
    ?? (() => import('./operator-tui-shell-render.mjs'));

  let inkLoaded = false;
  let reactLoaded = false;
  let nestedExecutions = 0;
  /** @type {number} */
  let lastExitCode = 0;
  /** @type {{ renderOperatorTuiShell: Function } | null} */
  let cachedRenderer = null;
  /** @type {Error | null} */
  let nestedExecuteError = null;
  let nestedSessionComplete = false;
  let nestedQuit = false;

  /**
   * Drain leftover stdin before an Ink mount. On safety-ceiling truncation,
   * restore the guard and return an abort payload with the ink/react load flags
   * as of drain time (pre-splash: both false; after splash: both true).
   * @returns {object | null} abort result, or null when the buffer is clean
   */
  function coldStartDrainTruncationAbort() {
    try {
      drainStdinColdStart(stdin);
      return null;
    } catch (err) {
      if (err && err.code === 'COLD_START_STDIN_DRAIN_TRUNCATED') {
        if (guard && !guard.restored) guard.restore('cold_start_drain_truncated');
        return {
          ok: false,
          exitCode: 1,
          reason_code: TUI_SHELL_REASON.COLD_START_DRAIN_TRUNCATED,
          ink_loaded: inkLoaded,
          react_loaded: reactLoaded,
          text: String(err.message || err),
          model: null,
          guard,
        };
      }
      throw err;
    }
  }

  // Drain leftover stdin BEFORE any Ink mount (brand splash or shell). Residual
  // Enter/`1` from a prior session must not auto-dismiss the splash or skip landing.
  const preMountAbort = coldStartDrainTruncationAbort();
  if (preMountAbort) return preMountAbort;

  // First-paint splash gate: mount bounded minimal model before discovery.
  if (wantsSplash) {
    try {
      if (!cachedRenderer) {
        cachedRenderer = await importRenderer();
      }
      const splashRenderer = cachedRenderer;
      inkLoaded = true;
      reactLoaded = true;

      if (options.injectFailure === 'renderer') {
        await withTerminalGuard(guard, async () => {
          throw new Error('simulated renderer exception');
        }, 'renderer_exception');
      }

      const splashResult = await withTerminalGuard(guard, async () => splashRenderer.renderOperatorTuiShell({
        model,
        stdin,
        stdout,
        stderr: options.stderr ?? process.stderr,
        showSplash: true,
        splashOnly: true,
        splashMs: options.splashMs,
      }), 'normal');

      if (splashResult?.aborted) {
        return {
          ok: true,
          exitCode: 0,
          reason_code: TUI_SHELL_REASON.ABORT,
          ink_loaded: inkLoaded,
          react_loaded: reactLoaded,
          text: formatShellText(model),
          model,
          guard,
        };
      }
    } catch (err) {
      if (!guard.restored) guard.restore('renderer_exception');
      return {
        ok: false,
        exitCode: 1,
        reason_code: TUI_SHELL_REASON.RENDERER_EXCEPTION,
        ink_loaded: inkLoaded,
        react_loaded: reactLoaded,
        text: formatShellText(model),
        model,
        guard,
        error: String(err && err.message ? err.message : err),
      };
    }

    discoverShellBootstrap();
    guard = createTerminalGuard({ stdin, stdout });
  } else {
    discoverShellBootstrap();
  }

  // Import the renderer BEFORE the post-discovery drain: the dynamic import may
  // take long enough for the operator to buffer keys (real Ink repro: `1` typed
  // during discovery/import reaches the shell mount and skips landing home
  // straight into the launcher workflow). On the splash route the renderer is
  // already cached from the splash gate, so this is a no-op there.
  if (!cachedRenderer) {
    try {
      cachedRenderer = await importRenderer();
      inkLoaded = true;
      reactLoaded = true;
    } catch (err) {
      // Same contract as the splash-route import failure: restore the guard and
      // surface a result payload — never let the rejection escape the entry.
      if (guard && !guard.restored) guard.restore('renderer_exception');
      return {
        ok: false,
        exitCode: 1,
        reason_code: TUI_SHELL_REASON.RENDERER_EXCEPTION,
        ink_loaded: inkLoaded,
        react_loaded: reactLoaded,
        text: formatShellText(model),
        model,
        guard,
        error: String(err && err.message ? err.message : err),
      };
    }
  }

  // Second drain: runs after the renderer import, immediately before the first
  // interactive shell mount — with and without splash — so keys buffered during
  // discovery or import cannot reach the mount.
  const preShellAbort = coldStartDrainTruncationAbort();
  if (preShellAbort) return preShellAbort;

  try {
    if (options.injectFailure === 'renderer' && !wantsSplash) {
      await withTerminalGuard(guard, async () => {
        throw new Error('simulated renderer exception');
      }, 'renderer_exception');
    }

    if (!cachedRenderer) {
      cachedRenderer = await importRenderer();
    }
    const renderer = cachedRenderer;
    inkLoaded = true;
    reactLoaded = true;

    const entrySnapshot = () => ({
      aboutInfo,
      credentials,
      pathActivation,
      runsPayload,
      statusResult,
      evidenceModel,
      configModel,
      launcherModel,
      actionResult,
      lifecycleSource,
      monitorSource,
      selectedRunId,
      contentSurface,
      columns: typeof stdout.columns === 'number' ? stdout.columns : model.columns,
      rows: typeof stdout.rows === 'number' ? stdout.rows : model.rows,
      colorEnabled: useColor && process.env.NO_COLOR == null,
    });

    const runNestedShellAction = async (nested) => {
      nestedExecutions += 1;
      const nestedActionId = nested?.actionId ?? '';
      const nestedBanner = nestedActionId === NATIVE_LAUNCHER_EXECUTE_ACTION
        ? 'ai-minions tui · launching (session still active)'
        : 'ai-minions tui · nested pane (session still active)';
      prepareNestedPaneIo({ stdin, stdout, banner: nestedBanner });

      let resumeInk = true;
      try {
        let actionOutcome;
        try {
          actionOutcome = await executeAction({
            actionId: nestedActionId,
            selectedRunId: nested.runId ?? selectedRunId,
            skipRunPrompt: nested.skipRunPrompt === true,
            cwd: options.cwd,
            useColor,
            stdin,
            stdout,
            modelPolicy: aboutInfo.model_policy,
            launcherSelections: nested.launcherSelections ?? undefined,
          });
        } catch (err) {
          nestedExecuteError = err instanceof Error ? err : new Error(String(err));
          if (!guard.restored) guard.restore('action_failure');
          resumeInk = false;
          return { error: String(nestedExecuteError.message) };
        }

        try {
          ({
            selectedRunId,
            actionResult,
            contentSurface,
            runsPayload,
            statusResult,
            lifecycleSource,
            monitorSource,
            evidenceModel,
            configModel,
            launcherModel,
            lastExitCode,
          } = mergeActionOutcomeIntoEntryState({
            selectedRunId,
            actionResult,
            contentSurface,
            runsPayload,
            statusResult,
            lifecycleSource,
            monitorSource,
            evidenceModel,
            configModel,
            launcherModel,
            lastExitCode,
          }, actionOutcome));
        } catch (err) {
          nestedExecuteError = err instanceof Error ? err : new Error(String(err));
          if (!guard.restored) guard.restore('action_failure');
          resumeInk = false;
          return { error: String(nestedExecuteError.message) };
        }

        if (actionOutcome.quit) {
          if (!guard.restored) guard.restore('quit');
          nestedQuit = true;
          resumeInk = false;
          return { quit: true, model };
        }

        if (nestedActionId === 'config') {
          aboutInfo = buildAbout({ cwd: options.cwd });
          credentials = assessCredentials({ modelPolicy: aboutInfo.model_policy });
          pathActivation = assessPath();
        }

        try {
          model = buildEntryModelAfterNestedExecute(entrySnapshot(), model, nestedActionId);
        } catch (err) {
          nestedExecuteError = err instanceof Error ? err : new Error(String(err));
          if (!guard.restored) guard.restore('action_failure');
          resumeInk = false;
          return { error: String(nestedExecuteError.message) };
        }

        if (actionOutcome.actionResult?.exit_code != null) {
          lastExitCode = actionOutcome.actionResult.exit_code;
        }

        if (
          nestedExecutions >= maxLoops
          && !Number.isFinite(options.autoQuitMs)
        ) {
          nestedSessionComplete = true;
          return { sessionComplete: true, model };
        }

        return { model };
      } finally {
        if (resumeInk && !guard.restored) {
          resumeInkSession({ stdin, stdout });
        }
      }
    };

    let requestedAction = null;
    let aborted = false;

    const renderResult = await withTerminalGuard(guard, async () => renderer.renderOperatorTuiShell({
      model,
      stdin,
      stdout,
      stderr: options.stderr ?? process.stderr,
      autoQuitMs: options.autoQuitMs,
      showSplash: false,
      onModelChange: (next) => {
        model = next;
        selectedRunId = next.selectedRunId;
      },
      onRequestAction: (actionId) => {
        requestedAction = actionId;
      },
      onNestedExecute: runNestedShellAction,
      onNestedExecuteFailure: (message) => {
        nestedExecuteError = new Error(String(message));
        if (!guard.restored) guard.restore('action_failure');
      },
    }), 'normal');

    aborted = Boolean(renderResult?.aborted);
    if (!requestedAction && renderResult?.requestedAction) {
      requestedAction = renderResult.requestedAction;
    }

    if (nestedExecuteError) {
      return {
        ok: false,
        exitCode: 1,
        reason_code: TUI_SHELL_REASON.ACTION_FAILURE,
        ink_loaded: inkLoaded,
        react_loaded: reactLoaded,
        text: formatShellText(model),
        model,
        guard,
        error: String(nestedExecuteError.message),
      };
    }

    if (nestedQuit) {
      return {
        ok: true,
        exitCode: 0,
        reason_code: TUI_SHELL_REASON.QUIT,
        ink_loaded: inkLoaded,
        react_loaded: reactLoaded,
        text: formatShellText(model),
        model,
        guard,
      };
    }

    if (aborted && !requestedAction) {
      if (!guard.restored) guard.restore('abort');
      return {
        ok: true,
        exitCode: 0,
        reason_code: TUI_SHELL_REASON.ABORT,
        ink_loaded: inkLoaded,
        react_loaded: reactLoaded,
        text: formatShellText(model),
        model,
        guard,
      };
    }

    if (isShellSessionEndAction(requestedAction)) {
      if (!guard.restored) guard.restore('quit');
      return {
        ok: true,
        exitCode: 0,
        reason_code: TUI_SHELL_REASON.QUIT,
        ink_loaded: inkLoaded,
        react_loaded: reactLoaded,
        text: formatShellText(model),
        model,
        guard,
      };
    }

    if (!requestedAction) {
      if (!guard.restored) guard.restore('normal');
      return {
        ok: nestedSessionComplete ? lastExitCode === 0 : true,
        exitCode: nestedSessionComplete ? lastExitCode : 0,
        reason_code: nestedSessionComplete && nestedExecutions >= maxLoops
          ? TUI_SHELL_REASON.MAX_LOOPS
          : TUI_SHELL_REASON.OK,
        ink_loaded: inkLoaded,
        react_loaded: reactLoaded,
        text: formatShellText(model),
        model,
        guard,
      };
    }

    if (!guard.restored) guard.restore('normal');
    return {
      ok: false,
      exitCode: 1,
      reason_code: TUI_SHELL_REASON.ACTION_FAILURE,
      ink_loaded: inkLoaded,
      react_loaded: reactLoaded,
      text: formatShellText(model),
      model,
      guard,
      error: `Unexpected leaked action dispatch: ${requestedAction}`,
    };
  } catch (err) {
    if (!guard.restored) guard.restore('renderer_exception');
    return {
      ok: false,
      exitCode: 1,
      reason_code: TUI_SHELL_REASON.RENDERER_EXCEPTION,
      ink_loaded: inkLoaded,
      react_loaded: reactLoaded,
      text: formatShellText(model),
      model,
      guard,
      error: String(err && err.message ? err.message : err),
    };
  }
}

module.exports = {
  TUI_SHELL_REASON,
  legacyShellRequested,
  buildFirstPaintShellModel,
  shouldShowProductionSplash,
  resolveColdStartShellSurface,
  runOperatorTuiShell,
};
