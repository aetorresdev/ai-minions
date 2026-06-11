#!/usr/bin/env node
'use strict';

/**
 * Deterministic guard against forbidden security/runtime overclaims in versioned docs.
 * Not LLM-based.
 */

const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('../repo-root');

/** @type {{ id: string, re: RegExp }[]} */
const FORBIDDEN_RULES = [
  { id: 'production_ready', re: /\bproduction[- ]ready\b/i },
  { id: 'zero_trust_compliant', re: /\bzero\s+trust\s+compliant\b/i },
  { id: 'fully_sandboxed', re: /\bfully\s+sandboxed\b/i },
  { id: 'secrets_never', re: /\bsecrets?\s+never\b/i },
  { id: 'complete_isolation', re: /\bcomplete\s+isolation\b/i },
  { id: 'guaranteed_secure', re: /\bguaranteed\s+secure\b/i },
  { id: 'autonomous_company', re: /\bautonomous\s+company\b/i },
  { id: 'no_human_required', re: /\bno\s+human\s+required\b/i },
];

const DOC_DIR = 'docs/orchestrator';

/** Groomed backlog case ids must not appear in versioned operator docs. */
const BACKLOG_CASE_ID_RE = /\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+-\d+\b/g;

/** Groomed lane shorthand must not appear in versioned operator docs. */
const LANE_ID_RE = /\bA\d+-\d+\b/g;

/** Section headings where forbidden phrases may appear as explicit negation. */
const SAFE_SECTION_RE =
  /^(#{1,6}\s+(not claimed|out of scope|forbidden|rejected|not promoted|what this document is not|what .+ does not do|anti-patr[oó]n|allowed claim|forbidden claim|examples?)\b)/i;

const ALLOWED_FORBIDDEN_TABLE_HEADER_RE = /\|\s*Allowed\s*\|\s*Forbidden\s*\|/i;

const NEGATION_LINE_RE =
  /\b(no |not |without |never |forbidden|do not |don't |must not |cannot claim|is not |are not |not a claim|not claimed|out of scope|rejected|anti-claim|sign-off on release claims|CERBERUS sign-off|explicit gaps|Alpha;|pre-release|honest limitations|does not replace|not a promise|not a substitute|not a claim)\b/i;

const REQUIRED_DOC_MARKERS = [
  {
    rel: 'security-posture.md',
    mustInclude: /what this document is not/i,
    reason: 'security posture must state explicit non-claims',
  },
];

/**
 * @param {string} line
 * @returns {boolean}
 */
function tableLineAllowsForbidden(line) {
  if (!line.includes('|')) return false;
  const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
  if (cells.length < 2) return false;

  const statusHints =
    /^(alpha|beta|forbidden|not claimed|rejected|gap|explicit|CERBERUS|no |not |partial|planned|design-first|doc-only|illustrative)/i;

  if (cells.length >= 3) {
    const last = cells[cells.length - 1];
    const headerish = /^(allowed|forbidden|status|claim)$/i;
    if (headerish.test(cells[0]) || headerish.test(cells[1])) return true;
    if (statusHints.test(last) || /\bforbidden\b/i.test(last)) return true;
  }

  if (cells.length === 2 && statusHints.test(cells[1])) return true;
  return false;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function lineIsNegated(line) {
  const t = line.trim();
  if (!t || t.startsWith('<!--')) return true;
  if (SAFE_SECTION_RE.test(t)) return true;
  if (NEGATION_LINE_RE.test(t)) return true;
  if (tableLineAllowsForbidden(t)) return true;
  if (/^[-*]\s+\[?[x\s]?\]?\s/i.test(t) && NEGATION_LINE_RE.test(t)) return true;
  return false;
}

/**
 * @param {string} content
 * @param {string} relPath
 * @returns {{ file: string, line: number, rule: string, text: string }[]}
 */
/**
 * @param {string} line
 * @param {boolean} inAllowedForbiddenTable
 * @returns {boolean}
 */
function allowedForbiddenTableLine(line, inAllowedForbiddenTable) {
  if (!inAllowedForbiddenTable || !line.includes('|')) return false;
  if (/^\|?[\s:-]+\|/.test(line.trim())) return true;
  const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
  if (cells.length < 2) return false;
  const forbiddenCol = cells[1];
  const allowedCol = cells[0];
  for (const rule of FORBIDDEN_RULES) {
    if (rule.re.test(line)) {
      if (rule.re.test(forbiddenCol) && !rule.re.test(allowedCol)) return true;
      return false;
    }
  }
  return true;
}

/**
 * @param {string} content
 * @param {string} relPath
 * @returns {{ file: string, line: number, rule: string, text: string }[]}
 */
function stripInlineCode(line) {
  return line.replace(/`[^`]+`/g, '');
}

function scanBacklogCaseIds(content, relPath) {
  /** @type {{ file: string, line: number, rule: string, text: string }[]} */
  const violations = [];
  let inFence = false;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed || trimmed.startsWith('<!--')) continue;
    const scrubbed = stripInlineCode(line);
    const caseHits = scrubbed.match(BACKLOG_CASE_ID_RE);
    const laneHits = scrubbed.match(LANE_ID_RE);
    const hits = [...new Set([...(caseHits || []), ...(laneHits || [])])];
    for (const hit of hits) {
      violations.push({
        file: relPath,
        line: i + 1,
        rule: 'backlog_case_id',
        text: hit,
      });
    }
  }
  return violations;
}

function scanMarkdown(content, relPath) {
  /** @type {{ file: string, line: number, rule: string, text: string }[]} */
  const violations = [];
  let inFence = false;
  let inSafeSection = false;
  let safeSectionDepth = 0;
  let inAllowedForbiddenTable = false;

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (ALLOWED_FORBIDDEN_TABLE_HEADER_RE.test(trimmed)) {
      inAllowedForbiddenTable = true;
      continue;
    }
    if (inAllowedForbiddenTable && (!trimmed || !trimmed.includes('|'))) {
      inAllowedForbiddenTable = false;
    }

    const heading = trimmed.match(/^(#{1,6})\s+/);
    if (heading) {
      const depth = heading[1].length;
      if (SAFE_SECTION_RE.test(trimmed)) {
        inSafeSection = true;
        safeSectionDepth = depth;
      } else if (inSafeSection && depth <= safeSectionDepth) {
        inSafeSection = false;
        safeSectionDepth = 0;
      }
      inAllowedForbiddenTable = false;
    }

    if (inSafeSection || lineIsNegated(line)) continue;
    if (allowedForbiddenTableLine(line, inAllowedForbiddenTable)) continue;

    for (const rule of FORBIDDEN_RULES) {
      if (rule.re.test(line)) {
        violations.push({
          file: relPath,
          line: i + 1,
          rule: rule.id,
          text: trimmed.slice(0, 160),
        });
      }
    }
  }
  return violations;
}

/**
 * @param {{ repoRoot?: string, docDir?: string }} [opts]
 */
function checkDocRuntimeClaims(opts = {}) {
  const repoRoot = opts.repoRoot || getRepoRoot();
  const docRoot = path.join(repoRoot, opts.docDir || DOC_DIR);
  if (!fs.existsSync(docRoot)) {
    return { ok: false, violations: [{ file: docRoot, line: 0, rule: 'missing_dir', text: 'docs dir not found' }] };
  }

  const files = fs
    .readdirSync(docRoot)
    .filter((f) => f.endsWith('.md'))
    .sort();

  /** @type {{ file: string, line: number, rule: string, text: string }[]} */
  let violations = [];

  for (const name of files) {
    const rel = path.join(DOC_DIR, name).replace(/\\/g, '/');
    const content = fs.readFileSync(path.join(docRoot, name), 'utf8');
    violations = violations.concat(scanMarkdown(content, rel));
    violations = violations.concat(scanBacklogCaseIds(content, rel));
  }

  for (const req of REQUIRED_DOC_MARKERS) {
    const full = path.join(docRoot, req.rel);
    if (!fs.existsSync(full)) {
      violations.push({
        file: path.join(DOC_DIR, req.rel),
        line: 0,
        rule: 'missing_required_doc',
        text: 'required doc missing',
      });
      continue;
    }
    const content = fs.readFileSync(full, 'utf8');
    if (!req.mustInclude.test(content)) {
      violations.push({
        file: path.join(DOC_DIR, req.rel),
        line: 0,
        rule: 'missing_warning_section',
        text: req.reason,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

function main() {
  const result = checkDocRuntimeClaims();
  if (result.ok) {
    console.log('[doc-runtime-claims] OK — no forbidden overclaims in docs/orchestrator/*.md');
    process.exit(0);
  }
  console.error('[doc-runtime-claims] Forbidden overclaim(s) detected:');
  for (const v of result.violations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.text}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  FORBIDDEN_RULES,
  BACKLOG_CASE_ID_RE,
  LANE_ID_RE,
  checkDocRuntimeClaims,
  scanMarkdown,
  scanBacklogCaseIds,
  lineIsNegated,
};
