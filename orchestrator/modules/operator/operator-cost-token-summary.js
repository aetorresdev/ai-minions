#!/usr/bin/env node
/**
 * Management-facing cost/token run summary — read-only trace consumption.
 * Distinguishes known · estimated · unavailable · not_billing; no fabricated Ollama billing.
 */

"use strict";

const { buildRunOutcomeSummary } = require("../trace/run-outcome-summary");
const { rollupStepsCostOutcome, optionalOllamaUsdEstimate, buildReport } = require("../budget/token-trace-report");
const { buildSameCountCloudProjections } = require("../budget/cloud-price-registry");

const COST_TOKEN_RUN_SUMMARY_SCHEMA = "1";

/** @typedef {'known'|'estimated'|'not_billing'|'unavailable'} CostStatus */
/** @typedef {'available'|'unavailable'} FieldAvailability */

/**
 * @param {number} x
 * @returns {number}
 */
function roundUsd(x) {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * @param {object[]} rows
 * @returns {string | null}
 */
function deriveSessionBackend(rows) {
  for (const r of rows) {
    if (r && r.event === "session_start" && typeof r.model_backend === "string" && r.model_backend.length) {
      return r.model_backend;
    }
  }
  return null;
}

/**
 * @param {object[]} rows
 * @returns {Map<string, object>}
 */
function indexModelSelectionByStep(rows) {
  /** @type {Map<string, object>} */
  const m = new Map();
  for (const r of rows) {
    if (!r || r.event !== "model_selection") continue;
    const sid = typeof r.step_id === "string" && r.step_id.length ? r.step_id : null;
    if (sid) m.set(sid, r);
  }
  return m;
}

/**
 * @param {object[]} rows
 * @returns {Map<string, { duration_ms: number | null, phase: string | null, agent: string | null, iteration: number | null }>}
 */
function indexAgentSteps(rows) {
  /** @type {Map<string, { duration_ms: number | null, phase: string | null, agent: string | null, iteration: number | null, start_ts_ms: number | null }>} */
  const m = new Map();

  const ensure = (sid) => {
    if (!m.has(sid)) {
      m.set(sid, {
        duration_ms: null,
        phase: null,
        agent: null,
        iteration: null,
        start_ts_ms: null,
      });
    }
    return /** @type {NonNullable<ReturnType<typeof m.get>>} */ (m.get(sid));
  };

  for (const r of rows) {
    if (!r) continue;
    const sid = typeof r.step_id === "string" && r.step_id.length ? r.step_id : null;
    if (!sid) continue;
    const rec = ensure(sid);
    if (r.event === "agent_start") {
      if (typeof r.phase === "string" && r.phase.length) rec.phase = r.phase;
      if (typeof r.agent === "string") rec.agent = r.agent;
      if (typeof r.iteration === "number") rec.iteration = r.iteration;
      if (typeof r.ts_ms === "number") rec.start_ts_ms = r.ts_ms;
    }
    if (r.event === "agent_done") {
      if (typeof r.duration_ms === "number" && !Number.isNaN(r.duration_ms)) {
        rec.duration_ms = r.duration_ms;
      } else if (typeof r.ts_ms === "number" && typeof rec.start_ts_ms === "number") {
        const delta = r.ts_ms - rec.start_ts_ms;
        if (delta >= 0) rec.duration_ms = delta;
      }
      if (typeof r.phase === "string" && r.phase.length) rec.phase = r.phase;
      if (typeof r.agent === "string") rec.agent = r.agent;
      if (typeof r.iteration === "number") rec.iteration = r.iteration;
    }
    if (r.event === "context_stats" && typeof r.phase === "string" && r.phase.length && !rec.phase) {
      rec.phase = r.phase;
    }
  }
  return m;
}

/**
 * @param {number | null | undefined} providerCost
 * @param {number | null | undefined} rollupUsd
 * @param {number} totalTokens
 * @param {string | null} backend
 * @returns {{ cost_usd: number | null, cost_status: CostStatus }}
 */
function resolveStepCost(providerCost, rollupUsd, totalTokens, backend) {
  if (typeof providerCost === "number" && !Number.isNaN(providerCost) && providerCost > 0) {
    return { cost_usd: roundUsd(providerCost), cost_status: "known" };
  }
  if (typeof rollupUsd === "number" && !Number.isNaN(rollupUsd)) {
    return { cost_usd: roundUsd(rollupUsd), cost_status: "estimated" };
  }
  if (totalTokens > 0) {
    const localBackend = backend === "ollama" || backend === "local" || backend === "lmstudio";
    return { cost_usd: null, cost_status: localBackend ? "not_billing" : "unavailable" };
  }
  return { cost_usd: null, cost_status: "unavailable" };
}

/**
 * @param {object[]} rows
 * @param {{ trace_file?: string | null, ollama_usd_estimate?: object | null }} [meta]
 * @returns {object}
 */
function buildCostTokenRunSummary(rows, meta = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      schema_version: COST_TOKEN_RUN_SUMMARY_SCHEMA,
      run: {
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        token_status: "unavailable",
        estimated_cost_usd: null,
        cost_status: "unavailable",
        total_latency_ms: null,
        latency_status: "unavailable",
        cost_basis: null,
      },
      by_phase: [],
      by_step: [],
    };
  }

  const ros = buildRunOutcomeSummary(rows, meta);
  const report = buildReport(rows);
  const rollup = rollupStepsCostOutcome(rows);
  const selectionByStep = indexModelSelectionByStep(rows);
  const agentByStep = indexAgentSteps(rows);
  const backend = deriveSessionBackend(rows);

  const usd = meta.ollama_usd_estimate != null
    ? meta.ollama_usd_estimate
    : optionalOllamaUsdEstimate(report);

  /** @type {Set<string>} */
  const stepIds = new Set();
  for (const s of rollup) stepIds.add(s.step_id);
  for (const sid of selectionByStep.keys()) stepIds.add(sid);
  for (const sid of agentByStep.keys()) stepIds.add(sid);

  /** @type {object[]} */
  const by_step = [];
  let runLatency = 0;
  let latencySteps = 0;
  /** @type {Record<string, { phase: string, steps: number, input_tokens: number, output_tokens: number, total_tokens: number, estimated_cost_usd: number, cost_status: CostStatus, total_latency_ms: number, latency_steps: number }>} */
  const phaseAcc = {};

  const ensurePhase = (phase) => {
    const key = phase ?? "(no_phase)";
    if (!phaseAcc[key]) {
      phaseAcc[key] = {
        phase: key,
        steps: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        cost_status: "unavailable",
        total_latency_ms: 0,
        latency_steps: 0,
      };
    }
    return phaseAcc[key];
  };

  const rollupByStep = new Map(rollup.map((s) => [s.step_id, s]));

  for (const step_id of [...stepIds].sort()) {
    const roll = rollupByStep.get(step_id);
    const sel = selectionByStep.get(step_id);
    const agent = agentByStep.get(step_id);

    const input_tokens = roll ? roll.ollama_prompt_tokens : null;
    const output_tokens = roll ? roll.ollama_completion_tokens : null;
    const total_tokens = roll ? roll.ollama_total_tokens : 0;
    const token_status = total_tokens > 0 ? "available" : "unavailable";

    const providerCost = sel && typeof sel.estimated_cost_usd === "number" ? sel.estimated_cost_usd : null;
    const rollupUsd = roll && typeof roll.usd_estimate === "number" ? roll.usd_estimate : null;
    const { cost_usd, cost_status } = resolveStepCost(providerCost, rollupUsd, total_tokens, backend);

    const latency_ms = agent?.duration_ms ?? null;
    const latency_status = typeof latency_ms === "number" ? "available" : "unavailable";
    if (latency_status === "available") {
      runLatency += latency_ms;
      latencySteps += 1;
    }

    const phase = agent?.phase ?? (typeof sel?.agent === "string" ? sel.agent : null);
    const stepRec = {
      step_id,
      phase,
      agent: agent?.agent ?? (typeof sel?.agent === "string" ? sel.agent : roll?.agent ?? null),
      iteration: agent?.iteration ?? roll?.iteration ?? null,
      model: sel && typeof sel.model === "string" ? sel.model : null,
      model_tier: sel && typeof sel.model_tier === "string" ? sel.model_tier : null,
      selection_reason: sel && typeof sel.selection_reason === "string" ? sel.selection_reason : null,
      input_tokens,
      output_tokens,
      total_tokens: total_tokens > 0 ? total_tokens : null,
      token_status,
      estimated_cost_usd: cost_usd,
      cost_status,
      latency_ms,
      latency_status,
    };
    by_step.push(stepRec);

    const pBucket = ensurePhase(phase);
    pBucket.steps += 1;
    pBucket.input_tokens += input_tokens ?? 0;
    pBucket.output_tokens += output_tokens ?? 0;
    pBucket.total_tokens += total_tokens;
    if (typeof cost_usd === "number") pBucket.estimated_cost_usd += cost_usd;
    if (cost_status !== "unavailable" && pBucket.cost_status === "unavailable") {
      pBucket.cost_status = cost_status;
    } else if (cost_status === "estimated" && pBucket.cost_status !== "known") {
      pBucket.cost_status = cost_status;
    } else if (cost_status === "known") {
      pBucket.cost_status = "known";
    } else if (cost_status === "not_billing" && pBucket.cost_status === "unavailable") {
      pBucket.cost_status = "not_billing";
    }
    if (latency_status === "available") {
      pBucket.total_latency_ms += latency_ms;
      pBucket.latency_steps += 1;
    }
  }

  const runInput = ros.cost.ollama_prompt_tokens;
  const runOutput = ros.cost.ollama_completion_tokens;
  const runTotal = ros.cost.ollama_total_tokens;
  const runTokenStatus = runTotal > 0 ? "available" : "unavailable";

  let runCostUsd = null;
  /** @type {CostStatus} */
  let runCostStatus = "unavailable";
  let runCostBasis = null;

  const selectionCosts = [...selectionByStep.values()]
    .map((r) => (typeof r.estimated_cost_usd === "number" ? r.estimated_cost_usd : 0))
    .filter((n) => n > 0);
  const selectionSum = selectionCosts.reduce((a, b) => a + b, 0);

  if (selectionSum > 0) {
    runCostUsd = roundUsd(selectionSum);
    runCostStatus = "known";
    runCostBasis = "model_selection_estimated_cost_usd_sum";
  } else if (usd && typeof usd.usd_total_estimate === "number") {
    runCostUsd = usd.usd_total_estimate;
    runCostStatus = "estimated";
    runCostBasis = usd.basis ?? "env_rates_per_mtok";
  } else if (runTotal > 0) {
    runCostStatus = backend === "ollama" || backend === "local" || backend === "lmstudio" || !backend
      ? "not_billing"
      : "unavailable";
    runCostBasis = runCostStatus === "not_billing" ? "local_backend_no_billing_api" : null;
  }

  const by_phase = Object.values(phaseAcc)
    .map((p) => ({
      phase: p.phase,
      steps: p.steps,
      input_tokens: p.input_tokens > 0 ? p.input_tokens : null,
      output_tokens: p.output_tokens > 0 ? p.output_tokens : null,
      total_tokens: p.total_tokens > 0 ? p.total_tokens : null,
      estimated_cost_usd: p.estimated_cost_usd > 0 ? roundUsd(p.estimated_cost_usd) : null,
      cost_status: p.cost_status,
      total_latency_ms: p.latency_steps > 0 ? p.total_latency_ms : null,
      latency_status: p.latency_steps > 0 ? "available" : "unavailable",
    }))
    .sort((a, b) => (b.total_tokens ?? 0) - (a.total_tokens ?? 0));

  const same_count_cloud_projections = runTotal > 0
    ? buildSameCountCloudProjections({
      prompt_tokens: runInput > 0 ? runInput : 0,
      completion_tokens: runOutput > 0 ? runOutput : 0,
    })
    : [];

  return {
    schema_version: COST_TOKEN_RUN_SUMMARY_SCHEMA,
    run: {
      input_tokens: runInput > 0 ? runInput : null,
      output_tokens: runOutput > 0 ? runOutput : null,
      total_tokens: runTotal > 0 ? runTotal : null,
      token_status: runTokenStatus,
      estimated_cost_usd: runCostUsd,
      cost_status: runCostStatus,
      total_latency_ms: latencySteps > 0 ? runLatency : null,
      latency_status: latencySteps > 0 ? "available" : "unavailable",
      cost_basis: runCostBasis,
      model_backend: backend,
      same_count_cloud_projections,
    },
    by_phase,
    by_step,
  };
}

/**
 * @param {ReturnType<typeof buildCostTokenRunSummary>} summary
 * @returns {string}
 */
/**
 * @param {object[]} projections
 * @returns {string}
 */
function formatSameCountProjectionSuffix(projections) {
  if (!Array.isArray(projections) || projections.length === 0) return "";
  const parts = projections.slice(0, 3).map((p) => {
    const fresh = p.freshness === "stale" ? " stale" : "";
    return `${p.provider}/${p.model}=$${p.total_usd}${fresh}`;
  });
  return ` · same-count cloud projection (advisory): ${parts.join("; ")}`;
}

function formatRunCostLine(summary) {
  const run = summary.run ?? {};
  if (run.token_status !== "available") {
    return "unavailable (trace has no token totals)";
  }
  const tokens = `${run.total_tokens} tokens (in=${run.input_tokens ?? "?"} out=${run.output_tokens ?? "?"})`;
  const proj = formatSameCountProjectionSuffix(run.same_count_cloud_projections);
  if (run.cost_status === "known" && typeof run.estimated_cost_usd === "number") {
    return `${tokens} · cost USD ${run.estimated_cost_usd} (known from trace)${proj}`;
  }
  if (run.cost_status === "estimated" && typeof run.estimated_cost_usd === "number") {
    return `${tokens} · est. cost USD ${run.estimated_cost_usd} (estimated from config rates)${proj}`;
  }
  if (run.cost_status === "not_billing") {
    return `${tokens} · cost: not_billing (local backend — no provider billing API)${proj}`;
  }
  return `${tokens} · cost: unavailable${proj}`;
}

/**
 * @param {ReturnType<typeof buildCostTokenRunSummary>} summary
 * @returns {string}
 */
function formatRunLatencyLine(summary) {
  const run = summary.run ?? {};
  if (run.latency_status === "available" && typeof run.total_latency_ms === "number") {
    return `${run.total_latency_ms} ms (sum of traced agent_done durations)`;
  }
  return "unavailable (no per-step duration_ms or ts_ms pairs in trace)";
}

/**
 * @param {ReturnType<typeof buildCostTokenRunSummary>} summary
 * @returns {string[]}
 */
function formatCostTokenRunSummaryLines(summary) {
  if (!summary || typeof summary !== "object") {
    return ["-- cost_token_run_summary --", "  (unavailable)", ""];
  }
  const run = summary.run ?? {};
  const lines = [
    "-- cost_token_run_summary --",
    `  token_status:       ${run.token_status}`,
    `  total_tokens:       ${run.total_tokens ?? "-"}`,
    `  cost_status:        ${run.cost_status}`,
    `  estimated_cost_usd: ${run.estimated_cost_usd ?? "-"}`,
    `  latency_status:     ${run.latency_status}`,
    `  total_latency_ms:   ${run.total_latency_ms ?? "-"}`,
    `  model_backend:      ${run.model_backend ?? "unavailable"}`,
    `  phases:             ${summary.by_phase?.length ?? 0}`,
    `  steps:              ${summary.by_step?.length ?? 0}`,
  ];
  const projections = Array.isArray(run.same_count_cloud_projections)
    ? run.same_count_cloud_projections
    : [];
  if (projections.length) {
    lines.push("  same_count_cloud_projections (advisory; not billing):");
    for (const p of projections) {
      lines.push(
        `    - ${p.provider}/${p.model}: $${p.total_usd}`
          + ` (in=$${p.input_usd} out=$${p.output_usd}`
          + ` · ${p.freshness} · checked ${p.checked_at})`,
      );
    }
    lines.push("  projection_note:    same token counts ≠ tokenizer/workload equivalence");
  }
  lines.push("");
  return lines;
}

module.exports = {
  COST_TOKEN_RUN_SUMMARY_SCHEMA,
  buildCostTokenRunSummary,
  formatRunCostLine,
  formatRunLatencyLine,
  formatCostTokenRunSummaryLines,
  formatSameCountProjectionSuffix,
  resolveStepCost,
};
