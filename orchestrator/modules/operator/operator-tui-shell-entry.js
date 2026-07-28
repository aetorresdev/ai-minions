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
const { buildShellModel, formatShellText } = require('./operator-tui-shell-model');
const {
  executeShellAction,
  resolveShellActionToken,
  resolveSlashCommandPlan,
} = require('./operator-tui-shell-actions');
const {
  createTerminalGuard,
  withTerminalGuard,
  prepareNestedPaneIo,
} = require('./operator-tui-terminal-guard');
const { adaptActionResult } = require('./operator-tui-adapters');

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

  const aboutInfo = buildAbout({ cwd: options.cwd });
  const credentials = assessCredentials({ modelPolicy: aboutInfo.model_policy });
  const pathActivation = assessPath();
  const runsResult = loadRuns({
    tracesDir: options.tracesDir,
    limit: 20,
    json: true,
    useColor: false,
  });

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
  let runsPayload = runsResult;
  let model = buildShellModel({
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
    colorEnabled: useColor && process.env.NO_COLOR == null,
    productVersion: aboutInfo.version,
  });
  selectedRunId = model.selectedRunId;

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

  try {
    while (loops < maxLoops) {
      loops += 1;
      let requestedAction = null;
      let aborted = false;

      if (options.injectFailure === 'renderer' && loops === 1) {
        await withTerminalGuard(guard, async () => {
          throw new Error('simulated renderer exception');
        }, 'renderer_exception');
      }

      const renderer = await importRenderer();
      inkLoaded = true;
      reactLoaded = true;

      const renderResult = await withTerminalGuard(guard, async () => renderer.renderOperatorTuiShell({
        model,
        stdin,
        stdout,
        stderr: options.stderr ?? process.stderr,
        autoQuitMs: options.autoQuitMs,
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
          if (!guard.restored) guard.restore('action_dispatch');
          // Nested readline panes must not overprint the last Ink frame.
          prepareNestedPaneIo({ stdin, stdout });
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

          guard = createTerminalGuard({ stdin, stdout });
          model = buildShellModel({
            aboutInfo: buildAbout({ cwd: options.cwd }),
            credentials: assessCredentials({ modelPolicy: aboutInfo.model_policy }),
            pathActivation: assessPath(),
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

      // Restore terminal before nested readline panes / operator actions.
      if (!guard.restored) guard.restore('action_dispatch');
      // Nested readline panes must not overprint the last Ink frame.
      prepareNestedPaneIo({ stdin, stdout });

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
      guard = createTerminalGuard({ stdin, stdout });

      model = buildShellModel({
        aboutInfo: buildAbout({ cwd: options.cwd }),
        credentials: assessCredentials({ modelPolicy: aboutInfo.model_policy }),
        pathActivation: assessPath(),
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
  runOperatorTuiShell,
};
