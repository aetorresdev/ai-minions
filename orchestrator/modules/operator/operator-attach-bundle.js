'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { loadOperatorTraceContext } = require('./operator-trace-command');

const ATTACH_BUNDLE_SCHEMA = '1';

/**
 * @param {string} taskId
 * @param {string} traceFile
 * @param {string} repoRoot
 * @param {{ existsSync?: typeof fs.existsSync, readFileSync?: typeof fs.readFileSync }} [fsOps]
 */
function loadAttachBundleContext(taskId, traceFile, repoRoot, fsOps = {}) {
  const existsSync = fsOps.existsSync ?? fs.existsSync;
  const readFileSync = fsOps.readFileSync ?? fs.readFileSync;
  return loadOperatorTraceContext({
    filePath: traceFile,
    repoRoot,
    existsSync,
    readFileSync,
  });
}

/**
 * @param {'high' | 'medium' | 'low'} level
 * @param {object} summary
 * @param {boolean} inspectOk
 * @returns {'high' | 'medium' | 'low'}
 */
function deriveConfidenceLevel(summary, inspectOk) {
  if (!inspectOk) return 'low';
  if (summary.degraded_mode?.active) return 'medium';
  if (summary.outcome === 'complete') return 'high';
  if (summary.outcome === 'blocked' || summary.outcome === 'failed') return 'medium';
  return 'low';
}

/**
 * @param {object} summary
 * @returns {string}
 */
function formatBudgetLine(summary) {
  const budget = summary.budget ?? {};
  if (typeof budget.tokens === 'number') {
    const cost = typeof budget.estimated_cost === 'number'
      ? ` · est. cost USD ${budget.estimated_cost} (${budget.confidence ?? 'estimate'})`
      : ' · cost: unavailable (not billing)';
    return `${budget.tokens} tokens${cost}`;
  }
  return 'unavailable (trace has no token totals)';
}

/**
 * @param {object} summary
 * @returns {string}
 */
function deriveBusinessImpact(summary) {
  switch (summary.outcome) {
    case 'complete':
      return 'Run finished; handoff to review or next workflow step may proceed with attached evidence.';
    case 'blocked':
      return 'Run stopped at a gate; merge or external beta promotion should wait until blockers are resolved.';
    case 'failed':
      return 'Run failed validation or execution; operator action required before retry or release claims.';
    case 'degraded':
      return 'Run completed in degraded mode; treat success claims as limited until gaps are reviewed.';
    default:
      return 'Outcome unclear from trace; treat as diagnostic-only until status/explain confirms state.';
  }
}

/**
 * @param {Extract<ReturnType<typeof loadAttachBundleContext>, { ok: true }>} ctx
 * @param {{ inspectOk: boolean, repoCommit?: string | null, bundleDir: string }} meta
 * @returns {string}
 */
function buildAttachSummaryMd(ctx, meta) {
  const { summary, run_state: rs } = ctx;
  return `# Run summary

- **Run ID:** \`${ctx.run_id}\`
- **Outcome:** ${summary.outcome}
- **Status label:** ${ctx.status_label}
- **Result code:** ${rs.result_code}
- **Current phase:** ${rs.current_phase ?? '-'}
- **Last successful phase:** ${rs.last_successful_phase ?? '-'}
- **Blocking reason:** ${rs.blocking_reason_code ?? '(none)'}
- **Inspect verdict:** ${meta.inspectOk ? 'PASS' : 'FAIL'}
- **Repo commit:** \`${meta.repoCommit ?? 'unknown'}\`
- **Bundle (local):** \`${meta.bundleDir}\`

## Next safe action

${rs.next_safe_action ?? summary.next_safe_action}

## Model (when traced)

- **Model:** ${rs.model ?? 'unavailable'}
- **Backend:** ${rs.model_backend ?? 'unavailable'}
- **Selection reason:** ${rs.selection_reason ?? 'unavailable'}

## Upload reminder

Attach \`privacy-scan.json\`, \`redaction-report.json\`, and files under \`shareable/\` or \`evidence/\` only. Do **not** upload raw local \`trace/\` copies.
`;
}

/**
 * @param {Extract<ReturnType<typeof loadAttachBundleContext>, { ok: true }>} ctx
 * @param {{ inspectChecks: { reason_code: string, status: string, message: string }[] }} meta
 * @returns {string}
 */
function buildAttachOperatorNotesMd(ctx, meta) {
  const { summary, run_state: rs } = ctx;
  const failed = meta.inspectChecks.filter((c) => c.status === 'fail');
  const blockerBullets = failed.length
    ? failed.map((c) => `- \`${c.reason_code}\` — ${c.message}`).join('\n')
    : '- (none — inspect passed)';

  const gates = summary.blocked_gates?.length
    ? summary.blocked_gates.map((g) => `- ${g}`).join('\n')
    : '- (none)';

  return `# Operator notes

## What happened

- Contract: ${summary.applicable_contract ?? '-'}
- Risk category: ${summary.risk_category ?? '-'}
- Cerberus verdict: ${summary.cerberus?.verdict ?? '-'}
- Degraded mode: ${summary.degraded_mode?.active ? 'yes' : 'no'}

## Blockers and gates

${blockerBullets}

### Blocked gates (trace)

${gates}

## Evidence paths (from run state)

${rs.evidence_paths?.length ? rs.evidence_paths.map((p) => `- \`${p}\``).join('\n') : '- (none listed)'}

## Privacy / attach

- **Attach available:** ${rs.attach_available}
- **Privacy notice:** ${rs.privacy_notice_status}

## Commands for follow-up

\`\`\`bash
ai-minions status --run-id ${ctx.run_id}
ai-minions explain --run-id ${ctx.run_id}
ai-minions evidence --run-id ${ctx.run_id}
\`\`\`
`;
}

/**
 * @param {Extract<ReturnType<typeof loadAttachBundleContext>, { ok: true }>} ctx
 * @param {{ inspectOk: boolean }} meta
 * @returns {string}
 */
function buildAttachManagementSummaryMd(ctx, meta) {
  const { summary, run_state: rs } = ctx;
  const confidence = deriveConfidenceLevel(summary, meta.inspectOk);
  const blocker = rs.blocking_reason_code
    ?? (summary.blocked_gates?.[0] ?? '(none)');

  return `# Management summary

| Field | Value |
|-------|-------|
| **Outcome** | ${summary.outcome} |
| **User-visible blocker** | ${blocker} |
| **Business impact** | ${deriveBusinessImpact(summary)} |
| **Cost / token estimate** | ${formatBudgetLine(summary)} |
| **Time / latency estimate** | unavailable in this slice *(per-step latency deferred to cost summary slice)* |
| **Recommended next action** | ${rs.next_safe_action ?? summary.next_safe_action} |
| **Confidence level** | ${confidence} |

## Not claimed

- Production-ready or fully autonomous operation
- Guaranteed privacy or sandbox isolation without reviewing \`redaction-report.json\`
- Billing-accurate cost (provider estimates only when present)
- Business ROI or productivity metrics
- Complete architecture or security audit coverage
`;
}

/**
 * @param {object} privacySummary
 * @param {string[]} shareableFiles
 * @param {Record<string, string>} checksums
 * @returns {object}
 */
function buildRedactionReportJson(privacySummary, shareableFiles, checksums) {
  return {
    schema_version: ATTACH_BUNDLE_SCHEMA,
    generated_at: new Date().toISOString(),
    privacy_scan: privacySummary,
    scanner_evidence: 'deterministic redaction via sensitive-data-scanner (see privacy-scan.json)',
    shareable_files: shareableFiles,
    checksums_sha256: checksums,
  };
}

/**
 * @param {string} bundleDir
 * @param {string[]} relativePaths
 * @returns {Record<string, string>}
 */
function computeBundleChecksums(bundleDir, relativePaths) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const rel of relativePaths) {
    const abs = path.join(bundleDir, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    out[rel] = hash;
  }
  return out;
}

/**
 * @param {string} srcDir
 * @param {string} destDir
 */
function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copyDirRecursive(src, dest);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}

/**
 * @param {{
 *   bundleDir: string,
 *   taskId: string,
 *   traceFile: string,
 *   repoRoot: string,
 *   inspectOk: boolean,
 *   inspectChecks: { reason_code: string, status: string, message: string }[],
 *   repoCommit?: string | null,
 *   privacySummary?: object | null,
 *   shareableFiles?: string[],
 *   fsOps?: { existsSync?: typeof fs.existsSync, readFileSync?: typeof fs.readFileSync },
 * }} input
 * @returns {{ files: string[], redaction_report_path: string, operator_context_ok: boolean }}
 */
function writeHumanReadableAttachArtifacts(input) {
  const {
    bundleDir,
    taskId,
    traceFile,
    repoRoot,
    inspectOk,
    inspectChecks,
    repoCommit,
    privacySummary,
    shareableFiles = [],
  } = input;

  const ctx = loadAttachBundleContext(taskId, traceFile, repoRoot, input.fsOps);
  /** @type {string[]} */
  const added = [];

  if (ctx.ok) {
    const summaryPath = path.join(bundleDir, 'SUMMARY.md');
    const notesPath = path.join(bundleDir, 'OPERATOR_NOTES.md');
    const mgmtPath = path.join(bundleDir, 'MANAGEMENT_SUMMARY.md');
    fs.writeFileSync(summaryPath, buildAttachSummaryMd(ctx, { inspectOk, repoCommit, bundleDir }), 'utf8');
    fs.writeFileSync(notesPath, buildAttachOperatorNotesMd(ctx, { inspectChecks }), 'utf8');
    fs.writeFileSync(mgmtPath, buildAttachManagementSummaryMd(ctx, { inspectOk }), 'utf8');
    added.push('SUMMARY.md', 'OPERATOR_NOTES.md', 'MANAGEMENT_SUMMARY.md');
  } else {
    const fallback = `# Run summary\n\nTrace context unavailable (\`${ctx.result_code ?? ctx.reason_code}\`).\n\n${ctx.next_safe_action ?? ''}\n`;
    fs.writeFileSync(path.join(bundleDir, 'SUMMARY.md'), fallback, 'utf8');
    added.push('SUMMARY.md');
  }

  const tracesDest = path.join(bundleDir, 'traces');
  copyDirRecursive(path.join(bundleDir, 'trace'), tracesDest);
  if (fs.existsSync(tracesDest)) added.push('traces/');

  const evidenceDest = path.join(bundleDir, 'evidence');
  fs.mkdirSync(evidenceDest, { recursive: true });
  const inspectSrc = path.join(bundleDir, 'inspect-report.json');
  if (fs.existsSync(inspectSrc)) {
    fs.copyFileSync(inspectSrc, path.join(evidenceDest, 'inspect-report.json'));
  }
  const privacySrc = path.join(bundleDir, 'privacy-scan.json');
  if (fs.existsSync(privacySrc)) {
    fs.copyFileSync(privacySrc, path.join(evidenceDest, 'privacy-scan.json'));
  }
  copyDirRecursive(path.join(bundleDir, 'shareable'), path.join(evidenceDest, 'shareable'));
  added.push('evidence/');

  const checksumTargets = [
    ...shareableFiles.filter((f) => f.startsWith('shareable/')),
    'privacy-scan.json',
    'SUMMARY.md',
    'OPERATOR_NOTES.md',
    'MANAGEMENT_SUMMARY.md',
    'evidence/inspect-report.json',
    'evidence/privacy-scan.json',
  ].filter((f, i, arr) => arr.indexOf(f) === i);

  const checksums = computeBundleChecksums(bundleDir, checksumTargets);
  const redactionReport = buildRedactionReportJson(
    privacySummary ?? { privacy_scan_status: 'unknown' },
    shareableFiles,
    checksums,
  );
  const redactionPath = path.join(bundleDir, 'redaction-report.json');
  fs.writeFileSync(redactionPath, `${JSON.stringify(redactionReport, null, 2)}\n`, 'utf8');
  added.push('redaction-report.json');

  return {
    files: added,
    redaction_report_path: 'redaction-report.json',
    operator_context_ok: ctx.ok === true,
    checksums,
  };
}

module.exports = {
  ATTACH_BUNDLE_SCHEMA,
  loadAttachBundleContext,
  buildAttachSummaryMd,
  buildAttachOperatorNotesMd,
  buildAttachManagementSummaryMd,
  buildRedactionReportJson,
  computeBundleChecksums,
  writeHumanReadableAttachArtifacts,
};
