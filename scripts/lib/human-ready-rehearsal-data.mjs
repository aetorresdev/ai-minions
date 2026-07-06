/**
 * Human-ready rehearsal (v0.19) — doc paths and ordering checks for evidence script.
 */

export const REHEARSAL_RECORD_PATH = "docs/how-to/evidence/human-ready-rehearsal-record.json";

/** Docs that must exist for v0.19 human-ready rehearsal chain. */
export const REHEARSAL_REQUIRED_DOCS = [
  "PRIVACY.md",
  "docs/how-to/human-ready-rehearsal-evidence.md",
  "docs/how-to/beta-dry-run-checklist.md",
  "docs/how-to/evidence/beta-dry-run-sample-issue.md",
  "docs/how-to/beta-tester-guide.md",
  "docs/how-to/operator-blockers-and-recovery.md",
  "docs/how-to/beta-claim-blast-radius.md",
];

/** Privacy notice must appear before bundle collector in these docs. */
export const PRIVACY_BEFORE_BUNDLE_CHECKS = [
  {
    rel: "docs/how-to/beta-tester-guide.md",
    privacy: "PRIVACY.md",
    before: "collect-run-report.mjs",
  },
  {
    rel: "docs/how-to/collect-run-report.md",
    privacy: "PRIVACY.md",
    before: "node scripts/collect-run-report.mjs",
  },
  {
    rel: "docs/how-to/beta-dry-run-checklist.md",
    privacy: "PRIVACY.md",
    before: "collect-run-report.mjs",
  },
];

/** Checklist must reference v0.19 human-ready primary path markers. */
export const CHECKLIST_HUMAN_READY_MARKERS = [
  "PRIVACY.md",
  "ai-minions first-run",
  "ai-minions smoke",
  "operator-blockers-and-recovery",
  "beta-claim-blast-radius",
];

/** Sample issue must document product CLI rehearsal path. */
export const SAMPLE_ISSUE_MARKERS = [
  "ai-minions smoke",
  "PRIVACY.md",
  "synthetic",
];

/** v0.20 installed CLI evidence fields in rehearsal record. */
export const INSTALLED_CLI_RECORD_KEYS = [
  "required_before_v0_20_beta",
  "evidence_class",
  "install_evidence_commit",
  "live_attestation_date",
  "operator_path_detail",
];
