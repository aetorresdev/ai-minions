'use strict';

/**
 * ai-minions context/resume — trace-backed context package visibility + honest resume probe.
 * No duplicate SoT: context_disclosure / context_hygiene_signal from trace; resume via run_outcome_summary.
 */

const { loadOperatorTraceContext } = require('./operator-trace-command');
const { buildRunOutcomeSummary } = require('../trace/run-outcome-summary');
const { ansi } = require('./terminal-style');

const DISCLOSURE_ACTIONS = ['hidden', 'exposed', 'partial'];

const CONTEXT_PACKAGE_CONTRACT = 'docs/orchestrator/context-package-contract.md';
const SESSION_RESUME_CONTRACT = 'docs/orchestrator/session-resume-contract.md';

const RUN_RESUME_NOT_IMPLEMENTED = 'RUN_RESUME_NOT_IMPLEMENTED';

/** Honest probe banner when harness eligibility is true but product resume is not shipped. */
const ELIGIBLE_NOT_SUPPORTED_BANNER =
  'checkpoint_eligible=true only means trace/checkpoint evidence exists; product resume is not implemented';

const KNOWN_CONTEXT_LIMITATIONS = [
  'Trace disclosure events only — no runtime context package builder in product CLI',
  'Raw chat transcript is not authority; trace and governed contracts win',
  'mem0 / semantic memory injections are advisory-only per context-package-contract',
  'context_package_manifest export is design-only until runtime assembly ships',
];

/**
 * @param {string} action
 * @returns {'trusted'|'partial'|'excluded'}
 */
function deriveTrustClassification(action) {
  if (action === 'exposed') return 'trusted';
  if (action === 'partial') return 'partial';
  return 'excluded';
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function collectContextDisclosureRows(rows) {
  return rows.filter((r) => r && r.event === 'context_disclosure');
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function collectContextHygieneRows(rows) {
  return rows.filter((r) => r && r.event === 'context_hygiene_signal');
}

/**
 * @param {object[]} rows
 * @returns {number | null}
 */
function latestContextEventTs(rows) {
  let latest = null;
  for (const r of rows) {
    if (!r || typeof r.ts_ms !== 'number') continue;
    if (r.event !== 'context_disclosure' && r.event !== 'context_hygiene_signal') continue;
    if (latest == null || r.ts_ms > latest) latest = r.ts_ms;
  }
  return latest;
}

/**
 * @param {object[]} rows
 * @param {number | null} lastTs
 * @returns {{ marker: string, detail: string }}
 */
function deriveFreshnessMarker(rows, lastTs) {
  if (lastTs == null) {
    return {
      marker: 'no_context_events',
      detail: 'No context_disclosure or context_hygiene_signal rows in trace.',
    };
  }

  const sessionEnd = [...rows].reverse().find((r) => r && r.event === 'session_end');
  const sessionEndTs = sessionEnd && typeof sessionEnd.ts_ms === 'number' ? sessionEnd.ts_ms : null;
  const iso = new Date(lastTs).toISOString();

  if (sessionEndTs != null && lastTs <= sessionEndTs) {
    return {
      marker: 'trace_recorded_during_run',
      detail: `Last context signal @ ${iso} (before or at session_end).`,
    };
  }

  return {
    marker: 'trace_recorded',
    detail: `Last context signal @ ${iso}.`,
  };
}

/**
 * @param {object[]} rows
 * @returns {object}
 */
function buildContextPackageSummary(rows) {
  const disclosures = collectContextDisclosureRows(rows);
  const hygiene = collectContextHygieneRows(rows);
  const packageDisclosures = disclosures.filter((r) => r.surface === 'context_package');

  /** @type {Array<{ surface: string, action: string, trust: string, item_refs: string[], role_id: string | null, reason_code: string | null }>} */
  const items = [];

  for (const row of disclosures) {
    const action = DISCLOSURE_ACTIONS.includes(row.action) ? row.action : 'hidden';
    items.push({
      surface: String(row.surface ?? 'unknown'),
      action,
      trust: deriveTrustClassification(action),
      item_refs: Array.isArray(row.item_refs) ? row.item_refs.slice(0, 16) : [],
      role_id: typeof row.role_id === 'string' ? row.role_id : null,
      reason_code: typeof row.reason_code === 'string' ? row.reason_code : null,
    });
  }

  const packageRefs = [];
  for (const row of packageDisclosures) {
    if (!Array.isArray(row.item_refs)) continue;
    for (const ref of row.item_refs) {
      if (typeof ref === 'string' && ref.length && !packageRefs.includes(ref)) {
        packageRefs.push(ref);
      }
    }
  }

  const lastTs = latestContextEventTs(rows);
  const freshness = deriveFreshnessMarker(rows, lastTs);

  /** @type {string[]} */
  const limitations = [...KNOWN_CONTEXT_LIMITATIONS];
  if (!disclosures.length) {
    limitations.unshift('No context_disclosure events in trace — package refs unavailable');
  }

  return {
    context_package_refs: packageRefs,
    disclosure_items: items,
    hygiene_signals: hygiene.map((r) => ({
      signal_id: r.signal_id ?? null,
      severity: r.severity ?? null,
      suggestion: r.suggestion ?? null,
      agent: r.agent ?? null,
    })),
    freshness_marker: freshness.marker,
    freshness_detail: freshness.detail,
    limitations,
    contract_ref: CONTEXT_PACKAGE_CONTRACT,
  };
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {{ useColor?: boolean }} [options]
 * @returns {string}
 */
function formatOperatorContextText(ctx, options = {}) {
  const useColor = options.useColor === true;
  const summary = buildContextPackageSummary(ctx.rows);
  const lines = [
    ansi(useColor, '1', 'ai-minions context'),
    `  run_id:              ${ctx.run_id}`,
    `  trace_file:          ${ctx.trace_file}`,
    `  freshness:           ${summary.freshness_marker}`,
    `  freshness_detail:    ${summary.freshness_detail}`,
    `  package_refs:        ${summary.context_package_refs.length ? summary.context_package_refs.join(', ') : '(none recorded)'}`,
    '  limitations:',
    ...summary.limitations.map((l) => `    - ${l}`),
    `  next_safe_action:    ${ansi(useColor, '36', 'Inspect trace JSONL for context_disclosure; use explain for blockers — not raw transcript.')}`,
    '',
    '-- context package refs (surface=context_package) --',
  ];

  const pkgItems = summary.disclosure_items.filter((i) => i.surface === 'context_package');
  if (!pkgItems.length) {
    lines.push('  (no context_package disclosure rows)');
  } else {
    for (const item of pkgItems) {
      lines.push(`  [${item.trust}] role=${item.role_id ?? '-'} refs=${item.item_refs.join(', ') || '-'}`);
    }
  }

  lines.push('');
  lines.push('-- trust classification (all disclosure surfaces) --');
  if (!summary.disclosure_items.length) {
    lines.push('  (none)');
  } else {
    for (const item of summary.disclosure_items) {
      lines.push(`  ${item.surface}: ${item.action} → ${item.trust} (${item.item_refs.length} ref(s))`);
    }
  }

  if (summary.hygiene_signals.length) {
    lines.push('');
    lines.push('-- context hygiene signals --');
    for (const sig of summary.hygiene_signals.slice(0, 8)) {
      lines.push(`  [${sig.severity ?? '?'}] ${sig.signal_id ?? '?'} @ ${sig.agent ?? '-'}`);
    }
  }

  return lines.join('\n');
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 */
function buildOperatorContextJson(ctx) {
  const summary = buildContextPackageSummary(ctx.rows);
  return {
    command: 'context',
    run_id: ctx.run_id,
    trace_file: ctx.trace_file,
    context_package_refs: summary.context_package_refs,
    disclosure_items: summary.disclosure_items,
    hygiene_signals: summary.hygiene_signals,
    freshness_marker: summary.freshness_marker,
    freshness_detail: summary.freshness_detail,
    limitations: summary.limitations,
    contract_ref: summary.contract_ref,
    truncated: ctx.truncated,
    skipped_lines: ctx.skipped,
  };
}

/**
 * @param {{ runId?: string, filePath?: string, json?: boolean, useColor?: boolean, loadContext?: typeof loadOperatorTraceContext }} [options]
 */
function runOperatorContext(options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const useColor = options.useColor === true && options.json !== true;
  const ctx = loadContext({
    runId: options.runId,
    filePath: options.filePath,
  });

  if (!ctx.ok) {
    return {
      ok: false,
      exitCode: 2,
      reason_code: ctx.reason_code,
      next_safe_action: ctx.next_safe_action,
      text: [
        ansi(useColor, '1', 'ai-minions context'),
        `  reason_code:      ${ctx.reason_code}`,
        `  next_safe_action: ${ansi(useColor, '36', ctx.next_safe_action)}`,
      ].join('\n'),
      json: ctx,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    text: formatOperatorContextText(ctx, { useColor }),
    json: buildOperatorContextJson(ctx),
  };
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }> | null} ctx
 * @returns {string}
 */
function deriveResumeNextSafeAction(ctx) {
  if (ctx && ctx.run_id) {
    const id = ctx.run_id;
    return (
      `Run: ai-minions status --run-id ${id} then ai-minions attach --run-id ${id}; `
      + 'start a new run (ai-minions smoke / start) if continuing work — product resume is not implemented'
    );
  }
  return (
    'Provide a selector: ai-minions runs --limit 10 then ai-minions resume --run-id <id>, '
    + 'or start fresh with ai-minions smoke / ai-minions start'
  );
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }> | null} ctx
 */
function deriveResumeInspectAlternatives(ctx) {
  if (ctx && ctx.run_id) {
    const runId = ctx.run_id;
    return [
      `ai-minions status --run-id ${runId}`,
      `ai-minions attach --run-id ${runId}`,
      `ai-minions explain --run-id ${runId}`,
      'ai-minions smoke --model-policy local_only  # new run if continuing work',
    ];
  }
  return [
    'ai-minions runs --limit 10',
    'ai-minions resume --run-id <selected_run_id>',
    'ai-minions smoke --model-policy local_only',
    'ai-minions start --goal "…" --model-policy local_only',
  ];
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }> | null} ctx
 * @returns {{ eligible: boolean | null, block_codes: string[], summary: string | null }}
 */
function readResumeEvaluation(ctx) {
  if (!ctx) {
    return { eligible: null, block_codes: [], summary: null };
  }
  const ros = buildRunOutcomeSummary(ctx.rows, { trace_file: ctx.trace_file });
  const rs = ros.resume;
  return {
    eligible: rs?.eligible === true ? true : (rs?.eligible === false ? false : null),
    block_codes: Array.isArray(rs?.block_codes) ? rs.block_codes.map(String) : [],
    summary: typeof rs?.summary === 'string' ? rs.summary : null,
  };
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }> | null} ctx
 * @param {{ useColor?: boolean }} [options]
 * @returns {string}
 */
function formatOperatorResumeText(ctx, options = {}) {
  const useColor = options.useColor === true;
  const evaluation = readResumeEvaluation(ctx);
  const nextSafeAction = deriveResumeNextSafeAction(ctx);
  const lines = [
    ansi(useColor, '1', 'ai-minions resume'),
    `  supported:           ${ansi(useColor, '33', 'false')}`,
    `  reason_code:         ${ansi(useColor, '33', RUN_RESUME_NOT_IMPLEMENTED)}`,
    '  policy:              explicit_operator_resume_only (evaluate-only module exists; no product resume action)',
    `  contract_ref:        ${SESSION_RESUME_CONTRACT}`,
  ];

  if (ctx) {
    lines.push(`  run_id:              ${ctx.run_id}`);
    lines.push(`  trace_file:          ${ctx.trace_file}`);
    lines.push(`  checkpoint_eligible: ${evaluation.eligible ?? '(unknown)'}`);
    if (evaluation.eligible === true) {
      lines.push(`  eligibility_note:    ${ansi(useColor, '33', ELIGIBLE_NOT_SUPPORTED_BANNER)}`);
    }
    if (evaluation.block_codes.length) {
      lines.push(`  block_codes:         ${evaluation.block_codes.join(', ')}`);
    }
    if (evaluation.summary) {
      lines.push(`  evaluation_summary:  ${evaluation.summary}`);
    }
  } else {
    lines.push('  run_id:              (selector required: --run-id / --file, or pick via ai-minions runs)');
    lines.push('  trace_file:          (not provided)');
    lines.push('  checkpoint_eligible: (unknown — no selector)');
  }

  lines.push('  inspect_instead:');
  for (const alt of deriveResumeInspectAlternatives(ctx)) {
    lines.push(`    - ${alt}`);
  }
  lines.push(`  next_safe_action:    ${ansi(useColor, '36', nextSafeAction)}`);

  return lines.join('\n');
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }> | null} ctx
 */
function buildOperatorResumeJson(ctx) {
  /** @type {object | null} */
  let resumeSummary = null;
  if (ctx) {
    const ros = buildRunOutcomeSummary(ctx.rows, { trace_file: ctx.trace_file });
    resumeSummary = ros.resume ?? null;
  }
  const evaluation = readResumeEvaluation(ctx);
  const next_safe_action = deriveResumeNextSafeAction(ctx);

  /** @type {object} */
  const payload = {
    command: 'resume',
    supported: false,
    reason_code: RUN_RESUME_NOT_IMPLEMENTED,
    policy: 'explicit_operator_resume_only',
    contract_ref: SESSION_RESUME_CONTRACT,
    run_id: ctx?.run_id ?? null,
    trace_file: ctx?.trace_file ?? null,
    checkpoint_eligible: evaluation.eligible,
    resume_evaluation: resumeSummary,
    inspect_instead: deriveResumeInspectAlternatives(ctx),
    next_safe_action,
    truncated: ctx?.truncated ?? false,
    skipped_lines: ctx?.skipped ?? 0,
  };
  if (evaluation.eligible === true) {
    payload.eligibility_note = ELIGIBLE_NOT_SUPPORTED_BANNER;
  }
  return payload;
}

/**
 * @param {{ runId?: string, filePath?: string, json?: boolean, useColor?: boolean, loadContext?: typeof loadOperatorTraceContext }} [options]
 */
function runOperatorResume(options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const useColor = options.useColor === true && options.json !== true;
  const hasSelector = Boolean(
    (options.runId && String(options.runId).trim())
    || (options.filePath && String(options.filePath).trim()),
  );
  let ctx = null;

  if (hasSelector) {
    const loaded = loadContext({
      runId: options.runId,
      filePath: options.filePath,
    });
    if (loaded.ok) {
      ctx = loaded;
    } else if (loaded.reason_code === 'OPERATOR_TRACE_NOT_FOUND') {
      const nextSafeAction = (
        'Resume is not implemented. Trace was also not found; '
        + 'run ai-minions runs --limit 10 to pick a run, or start fresh with ai-minions smoke / start'
      );
      const json = {
        ...buildOperatorResumeJson(null),
        trace_reason_code: loaded.reason_code,
        trace_missing: true,
        selector_provided: true,
        next_safe_action: nextSafeAction,
      };

      return {
        ok: false,
        exitCode: 2,
        reason_code: RUN_RESUME_NOT_IMPLEMENTED,
        next_safe_action: nextSafeAction,
        text: [
          ansi(useColor, '1', 'ai-minions resume'),
          `  supported:           ${ansi(useColor, '33', 'false')}`,
          `  reason_code:         ${ansi(useColor, '33', RUN_RESUME_NOT_IMPLEMENTED)}`,
          `  trace_reason_code:   ${loaded.reason_code}`,
          '  checkpoint_eligible: (unknown — trace missing)',
          `  next_safe_action:    ${ansi(useColor, '36', nextSafeAction)}`,
        ].join('\n'),
        json,
      };
    }
  }

  const json = buildOperatorResumeJson(ctx);
  json.selector_provided = hasSelector;

  return {
    ok: false,
    exitCode: 2,
    reason_code: RUN_RESUME_NOT_IMPLEMENTED,
    next_safe_action: json.next_safe_action,
    text: formatOperatorResumeText(ctx, { useColor }),
    json,
  };
}

module.exports = {
  CONTEXT_PACKAGE_CONTRACT,
  SESSION_RESUME_CONTRACT,
  RUN_RESUME_NOT_IMPLEMENTED,
  ELIGIBLE_NOT_SUPPORTED_BANNER,
  KNOWN_CONTEXT_LIMITATIONS,
  deriveTrustClassification,
  buildContextPackageSummary,
  formatOperatorContextText,
  buildOperatorContextJson,
  runOperatorContext,
  deriveResumeNextSafeAction,
  deriveResumeInspectAlternatives,
  formatOperatorResumeText,
  buildOperatorResumeJson,
  runOperatorResume,
};
