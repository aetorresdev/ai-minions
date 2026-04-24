/**
 * Output contracts per agent role (validateOutput), DEV YAML normalizer, CERBERUS semantic helpers.
 * Consumed by agents.js (askAgent). sync: docs/orchestrator/agent-contract.md § Output contracts
 */

'use strict';

// ── Output contract validation (strict mode) ─────────────────────────────────
//
// Each role has a minimum output contract. If the output does not meet it,
// validateOutput() returns { valid: false, reason } — the caller throws.
// No silent retry. No auto-correction. Hard fail.
//
// sync: docs/orchestrator/agent-contract.md § Output contracts
// sync: CLAUDE.md § MODE protocol (role close checklist)
//
// Contracts:
//   orchestrator/plan   → JSON { steps: [{ agentId, task }] }
//   orchestrator/decide → JSON { done: bool, summary } or { done: false, corrections: [] }
//   dev-*               → mentions ≥1 file modified + ≥1 validation run
//   qa                  → ≥1 finding classified blocker|improvement|nice-to-have (token presence only)
//   cerberus            → same tokens + semantic floor + vacuous-blocker anchor when three-line template is used (sync: agent-contract.md § format vs quality)
//   owner / architect   → any non-empty output (free-form design/scope)
//   summarizer          → any non-empty output

const FINDING_RE    = /\b(blocker|improvement|nice-to-have)\b/i;

/**
 * Multi-word boilerplate substrings (length ≥ 12) — substring match OK.
 * Avoid short phrases like "looks good" that appear inside legitimate sentences.
 */
const CERBERUS_FILLER_SUBSTRINGS = [
  "code could be improved",
  "consider optimization",
  "could be improved",
  "nothing to flag",
  "nothing to report",
  "everything looks good",
  "looks good to me",
  "overall good",
  "no issues found",
  "no major issues",
  "may want to consider",
  "should be fine",
  "works as expected",
];

/** Entire field is just noise (exact match after trim + trailing dots). */
const CERBERUS_FILLER_EXACT = new Set([
  "lgtm",
  "looks good",
  "ok",
  "fine",
]);

function _normalizeFindingVal(s) {
  return String(s || "").trim().toLowerCase().replace(/[()]/g, "");
}

function _isVacuousFindingVal(val) {
  const n = _normalizeFindingVal(val);
  if (!n) return true;
  return ["none", "n/a", "na", "n.a.", "no", "...", "-"].includes(n);
}

function _cerberusLineHasFiller(val) {
  const t = String(val || "").trim().toLowerCase().replace(/\.+$/g, "");
  if (!t) return false;
  if (CERBERUS_FILLER_EXACT.has(t)) return true;
  return CERBERUS_FILLER_SUBSTRINGS.some((p) => t.includes(p));
}

/**
 * When blocker is vacuous, improvement/nice-to-have need a weak textual anchor (see _cerberusFindingHasAnchor).
 * (path, test ref, code span, HTTP/error-ish signal) — not proof the claim is true.
 * @param {string} s
 * @returns {boolean}
 */
function _cerberusFindingHasAnchor(s) {
  const t = String(s || "");
  if (!t.trim()) return false;
  const patterns = [
    /\b[\w./-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|tf|yaml|yml|json|md|html|css|java|kt|cs)\b/i,
    /\/[\w.-]+(?:\/[\w.-]+)+/,
    /`[^`\n]{2,}`/,
    /\b(?:unit|integration|e2e)\s+tests?\b/i,
    /\b(?:jest|mocha|pytest|vitest|cypress|playwright)\b/i,
    /\bnpm\s+test\b|\bterraform\s+validate\b|\bgo\s+test\b/i,
    /\btest\s*[(:]/i,
    /\bHTTP\s*\d{3}\b|\bstatus\s*(?:code)?\s*\d{3}\b/i,
    /\b(?:exception|stack\s*trace|throw|thrown|panic|segfault|oom)\b/i,
    /\b(?:race\s+condition|deadlock|data\s+race)\b/i,
    /\b(?:endpoint|route)\s+[`"']?\/[\w./-]+/i,
    /\bline\s+\d+\b/i,
    /\b[\w$]{3,}\([^)\n]{0,80}\)/,
  ];
  return patterns.some((re) => re.test(t));
}

/**
 * Parse leading `blocker:` / `improvement:` / `nice-to-have:` lines (markdown bullets ok).
 * @returns {{ blocker: string, improvement: string, nice: string } | null} null if not all three present
 */
function parseCerberusTripleTemplate(output) {
  const lines = String(output).split(/\r?\n/);
  const out = { blocker: null, improvement: null, nice: null };
  for (const line of lines) {
    const kb = line.match(/^[\s>*-]*blocker\s*:\s*(.*)$/i);
    if (kb && out.blocker === null) out.blocker = kb[1].trim();
    const ki = line.match(/^[\s>*-]*improvement\s*:\s*(.*)$/i);
    if (ki && out.improvement === null) out.improvement = ki[1].trim();
    const kn = line.match(/^[\s>*-]*nice-to-have\s*:\s*(.*)$/i);
    if (kn && out.nice === null) out.nice = kn[1].trim();
  }
  if (out.blocker !== null && out.improvement !== null && out.nice !== null) return out;
  return null;
}

/** Minimal semantic floor for CERBERUS when the three-line template is used. */
function validateCerberusSemanticFloor(output) {
  const t = parseCerberusTripleTemplate(output);
  if (!t) return { ok: true };

  // All three vacuous = explicit "no classified findings" — allowed so CERBERUS can finish
  // when upstream artifacts are already gate-blocked (E2E Sc15b); still passes FINDING_RE via keywords.
  if (_isVacuousFindingVal(t.blocker) && _isVacuousFindingVal(t.improvement) && _isVacuousFindingVal(t.nice)) {
    return { ok: true };
  }

  for (const [label, val] of [["blocker", t.blocker], ["improvement", t.improvement], ["nice-to-have", t.nice]]) {
    if (_cerberusLineHasFiller(val)) {
      return {
        ok: false,
        reason: `${label} reads as boilerplate filler — cite a concrete risk, path, or behavior`,
        gate_id: "cerberus_semantic_filler",
      };
    }
  }

  if (_isVacuousFindingVal(t.blocker)) {
    const hasImp = !_isVacuousFindingVal(t.improvement);
    const hasNice = !_isVacuousFindingVal(t.nice);
    if (!hasImp && !hasNice) {
      return {
        ok: false,
        reason: "vacuous blocker requires a non-empty improvement or nice-to-have line",
        gate_id: "cerberus_vacuous_without_substance",
      };
    }
    const impAnch = hasImp && _cerberusFindingHasAnchor(t.improvement);
    const niceAnch = hasNice && _cerberusFindingHasAnchor(t.nice);
    if (!impAnch && !niceAnch) {
      return {
        ok: false,
        reason:
          "vacuous blocker requires improvement or nice-to-have with an explicit anchor (file path, test/tool ref, `code`, line N, HTTP/status, error/race, or callable)",
        gate_id: "cerberus_anchor_required",
      };
    }
  }

  return { ok: true };
}
const VALIDATION_RE      = /\b(validation_run|ran|executed|tested|passed|failed|lint|pytest|npm\s+test|terraform\s+validate|node\s+|output:)\b/i;
const FILES_READ_RE      = /\bfiles?_read\s*[:-]?\s*(?:[[`'"\w]|\n\s*-)/i;
const FILES_READ_EMPTY_RE = /\bfiles?_read\s*[:-]?\s*(?:\[\s*]|:\s*\[\s*]|\s*\n(?!\s*-))/i;

/**
 * Small local models often wrap YAML in markdown fences or add a short preamble.
 * Normalize before validateOutput(dev-*) so the gate matches the same shape as cloud DEV.
 * @param {string} s
 */
function normalizeDevContractText(s) {
  let o = String(s || "").replace(/^\uFEFF/, "").trim();
  if (!o) return o;
  const fenced = /^```(?:yaml|yml)?\s*\r?\n([\s\S]*?)\r?\n```\s*/i.exec(o);
  if (fenced) o = fenced[1].trim();
  const lead = o.slice(0, 400);
  if (!/^\s*files_read\s*:/i.test(lead)) {
    const idx = o.search(/\bfiles_read\s*:/i);
    if (idx > 0) o = o.slice(idx).trimStart();
  }
  return o;
}
const FILES_MODIFIED_RE  = /(?:files?_modified|modified)\s*[:-]\s*\n((?:\s*-\s*\S[^\n]*\n?)+)/i;

/**
 * Validate agent output against its role contract.
 * @param {string} agentId
 * @param {string} output
 * @param {{ phase?: "plan"|"decide" }} options
 * @returns {{ valid: boolean, reason: string, gate_id?: string, context_stats?: object }}
 */
function validateOutput(agentId, output, { phase } = {}) {
  if (!output || !output.trim()) {
    return { valid: false, reason: `${agentId}: empty output`, gate_id: "empty_output" };
  }

  if (agentId === "orchestrator") {
    const raw = output.trim().replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");
    const json = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    if (!json) return { valid: false, reason: "orchestrator: output is not valid JSON", gate_id: "orchestrator_json" };

    if (phase === "decide") {
      if (typeof json.done !== "boolean")
        return { valid: false, reason: "orchestrator/decide: missing 'done' boolean field", gate_id: "orchestrator_decide_done" };
      if (json.done && !json.summary)
        return { valid: false, reason: "orchestrator/decide: done=true requires 'summary'", gate_id: "orchestrator_decide_summary" };
      if (!json.done && (!Array.isArray(json.corrections) || json.corrections.length === 0))
        return { valid: false, reason: "orchestrator/decide: done=false requires non-empty 'corrections[]'", gate_id: "orchestrator_decide_corrections" };
    } else {
      if (!Array.isArray(json.steps) || json.steps.length === 0)
        return { valid: false, reason: "orchestrator/plan: 'steps' must be a non-empty array", gate_id: "orchestrator_plan_steps" };
      for (const s of json.steps) {
        if (!s.agentId || !s.task)
          return { valid: false, reason: `orchestrator/plan: step missing agentId or task — ${JSON.stringify(s)}`, gate_id: "orchestrator_plan_step_fields" };
      }
    }
    return { valid: true, reason: "" };
  }

  if (agentId === "architect") {
    if (!FILES_READ_RE.test(output))
      return { valid: false, reason: `${agentId}: output must declare files_read[] before reading artifacts`, gate_id: "files_read_missing" };
    if (FILES_READ_EMPTY_RE.test(output))
      return { valid: false, reason: `${agentId}: files_read[] must not be empty — declare at least one file`, gate_id: "files_read_empty" };
    return { valid: true, reason: "", ...extractContextStats(agentId, output) };
  }

  if (agentId.startsWith("dev-")) {
    if (!FILES_READ_RE.test(output))
      return { valid: false, reason: `${agentId}: output must declare files_read[] before reading artifacts`, gate_id: "files_read_missing" };
    if (FILES_READ_EMPTY_RE.test(output))
      return { valid: false, reason: `${agentId}: files_read[] must not be empty — declare at least one file`, gate_id: "files_read_empty" };
    if (!VALIDATION_RE.test(output))
      return { valid: false, reason: `${agentId}: output must include at least one validation run (lint, test, terraform validate, etc.)`, gate_id: "validation_run_missing" };
    // files_modified is mandatory — absence is not allowed (would bypass the cross-check gate)
    const modifiedMatch = output.match(FILES_MODIFIED_RE);
    if (!modifiedMatch)
      return { valid: false, reason: `${agentId}: output must include a files_modified: list — absence bypasses the context gate`, gate_id: "files_modified_missing" };
    // Strict mode: every file in files_modified must appear in files_read
    const modified = modifiedMatch[1].split("\n")
      .map(l => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
    const readBlock = output.match(/\bfiles?_read\s*[:-][^\n]*\n?([\s\S]*?)(?=\n\S|\n\n|$)/i)?.[0] || "";
    const unread = modified.filter(f => !readBlock.includes(f));
    if (unread.length > 0)
      return { valid: false, reason: `${agentId}: files_modified contains paths not declared in files_read: ${unread.join(", ")}`, gate_id: "files_read_vs_modified" };
    return { valid: true, reason: "", ...extractContextStats(agentId, output) };
  }

  if (agentId === "qa") {
    if (!FINDING_RE.test(output))
      return { valid: false, reason: `${agentId}: output must classify at least one finding as blocker | improvement | nice-to-have`, gate_id: "finding_classification_missing" };
    return { valid: true, reason: "" };
  }

  if (agentId === "cerberus") {
    if (!FINDING_RE.test(output))
      return { valid: false, reason: `${agentId}: output must classify at least one finding as blocker | improvement | nice-to-have`, gate_id: "finding_classification_missing" };
    const sem = validateCerberusSemanticFloor(output);
    if (!sem.ok)
      return { valid: false, reason: sem.reason, gate_id: sem.gate_id };
    return { valid: true, reason: "" };
  }

  // owner, summarizer — any non-empty output passes
  return { valid: true, reason: "" };
}

/**
 * Extract context efficiency stats from agent output.
 * Parses files_read and files_modified counts for trace metrics.
 * @param {string} agentId
 * @param {string} output
 * @returns {{ context_stats: { files_read_count: number, files_modified_count: number } }}
 */
function extractContextStats(agentId, output) {
  const readMatch  = output.match(/\bfiles?_read\s*[:-][^\n]*\n((?:\s*-\s*\S[^\n]*\n?)*)/i);
  const modMatch   = output.match(FILES_MODIFIED_RE);
  const filesRead  = readMatch  ? readMatch[1].split("\n").map(l => l.trim()).filter(l => l.startsWith("-")).length : 0;
  const filesModified = modMatch ? modMatch[1].split("\n").map(l => l.trim()).filter(l => l.startsWith("-")).length : 0;
  return { context_stats: { files_read_count: filesRead, files_modified_count: filesModified } };
}


module.exports = {
  validateOutput,
  normalizeDevContractText,
  parseCerberusTripleTemplate,
  validateCerberusSemanticFloor,
  extractContextStats,
  cerberusFindingHasAnchor: _cerberusFindingHasAnchor,
};
