/**
 * Mode comparison report — summarize six-mode matrix evidence honestly.
 * Shared by generate-mode-comparison-report.mjs, verify-usage-docs, and tests.
 *
 * Consumes matrix row assessments + optional per-row evidence records.
 * Does not invent hybrid runtime, cross-mode scores, or fake tokens/cost.
 * READY is never promoted to PASS.
 */

import { SIX_MODE_ROWS } from "./tester-six-mode-matrix-data.mjs";
import { FIXTURE_MATRIX_ROW_IDS } from "./canonical-real-task-fixtures-data.mjs";

/** @typedef {'pass' | 'fail' | 'skip' | 'ready'} ReportResult */
/** @typedef {'unavailable' | number} MeasuredOrUnavailable */

/**
 * @typedef {Object} RowEvidenceInput
 * @property {string} row_id
 * @property {ReportResult} [result]
 * @property {string} [reason_code]
 * @property {string} [command]
 * @property {string} [model_policy]
 * @property {string} [agent_flow]
 * @property {string|null} [selected_model]
 * @property {string|null} [selected_provider]
 * @property {number|null} [elapsed_ms]
 * @property {string[]} [artifact_paths]
 * @property {string|null} [run_id]
 * @property {string|null} [task_id]
 * @property {string|null} [trace_path]
 * @property {string|null} [status_evidence]
 * @property {string|null} [attach_path]
 * @property {boolean} [attach_available]
 * @property {MeasuredOrUnavailable|null} [tokens]
 * @property {MeasuredOrUnavailable|null} [cost]
 * @property {string} [tester_notes]
 * @property {string} [reviewer_checklist]
 * @property {string} [fixture_id]
 * @property {string} [message]
 */

export const REPORT_SCHEMA_VERSION = 1;

export const REASON_CODES = Object.freeze({
  OK: "COMPARE_OK",
  DOC_FAIL: "COMPARE_DOC_FAIL",
  INPUT_FAIL: "COMPARE_INPUT_FAIL",
  ROW_FAIL: "COMPARE_ROW_FAIL",
});

export const ALLOWED_RESULTS = Object.freeze(["pass", "fail", "skip", "ready"]);

/** Required markers in the mode comparison how-to. */
export const REPORT_DOC_REQUIRED_MARKERS = Object.freeze([
  { needle: "sa-local_only", label: "sa-local_only row id" },
  { needle: "sa-remote_ok", label: "sa-remote_ok row id" },
  { needle: "sa-hybrid", label: "sa-hybrid row id" },
  { needle: "ma-local_only", label: "ma-local_only row id" },
  { needle: "ma-remote_ok", label: "ma-remote_ok row id" },
  { needle: "ma-hybrid", label: "ma-hybrid row id" },
  { needle: "PASS", label: "pass vocabulary" },
  { needle: "FAIL", label: "fail vocabulary" },
  { needle: "SKIP", label: "skip vocabulary" },
  { needle: "READY", label: "ready vocabulary" },
  { needle: "READY is not PASS", label: "ready≠pass honesty" },
  { needle: "unavailable", label: "tokens/cost unavailable wording" },
  { needle: "never fake", label: "never fake zero tokens" },
  { needle: "MATRIX_SKIP_HYBRID_UNSUPPORTED", label: "hybrid skip reason" },
  { needle: "honest skip", label: "hybrid honest skip" },
  { needle: "any_provider", label: "credential sufficiency" },
  { needle: "never secret values", label: "no secret values" },
  { needle: "generate-mode-comparison-report.mjs", label: "report generator script" },
  { needle: "run-tester-six-mode-matrix.mjs", label: "matrix runner link" },
  { needle: "canonical-real-task-fixtures", label: "canonical fixtures link" },
  { needle: "tester-six-mode-matrix", label: "six-mode matrix link" },
  { needle: "PRIVACY.md", label: "privacy prerequisite" },
  { needle: "ai-minions attach", label: "attach evidence" },
  { needle: "ai-minions status", label: "status evidence" },
  { needle: "No invented cross-mode scores", label: "no fabricated scores" },
]);

const CANONICAL_ROW_IDS = Object.freeze(SIX_MODE_ROWS.map((r) => r.id));

/**
 * @param {unknown} value
 * @returns {MeasuredOrUnavailable}
 */
export function normalizeMeasuredOrUnavailable(value) {
  if (value === null || value === undefined || value === "") {
    return "unavailable";
  }
  if (value === "unavailable") return "unavailable";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  // Never coerce missing/unknown to 0
  return "unavailable";
}

/**
 * @param {unknown} result
 * @returns {result is ReportResult}
 */
export function isAllowedResult(result) {
  return typeof result === "string" && ALLOWED_RESULTS.includes(result);
}

/**
 * READY must never be rewritten as PASS.
 * @param {string} status
 * @returns {ReportResult}
 */
export function normalizeRowResult(status) {
  const s = String(status || "").toLowerCase();
  if (s === "pass") return "pass";
  if (s === "fail") return "fail";
  if (s === "ready") return "ready";
  return "skip";
}

/**
 * @param {string} docText
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateReportDoc(docText) {
  /** @type {string[]} */
  const errors = [];
  if (!docText || !String(docText).trim()) {
    return { ok: false, errors: ["comparison report doc empty or missing"] };
  }
  const text = String(docText);
  for (const { needle, label } of REPORT_DOC_REQUIRED_MARKERS) {
    if (!text.includes(needle)) {
      errors.push(`missing required marker: ${label} (${needle})`);
    }
  }
  for (const id of CANONICAL_ROW_IDS) {
    if (!text.includes(id)) {
      errors.push(`missing row id: ${id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {unknown} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateEvidenceInput(input) {
  /** @type {string[]} */
  const errors = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["evidence input must be an object"] };
  }
  const rows = /** @type {{ rows?: unknown }} */ (input).rows;
  if (!Array.isArray(rows)) {
    return { ok: false, errors: ["evidence input.rows must be an array"] };
  }
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      errors.push("each evidence row must be an object");
      continue;
    }
    const r = /** @type {RowEvidenceInput} */ (row);
    if (!r.row_id || typeof r.row_id !== "string") {
      errors.push("evidence row missing row_id");
      continue;
    }
    if (!CANONICAL_ROW_IDS.includes(r.row_id)) {
      errors.push(`unknown row_id: ${r.row_id}`);
    }
    if (seen.has(r.row_id)) {
      errors.push(`duplicate row_id: ${r.row_id}`);
    }
    seen.add(r.row_id);
    if (r.result != null && !isAllowedResult(r.result)) {
      errors.push(`invalid result for ${r.row_id}: ${String(r.result)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Map matrix assessment rows into comparison evidence seeds.
 * Does not invent PASS — only pass/fail/skip/ready from assessment.
 *
 * @param {Array<{
 *   id: string,
 *   status: string,
 *   reason_code: string,
 *   message?: string,
 *   command?: string,
 *   credential_requirement?: string,
 * }>} matrixRows
 * @param {{ fixture_id?: string|null, repo_commit?: string|null }} [meta]
 * @returns {RowEvidenceInput[]}
 */
export function evidenceFromMatrixRows(matrixRows, meta = {}) {
  const byId = new Map(SIX_MODE_ROWS.map((r) => [r.id, r]));
  return (matrixRows || []).map((row) => {
    const def = byId.get(row.id);
    return {
      row_id: row.id,
      result: normalizeRowResult(row.status),
      reason_code: row.reason_code,
      command: row.command ?? def?.command_template ?? "",
      model_policy: def?.inference_mode ?? null,
      agent_flow: def?.agent_flow ?? null,
      selected_model: null,
      selected_provider: null,
      elapsed_ms: null,
      artifact_paths: [],
      run_id: null,
      task_id: null,
      trace_path: null,
      status_evidence: null,
      attach_path: null,
      attach_available: false,
      tokens: "unavailable",
      cost: "unavailable",
      tester_notes: "",
      reviewer_checklist: "",
      fixture_id: meta.fixture_id ?? null,
      message: row.message ?? "",
    };
  });
}

/**
 * Merge explicit evidence over matrix seeds. Explicit result wins when present.
 * READY from matrix is never rewritten to PASS by merge alone.
 *
 * @param {RowEvidenceInput[]} seeds
 * @param {RowEvidenceInput[]} overrides
 * @returns {RowEvidenceInput[]}
 */
export function mergeEvidenceRows(seeds, overrides = []) {
  const byId = new Map(seeds.map((r) => [r.row_id, { ...r }]));
  for (const ov of overrides) {
    if (!ov?.row_id) continue;
    const base = byId.get(ov.row_id) || {
      row_id: ov.row_id,
      result: "skip",
      reason_code: "",
      tokens: "unavailable",
      cost: "unavailable",
      artifact_paths: [],
      attach_available: false,
    };
    const merged = { ...base, ...ov, row_id: ov.row_id };
    if (ov.result != null) {
      merged.result = normalizeRowResult(ov.result);
    }
    merged.tokens = normalizeMeasuredOrUnavailable(
      ov.tokens !== undefined ? ov.tokens : base.tokens,
    );
    merged.cost = normalizeMeasuredOrUnavailable(
      ov.cost !== undefined ? ov.cost : base.cost,
    );
    if (!Array.isArray(merged.artifact_paths)) {
      merged.artifact_paths = [];
    }
    byId.set(ov.row_id, merged);
  }
  // Preserve canonical six-mode order
  return CANONICAL_ROW_IDS.map((id) => {
    const row = byId.get(id);
    if (row) return row;
    const def = SIX_MODE_ROWS.find((r) => r.id === id);
    return {
      row_id: id,
      result: "skip",
      reason_code: "COMPARE_ROW_MISSING",
      command: def?.command_template ?? "",
      model_policy: def?.inference_mode ?? null,
      agent_flow: def?.agent_flow ?? null,
      selected_model: null,
      selected_provider: null,
      elapsed_ms: null,
      artifact_paths: [],
      run_id: null,
      task_id: null,
      trace_path: null,
      status_evidence: null,
      attach_path: null,
      attach_available: false,
      tokens: "unavailable",
      cost: "unavailable",
      tester_notes: "",
      reviewer_checklist: "",
      fixture_id: null,
      message: "row missing from evidence input",
    };
  });
}

/**
 * @param {RowEvidenceInput} row
 * @returns {object}
 */
function finalizeRow(row) {
  const def = SIX_MODE_ROWS.find((r) => r.id === row.row_id);
  const result = normalizeRowResult(row.result);
  return {
    row_id: row.row_id,
    agent_flow: row.agent_flow ?? def?.agent_flow ?? null,
    inference_mode: row.model_policy ?? def?.inference_mode ?? null,
    title: def?.title ?? row.row_id,
    command: row.command ?? def?.command_template ?? "",
    result,
    reason_code: row.reason_code || (result === "pass" ? "MATRIX_OK" : ""),
    message: row.message || "",
    selected_model: row.selected_model ?? null,
    selected_provider: row.selected_provider ?? null,
    elapsed_ms: typeof row.elapsed_ms === "number" ? row.elapsed_ms : null,
    artifact_paths: Array.isArray(row.artifact_paths) ? row.artifact_paths : [],
    run_id: row.run_id ?? null,
    task_id: row.task_id ?? null,
    evidence: {
      trace_path: row.trace_path ?? null,
      status_evidence: row.status_evidence ?? null,
      attach_path: row.attach_path ?? null,
      attach_available: Boolean(row.attach_available || row.attach_path),
    },
    tokens: normalizeMeasuredOrUnavailable(row.tokens),
    cost: normalizeMeasuredOrUnavailable(row.cost),
    fixture_id: row.fixture_id ?? null,
    tester_notes: row.tester_notes || "",
    reviewer_checklist: row.reviewer_checklist || "",
  };
}

/**
 * @param {{
 *   matrixRows?: Array<object>,
 *   evidenceRows?: RowEvidenceInput[],
 *   fixture_id?: string|null,
 *   repo_commit?: string|null,
 *   generated_at?: string|null,
 *   source?: string,
 * }} options
 */
export function buildComparisonReport(options = {}) {
  const seeds = evidenceFromMatrixRows(options.matrixRows || [], {
    fixture_id: options.fixture_id ?? null,
  });
  const merged = mergeEvidenceRows(seeds, options.evidenceRows || []);
  const rows = merged.map(finalizeRow);

  const counts = { pass: 0, fail: 0, skip: 0, ready: 0 };
  for (const r of rows) {
    counts[r.result] = (counts[r.result] || 0) + 1;
  }

  const ok = counts.fail === 0;
  return {
    schema_version: REPORT_SCHEMA_VERSION,
    ok,
    evidence_class: options.source || "matrix_comparison",
    generated_at: options.generated_at ?? new Date().toISOString(),
    repo_commit: options.repo_commit ?? null,
    fixture_id: options.fixture_id ?? null,
    fixture_matrix_row_ids: [...FIXTURE_MATRIX_ROW_IDS],
    vocabulary: {
      pass: "Executed and met acceptance for this row",
      fail: "Attempted and failed — keep existing reason codes",
      skip: "Not run — missing credentials/endpoints or unsupported configuration",
      ready:
        "Eligible for live execution — READY is not PASS (eligibility ≠ executed pass)",
    },
    honesty: {
      ready_is_not_pass: true,
      tokens_cost_unavailable_when_unmeasured: true,
      never_fake_zero_tokens_or_cost: true,
      no_invented_cross_mode_scores: true,
      hybrid_honest_skip: true,
      no_secret_values: true,
    },
    counts,
    rows,
  };
}

/**
 * @param {ReturnType<typeof buildComparisonReport>} report
 * @returns {string}
 */
export function formatComparisonMarkdown(report) {
  const lines = [
    "# Mode comparison report",
    "",
    `Generated: \`${report.generated_at}\``,
    report.repo_commit ? `Commit: \`${report.repo_commit}\`` : "Commit: _(not recorded)_",
    report.fixture_id ? `Fixture: \`${report.fixture_id}\`` : "Fixture: _(none / mixed)_",
    `Evidence class: \`${report.evidence_class}\``,
    `Overall: **${report.ok ? "OK (no FAIL rows)" : "HAS FAIL"}**`,
    "",
    "## Score vocabulary",
    "",
    "| Result | Meaning |",
    "| --- | --- |",
    `| PASS | ${report.vocabulary.pass} |`,
    `| FAIL | ${report.vocabulary.fail} |`,
    `| SKIP | ${report.vocabulary.skip} |`,
    `| READY | ${report.vocabulary.ready} |`,
    "",
    "**READY is not PASS.** Tokens/cost render as `unavailable` when not measured — never fake `0`. No invented cross-mode scores.",
    "",
    "## Counts",
    "",
    `| PASS | FAIL | SKIP | READY |`,
    `| --- | --- | --- | --- |`,
    `| ${report.counts.pass} | ${report.counts.fail} | ${report.counts.skip} | ${report.counts.ready} |`,
    "",
    "## Matrix rows",
    "",
    "| Agent mode | Inference mode | Result | Reason | Evidence |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const r of rowsForTable(report)) {
    const evidenceBits = [];
    if (r.evidence.trace_path) evidenceBits.push(`trace: \`${r.evidence.trace_path}\``);
    if (r.evidence.status_evidence) {
      evidenceBits.push(`status: \`${r.evidence.status_evidence}\``);
    }
    if (r.evidence.attach_available || r.evidence.attach_path) {
      evidenceBits.push(
        r.evidence.attach_path
          ? `attach: \`${r.evidence.attach_path}\``
          : "attach: available",
      );
    }
    if (evidenceBits.length === 0) evidenceBits.push("_none recorded_");
    lines.push(
      `| ${r.agent_flow} | ${r.inference_mode} | **${String(r.result).toUpperCase()}** | \`${r.reason_code || "—"}\` | ${evidenceBits.join("; ")} |`,
    );
  }

  lines.push("", "## Row detail", "");
  for (const r of report.rows) {
    lines.push(`### \`${r.row_id}\` — ${r.title}`);
    lines.push("");
    lines.push(`- **Result:** ${String(r.result).toUpperCase()}`);
    lines.push(`- **Reason code:** \`${r.reason_code || "—"}\``);
    if (r.message) lines.push(`- **Message:** ${r.message}`);
    lines.push(`- **Command:** \`${r.command}\``);
    lines.push(
      `- **Model / provider (safe):** model=\`${r.selected_model ?? "—"}\` provider=\`${r.selected_provider ?? "—"}\``,
    );
    lines.push(
      `- **Elapsed:** ${r.elapsed_ms != null ? `${r.elapsed_ms} ms` : "unavailable"}`,
    );
    lines.push(
      `- **Tokens:** ${formatMeasured(r.tokens)} · **Cost:** ${formatMeasured(r.cost)}`,
    );
    lines.push(
      `- **Artifacts:** ${
        r.artifact_paths.length
          ? r.artifact_paths.map((p) => `\`${p}\``).join(", ")
          : "_none_"
      }`,
    );
    lines.push(`- **run_id:** \`${r.run_id ?? "—"}\` · **task_id:** \`${r.task_id ?? "—"}\``);
    lines.push(
      `- **Trace:** \`${r.evidence.trace_path ?? "—"}\` · **Status:** \`${r.evidence.status_evidence ?? "—"}\` · **Attach:** \`${r.evidence.attach_path ?? (r.evidence.attach_available ? "available" : "—")}\``,
    );
    if (r.fixture_id) lines.push(`- **Fixture:** \`${r.fixture_id}\``);
    if (r.tester_notes) lines.push(`- **Tester notes:** ${r.tester_notes}`);
    if (r.reviewer_checklist) {
      lines.push(`- **Reviewer checklist:** ${r.reviewer_checklist}`);
    }
    lines.push("");
  }

  lines.push("## Honesty constraints");
  lines.push("");
  lines.push("- READY is not PASS (eligibility ≠ executed pass).");
  lines.push("- Hybrid rows remain honest skip when unsupported (`MATRIX_SKIP_HYBRID_UNSUPPORTED`).");
  lines.push("- Tokens/cost are `unavailable` when not measured — never fake `0`.");
  lines.push("- No invented cross-mode scores or subjective LLM ranking.");
  lines.push("- Report contains **never secret values** — status/names only for credentials.");
  lines.push("- Preserve existing matrix / inspect / bundle reason codes; do not invent product codes unnecessarily.");
  lines.push("");

  return lines.join("\n");
}

/**
 * @param {ReturnType<typeof buildComparisonReport>} report
 */
function rowsForTable(report) {
  return report.rows;
}

/**
 * @param {MeasuredOrUnavailable} value
 */
function formatMeasured(value) {
  if (value === "unavailable") return "`unavailable`";
  return String(value);
}

/**
 * Empty evidence template for testers (all six rows, skip placeholders).
 * @returns {object}
 */
export function emptyEvidenceTemplate() {
  return {
    schema_version: REPORT_SCHEMA_VERSION,
    fixture_id: "sudoku-html-app",
    repo_commit: null,
    notes:
      "Fill result/reason_code/evidence after live runs. Leave tokens/cost null → renders unavailable. Do not invent PASS for hybrid or READY rows.",
    rows: CANONICAL_ROW_IDS.map((id) => {
      const def = SIX_MODE_ROWS.find((r) => r.id === id);
      return {
        row_id: id,
        result: def?.hybrid_honest_skip ? "skip" : null,
        reason_code: def?.hybrid_honest_skip
          ? "MATRIX_SKIP_HYBRID_UNSUPPORTED"
          : null,
        command: def?.command_template ?? "",
        model_policy: def?.inference_mode ?? null,
        agent_flow: def?.agent_flow ?? null,
        selected_model: null,
        selected_provider: null,
        elapsed_ms: null,
        artifact_paths: [],
        run_id: null,
        task_id: null,
        trace_path: null,
        status_evidence: null,
        attach_path: null,
        attach_available: false,
        tokens: null,
        cost: null,
        tester_notes: "",
        reviewer_checklist: "",
        fixture_id: "sudoku-html-app",
      };
    }),
  };
}
