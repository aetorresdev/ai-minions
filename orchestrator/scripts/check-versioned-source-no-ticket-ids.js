#!/usr/bin/env node
'use strict';

/**
 * DOC-NO-TICKET-SRC-1 — scan versioned implementation paths for groomed backlog ids.
 * Complements lint:docs-claims (docs/orchestrator/*.md only).
 */

const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('../repo-root');
const { BACKLOG_CASE_ID_RE, LANE_ID_RE, RELEASE_SLICE_LANE_RE } = require('./check-doc-runtime-claims');

/** @type {{ rel: string, exts: string[] }[]} */
const SCAN_ROOTS = [
  { rel: 'orchestrator', exts: ['.js'] },
  { rel: 'scripts', exts: ['.mjs', '.js', '.sh'] },
  { rel: 'tests', exts: ['.mjs', '.js'] },
  { rel: path.join('scripts', 'hooks'), exts: ['.py'] },
];

const EXCLUDED_REL = new Set([
  'orchestrator/tests/versionedSourceNoBacklogTicketIds.test.js',
  'orchestrator/tests/docRuntimeDriftCheck.test.js',
  'orchestrator/scripts/check-versioned-source-no-ticket-ids.js',
]);

/**
 * @param {string} dir
 * @param {string[]} exts
 * @returns {string[]}
 */
function collectFiles(dir, exts) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;

  function walk(current) {
    for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
      if (ent.name === 'node_modules') continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (exts.some((ext) => ent.name.endsWith(ext))) out.push(full);
    }
  }

  walk(dir);
  return out.sort();
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function findBacklogIds(text) {
  const caseHits = text.match(BACKLOG_CASE_ID_RE) || [];
  const laneHits = text.match(RELEASE_SLICE_LANE_RE) || [];
  return [...new Set([...caseHits, ...laneHits])];
}

/**
 * @param {{ repoRoot?: string }} [opts]
 * @returns {{ ok: boolean, violations: { file: string, ids: string[] }[] }}
 */
function checkVersionedSourceNoTicketIds(opts = {}) {
  const repoRoot = opts.repoRoot || getRepoRoot();
  /** @type {{ file: string, ids: string[] }[]} */
  const violations = [];

  for (const { rel, exts } of SCAN_ROOTS) {
    const absRoot = path.join(repoRoot, rel);
    for (const filePath of collectFiles(absRoot, exts)) {
      const fileRel = path.relative(repoRoot, filePath).replace(/\\/g, '/');
      if (EXCLUDED_REL.has(fileRel)) continue;
      const hits = findBacklogIds(fs.readFileSync(filePath, 'utf8'));
      if (hits.length > 0) {
        violations.push({ file: fileRel, ids: hits });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function main() {
  const result = checkVersionedSourceNoTicketIds();
  if (result.ok) {
    console.log('[no-ticket-src] OK — no groomed backlog ids in versioned source paths');
    process.exit(0);
  }
  console.error('[no-ticket-src] Groomed backlog id(s) in versioned source:');
  for (const v of result.violations) {
    console.error(`  ${v.file}: ${v.ids.join(', ')}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  SCAN_ROOTS,
  EXCLUDED_REL,
  findBacklogIds,
  checkVersionedSourceNoTicketIds,
};
