'use strict';

/**
 * Trace-based evals for operator visibility surfaces (status/TUI/report/attach).
 * Deterministic fixture checks — no LLM-as-judge; missing trace fails closed.
 */

const { loadOperatorTraceContext } = require('./operator-trace-command');
const { buildOperatorEvidenceTuiText } = require('./operator-evidence-tui');
const { buildRunReportArtifacts } = require('./operator-run-report');
const {
  buildAttachManagementSummaryMd,
  deriveConfidenceLevel,
} = require('./operator-attach-bundle');
const { evaluateSteeringHandlerPolicy } = require('./steering-handler-policy-gate');

const TRACE_BASED_EVAL_SCHEMA = '1';

const FORBIDDEN_CLAIM_PATTERNS = [
  /\bROI\b(?! or productivity metrics)/i,
  /\bproductivity gain\b/i,
  /\bbilling[- ]accurate\b(?! cost)/i,
  /\bguaranteed\b/i,
  /\bproduction-ready\b/i,
];

/**
 * Strip ## Not claimed blocks and negation lines; resume scanning after next heading.
 * @param {string} text
 * @returns {string}
 */
function stripIgnoredClaimSections(text) {
  const lines = String(text).split('\n');
  /** @type {string[]} */
  const kept = [];
  let inNotClaimed = false;

  for (const line of lines) {
    if (/^\s*##\s+Not claimed\b/i.test(line)) {
      inNotClaimed = true;
      continue;
    }

    if (/^\s*#{1,6}\s+/i.test(line)) {
      inNotClaimed = false;
    }

    if (inNotClaimed) continue;
    if (/do not|does not|not claim|not claimed|avoid claiming|without evidence|not billing|not production-ready|no unsupported/i.test(line)) continue;

    kept.push(line);
  }

  return kept.join('\n');
}

/**
 * @param {string | string[]} textOrSurfaces
 * @returns {RegExp | undefined}
 */
function findForbiddenClaim(textOrSurfaces) {
  const surfaces = Array.isArray(textOrSurfaces) ? textOrSurfaces : [textOrSurfaces];
  for (const surface of surfaces) {
    const body = stripIgnoredClaimSections(surface);
    const hit = FORBIDDEN_CLAIM_PATTERNS.find((re) => re.test(body));
    if (hit) return hit;
  }
  return undefined;
}

const PRECISE_USD_PATTERN = /\bUSD\s+\d+\.\d{2,}\b/i;

/**
 * @param {object[]} rows
 * @returns {string[]}
 */
function collectTraceBlockingReasonCodes(rows) {
  /** @type {string[]} */
  const codes = [];
  for (const r of rows) {
    if (!r || typeof r.reason_code !== 'string' || !r.reason_code.length) continue;
    if (
      r.event === 'model_tier_gate_denied'
      || r.event === 'budget_block'
      || (r.event === 'permission_check' && (r.decision === 'deny' || r.decision === 'requires_approval'))
    ) {
      if (!codes.includes(r.reason_code)) codes.push(r.reason_code);
    }
  }
  return codes;
}

/**
 * @param {string} id
 * @param {boolean} pass
 * @param {string} detail
 * @returns {{ id: string, pass: boolean, detail: string }}
 */
function check(id, pass, detail) {
  return { id, pass, detail };
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {{ tuiText: string, reportArtifacts: ReturnType<typeof buildRunReportArtifacts>, managementMd: string }} surfaces
 * @returns {{ schema_version: string, ok: boolean, checks: ReturnType<typeof check>[], failures: string[] }}
 */
function evaluateOperatorTraceSurfaces(ctx, surfaces) {
  /** @type {ReturnType<typeof check>[]} */
  const checks = [];
  const { summary, run_state: rs, rows } = ctx;
  const traceCodes = collectTraceBlockingReasonCodes(rows);
  const allText = [
    surfaces.tuiText,
    surfaces.managementMd,
    surfaces.reportArtifacts.operator_report,
    surfaces.reportArtifacts.management_summary,
    surfaces.reportArtifacts.cerberus_review_input,
  ].join('\n');

  const hasHardBlock = traceCodes.length > 0
    || summary.outcome === 'blocked'
    || summary.outcome === 'failed';

  checks.push(check(
    'outcome_not_false_complete',
    !(summary.outcome === 'complete' && hasHardBlock),
    `outcome=${summary.outcome} trace_block_codes=${traceCodes.join(',') || 'none'}`,
  ));

  if (traceCodes.length && (summary.outcome === 'blocked' || summary.outcome === 'failed')) {
    const gateAligned = (summary.blocked_gates || []).some((g) =>
      traceCodes.some((tc) => g.includes(tc)),
    );
    const aligned = traceCodes.includes(rs.blocking_reason_code) || gateAligned;
    checks.push(check(
      'blocking_reason_matches_trace',
      aligned,
      `trace_codes=${traceCodes.join(',')} run_state=${rs.blocking_reason_code}`,
    ));
  } else {
    checks.push(check(
      'blocking_reason_matches_trace',
      true,
      'no trace blocking codes to align',
    ));
  }

  const costStatus = ctx.cost_token_summary?.run?.cost_status ?? 'unavailable';
  const inventsUsd = PRECISE_USD_PATTERN.test(surfaces.managementMd)
    || PRECISE_USD_PATTERN.test(surfaces.reportArtifacts.management_summary);
  const costHonest = !(inventsUsd && (costStatus === 'not_billing' || costStatus === 'unavailable'));
  checks.push(check(
    'management_cost_honest',
    costHonest,
    `cost_status=${costStatus}`,
  ));

  if (costStatus === 'not_billing' || costStatus === 'unavailable') {
    checks.push(check(
      'surfaces_mark_not_billing_or_unavailable',
      /not_billing|unavailable/i.test(allText),
      'cost disclaimer present in operator surfaces',
    ));
  } else {
    checks.push(check(
      'surfaces_mark_not_billing_or_unavailable',
      true,
      'cost status does not require not_billing disclaimer',
    ));
  }

  const forbiddenHit = findForbiddenClaim([
    surfaces.tuiText,
    surfaces.managementMd,
    surfaces.reportArtifacts.operator_report,
    surfaces.reportArtifacts.management_summary,
    surfaces.reportArtifacts.cerberus_review_input,
  ]);
  checks.push(check(
    'no_forbidden_claims',
    !forbiddenHit,
    forbiddenHit ? `matched ${forbiddenHit}` : 'no forbidden claim patterns',
  ));

  checks.push(check(
    'tui_status_matches_outcome',
    surfaces.tuiText.includes(`outcome:               ${summary.outcome}`)
      && surfaces.tuiText.includes(`status_label:          ${ctx.status_label}`),
    `status_label=${ctx.status_label} outcome=${summary.outcome}`,
  ));

  const confidence = deriveConfidenceLevel(summary, true);
  checks.push(check(
    'confidence_not_inflated_on_degraded',
    !(summary.outcome === 'degraded' && confidence === 'high'),
    `confidence=${confidence} outcome=${summary.outcome}`,
  ));

  const steering = evaluateSteeringHandlerPolicy({
    surface: 'tui',
    trace_loaded: true,
    outcome: summary.outcome,
    blocked: summary.outcome === 'blocked' || summary.outcome === 'failed',
    read_only: true,
    proposed_action: rs.next_safe_action,
    trace_ref: ctx.trace_file,
  });
  checks.push(check(
    'steering_policy_read_only',
    steering.allowed,
    steering.reason_code,
  ));

  const failures = checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`);
  return {
    schema_version: TRACE_BASED_EVAL_SCHEMA,
    ok: failures.length === 0,
    checks,
    failures,
  };
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @returns {{ schema_version: string, ok: boolean, checks: ReturnType<typeof check>[], failures: string[] }}
 */
function evaluateLoadedOperatorContext(ctx) {
  const surfaces = {
    tuiText: buildOperatorEvidenceTuiText(ctx),
    reportArtifacts: buildRunReportArtifacts(ctx),
    managementMd: buildAttachManagementSummaryMd(ctx, { inspectOk: true }),
  };
  return evaluateOperatorTraceSurfaces(ctx, surfaces);
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: false }>} ctx
 * @returns {{ schema_version: string, ok: boolean, checks: ReturnType<typeof check>[], failures: string[] }}
 */
function evaluateMissingTraceContext(ctx) {
  const checks = [
    check('missing_trace_not_found', ctx.reason_code === 'OPERATOR_TRACE_NOT_FOUND', ctx.reason_code),
    check('missing_trace_result_code', ctx.result_code === 'RUN_NOT_FOUND', ctx.result_code),
    check(
      'missing_trace_no_success_outcome',
      ctx.result_code !== 'RUN_FOUND',
      `result_code=${ctx.result_code}`,
    ),
  ];
  const steering = evaluateSteeringHandlerPolicy({
    surface: 'status',
    trace_loaded: false,
    proposed_action: 'advance to merge',
  });
  checks.push(check(
    'steering_fails_closed_without_trace',
    !steering.allowed && steering.reason_code === 'STEERING_TRACE_REQUIRED',
    steering.reason_code,
  ));
  const failures = checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`);
  return {
    schema_version: TRACE_BASED_EVAL_SCHEMA,
    ok: failures.length === 0,
    checks,
    failures,
  };
}

/**
 * @param {{
 *   filePath: string,
 *   loadContext?: typeof loadOperatorTraceContext,
 * }} opts
 * @returns {{ fixture: string, eval: ReturnType<typeof evaluateLoadedOperatorContext> | ReturnType<typeof evaluateMissingTraceContext> }}
 */
function runTraceBasedEvalFixture(opts) {
  const loadContext = opts.loadContext ?? loadOperatorTraceContext;
  const ctx = loadContext({ filePath: opts.filePath });
  const fixture = opts.filePath;
  if (ctx.ok) {
    return { fixture, eval: evaluateLoadedOperatorContext(ctx) };
  }
  return { fixture, eval: evaluateMissingTraceContext(ctx) };
}

module.exports = {
  TRACE_BASED_EVAL_SCHEMA,
  FORBIDDEN_CLAIM_PATTERNS,
  stripIgnoredClaimSections,
  findForbiddenClaim,
  collectTraceBlockingReasonCodes,
  evaluateOperatorTraceSurfaces,
  evaluateLoadedOperatorContext,
  evaluateMissingTraceContext,
  runTraceBasedEvalFixture,
};
