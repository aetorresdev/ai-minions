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
const PRIMARY_SMOKE = path.join(REPO_ROOT, "docs/how-to/primary-smoke.md");
const PRIMARY_SMOKE_SCRIPT = path.join(REPO_ROOT, "scripts/run-primary-smoke.mjs");
const FRESH_CLONE_EVIDENCE = path.join(REPO_ROOT, "docs/how-to/fresh-clone-evidence.md");
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

function checkOperatorGuidedRunDoc(docText) {
  const rel = "docs/how-to/operator-guided-run.md";
  if (!docText) return;
  mustInclude(docText, "runner:tui", "runner tui reference", rel);
  mustInclude(docText, "bootstrap-preflight", "bootstrap delegation link", rel);
  mustInclude(docText, "--help", "help discovery", rel);
  mustInclude(docText, "operator-slash-commands", "slash discoverability", rel);
  mustInclude(docText, "/operator-preflight", "operator-preflight slash alias", rel);
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
  mustInclude(slashText, "operator-guided-run.md", "guided run link", rel);
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
  mustInclude(readmeText, "operator-guided-run.md", "link to guided run doc", rel);
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
  const operatorBridgeText = readUtf8(OPERATOR_PREFLIGHT_BRIDGE);
  const operatorGuidedText = readUtf8(OPERATOR_GUIDED_RUN);
  const readmeText = readUtf8(README);

  if (!fs.existsSync(BOOTSTRAP_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, BOOTSTRAP_SCRIPT)}`);
  }
  if (!fs.existsSync(OPERATOR_PREFLIGHT_SCRIPT)) {
    fail(`missing file: ${path.relative(REPO_ROOT, OPERATOR_PREFLIGHT_SCRIPT)}`);
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
  if (operatorBridgeText) checkOperatorPreflightBridgeDoc(operatorBridgeText);
  if (operatorGuidedText) checkOperatorGuidedRunDoc(operatorGuidedText);
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
