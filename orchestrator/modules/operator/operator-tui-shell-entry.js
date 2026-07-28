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
const { buildShellModel, formatShellText, isShellSessionEndAction } = require('./operator-tui-shell-model');
const {
  executeShellAction,
  resolveShellActionToken,
  resolveSlashCommandPlan,
} = require('./operator-tui-shell-actions');
const {
  createTerminalGuard,
  withTerminalGuard,
  prepareNestedPaneIo,
  prepareInkRemount,
} = require('./operator-tui-terminal-guard');
const { adaptActionResult } = require('./operator-tui-adapters');
const { shouldSkipSplash } = require('./operator-tui-splash');

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
    productVersion: aboutInfo.version,
  });
}

/**
 * Whether the production splash gate should run (skipped for harness finite loops / auto-quit).
 * @param {{
 *   skipSplash?: boolean,
 *   autoQuitMs?: number,
 *   maxLoops?: number,
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
 *   maxLoops?: number,
 *   injectFailure?: 'renderer' | 'child' | null,
 *   preferLegacy?: boolean,
 *   buildAbout?: typeof buildAboutInfo,
 *   assessCredentials?: typeof assessProviderCredentials,
 *   assessPath?: typeof assessPathActivation,
 *   loadRuns?: typeof runOperatorRuns,
 *   executeAction?: typeof executeShellAction,
 *   importRenderer?: () => Promise<{ renderOperatorTuiShell: Function }>,
 *   runLegacyCockpit?: typeof runOperatorCockpit,
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

  let selectedRunId = null;
  let contentSurface = 'home';
  /** @type {object | null} */
  let statusResult = null;
  /** @type {object | null} */
  let evidenceModel = null;
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
  const wantsSplash = shouldShowProductionSplash(options);

  let model = buildFirstPaintShellModel({
    aboutInfo,
    columns,
    rows,
    colorEnabled,
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
      productVersion: aboutInfo.version,
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
  let loops = 0;
  /** @type {number} */
  let lastExitCode = 0;
  /** @type {{ renderOperatorTuiShell: Function } | null} */
  let cachedRenderer = null;

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

      if (Boolean(splashResult?.aborted)) {
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

  try {
    while (loops < maxLoops) {
      loops += 1;
      let requestedAction = null;
      let aborted = false;

      if (options.injectFailure === 'renderer' && loops === 1 && !wantsSplash) {
        await withTerminalGuard(guard, async () => {
          throw new Error('simulated renderer exception');
        }, 'renderer_exception');
      }

      // Cache Ink/React module after first load — dynamic import is cached by Node,
      // but skip re-awaiting the promise machinery every remount loop.
      if (!cachedRenderer) {
        cachedRenderer = await importRenderer();
      }
      const renderer = cachedRenderer;
      inkLoaded = true;
      reactLoaded = true;

      // Splash already handled (or skipped for harness). Shell remount never re-shows splash.
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
      }), 'normal');

      aborted = Boolean(renderResult?.aborted);
      if (!requestedAction && renderResult?.requestedAction) {
        requestedAction = renderResult.requestedAction;
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

      if (!requestedAction) {
        // Soft handoff from withTerminalGuard must become a full session-end restore.
        if (!guard.restored) guard.restore('normal');
        return {
          ok: true,
          exitCode: 0,
          reason_code: TUI_SHELL_REASON.OK,
          ink_loaded: inkLoaded,
          react_loaded: reactLoaded,
          text: formatShellText(model),
          model,
          guard,
        };
      }

      // Intentional session end — never treat pane hotkeys (1/2/s/…) as quit.
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

      const slashPlan = resolveSlashCommandPlan(requestedAction, { selectedRunId });
      if (slashPlan) {
        const { plan } = slashPlan;
        if (plan.disposition === 'help' || plan.disposition === 'message') {
          actionResult = adaptActionResult({
            action_id: slashPlan.parsed.name ? `/${slashPlan.parsed.name}` : '/',
            ok: plan.ok !== false,
            exitCode: plan.exitCode ?? 1,
            reason_code: plan.reason_code ?? null,
            next_safe_action: plan.next_safe_action ?? null,
            text: plan.text || '',
          });
          contentSurface = 'action_result';
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
            selectedNavId: model.selectedNavId,
            contentSurface,
            columns: model.columns,
            rows: model.rows,
            focus: 'input',
            colorEnabled: model.colorEnabled,
            productVersion: aboutInfo.version,
          });
          if (Number.isFinite(options.autoQuitMs) || loops >= maxLoops) {
            if (!guard.restored) guard.restore('normal');
            return {
              ok: actionResult.ok === true,
              exitCode: actionResult.exit_code ?? 1,
              reason_code: TUI_SHELL_REASON.OK,
              ink_loaded: inkLoaded,
              react_loaded: reactLoaded,
              text: formatShellText(model),
              model,
              guard,
            };
          }
          // Fresh guard for next Ink mount after slash help/message remount.
          guard = createTerminalGuard({ stdin, stdout });
          continue;
        }

        if (plan.disposition === 'dispatch' && plan.action_id) {
          // Soft handoff already done by withTerminalGuard — do not emit alt-screen exit.
          prepareNestedPaneIo({
            stdin,
            stdout,
            banner: 'ai-minions tui · nested pane (session still active)',
          });
          let actionOutcome;
          try {
            actionOutcome = await executeAction({
              actionId: plan.action_id,
              selectedRunId: plan.run_id ?? selectedRunId,
              skipRunPrompt: plan.skip_run_prompt === true,
              cwd: options.cwd,
              useColor,
              stdin,
              stdout,
              modelPolicy: aboutInfo.model_policy,
            });
          } catch (err) {
            if (!guard.restored) guard.restore('action_failure');
            return {
              ok: false,
              exitCode: 1,
              reason_code: TUI_SHELL_REASON.ACTION_FAILURE,
              ink_loaded: inkLoaded,
              react_loaded: reactLoaded,
              text: formatShellText(model),
              model,
              guard,
              error: String(err && err.message ? err.message : err),
            };
          }

          selectedRunId = actionOutcome.selectedRunId ?? selectedRunId;
          actionResult = actionOutcome.actionResult;
          contentSurface = actionOutcome.contentSurface ?? 'action_result';
          if (actionOutcome.runsPayload) runsPayload = actionOutcome.runsPayload;
          if (actionOutcome.statusResult) {
            statusResult = actionOutcome.statusResult;
            lifecycleSource = actionOutcome.statusResult.json
              ?? actionOutcome.statusResult;
            monitorSource = actionOutcome.statusResult;
          }
          if (actionOutcome.monitorSource) monitorSource = actionOutcome.monitorSource;
          if (actionOutcome.evidenceModel) evidenceModel = actionOutcome.evidenceModel;
          if (actionOutcome.configModel) configModel = actionOutcome.configModel;
          if (Object.prototype.hasOwnProperty.call(actionOutcome, 'launcherModel')) {
            launcherModel = actionOutcome.launcherModel;
          }
          lastExitCode = actionResult?.exit_code ?? lastExitCode;

          if (actionOutcome.quit) {
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

          prepareInkRemount({ stdin });
          guard = createTerminalGuard({ stdin, stdout });
          // Reuse readiness snapshot on remount — only config pane refreshes PATH/creds.
          if (plan.action_id === 'config') {
            aboutInfo = buildAbout({ cwd: options.cwd });
            credentials = assessCredentials({ modelPolicy: aboutInfo.model_policy });
            pathActivation = assessPath();
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
            selectedNavId: plan.action_id === 'quit' ? model.selectedNavId : plan.action_id,
            contentSurface,
            columns: typeof stdout.columns === 'number' ? stdout.columns : model.columns,
            rows: typeof stdout.rows === 'number' ? stdout.rows : model.rows,
            focus: 'input',
            colorEnabled: useColor && process.env.NO_COLOR == null,
            productVersion: aboutInfo.version,
          });

          if (Number.isFinite(options.autoQuitMs) || loops >= maxLoops) {
            if (!guard.restored) guard.restore('normal');
            return {
              ok: lastExitCode === 0,
              exitCode: lastExitCode,
              reason_code: TUI_SHELL_REASON.OK,
              ink_loaded: inkLoaded,
              react_loaded: reactLoaded,
              text: formatShellText(model),
              model,
              guard,
            };
          }
          continue;
        }
      }

      const actionId = resolveShellActionToken(requestedAction, model.selectedNavId);
      if (!actionId) {
        actionResult = {
          action_id: requestedAction,
          ok: false,
          exitCode: 1,
          reason_code: 'TUI_SHELL_UNKNOWN_ACTION',
          text: `Unknown action. Choose 1-5, s, e, m, or q.`,
        };
        contentSurface = 'action_result';
        model = buildShellModel({
          aboutInfo,
          credentials,
          pathActivation,
          runsPayload,
          statusResult,
          evidenceModel,
          configModel,
          actionResult,
          lifecycleSource,
          monitorSource,
          selectedRunId,
          selectedNavId: model.selectedNavId,
          contentSurface,
          columns: model.columns,
          rows: model.rows,
          focus: 'nav',
          colorEnabled: model.colorEnabled,
          productVersion: aboutInfo.version,
        });
        // Fresh guard for next Ink mount after unknown-action message remount.
        guard = createTerminalGuard({ stdin, stdout });
        continue;
      }

      // Soft handoff already done by withTerminalGuard — avoid alt-screen exit flash.
      prepareNestedPaneIo({
        stdin,
        stdout,
        banner: 'ai-minions tui · nested pane (session still active)',
      });

      let actionOutcome;
      try {
        actionOutcome = await executeAction({
          actionId,
          selectedRunId,
          cwd: options.cwd,
          useColor,
          stdin,
          stdout,
          modelPolicy: aboutInfo.model_policy,
        });
      } catch (err) {
        if (!guard.restored) guard.restore('action_failure');
        return {
          ok: false,
          exitCode: 1,
          reason_code: TUI_SHELL_REASON.ACTION_FAILURE,
          ink_loaded: inkLoaded,
          react_loaded: reactLoaded,
          text: formatShellText(model),
          model,
          guard,
          error: String(err && err.message ? err.message : err),
        };
      }

      selectedRunId = actionOutcome.selectedRunId ?? selectedRunId;
      actionResult = actionOutcome.actionResult;
      contentSurface = actionOutcome.contentSurface ?? 'action_result';
      if (actionOutcome.runsPayload) runsPayload = actionOutcome.runsPayload;
      if (actionOutcome.statusResult) {
        statusResult = actionOutcome.statusResult;
        lifecycleSource = actionOutcome.statusResult.json
          ?? actionOutcome.statusResult;
        monitorSource = actionOutcome.statusResult;
      }
      if (actionOutcome.monitorSource) monitorSource = actionOutcome.monitorSource;
      if (actionOutcome.evidenceModel) evidenceModel = actionOutcome.evidenceModel;
      if (actionOutcome.configModel) configModel = actionOutcome.configModel;
      if (Object.prototype.hasOwnProperty.call(actionOutcome, 'launcherModel')) {
        launcherModel = actionOutcome.launcherModel;
      }
      lastExitCode = actionResult?.exit_code ?? lastExitCode;

      if (actionOutcome.quit) {
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

      // Fresh guard for next Ink mount after nested action I/O.
      prepareInkRemount({ stdin });
      guard = createTerminalGuard({ stdin, stdout });

      // Reuse readiness snapshot on remount — config pane refreshes PATH/creds.
      if (actionId === 'config') {
        aboutInfo = buildAbout({ cwd: options.cwd });
        credentials = assessCredentials({ modelPolicy: aboutInfo.model_policy });
        pathActivation = assessPath();
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
        selectedNavId: actionId === 'quit' ? model.selectedNavId : actionId,
        contentSurface,
        columns: typeof stdout.columns === 'number' ? stdout.columns : model.columns,
        rows: typeof stdout.rows === 'number' ? stdout.rows : model.rows,
        focus: 'nav',
        colorEnabled: useColor && process.env.NO_COLOR == null,
        productVersion: aboutInfo.version,
      });

      // Single-loop / auto-quit test mode: stop after one interactive frame + action.
      if (Number.isFinite(options.autoQuitMs) || loops >= maxLoops) {
        if (!guard.restored) guard.restore('normal');
        return {
          ok: lastExitCode === 0,
          exitCode: lastExitCode,
          reason_code: TUI_SHELL_REASON.OK,
          ink_loaded: inkLoaded,
          react_loaded: reactLoaded,
          text: formatShellText(model),
          model,
          guard,
        };
      }
    }

    if (!guard.restored) guard.restore('normal');
    return {
      ok: lastExitCode === 0,
      exitCode: lastExitCode,
      reason_code: TUI_SHELL_REASON.MAX_LOOPS,
      ink_loaded: inkLoaded,
      react_loaded: reactLoaded,
      text: formatShellText(model),
      model,
      guard,
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
  runOperatorTuiShell,
};
