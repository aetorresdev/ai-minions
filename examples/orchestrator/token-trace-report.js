#!/usr/bin/env node
/**
 * On-demand token / MCP summary from orchestrator trace JSONL (TOKENS-RPT-1 v1).
 *
 * Usage:
 *   node token-trace-report.js <task_id>
 *   node token-trace-report.js --file /path/to/custom.jsonl
 *   node token-trace-report.js <task_id> --json
 *
 * Default trace dir: ~/.claude/metrics/traces (override with ORCH_TRACES_DIR).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

/** @typedef {{ ts?: string, task_id?: string, event?: string, [k: string]: unknown }} TraceRow */

/**
 * @param {string} text - full JSONL
 * @param {{ validateLines?: boolean }} [options] — if true or env ORCH_TRACE_VALIDATE=1, validate each object against trace JSON Schema v2
 * @returns {{ rows: TraceRow[], errors: string[] }}
 */
function parseJsonl(text, options = {}) {
  const validateLines = options.validateLines === true || process.env.ORCH_TRACE_VALIDATE === "1";
  const { validateTraceLine } = validateLines ? require("./trace-schema") : { validateTraceLine: null };
  const rows = [];
  const errors = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (validateTraceLine) {
        const v = validateTraceLine(row);
        if (!v.ok) {
          errors.push(`line ${i + 1} schema: ${v.errors.join("; ")}`);
          continue;
        }
      }
      rows.push(row);
    } catch (e) {
      errors.push(`line ${i + 1}: ${(e && e.message) || String(e)}`);
    }
  }
  return { rows, errors };
}

/**
 * @param {TraceRow[]} rows
 * @returns {object}
 */
function buildReport(rows) {
  /** @type {TraceRow | null} */
  let sessionStart = null;
  /** @type {TraceRow | null} */
  let sessionEnd = null;
  const contextRows = [];
  let mcpCallCount = 0;

  for (const r of rows) {
    const ev = r.event;
    if (ev === "session_start") sessionStart = r;
    if (ev === "session_end") sessionEnd = r;
    if (ev === "context_stats") contextRows.push(r);
    if (ev === "mcp_call") mcpCallCount += 1;
  }

  /** @type {Record<string, { prompt: number, completion: number, n: number }>} */
  const byKey = {};
  let sumP = 0;
  let sumC = 0;

  for (const r of contextRows) {
    const agent = typeof r.agent === "string" ? r.agent : "?";
    const phase = typeof r.phase === "string" ? r.phase : "";
    const target = typeof r.target_agent === "string" ? r.target_agent : "";
    const key = [agent, phase || "-", target ? `→${target}` : ""].filter(Boolean).join(" | ");
    const p = typeof r.ollama_prompt_tokens === "number" && !Number.isNaN(r.ollama_prompt_tokens)
      ? r.ollama_prompt_tokens : 0;
    const c = typeof r.ollama_completion_tokens === "number" && !Number.isNaN(r.ollama_completion_tokens)
      ? r.ollama_completion_tokens : 0;
    if (p === 0 && c === 0) continue;
    if (!byKey[key]) byKey[key] = { prompt: 0, completion: 0, n: 0 };
    byKey[key].prompt += p;
    byKey[key].completion += c;
    byKey[key].n += 1;
    sumP += p;
    sumC += c;
  }

  const endP = sessionEnd && typeof sessionEnd.ollama_prompt_tokens_total === "number"
    ? sessionEnd.ollama_prompt_tokens_total : null;
  const endC = sessionEnd && typeof sessionEnd.ollama_completion_tokens_total === "number"
    ? sessionEnd.ollama_completion_tokens_total : null;

  return {
    session_start: sessionStart,
    session_end: sessionEnd,
    ollama_from_context_stats: { prompt: sumP, completion: sumC, rows: contextRows.length },
    ollama_session_end_totals:
      endP != null || endC != null ? { prompt: endP ?? 0, completion: endC ?? 0 } : null,
    by_agent_phase: byKey,
    mcp_events_count: mcpCallCount,
    mcp_from_session_end: sessionEnd
      ? {
        mcp_total_calls: sessionEnd.mcp_total_calls,
        mcp_failed_calls: sessionEnd.mcp_failed_calls,
        mcp_by_tool: sessionEnd.mcp_by_tool,
        mcp_by_transport: sessionEnd.mcp_by_transport,
      }
      : null,
  };
}

function printTextReport(taskId, tracePath, report, parseErrors) {
  console.log(`task_id:     ${taskId}`);
  console.log(`trace_file:  ${tracePath}`);
  if (parseErrors.length) {
    console.log(`parse_warnings: ${parseErrors.length} line(s) skipped`);
    parseErrors.slice(0, 5).forEach((e) => console.log(`  - ${e}`));
  }
  const ss = report.session_start;
  if (ss) {
    console.log(`session:     flow=${ss.flow_mode ?? "?"} max_iter=${ss.max_iterations ?? "?"}`);
    if (ss.scenario_id) console.log(`scenario_id: ${ss.scenario_id}`);
  } else {
    console.log("session:     (no session_start event)");
  }
  const se = report.session_end;
  if (se) {
    console.log(`outcome:     done=${se.done} iterations=${se.iterations} gate_blocks=${se.gate_blocks ?? "?"}`);
  } else {
    console.log("outcome:     (no session_end — trace incomplete?)");
  }

  console.log("\n── Ollama tokens (from context_stats rows with counts) ──");
  const { prompt, completion } = report.ollama_from_context_stats;
  console.log(`sum prompt:     ${prompt}`);
  console.log(`sum completion: ${completion}`);
  if (report.ollama_session_end_totals) {
    const t = report.ollama_session_end_totals;
    console.log("\n── Ollama tokens (session_end totals — orchestrator accounting) ──");
    console.log(`prompt_total:     ${t.prompt}`);
    console.log(`completion_total: ${t.completion}`);
    if (prompt !== t.prompt || completion !== t.completion) {
      console.log("(note: context_stats sum may differ from session_end if events omit token fields)");
    }
  } else {
    console.log("\n(no ollama_*_total on session_end — non-Ollama route or zero tokens)");
  }

  const keys = Object.keys(report.by_agent_phase).sort();
  if (keys.length) {
    console.log("\n── By agent | phase (Ollama only) ──");
    for (const k of keys) {
      const x = report.by_agent_phase[k];
      console.log(`  ${k}: prompt=${x.prompt} completion=${x.completion} (events=${x.n})`);
    }
  }

  console.log("\n── MCP ──");
  console.log(`mcp_call events in file: ${report.mcp_events_count}`);
  const m = report.mcp_from_session_end;
  if (m && typeof m.mcp_total_calls === "number") {
    console.log(`session_end mcp_total_calls: ${m.mcp_total_calls} failed: ${m.mcp_failed_calls ?? "?"}`);
    if (m.mcp_by_tool && typeof m.mcp_by_tool === "object") {
      const tools = Object.entries(m.mcp_by_tool).sort((a, b) => b[1] - a[1]);
      for (const [tname, n] of tools.slice(0, 20)) {
        console.log(`  ${tname}: ${n}`);
      }
      if (tools.length > 20) console.log(`  ... +${tools.length - 20} more`);
    }
  } else {
    console.log("(no MCP rollups on session_end)");
  }
}

function usage() {
  console.error(`Usage: node token-trace-report.js <task_id> [--json] [--strict-traces]
       node token-trace-report.js --file <path.jsonl> [--json] [--strict-traces]
Env: ORCH_TRACES_DIR (default: ~/.claude/metrics/traces)
     ORCH_TRACE_VALIDATE=1 — same as --strict-traces (JSON Schema v2 per line)`);
}

function main() {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");
  const strictTraces = argv.includes("--strict-traces");
  const args = argv.filter((a) => a !== "--json" && a !== "--strict-traces");
  let filePath = null;
  let taskId = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
      filePath = args[++i];
    } else if (!args[i].startsWith("-")) {
      taskId = args[i];
    }
  }

  const tracesDir = process.env.ORCH_TRACES_DIR
    || path.join(os.homedir(), ".claude", "metrics", "traces");

  if (!filePath && !taskId) {
    usage();
    process.exit(1);
  }

  const tracePath = filePath || path.join(tracesDir, `${taskId}.jsonl`);
  if (!fs.existsSync(tracePath)) {
    console.error(`Trace file not found: ${tracePath}`);
    process.exit(2);
  }

  const text = fs.readFileSync(tracePath, "utf8");
  const { rows, errors } = parseJsonl(text, { validateLines: strictTraces });
  const tid = taskId || (rows.find((r) => r.task_id) && rows.find((r) => r.task_id).task_id) || path.basename(tracePath, ".jsonl");
  const report = buildReport(rows);

  if (jsonOut) {
    console.log(JSON.stringify({
      task_id: tid,
      trace_file: tracePath,
      parse_errors: errors,
      report,
    }, null, 2));
  } else {
    printTextReport(tid, tracePath, report, errors);
  }
}

module.exports = { parseJsonl, buildReport, parseTraceLine: require("./trace-schema").parseTraceLine };

if (require.main === module) {
  main();
}
