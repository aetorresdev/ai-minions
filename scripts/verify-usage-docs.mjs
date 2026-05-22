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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CANONICAL_GUIDE = path.join(REPO_ROOT, "docs/how-to/usage-smoke-guide.md");
const TUI_CHECKLIST = path.join(REPO_ROOT, "docs/how-to/tui-manual-smoke-checklist.md");
const README = path.join(REPO_ROOT, "README.md");

/** @type {string[]} */
const failures = [];

function fail(msg) {
  failures.push(msg);
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

/** Remove fenced code and inline backticks so examples/lists do not trip claim checks. */
function stripCodeSpans(text) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "");
}

/** Drop the "prohibited wording" teaching section (lists forbidden phrases on purpose). */
function stripProhibitedWordingSection(text) {
  const marker = "## Prohibited wording";
  const idx = text.indexOf(marker);
  if (idx === -1) return text;
  return text.slice(0, idx);
}

function mustNotMatch(text, pattern, label, fileRel) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  if (re.test(text)) {
    fail(`${fileRel}: forbidden content — ${label} (matched ${re})`);
  }
}

function lineNegatesClaim(line) {
  return /\b(not|never|without|do\s+not|don't|no)\b/i.test(line);
}

function checkForbiddenClaims(text, fileRel) {
  const scrubbed = stripCodeSpans(stripProhibitedWordingSection(text));
  for (const line of scrubbed.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const negated = lineNegatesClaim(trimmed);
    for (const { re, label } of FORBIDDEN_CLAIMS) {
      if (re.test(trimmed) && !negated) {
        fail(`${fileRel}: forbidden content — ${label} (line: ${trimmed.slice(0, 120)}…)`);
      }
    }
  }
  for (const { re, label } of SECRET_PATTERNS) {
    mustNotMatch(text, re, label, fileRel);
  }
}

/** Backlog-style ticket IDs must not appear in versioned operator docs. */
function mustNotHaveBacklogCaseIds(text, fileRel) {
  const hits = text.match(/\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+-\d+\b/g);
  if (hits?.length) {
    const unique = [...new Set(hits)];
    fail(`${fileRel}: backlog-style case IDs not allowed in operator docs: ${unique.join(", ")}`);
  }
}

const FORBIDDEN_CLAIMS = [
  { re: /production[- ]ready/i, label: "production-ready claim" },
  { re: /autonomous\s+(engineering\s+)?team/i, label: "autonomous team claim" },
  { re: /24\s*\/\s*7\s+dev\s+team/i, label: "24/7 dev team claim" },
  { re: /fully\s+secure/i, label: "fully secure claim" },
  { re: /inherited\s+credentials?/i, label: "inherited credentials claim" },
  { re: /credenciales\s+heredadas/i, label: "credenciales heredadas claim" },
  { re: /multi[- ]tenant\s+isolation\s+implemented/i, label: "multi-tenant implemented claim" },
];

const SECRET_PATTERNS = [
  { re: /\bsk-ant-[a-zA-Z0-9_-]{10,}\b/, label: "Anthropic API key-shaped value" },
  { re: /\bsk-proj-[a-zA-Z0-9_-]{10,}\b/, label: "OpenAI project key-shaped value" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key id-shaped value" },
  { re: /\bghp_[a-zA-Z0-9]{20,}\b/, label: "GitHub PAT-shaped value" },
  { re: /\bBearer\s+[a-zA-Z0-9._-]{20,}\b/, label: "Bearer token value" },
  { re: /(?:password|api[_-]?key|secret)\s*[:=]\s*['"]?[a-zA-Z0-9+/=_-]{12,}/i, label: "inline secret assignment" },
];

function checkGuide(guideText) {
  const rel = "docs/how-to/usage-smoke-guide.md";
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

  checkForbiddenClaims(guideText, rel);
  mustNotHaveBacklogCaseIds(guideText, rel);
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
  mustNotHaveBacklogCaseIds(tuiText, rel);
  checkForbiddenClaims(tuiText, rel);
}

function checkReadmeAlignment(readmeText, guideText) {
  const rel = "README.md";
  mustInclude(readmeText, "MODE: ORCHESTRATOR", "Quickstart MODE header", rel);
  mustInclude(readmeText, "FLOW: single_agent", "Quickstart single_agent", rel);
  mustInclude(readmeText, "usage-smoke-guide.md", "link to canonical how-to", rel);

  checkForbiddenClaims(readmeText, rel);

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
  const readmeText = readUtf8(README);

  if (guideText) checkGuide(guideText);
  if (tuiText) checkTuiChecklist(tuiText);
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
