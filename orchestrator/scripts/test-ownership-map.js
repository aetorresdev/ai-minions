'use strict';

const fs = require('fs');
const path = require('path');
const { OWNERS, KINDS, ENTRIES } = require('./test-ownership-map-data');

const TESTS_DIR = path.join(__dirname, '..', 'tests');

/**
 * @param {string} [root]
 * @returns {string[]} paths relative to orchestrator/ (e.g. tests/foo.test.js)
 */
function listTestFiles(root = TESTS_DIR) {
  /** @type {string[]} */
  const out = [];
  const orchRoot = path.join(__dirname, '..');

  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
      } else if (name.endsWith('.test.js')) {
        out.push(path.relative(orchRoot, abs).split(path.sep).join('/'));
      }
    }
  }

  walk(root);
  return out;
}

/**
 * @param {{ entries?: Record<string, { owner: string, kind: string }>, files?: string[] }} [opts]
 */
function validateTestOwnershipMap(opts = {}) {
  const entries = opts.entries || ENTRIES;
  const files = opts.files || listTestFiles();
  const entryKeys = Object.keys(entries).sort();
  const fileSet = new Set(files);
  const entrySet = new Set(entryKeys);

  /** @type {string[]} */
  const orphans = files.filter((f) => !entrySet.has(f)).sort();
  /** @type {string[]} */
  const stale = entryKeys.filter((k) => !fileSet.has(k)).sort();
  /** @type {string[]} */
  const invalid = [];

  for (const [rel, meta] of Object.entries(entries)) {
    if (!OWNERS.includes(meta.owner)) {
      invalid.push(`${rel}: unknown owner "${meta.owner}"`);
    }
    if (!KINDS.includes(meta.kind)) {
      invalid.push(`${rel}: unknown kind "${meta.kind}"`);
    }
  }

  return {
    ok: orphans.length === 0 && stale.length === 0 && invalid.length === 0,
    orphans,
    stale,
    invalid,
    fileCount: files.length,
    entryCount: entryKeys.length,
  };
}

/**
 * @returns {Record<string, number>}
 */
function countByOwner() {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(OWNERS.map((o) => [o, 0]));
  for (const meta of Object.values(ENTRIES)) {
    counts[meta.owner] = (counts[meta.owner] || 0) + 1;
  }
  return counts;
}

module.exports = {
  OWNERS,
  KINDS,
  ENTRIES,
  listTestFiles,
  validateTestOwnershipMap,
  countByOwner,
};
