/**
 * Mode comparison report — summarize six-mode matrix evidence honestly.
 * Shared by generate-mode-comparison-report.mjs, verify-usage-docs, and tests.
 *
 * Consumes matrix row assessments + optional per-row evidence records.
 * Does not invent hybrid runtime, cross-mode scores, or fake tokens/cost.
 * READY is never promoted to PASS.
 * Hybrid rows stay skip (MATRIX_SKIP_HYBRID_UNSUPPORTED) — evidence cannot override.
 * PASS requires minimum execution evidence. String fields are privacy-sanitized.
 */

import { createRequire } from "node:module";
import { SIX_MODE_ROWS, REASON_CODES as MATRIX_REASON_CODES } from "./tester-six-mode-matrix-data.mjs";
import { FIXTURE_MATRIX_ROW_IDS } from "./canonical-real-task-fixtures-data.mjs";
import { SECRET_PATTERNS } from "./operator-doc-claims.mjs";

const require = createRequire(import.meta.url);
const { redactSensitivePlaintext } = require("../../orchestrator/modules/trace/trace-redact.js");

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

const HYBRID_SKIP_REASON = MATRIX_REASON_CODES.SKIP_HYBRID_UNSUPPORTED;

/** String fields scanned for secret-shaped values and sanitized before serialize. */
const EVIDENCE_STRING_FIELDS = Object.freeze([
  "command",
  "reason_code",
  "message",
  "selected_model",
  "selected_provider",
  "run_id",
  "task_id",
  "trace_path",
  "status_evidence",
  "attach_path",
  "tester_notes",
  "reviewer_checklist",
  "fixture_id",
]);

/**
 * @param {string} rowId
 * @returns {import("./tester-six-mode-matrix-data.mjs").MatrixRowDef | undefined}
 */
export function canonicalRowDef(rowId) {
  return SIX_MODE_ROWS.find((r) => r.id === rowId);
}

/**
 * @param {string} rowId
 * @returns {boolean}
 */
export function isHybridRowId(rowId) {
  return Boolean(canonicalRowDef(rowId)?.hybrid_honest_skip);
}

/**
 * Hybrid evidence cannot become PASS/READY — always honest skip.
 * @param {RowEvidenceInput} row
 * @returns {RowEvidenceInput}
 */
export function normalizeHybridEvidenceRow(row) {
  if (!isHybridRowId(row.row_id)) return row;
  const def = canonicalRowDef(row.row_id);
  return {
    ...row,
    result: "skip",
    reason_code: HYBRID_SKIP_REASON,
    agent_flow: def?.agent_flow ?? row.agent_flow ?? null,
    model_policy: def?.inference_mode ?? null,
  };
}

/**
 * agent_flow / inference (model_policy) come only from canonical row_id.
 * @param {RowEvidenceInput} row
 * @returns {RowEvidenceInput}
 */
export function applyCanonicalModeFields(row) {
  const def = canonicalRowDef(row.row_id);
  if (!def) return row;
  return {
    ...row,
    agent_flow: def.agent_flow,
    model_policy: def.inference_mode,
  };
}

/**
 * PASS requires artifact + identifiable run/task + status + attach evidence.
 * @param {RowEvidenceInput} row
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePassEvidenceMinimum(row) {
  /** @type {string[]} */
  const errors = [];
  const result = row.result != null ? normalizeRowResult(row.result) : null;
  if (result !== "pass") return { ok: true, errors };
  if (isHybridRowId(row.row_id)) {
    // Hybrid PASS is handled separately (normalize / reject).
    return { ok: true, errors };
  }
  const artifacts = Array.isArray(row.artifact_paths)
    ? row.artifact_paths.filter((p) => typeof p === "string" && p.trim() !== "")
    : [];
  if (artifacts.length === 0) {
    errors.push(
      `PASS for ${row.row_id} requires non-empty artifact_paths`,
    );
  }
  const runId = typeof row.run_id === "string" && row.run_id.trim() !== "";
  const taskId = typeof row.task_id === "string" && row.task_id.trim() !== "";
  if (!runId && !taskId) {
    errors.push(
      `PASS for ${row.row_id} requires run_id or task_id`,
    );
  }
  if (
    typeof row.status_evidence !== "string" ||
    row.status_evidence.trim() === ""
  ) {
    errors.push(
      `PASS for ${row.row_id} requires status_evidence`,
    );
  }
  if (
    row.attach_available !== undefined &&
    row.attach_available !== null &&
    typeof row.attach_available !== "boolean"
  ) {
    errors.push(
      `PASS for ${row.row_id} requires attach_available to be a boolean when set`,
    );
  }
  const attachPath =
    typeof row.attach_path === "string" && row.attach_path.trim() !== "";
  // Strict boolean: reject truthy non-booleans like "false" or 1.
  if (!attachPath && row.attach_available !== true) {
    errors.push(
      `PASS for ${row.row_id} requires attach_path or attach_available: true`,
    );
  }
  // When a fixture id is present, treat it as the applicable verifier label
  // (canonical fixture verify scripts consume artifact_paths + fixture_id).
  if (row.fixture_id != null && String(row.fixture_id).trim() === "") {
    errors.push(
      `PASS for ${row.row_id} has empty fixture_id — omit or set a real fixture id`,
    );
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function valueContainsSecretPattern(value) {
  if (value == null) return false;
  if (typeof value === "string") {
    return SECRET_PATTERNS.some(({ re }) => re.test(value));
  }
  if (Array.isArray(value)) {
    return value.some((v) => valueContainsSecretPattern(v));
  }
  if (typeof value === "object") {
    return Object.values(value).some((v) => valueContainsSecretPattern(v));
  }
  return false;
}

/**
 * Deep-sanitize JSON-like values with the shared trace privacy redactor.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function sanitizeComparisonValue(value, depth = 0) {
  if (depth > 32) return value;
  if (value == null) return value;
  if (typeof value === "string") return redactSensitivePlaintext(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeComparisonValue(v, depth + 1));
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = sanitizeComparisonValue(v, depth + 1);
  }
  return out;
}

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
    const result = r.result != null ? normalizeRowResult(r.result) : null;
    if (isHybridRowId(r.row_id) && (result === "pass" || result === "ready")) {
      errors.push(
        `hybrid row ${r.row_id} cannot be ${result} — must remain skip (${HYBRID_SKIP_REASON})`,
      );
    }
    const passCheck = validatePassEvidenceMinimum(r);
    if (!passCheck.ok) errors.push(...passCheck.errors);
    for (const field of EVIDENCE_STRING_FIELDS) {
      const v = /** @type {Record<string, unknown>} */ (r)[field];
      if (valueContainsSecretPattern(v)) {
        errors.push(
          `secret-shaped value in ${r.row_id}.${field} — redact before --from-evidence`,
        );
      }
    }
    if (valueContainsSecretPattern(r.artifact_paths)) {
      errors.push(
        `secret-shaped value in ${r.row_id}.artifact_paths — redact before --from-evidence`,
      );
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
    // Ignore evidence agent_flow / model_policy — canonical row_id wins.
    const ovSafe = { ...ov };
    delete ovSafe.agent_flow;
    delete ovSafe.model_policy;
    const merged = { ...base, ...ovSafe, row_id: ov.row_id };
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
    const normalized = normalizeHybridEvidenceRow(applyCanonicalModeFields(merged));
    byId.set(ov.row_id, normalized);
  }
  // Preserve canonical six-mode order
  return CANONICAL_ROW_IDS.map((id) => {
    const row = byId.get(id);
    const def = canonicalRowDef(id);
    if (row) {
      return normalizeHybridEvidenceRow(applyCanonicalModeFields(row));
    }
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
  const def = canonicalRowDef(row.row_id);
  const canonical = normalizeHybridEvidenceRow(applyCanonicalModeFields(row));
  let result = normalizeRowResult(canonical.result);
  let reasonCode = isHybridRowId(canonical.row_id)
    ? HYBRID_SKIP_REASON
    : canonical.reason_code || (result === "pass" ? "MATRIX_OK" : "");
  let message = canonical.message || "";
  // Central PASS gate: demote incomplete PASS even when callers skip validateEvidenceInput
  // (e.g. --from-matrix-json / direct buildComparisonReport).
  if (result === "pass" && !isHybridRowId(canonical.row_id)) {
    const passCheck = validatePassEvidenceMinimum({
      ...canonical,
      result: "pass",
    });
    if (!passCheck.ok) {
      result = "fail";
      reasonCode = REASON_CODES.ROW_FAIL;
      const detail = passCheck.errors.join("; ");
      message = message
        ? `${message}; PASS rejected: ${detail}`
        : `PASS rejected: ${detail}`;
    }
  }
  const attachPath =
    typeof canonical.attach_path === "string" &&
    canonical.attach_path.trim() !== "";
  /** @type {Record<string, unknown>} */
  const finalized = {
    row_id: canonical.row_id,
    agent_flow: def?.agent_flow ?? null,
    inference_mode: def?.inference_mode ?? null,
    title: def?.title ?? canonical.row_id,
    command: canonical.command ?? def?.command_template ?? "",
    result,
    reason_code: reasonCode,
    message,
    selected_model: canonical.selected_model ?? null,
    selected_provider: canonical.selected_provider ?? null,
    elapsed_ms:
      typeof canonical.elapsed_ms === "number" ? canonical.elapsed_ms : null,
    artifact_paths: Array.isArray(canonical.artifact_paths)
      ? canonical.artifact_paths
      : [],
    run_id: canonical.run_id ?? null,
    task_id: canonical.task_id ?? null,
    evidence: {
      trace_path: canonical.trace_path ?? null,
      status_evidence: canonical.status_evidence ?? null,
      attach_path: canonical.attach_path ?? null,
      attach_available: attachPath || canonical.attach_available === true,
    },
    tokens: normalizeMeasuredOrUnavailable(canonical.tokens),
    cost: normalizeMeasuredOrUnavailable(canonical.cost),
    fixture_id: canonical.fixture_id ?? null,
    tester_notes: canonical.tester_notes || "",
    reviewer_checklist: canonical.reviewer_checklist || "",
  };
  return /** @type {object} */ (sanitizeComparisonValue(finalized));
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
  const report = {
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
  return /** @type {typeof report} */ (sanitizeComparisonValue(report));
}

/**
 * @param {ReturnType<typeof buildComparisonReport>} report
 * @returns {string}
 */
export function formatComparisonMarkdown(report) {
  // Defense-in-depth: never serialize secret-shaped strings into Markdown.
  const safe = /** @type {typeof report} */ (sanitizeComparisonValue(report));
  const lines = [
    "# Mode comparison report",
    "",
    `Generated: \`${safe.generated_at}\``,
    safe.repo_commit ? `Commit: \`${safe.repo_commit}\`` : "Commit: _(not recorded)_",
    safe.fixture_id ? `Fixture: \`${safe.fixture_id}\`` : "Fixture: _(none / mixed)_",
    `Evidence class: \`${safe.evidence_class}\``,
    `Overall: **${safe.ok ? "OK (no FAIL rows)" : "HAS FAIL"}**`,
    "",
    "## Score vocabulary",
    "",
    "| Result | Meaning |",
    "| --- | --- |",
    `| PASS | ${safe.vocabulary.pass} |`,
    `| FAIL | ${safe.vocabulary.fail} |`,
    `| SKIP | ${safe.vocabulary.skip} |`,
    `| READY | ${safe.vocabulary.ready} |`,
    "",
    "**READY is not PASS.** Tokens/cost render as `unavailable` when not measured — never fake `0`. No invented cross-mode scores.",
    "",
    "## Counts",
    "",
    `| PASS | FAIL | SKIP | READY |`,
    `| --- | --- | --- | --- |`,
    `| ${safe.counts.pass} | ${safe.counts.fail} | ${safe.counts.skip} | ${safe.counts.ready} |`,
    "",
    "## Matrix rows",
    "",
    "| Agent mode | Inference mode | Result | Reason | Evidence |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const r of rowsForTable(safe)) {
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
  for (const r of safe.rows) {
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
