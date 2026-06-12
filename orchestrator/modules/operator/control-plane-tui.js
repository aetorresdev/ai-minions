#!/usr/bin/env node
/**
 * Read-only control plane view for a single run (trace JSONL).
 * Inspect-only: no agent execution, state mutation, approvals, or policy edits.
 *
 * Usage:
 *   node control-plane-tui.js --file <trace.jsonl>
 *   node control-plane-tui.js --run-id <task_id>
 *   node control-plane-tui.js --batch --dir ~/.claude/metrics/traces --since-m 120
 *
 * Consumes the same pipeline as explain-run and console-dashboard (run_outcome_summary).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const { parseJsonl, buildReport, rollupStepsCostOutcome } = require("../budget/token-trace-report");
const { sanitizeTraceRowsForRead } = require("../trace/trace-redact");
const { buildRunOutcomeSummary } = require("../trace/run-outcome-summary");
const { collectRunsFromDir } = require("./scenario-metrics-export");
const {
  resolveConsoleColorMode,
  shouldUseAnsiForStdout,
} = require("./console-dashboard");

/**
 * @param {unknown} v
 * @returns {string}
 */
function na(v) {
  if (v == null) return "(not available)";
  const s = String(v);
  return s.length ? s : "(not available)";
}

/**
 * @param {object[]} rows
 * @returns {{ step_id: string, agent: string | null } | null}
 */
function lastStepFromRows(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r && r.event === "agent_done" && typeof r.step_id === "string") {
      return { step_id: r.step_id, agent: typeof r.agent === "string" ? r.agent : null };
    }
  }
  const roll = rollupStepsCostOutcome(rows);
  if (!roll.length) return null;
  const last = roll[roll.length - 1];
  return { step_id: String(last.step_id), agent: last.agent != null ? String(last.agent) : null };
}

/**
 * @param {object[]} rows
 * @param {{ trace_file?: string | null, source?: string }} meta
 * @returns {string}
 */
function buildControlPlaneRunText(rows, meta = {}) {
  const rws = sanitizeTraceRowsForRead(rows);
  const traceFile = meta.trace_file != null ? meta.trace_file : (meta.source || null);
  const summary = buildRunOutcomeSummary(rws, { trace_file: traceFile });
  const report = buildReport(rws);
  const lastStep = lastStepFromRows(rws);

  const lines = [];
  lines.push("+----------------------------------------------------------------------+");
  lines.push("|  Control plane - read-only run inspect (stdout; no interactive TUI)   |");
  lines.push("+----------------------------------------------------------------------+");
  lines.push("Policy: inspect only - does not execute agents or mutate orchestrator state.");
  lines.push("");

  const w = summary.where;
  lines.push("-- Run --");
  lines.push(`  task_id:       ${na(w.task_id)}`);
  lines.push(`  scenario_id:   ${na(w.scenario_id)}`);
  lines.push(`  flow_mode:     ${na(w.flow_mode)}`);
  lines.push(`  trace_file:    ${na(traceFile)}`);
  lines.push("");

  const what = summary.what;
  lines.push("-- Status / outcome --");
  lines.push(`  done:              ${na(what.done)}`);
  lines.push(`  iterations:        ${na(what.iterations)}`);
  lines.push(`  last_outcome:      ${na(what.last_iteration_outcome)}`);
  lines.push(`  last_reason_code:  ${na(what.last_transition_reason?.reason_code)}`);
  lines.push("");

  lines.push("-- Step --");
  lines.push(`  last_step_id:  ${lastStep ? lastStep.step_id : na(null)}`);
  lines.push(`  last_agent:    ${lastStep ? na(lastStep.agent) : na(null)}`);
  lines.push("");

  lines.push("-- Blockers (review records) --");
  const rv = summary.review;
  if (rv && rv.records && rv.records.length) {
    lines.push(`  final_verdict: ${na(rv.final_verdict)}`);
    lines.push(`  cerberus:      ${na(rv.cerberus_verdict)}`);
    lines.push(`  qa:            ${na(rv.qa_verdict)}`);
    let anyBlocker = false;
    for (const rec of rv.records) {
      if (!rec.blockers || !rec.blockers.length) continue;
      if (rec.verdict !== "block" && rec.verdict !== "request_changes") continue;
      anyBlocker = true;
      for (const b of rec.blockers.slice(0, 8)) {
        lines.push(`  blocker:       [${rec.reviewer_role}] ${b}`);
      }
    }
    if (!anyBlocker) lines.push("  blockers:      (none open in review records)");
  } else {
    lines.push("  (not available)");
  }
  lines.push("");

  lines.push("-- Permission summary --");
  const ps = report.permission_summary_from_session_end || report.permission_summary_derived;
  if (ps && typeof ps === "object") {
    lines.push(`  permission_check_total: ${na(ps.permission_check_total)}`);
    const bd = ps.by_decision;
    if (bd && typeof bd === "object") {
      lines.push(`  by_decision: allow=${na(bd.allow)} deny=${na(bd.deny)} requires_approval=${na(bd.requires_approval)}`);
    }
  } else {
    lines.push("  (not available)");
  }
  lines.push("");

  lines.push("-- Cost / tokens --");
  const c = summary.cost;
  lines.push(`  ollama_total:  ${na(c.ollama_total_tokens)}`);
  lines.push(`  basis:         ${na(c.basis)}`);
  lines.push("");

  lines.push("-- Recovery --");
  const rec = summary.recovery;
  if (rec) {
    lines.push(`  clean:         ${na(rec.clean)}`);
    lines.push(`  findings:      ${na(rec.finding_count)}`);
    lines.push(`  summary:       ${na(rec.summary)}`);
  } else {
    lines.push("  (not available)");
  }
  lines.push("");

  lines.push("-- Resume --");
  const rs = summary.resume;
  if (rs) {
    lines.push(`  eligible:      ${na(rs.eligible)}`);
    lines.push(`  block_codes:   ${rs.block_codes && rs.block_codes.length ? rs.block_codes.join(", ") : "(none)"}`);
    lines.push(`  summary:       ${na(rs.summary)}`);
  } else {
    lines.push("  (not available)");
  }
  lines.push("");

  lines.push("-- Paths --");
  lines.push(`  trace:         ${na(traceFile)}`);
  lines.push("  reports:       use npm run explain-run / npm run tokens:report on same file");
  lines.push("");
  lines.push("See also: docs/orchestrator/control-plane-tui-contract.md");
  return lines.join("\n");
}

/**
 * @param {{ tracesDir: string, sinceMs?: number | null, includeUntagged?: boolean, validateTrace?: boolean }} opts
 * @returns {string}
 */
function buildControlPlaneBatchText(opts) {
  const runs = collectRunsFromDir(
    opts.tracesDir,
    { sinceMs: opts.sinceMs, includeUntagged: opts.includeUntagged, validateTrace: opts.validateTrace },
  );
  const lines = [];
  lines.push("+----------------------------------------------------------------------+");
  lines.push("|  Control plane - batch run list (read-only)                           |");
  lines.push("+----------------------------------------------------------------------+");
  lines.push(`dir: ${opts.tracesDir}  runs: ${runs.length}`);
  lines.push("");
  lines.push("task_id".padEnd(28) + "done".padEnd(8) + "scenario".padEnd(14) + "recovery  resume");
  lines.push("-".repeat(72));
  for (const r of runs.slice(0, 50)) {
    const ros = r.run_outcome_summary;
    const tid = String(r.task_id || "?").slice(0, 28).padEnd(28);
    const done = String(ros?.what?.done ?? "?").slice(0, 6).padEnd(8);
    const sc = String(r.scenario_id || "-").slice(0, 12).padEnd(14);
    const rc = ros?.recovery?.clean != null ? (ros.recovery.clean ? "clean" : "dirty") : "?";
    const re = ros?.resume?.eligible != null ? String(ros.resume.eligible) : "?";
    lines.push(`${tid}${done}${sc}${rc.padEnd(10)}${re}`);
  }
  if (runs.length > 50) lines.push(`... ${runs.length - 50} more`);
  lines.push("");
  return lines.join("\n");
}

function usage() {
  console.error(`Usage:
  node control-plane-tui.js --file <trace.jsonl>
  node control-plane-tui.js --run-id <task_id>
  node control-plane-tui.js --batch [--dir DIR] [--since-m MINUTES] [--include-untagged]

Env: ORCH_TRACES_DIR  ORCH_TRACE_VALIDATE=1`);
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(argv.length ? 0 : 1);
  }

  const strict = argv.includes("--strict-traces") || process.env.ORCH_TRACE_VALIDATE === "1";

  if (argv.includes("--batch")) {
    let tracesDir = process.env.ORCH_TRACES_DIR || path.join(os.homedir(), ".claude", "metrics", "traces");
    let sinceM = null;
    let includeUntagged = false;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--dir" && argv[i + 1]) tracesDir = argv[++i];
      else if (argv[i] === "--since-m" && argv[i + 1]) sinceM = parseFloat(argv[++i]);
      else if (argv[i] === "--include-untagged") includeUntagged = true;
    }
    const sinceMs = sinceM != null && !Number.isNaN(sinceM) ? sinceM * 60 * 1000 : null;
    process.stdout.write(buildControlPlaneBatchText({
      tracesDir,
      sinceMs,
      includeUntagged,
      validateTrace: strict,
    }) + "\n");
    return;
  }

  let filePath = null;
  let runId = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" && argv[i + 1]) filePath = argv[++i];
    if (argv[i] === "--run-id" && argv[i + 1]) runId = argv[++i];
  }

  const tracesDir = process.env.ORCH_TRACES_DIR
    || path.join(os.homedir(), ".claude", "metrics", "traces");
  if (!filePath && runId) filePath = path.join(tracesDir, `${runId}.jsonl`);
  if (!filePath) {
    usage();
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`Trace file not found: ${filePath}`);
    process.exit(2);
  }

  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(String((e && e.message) || e));
    process.exit(1);
  }

  const { rows, errors } = parseJsonl(text, { validateLines: strict });
  if (errors.length) {
    process.stderr.write(`parse warnings: ${errors.length} line(s)\n`);
  }
  process.stdout.write(buildControlPlaneRunText(rows, { trace_file: filePath }) + "\n");
}

module.exports = {
  buildControlPlaneRunText,
  buildControlPlaneBatchText,
  na,
  lastStepFromRows,
  main,
};

if (require.main === module) {
  main();
}
