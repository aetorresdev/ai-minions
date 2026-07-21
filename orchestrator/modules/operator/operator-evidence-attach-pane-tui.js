'use strict';

/**
 * Interactive evidence / attach pane for the operator cockpit.
 * Reuses loadOperatorTraceContext + runAttach contracts.
 * Clarifies attach_available=false as bundle-on-disk only; does not invent fullscreen UI.
 */

const path = require('path');

const { ansi, colorOutcome } = require('./terminal-style');
const { formatRunIdArg } = require('./operator-run-list');
const { loadOperatorTraceContext } = require('./operator-trace-command');
const { runAttach } = require('./operator-guided-first-run');
const {
  resolveEvidenceArtifactPaths,
  deriveRedactionStatus,
} = require('./operator-doctor-evidence');

const EVIDENCE_ATTACH_PANE_SCHEMA = '1';

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizePaneToken(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * @param {string} runId
 * @returns {string}
 */
function buildAttachCommand(runId) {
  return `ai-minions attach --run-id ${formatRunIdArg(runId)}`;
}

/**
 * Build pane model from a loaded context (valid or invalid).
 * @param {{
 *   run_id: string,
 *   ctx: ReturnType<typeof loadOperatorTraceContext>,
 *   artifact_paths?: { attach_bundle?: string | null, report_path?: string | null, attach_md?: string | null },
 *   privacy_notice_status?: string | null,
 * }} input
 * @returns {object}
 */
function buildEvidenceAttachPaneModel(input) {
  const runId = String(input.run_id);
  const ctx = input.ctx;
  const attachCommand = buildAttachCommand(runId);

  if (!ctx || !ctx.ok) {
    const resultCode = (ctx && ctx.result_code) || 'RUN_TRACE_INVALID';
    const reasonCode = (ctx && ctx.reason_code) || 'OPERATOR_TRACE_INVALID';
    const nextSafe = (ctx && ctx.next_safe_action)
      || 'Inspect the trace file or re-run with a valid completed trace JSONL.';
    const traceFile = (ctx && ctx.trace_file) || null;
    const basename = traceFile
      ? path.basename(String(traceFile), '.jsonl')
      : runId;
    return {
      run_id: runId,
      trace_basename: basename,
      trace_path: traceFile,
      result_code: resultCode,
      status: resultCode === 'RUN_TRACE_INVALID' ? 'invalid' : 'unknown',
      outcome: null,
      reason_code: reasonCode,
      next_safe_action: nextSafe,
      attach_available: false,
      attach_bundle_available: false,
      attach_action_available: false,
      attach_result_code: 'RUN_ATTACH_UNAVAILABLE',
      attach_note: null,
      attach_command: attachCommand,
      attach_command_copyable: false,
      output_paths: [],
      attach_bundle: null,
      report_path: null,
      attach_md: null,
      privacy_notice_status: 'unknown',
      evidence_paths: [],
    };
  }

  const rs = ctx.run_state;
  const summary = ctx.summary;
  const artifactPaths = input.artifact_paths
    || ctx.artifact_paths
    || {
      attach_bundle: null,
      report_path: null,
      attach_md: null,
    };
  const attachAction = rs?.attach_action_available === true;
  const attachAvailable = rs?.attach_available === true;
  const attachBundle = Boolean(artifactPaths.attach_bundle) || attachAvailable;

  /** @type {string | null} */
  let attachNote = null;
  if (attachAction && !attachBundle) {
    attachNote = 'attach_available=false means no bundle on disk yet; attach can still create useful evidence';
  }

  /** @type {string[]} */
  const outputPaths = [];
  if (artifactPaths.attach_bundle) outputPaths.push(String(artifactPaths.attach_bundle));
  if (artifactPaths.report_path) outputPaths.push(String(artifactPaths.report_path));
  if (artifactPaths.attach_md) outputPaths.push(String(artifactPaths.attach_md));
  for (const p of rs?.evidence_paths || []) {
    if (p && !outputPaths.includes(String(p))) outputPaths.push(String(p));
  }
  if (ctx.trace_file && !outputPaths.includes(String(ctx.trace_file))) {
    // Trace path listed separately as trace_path; keep output_paths for attach artifacts first.
  }

  return {
    run_id: runId,
    trace_basename: path.basename(String(ctx.trace_file), '.jsonl'),
    trace_path: ctx.trace_file,
    result_code: rs?.result_code ?? 'RUN_FOUND',
    status: ctx.status_label ?? 'unknown',
    outcome: summary?.outcome ?? null,
    reason_code: rs?.blocking_reason_code ?? null,
    next_safe_action: rs?.next_safe_action ?? summary?.next_safe_action ?? null,
    attach_available: rs?.attach_available ?? false,
    attach_bundle_available: rs?.attach_bundle_available ?? attachBundle,
    attach_action_available: attachAction,
    attach_result_code: rs?.attach_result_code ?? 'RUN_ATTACH_UNAVAILABLE',
    attach_note: attachNote,
    attach_command: attachCommand,
    attach_command_copyable: attachAction,
    output_paths: outputPaths,
    attach_bundle: artifactPaths.attach_bundle ?? null,
    report_path: artifactPaths.report_path ?? null,
    attach_md: artifactPaths.attach_md ?? null,
    privacy_notice_status: input.privacy_notice_status
      ?? rs?.privacy_notice_status
      ?? 'unknown',
    evidence_paths: Array.isArray(rs?.evidence_paths) ? rs.evidence_paths.map(String) : [],
  };
}

/**
 * @param {object} pane
 * @param {{ useColor?: boolean }} [options]
 * @returns {string}
 */
function formatEvidenceAttachPaneText(pane, options = {}) {
  const useColor = options.useColor === true;
  const section = (label) => ansi(useColor, '1;36', label);
  const title = ansi(useColor, '1', 'ai-minions tui — evidence / attach pane');

  const lines = [
    '+----------------------------------------------------------------------+',
    `|  ${title} (selected run; read-only inspect)     |`,
    '+----------------------------------------------------------------------+',
    '',
    section('== Evidence status =='),
    `  run_id:                  ${pane.run_id}`,
    `  trace_basename:          ${pane.trace_basename}`,
    `  trace_path:              ${pane.trace_path ?? '-'}`,
    `  result_code:             ${pane.result_code}`,
    `  status:                  ${colorOutcome(pane.status ?? 'unknown', useColor)}`,
    `  outcome:                 ${pane.outcome == null ? '-' : colorOutcome(String(pane.outcome), useColor)}`,
    `  reason_code:             ${pane.reason_code == null || pane.reason_code === '' ? '(none)' : pane.reason_code}`,
    `  next_safe_action:        ${ansi(useColor, '36', pane.next_safe_action ?? '-')}`,
    '',
    section('== Attach / bundle =='),
    `  attach_available:        ${pane.attach_available}`,
    `  attach_bundle_available: ${pane.attach_bundle_available}`,
    `  attach_action_available: ${pane.attach_action_available}`,
    `  attach_result_code:      ${pane.attach_result_code}`,
    `  privacy_notice_status:   ${pane.privacy_notice_status}`,
  ];

  if (pane.attach_note) {
    lines.push(`  attach_note:             ${pane.attach_note}`);
  }

  lines.push(
    `  attach_command:          ${ansi(useColor, '36', pane.attach_command)}`,
    `  attach_bundle:           ${pane.attach_bundle ?? '(not on disk)'}`,
    `  report_path:             ${pane.report_path ?? '(not collected)'}`,
    `  attach_md:               ${pane.attach_md ?? '(not generated)'}`,
  );

  if (pane.output_paths && pane.output_paths.length) {
    lines.push('', section('== Copyable output paths =='));
    for (const p of pane.output_paths) {
      lines.push(`  ${p}`);
    }
  } else {
    lines.push(
      '',
      section('== Copyable output paths =='),
      '  (none yet — run attach to create a bundle; paths appear here after attach)',
    );
  }

  lines.push(
    '',
    'Commands: [a] run attach  [c] show copyable command/paths  [r] refresh  [b] back',
    'Policy: attach_available=false is bundle-on-disk only — attach can still collect evidence when action is available.',
    'Not claimed: fullscreen navigator · production TUI · Web UI.',
  );
  return lines.join('\n');
}

/**
 * @param {string} raw
 * @returns {{ action: 'attach' | 'copy' | 'refresh' | 'back' | 'unknown' }}
 */
function resolveEvidenceAttachPaneInput(raw) {
  const token = normalizePaneToken(raw);
  if (token === 'b' || token === 'back' || token === 'q' || token === 'quit' || token === 'cancel') {
    return { action: 'back' };
  }
  if (token === 'a' || token === 'attach' || token === 'run-attach') {
    return { action: 'attach' };
  }
  if (token === 'c' || token === 'copy' || token === 'cmd' || token === 'command') {
    return { action: 'copy' };
  }
  if (token === 'r' || token === 'refresh' || token === 'reload') {
    return { action: 'refresh' };
  }
  return { action: 'unknown' };
}

/**
 * @param {string} runId
 * @param {{
 *   tracesDir?: string,
 *   repoRoot?: string,
 *   filePath?: string,
 *   loadContext?: typeof loadOperatorTraceContext,
 *   resolveArtifacts?: typeof resolveEvidenceArtifactPaths,
 * }} [options]
 */
function loadEvidenceAttachPane(runId, options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const resolveArtifacts = options.resolveArtifacts ?? resolveEvidenceArtifactPaths;
  const id = String(runId);
  const ctx = loadContext({
    runId: id,
    filePath: options.filePath,
    tracesDir: options.tracesDir,
    repoRoot: options.repoRoot,
  });

  let artifactPaths = ctx.ok ? (ctx.artifact_paths || null) : null;
  let privacy = ctx.ok ? ctx.run_state?.privacy_notice_status : 'unknown';
  if (ctx.ok && options.repoRoot) {
    artifactPaths = resolveArtifacts(id, options.repoRoot);
    privacy = deriveRedactionStatus(artifactPaths.attach_bundle).status;
  } else if (ctx.ok && !artifactPaths) {
    // Prefer paths already attached by loadOperatorTraceContext.
    artifactPaths = ctx.artifact_paths || {
      attach_bundle: null,
      report_path: null,
      attach_md: null,
    };
  }

  const pane = buildEvidenceAttachPaneModel({
    run_id: id,
    ctx,
    artifact_paths: artifactPaths || undefined,
    privacy_notice_status: privacy,
  });

  return {
    ok: Boolean(ctx && ctx.ok),
    run_id: id,
    result_code: pane.result_code,
    reason_code: pane.reason_code,
    pane,
    ctx,
  };
}

/**
 * Format copyable attach command + output paths for clipboard-friendly display.
 * @param {object} pane
 * @returns {string}
 */
function formatCopyableAttachBlock(pane) {
  const lines = [
    '-- copyable --',
    `attach_command: ${pane.attach_command}`,
  ];
  if (pane.output_paths && pane.output_paths.length) {
    lines.push('output_paths:');
    for (const p of pane.output_paths) {
      lines.push(p);
    }
  } else {
    lines.push('output_paths: (none yet)');
  }
  return lines.join('\n');
}

/**
 * Merge attach report paths into a pane model (post-attach refresh helper).
 * @param {object} pane
 * @param {{ bundle_dir?: string | null, report?: object | null }} [attachResult]
 * @returns {object}
 */
function mergeAttachOutputPaths(pane, attachResult = {}) {
  const paths = [...(pane.output_paths || [])];
  const bundleDir = attachResult.bundle_dir
    || attachResult.report?.bundle_dir
    || null;
  if (bundleDir && !paths.includes(String(bundleDir))) {
    paths.unshift(String(bundleDir));
  }
  return {
    ...pane,
    attach_bundle: bundleDir || pane.attach_bundle,
    output_paths: paths,
    attach_available: Boolean(bundleDir) || pane.attach_available,
    attach_bundle_available: Boolean(bundleDir) || pane.attach_bundle_available,
  };
}

/**
 * Interactive evidence/attach pane loop for a selected run.
 * @param {{
 *   runId: string,
 *   question: (prompt: string) => Promise<string>,
 *   write: (text: string) => void,
 *   useColor?: boolean,
 *   cwd?: string,
 *   tracesDir?: string,
 *   repoRoot?: string,
 *   loadContext?: typeof loadOperatorTraceContext,
 *   runAttachFn?: typeof runAttach,
 *   maxLoops?: number,
 * }} options
 */
async function runOperatorEvidenceAttachPane(options) {
  const write = options.write;
  const question = options.question;
  const useColor = options.useColor === true;
  const runId = String(options.runId || '').trim();
  const runAttachFn = options.runAttachFn ?? runAttach;
  const maxLoops = Number.isInteger(options.maxLoops) && options.maxLoops > 0
    ? options.maxLoops
    : Number.POSITIVE_INFINITY;

  if (!runId) {
    write('evidence/attach pane skipped: run-id required (select a run first, or pass --run-id).\n');
    return {
      ok: false,
      exitCode: 1,
      reason_code: 'EVIDENCE_ATTACH_PANE_RUN_ID_MISSING',
      selected_run_id: null,
      schema_version: EVIDENCE_ATTACH_PANE_SCHEMA,
      text: 'missing_run_id',
    };
  }

  let loops = 0;
  let lastExitCode = 0;
  /** @type {object | null} */
  let lastPane = null;

  while (loops < maxLoops) {
    loops += 1;
    const loaded = loadEvidenceAttachPane(runId, {
      tracesDir: options.tracesDir,
      repoRoot: options.repoRoot,
      loadContext: options.loadContext,
    });
    lastPane = loaded.pane;
    const paneText = formatEvidenceAttachPaneText(loaded.pane, { useColor });
    write(`\n${paneText}\n`);

    const raw = await question('Evidence/attach [a|c|r|b]: ');
    const resolved = resolveEvidenceAttachPaneInput(raw);

    if (resolved.action === 'back') {
      return {
        ok: true,
        exitCode: lastExitCode,
        reason_code: 'EVIDENCE_ATTACH_PANE_BACK',
        selected_run_id: runId,
        pane: lastPane,
        schema_version: EVIDENCE_ATTACH_PANE_SCHEMA,
        text: paneText,
      };
    }

    if (resolved.action === 'refresh') {
      continue;
    }

    if (resolved.action === 'copy') {
      write(`\n${formatCopyableAttachBlock(loaded.pane)}\n`);
      continue;
    }

    if (resolved.action === 'attach') {
      if (!loaded.pane.attach_action_available) {
        write('attach skipped: attach action not available for this run state.\n');
        write(`${formatCopyableAttachBlock(loaded.pane)}\n`);
        lastExitCode = 1;
        continue;
      }
      write(`\n— attach ${runId} —\n`);
      write(`Running: ${loaded.pane.attach_command}\n`);
      try {
        const result = await runAttachFn({
          runId,
          cwd: options.cwd,
          json: false,
          useColor,
        });
        write(`${result.text || ''}\n`);
        if (result.reason_code) write(`reason_code: ${result.reason_code}\n`);
        lastExitCode = Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1);
        const merged = mergeAttachOutputPaths(loaded.pane, {
          bundle_dir: result.report?.bundle_dir ?? null,
          report: result.report,
        });
        lastPane = merged;
        write(`\n${formatCopyableAttachBlock(merged)}\n`);
      } catch (err) {
        write(`${err instanceof Error ? err.message : String(err)}\n`);
        lastExitCode = 1;
      }
      continue;
    }

    write('Unknown command. Use a (attach), c (copy), r (refresh), or b (back).\n');
  }

  return {
    ok: lastExitCode === 0,
    exitCode: lastExitCode,
    reason_code: 'EVIDENCE_ATTACH_PANE_MAX_LOOPS',
    selected_run_id: runId,
    pane: lastPane,
    schema_version: EVIDENCE_ATTACH_PANE_SCHEMA,
    text: 'max_loops',
  };
}

module.exports = {
  EVIDENCE_ATTACH_PANE_SCHEMA,
  buildAttachCommand,
  buildEvidenceAttachPaneModel,
  formatEvidenceAttachPaneText,
  formatCopyableAttachBlock,
  resolveEvidenceAttachPaneInput,
  loadEvidenceAttachPane,
  mergeAttachOutputPaths,
  runOperatorEvidenceAttachPane,
};
