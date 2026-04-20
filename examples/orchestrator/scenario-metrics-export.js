#!/usr/bin/env node
/**
 * C-T4 — Export per-run metrics from trace JSONL files that include `scenario_id`
 * (set via run({ traceScenarioId }) or ORCH_TRACE_SCENARIO_ID).
 *
 * Usage:
 *   node scenario-metrics-export.js [--dir ~/.claude/metrics/traces] [--since-m 180] [--include-untagged] [--out out.json]
 *
 * Default: only traces whose first session_start includes scenario_id (E2E-tagged runs).
 * Writes JSON to stdout if --out is omitted.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { parseJsonl, buildReport } = require("./token-trace-report");

/**
 * @param {string} tracesDir
 * @param {{ sinceMs?: number, includeUntagged?: boolean }} opts
 * @returns {object[]}
 */
function collectRunsFromDir(tracesDir, opts = {}) {
  const { sinceMs = null, includeUntagged = false } = opts;
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
    const { rows, errors } = parseJsonl(text);
    if (!rows.length) continue;

    const sessionStart = rows.find((r) => r.event === "session_start");
    const scenarioId = sessionStart && typeof sessionStart.scenario_id === "string"
      ? sessionStart.scenario_id : null;
    if (!scenarioId && !includeUntagged) continue;

    const taskId = (rows.find((r) => r.task_id) || {}).task_id || path.basename(name, ".jsonl");
    const report = buildReport(rows);
    const sessionEnd = report.session_end;

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
    });
  }

  runs.sort((a, b) => String(a.trace_file).localeCompare(String(b.trace_file)));
  return runs;
}

function usage() {
  console.error(`Usage: node scenario-metrics-export.js [--dir DIR] [--since-m MINUTES] [--include-untagged] [--out FILE.json]
Env: ORCH_TRACES_DIR — default trace directory (~/.claude/metrics/traces)`);
}

function main() {
  const argv = process.argv.slice(2);
  let tracesDir = process.env.ORCH_TRACES_DIR
    || path.join(os.homedir(), ".claude", "metrics", "traces");
  let sinceM = null;
  let includeUntagged = false;
  let outPath = null;

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
  const runs = collectRunsFromDir(tracesDir, { sinceMs, includeUntagged });

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
    runs,
    by_scenario: byScenario,
  };

  const json = JSON.stringify(payload, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json, "utf8");
    console.error(`Wrote ${runs.length} run(s) → ${outPath}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

module.exports = { collectRunsFromDir };

if (require.main === module) {
  main();
}
