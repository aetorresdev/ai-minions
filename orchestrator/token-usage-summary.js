"use strict";

/**
 * Build token_usage_summary from trace rows (context_stats with optional compaction attribution).
 * @param {Array<Record<string, unknown>>} rows
 * @returns {{
 *   token_usage_summary: {
 *     run_total: { input_tokens: number, output_tokens: number, total_tokens: number },
 *     by_role: Record<string, {
 *       direct_input_tokens: number,
 *       direct_output_tokens: number,
 *       infra_attributed_input_tokens: number,
 *       infra_attributed_output_tokens: number,
 *       total_input_tokens: number,
 *       total_output_tokens: number,
 *       total_tokens: number,
 *       by_model: unknown[],
 *     }>,
 *     by_invocation: Array<Record<string, unknown>>,
 *   }
 * }}
 */
function numTok(v) {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return v;
}

function isCompactionRow(r) {
  return r.invocation_type === "context_compaction" || r.execution_actor === "context_compactor";
}

function buildTokenUsageSummary(rows) {
  /** @type {Record<string, { direct_input_tokens: number, direct_output_tokens: number, infra_attributed_input_tokens: number, infra_attributed_output_tokens: number, total_input_tokens: number, total_output_tokens: number, total_tokens: number, by_model: unknown[] }>} */
  const byRole = {};
  /** @type {Array<Record<string, unknown>>} */
  const byInvocation = [];
  let runIn = 0;
  let runOut = 0;

  function ensure(role) {
    if (!byRole[role]) {
      byRole[role] = {
        direct_input_tokens: 0,
        direct_output_tokens: 0,
        infra_attributed_input_tokens: 0,
        infra_attributed_output_tokens: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_tokens: 0,
        by_model: [],
      };
    }
    return byRole[role];
  }

  for (const r of rows) {
    if (!r || r.event !== "context_stats") continue;
    const p = numTok(/** @type {number} */ (r.ollama_prompt_tokens));
    const c = numTok(/** @type {number} */ (r.ollama_completion_tokens));
    const infra = isCompactionRow(r);
    const hasNamedModelSegment =
      !infra &&
      (typeof r.model_fallback_segment_index === "number" ||
        (typeof r.model_name === "string" && r.model_name.length > 0));
    const includeInvocation = p > 0 || c > 0 || infra || hasNamedModelSegment;
    if (!includeInvocation) continue;
    const attributed =
      typeof r.attributed_to_role === "string" && r.attributed_to_role.length
        ? r.attributed_to_role
        : infra
          ? "unknown"
          : typeof r.agent === "string" && r.agent.length
            ? r.agent
            : "unknown";
    const execActor =
      typeof r.execution_actor === "string" && r.execution_actor.length
        ? r.execution_actor
        : infra
          ? "context_compactor"
          : typeof r.agent === "string"
            ? r.agent
            : "unknown";

    runIn += p;
    runOut += c;

    const rec = ensure(attributed);
    if (infra) {
      rec.infra_attributed_input_tokens += p;
      rec.infra_attributed_output_tokens += c;
    } else {
      rec.direct_input_tokens += p;
      rec.direct_output_tokens += c;
    }
    rec.total_input_tokens += p;
    rec.total_output_tokens += c;
    rec.total_tokens += p + c;

    if (!infra && typeof r.model_name === "string" && r.model_name.length > 0) {
      rec.by_model.push({
        model_backend: typeof r.model_backend === "string" ? r.model_backend : "unknown",
        model_name: r.model_name,
        input_tokens: p,
        output_tokens: c,
        total_tokens: p + c,
        status: typeof r.status === "string" ? r.status : undefined,
        fallback_reason: typeof r.fallback_reason === "string" ? r.fallback_reason : undefined,
        fallback_from: typeof r.fallback_from === "string" ? r.fallback_from : undefined,
        usage_accounting_status: typeof r.usage_accounting_status === "string" ? r.usage_accounting_status : undefined,
      });
    }

    /** @type {Record<string, unknown>} */
    const inv = {
      invocation_type: infra ? "context_compaction" : "agent_call",
      execution_actor: execActor,
      attributed_to_role: attributed,
      role: typeof r.agent === "string" ? r.agent : undefined,
      step_id: typeof r.step_id === "string" ? r.step_id : undefined,
      iteration: typeof r.iteration === "number" ? r.iteration : undefined,
      phase: typeof r.phase === "string" ? r.phase : undefined,
      input_tokens: p,
      output_tokens: c,
      total_tokens: p + c,
      trigger_reason: typeof r.trigger_reason === "string" ? r.trigger_reason : undefined,
    };
    if (typeof r.model_name === "string") inv.model_name = r.model_name;
    if (typeof r.model_backend === "string") inv.model_backend = r.model_backend;
    if (typeof r.status === "string") inv.status = r.status;
    if (typeof r.fallback_reason === "string") inv.fallback_reason = r.fallback_reason;
    if (typeof r.fallback_from === "string") inv.fallback_from = r.fallback_from;
    if (typeof r.usage_accounting_status === "string") inv.usage_accounting_status = r.usage_accounting_status;
    if (typeof r.model_fallback_segment_index === "number") inv.model_fallback_segment_index = r.model_fallback_segment_index;
    if (typeof r.model_fallback_chain_length === "number") inv.model_fallback_chain_length = r.model_fallback_chain_length;
    byInvocation.push(inv);
  }

  const runTotalTokens = runIn + runOut;
  return {
    token_usage_summary: {
      run_total: {
        input_tokens: runIn,
        output_tokens: runOut,
        total_tokens: runTotalTokens,
      },
      by_role: byRole,
      by_invocation: byInvocation,
    },
  };
}

module.exports = { buildTokenUsageSummary, isCompactionRow };
