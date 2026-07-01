#!/usr/bin/env node
/**
 * Deterministic checks for operator usage documentation (no LLM).
 * See docs/how-to/usage-smoke-guide.md and .github/workflows/docs-usage-verify.yml.
 *
 * Usage: node scripts/verify-usage-docs.mjs
 * Exit 0 = pass, 1 = failures (messages on stderr).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkForbiddenClaims,
  mustNotHaveBacklogCaseIds,
} from "./lib/operator-doc-claims.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CANONICAL_GUIDE = path.join(REPO_ROOT, "docs/how-to/usage-smoke-guide.md");
const TUI_CHECKLIST = path.join(REPO_ROOT, "docs/how-to/tui-manual-smoke-checklist.md");
const GHA_DOC_SPIKE = path.join(REPO_ROOT, "docs/how-to/claude-gha-doc-smoke-spike.md");
const SLASH_COMMANDS = path.join(REPO_ROOT, "docs/how-to/operator-slash-commands.md");
const TOKEN_HYGIENE = path.join(REPO_ROOT, "docs/orchestrator/token-hygiene-guide.md");
const CONTEXT_HYGIENE = path.join(REPO_ROOT, "docs/orchestrator/context-hygiene-signals.md");
const HARNESS_CHECKPOINTS = path.join(REPO_ROOT, "docs/how-to/harness-health-checkpoints.md");
const BOOTSTRAP_PREFLIGHT = path.join(REPO_ROOT, "docs/how-to/bootstrap-preflight.md");
const BOOTSTRAP_SCRIPT = path.join(REPO_ROOT, "scripts/bootstrap-preflight.mjs");
const OPERATOR_PREFLIGHT_SCRIPT = path.join(REPO_ROOT, "scripts/operator-preflight.mjs");
const OPERATOR_PREFLIGHT_BRIDGE = path.join(REPO_ROOT, "docs/how-to/operator-preflight-bridge.md");
const OPERATOR_GUIDED_RUN = path.join(REPO_ROOT, "docs/how-to/operator-guided-run.md");
const INSPECT_RUN_EVIDENCE = path.join(REPO_ROOT, "docs/how-to/inspect-run-evidence.md");
const INSPECT_RUN_SCRIPT = path.join(REPO_ROOT, "scripts/inspect-run-evidence.mjs");
const COLLECT_RUN_REPORT = path.join(REPO_ROOT, "docs/how-to/collect-run-report.md");
const BETA_KNOWN_LIMITATIONS = path.join(REPO_ROOT, "docs/how-to/beta-known-limitations.md");
const BETA_TESTER_GUIDE = path.join(REPO_ROOT, "docs/how-to/beta-tester-guide.md");
const BETA_DRY_RUN_CHECKLIST = path.join(REPO_ROOT, "docs/how-to/beta-dry-run-checklist.md");
const BETA_DRY_RUN_SAMPLE_ISSUE = path.join(
  REPO_ROOT,
  "docs/how-to/evidence/beta-dry-run-sample-issue.md",
);
const OPERATOR_FEEDBACK_ISSUE = path.join(REPO_ROOT, "docs/how-to/operator-feedback-issue.md");
const OPERATOR_FEEDBACK_TEMPLATE = path.join(
  REPO_ROOT,
  ".github/ISSUE_TEMPLATE/operator-feedback.yml",
);
const COLLECT_RUN_SCRIPT = path.join(REPO_ROOT, "scripts/collect-run-report.mjs");
const PRIMARY_SMOKE = path.join(REPO_ROOT, "docs/how-to/primary-smoke.md");
const PRIMARY_SMOKE_SCRIPT = path.join(REPO_ROOT, "scripts/run-primary-smoke.mjs");
const FRESH_CLONE_EVIDENCE = path.join(REPO_ROOT, "docs/how-to/fresh-clone-evidence.md");
const INSTALL_EVIDENCE = path.join(REPO_ROOT, "docs/how-to/install-evidence.md");
const INSTALL_EVIDENCE_SCRIPT = path.join(REPO_ROOT, "scripts/run-install-evidence.mjs");
const BETA_SMOKE_MATRIX = path.join(REPO_ROOT, "docs/how-to/beta-smoke-matrix.md");
const BETA_SMOKE_MATRIX_RECORD = path.join(
  REPO_ROOT,
  "docs/how-to/evidence/beta-smoke-matrix-record.json",
);
const BETA_SMOKE_MATRIX_SCRIPT = path.join(REPO_ROOT, "scripts/run-beta-smoke-matrix.mjs");
const BETA_DEGRADED_POLICY = path.join(REPO_ROOT, "docs/how-to/beta-degraded-mode-policy.md");
const BETA_LIMITATIONS_ONBOARDING_CONTRACT = path.join(
  REPO_ROOT,
  "docs/orchestrator/beta-limitations-onboarding-contract.md",
);
const BETA_GATE_HARDENING_EVIDENCE = path.join(
  REPO_ROOT,
  "docs/how-to/beta-gate-hardening-evidence.md",
);
const BETA_GATE_HARDENING_VERIFY_CONTRACT = path.join(
  REPO_ROOT,
  "docs/orchestrator/beta-gate-hardening-verify-contract.md",
);
const BETA_GATE_HARDENING_EVIDENCE_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/run-beta-gate-hardening-evidence.mjs",
);
const MODULAR_CLOSEOUT_EVIDENCE = path.join(
  REPO_ROOT,
  "docs/how-to/modular-closeout-evidence.md",
);
const MODULAR_CLOSEOUT_VERIFY_CONTRACT = path.join(
  REPO_ROOT,
  "docs/orchestrator/modular-closeout-evidence-contract.md",
);
const MODULAR_CLOSEOUT_EVIDENCE_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/run-modular-closeout-evidence.mjs",
);
const DEGRADED_MODE_EVIDENCE = path.join(REPO_ROOT, "scripts/lib/degraded-mode-evidence.mjs");
const CLAIM_AUDIT_SCRIPT = path.join(REPO_ROOT, "scripts/audit-product-claims.mjs");
const EVIDENCE_SCRIPT = path.join(REPO_ROOT, "scripts/run-fresh-clone-evidence.mjs");
const README = path.join(REPO_ROOT, "README.md");

/** @type {string[]} */
const failures = [];

function fail(msg) {
  failures.push(msg);
}

function checkForbiddenClaimsForDoc(text, fileRel) {
  checkForbiddenClaims(text, fileRel, fail);
}

function mustNotHaveBacklogCaseIdsForDoc(text, fileRel) {
  mustNotHaveBacklogCaseIds(text, fileRel, fail);
}

function readUtf8(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing file: ${path.relative(REPO_ROOT, filePath)}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function mustInclude(text, needle, label, fileRel) {
  if (!text.includes(needle)) {
    fail(`${fileRel}: missing required content — ${label} (expected substring: ${JSON.stringify(needle)})`);
  }
}

function mustNotMatch(text, pattern, label, fileRel) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  if (re.test(text)) {
    fail(`${fileRel}: forbidden content — ${label} (matched ${re})`);
  }
}

function checkGuide(guideText) {
  const rel = "docs/how-to/usage-smoke-guide.md";
  mustInclude(guideText, "## Happy path", "end-to-end runbook section", rel);
  mustInclude(guideText, "## Troubleshooting", "troubleshooting section", rel);
  mustInclude(guideText, "MODE: ORCHESTRATOR", "canonical MODE header", rel);
  mustInclude(guideText, "FLOW: single_agent", "single_agent flow", rel);
  mustInclude(guideText, "FLOW: multi_agent", "multi_agent flow", rel);
  mustInclude(guideText, "GOAL:", "GOAL field", rel);
  mustInclude(guideText, "MAX_ITERATIONS", "MAX_ITERATIONS field", rel);
  mustInclude(guideText, "CWD:", "CWD field", rel);
  mustInclude(guideText, "ENVIRONMENT:", "ENVIRONMENT example block", rel);
  mustInclude(guideText, ".env", ".env layer mention", rel);
  mustInclude(guideText, "does not grant permission", ".env vs permission rule", rel);
  mustInclude(guideText, "do **not** inherit", "no credential inheritance rule", rel);
  mustInclude(guideText, "environment-access.md", "link to environment contract", rel);
  mustInclude(guideText, "run-orchestrator.js", "CLI runner reference", rel);
  mustInclude(guideText, "tui-manual-smoke-checklist.md", "TUI checklist link", rel);
  mustInclude(guideText, "claude-gha-doc-smoke-spike.md", "optional GHA doc spike link", rel);
  mustInclude(guideText, "operator-slash-commands.md", "slash command alias link", rel);
  mustInclude(guideText, "bootstrap-preflight.md", "bootstrap preflight link", rel);
  mustInclude(guideText, "primary-smoke.md", "primary smoke link", rel);
  mustInclude(guideText, "run-primary-smoke.mjs", "primary smoke script reference", rel);
  mustInclude(guideText, "fresh-clone-evidence.md", "fresh-clone evidence link", rel);

  checkForbiddenClaimsForDoc(guideText, rel);
  mustNotHaveBacklogCaseIdsForDoc(guideText, rel);
}

function checkContextHygieneDoc(docText) {
  const rel = "docs/orchestrator/context-hygiene-signals.md";
  if (!docText) return;
  mustInclude(docText, "context_hygiene_signal", "trace event name", rel);
  mustInclude(docText, "context_growth_rate", "growth rate signal", rel);
  mustInclude(docText, "compaction_recommended", "compaction signal", rel);
  mustInclude(docText, "Observability only", "no enforcement disclaimer", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkBootstrapPreflightDoc(docText) {
  const rel = "docs/how-to/bootstrap-preflight.md";
  if (!docText) return;
  mustInclude(docText, "PREFLIGHT_REPO_LAYOUT", "repo layout reason code", rel);
  mustInclude(docText, "PREFLIGHT_TRACE_DIR_NOT_WRITABLE", "trace dir reason code", rel);
  mustInclude(docText, "bootstrap-preflight.mjs", "bootstrap script reference", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkOperatorPreflightBridgeDoc(docText) {
  const rel = "docs/how-to/operator-preflight-bridge.md";
  if (!docText) return;
  mustInclude(docText, "PREFLIGHT_", "bootstrap reason code family", rel);
  mustInclude(docText, "OPERATOR_", "operator reason code family", rel);
  mustInclude(docText, "operator-preflight.mjs", "bridge script reference", rel);
  mustInclude(docText, "rename or replace", "PREFLIGHT preservation note", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkCollectRunReportDoc(docText) {
  const rel = "docs/how-to/collect-run-report.md";
  if (!docText) return;
  mustInclude(docText, "BUNDLE_", "bundle reason code family", rel);
  mustInclude(docText, "collect-run-report.mjs", "collect script reference", rel);
  mustInclude(docText, "operator-feedback-issue", "issue form guide link", rel);
  mustInclude(docText, "ATTACH.md", "attach field alignment", rel);
  mustInclude(docText, "manifest.json", "bundle manifest", rel);
  mustInclude(docText, "degraded_mode", "degraded mode field", rel);
  mustInclude(docText, "risk_acceptance_reason", "risk acceptance field", rel);
  mustInclude(docText, "inspect-run-evidence", "inspect chain link", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkInspectRunEvidenceDoc(docText) {
  const rel = "docs/how-to/inspect-run-evidence.md";
  if (!docText) return;
  mustInclude(docText, "INSPECT_", "inspect reason code family", rel);
  mustInclude(docText, "inspect-run-evidence.mjs", "inspect script reference", rel);
  mustInclude(docText, "runner:tui", "runner tui panels", rel);
  mustInclude(docText, "explain-run", "explain-run step", rel);
  mustInclude(docText, "degraded_assessment", "degraded assessment output", rel);
  mustInclude(docText, "INSPECT_DEGRADED_", "degraded inspect codes", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkOperatorGuidedRunDoc(docText) {
  const rel = "docs/how-to/operator-guided-run.md";
  if (!docText) return;
  mustInclude(docText, "runner:tui", "runner tui reference", rel);
  mustInclude(docText, "bootstrap-preflight", "bootstrap delegation link", rel);
  mustInclude(docText, "--help", "help discovery", rel);
  mustInclude(docText, "operator-slash-commands", "slash discoverability", rel);
  mustInclude(docText, "/operator-preflight", "operator-preflight slash alias", rel);
  mustInclude(docText, "inspect-run-evidence", "inspect evidence link", rel);
  mustInclude(docText, "collect-run-report", "collect report link", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkOperatorFeedbackIssueDoc(docText) {
  const rel = "docs/how-to/operator-feedback-issue.md";
  if (!docText) return;
  mustInclude(docText, "operator-feedback.yml", "issue template file reference", rel);
  mustInclude(docText, "collect-run-report", "bundle collector link", rel);
  mustInclude(docText, "collect-run-report.mjs", "attach generator script", rel);
  mustInclude(docText, "ATTACH.md", "attach skeleton reference", rel);
  mustInclude(docText, "beta-tester-guide", "beta tester guide link", rel);
  mustInclude(docText, "privacy-sanitize-gate-contract", "privacy gate link", rel);
  mustInclude(docText, "PRIVACY_*", "privacy reason codes", rel);
  mustInclude(docText, "Redaction", "redaction policy link", rel);
  mustInclude(docText, "INSPECT_*", "inspect reason codes", rel);
  mustInclude(docText, "BLOCKER", "severity guide", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkOperatorFeedbackTemplate(templateText) {
  const rel = ".github/ISSUE_TEMPLATE/operator-feedback.yml";
  if (!templateText) return;
  mustInclude(templateText, "task_id", "task id field", rel);
  mustInclude(templateText, "inspect_blockers", "inspect blockers field", rel);
  mustInclude(templateText, "severity", "severity field", rel);
  mustInclude(templateText, "operator_path", "operator path field", rel);
  mustInclude(templateText, "beta-known-limitations", "limitations doc link", rel);
}

function checkBetaKnownLimitationsDoc(docText) {
  const rel = "docs/how-to/beta-known-limitations.md";
  if (!docText) return;
  mustInclude(docText, "CLI MVP", "runner tui CLI MVP wording", rel);
  mustInclude(docText, "Not claimed", "not claimed section", rel);
  mustInclude(docText, "operator-guided-run", "operator guided run link", rel);
  mustInclude(docText, "collect-run-report", "collect report link", rel);
  mustInclude(docText, "PREFLIGHT_*", "preflight layer", rel);
  mustInclude(docText, "OPERATOR_*", "operator layer", rel);
  mustInclude(docText, "BUNDLE_*", "bundle layer", rel);
  mustInclude(docText, "operator-feedback-issue", "feedback issue doc link", rel);
  mustInclude(docText, "beta-tester-guide", "beta tester guide link", rel);
  mustInclude(docText, "beta-dry-run-checklist", "dry-run checklist link", rel);
  mustInclude(docText, "beta-smoke-matrix", "smoke matrix link", rel);
  mustInclude(docText, "beta-degraded-mode-policy", "degraded policy link", rel);
  mustInclude(docText, "beta-limitations-onboarding-contract", "onboarding contract link", rel);
  mustInclude(docText, "Redaction policy", "redaction policy section", rel);
  mustInclude(docText, "trace-privacy-contract", "trace privacy contract link", rel);
  mustInclude(docText, "privacy-sanitize-gate-contract", "privacy gate contract link", rel);
  mustInclude(docText, "PRIVACY_*", "privacy reason codes", rel);
  mustInclude(docText, "v0.15 trust gates", "gate hardening section", rel);
  mustInclude(docText, "audit-product-claims.mjs", "claim audit reference", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkBetaTesterGuideDoc(docText) {
  const rel = "docs/how-to/beta-tester-guide.md";
  if (!docText) return;
  mustInclude(docText, "beta-known-limitations", "limitations prerequisite link", rel);
  mustInclude(docText, "bootstrap-preflight", "entry path link", rel);
  mustInclude(docText, "operator-guided-run", "operator path link", rel);
  mustInclude(docText, "operator-feedback-issue", "feedback issue link", rel);
  mustInclude(docText, "collect-run-report.mjs", "bundle collector script", rel);
  mustInclude(docText, "inspect-run-evidence.mjs", "inspect script", rel);
  mustInclude(docText, "ATTACH.md", "attach skeleton reference", rel);
  mustInclude(docText, "runner:tui", "runner tui commands", rel);
  mustInclude(docText, "Not claimed", "not claimed section", rel);
  mustInclude(docText, "internal", "internal dry-run audience", rel);
  mustInclude(docText, "beta-dry-run-checklist", "dry-run checklist link", rel);
  mustInclude(docText, "beta-smoke-matrix", "smoke matrix link", rel);
  mustInclude(docText, "beta-degraded-mode-policy", "degraded policy prerequisite", rel);
  mustInclude(docText, "beta-limitations-onboarding-contract", "onboarding contract link", rel);
  mustInclude(docText, "disqualifies_beta_success", "degraded bundle field", rel);
  mustInclude(docText, "privacy-sanitize-gate-contract", "privacy gate link", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkBetaDryRunChecklistDoc(docText) {
  const rel = "docs/how-to/beta-dry-run-checklist.md";
  if (!docText) return;
  mustInclude(docText, "beta-tester-guide", "tester guide link", rel);
  mustInclude(docText, "ATTACH.md", "attach skeleton reference", rel);
  mustInclude(docText, "operator-feedback-issue", "feedback issue link", rel);
  mustInclude(docText, "beta-dry-run-sample-issue", "sample issue evidence link", rel);
  mustInclude(docText, "Phase A", "entry path phase", rel);
  mustInclude(docText, "Phase B", "operator path phase", rel);
  mustInclude(docText, "Phase C", "evidence phase", rel);
  mustInclude(docText, "beta-degraded-mode-policy", "degraded policy link", rel);
  mustInclude(docText, "beta-limitations-onboarding-contract", "onboarding contract link", rel);
  mustInclude(docText, "0.5", "smoke matrix read row", rel);
  mustInclude(docText, "risk_acceptance_reason", "degraded field check", rel);
  mustInclude(docText, "Phase D", "feedback phase", rel);
  mustInclude(docText, "PASS", "scoring semantics", rel);
  mustInclude(docText, "without re-running", "triage exit bar", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkBetaDryRunSampleIssueDoc(docText) {
  const rel = "docs/how-to/evidence/beta-dry-run-sample-issue.md";
  if (!docText) return;
  mustInclude(docText, "ATTACH.md", "attach source reference", rel);
  mustInclude(docText, "operator-feedback", "issue label reference", rel);
  mustInclude(docText, "Task ID", "task id field", rel);
  mustInclude(docText, "Inspect verdict", "inspect verdict field", rel);
  mustInclude(docText, "Inspect blockers", "inspect blockers field", rel);
  mustInclude(docText, "Steps to reproduce", "steps field", rel);
  mustInclude(docText, "Severity", "severity field", rel);
  mustInclude(docText, "synthetic", "synthetic disclaimer", rel);
  mustInclude(docText, "without maintainer rewrite", "triage sufficiency claim", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkPrimarySmokeDoc(docText) {
  const rel = "docs/how-to/primary-smoke.md";
  if (!docText) return;
  mustInclude(docText, "SMOKE_REPO_LAYOUT", "smoke repo layout reason code", rel);
  mustInclude(docText, "SMOKE_TRACE_NOT_FOUND", "smoke trace reason code", rel);
  mustInclude(docText, "run-primary-smoke.mjs", "primary smoke script reference", rel);
  mustInclude(docText, "run-orchestrator.js", "underlying runner reference", rel);
  mustInclude(docText, "Task ID", "expected Task ID output", rel);
  mustInclude(docText, "metrics/traces", "default trace path", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkHarnessCheckpoints(docText) {
  const rel = "docs/how-to/harness-health-checkpoints.md";
  if (!docText) return;
  mustInclude(docText, "Bootstrap passes", "bootstrap checkpoint", rel);
  mustInclude(docText, "npm test", "validation checkpoint", rel);
  mustInclude(docText, "Demo harness vs ai-minions", "demo comparison section", rel);
  mustInclude(docText, "doctor", "future doctor note", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkTokenHygieneGuide(hygieneText) {
  const rel = "docs/orchestrator/token-hygiene-guide.md";
  if (!hygieneText) return;
  const sections = [
    "When to start a new run vs continue",
    "When to use compact handoff",
    "When to split a large task",
    "How to write requests by role",
    "What not to paste in full",
    "How to read the token trace report",
  ];
  for (const title of sections) {
    mustInclude(hygieneText, title, `section: ${title}`, rel);
  }
  mustInclude(hygieneText, "tokens:report", "token trace report CLI", rel);
  mustNotHaveBacklogCaseIdsForDoc(hygieneText, rel);
  checkForbiddenClaimsForDoc(hygieneText, rel);
}

function checkSlashCommands(slashText) {
  const rel = "docs/how-to/operator-slash-commands.md";
  if (!slashText) return;
  mustInclude(slashText, "/validate", "validate alias", rel);
  mustInclude(slashText, "/launch", "launch alias", rel);
  mustInclude(slashText, "/run-status", "run-status alias", rel);
  mustInclude(slashText, "/runner-preflight", "runner-preflight alias", rel);
  mustInclude(slashText, "/inspect-run", "inspect-run alias", rel);
  mustInclude(slashText, "inspect-run-evidence", "inspect evidence doc link", rel);
  mustInclude(slashText, "npm test", "validate maps to npm test", rel);
  mustInclude(slashText, "not a new runtime", "no new runtime disclaimer", rel);
  mustNotHaveBacklogCaseIdsForDoc(slashText, rel);
  checkForbiddenClaimsForDoc(slashText, rel);
}

function checkGhaDocSpike(spikeText) {
  const rel = "docs/how-to/claude-gha-doc-smoke-spike.md";
  if (!spikeText) return;
  mustInclude(spikeText, "workflow_dispatch", "manual dispatch only", rel);
  mustInclude(spikeText, "ANTHROPIC_API_KEY", "secret prerequisite", rel);
  mustInclude(spikeText, "claude-doc-smoke.yml", "workflow file reference", rel);
  mustNotHaveBacklogCaseIdsForDoc(spikeText, rel);
  checkForbiddenClaimsForDoc(spikeText, rel);
}

function checkTuiChecklist(tuiText) {
  const rel = "docs/how-to/tui-manual-smoke-checklist.md";
  if (!tuiText) return;
  mustInclude(tuiText, "MODE: ORCHESTRATOR", "orchestration prompt", rel);
  mustInclude(tuiText, "FLOW: multi_agent", "multi_agent case", rel);
  mustInclude(tuiText, "MODE: CERBERUS", "adversarial review case", rel);
  mustInclude(tuiText, "EXAMPLE_API_URL", "ENVIRONMENT names-only example", rel);
  for (let n = 1; n <= 8; n += 1) {
    mustInclude(tuiText, `## ${n}.`, `checklist case ${n}`, rel);
  }
  mustNotHaveBacklogCaseIdsForDoc(tuiText, rel);
  checkForbiddenClaimsForDoc(tuiText, rel);
}

function checkFreshCloneEvidenceDoc(docText) {
  const rel = "docs/how-to/fresh-clone-evidence.md";
  if (!docText) return;
  mustInclude(docText, "EVIDENCE_OK", "evidence reason code", rel);
  mustInclude(docText, "CLAIM_FORBIDDEN_PHRASE", "claim audit reason code", rel);
  mustInclude(docText, "run-fresh-clone-evidence.mjs", "evidence script reference", rel);
  mustInclude(docText, "audit-product-claims.mjs", "claim audit script reference", rel);
  mustInclude(docText, "not a merge gate", "live smoke not CI-gated disclaimer", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkInstallEvidenceDoc(docText) {
  const rel = "docs/how-to/install-evidence.md";
  if (!docText) return;
  mustInclude(docText, "INSTALL_EVIDENCE_OK", "install evidence reason code", rel);
  mustInclude(docText, "CLAIM_FORBIDDEN_PHRASE", "claim audit reason code", rel);
  mustInclude(docText, "run-install-evidence.mjs", "install evidence script reference", rel);
  mustInclude(docText, "audit-product-claims.mjs", "claim audit script reference", rel);
  mustInclude(docText, "install-ollama-docker-paths.md", "docker paths cross-link", rel);
  mustInclude(docText, "orchestrator/", "cwd mistake warning", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkBetaLimitationsOnboardingContract(docText) {
  const rel = "docs/orchestrator/beta-limitations-onboarding-contract.md";
  if (!docText) return;
  mustInclude(docText, "beta-known-limitations", "limitations how-to link", rel);
  mustInclude(docText, "beta-tester-guide", "tester guide link", rel);
  mustInclude(docText, "Redaction policy", "redaction policy section", rel);
  mustInclude(docText, "trace-privacy-contract", "trace privacy link", rel);
  mustInclude(docText, "privacy-sanitize-gate-contract", "privacy gate link", rel);
  mustInclude(docText, "no production SLA", "sla honesty", rel);
  mustInclude(docText, "disqualifies_beta_success", "degraded field", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkBetaGateHardeningEvidenceDoc(docText) {
  const rel = "docs/how-to/beta-gate-hardening-evidence.md";
  if (!docText) return;
  mustInclude(docText, "run-beta-gate-hardening-evidence.mjs", "evidence script reference", rel);
  mustInclude(docText, "verify-usage-docs.mjs", "verify script reference", rel);
  mustInclude(docText, "audit-product-claims.mjs", "claim audit script reference", rel);
  mustInclude(docText, "GATE_HARDENING_OK", "gate hardening reason code", rel);
  mustInclude(docText, "beta-gate-hardening-verify-contract", "verify contract link", rel);
  mustInclude(docText, "beta-limitations-onboarding-contract", "onboarding contract link", rel);
  mustInclude(docText, "Not claimed", "not claimed disclaimer", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkBetaGateHardeningVerifyContract(docText) {
  const rel = "docs/orchestrator/beta-gate-hardening-verify-contract.md";
  if (!docText) return;
  mustInclude(docText, "verify-usage-docs.mjs", "verify script reference", rel);
  mustInclude(docText, "audit-product-claims.mjs", "claim audit script reference", rel);
  mustInclude(docText, "run-beta-gate-hardening-evidence.mjs", "evidence script reference", rel);
  mustInclude(docText, "beta-smoke-matrix.md", "smoke matrix doc scope", rel);
  mustInclude(docText, "beta-degraded-mode-policy.md", "degraded policy doc scope", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkModularCloseoutEvidenceDoc(docText) {
  const rel = "docs/how-to/modular-closeout-evidence.md";
  if (!docText) return;
  mustInclude(docText, "run-modular-closeout-evidence.mjs", "evidence script reference", rel);
  mustInclude(docText, "modular-closeout-evidence-contract", "verify contract link", rel);
  mustInclude(docText, "audit-product-claims.mjs", "claim audit scope", rel);
  mustInclude(docText, "CLOSEOUT_OK", "closeout reason code", rel);
  mustInclude(docText, "Not claimed", "not claimed disclaimer", rel);
  mustInclude(docText, "evidence:closeout", "npm script reference", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkModularCloseoutVerifyContract(docText) {
  const rel = "docs/orchestrator/modular-closeout-evidence-contract.md";
  if (!docText) return;
  mustInclude(docText, "run-modular-closeout-evidence.mjs", "evidence script reference", rel);
  mustInclude(docText, "check-root-import-guard.js", "root guard scope", rel);
  mustInclude(docText, "lint:module-boundaries", "module boundaries scope", rel);
  mustInclude(docText, "architecture-coherence-audit.md", "audit doc scope", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkBetaDegradedPolicyDoc(docText) {
  const rel = "docs/how-to/beta-degraded-mode-policy.md";
  if (!docText) return;
  mustInclude(docText, "INSPECT_DEGRADED_", "degraded inspect codes", rel);
  mustInclude(docText, "degraded_mode", "degraded mode field", rel);
  mustInclude(docText, "risk_acceptance_reason", "risk acceptance field", rel);
  mustInclude(docText, "DEGRADED_SKIP_GATES", "skip gates trigger", rel);
  mustInclude(docText, "collect-run-report.mjs", "bundle script reference", rel);
  mustInclude(docText, "inspect-run-evidence.mjs", "inspect script reference", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkBetaSmokeMatrixDoc(docText) {
  const rel = "docs/how-to/beta-smoke-matrix.md";
  if (!docText) return;
  mustInclude(docText, "SMOKE_MATRIX_OK", "smoke matrix reason code", rel);
  mustInclude(docText, "CLAIM_FORBIDDEN_PHRASE", "claim audit reason code", rel);
  mustInclude(docText, "run-beta-smoke-matrix.mjs", "smoke matrix script reference", rel);
  mustInclude(docText, "audit-product-claims.mjs", "claim audit script reference", rel);
  mustInclude(docText, "beta-smoke-matrix-record.json", "evidence record reference", rel);
  mustInclude(docText, "not a merge gate", "live smoke not CI-gated disclaimer", rel);
  mustInclude(docText, "## Minimum gate cells", "minimum gate cells section", rel);
  mustInclude(docText, "linux-ollama-sa-trivial", "required gate cell id", rel);
  mustNotHaveBacklogCaseIdsForDoc(docText, rel);
  checkForbiddenClaimsForDoc(docText, rel);
}

function checkReadmeAlignment(readmeText, guideText) {
  const rel = "README.md";
  mustInclude(readmeText, "MODE: ORCHESTRATOR", "Quickstart MODE header", rel);
  mustInclude(readmeText, "FLOW: single_agent", "Quickstart single_agent", rel);
  mustInclude(readmeText, "usage-smoke-guide.md", "link to canonical how-to", rel);
  mustInclude(readmeText, "token-hygiene-guide.md", "link to token hygiene guide", rel);
  mustInclude(readmeText, "bootstrap-preflight.md", "link to bootstrap preflight doc", rel);
  mustInclude(readmeText, "primary-smoke.md", "link to primary smoke doc", rel);
  mustInclude(readmeText, "fresh-clone-evidence.md", "link to fresh-clone evidence doc", rel);
  mustInclude(readmeText, "operator-preflight-bridge.md", "link to operator preflight bridge doc", rel);
  mustInclude(readmeText, "inspect-run-evidence.md", "link to inspect run evidence doc", rel);
  mustInclude(readmeText, "collect-run-report.md", "link to collect run report doc", rel);
  mustInclude(readmeText, "beta-known-limitations.md", "link to beta known limitations doc", rel);
  mustInclude(readmeText, "operator-feedback-issue.md", "link to operator feedback issue doc", rel);
  mustInclude(readmeText, "beta-tester-guide.md", "link to beta tester guide doc", rel);
  mustInclude(readmeText, "beta-dry-run-checklist.md", "link to beta dry-run checklist doc", rel);
  mustInclude(readmeText, "beta-smoke-matrix.md", "link to beta smoke matrix doc", rel);
  mustInclude(readmeText, "beta-degraded-mode-policy.md", "link to beta degraded policy doc", rel);
  mustInclude(readmeText, "beta-limitations-onboarding-contract.md", "link to onboarding contract", rel);
  mustInclude(readmeText, "beta-gate-hardening-evidence.md", "link to gate hardening evidence doc", rel);
  mustInclude(readmeText, "verify-usage-docs.mjs", "verify usage docs script", rel);
  mustInclude(readmeText, "audit-product-claims.mjs", "claim audit script", rel);
  mustInclude(readmeText, "run-beta-gate-hardening-evidence.mjs", "gate hardening evidence script", rel);
  mustInclude(readmeText, "modular-closeout-evidence.md", "link to modular closeout evidence doc", rel);
  mustInclude(readmeText, "run-modular-closeout-evidence.mjs", "modular closeout evidence script", rel);
  mustInclude(readmeText, "npm run runner:tui -- --help", "runner tui help command", rel);

  checkForbiddenClaimsForDoc(readmeText, rel);

  if (guideText && readmeText) {
    const readmeHasMulti = readmeText.includes("multi_agent");
    const guideHasMulti = guideText.includes("multi_agent");
    if (readmeHasMulti !== guideHasMulti) {
      fail("README.md vs usage-smoke-guide.md: multi_agent mention mismatch");
    }
  }
}

function main() {
  const guideText = readUtf8(CANONICAL_GUIDE);
  const tuiText = readUtf8(TUI_CHECKLIST);
  const spikeText = readUtf8(GHA_DOC_SPIKE);
  const slashText = readUtf8(SLASH_COMMANDS);
  const hygieneText = readUtf8(TOKEN_HYGIENE);
  const contextHygieneText = readUtf8(CONTEXT_HYGIENE);
  const harnessText = readUtf8(HARNESS_CHECKPOINTS);
  const bootstrapText = readUtf8(BOOTSTRAP_PREFLIGHT);
  const primarySmokeText = readUtf8(PRIMARY_SMOKE);
  const freshCloneText = readUtf8(FRESH_CLONE_EVIDENCE);
  const installEvidenceText = readUtf8(INSTALL_EVIDENCE);
  const betaSmokeMatrixText = readUtf8(BETA_SMOKE_MATRIX);
  const betaDegradedPolicyText = readUtf8(BETA_DEGRADED_POLICY);
  const betaLimitationsContractText = readUtf8(BETA_LIMITATIONS_ONBOARDING_CONTRACT);
  const betaGateHardeningEvidenceText = readUtf8(BETA_GATE_HARDENING_EVIDENCE);
  const betaGateHardeningVerifyContractText = readUtf8(BETA_GATE_HARDENING_VERIFY_CONTRACT);
  const modularCloseoutEvidenceText = readUtf8(MODULAR_CLOSEOUT_EVIDENCE);
  const modularCloseoutVerifyContractText = readUtf8(MODULAR_CLOSEOUT_VERIFY_CONTRACT);
  const operatorBridgeText = readUtf8(OPERATOR_PREFLIGHT_BRIDGE);
  const operatorGuidedText = readUtf8(OPERATOR_GUIDED_RUN);
  const inspectEvidenceText = readUtf8(INSPECT_RUN_EVIDENCE);
  const collectReportText = readUtf8(COLLECT_RUN_REPORT);
  const betaLimitationsText = readUtf8(BETA_KNOWN_LIMITATIONS);
  const betaTesterGuideText = readUtf8(BETA_TESTER_GUIDE);
  const betaDryRunChecklistText = readUtf8(BETA_DRY_RUN_CHECKLIST);
  const betaDryRunSampleIssueText = readUtf8(BETA_DRY_RUN_SAMPLE_ISSUE);
  const operatorFeedbackText = readUtf8(OPERATOR_FEEDBACK_ISSUE);
  const operatorFeedbackTemplateText = readUtf8(OPERATOR_FEEDBACK_TEMPLATE);
  const readmeText = readUtf8(README);

  if (!fs.existsSync(BOOTSTRAP_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, BOOTSTRAP_SCRIPT)}`);
  }
  if (!fs.existsSync(OPERATOR_PREFLIGHT_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, OPERATOR_PREFLIGHT_SCRIPT)}`);
  }
  if (!fs.existsSync(INSPECT_RUN_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, INSPECT_RUN_SCRIPT)}`);
  }
  if (!fs.existsSync(COLLECT_RUN_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, COLLECT_RUN_SCRIPT)}`);
  }
  if (!fs.existsSync(PRIMARY_SMOKE_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, PRIMARY_SMOKE_SCRIPT)}`);
  }
  if (!fs.existsSync(CLAIM_AUDIT_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, CLAIM_AUDIT_SCRIPT)}`);
  }
  if (!fs.existsSync(EVIDENCE_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, EVIDENCE_SCRIPT)}`);
  }
  if (!fs.existsSync(INSTALL_EVIDENCE_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, INSTALL_EVIDENCE_SCRIPT)}`);
  }
  if (!fs.existsSync(BETA_SMOKE_MATRIX_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, BETA_SMOKE_MATRIX_SCRIPT)}`);
  }
  if (!fs.existsSync(DEGRADED_MODE_EVIDENCE)) {
    fail(`missing file: ${path.relative(REPO_ROOT, DEGRADED_MODE_EVIDENCE)}`);
  }
  if (!fs.existsSync(BETA_GATE_HARDENING_EVIDENCE_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, BETA_GATE_HARDENING_EVIDENCE_SCRIPT)}`);
  }
  if (!fs.existsSync(MODULAR_CLOSEOUT_EVIDENCE_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, MODULAR_CLOSEOUT_EVIDENCE_SCRIPT)}`);
  }
  if (!fs.existsSync(BETA_SMOKE_MATRIX_RECORD)) {
    fail(`missing file: ${path.relative(REPO_ROOT, BETA_SMOKE_MATRIX_RECORD)}`);
  }

  if (guideText) checkGuide(guideText);
  if (tuiText) checkTuiChecklist(tuiText);
  if (spikeText) checkGhaDocSpike(spikeText);
  if (slashText) checkSlashCommands(slashText);
  if (hygieneText) checkTokenHygieneGuide(hygieneText);
  if (contextHygieneText) checkContextHygieneDoc(contextHygieneText);
  if (harnessText) checkHarnessCheckpoints(harnessText);
  if (bootstrapText) checkBootstrapPreflightDoc(bootstrapText);
  if (primarySmokeText) checkPrimarySmokeDoc(primarySmokeText);
  if (freshCloneText) checkFreshCloneEvidenceDoc(freshCloneText);
  if (installEvidenceText) checkInstallEvidenceDoc(installEvidenceText);
  if (betaSmokeMatrixText) checkBetaSmokeMatrixDoc(betaSmokeMatrixText);
  if (betaDegradedPolicyText) checkBetaDegradedPolicyDoc(betaDegradedPolicyText);
  if (betaLimitationsContractText) checkBetaLimitationsOnboardingContract(betaLimitationsContractText);
  if (betaGateHardeningEvidenceText) checkBetaGateHardeningEvidenceDoc(betaGateHardeningEvidenceText);
  if (betaGateHardeningVerifyContractText) {
    checkBetaGateHardeningVerifyContract(betaGateHardeningVerifyContractText);
  }
  if (modularCloseoutEvidenceText) checkModularCloseoutEvidenceDoc(modularCloseoutEvidenceText);
  if (modularCloseoutVerifyContractText) {
    checkModularCloseoutVerifyContract(modularCloseoutVerifyContractText);
  }
  if (operatorBridgeText) checkOperatorPreflightBridgeDoc(operatorBridgeText);
  if (operatorGuidedText) checkOperatorGuidedRunDoc(operatorGuidedText);
  if (inspectEvidenceText) checkInspectRunEvidenceDoc(inspectEvidenceText);
  if (collectReportText) checkCollectRunReportDoc(collectReportText);
  if (betaLimitationsText) checkBetaKnownLimitationsDoc(betaLimitationsText);
  if (betaTesterGuideText) checkBetaTesterGuideDoc(betaTesterGuideText);
  if (betaDryRunChecklistText) checkBetaDryRunChecklistDoc(betaDryRunChecklistText);
  if (betaDryRunSampleIssueText) checkBetaDryRunSampleIssueDoc(betaDryRunSampleIssueText);
  if (operatorFeedbackText) checkOperatorFeedbackIssueDoc(operatorFeedbackText);
  if (operatorFeedbackTemplateText) checkOperatorFeedbackTemplate(operatorFeedbackTemplateText);
  if (readmeText) checkReadmeAlignment(readmeText, guideText);

  if (failures.length) {
    console.error("verify-usage-docs: FAILED\n");
    for (const f of failures) console.error(`  - ${f}`);
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }

  console.log("verify-usage-docs: OK");
}

main();
