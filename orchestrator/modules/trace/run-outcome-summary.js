#!/usr/bin/env node
/**
 * Single consumption shape for trace JSONL: what / where / why / cost / QA / intent grouping.
 * Used by scenario export, console dashboard, and token-trace-report --json.
 */

"use strict";

const {
  buildReport,
  optionalOllamaUsdEstimate,
  rollupStepsCostOutcome,
  summarizeFailureTaxonomyFromRows,
} = require("../../token-trace-report");
const { summarizeReviewRecordsFromRows } = require("../gates/review-record");
const { summarizeRecoveryFromRows } = require("../recovery/recovery-sweep");
const { summarizeSessionResumeFromRows } = require("../recovery/session-resume");
const { summarizeWorkspaceLifecycleFromRows } = require("../../trace-workspace-lifecycle");

/**
 * @param {object[]} rows — sanitized trace rows (same pipeline as export/dashboard)
 * @param {{ trace_file?: string | null, ollama_usd_estimate?: object | null }} [meta]
 * @returns {object}
 */
function buildRunOutcomeSummary(rows, meta = {}) {
  const report = buildReport(rows);
  const ss = report.session_start;
  const se = report.session_end;
  const tax = summarizeFailureTaxonomyFromRows(rows);
  const rollup = rollupStepsCostOutcome(rows);

  const taskId = typeof ss?.task_id === "string" ? ss.task_id
    : (rows.find((r) => typeof r.task_id === "string") || {}).task_id ?? null;

  const iterDone = rows.filter((r) => r.event === "iteration_done");
  const lastIter = iterDone.length ? iterDone[iterDone.length - 1] : null;

  const topReasons = Object.entries(tax.by_reason_code)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason_code, count]) => ({ reason_code, count }));

  /** @type {Record<string, { intent_id: string | null, ollama_total_tokens: number, steps: number, failed_steps: number }>} */
  const intentMap = {};
  for (const s of rollup) {
    const raw = s.intent_id;
    const key = raw != null && String(raw).length ? String(raw) : "(no_intent)";
    if (!intentMap[key]) {
      intentMap[key] = {
        intent_id: key === "(no_intent)" ? null : key,
        ollama_total_tokens: 0,
        steps: 0,
        failed_steps: 0,
      };
    }
    const g = intentMap[key];
    g.ollama_total_tokens += typeof s.ollama_total_tokens === "number" ? s.ollama_total_tokens : 0;
    g.steps += 1;
    if (s.step_failed) g.failed_steps += 1;
  }
  const intent_groups = Object.values(intentMap).sort(
    (a, b) => b.ollama_total_tokens - a.ollama_total_tokens,
  );

  let qaTriple = 0;
  let qaBlocker = 0;
  for (const s of rollup) {
    if (s.qa_triple_template === true) {
      qaTriple += 1;
      if (s.qa_blocker_non_vacuous === true) qaBlocker += 1;
    }
  }

  const pEnd = se && typeof se.ollama_prompt_tokens_total === "number" ? se.ollama_prompt_tokens_total : null;
  const cEnd = se && typeof se.ollama_completion_tokens_total === "number"
    ? se.ollama_completion_tokens_total : null;
  const fromCtx = report.ollama_from_context_stats || { prompt: 0, completion: 0 };
  const prompt = pEnd != null ? pEnd : fromCtx.prompt;
  const completion = cEnd != null ? cEnd : fromCtx.completion;

  const usd = meta.ollama_usd_estimate != null
    ? meta.ollama_usd_estimate
    : optionalOllamaUsdEstimate(report);

  /** @type {object} */
  const cost = {
    ollama_prompt_tokens: typeof prompt === "number" ? prompt : 0,
    ollama_completion_tokens: typeof completion === "number" ? completion : 0,
    ollama_total_tokens: (typeof prompt === "number" ? prompt : 0) + (typeof completion === "number" ? completion : 0),
    basis: pEnd != null || cEnd != null ? "session_end_totals_else_context_stats_sum" : "context_stats_only",
  };
  if (usd && typeof usd === "object") {
    cost.usd_estimate = usd;
  }

  const tr = lastIter && lastIter.transition_reason && typeof lastIter.transition_reason === "object"
    ? lastIter.transition_reason
    : null;

  const reviewSummary = summarizeReviewRecordsFromRows(rows);
  const recoverySummary = summarizeRecoveryFromRows(rows);
  const resumeSummary = summarizeSessionResumeFromRows(rows);
  const workspaceSummary = summarizeWorkspaceLifecycleFromRows(rows);

  return {
    schema_version: "1",
    where: {
      task_id: taskId,
      trace_file: meta.trace_file != null ? meta.trace_file : null,
      scenario_id: ss && typeof ss.scenario_id === "string" ? ss.scenario_id : null,
      flow_mode: ss && typeof ss.flow_mode === "string" ? ss.flow_mode : null,
      max_iterations: typeof ss?.max_iterations === "number" ? ss.max_iterations : null,
    },
    what: {
      done: typeof se?.done === "boolean" ? se.done : null,
      iterations: typeof se?.iterations === "number" ? se.iterations : null,
      summary: typeof se?.summary === "string" ? se.summary.slice(0, 500) : null,
      last_iteration_outcome: typeof lastIter?.outcome === "string" ? lastIter.outcome : null,
      last_transition_reason: tr
        ? {
          type: typeof tr.type === "string" ? tr.type : null,
          reason_code: typeof tr.reason_code === "string" ? tr.reason_code : null,
        }
        : null,
    },
    why: {
      gate_blocks: typeof se?.gate_blocks === "number" ? se.gate_blocks : null,
      iteration_done_events: tax.iteration_done_count,
      top_reason_codes: topReasons,
      rollup_failed_steps: rollup.filter((x) => x.step_failed).length,
      rollup_contract_fail_steps: rollup.filter((x) => x.contract_fail).length,
      rollup_gate_fail_steps: rollup.filter((x) => x.gate_fail).length,
    },
    cost,
    qa: {
      qa_degraded: se?.qa_degraded === true,
      manual_review_recommended: se?.manual_review_recommended === true,
      handoff_fallback_used: se?.handoff_fallback_used === true,
      qa_triple_template_steps: qaTriple,
      qa_substantive_blocker_steps: qaBlocker,
    },
    review: reviewSummary,
    recovery: {
      policy: "no_auto_retry",
      computed_from: recoverySummary.computed_from || "full_trace",
      clean: recoverySummary.clean,
      finding_count: recoverySummary.finding_count,
      blocks_auto_recovery: recoverySummary.blocks_auto_recovery,
      summary: recoverySummary.summary,
      findings: recoverySummary.findings.map((f) => ({
        finding_kind: f.finding_kind,
        severity: f.severity,
        step_id: f.step_id ?? null,
        description: f.description,
      })),
      historical_sweep: recoverySummary.sweep_event,
      ...(recoverySummary.sweep_event != null
        && recoverySummary.sweep_event.clean !== recoverySummary.clean
        ? {
          recompute_note:
              "Export state is recomputed from the full trace; may differ from recovery_completed emitted before session_end.",
        }
        : {}),
    },
    resume: {
      policy: resumeSummary.policy,
      computed_from: resumeSummary.computed_from,
      eligible: resumeSummary.eligible,
      block_codes: resumeSummary.block_codes,
      summary: resumeSummary.summary,
      side_effects_require_revalidation: resumeSummary.side_effects_require_revalidation,
      trace_signals: resumeSummary.trace_signals,
      checkpoint: {
        task_id: resumeSummary.checkpoint.task_id,
        resume_of_task_id: resumeSummary.checkpoint.resume_of_task_id,
        session_complete: resumeSummary.checkpoint.session_complete,
        active_step_id: resumeSummary.checkpoint.active_step_id,
        active_role: resumeSummary.checkpoint.active_role,
        recovery_clean: resumeSummary.checkpoint.recovery_clean,
        cost_checkpoint: resumeSummary.checkpoint.cost_checkpoint,
        handoff_contract: resumeSummary.checkpoint.handoff_contract,
        review_summary: resumeSummary.checkpoint.review_summary,
      },
    },
    intent_groups,
    workspace: workspaceSummary,
  };
}

/** @param {boolean} use @param {number} code @param {string} s */
function ansi(use, code, s) {
  return use ? `\x1b[${code}m${s}\x1b[0m` : s;
}

/** @param {boolean} use @param {boolean|null|undefined} done */
function colorDoneToken(use, done) {
  const t = String(done);
  if (!use) return t;
  if (done === true) return ansi(true, 32, t);
  if (done === false) return ansi(true, 31, t);
  return ansi(true, 2, t);
}

/** @param {boolean} use @param {string|null|undefined} outcome */
function colorLastOutcomeToken(use, outcome) {
  const t = outcome != null && String(outcome).length ? String(outcome) : "-";
  if (!use) return t;
  if (t === "done") return ansi(true, 32, t);
  if (t === "iterate" || t === "blocked" || t === "abort") return ansi(true, 33, t);
  return t;
}

/**
 * @param {ReturnType<typeof buildRunOutcomeSummary>} summary
 * @param {{ useColor?: boolean }} [opts]
 * @returns {string[]}
 */
function formatRunOutcomeSummaryLines(summary, opts = {}) {
  const use = opts.useColor === true;
  const lines = [];
  lines.push("-- run_outcome_summary (consumption layer) --");
  const w = summary.where;
  lines.push(
    `where: task_id=${w.task_id ?? "?"}  scenario=${w.scenario_id ?? "-"}  flow=${w.flow_mode ?? "?"}`
      + (w.trace_file ? `  file=${w.trace_file}` : ""),
  );
  const what = summary.what;
  const rc = what.last_transition_reason?.reason_code ?? "-";
  const rcDisp = use && rc !== "-" ? ansi(true, 36, rc) : rc;
  lines.push(
    `what:  done=${colorDoneToken(use, what.done)}  iterations=${what.iterations ?? "?"}`
      + `  last_outcome=${colorLastOutcomeToken(use, what.last_iteration_outcome)}`
      + `  reason=${rcDisp}`,
  );
  if (what.summary) lines.push(`  summary: ${what.summary.replace(/\s+/g, " ").slice(0, 160)}`);
  const y = summary.why;
  const gb = y.gate_blocks ?? "?";
  const gbDisp = use && typeof y.gate_blocks === "number" && y.gate_blocks > 0
    ? ansi(true, 33, String(gb))
    : String(gb);
  lines.push(
    `why:   gate_blocks=${gbDisp}  iter_done=${y.iteration_done_events}`
      + `  failed_steps=${y.rollup_failed_steps}  contract_fail=${y.rollup_contract_fail_steps}  gate_fail=${y.rollup_gate_fail_steps}`,
  );
  if (y.top_reason_codes && y.top_reason_codes.length) {
    const top = y.top_reason_codes.slice(0, 3).map((x) => `${x.reason_code}*${x.count}`).join(", ");
    lines.push(`  top_reason_codes: ${top}`);
  }
  const c = summary.cost;
  lines.push(
    `cost:  prompt=${c.ollama_prompt_tokens}  completion=${c.ollama_completion_tokens}  total=${c.ollama_total_tokens}`
      + (c.usd_estimate && typeof c.usd_estimate.usd_total_estimate === "number"
        ? `  usd~=${c.usd_estimate.usd_total_estimate}`
        : ""),
  );
  const q = summary.qa;
  const qaBits = [];
  if (q.qa_degraded) qaBits.push("qa_degraded");
  if (q.manual_review_recommended) qaBits.push("manual_review");
  if (q.handoff_fallback_used) qaBits.push("handoff_fallback");
  if (q.qa_triple_template_steps) qaBits.push(`qa_triple=${q.qa_triple_template_steps}`);
  if (q.qa_substantive_blocker_steps) qaBits.push(`qa_blocker=${q.qa_substantive_blocker_steps}`);
  const qaPlain = qaBits.length ? qaBits.join(" ") : "(no signals)";
  const qaDisp = use && qaBits.length ? ansi(true, 33, qaPlain) : qaPlain;
  lines.push(`qa:    ${qaDisp}`);
  if (summary.review) {
    const rv = summary.review;
    lines.push(
      `review: final=${rv.final_verdict ?? "-"}  cerberus=${rv.cerberus_verdict ?? "-"}  qa=${rv.qa_verdict ?? "-"}`,
    );
    if (rv.qa_verification_level) {
      lines.push(`  qa_verification: ${rv.qa_verification_level}`);
    }
    if (rv.browser_verification_pending) {
      lines.push("  browser_evidence: pending (do not claim all P0/P1 verified)");
    }
    const lastCerb = [...(rv.records || [])].reverse().find((r) => r.reviewer_role === "cerberus");
    if (lastCerb && lastCerb.blockers?.length) {
      lines.push(`  blockers: ${lastCerb.blockers.slice(0, 3).join(" | ")}`);
    }
  }
  if (summary.recovery) {
    const rec = summary.recovery;
    const recDisp = use && !rec.clean ? ansi(true, 33, rec.summary) : rec.summary;
    lines.push(
      `recovery: clean=${rec.clean}  findings=${rec.finding_count}  policy=${rec.policy}`,
    );
    if (rec.summary) lines.push(`  ${recDisp}`);
  }
  if (summary.resume) {
    const rs = summary.resume;
    const rsDisp = use && !rs.eligible ? ansi(true, 33, rs.summary) : rs.summary;
    lines.push(
      `resume: eligible=${rs.eligible}  session_complete=${rs.checkpoint?.session_complete ?? "?"}`
        + (rs.trace_signals?.is_resume_run ? "  is_resume_run" : ""),
    );
    if (rs.summary) lines.push(`  ${rsDisp}`);
  }
  if (summary.intent_groups && summary.intent_groups.length) {
    const ig = summary.intent_groups.slice(0, 6).map(
      (g) => `${g.intent_id ?? "(null)"}:${g.ollama_total_tokens}tok/${g.steps}st/${g.failed_steps}fail`,
    ).join(" | ");
    lines.push(`intent_groups: ${ig}`);
  }
  lines.push("");
  return lines;
}

module.exports = {
  buildRunOutcomeSummary,
  formatRunOutcomeSummaryLines,
};
