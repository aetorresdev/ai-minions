/**
 * Beta cohort guard (v0.20 E20-6) — doc markers, performative-beta rules, record schema.
 */

import {
  lineNegatesClaim,
  stripCodeSpans,
  stripProhibitedWordingSection,
} from "./operator-doc-claims.mjs";

/** Fields required in rehearsal record cohort_guard block (schema v2+). */
export const COHORT_GUARD_RECORD_KEYS = [
  "required_before_external_cohort",
  "guard_script",
  "doc_chain_status",
  "performative_beta_guard",
  "guided_cli_validated",
  "issue_evidence_chain",
];

/** Guided CLI path markers — checklist must reference full v0.20 chain. */
export const GUIDED_PATH_CHECKLIST_MARKERS = [
  "ai-minions first-run",
  "ai-minions smoke",
  "ai-minions attach",
  "ai-minions doctor",
  "operator-feedback-issue",
  "beta-dry-run-sample-issue",
  "installed CLI primary",
];

/** Issue evidence chain docs that must exist. */
export const ISSUE_EVIDENCE_DOCS = [
  "docs/how-to/operator-feedback-issue.md",
  ".github/ISSUE_TEMPLATE/operator-feedback.yml",
  "docs/how-to/evidence/beta-dry-run-sample-issue.md",
];

/** Operator docs scanned for performative external-beta claims. */
export const PERFORMATIVE_BETA_SCAN_PATHS = [
  "README.md",
  "docs/how-to/beta-tester-guide.md",
  "docs/how-to/beta-known-limitations.md",
  "docs/how-to/beta-dry-run-checklist.md",
];

/** @type {{ re: RegExp, label: string }[]} */
export const PERFORMATIVE_BETA_FORBIDDEN = [
  { re: /external\s+(usability\s+)?beta\s+is\s+open/i, label: "external beta is open claim" },
  { re: /external\s+tester\s+cohort\s+is\s+open/i, label: "external cohort is open claim" },
  { re: /public\s+beta\s+cohort\s+(is\s+)?open/i, label: "public beta cohort open claim" },
  { re: /beta\s+cohort\s+has\s+launched/i, label: "beta cohort launched claim" },
  { re: /now\s+accepting\s+external\s+beta\s+testers/i, label: "accepting external beta testers claim" },
];

/**
 * @param {string} text
 * @param {string} fileRel
 * @param {(msg: string) => void} onFailure
 */
export function checkPerformativeBetaClaims(text, fileRel, onFailure) {
  const scrubbed = stripCodeSpans(stripProhibitedWordingSection(text));
  for (const line of scrubbed.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (lineNegatesClaim(trimmed)) continue;
    for (const { re, label } of PERFORMATIVE_BETA_FORBIDDEN) {
      if (re.test(trimmed)) {
        onFailure(`${fileRel}: performative-beta — ${label} (line: ${trimmed.slice(0, 120)}…)`);
      }
    }
  }
}

/**
 * Fail when a checklist required row scores npm run / cd orchestrator as primary path.
 *
 * @param {string} text
 * @param {string} fileRel
 * @param {(msg: string) => void} onFailure
 */
export function checkNoPrimaryDevPathInChecklist(text, fileRel, onFailure) {
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    if (!/\|\s*yes\s*\|/i.test(line)) continue;
    const lower = line.toLowerCase();
    if (lower.includes("optional") || lower.includes("fallback") || lower.includes("maintainer")) {
      continue;
    }
    if (/npm run ai-minions/.test(line)) {
      onFailure(`${fileRel}: required row uses npm run ai-minions as primary path`);
    }
    if (/cd orchestrator/.test(line) && !lower.includes("dev")) {
      onFailure(`${fileRel}: required row uses cd orchestrator as primary path`);
    }
  }
}
