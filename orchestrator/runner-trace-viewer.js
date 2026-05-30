'use strict';

/* global setInterval, clearInterval */

/**
 * Runner trace viewer — step graph + gate blocks from trace JSONL (read-only).
 * Complements control-plane-tui (outcome inspect) with operator step timeline.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { parseJsonl } = require('./token-trace-report');
const { sanitizeTraceRowsForRead } = require('./trace-redact');
const { buildRunOutcomeSummary } = require('./run-outcome-summary');

/**
 * @param {unknown} v
 * @returns {string}
 */
function na(v) {
  if (v == null) return '(not available)';
  const s = String(v);
  return s.length ? s : '(not available)';
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function sortRowsByTime(rows) {
  return rows.slice().sort((a, b) => {
    const ta = typeof a.ts_ms === 'number' ? a.ts_ms : 0;
    const tb = typeof b.ts_ms === 'number' ? b.ts_ms : 0;
    if (ta !== tb) return ta - tb;
    const sa = typeof a.sequence_id === 'number' ? a.sequence_id : 0;
    const sb = typeof b.sequence_id === 'number' ? b.sequence_id : 0;
    return sa - sb;
  });
}

/**
 * @param {object[]} rows
 * @returns {Array<{
 *   step_id: string,
 *   agent: string | null,
 *   iteration: number | null,
 *   step_index: number | null,
 *   status: string,
 *   task: string | null,
 *   reason: string | null,
 *   gate_id: string | null,
 *   critical: boolean | null,
 *   duration_ms: number | null,
 * }>}
 */
function buildStepGraph(rows) {
  /** @type {Map<string, ReturnType<typeof buildStepGraph>[number]>} */
  const steps = new Map();

  for (const r of sortRowsByTime(rows)) {
    if (!r || typeof r !== 'object') continue;
    const stepId = typeof r.step_id === 'string' ? r.step_id : null;
    if (!stepId) continue;

    if (r.event === 'agent_start') {
      steps.set(stepId, {
        step_id: stepId,
        agent: typeof r.agent === 'string' ? r.agent : null,
        iteration: typeof r.iteration === 'number' ? r.iteration : null,
        step_index: typeof r.step_index === 'number' ? r.step_index : null,
        status: 'running',
        task: typeof r.task === 'string' ? r.task.slice(0, 120) : null,
        reason: null,
        gate_id: null,
        critical: null,
        duration_ms: null,
      });
      continue;
    }

    const existing = steps.get(stepId) || {
      step_id: stepId,
      agent: null,
      iteration: null,
      step_index: null,
      status: 'unknown',
      task: null,
      reason: null,
      gate_id: null,
      critical: null,
      duration_ms: null,
    };

    if (r.event === 'agent_done') {
      steps.set(stepId, {
        ...existing,
        agent: typeof r.agent === 'string' ? r.agent : existing.agent,
        iteration: typeof r.iteration === 'number' ? r.iteration : existing.iteration,
        step_index: typeof r.step_index === 'number' ? r.step_index : existing.step_index,
        status: typeof r.edge_type === 'string' ? r.edge_type : 'done',
        duration_ms: typeof r.duration_ms === 'number' ? r.duration_ms : existing.duration_ms,
      });
      continue;
    }

    if (r.event === 'contract_fail') {
      steps.set(stepId, {
        ...existing,
        agent: typeof r.agent === 'string' ? r.agent : existing.agent,
        iteration: typeof r.iteration === 'number' ? r.iteration : existing.iteration,
        step_index: typeof r.step_index === 'number' ? r.step_index : existing.step_index,
        status: 'contract_fail',
        reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : null,
        gate_id: typeof r.gate_id === 'string' ? r.gate_id : null,
        critical: r.critical === true ? true : (r.critical === false ? false : existing.critical),
      });
    }
  }

  return [...steps.values()].sort((a, b) => {
    const ia = a.iteration ?? 0;
    const ib = b.iteration ?? 0;
    if (ia !== ib) return ia - ib;
    const sa = a.step_index ?? 0;
    const sb = b.step_index ?? 0;
    if (sa !== sb) return sa - sb;
    return String(a.step_id).localeCompare(String(b.step_id));
  });
}

/**
 * @param {object[]} rows
 * @returns {Array<{
 *   kind: string,
 *   agent: string | null,
 *   step_id: string | null,
 *   gate_id: string | null,
 *   reason: string,
 *   reviewer: string | null,
 * }>}
 */
function collectGateBlocks(rows) {
  /** @type {ReturnType<typeof collectGateBlocks>} */
  const blocks = [];

  for (const r of sortRowsByTime(rows)) {
    if (!r || typeof r !== 'object') continue;

    if (r.event === 'contract_fail' || r.event === 'decide_contract_fail') {
      blocks.push({
        kind: String(r.event),
        agent: typeof r.agent === 'string' ? r.agent : null,
        step_id: typeof r.step_id === 'string' ? r.step_id : null,
        gate_id: typeof r.gate_id === 'string' ? r.gate_id : null,
        reason: typeof r.reason === 'string' ? r.reason.slice(0, 240) : na(null),
        reviewer: null,
      });
      continue;
    }

    if (r.event === 'model_policy_block') {
      blocks.push({
        kind: 'model_policy_block',
        agent: typeof r.agentId === 'string' ? r.agentId : (typeof r.agent === 'string' ? r.agent : null),
        step_id: null,
        gate_id: typeof r.gate_id === 'string' ? r.gate_id : null,
        reason: typeof r.reason === 'string'
          ? r.reason
          : (typeof r.provider === 'string' ? `provider=${r.provider}` : na(null)),
        reviewer: null,
      });
      continue;
    }

    if (r.event === 'permission_check' && r.decision === 'deny') {
      blocks.push({
        kind: 'permission_denied',
        agent: typeof r.role === 'string' ? r.role : null,
        step_id: typeof r.step_id === 'string' ? r.step_id : null,
        gate_id: typeof r.gate_id === 'string' ? r.gate_id : null,
        reason: typeof r.reason_code === 'string' ? r.reason_code : na(null),
        reviewer: null,
      });
      continue;
    }

    if (r.event === 'review_record') {
      const verdict = typeof r.verdict === 'string' ? r.verdict : null;
      if (verdict !== 'block' && verdict !== 'request_changes') continue;
      const reviewer = typeof r.reviewer_role === 'string' ? r.reviewer_role : null;
      const list = Array.isArray(r.blockers) ? r.blockers : [];
      if (!list.length) {
        blocks.push({
          kind: 'review_record',
          agent: null,
          step_id: null,
          gate_id: null,
          reason: `verdict=${verdict} (no blocker text)`,
          reviewer,
        });
        continue;
      }
      for (const b of list.slice(0, 12)) {
        blocks.push({
          kind: 'review_blocker',
          agent: null,
          step_id: null,
          gate_id: null,
          reason: String(b).slice(0, 240),
          reviewer,
        });
      }
    }
  }

  return blocks;
}

/**
 * @param {ReturnType<typeof buildStepGraph>} steps
 * @returns {string}
 */
function formatStepGraphText(steps) {
  const lines = ['Step graph'];
  if (!steps.length) {
    lines.push('  (no agent steps recorded yet)');
    return lines.join('\n');
  }
  for (const s of steps) {
    const idx = s.step_index != null ? `#${s.step_index}` : '?';
    const iter = s.iteration != null ? `i${s.iteration}` : 'i?';
    const dur = s.duration_ms != null ? `${s.duration_ms}ms` : '-';
    lines.push(
      `  ${iter} ${idx} ${na(s.agent).padEnd(14)} ${s.status.padEnd(14)} ${s.step_id}`,
    );
    if (s.task) lines.push(`      task: ${s.task}`);
    if (s.reason) lines.push(`      reason: ${s.reason}`);
    if (s.gate_id) lines.push(`      gate_id: ${s.gate_id}`);
    if (s.critical === true) lines.push('      critical: true');
    if (s.duration_ms != null && s.status !== 'contract_fail') lines.push(`      duration: ${dur}`);
  }
  return lines.join('\n');
}

/**
 * @param {ReturnType<typeof collectGateBlocks>} blocks
 * @returns {string}
 */
function formatGateBlocksText(blocks) {
  const lines = ['Gate blocks'];
  if (!blocks.length) {
    lines.push('  (none recorded)');
    return lines.join('\n');
  }
  for (const b of blocks) {
    const who = b.reviewer ? `[${b.reviewer}]` : (b.agent ? `[${b.agent}]` : '[run]');
    lines.push(`  - ${b.kind} ${who} ${b.reason}`);
    if (b.gate_id) lines.push(`    gate_id: ${b.gate_id}`);
    if (b.step_id) lines.push(`    step_id: ${b.step_id}`);
  }
  return lines.join('\n');
}

/**
 * @param {object} row
 * @returns {string}
 */
function formatTraceFollowLine(row) {
  if (!row || typeof row !== 'object') return '+ (unparseable line)';
  const ev = typeof row.event === 'string' ? row.event : '?';
  const agent = typeof row.agent === 'string' ? row.agent : '';
  const step = typeof row.step_id === 'string' ? row.step_id : '';
  if (ev === 'agent_start') {
    return `+ agent_start ${agent} ${step} ${na(row.task).slice(0, 80)}`;
  }
  if (ev === 'agent_done') {
    return `+ agent_done ${agent} ${step} edge=${na(row.edge_type)}`;
  }
  if (ev === 'contract_fail') {
    return `+ contract_fail ${agent} ${na(row.reason).slice(0, 100)}`;
  }
  if (ev === 'session_end') {
    return `+ session_end done=${na(row.done)} summary=${na(row.summary).slice(0, 80)}`;
  }
  if (ev === 'iteration_done') {
    return `+ iteration_done outcome=${na(row.outcome)}`;
  }
  if (ev === 'permission_check' && row.decision === 'deny') {
    return `+ permission_denied ${na(row.reason_code)} domain=${na(row.domain)}`;
  }
  if (ev === 'review_record') {
    return `+ review_record ${na(row.reviewer_role)} verdict=${na(row.verdict)}`;
  }
  return `+ ${ev}${agent ? ` ${agent}` : ''}${step ? ` ${step}` : ''}`;
}

/**
 * @param {object[]} rows
 * @param {{ trace_file?: string, follow?: boolean }} [meta]
 * @returns {string}
 */
function formatTraceViewerText(rows, meta = {}) {
  const rws = sanitizeTraceRowsForRead(rows);
  const summary = buildRunOutcomeSummary(rws, { trace_file: meta.trace_file });
  const sessionEnd = rws.find((r) => r && r.event === 'session_end');
  const terminalStatus = sessionEnd && sessionEnd.done === true
    ? 'done'
    : sessionEnd && sessionEnd.done === false
      ? 'failed'
      : 'running';

  const lines = [
    'Runner trace view',
    `  task_id:          ${na(summary.where?.task_id)}`,
    `  terminal_status:  ${terminalStatus}`,
    `  trace_file:       ${na(meta.trace_file)}`,
    `  done:             ${na(summary.what?.done)}`,
    `  iterations:       ${na(summary.what?.iterations)}`,
    `  gate_blocks:      ${na(summary.why?.gate_blocks)}`,
  ];
  if (meta.follow) lines.push('  mode:             follow (Ctrl+C to stop)');
  lines.push('');
  lines.push(formatStepGraphText(buildStepGraph(rws)));
  lines.push('');
  lines.push(formatGateBlocksText(collectGateBlocks(rws)));
  lines.push('');
  lines.push('See also: npm run explain-run -- --run-id <id>  |  npm run control-plane:tui');
  return lines.join('\n');
}

/**
 * @param {{ runId?: string, filePath?: string, tracesDir?: string }} opts
 * @returns {string | null}
 */
function resolveTraceFilePath(opts = {}) {
  if (opts.filePath) return path.resolve(String(opts.filePath));
  const tracesDir = opts.tracesDir
    || process.env.ORCH_TRACES_DIR
    || path.join(os.homedir(), '.claude', 'metrics', 'traces');
  if (opts.runId) return path.join(tracesDir, `${String(opts.runId)}.jsonl`);
  return null;
}

/**
 * @param {string} filePath
 * @param {{ validateLines?: boolean }} [options]
 */
function loadTraceRowsFromFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      error: 'trace file not found',
      filePath,
      rows: [],
    };
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const { rows, errors } = parseJsonl(text, { validateLines: options.validateLines === true });
  return {
    ok: true,
    filePath,
    rows: sanitizeTraceRowsForRead(rows),
    parseErrors: errors,
  };
}

/**
 * @param {string} filePath
 * @param {{ pollMs?: number, maxWaitMs?: number, validateLines?: boolean }} [options]
 * @returns {Promise<{ rows: object[], sessionEnded: boolean, interrupted?: boolean }>}
 */
function followTraceFile(filePath, options = {}) {
  const pollMs = options.pollMs ?? 500;
  const maxWaitMs = options.maxWaitMs ?? 30 * 60 * 1000;
  const started = Date.now();

  /** @type {object[]} */
  let allRows = [];
  let byteOffset = 0;
  let printedSnapshot = false;

  return new Promise((resolve) => {
    /** @type {NodeJS.Timeout | null} */
    let interval = null;

    const cleanup = (result) => {
      if (interval) clearInterval(interval);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      resolve(result);
    };

    const onSignal = () => {
      cleanup({ rows: allRows, sessionEnded: false, interrupted: true });
    };

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    const tick = () => {
      if (Date.now() - started > maxWaitMs) {
        cleanup({ rows: allRows, sessionEnded: false, interrupted: true });
        return;
      }

      if (!fs.existsSync(filePath)) {
        if (!printedSnapshot) {
          process.stderr.write(`waiting for trace file: ${filePath}\n`);
        }
        return;
      }

      const stat = fs.statSync(filePath);
      if (stat.size < byteOffset) byteOffset = 0;

      if (stat.size === byteOffset) {
        if (allRows.some((r) => r && r.event === 'session_end')) {
          cleanup({ rows: allRows, sessionEnded: true });
        }
        return;
      }

      const fd = fs.openSync(filePath, 'r');
      const len = stat.size - byteOffset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, byteOffset);
      fs.closeSync(fd);
      byteOffset = stat.size;

      const chunk = buf.toString('utf8');
      /** @type {object[]} */
      const newRows = [];
      for (const raw of chunk.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        try {
          newRows.push(JSON.parse(line));
        } catch {
          // skip partial line until next poll
        }
      }

      if (!newRows.length) return;

      allRows = sanitizeTraceRowsForRead(allRows.concat(newRows));

      if (!printedSnapshot) {
        process.stdout.write(`${formatTraceViewerText(allRows, { trace_file: filePath, follow: true })}\n`);
        printedSnapshot = true;
      } else {
        for (const row of newRows) {
          process.stdout.write(`${formatTraceFollowLine(row)}\n`);
        }
      }

      if (allRows.some((r) => r && r.event === 'session_end')) {
        process.stdout.write('\n');
        process.stdout.write(`${formatTraceViewerText(allRows, { trace_file: filePath })}\n`);
        cleanup({ rows: allRows, sessionEnded: true });
      }
    };

    interval = setInterval(tick, pollMs);
    tick();
  });
}

/**
 * @param {{
 *   runId?: string,
 *   filePath?: string,
 *   tracesDir?: string,
 *   follow?: boolean,
 *   validateLines?: boolean,
 * }} options
 * @returns {Promise<{ ok: boolean, text?: string, rows?: object[], error?: string, filePath?: string | null }>}
 */
async function runTraceViewer(options = {}) {
  const filePath = resolveTraceFilePath(options);
  if (!filePath) {
    return { ok: false, error: 'trace requires --run-id or --file', filePath: null };
  }

  if (options.follow === true) {
    const result = await followTraceFile(filePath, options);
    return {
      ok: true,
      filePath,
      rows: result.rows,
      text: formatTraceViewerText(result.rows, { trace_file: filePath }),
      sessionEnded: result.sessionEnded,
      interrupted: result.interrupted,
    };
  }

  const loaded = loadTraceRowsFromFile(filePath, options);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error, filePath };
  }
  if (loaded.parseErrors?.length) {
    process.stderr.write(`parse warnings: ${loaded.parseErrors.length} line(s)\n`);
  }
  return {
    ok: true,
    filePath,
    rows: loaded.rows,
    text: formatTraceViewerText(loaded.rows, { trace_file: filePath }),
  };
}

module.exports = {
  na,
  sortRowsByTime,
  buildStepGraph,
  collectGateBlocks,
  formatStepGraphText,
  formatGateBlocksText,
  formatTraceViewerText,
  formatTraceFollowLine,
  resolveTraceFilePath,
  loadTraceRowsFromFile,
  followTraceFile,
  runTraceViewer,
};
