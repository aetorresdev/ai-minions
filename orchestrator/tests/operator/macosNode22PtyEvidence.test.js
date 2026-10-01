'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  REQUIRED_CASES,
  evaluateMacosNode22PtyEvidence,
  parseTap,
} = require('../../scripts/assert-macos-node22-pty-evidence');

const HEAD = 'a'.repeat(40);

function tapFor(cases, counts) {
  const lines = ['TAP version 13'];
  cases.forEach((row, index) => {
    const n = index + 1;
    if (row.status === 'fail') lines.push(`not ok ${n} - ${row.name}`);
    else if (row.status === 'skip') lines.push(`ok ${n} - ${row.name} # SKIP ${row.directive || 'skipped'}`);
    else lines.push(`ok ${n} - ${row.name}`);
    lines.push('  ---', "  type: 'test'", '  ...');
  });
  lines.push(
    `1..${cases.length}`,
    `# tests ${counts.tests}`,
    `# suites ${counts.suites || 0}`,
    `# pass ${counts.pass}`,
    `# fail ${counts.fail}`,
    `# cancelled ${counts.cancelled || 0}`,
    `# skipped ${counts.skipped}`,
    `# todo ${counts.todo || 0}`,
    '# duration_ms 1.0',
  );
  return lines.join('\n');
}

function passingInput(overrides = {}) {
  const cases = REQUIRED_CASES.map((row) => ({
    name: row.name,
    status: row.status,
    directive: row.status === 'skip' ? 'real Linux PTY evidence is not this host (darwin); skip is not a pass' : null,
  }));
  return {
    tap: tapFor(cases, { tests: 4, pass: 3, fail: 0, skipped: 1 }),
    platform: 'darwin',
    arch: 'arm64',
    osType: 'Darwin',
    nodeVersion: '22.21.0',
    headSha: HEAD,
    expectedSha: HEAD,
    workflowSha: `b${'c'.repeat(39)}`,
    eventName: 'pull_request',
    runnerOs: 'macOS',
    runnerArch: 'ARM64',
    runnerName: 'MacStudio',
    testExit: 0,
    ...overrides,
  };
}

test('required case names match the PTY acceptance file', () => {
  const src = fs.readFileSync(
    path.join(__dirname, 'operatorTuiTerminalPtyEvidence.test.js'),
    'utf8',
  );
  for (const row of REQUIRED_CASES) {
    assert.ok(src.includes(`test('${row.name}'`), row.name);
  }
});

test('darwin arm64 Node 22 evidence passes only when the macOS PTY case passes', () => {
  const report = evaluateMacosNode22PtyEvidence(passingInput());
  assert.equal(report.ok, true, report.reasons.join(','));
  assert.equal(report.kind, 'macos_node22_real_pty_evidence');
  assert.equal(report.head_sha, HEAD);
  assert.equal(report.counts.pass, 3);
  assert.equal(report.counts.skipped, 1);
  assert.equal(report.counts.fail, 0);
});

test('a skipped macOS PTY case is not a pass', () => {
  const cases = REQUIRED_CASES.map((row) => ({
    name: row.name,
    status: row.name.startsWith('macOS ') ? 'skip' : row.status,
    directive: row.name.startsWith('macOS ') ? 'skipped' : null,
  }));
  const report = evaluateMacosNode22PtyEvidence(passingInput({
    tap: tapFor(cases, { tests: 4, pass: 2, fail: 0, skipped: 2 }),
  }));
  assert.equal(report.ok, false);
  assert.ok(report.reasons.some((reason) => reason.startsWith('case_skip:macOS real PTY')));
});

test('linux host evidence is rejected', () => {
  const report = evaluateMacosNode22PtyEvidence(passingInput({
    platform: 'linux',
    arch: 'x64',
    osType: 'Linux',
    runnerOs: 'Linux',
    runnerArch: 'X64',
  }));
  assert.equal(report.ok, false);
  assert.ok(report.reasons.includes('platform:linux'));
  assert.ok(report.reasons.includes('arch:x64'));
  assert.ok(report.reasons.includes('runner_os:Linux'));
});

test('sha mismatch and old Node are rejected', () => {
  const report = evaluateMacosNode22PtyEvidence(passingInput({
    headSha: `d${'e'.repeat(39)}`,
    nodeVersion: '22.12.0',
    testExit: 1,
  }));
  assert.equal(report.ok, false);
  assert.ok(report.reasons.includes('head_sha_mismatch'));
  assert.ok(report.reasons.includes('node_version:22.12.0'));
  assert.ok(report.reasons.includes('test_exit:1'));
});

test('parser reads node TAP pass and skip lines', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: runs',
    'ok 1 - runs',
    '  ---',
    '  duration_ms: 0.555954',
    "  type: 'test'",
    '  ...',
    '# Subtest: skips',
    'ok 2 - skips # SKIP not this host',
    '  ---',
    '  duration_ms: 0.086104',
    "  type: 'test'",
    '  ...',
    '1..2',
    '# tests 2',
    '# suites 0',
    '# pass 1',
    '# fail 0',
    '# cancelled 0',
    '# skipped 1',
    '# todo 0',
    '# duration_ms 39.168842',
    '',
  ].join('\n');
  const parsed = parseTap(tap);
  assert.deepEqual(
    parsed.cases.map((row) => ({ name: row.name, status: row.status, directive: row.directive })),
    [
      { name: 'runs', status: 'pass', directive: null },
      { name: 'skips', status: 'skip', directive: 'not this host' },
    ],
  );
  assert.equal(parsed.counts.pass, 1);
  assert.equal(parsed.counts.skipped, 1);
  assert.equal(parsed.counts.fail, 0);
  assert.equal(parsed.counts.tests, 2);
});
