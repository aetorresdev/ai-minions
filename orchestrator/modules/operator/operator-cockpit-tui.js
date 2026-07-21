'use strict';

/**
 * Interactive operator cockpit MVP — persistent terminal loop over existing CLI contracts.
 * Not a fullscreen navigator; not production TUI / Web UI.
 */

const readline = require('readline');

const { ansi } = require('./terminal-style');
const { buildAboutInfo, formatVersionOneLine } = require('./operator-about');
const {
  assessProviderCredentials,
  assessPathActivation,
  formatCredentialStatusLines,
} = require('./operator-credential-readiness');
const { runOperatorRuns } = require('./operator-run-list');
const { runOperatorStatus } = require('./operator-trace-command');
const { runOperatorDoctor } = require('./operator-doctor-evidence');
const { runSmoke, runAttach } = require('./operator-guided-first-run');
const { runOperatorRunSelector } = require('./operator-run-selector-tui');
const { runOperatorEvidenceAttachPane } = require('./operator-evidence-attach-pane-tui');

const COCKPIT_SCHEMA = '1';

/** @type {ReadonlyArray<{ key: string, id: string, label: string }>} */
const COCKPIT_ACTIONS = Object.freeze([
  { key: '1', id: 'smoke', label: 'smoke / new run' },
  { key: '2', id: 'runs', label: 'runs' },
  { key: 's', id: 'select', label: 'select run / status pane' },
  { key: 'e', id: 'evidence', label: 'evidence / attach pane' },
  { key: '3', id: 'status', label: 'status (--run-id)' },
  { key: '4', id: 'attach', label: 'attach (--run-id)' },
  { key: '5', id: 'doctor', label: 'doctor / config readiness' },
  { key: 'q', id: 'quit', label: 'quit' },
]);

/**
 * Non-TTY guidance — equivalent product CLI verbs (no interactive loop).
 * @returns {string}
 */
function formatNonTtyGuidance() {
  return [
    'ai-minions tui: interactive cockpit requires a TTY.',
    'Use equivalent CLI verbs instead:',
    '  ai-minions smoke [--model-policy local_only]',
    '  ai-minions runs [--limit 20]',
    '  ai-minions status --run-id <task_id>',
    '  ai-minions attach --run-id <task_id>',
    '  ai-minions doctor [--model-policy local_only]',
    'Read-only evidence panels (non-interactive):',
    '  ai-minions tui --run-id <task_id>',
    '  ai-minions tui --latest',
    '  ai-minions tui --file <trace.jsonl>',
  ].join('\n');
}

/**
 * @param {{
 *   useColor?: boolean,
 *   aboutInfo?: ReturnType<typeof buildAboutInfo>,
 *   credentials?: ReturnType<typeof assessProviderCredentials>,
 *   pathActivation?: ReturnType<typeof assessPathActivation>,
 * }} [options]
 * @returns {string}
 */
function buildCockpitHomeText(options = {}) {
  const useColor = options.useColor === true;
  const aboutInfo = options.aboutInfo ?? buildAboutInfo();
  const credentials = options.credentials
    ?? assessProviderCredentials({ modelPolicy: aboutInfo.model_policy });
  const pathActivation = options.pathActivation ?? assessPathActivation();

  const title = ansi(useColor, '1', 'ai-minions cockpit');
  const section = (label) => ansi(useColor, '1;36', label);

  const lines = [
    '+----------------------------------------------------------------------+',
    `|  ${title} — interactive loop (MVP; not fullscreen / Web UI)          |`,
    '+----------------------------------------------------------------------+',
    '',
    section('== Product status =='),
    `  version:        ${formatVersionOneLine(aboutInfo)}`,
    `  git_commit:     ${aboutInfo.git_commit}`,
    `  model_policy:   ${aboutInfo.model_policy}`,
    `  path_status:    ${pathActivation.status}`,
    `  cli_on_path:    ${pathActivation.on_path}`,
    ...formatCredentialStatusLines(credentials),
    '',
    section('== Actions =='),
    ...COCKPIT_ACTIONS.map((a) => `  [${a.key}]  ${a.label}`),
    '',
    'Policy: actions call existing operator modules (smoke/runs/status/attach/doctor).',
    'Quit exits cleanly with no side effects. Evidence panels: tui --run-id|--latest|--file.',
    'Select (s): newest-first run list + status pane (basename-safe; invalid → RUN_TRACE_INVALID).',
    'Evidence (e): attach/bundle status for selected run; attach_available=false is disk-only semantics.',
    'Not claimed: production TUI · Web UI · durable resume · navigable fullscreen panes.',
  ];
  return lines.join('\n');
}

/**
 * @param {string} raw
 * @returns {{ id: string } | null}
 */
function resolveCockpitAction(raw) {
  const token = String(raw ?? '').trim().toLowerCase();
  if (!token) return null;
  for (const action of COCKPIT_ACTIONS) {
    if (token === action.key || token === action.id) {
      return { id: action.id };
    }
    if (action.id === 'smoke' && (token === 'new' || token === 'run' || token === 'new-run')) {
      return { id: 'smoke' };
    }
    if (action.id === 'doctor' && (token === 'config' || token === 'readiness')) {
      return { id: 'doctor' };
    }
    if (action.id === 'select' && (token === 'selector' || token === 'pick')) {
      return { id: 'select' };
    }
    if (action.id === 'evidence' && (token === 'ev' || token === 'attach-pane' || token === 'evidence-pane')) {
      return { id: 'evidence' };
    }
  }
  return null;
}

/**
 * @param {{
 *   isTTY?: boolean,
 *   useColor?: boolean,
 *   cwd?: string,
 *   stdin?: NodeJS.ReadableStream,
 *   stdout?: NodeJS.WritableStream,
 *   question?: (prompt: string) => Promise<string>,
 *   write?: (text: string) => void,
 *   buildHome?: typeof buildCockpitHomeText,
 *   runRuns?: typeof runOperatorRuns,
 *   runStatus?: typeof runOperatorStatus,
 *   runDoctor?: typeof runOperatorDoctor,
 *   runSmokeFn?: typeof runSmoke,
 *   runAttachFn?: typeof runAttach,
 *   runSelector?: typeof runOperatorRunSelector,
 *   runEvidencePane?: typeof runOperatorEvidenceAttachPane,
 *   buildAbout?: typeof buildAboutInfo,
 *   assessCredentials?: typeof assessProviderCredentials,
 *   assessPath?: typeof assessPathActivation,
 *   maxLoops?: number,
 * }} [options]
 */
async function runOperatorCockpit(options = {}) {
  const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!isTTY && !options.question) {
    return {
      ok: false,
      exitCode: 1,
      reason_code: 'COCKPIT_TTY_REQUIRED',
      text: formatNonTtyGuidance(),
      schema_version: COCKPIT_SCHEMA,
    };
  }

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

  const io = { question, write };
  const buildHome = options.buildHome ?? buildCockpitHomeText;
  const runRuns = options.runRuns ?? runOperatorRuns;
  const runStatus = options.runStatus ?? runOperatorStatus;
  const runDoctor = options.runDoctor ?? runOperatorDoctor;
  const runSmokeFn = options.runSmokeFn ?? runSmoke;
  const runAttachFn = options.runAttachFn ?? runAttach;
  const runSelector = options.runSelector ?? runOperatorRunSelector;
  const runEvidencePane = options.runEvidencePane ?? runOperatorEvidenceAttachPane;
  const buildAbout = options.buildAbout ?? buildAboutInfo;
  const assessCredentials = options.assessCredentials ?? assessProviderCredentials;
  const assessPath = options.assessPath ?? assessPathActivation;

  const maxLoops = Number.isInteger(options.maxLoops) && options.maxLoops > 0
    ? options.maxLoops
    : Number.POSITIVE_INFINITY;

  let loops = 0;
  /** @type {number} */
  let lastExitCode = 0;
  /** @type {string | null} */
  let selectedRunId = null;

  try {
    while (loops < maxLoops) {
      loops += 1;
      const aboutInfo = buildAbout({ cwd: options.cwd });
      const home = buildHome({
        useColor,
        aboutInfo,
        credentials: assessCredentials({ modelPolicy: aboutInfo.model_policy }),
        pathActivation: assessPath(),
      });
      write(`${home}\n`);
      if (selectedRunId) {
        write(`Selected run: ${selectedRunId}\n`);
      }

      const raw = await question('Select action [1-5, s, e, q]: ');
      const resolved = resolveCockpitAction(raw);
      if (!resolved) {
        write('Unknown action. Choose 1-5, s, e, or q.\n');
        continue;
      }

      if (resolved.id === 'quit') {
        write('Exiting cockpit (no side effects).\n');
        return {
          ok: true,
          exitCode: 0,
          reason_code: 'COCKPIT_QUIT',
          schema_version: COCKPIT_SCHEMA,
          text: 'quit',
        };
      }

      if (resolved.id === 'smoke') {
        write('\n— smoke / new run —\n');
        try {
          const result = await runSmokeFn({
            cwd: options.cwd,
            skipGates: true,
            maxIterations: 1,
            useColor,
          });
          if (result.preflightText) write(`${result.preflightText}\n`);
          if (result.routingText) write(`${result.routingText}\n`);
          write(`${result.smokeText || result.text || ''}\n`);
          if (result.reason_code) write(`reason_code: ${result.reason_code}\n`);
          if (result.next_safe_action) write(`next_safe_action: ${result.next_safe_action}\n`);
          lastExitCode = Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1);
        } catch (err) {
          write(`${err instanceof Error ? err.message : String(err)}\n`);
          lastExitCode = 1;
        }
        continue;
      }

      if (resolved.id === 'runs') {
        write('\n— runs —\n');
        const result = runRuns({ useColor, json: false });
        write(`${result.text}\n`);
        lastExitCode = Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1);
        continue;
      }

      if (resolved.id === 'select') {
        write('\n— select run / status pane —\n');
        const result = await runSelector({
          question,
          write,
          useColor,
          cwd: options.cwd,
        });
        if (result.selected_run_id) {
          selectedRunId = result.selected_run_id;
        }
        lastExitCode = Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1);
        continue;
      }

      if (resolved.id === 'evidence') {
        const promptLabel = selectedRunId
          ? `run-id [${selectedRunId}]: `
          : 'run-id: ';
        const typed = String(await io.question(promptLabel)).trim();
        const runId = typed || selectedRunId;
        if (!runId) {
          write('evidence/attach pane skipped: run-id required (or use select first).\n');
          continue;
        }
        selectedRunId = runId;
        write('\n— evidence / attach pane —\n');
        const result = await runEvidencePane({
          runId,
          question,
          write,
          useColor,
          cwd: options.cwd,
        });
        lastExitCode = Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1);
        continue;
      }

      if (resolved.id === 'status') {
        const promptLabel = selectedRunId
          ? `run-id [${selectedRunId}]: `
          : 'run-id: ';
        const typed = String(await io.question(promptLabel)).trim();
        const runId = typed || selectedRunId;
        if (!runId) {
          write('status skipped: run-id required (or use: ai-minions status --run-id <id>).\n');
          continue;
        }
        write(`\n— status ${runId} —\n`);
        const result = runStatus({ runId, useColor, json: false });
        write(`${result.text}\n`);
        if (result.reason_code) write(`reason_code: ${result.reason_code}\n`);
        lastExitCode = Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1);
        continue;
      }

      if (resolved.id === 'attach') {
        const promptLabel = selectedRunId
          ? `run-id [${selectedRunId}]: `
          : 'run-id: ';
        const typed = String(await io.question(promptLabel)).trim();
        const runId = typed || selectedRunId;
        if (!runId) {
          write('attach skipped: run-id required (or use: ai-minions attach --run-id <id>).\n');
          continue;
        }
        write(`\n— attach ${runId} —\n`);
        const result = await runAttachFn({
          runId,
          cwd: options.cwd,
          json: false,
          useColor,
        });
        write(`${result.text}\n`);
        if (result.reason_code) write(`reason_code: ${result.reason_code}\n`);
        lastExitCode = Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1);
        continue;
      }

      if (resolved.id === 'doctor') {
        write('\n— doctor / config readiness —\n');
        try {
          const result = await runDoctor({
            cwd: options.cwd,
            json: false,
            useColor,
          });
          write(`${result.text}\n`);
          lastExitCode = Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1);
        } catch (err) {
          write(`${err instanceof Error ? err.message : String(err)}\n`);
          lastExitCode = 1;
        }
      }
    }

    return {
      ok: lastExitCode === 0,
      exitCode: lastExitCode,
      reason_code: 'COCKPIT_MAX_LOOPS',
      schema_version: COCKPIT_SCHEMA,
      text: 'max_loops',
    };
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

module.exports = {
  COCKPIT_SCHEMA,
  COCKPIT_ACTIONS,
  formatNonTtyGuidance,
  buildCockpitHomeText,
  resolveCockpitAction,
  runOperatorCockpit,
};
