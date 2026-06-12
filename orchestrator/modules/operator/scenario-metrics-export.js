#!/usr/bin/env node
/**
 * Export per-run metrics from trace JSONL files that include `scenario_id`
 * (set via run({ traceScenarioId }) or ORCH_TRACE_SCENARIO_ID).
 *
 * Usage:
 *   node scenario-metrics-export.js [--dir ~/.claude/metrics/traces] [--since-m 180] [--include-untagged] [--out out.json]
 *
 * Default: only traces whose first session_start includes scenario_id (tagged runs, e.g. tests).
 * Writes JSON to stdout if --out is omitted.
 *
 * Top-level **`consumption`** documents payload shape and reviewer fields (`buildExportPayloadMeta`).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  parseJsonl,
  buildReport,
  optionalOllamaUsdEstimate,
  rollupStepsCostOutcome,
  summarizeFailureTaxonomyFromRows,
} = require("../budget/token-trace-report");
const { sanitizeTraceRowsForRead } = require("../trace/trace-redact");
const { buildRunOutcomeSummary } = require("../trace/run-outcome-summary");

/**
 * Aggregate Ollama token totals from context_stats-derived `by_agent_phase` across runs.
 * Keys in each run's `by_agent_phase` are built in token-trace-report as `agent | phase | →target`.
 * @param {object[]} runs — entries from collectRunsFromDir (must include by_agent_phase)
 * @returns {{ by_role: Record<string, { ollama_prompt_tokens: number, ollama_completion_tokens: number, context_stats_events: number }>, by_phase: Record<string, { ollama_prompt_tokens: number, ollama_completion_tokens: number, context_stats_events: number }> }}
 */
function buildByStage(runs) {
  /** @type {Record<string, { ollama_prompt_tokens: number, ollama_completion_tokens: number, context_stats_events: number }>} */
  const byRole = {};
  /** @type {Record<string, { ollama_prompt_tokens: number, ollama_completion_tokens: number, context_stats_events: number }>} */
  const byPhase = {};

  function bump(rec, p, c, n) {
    rec.ollama_prompt_tokens += p;
    rec.ollama_completion_tokens += c;
    rec.context_stats_events += n;
  }

  for (const r of runs) {
    const map = r.by_agent_phase && typeof r.by_agent_phase === "object" ? r.by_agent_phase : {};
    for (const [key, v] of Object.entries(map)) {
      const parts = key.split(" | ").map((s) => s.trim());
      const agent = parts[0] && parts[0].length ? parts[0] : "(unknown)";
      const phaseRaw = parts[1];
      const phase = phaseRaw && phaseRaw !== "-" ? phaseRaw : "(no_phase)";
      const p = typeof v.prompt === "number" && !Number.isNaN(v.prompt) ? v.prompt : 0;
      const c = typeof v.completion === "number" && !Number.isNaN(v.completion) ? v.completion : 0;
      const n = typeof v.n === "number" && !Number.isNaN(v.n) ? v.n : 0;
      if (!byRole[agent]) {
        byRole[agent] = { ollama_prompt_tokens: 0, ollama_completion_tokens: 0, context_stats_events: 0 };
      }
      if (!byPhase[phase]) {
        byPhase[phase] = { ollama_prompt_tokens: 0, ollama_completion_tokens: 0, context_stats_events: 0 };
      }
      bump(byRole[agent], p, c, n);
      bump(byPhase[phase], p, c, n);
    }
  }

  return { by_role: byRole, by_phase: byPhase };
}

/**
 * @returns {{ usd_rates_configured: boolean, usd_note: string }}
 */
function buildUsdExportMeta() {
  const rawP = process.env.ORCH_USD_PER_MTOK_PROMPT;
  const rawC = process.env.ORCH_USD_PER_MTOK_COMPLETION;
  const configured = rawP != null && String(rawP).trim() !== "" && rawC != null && String(rawC).trim() !== "";
  return {
    usd_rates_configured: configured,
    usd_note: configured
      ? "Per-run ollama_usd_estimate uses env rates; values are estimates (no Ollama billing API)."
      : "Set ORCH_USD_PER_MTOK_PROMPT and ORCH_USD_PER_MTOK_COMPLETION for USD estimates on each run.",
  };
}

/** Keys on each `runs[]` element from collectRunsFromDir (optional keys omitted if absent). */
const RUN_EXPORT_ENTRY_KEYS = Object.freeze([
  "scenario_id",
  "task_id",
  "trace_file",
  "trace_mtime_iso",
  "parse_errors",
  "flow_mode",
  "max_iterations",
  "done",
  "iterations",
  "gate_blocks",
  "agents_run",
  "ollama_session_end_totals",
  "ollama_from_context_stats",
  "by_agent_phase",
  "mcp_from_session_end",
  "mcp_events_count",
  "rollup_steps",
  "failure_taxonomy",
  "run_outcome_summary",
  "ollama_usd_estimate",
]);

/**
 * Stable metadata for batch JSON consumers (OBS consumption layer).
 * @returns {{ payload_schema_version: string, documentation_path: string, runs_entry_keys: string[], reviewer_quick_path: string[] }}
 */
function buildExportPayloadMeta() {
  return {
    payload_schema_version: "1",
    documentation_path: "docs/orchestrator/run-outcome-consumption.md",
    runs_entry_keys: [...RUN_EXPORT_ENTRY_KEYS],
    reviewer_quick_path: [
      "runs[].run_outcome_summary.what.done",
      "runs[].run_outcome_summary.what.summary",
      "runs[].run_outcome_summary.why.gate_blocks",
      "runs[].run_outcome_summary.why.top_reason_codes",
      "runs[].run_outcome_summary.cost",
      "runs[].run_outcome_summary.qa",
      "runs[].run_outcome_summary.review.final_verdict",
      "runs[].run_outcome_summary.review.records",
      "runs[].run_outcome_summary.recovery.clean",
      "runs[].run_outcome_summary.recovery.finding_count",
      "runs[].run_outcome_summary.recovery.summary",
      "runs[].run_outcome_summary.intent_groups",
      "runs[].rollup_steps",
      "runs[].failure_taxonomy",
    ],
  };
}

/**
 * @param {Record<string, number>} into
 * @param {Record<string, number> | undefined} from
 */
function mergeCountMaps(into, from) {
  if (!from) return;
  for (const [k, v] of Object.entries(from)) {
    if (typeof v !== "number" || Number.isNaN(v)) continue;
    into[k] = (into[k] || 0) + v;
  }
}

/**
 * @param {{ failure_taxonomy?: ReturnType<typeof summarizeFailureTaxonomyFromRows> }[]} runs
 * @returns {ReturnType<typeof summarizeFailureTaxonomyFromRows>}
 */
function aggregateFailureTaxonomyAcrossRuns(runs) {
  const out = {
    iteration_done_count: 0,
    by_reason_code: /** @type {Record<string, number>} */ ({}),
    by_failure_axis: /** @type {Record<string, number>} */ ({}),
    by_failure_type: /** @type {Record<string, number>} */ ({}),
    by_outcome: /** @type {Record<string, number>} */ ({}),
    by_reason_axis_type: /** @type {Record<string, number>} */ ({}),
  };
  for (const r of runs) {
    const t = r.failure_taxonomy;
    if (!t) continue;
    out.iteration_done_count += t.iteration_done_count || 0;
    mergeCountMaps(out.by_reason_code, t.by_reason_code);
    mergeCountMaps(out.by_failure_axis, t.by_failure_axis);
    mergeCountMaps(out.by_failure_type, t.by_failure_type);
    mergeCountMaps(out.by_outcome, t.by_outcome);
    mergeCountMaps(out.by_reason_axis_type, t.by_reason_axis_type);
  }
  return out;
}

/**
 * @param {string} tracesDir
 * @param {{ sinceMs?: number, includeUntagged?: boolean, validateTrace?: boolean }} opts
 * @returns {object[]}
 */
function collectRunsFromDir(tracesDir, opts = {}) {
  const { sinceMs = null, includeUntagged = false, validateTrace = false } = opts;
  if (!fs.existsSync(tracesDir)) return [];

  const names = fs.readdirSync(tracesDir).filter((n) => n.endsWith(".jsonl"));
  const runs = [];

  for (const name of names) {
    const abs = path.join(tracesDir, name);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (sinceMs != null && Date.now() - st.mtimeMs > sinceMs) continue;

    let text;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const { rows, errors } = parseJsonl(text, { validateLines: validateTrace });
    if (!rows.length) continue;

    const safeRows = sanitizeTraceRowsForRead(rows);
    const sessionStart = safeRows.find((r) => r.event === "session_start");
    const scenarioId = sessionStart && typeof sessionStart.scenario_id === "string"
      ? sessionStart.scenario_id : null;
    if (!scenarioId && !includeUntagged) continue;

    const taskId = (safeRows.find((r) => r.task_id) || {}).task_id || path.basename(name, ".jsonl");
    const report = buildReport(safeRows);
    const sessionEnd = report.session_end;
    const ollamaUsdEstimate = optionalOllamaUsdEstimate(report);

    runs.push({
      scenario_id: scenarioId || null,
      task_id: taskId,
      trace_file: abs,
      trace_mtime_iso: st.mtime.toISOString(),
      parse_errors: errors,
      flow_mode: sessionStart?.flow_mode ?? null,
      max_iterations: sessionStart?.max_iterations ?? null,
      done: sessionEnd?.done ?? null,
      iterations: sessionEnd?.iterations ?? null,
      gate_blocks: sessionEnd?.gate_blocks ?? null,
      agents_run: sessionEnd?.agents_run ?? null,
      ollama_session_end_totals: report.ollama_session_end_totals,
      ollama_from_context_stats: report.ollama_from_context_stats,
      by_agent_phase: report.by_agent_phase,
      mcp_from_session_end: report.mcp_from_session_end,
      mcp_events_count: report.mcp_events_count,
      rollup_steps: rollupStepsCostOutcome(safeRows),
      failure_taxonomy: summarizeFailureTaxonomyFromRows(safeRows),
      run_outcome_summary: buildRunOutcomeSummary(safeRows, {
        trace_file: abs,
        ollama_usd_estimate: ollamaUsdEstimate || null,
      }),
      ...(ollamaUsdEstimate ? { ollama_usd_estimate: ollamaUsdEstimate } : {}),
    });
  }

  runs.sort((a, b) => String(a.trace_file).localeCompare(String(b.trace_file)));
  return runs;
}

/**
 * Aggregate tagged runs by `flow_mode` (single_agent vs multi_agent) for batch comparison.
 * @param {object[]} runs — entries from collectRunsFromDir
 * @returns {Record<string, { run_count: number, done_true: number, iterations_sum: number, avg_iterations: number | null, ollama_prompt_total: number, ollama_completion_total: number }>}
 */
function buildByFlowMode(runs) {
  /** @type {Record<string, ReturnType<typeof emptyBucket>>} */
  const out = {
    single_agent: emptyBucket(),
    multi_agent: emptyBucket(),
    unknown: emptyBucket(),
  };
  for (const r of runs) {
    const key = r.flow_mode === "multi_agent" ? "multi_agent"
      : r.flow_mode === "single_agent" ? "single_agent" : "unknown";
    const b = out[key];
    b.run_count += 1;
    if (r.done === true) b.done_true += 1;
    if (typeof r.iterations === "number" && !Number.isNaN(r.iterations)) b.iterations_sum += r.iterations;
    const t = r.ollama_session_end_totals;
    if (t && typeof t.prompt === "number") b.ollama_prompt_total += t.prompt;
    if (t && typeof t.completion === "number") b.ollama_completion_total += t.completion;
    if (!t && r.ollama_from_context_stats) {
      const cs = r.ollama_from_context_stats;
      if (typeof cs.prompt === "number") b.ollama_prompt_total += cs.prompt;
      if (typeof cs.completion === "number") b.ollama_completion_total += cs.completion;
    }
  }
  for (const k of Object.keys(out)) {
    const b = out[k];
    b.avg_iterations = b.run_count > 0 ? b.iterations_sum / b.run_count : null;
  }
  return out;
}

function emptyBucket() {
  return {
    run_count: 0,
    done_true: 0,
    iterations_sum: 0,
    avg_iterations: null,
    ollama_prompt_total: 0,
    ollama_completion_total: 0,
  };
}

function usage() {
  console.error(`Usage: node scenario-metrics-export.js [--dir DIR] [--since-m MINUTES] [--include-untagged] [--out FILE.json] [--strict-traces]
JSON includes top-level consumption (schema version, doc path, runs field list, reviewer paths).
Env: ORCH_TRACES_DIR — default trace directory (~/.claude/metrics/traces)
     ORCH_TRACE_VALIDATE=1 — validate each JSONL line against schema v2 (drops invalid lines; see parse_errors on runs)`);
}

function main() {
  const argv = process.argv.slice(2);
  let tracesDir = process.env.ORCH_TRACES_DIR
    || path.join(os.homedir(), ".claude", "metrics", "traces");
  let sinceM = null;
  let includeUntagged = false;
  let outPath = null;
  const strictTraces = argv.includes("--strict-traces") || process.env.ORCH_TRACE_VALIDATE === "1";

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1]) tracesDir = argv[++i];
    else if (argv[i] === "--since-m" && argv[i + 1]) sinceM = parseFloat(argv[++i]);
    else if (argv[i] === "--include-untagged") includeUntagged = true;
    else if (argv[i] === "--out" && argv[i + 1]) outPath = argv[++i];
    else if (argv[i] === "-h" || argv[i] === "--help") {
      usage();
      process.exit(0);
    }
  }

  const sinceMs = sinceM != null && !Number.isNaN(sinceM) ? sinceM * 60 * 1000 : null;
  const runs = collectRunsFromDir(tracesDir, { sinceMs, includeUntagged, validateTrace: strictTraces });

  const byScenario = {};
  for (const r of runs) {
    const key = r.scenario_id || "(untagged)";
    if (!byScenario[key]) byScenario[key] = [];
    byScenario[key].push(r);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    traces_dir: tracesDir,
    since_minutes: sinceM,
    include_untagged: includeUntagged,
    run_count: runs.length,
    consumption: buildExportPayloadMeta(),
    runs,
    by_scenario: byScenario,
    by_flow_mode: buildByFlowMode(runs),
    by_stage: buildByStage(runs),
    failure_taxonomy_aggregate: aggregateFailureTaxonomyAcrossRuns(runs),
    usd_export_meta: buildUsdExportMeta(),
  };

  const json = JSON.stringify(payload, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json, "utf8");
    console.error(`Wrote ${runs.length} run(s) → ${outPath}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

module.exports = {
  collectRunsFromDir,
  buildByFlowMode,
  buildByStage,
  buildUsdExportMeta,
  buildExportPayloadMeta,
  RUN_EXPORT_ENTRY_KEYS,
  rollupStepsCostOutcome,
  summarizeFailureTaxonomyFromRows,
  aggregateFailureTaxonomyAcrossRuns,
  buildRunOutcomeSummary,
  main,
};

if (require.main === module) {
  main();
}
