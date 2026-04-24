#!/usr/bin/env node
/**
 * On-demand token / MCP summary from orchestrator trace JSONL.
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

/**
 * Optional USD estimate for Ollama totals. Off unless both env vars are set.
 * Rates are **USD per 1_000_000 tokens** (million-token units).
 * @param {ReturnType<typeof buildReport>} report
 * @returns {object | null}
 */
function optionalOllamaUsdEstimate(report) {
  const pRate = parseEnvPositiveFloat("ORCH_USD_PER_MTOK_PROMPT");
  const cRate = parseEnvPositiveFloat("ORCH_USD_PER_MTOK_COMPLETION");
  if (pRate == null || cRate == null) return null;

  const se = report.session_end;
  let prompt = se && typeof se.ollama_prompt_tokens_total === "number" ? se.ollama_prompt_tokens_total : null;
  let completion = se && typeof se.ollama_completion_tokens_total === "number" ? se.ollama_completion_tokens_total : null;
  if (prompt == null) prompt = report.ollama_from_context_stats.prompt;
  if (completion == null) completion = report.ollama_from_context_stats.completion;
  if (typeof prompt !== "number" || typeof completion !== "number") return null;

  const usdP = (prompt / 1e6) * pRate;
  const usdC = (completion / 1e6) * cRate;
  return {
    basis: "prefer_session_end_ollama_totals_else_context_stats_sum",
    usd_prompt_estimate: roundUsd(usdP),
    usd_completion_estimate: roundUsd(usdC),
    usd_total_estimate: roundUsd(usdP + usdC),
    rates_per_million_tokens_usd: { prompt: pRate, completion: cRate },
    /** Ollama has no per-call billing API in this stack — USD is always derived from env rates × token counts. */
    usd_note: "estimated",
    usd_source: "env_rates_per_mtok",
  };
}

function parseEnvPositiveFloat(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function roundUsd(x) {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * Per-step Ollama token totals + failure signals for cost-vs-outcome views.
 * Joins `context_stats` / `agent_done` / `contract_fail` / `gate_result` by `step_id`.
 * QA steps: when `agent_done` includes `qa_triple_template`, rollup adds `qa_blocker_non_vacuous`
 * (substantive `blocker:` line) — orthogonal to `step_failed` (gates may still pass).
 * @param {TraceRow[]} rows
 * @returns {object[]}
 */
function rollupStepsCostOutcome(rows) {
  /** @type {Map<string, { step_id: string, intent_id: string | null, agent?: string, iteration?: number, ollama_prompt_tokens: number, ollama_completion_tokens: number, last_edge_type?: string, contract_fail: boolean, gate_fail: boolean, qa_triple_template: boolean, qa_blocker_non_vacuous: boolean }>} */
  const m = new Map();
  for (const r of rows) {
    const sid = typeof r.step_id === "string" && r.step_id.length ? r.step_id : null;
    if (!sid) continue;
    if (!m.has(sid)) {
      m.set(sid, {
        step_id: sid,
        intent_id: null,
        agent: undefined,
        iteration: undefined,
        ollama_prompt_tokens: 0,
        ollama_completion_tokens: 0,
        last_edge_type: undefined,
        contract_fail: false,
        gate_fail: false,
        qa_triple_template: false,
        qa_blocker_non_vacuous: false,
      });
    }
    const rec = m.get(sid);
    if (!rec) continue;
    const ev = r.event;
    if (ev === "context_stats") {
      if (typeof r.agent === "string") rec.agent = r.agent;
      if (typeof r.iteration === "number") rec.iteration = r.iteration;
      if (typeof r.intent_id === "string") rec.intent_id = r.intent_id;
      const p = typeof r.ollama_prompt_tokens === "number" && !Number.isNaN(r.ollama_prompt_tokens)
        ? r.ollama_prompt_tokens : 0;
      const c = typeof r.ollama_completion_tokens === "number" && !Number.isNaN(r.ollama_completion_tokens)
        ? r.ollama_completion_tokens : 0;
      rec.ollama_prompt_tokens += p;
      rec.ollama_completion_tokens += c;
    }
    if (ev === "agent_done" && typeof r.edge_type === "string") {
      rec.last_edge_type = r.edge_type;
      if (typeof r.intent_id === "string") rec.intent_id = r.intent_id;
    }
    if (ev === "agent_done" && r.agent === "qa" && r.qa_triple_template === true) {
      rec.qa_triple_template = true;
      if (r.qa_blocker_non_vacuous === true) rec.qa_blocker_non_vacuous = true;
    }
    if (ev === "contract_fail") rec.contract_fail = true;
    if (ev === "gate_result" && r.passed === false) rec.gate_fail = true;
  }

  const pRate = parseEnvPositiveFloat("ORCH_USD_PER_MTOK_PROMPT");
  const cRate = parseEnvPositiveFloat("ORCH_USD_PER_MTOK_COMPLETION");
  const ratesOk = pRate != null && cRate != null;

  const list = [...m.values()].map((rec) => {
    const tot = rec.ollama_prompt_tokens + rec.ollama_completion_tokens;
    const step_failed = rec.contract_fail || rec.gate_fail || rec.last_edge_type === "fail";
    /** @type {Record<string, unknown>} */
    const out = {
      step_id: rec.step_id,
      intent_id: rec.intent_id,
      agent: rec.agent ?? null,
      iteration: rec.iteration ?? null,
      ollama_prompt_tokens: rec.ollama_prompt_tokens,
      ollama_completion_tokens: rec.ollama_completion_tokens,
      ollama_total_tokens: tot,
      step_failed,
      contract_fail: rec.contract_fail,
      gate_fail: rec.gate_fail,
      last_edge_type: rec.last_edge_type ?? null,
    };
    if (rec.qa_triple_template) {
      out.qa_triple_template = true;
      out.qa_blocker_non_vacuous = rec.qa_blocker_non_vacuous;
    }
    if (ratesOk) {
      const usd = (rec.ollama_prompt_tokens / 1e6) * pRate + (rec.ollama_completion_tokens / 1e6) * cRate;
      out.usd_estimate = roundUsd(usd);
    }
    return out;
  });
  list.sort((a, b) => /** @type {number} */(b.ollama_total_tokens) - /** @type {number} */(a.ollama_total_tokens));
  return list;
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

  const usd = optionalOllamaUsdEstimate(report);
  if (usd) {
    console.log("\n── USD estimate (optional — set ORCH_USD_PER_MTOK_PROMPT + ORCH_USD_PER_MTOK_COMPLETION) ──");
    console.log(`rates USD/Mtok: prompt=${usd.rates_per_million_tokens_usd.prompt} completion=${usd.rates_per_million_tokens_usd.completion}`);
    console.log(`estimate: prompt=$${usd.usd_prompt_estimate} completion=$${usd.usd_completion_estimate} total=$${usd.usd_total_estimate}`);
    console.log(`basis: ${usd.basis}`);
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
     ORCH_TRACE_VALIDATE=1 — same as --strict-traces (JSON Schema v2 per line)
     ORCH_USD_PER_MTOK_PROMPT / ORCH_USD_PER_MTOK_COMPLETION — optional USD per 1e6 Ollama tokens (both required for estimate)`);
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
    const usd = optionalOllamaUsdEstimate(report);
    console.log(JSON.stringify({
      task_id: tid,
      trace_file: tracePath,
      parse_errors: errors,
      report,
      rollup_steps: rollupStepsCostOutcome(rows),
      ...(usd ? { ollama_usd_estimate: usd } : {}),
    }, null, 2));
  } else {
    printTextReport(tid, tracePath, report, errors);
  }
}

module.exports = {
  parseJsonl,
  buildReport,
  optionalOllamaUsdEstimate,
  rollupStepsCostOutcome,
  parseTraceLine: require("./trace-schema").parseTraceLine,
};

if (require.main === module) {
  main();
}
