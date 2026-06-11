'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const {
  checkDocRuntimeClaims,
  scanMarkdown,
  scanBacklogCaseIds,
  lineIsNegated,
} = require('../scripts/check-doc-runtime-claims');
const { getRepoRoot } = require('../repo-root');

describe('doc-runtime-drift-check', () => {
  it('lineIsNegated accepts explicit negation and forbidden-table rows', () => {
    assert.equal(lineIsNegated('| Production-ready framework | Alpha; explicit gaps |'), true);
    assert.equal(lineIsNegated('CERBERUS sign-off: no production-ready claims'), true);
    assert.equal(lineIsNegated('We are production-ready for enterprise.'), false);
  });

  it('scanMarkdown flags positive overclaim outside safe sections', () => {
    const bad = scanMarkdown(
      '# Security\n\nThis harness is production-ready today.\n',
      'docs/orchestrator/fixture-bad.md',
    );
    assert.equal(bad.length, 1);
    assert.equal(bad[0].rule, 'production_ready');
  });

  it('scanMarkdown allows forbidden phrase under Not claimed section', () => {
    const ok = scanMarkdown(
      '## Not claimed\n\n- secrets never exposed in all cases\n',
      'docs/orchestrator/fixture-ok.md',
    );
    assert.deepEqual(ok, []);
  });

  it('scanBacklogCaseIds flags groomed case ids in operator docs', () => {
    const hits = scanBacklogCaseIds(
      '# Contract\n\nSee FOO-BAR-1 in groomed backlog only.\n',
      'docs/orchestrator/fixture-ticket.md',
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].rule, 'backlog_case_id');
    assert.equal(hits[0].text, 'FOO-BAR-1');
  });

  it('versioned orchestrator docs pass drift check', () => {
    const result = checkDocRuntimeClaims({ repoRoot: getRepoRoot() });
    assert.equal(
      result.ok,
      true,
      result.violations.map((v) => `${v.file}:${v.line} ${v.rule} ${v.text}`).join('\n'),
    );
  });

  it('fails on synthetic doc with overclaim in temp dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-drift-'));
    const docDir = path.join(tmp, 'docs/orchestrator');
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(
      path.join(docDir, 'evil.md'),
      '# Evil\n\nFully sandboxed multi-tenant isolation is guaranteed secure.\n',
    );
    fs.writeFileSync(
      path.join(docDir, 'security-posture.md'),
      '# Security\n\n## What this document is not\n\nNot production.\n',
    );
    const result = checkDocRuntimeClaims({ repoRoot: tmp });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.rule === 'fully_sandboxed'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
