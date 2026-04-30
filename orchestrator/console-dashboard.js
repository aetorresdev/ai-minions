#!/usr/bin/env node
/**
 * Console "dashboard": ASCII-only tables from trace JSONL (no TUI / no Grafana).
 * Aligns with strict-mode.md failure taxonomy + rollupStepsCostOutcome.
 *
 * Usage:
 *   node console-dashboard.js --file ~/.claude/metrics/traces/<task_id>.jsonl
 *   node console-dashboard.js --batch --dir ~/.claude/metrics/traces --since-m 120
 *   node console-dashboard.js --batch --include-untagged
 *
 * Env: ORCH_TRACES_DIR, ORCH_TRACE_VALIDATE=1 (same as token-trace-report)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  parseJsonl,
  buildReport,
  rollupStepsCostOutcome,
  summarizeFailureTaxonomyFromRows,
} = require("./token-trace-report");
const {
  aggregateFailureTaxonomyAcrossRuns,
  collectRunsFromDir,
} = require("./scenario-metrics-export");
const { sanitizeTraceRowsForRead } = require("./trace-redact");
const { buildRunOutcomeSummary, formatRunOutcomeSummaryLines } = require("./run-outcome-summary");

/** @param {Record<string, number>} obj */
function sortedEntries(obj) {
  return Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
}

/**
 * @param {string} label
 * @param {Record<string, number>} counts
 * @param {number} maxRows
 * @param {number} barWidth
 * @returns {string[]}
 */
function linesCountTable(label, counts, maxRows = 24, barWidth = 28) {
  const lines = [];
  lines.push(`-- ${label} --`);
  const ent = sortedEntries(counts);
  if (!ent.length) {
    lines.push("(no rows)");
    return lines;
  }
  const maxC = Math.max(...ent.map(([, n]) => n), 1);
  const wKey = Math.min(56, Math.max(12, ...ent.map(([k]) => k.length)));
  for (const [k, n] of ent.slice(0, maxRows)) {
    const barN = Math.round((n / maxC) * barWidth);
    const bar = "#".repeat(barN) + ".".repeat(Math.max(0, barWidth - barN));
    const key = k.length > wKey ? `${k.slice(0, wKey - 1)}...` : k.padEnd(wKey);
    lines.push(`${key}  ${String(n).padStart(5)}  ${bar}`);
  }
  if (ent.length > maxRows) lines.push(`... ${ent.length - maxRows} more`);
  return lines;
}

/**
 * @param {object[]} rows
 * @param {{ source?: string }} meta
 * @returns {string}
 */
function buildDashboardText(rows, meta = {}) {
  const rws = sanitizeTraceRowsForRead(rows);
  const lines = [];
  const src = meta.source || "(rows)";
  lines.push("+----------------------------------------------------------------------+");
  lines.push("|  Orchestrator console dashboard (trace JSONL - stdout tables only)     |");
  lines.push("+----------------------------------------------------------------------+");
  lines.push(`Source: ${src}`);
  lines.push("");

  const report = buildReport(rws);
  const outcomeSummary = buildRunOutcomeSummary(rws, { trace_file: meta.source || null });
  lines.push(...formatRunOutcomeSummaryLines(outcomeSummary));
  const ss = report.session_start;
  const se = report.session_end;
  if (ss) {
    lines.push(
      `Session: flow_mode=${ss.flow_mode ?? "?"}  max_iterations=${ss.max_iterations ?? "?"}`
        + (ss.scenario_id ? `  scenario_id=${ss.scenario_id}` : ""),
    );
  } else {
    lines.push("Session: (no session_start)");
  }
  if (se) {
    lines.push(`Outcome:  done=${se.done}  iterations=${se.iterations ?? "?"}  gate_blocks=${se.gate_blocks ?? "?"}`);
  } else {
    lines.push("Outcome:  (no session_end)");
  }
  lines.push("");

  const tax = summarizeFailureTaxonomyFromRows(rws);
  lines.push("Failure taxonomy (event=iteration_done) - drill: reason_code -> axis -> type");
  lines.push(`  iteration_done lines: ${tax.iteration_done_count}`);
  lines.push("");
  lines.push(...linesCountTable("by reason_code", tax.by_reason_code));
  lines.push("");
  lines.push(...linesCountTable("by failure_axis", tax.by_failure_axis));
  lines.push("");
  lines.push(...linesCountTable("by failure_type", tax.by_failure_type));
  lines.push("");
  lines.push(...linesCountTable("by outcome", tax.by_outcome));
  lines.push("");

  const roll = rollupStepsCostOutcome(rws);
  lines.push("-- Top steps by Ollama tokens (rollupStepsCostOutcome) --");
  if (!roll.length) {
    lines.push("(no step_id rows with context_stats)");
  } else {
    const top = roll.slice(0, 16);
    const h1 = "step_id".padEnd(44);
    const h2 = "agent".padEnd(14);
    lines.push(`${h1} ${h2}  prompt   compl   total  fail qa#`);
    lines.push("-".repeat(92));
    for (const s of top) {
      const sid = String(s.step_id);
      const sidDisp = sid.length > 44 ? `${sid.slice(0, 20)}...${sid.slice(-21)}` : sid.padEnd(44);
      const ag = String(s.agent ?? "-").slice(0, 14).padEnd(14);
      const pf = String(s.ollama_prompt_tokens).padStart(6);
      const cf = String(s.ollama_completion_tokens).padStart(6);
      const tf = String(s.ollama_total_tokens).padStart(7);
      const fl = s.step_failed ? "Y" : " ";
      let qa = " ";
      if (s.qa_triple_template === true) {
        qa = s.qa_blocker_non_vacuous === true ? "B" : s.qa_blocker_non_vacuous === false ? "v" : "?";
      }
      lines.push(`${sidDisp} ${ag}  ${pf}  ${cf}  ${tf}   ${fl}   ${qa}`);
    }
    lines.push("  fail=Y step_failed; qa# B=substantive blocker, v=vacuous triple, ?=triple no vacuity flag");
  }

  lines.push("");
  lines.push("Policy: charts use reason_code first, then failure_axis, then failure_type (strict-mode.md).");
  return lines.join("\n");
}

function usage() {
  console.error(`Usage:
  node console-dashboard.js --file <trace.jsonl>
  node console-dashboard.js --batch [--dir DIR] [--since-m MINUTES] [--include-untagged]

Env: ORCH_TRACES_DIR  ORCH_TRACE_VALIDATE=1`);
}

/**
 * @param {{ sinceMs?: number, includeUntagged?: boolean, validateTrace?: boolean }} opts
 * @returns {string}
 */
function buildBatchDashboardText(opts) {
  const runs = collectRunsFromDir(
    opts.tracesDir,
    { sinceMs: opts.sinceMs, includeUntagged: opts.includeUntagged, validateTrace: opts.validateTrace },
  );
  const lines = [];
  lines.push("+----------------------------------------------------------------------+");
  lines.push("|  Batch console dashboard (same runs as metrics:export-scenarios)    |");
  lines.push("+----------------------------------------------------------------------+");
  lines.push(`Runs: ${runs.length}  dir: ${opts.tracesDir}`);
  lines.push("");
  const agg = aggregateFailureTaxonomyAcrossRuns(runs);
  lines.push(`Aggregate iteration_done count: ${agg.iteration_done_count}`);
  lines.push("");
  lines.push(...linesCountTable("Aggregate by reason_code", agg.by_reason_code, 32));
  lines.push("");
  lines.push(...linesCountTable("Aggregate by failure_axis", agg.by_failure_axis, 32));
  lines.push("");
  lines.push(...linesCountTable("Aggregate by failure_type", agg.by_failure_type, 32));
  lines.push("");
  lines.push("-- Per run (compact) --");
  lines.push("task_id".padEnd(28) + "scenario".padEnd(16) + "iter_done  top_reason");
  lines.push("-".repeat(76));
  for (const r of runs.slice(0, 40)) {
    const tid = String(r.task_id || "?").slice(0, 28).padEnd(28);
    const sc = String(r.scenario_id || "-").slice(0, 14).padEnd(16);
    const n = r.failure_taxonomy?.iteration_done_count ?? 0;
    const br = r.failure_taxonomy?.by_reason_code || {};
    const top = sortedEntries(br)[0];
    const tr = top ? `${top[0]}(${top[1]})` : "-";
    lines.push(`${tid}${sc}${String(n).padStart(9)}  ${tr}`);
  }
  if (runs.length > 40) lines.push(`... ${runs.length - 40} more runs`);
  lines.push("");
  return lines.join("\n");
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
    const text = buildBatchDashboardText({
      tracesDir,
      sinceMs,
      includeUntagged,
      validateTrace: strict,
    });
    process.stdout.write(text + "\n");
    return;
  }

  let filePath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" && argv[i + 1]) filePath = argv[++i];
  }
  if (!filePath) {
    usage();
    process.exit(1);
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
    errors.slice(0, 8).forEach((e) => process.stderr.write(`  ${e}\n`));
  }

  process.stdout.write(buildDashboardText(rows, { source: filePath }) + "\n");
}

module.exports = {
  buildDashboardText,
  buildBatchDashboardText,
  linesCountTable,
  sortedEntries,
};

if (require.main === module) {
  main();
}
