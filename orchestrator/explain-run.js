#!/usr/bin/env node
/**
 * Explain a run from its trace JSONL.
 *
 * Usage:
 *   node explain-run.js [--run-id <id>] [--file <path>] [--json]
 *   npm run explain-run -- --file /path/to/trace.jsonl
 *
 * Resolution order for run_id:
 *   1. --file <path>       — read that file directly
 *   2. --run-id <id>       — look up <id>.jsonl in traces dir
 *   3. (none)              — latest run by ts_ms; tie-break: highest sequence_id
 *
 * Env:
 *   ORCH_TRACES_DIR  (default: ~/.claude/metrics/traces)
 *
 * Limits: 50 MB or 10,000 lines. Excess: warning + truncate to last segment with session_end.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const { rollupStepsCostOutcome } = require("./token-trace-report");
const { sanitizeTraceRowsForRead } = require("./trace-redact");
const { buildRunOutcomeSummary, formatRunOutcomeSummaryLines } = require("./run-outcome-summary");

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_LINES = 10_000;

// ── JSONL parsing ────────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @returns {{ rows: object[], skipped: number }}
 */
function parseJsonl(text) {
  const lines = text.split("\n");
  const rows = [];
  let skipped = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      skipped++;
    }
  }
  return { rows, skipped };
}

// ── Limit enforcement ────────────────────────────────────────────────────────

/**
 * If text exceeds limits, truncate to the last segment ending with session_end.
 * Returns { text, truncated }.
 * @param {string} text
 * @returns {{ text: string, truncated: boolean }}
 */
function enforceLimits(text) {
  const byteLen = Buffer.byteLength(text, "utf8");
  const lineCount = text.split("\n").filter((l) => l.trim()).length;

  if (byteLen <= MAX_BYTES && lineCount <= MAX_LINES) {
    return { text, truncated: false };
  }

  // Truncate: keep only lines up to limit, then walk back to find last session_end
  const lines = text.split("\n");
  const cap = Math.min(MAX_LINES, lines.length);
  const limited = lines.slice(0, cap);

  // Find last line with session_end
  let lastEnd = -1;
  for (let i = limited.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(limited[i]);
      if (o && o.event === "session_end") { lastEnd = i; break; }
    } catch { /* skip */ }
  }

  const kept = lastEnd >= 0 ? limited.slice(0, lastEnd + 1) : limited;
  return { text: kept.join("\n"), truncated: true };
}

// ── Run resolution ───────────────────────────────────────────────────────────

/**
 * Find the JSONL file for the latest run in tracesDir.
 * Latest = highest ts_ms in any line; tie-break: highest sequence_id.
 * @param {string} tracesDir
 * @returns {string | null} absolute path or null
 */
function resolveLatestRunFile(tracesDir) {
  if (!fs.existsSync(tracesDir)) return null;

  const files = fs.readdirSync(tracesDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(tracesDir, f));

  if (!files.length) return null;

  let best = null;
  let bestTs = -Infinity;
  let bestSeq = -Infinity;

  for (const fp of files) {
    let text;
    try { text = fs.readFileSync(fp, "utf8"); } catch { continue; }
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const o = JSON.parse(line);
        const ts = typeof o.ts_ms === "number" ? o.ts_ms : -Infinity;
        const seq = typeof o.sequence_id === "number" ? o.sequence_id : -Infinity;
        if (ts > bestTs || (ts === bestTs && seq > bestSeq)) {
          bestTs = ts;
          bestSeq = seq;
          best = fp;
        }
      } catch { /* skip */ }
    }
  }

  return best;
}

// ── Derivations ──────────────────────────────────────────────────────────────

/**
 * All derivations are deterministic — no inference.
 * @param {object[]} rows  already sorted by ts_ms (ascending)
 * @returns {object} May include `run_state_snapshot` / `run_snapshot` from the last `session_end` that carries them.
 */
function deriveExplain(rows) {
  let goal       = undefined;
  let flow_mode  = undefined;
  let retries    = 0;
  let final_status = undefined;
  let cost_usd   = null;
  let hasCost    = false;
  let failure_type = undefined;
  /** @type {object | undefined} */
  let lastRunStateSnapshot = undefined;

  for (const r of rows) {
    const ev = r.event;

    // goal / flow_mode — first session_start only
    if (ev === "session_start" && goal === undefined) {
      if (typeof r.goal      === "string") goal      = r.goal;
      if (typeof r.flow_mode === "string") flow_mode = r.flow_mode;
    }

    // retries — iteration_done with outcome == "iterate"
    if (ev === "iteration_done" && r.outcome === "iterate") {
      retries++;
    }

    // final_status — last iteration_done or session_end
    if (ev === "iteration_done" || ev === "session_end") {
      if (r.outcome !== undefined) final_status = r.outcome;
    }

    // failure_type — field from trace; never inferred
    if (r.failure_type !== undefined && typeof r.failure_type === "string") {
      failure_type = r.failure_type;
    }

    // cost_usd — sum only when cost_usd present as number
    if (typeof r.cost_usd === "number" && Number.isFinite(r.cost_usd)) {
      cost_usd = (cost_usd ?? 0) + r.cost_usd;
      hasCost = true;
    }

    if (ev === "session_end" && r.run_state_snapshot != null && typeof r.run_state_snapshot === "object") {
      lastRunStateSnapshot = r.run_state_snapshot;
    }
  }

  if (lastRunStateSnapshot != null) {
    const run = lastRunStateSnapshot.run;
    if (run && typeof run === "object") {
      if (goal === undefined && typeof run.goal === "string") goal = run.goal;
      if (flow_mode === undefined && typeof run.flow_mode === "string") flow_mode = run.flow_mode;
    }
  }

  const result = { retries, final_status };

  if (goal      !== undefined) result.goal      = goal;
  if (flow_mode !== undefined) result.flow_mode = flow_mode;
  if (hasCost)                 result.cost_usd  = Math.round(cost_usd * 1e8) / 1e8;

  if (lastRunStateSnapshot != null) {
    result.run_state_snapshot = lastRunStateSnapshot;
    const run = lastRunStateSnapshot.run;
    const step = lastRunStateSnapshot.step;
    if (run && typeof run === "object") {
      result.run_snapshot = {
        task_id: run.task_id,
        iteration: run.iteration,
        flow_mode: run.flow_mode,
        goal: typeof run.goal === "string" ? run.goal : undefined,
        step:
          step && typeof step === "object"
            ? {
              step_id: step.step_id,
              agent_id: step.agent_id,
              status: step.status,
            }
            : null,
      };
    }
  }

  // failure_type: from trace field if present; UNKNOWN if session ended with non-done outcome and no field
  if (failure_type !== undefined) {
    result.failure_type = failure_type;
  } else if (final_status !== undefined && final_status !== "done") {
    result.failure_type = "UNKNOWN";
  }

  result.rollup_steps = rollupStepsCostOutcome(rows);

  const intentOrder = [];
  const intentSeen = new Set();
  for (const r of rows) {
    if (typeof r.intent_id === "string" && r.intent_id.length > 0 && !intentSeen.has(r.intent_id)) {
      intentSeen.add(r.intent_id);
      intentOrder.push(r.intent_id);
    }
  }
  if (intentOrder.length) result.intent_ids = intentOrder;

  /** @type {string | undefined} */
  let lastFailureAxis = undefined;
  const iterationDoneSummary = [];
  for (const r of rows) {
    if (r.event !== "iteration_done") continue;
    const entry = {
      iteration: typeof r.iteration === "number" ? r.iteration : undefined,
      outcome: typeof r.outcome === "string" ? r.outcome : undefined,
    };
    if (typeof r.failure_type === "string") entry.failure_type = r.failure_type;
    if (typeof r.failure_axis === "string") {
      entry.failure_axis = r.failure_axis;
      lastFailureAxis = r.failure_axis;
    }
    if (Array.isArray(r.intent_ids)) {
      entry.intent_ids = r.intent_ids.filter((x) => typeof x === "string");
    }
    iterationDoneSummary.push(entry);
  }
  if (iterationDoneSummary.length) result.iteration_done_summary = iterationDoneSummary;
  if (lastFailureAxis !== undefined) result.last_failure_axis = lastFailureAxis;

  return result;
}

/**
 * Merge deriveExplain + run_outcome_summary for CLI / JSON export (OBS consumption layer).
 * @param {object[]} sortedRows — sorted ascending by ts_ms; sanitized for read
 * @param {{ trace_file?: string | null, ollama_usd_estimate?: object | null }} [meta]
 * @returns {object}
 */
function composeExplainExport(sortedRows, meta = {}) {
  const explain = deriveExplain(sortedRows);
  const run_outcome_summary = buildRunOutcomeSummary(sortedRows, {
    trace_file: meta.trace_file != null ? meta.trace_file : null,
    ...(meta.ollama_usd_estimate != null ? { ollama_usd_estimate: meta.ollama_usd_estimate } : {}),
  });
  return { ...explain, run_outcome_summary };
}

// ── Output ───────────────────────────────────────────────────────────────────

function printHuman(runId, filePath, explain, skipped, truncated, sortedRows) {
  console.log(`run_id:       ${runId}`);
  console.log(`trace_file:   ${filePath}`);
  if (truncated) {
    console.log("WARNING: file exceeded limits (50 MB / 10000 lines) - truncated to last session_end segment");
  }
  console.log(`final_status: ${explain.final_status ?? "(no outcome recorded)"}`);
  if (explain.goal      !== undefined) console.log(`goal:         ${explain.goal}`);
  if (explain.flow_mode !== undefined) console.log(`flow_mode:    ${explain.flow_mode}`);
  if (explain.run_snapshot) {
    const s = explain.run_snapshot;
    const stepStr = s.step
      ? `${s.step.step_id} / ${s.step.agent_id} / ${s.step.status}`
      : "(no active step)";
    console.log(`run_snapshot: task=${s.task_id} iteration=${s.iteration} step=${stepStr}`);
  }
  console.log(`retries:      ${explain.retries}`);
  if (explain.failure_type !== undefined) console.log(`failure_type: ${explain.failure_type}`);
  if (explain.last_failure_axis !== undefined) console.log(`last_failure_axis: ${explain.last_failure_axis}`);
  if (explain.intent_ids && explain.intent_ids.length) {
    const show = explain.intent_ids.slice(0, 4).join(", ");
    const more = explain.intent_ids.length > 4 ? ` (+${explain.intent_ids.length - 4} more)` : "";
    console.log(`intent_ids:   ${explain.intent_ids.length} unique - ${show}${more}`);
  }
  if (explain.rollup_steps && explain.rollup_steps.length) {
    const top = explain.rollup_steps[0];
    console.log(
      `top_step:     ${top.step_id} tokens=${top.ollama_total_tokens} failed=${top.step_failed}`,
    );
  }
  if (explain.cost_usd !== undefined)     console.log(`cost_usd:     ${explain.cost_usd}`);
  if (skipped > 0) {
    console.log(`\nWARNING: ${skipped} invalid JSON line(s) skipped`);
  }

  const ros = buildRunOutcomeSummary(sortedRows, { trace_file: filePath });
  const useColor = process.stdout.isTTY && process.env.NO_COLOR == null;
  console.log(formatRunOutcomeSummaryLines(ros, { useColor }).join("\n"));
}

function printJson(runId, filePath, sortedRows, skipped, truncated) {
  console.log(JSON.stringify({
    run_id: runId,
    trace_file: filePath,
    truncated,
    skipped_lines: skipped,
    ...composeExplainExport(sortedRows, { trace_file: filePath }),
  }, null, 2));
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function usage() {
  console.error(`Usage:
  node explain-run.js [--run-id <id>] [--file <path>] [--json]

Options:
  --file <path>   Read this JSONL file directly
  --run-id <id>   Look up <id>.jsonl in traces dir
  --json          Output structured JSON (includes run_outcome_summary + deriveExplain fields)
  (none)          Resolve latest run by ts_ms (tie-break: sequence_id)

Env: ORCH_TRACES_DIR (default: ~/.claude/metrics/traces)`);
}

function main() {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");
  const args = argv.filter((a) => a !== "--json");

  let filePath = null;
  let runId    = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file"   && args[i + 1]) { filePath = args[++i]; continue; }
    if (args[i] === "--run-id" && args[i + 1]) { runId    = args[++i]; continue; }
  }

  const tracesDir = process.env.ORCH_TRACES_DIR
    || path.join(os.homedir(), ".claude", "metrics", "traces");

  // Resolve file path
  if (!filePath && runId) {
    filePath = path.join(tracesDir, `${runId}.jsonl`);
  }
  if (!filePath) {
    filePath = resolveLatestRunFile(tracesDir);
    if (!filePath) {
      console.error("No trace file found. Use --file <path> or --run-id <id>.");
      usage();
      process.exit(1);
    }
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Trace file not found: ${filePath}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const { text, truncated } = enforceLimits(raw);
  const { rows, skipped }   = parseJsonl(text);

  // Sort by ts_ms ascending; fallback to insertion order (stable sort)
  const sorted = sanitizeTraceRowsForRead(rows.slice().sort((a, b) => {
    const ta = typeof a.ts_ms === "number" ? a.ts_ms : 0;
    const tb = typeof b.ts_ms === "number" ? b.ts_ms : 0;
    return ta - tb;
  }));

  const explain = deriveExplain(sorted);

  // Resolve display run_id
  const resolvedRunId = runId
    || (sorted.find((r) => r.run_id) && sorted.find((r) => r.run_id).run_id)
    || (sorted.find((r) => r.task_id) && sorted.find((r) => r.task_id).task_id)
    || path.basename(filePath, ".jsonl");

  if (jsonOut) {
    printJson(resolvedRunId, filePath, sorted, skipped, truncated);
  } else {
    printHuman(resolvedRunId, filePath, explain, skipped, truncated, sorted);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseJsonl,
  enforceLimits,
  deriveExplain,
  resolveLatestRunFile,
  composeExplainExport,
};
