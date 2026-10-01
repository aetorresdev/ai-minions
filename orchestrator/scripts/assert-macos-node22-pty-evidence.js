'use strict';

/**
 * Fail-closed report for the macOS Node 22 real-PTY acceptance run.
 * A skip of the darwin scenario is not a pass. Linux counts from another host
 * are not accepted here. No model runtime is consulted.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MIN_NODE = Object.freeze([22, 13, 0]);

const REQUIRED_CASES = Object.freeze([
  Object.freeze({
    name: 'partial restore that leaves raw mode active fails signal evidence',
    status: 'pass',
  }),
  Object.freeze({
    name: 'real PTY under CI=true still renders, navigates, and quits',
    status: 'pass',
  }),
  Object.freeze({
    name: 'Linux real PTY runs the shell for quit, Ctrl+C, SIGINT, SIGTERM, SIGHUP, fatal, master close, plus handoff restore',
    status: 'skip',
  }),
  Object.freeze({
    name: 'macOS real PTY runs the shell for quit, Ctrl+C, SIGINT, SIGTERM, SIGHUP, fatal, master close, plus handoff restore',
    status: 'pass',
  }),
]);

function parseNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(actual, minimum) {
  for (let i = 0; i < minimum.length; i += 1) {
    if (actual[i] > minimum[i]) return true;
    if (actual[i] < minimum[i]) return false;
  }
  return true;
}

/**
 * @param {string} tap
 * @returns {{ cases: Array<{ name: string, status: string, directive: string|null }>, counts: Record<string, number> }}
 */
function parseTap(tap) {
  const cases = [];
  const counts = {};
  for (const line of String(tap || '').split(/\r?\n/)) {
    const summary = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)\s*$/.exec(line);
    if (summary) {
      counts[summary[1]] = Number(summary[2]);
      continue;
    }
    const row = /^(ok|not ok) (\d+) - (.*)$/.exec(line);
    if (!row) continue;
    const rawName = row[3];
    const skip = /^(.*?) # SKIP(?: (.*))?$/.exec(rawName);
    const todo = /^(.*?) # TODO(?: (.*))?$/.exec(rawName);
    if (row[1] === 'not ok') {
      cases.push({ name: rawName, status: 'fail', directive: null });
    } else if (skip) {
      cases.push({ name: skip[1], status: 'skip', directive: skip[2] || '' });
    } else if (todo) {
      cases.push({ name: todo[1], status: 'todo', directive: null });
    } else {
      cases.push({ name: rawName, status: 'pass', directive: null });
    }
  }
  return { cases, counts };
}

function isFullSha(value) {
  return /^[0-9a-f]{40}$/.test(String(value || ''));
}

/**
 * @param {{
 *   tap: string,
 *   platform: string,
 *   arch: string,
 *   osType: string,
 *   nodeVersion: string,
 *   headSha: string,
 *   expectedSha: string,
 *   workflowSha?: string,
 *   eventName?: string,
 *   runnerOs?: string,
 *   runnerArch?: string,
 *   runnerName?: string,
 *   testExit?: number,
 * }} input
 */
function evaluateMacosNode22PtyEvidence(input) {
  const reasons = [];
  const parsed = parseTap(input.tap);
  const headSha = String(input.headSha || '');
  const expectedSha = String(input.expectedSha || '');
  const nodeVersion = parseNodeVersion(input.nodeVersion);

  if (!isFullSha(expectedSha)) reasons.push('expected_sha_invalid');
  if (!isFullSha(headSha)) reasons.push('head_sha_invalid');
  if (isFullSha(expectedSha) && isFullSha(headSha) && headSha !== expectedSha) {
    reasons.push('head_sha_mismatch');
  }
  if (input.platform !== 'darwin') reasons.push(`platform:${input.platform || 'missing'}`);
  if (input.arch !== 'arm64') reasons.push(`arch:${input.arch || 'missing'}`);
  if (input.osType !== 'Darwin') reasons.push(`os_type:${input.osType || 'missing'}`);
  if (!nodeVersion) reasons.push('node_version_invalid');
  else if (nodeVersion[0] !== 22 || !versionAtLeast(nodeVersion, MIN_NODE)) {
    reasons.push(`node_version:${input.nodeVersion}`);
  }
  if (input.runnerOs !== 'macOS') reasons.push(`runner_os:${input.runnerOs || 'missing'}`);
  if (input.runnerArch !== 'ARM64') reasons.push(`runner_arch:${input.runnerArch || 'missing'}`);
  if (Number(input.testExit) !== 0) reasons.push(`test_exit:${input.testExit}`);

  const summaryKeys = ['tests', 'pass', 'fail', 'skipped'];
  for (const key of summaryKeys) {
    if (!Number.isInteger(parsed.counts[key])) reasons.push(`tap_missing_${key}`);
  }

  const byName = new Map();
  for (const row of parsed.cases) {
    if (byName.has(row.name)) reasons.push(`duplicate_case:${row.name}`);
    byName.set(row.name, row);
  }
  for (const required of REQUIRED_CASES) {
    const found = byName.get(required.name);
    if (!found) reasons.push(`missing_case:${required.name}`);
    else if (found.status !== required.status) {
      reasons.push(`case_${found.status}:${required.name}`);
    }
  }
  if (parsed.cases.length !== REQUIRED_CASES.length) {
    reasons.push(`case_count:${parsed.cases.length}`);
  }
  if (Number.isInteger(parsed.counts.tests) && parsed.counts.tests !== REQUIRED_CASES.length) {
    reasons.push(`tap_tests:${parsed.counts.tests}`);
  }
  if (Number.isInteger(parsed.counts.fail) && parsed.counts.fail !== 0) {
    reasons.push(`tap_fail:${parsed.counts.fail}`);
  }
  const expectPass = REQUIRED_CASES.filter((row) => row.status === 'pass').length;
  const expectSkip = REQUIRED_CASES.filter((row) => row.status === 'skip').length;
  if (Number.isInteger(parsed.counts.pass) && parsed.counts.pass !== expectPass) {
    reasons.push(`tap_pass:${parsed.counts.pass}`);
  }
  if (Number.isInteger(parsed.counts.skipped) && parsed.counts.skipped !== expectSkip) {
    reasons.push(`tap_skipped:${parsed.counts.skipped}`);
  }
  if ((parsed.counts.cancelled || 0) !== 0) reasons.push(`tap_cancelled:${parsed.counts.cancelled}`);
  if ((parsed.counts.todo || 0) !== 0) reasons.push(`tap_todo:${parsed.counts.todo}`);

  const accounted = (parsed.counts.pass || 0)
    + (parsed.counts.fail || 0)
    + (parsed.counts.skipped || 0)
    + (parsed.counts.todo || 0)
    + (parsed.counts.cancelled || 0);
  if (Number.isInteger(parsed.counts.tests) && accounted !== parsed.counts.tests) {
    reasons.push(`tap_accounting:${accounted}`);
  }

  return {
    ok: reasons.length === 0,
    schema: '1',
    kind: 'macos_node22_real_pty_evidence',
    head_sha: headSha,
    expected_sha: expectedSha,
    workflow_sha: input.workflowSha || null,
    event_name: input.eventName || null,
    node: input.nodeVersion || null,
    platform: input.platform || null,
    arch: input.arch || null,
    os_type: input.osType || null,
    runner_os: input.runnerOs || null,
    runner_arch: input.runnerArch || null,
    runner_name: input.runnerName || null,
    test_exit: Number.isFinite(Number(input.testExit)) ? Number(input.testExit) : null,
    counts: {
      tests: parsed.counts.tests ?? null,
      pass: parsed.counts.pass ?? null,
      fail: parsed.counts.fail ?? null,
      skipped: parsed.counts.skipped ?? null,
    },
    cases: parsed.cases.map((row) => ({
      name: row.name,
      status: row.status,
      directive: row.directive,
    })),
    reasons,
  };
}

function readHeadSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: path.resolve(__dirname, '..', '..'),
    encoding: 'utf8',
  }).trim();
}

function renderSummary(report) {
  const counts = report.counts || {};
  const lines = [
    '## macOS Node 22 real PTY',
    '',
    `- **Result:** ${report.ok ? 'pass' : 'fail'}`,
    `- **Head SHA:** \`${report.head_sha}\``,
    `- **Workflow SHA:** \`${report.workflow_sha || ''}\``,
    `- **Event:** ${report.event_name || ''}`,
    `- **Node:** ${report.node}`,
    `- **Host:** ${report.platform} ${report.arch} (${report.os_type})`,
    `- **Runner:** ${report.runner_name || ''} (${report.runner_os} ${report.runner_arch})`,
    `- **Counts:** tests ${counts.tests}, pass ${counts.pass}, fail ${counts.fail}, skipped ${counts.skipped}`,
  ];
  for (const row of report.cases || []) {
    const directive = row.directive ? ` — ${row.directive}` : '';
    lines.push(`- **${row.status}:** ${row.name}${directive}`);
  }
  if (!report.ok) {
    lines.push('', '### Reasons', '');
    for (const reason of report.reasons || []) lines.push(`- \`${reason}\``);
  }
  lines.push('');
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { tap: '', out: '', testExit: '0' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tap') args.tap = argv[i + 1];
    else if (arg === '--out') args.out = argv[i + 1];
    else if (arg === '--test-exit') args.testExit = argv[i + 1];
    else throw new Error(`unknown argument ${arg}`);
    if (arg === '--tap' || arg === '--out' || arg === '--test-exit') i += 1;
  }
  if (!args.tap || !args.out) {
    throw new Error('usage: --tap <file> --out <file> --test-exit <code>');
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  let tap = '';
  try {
    tap = fs.readFileSync(args.tap, 'utf8');
  } catch (err) {
    tap = '';
    process.stderr.write(`tap_unreadable:${err && err.message ? err.message : err}\n`);
  }
  let headSha = '';
  try {
    headSha = readHeadSha();
  } catch (err) {
    headSha = '';
    process.stderr.write(`head_sha_unreadable:${err && err.message ? err.message : err}\n`);
  }
  const report = evaluateMacosNode22PtyEvidence({
    tap,
    platform: os.platform(),
    arch: os.arch(),
    osType: os.type(),
    nodeVersion: process.versions.node,
    headSha,
    expectedSha: process.env.EXPECTED_SHA || '',
    workflowSha: process.env.GITHUB_SHA || '',
    eventName: process.env.GITHUB_EVENT_NAME || '',
    runnerOs: process.env.RUNNER_OS || '',
    runnerArch: process.env.RUNNER_ARCH || '',
    runnerName: process.env.RUNNER_NAME || '',
    testExit: Number(args.testExit),
  });
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  const summary = renderSummary(report);
  process.stdout.write(`${summary}\n`);
  process.stdout.write(`evidence_head_sha=${report.head_sha} evidence_ok=${report.ok}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  return report.ok ? 0 : 1;
}

module.exports = {
  REQUIRED_CASES,
  parseTap,
  evaluateMacosNode22PtyEvidence,
  renderSummary,
};

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}
