"use strict";

/**
 * Run-level cost accounting: separate "actual" (env-priced tokens, billable for guards in this stack)
 * from "equivalent_cloud" (optional benchmark — not provider spend, not for hard-stop).
 */

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
 * @param {{ ollama_prompt_tokens_total?: number, ollama_completion_tokens_total?: unknown } | null} sessionEnd
 * @param {{ prompt: number, completion: number }} fromContextStats
 * @returns {{ prompt: number, completion: number } | null}
 */
function resolveOllamaTokenTotals(sessionEnd, fromContextStats) {
  let prompt =
    sessionEnd && typeof sessionEnd.ollama_prompt_tokens_total === "number" && !Number.isNaN(sessionEnd.ollama_prompt_tokens_total)
      ? sessionEnd.ollama_prompt_tokens_total
      : null;
  let completion =
    sessionEnd && typeof sessionEnd.ollama_completion_tokens_total === "number" && !Number.isNaN(sessionEnd.ollama_completion_tokens_total)
      ? sessionEnd.ollama_completion_tokens_total
      : null;
  if (prompt == null) prompt = fromContextStats.prompt;
  if (completion == null) completion = fromContextStats.completion;
  if (typeof prompt !== "number" || typeof completion !== "number") return null;
  if (Number.isNaN(prompt) || Number.isNaN(completion)) return null;
  return { prompt, completion };
}

/**
 * @param {{ session_end?: unknown, ollama_from_context_stats: { prompt: number, completion: number } }} report
 */
function buildRunCostAccountingFromReport(report) {
  const totals = resolveOllamaTokenTotals(
    report.session_end,
    report.ollama_from_context_stats,
  );
  if (!totals || (totals.prompt === 0 && totals.completion === 0)) return null;

  const p = totals.prompt;
  const c = totals.completion;

  const actualP = parseEnvPositiveFloat("ORCH_USD_PER_MTOK_PROMPT");
  const actualC = parseEnvPositiveFloat("ORCH_USD_PER_MTOK_COMPLETION");
  const equivP = parseEnvPositiveFloat("ORCH_EQUIV_CLOUD_USD_PER_MTOK_PROMPT");
  const equivC = parseEnvPositiveFloat("ORCH_EQUIV_CLOUD_USD_PER_MTOK_COMPLETION");
  const baselineModel = (process.env.ORCH_EQUIV_CLOUD_BASELINE_MODEL || "").trim();
  const baselineProvider = (process.env.ORCH_EQUIV_CLOUD_BASELINE_PROVIDER || "").trim() || "custom";

  /** @type {Record<string, unknown>} */
  const run = {
    prompt_tokens: p,
    completion_tokens: c,
    total_tokens: p + c,
  };

  if (actualP != null && actualC != null) {
    const ai = (p / 1e6) * actualP;
    const ao = (c / 1e6) * actualC;
    run.actual = {
      input_usd: roundUsd(ai),
      output_usd: roundUsd(ao),
      total_usd: roundUsd(ai + ao),
      source: "env_pricing",
      is_billable: true,
      usd_note: "estimated",
    };
  } else {
    run.actual = {
      input_usd: null,
      output_usd: null,
      total_usd: null,
      source: "unknown",
      is_billable: false,
    };
  }

  if (equivP != null && equivC != null) {
    if (!baselineModel) {
      run.equivalent_cloud = {
        equivalent_cloud_cost_status: "missing_baseline_model",
        is_billable: false,
        note: "set_ORCH_EQUIV_CLOUD_BASELINE_MODEL_when_using_equiv_rates",
      };
    } else {
      const ei = (p / 1e6) * equivP;
      const eo = (c / 1e6) * equivC;
      run.equivalent_cloud = {
        input_usd: roundUsd(ei),
        output_usd: roundUsd(eo),
        total_usd: roundUsd(ei + eo),
        baseline_provider: baselineProvider,
        baseline_model: baselineModel,
        pricing_source: "env",
        is_billable: false,
        note: "theoretical_cloud_benchmark_not_provider_spend",
      };
    }
  } else {
    run.equivalent_cloud = {
      equivalent_cloud_cost_status: "missing_baseline_mapping",
      is_billable: false,
    };
  }

  return { cost_accounting: { run } };
}

module.exports = { buildRunCostAccountingFromReport, resolveOllamaTokenTotals };
