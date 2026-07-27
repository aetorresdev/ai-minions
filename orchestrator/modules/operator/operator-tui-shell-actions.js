'use strict';

/**
 * Action dispatch for the fullscreen TUI shell.
 * Calls existing operator modules; does not duplicate run-control / readiness logic.
 */

const readline = require('readline');

const { resolveCockpitAction } = require('./operator-cockpit-tui');
const { runOperatorRuns } = require('./operator-run-list');
const { runOperatorStatus } = require('./operator-trace-command');
const { runSmoke, runAttach } = require('./operator-guided-first-run');
const { runOperatorRunSelector } = require('./operator-run-selector-tui');
const { runOperatorEvidenceAttachPane } = require('./operator-evidence-attach-pane-tui');
const { runOperatorConfigReadinessPane } = require('./operator-config-readiness-pane-tui');
const { runOperatorGuidedLauncherPane } = require('./operator-guided-launcher-pane-tui');
const { adaptActionResult } = require('./operator-tui-adapters');
const { formatLiveMonitorLines, buildLiveMonitorFromStatusResult } = require('./operator-tui-live-monitor');
const { formatGuidedLauncherLines } = require('./operator-guided-launcher-model');

/**
 * @param {{
 *   actionId: string,
 *   selectedRunId?: string | null,
 *   cwd?: string,
 *   useColor?: boolean,
 *   stdin?: NodeJS.ReadableStream,
 *   stdout?: NodeJS.WritableStream,
 *   question?: (prompt: string) => Promise<string>,
 *   write?: (text: string) => void,
 *   runRuns?: typeof runOperatorRuns,
 *   runStatus?: typeof runOperatorStatus,
 *   runSmokeFn?: typeof runSmoke,
 *   runAttachFn?: typeof runAttach,
 *   runSelector?: typeof runOperatorRunSelector,
 *   runEvidencePane?: typeof runOperatorEvidenceAttachPane,
 *   runConfigPane?: typeof runOperatorConfigReadinessPane,
 *   runLauncherPane?: typeof runOperatorGuidedLauncherPane,
 *   modelPolicy?: string,
 * }} options
 */
async function executeShellAction(options) {
  const actionId = String(options.actionId);
  const useColor = options.useColor === true;
  const write = options.write
    ?? ((text) => {
      const stream = options.stdout ?? process.stdout;
      stream.write(String(text).endsWith('\n') ? String(text) : `${text}\n`);
    });

  let rl = null;
  const question = options.question ?? ((prompt) => new Promise((resolve) => {
    if (!rl) {
      rl = readline.createInterface({
        input: options.stdin ?? process.stdin,
        output: options.stdout ?? process.stdout,
        terminal: true,
      });
    }
    rl.question(prompt, (answer) => resolve(String(answer ?? '')));
  }));

  /** @type {string | null} */
  let selectedRunId = options.selectedRunId ?? null;
  /** @type {object | null} */
  let evidenceModel = null;
  /** @type {object | null} */
  let configModel = null;
  /** @type {object | null} */
  let statusResult = null;
  /** @type {object | null} */
  let runsPayload = null;
  /** @type {object | null} */
  let launcherModel = null;
  /** @type {string} */
  let contentSurface = 'action_result';

  try {
    if (actionId === 'quit') {
      return {
        quit: true,
        selectedRunId,
        actionResult: adaptActionResult({
          action_id: 'quit',
          ok: true,
          exitCode: 0,
          reason_code: 'TUI_SHELL_QUIT',
          text: 'quit',
        }),
        contentSurface: 'home',
        evidenceModel: null,
        configModel: null,
        statusResult: null,
        runsPayload: null,
        launcherModel: null,
      };
    }

    if (actionId === 'launcher' || actionId === 'smoke') {
      try {
        const result = await (options.runLauncherPane ?? runOperatorGuidedLauncherPane)({
          question,
          write,
          useColor,
          cwd: options.cwd,
          runSmokeFn: options.runSmokeFn ?? runSmoke,
        });
        launcherModel = result.model ?? null;
        contentSurface = launcherModel ? 'launcher' : 'action_result';
        write(`${result.text || ''}\n`);
        return {
          quit: false,
          selectedRunId,
          contentSurface,
          actionResult: adaptActionResult({
            action_id: 'launcher',
            ok: result.ok !== false,
            exitCode: result.exitCode,
            reason_code: result.reason_code ?? null,
            next_safe_action: result.next_safe_action ?? null,
            text: result.text || (launcherModel ? formatGuidedLauncherLines(launcherModel).join('\n') : ''),
          }),
          launcherModel,
          evidenceModel: null,
          configModel: null,
          statusResult: null,
          runsPayload: null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        write(`${message}\n`);
        return {
          quit: false,
          selectedRunId,
          contentSurface: 'action_result',
          actionResult: adaptActionResult({
            action_id: 'launcher',
            ok: false,
            exitCode: 1,
            reason_code: 'TUI_SHELL_ACTION_FAILURE',
            error: message,
          }),
          launcherModel: null,
          evidenceModel: null,
          configModel: null,
          statusResult: null,
          runsPayload: null,
        };
      }
    }

    if (actionId === 'runs') {
      const result = (options.runRuns ?? runOperatorRuns)({ useColor, json: true });
      runsPayload = result;
      write(`${result.text || ''}\n`);
      contentSurface = 'runs';
      return {
        quit: false,
        selectedRunId,
        contentSurface,
        actionResult: adaptActionResult({
          action_id: 'runs',
          ok: result.ok !== false,
          exitCode: result.exitCode,
          reason_code: result.result_code ?? result.reason_code ?? null,
          next_safe_action: result.next_safe_action ?? null,
          text: result.text || '',
        }),
        runsPayload,
        evidenceModel: null,
        configModel: null,
        statusResult: null,
      };
    }

    if (actionId === 'select') {
      const result = await (options.runSelector ?? runOperatorRunSelector)({
        question,
        write,
        useColor,
        cwd: options.cwd,
      });
      if (result.selected_run_id) selectedRunId = result.selected_run_id;
      // Operator returns status_pane (not model/pane_model) — map into status adapter input.
      statusResult = result.status_pane
        ?? result.model
        ?? result.pane_model
        ?? null;
      contentSurface = 'status';
      return {
        quit: false,
        selectedRunId,
        contentSurface,
        actionResult: adaptActionResult({
          action_id: 'select',
          ok: result.ok !== false,
          exitCode: result.exitCode,
          reason_code: result.reason_code ?? result.result_code ?? null,
          text: result.text || '',
        }),
        evidenceModel: null,
        configModel: null,
        statusResult,
        runsPayload: null,
        launcherModel: null,
      };
    }

    if (actionId === 'evidence') {
      const promptLabel = selectedRunId ? `run-id [${selectedRunId}]: ` : 'run-id: ';
      const typed = String(await question(promptLabel)).trim();
      const runId = typed || selectedRunId;
      if (!runId) {
        write('evidence/attach pane skipped: run-id required (or use select first).\n');
        return {
          quit: false,
          selectedRunId,
          contentSurface: 'action_result',
          actionResult: adaptActionResult({
            action_id: 'evidence',
            ok: false,
            exitCode: 1,
            reason_code: 'TUI_SHELL_RUN_ID_REQUIRED',
            text: 'run-id required',
          }),
          evidenceModel: null,
          configModel: null,
          statusResult: null,
          runsPayload: null,
        };
      }
      selectedRunId = runId;
      const result = await (options.runEvidencePane ?? runOperatorEvidenceAttachPane)({
        runId,
        question,
        write,
        useColor,
        cwd: options.cwd,
      });
      // Operator returns pane (not model/pane_model) — map into evidence adapter input.
      evidenceModel = result.pane
        ?? result.model
        ?? result.pane_model
        ?? null;
      contentSurface = 'evidence';
      return {
        quit: false,
        selectedRunId,
        contentSurface,
        actionResult: adaptActionResult({
          action_id: 'evidence',
          ok: result.ok !== false,
          exitCode: result.exitCode,
          reason_code: result.reason_code ?? result.result_code ?? null,
          text: result.text || '',
        }),
        evidenceModel,
        configModel: null,
        statusResult: null,
        runsPayload: null,
        launcherModel: null,
      };
    }

    if (actionId === 'status') {
      const promptLabel = selectedRunId ? `run-id [${selectedRunId}]: ` : 'run-id: ';
      const typed = String(await question(promptLabel)).trim();
      const runId = typed || selectedRunId;
      if (!runId) {
        write('status skipped: run-id required.\n');
        return {
          quit: false,
          selectedRunId,
          contentSurface: 'action_result',
          actionResult: adaptActionResult({
            action_id: 'status',
            ok: false,
            exitCode: 1,
            reason_code: 'TUI_SHELL_RUN_ID_REQUIRED',
            text: 'run-id required',
          }),
          evidenceModel: null,
          configModel: null,
          statusResult: null,
          runsPayload: null,
        };
      }
      selectedRunId = runId;
      const result = (options.runStatus ?? runOperatorStatus)({
        runId,
        useColor,
        json: true,
      });
      statusResult = result;
      write(`${result.text || ''}\n`);
      contentSurface = 'status';
      return {
        quit: false,
        selectedRunId,
        contentSurface,
        actionResult: adaptActionResult({
          action_id: 'status',
          ok: result.ok !== false,
          exitCode: result.exitCode,
          reason_code: result.reason_code ?? result.result_code ?? null,
          next_safe_action: result.next_safe_action ?? null,
          text: result.text || '',
        }),
        statusResult,
        monitorSource: result,
        evidenceModel: null,
        configModel: null,
        runsPayload: null,
      };
    }

    if (actionId === 'monitor') {
      const promptLabel = selectedRunId ? `run-id [${selectedRunId}]: ` : 'run-id: ';
      const typed = String(await question(promptLabel)).trim();
      const runId = typed || selectedRunId;
      if (!runId) {
        write('live monitor skipped: run-id required.\n');
        return {
          quit: false,
          selectedRunId,
          contentSurface: 'action_result',
          actionResult: adaptActionResult({
            action_id: 'monitor',
            ok: false,
            exitCode: 1,
            reason_code: 'TUI_SHELL_RUN_ID_REQUIRED',
            text: 'run-id required',
          }),
          evidenceModel: null,
          configModel: null,
          statusResult: null,
          monitorSource: null,
          runsPayload: null,
        };
      }
      selectedRunId = runId;
      const result = (options.runStatus ?? runOperatorStatus)({
        runId,
        useColor,
        json: true,
      });
      statusResult = result;
      const monitor = buildLiveMonitorFromStatusResult(result);
      const monitorText = formatLiveMonitorLines(monitor).join('\n');
      write(`${monitorText}\n`);
      contentSurface = 'monitor';
      return {
        quit: false,
        selectedRunId,
        contentSurface,
        actionResult: adaptActionResult({
          action_id: 'monitor',
          ok: result.ok !== false,
          exitCode: result.exitCode,
          reason_code: result.reason_code ?? result.result_code ?? null,
          next_safe_action: result.next_safe_action ?? null,
          text: monitorText,
        }),
        statusResult,
        monitorSource: result,
        evidenceModel: null,
        configModel: null,
        runsPayload: null,
        launcherModel: null,
      };
    }

    if (actionId === 'attach') {
      const promptLabel = selectedRunId ? `run-id [${selectedRunId}]: ` : 'run-id: ';
      const typed = String(await question(promptLabel)).trim();
      const runId = typed || selectedRunId;
      if (!runId) {
        write('attach skipped: run-id required.\n');
        return {
          quit: false,
          selectedRunId,
          contentSurface: 'action_result',
          actionResult: adaptActionResult({
            action_id: 'attach',
            ok: false,
            exitCode: 1,
            reason_code: 'TUI_SHELL_RUN_ID_REQUIRED',
            text: 'run-id required',
          }),
          evidenceModel: null,
          configModel: null,
          statusResult: null,
          runsPayload: null,
        };
      }
      selectedRunId = runId;
      const result = await (options.runAttachFn ?? runAttach)({
        runId,
        cwd: options.cwd,
        json: false,
        useColor,
      });
      write(`${result.text || ''}\n`);
      return {
        quit: false,
        selectedRunId,
        contentSurface: 'action_result',
        actionResult: adaptActionResult({
          action_id: 'attach',
          ok: result.ok !== false,
          exitCode: result.exitCode,
          reason_code: result.reason_code ?? null,
          next_safe_action: result.next_safe_action ?? null,
          text: result.text || '',
        }),
        evidenceModel: null,
        configModel: null,
        statusResult: null,
        runsPayload: null,
        launcherModel: null,
      };
    }

    if (actionId === 'config') {
      try {
        const result = await (options.runConfigPane ?? runOperatorConfigReadinessPane)({
          question,
          write,
          useColor,
          cwd: options.cwd,
          modelPolicy: options.modelPolicy,
        });
        // Operator returns nested pane — adaptConfigReadiness normalizes path/creds/remediations.
        configModel = result.pane
          ?? result.model
          ?? result.pane_model
          ?? null;
        contentSurface = 'config';
        return {
          quit: false,
          selectedRunId,
          contentSurface,
          actionResult: adaptActionResult({
            action_id: 'config',
            ok: result.ok !== false,
            exitCode: result.exitCode,
            reason_code: result.reason_code ?? null,
            next_safe_action: result.next_safe_action ?? null,
            text: result.text || '',
          }),
          configModel,
          evidenceModel: null,
          statusResult: null,
          runsPayload: null,
          launcherModel: null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        write(`${message}\n`);
        return {
          quit: false,
          selectedRunId,
          contentSurface: 'action_result',
          actionResult: adaptActionResult({
            action_id: 'config',
            ok: false,
            exitCode: 1,
            reason_code: 'TUI_SHELL_ACTION_FAILURE',
            error: message,
          }),
          evidenceModel: null,
          configModel: null,
          statusResult: null,
          runsPayload: null,
        };
      }
    }

    return {
      quit: false,
      selectedRunId,
      contentSurface: 'action_result',
      actionResult: adaptActionResult({
        action_id: actionId,
        ok: false,
        exitCode: 1,
        reason_code: 'TUI_SHELL_UNKNOWN_ACTION',
        text: `unknown action: ${actionId}`,
      }),
      evidenceModel: null,
      configModel: null,
      statusResult: null,
      runsPayload: null,
      launcherModel: null,
    };
  } finally {
    if (rl) rl.close();
  }
}

/**
 * Resolve nav / command token to cockpit action id.
 * @param {string} raw
 * @param {string | null} [selectedNavId]
 * @returns {string | null}
 */
function resolveShellActionToken(raw, selectedNavId = null) {
  const token = String(raw ?? '').trim();
  if (!token) {
    return selectedNavId ? String(selectedNavId) : null;
  }
  const resolved = resolveCockpitAction(token);
  return resolved ? resolved.id : null;
}

module.exports = {
  executeShellAction,
  resolveShellActionToken,
};
