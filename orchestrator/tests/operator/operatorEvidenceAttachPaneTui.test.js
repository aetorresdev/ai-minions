'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildAttachCommand,
  buildEvidenceAttachPaneModel,
  formatEvidenceAttachPaneText,
  formatCopyableAttachBlock,
  resolveEvidenceAttachPaneInput,
  loadEvidenceAttachPane,
  mergeAttachOutputPaths,
  runOperatorEvidenceAttachPane,
} = require('../../modules/operator/operator-evidence-attach-pane-tui');

/**
 * @param {string} dir
 * @param {string} name
 * @param {object[]} rows
 */
function writeTrace(dir, name, rows) {
  fs.writeFileSync(
    path.join(dir, `${name}.jsonl`),
    rows.map((row) => JSON.stringify(row)).join('\n'),
    'utf8',
  );
}

/**
 * @param {string} repoRoot
 * @param {string} taskId
 * @returns {string} bundle dir
 */
function writeBundle(repoRoot, taskId) {
  const bundleDir = path.join(repoRoot, 'report-bundles', `${taskId}-20260101T000000Z`);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'inspect-report.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'ATTACH.md'), '# attach\n', 'utf8');
  return bundleDir;
}

test('resolveEvidenceAttachPaneInput maps a/c/r/b', () => {
  assert.equal(resolveEvidenceAttachPaneInput('a').action, 'attach');
  assert.equal(resolveEvidenceAttachPaneInput('attach').action, 'attach');
  assert.equal(resolveEvidenceAttachPaneInput('c').action, 'copy');
  assert.equal(resolveEvidenceAttachPaneInput('r').action, 'refresh');
  assert.equal(resolveEvidenceAttachPaneInput('b').action, 'back');
  assert.equal(resolveEvidenceAttachPaneInput('x').action, 'unknown');
});

test('buildAttachCommand quotes unsafe run ids', () => {
  assert.equal(buildAttachCommand('safe-run'), 'ai-minions attach --run-id safe-run');
  assert.equal(
    buildAttachCommand('task $(x)'),
    "ai-minions attach --run-id 'task $(x)'",
  );
  const model = buildEvidenceAttachPaneModel({
    run_id: 'task $(x)',
    ctx: {
      ok: false,
      result_code: 'RUN_TRACE_INVALID',
      reason_code: 'OPERATOR_TRACE_INVALID',
      next_safe_action: 'Inspect the trace',
      trace_file: "/tmp/task $(x).jsonl",
    },
  });
  assert.match(model.attach_command, /'task \$\(x\)'/);
  const text = formatEvidenceAttachPaneText(model, { useColor: false });
  assert.match(text, /attach --run-id 'task \$\(x\)'/);
  assert.equal(text.includes('\x1b['), false);
});

test('pane with bundle missing keeps attach_available false and encourages attach', () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-ev-missing-'));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-ev-repo-'));
  writeTrace(tracesDir, 'no-bundle', [
    { event: 'session_start', task_id: 'no-bundle', flow_mode: 'single_agent', ts_ms: 1 },
    { event: 'session_end', task_id: 'no-bundle', done: true, gate_blocks: 0, ts_ms: 2 },
  ]);

  const loaded = loadEvidenceAttachPane('no-bundle', { tracesDir, repoRoot });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.pane.attach_available, false);
  assert.equal(loaded.pane.attach_bundle_available, false);
  assert.equal(loaded.pane.attach_action_available, true);
  assert.match(String(loaded.pane.attach_note), /bundle on disk/i);
  assert.match(loaded.pane.attach_command, /ai-minions attach --run-id no-bundle/);
  assert.match(String(loaded.pane.trace_path), /no-bundle\.jsonl$/);
  assert.match(String(loaded.pane.next_safe_action), /./);

  const text = formatEvidenceAttachPaneText(loaded.pane, { useColor: false });
  assert.match(text, /attach_available:\s+false/);
  assert.match(text, /attach can still create useful evidence/i);
  assert.match(text, /attach_command:.*attach --run-id no-bundle/);
  assert.match(text, /Copyable output paths/);
  assert.equal(text.includes('\x1b['), false);
});

test('pane with bundle present lists copyable output paths', () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-ev-present-'));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-ev-repo-p-'));
  writeTrace(tracesDir, 'with-bundle', [
    { event: 'session_start', task_id: 'with-bundle', flow_mode: 'single_agent', ts_ms: 1 },
    { event: 'session_end', task_id: 'with-bundle', done: true, gate_blocks: 0, ts_ms: 2 },
  ]);
  const bundleDir = writeBundle(repoRoot, 'with-bundle');

  const loaded = loadEvidenceAttachPane('with-bundle', { tracesDir, repoRoot });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.pane.attach_available, true);
  assert.equal(loaded.pane.attach_bundle_available, true);
  assert.equal(loaded.pane.attach_bundle, bundleDir);
  assert.ok(loaded.pane.output_paths.includes(bundleDir));
  assert.ok(loaded.pane.output_paths.some((p) => p.endsWith('inspect-report.json')));
  assert.ok(loaded.pane.output_paths.some((p) => p.endsWith('ATTACH.md')));

  const text = formatEvidenceAttachPaneText(loaded.pane, { useColor: false });
  assert.match(text, /attach_available:\s+true/);
  assert.doesNotMatch(text, /attach_note:/);
  assert.ok(text.includes(bundleDir));
  assert.equal(text.includes('\x1b['), false);

  const copy = formatCopyableAttachBlock(loaded.pane);
  assert.match(copy, /attach_command: ai-minions attach --run-id with-bundle/);
  assert.ok(copy.includes(bundleDir));
});

test('ended/blocked run without bundle still exposes attach action', () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-ev-blocked-'));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-ev-repo-b-'));
  writeTrace(tracesDir, 'blocked-run', [
    { event: 'session_start', task_id: 'blocked-run', flow_mode: 'single_agent', ts_ms: 1 },
    {
      event: 'gate_block',
      gate: 'CERBERUS',
      reason_code: 'CERBERUS_REJECT',
      task_id: 'blocked-run',
      ts_ms: 2,
    },
    {
      event: 'session_end',
      task_id: 'blocked-run',
      done: false,
      gate_blocks: 1,
      iterations: 1,
      ts_ms: 3,
    },
  ]);

  const loaded = loadEvidenceAttachPane('blocked-run', { tracesDir, repoRoot });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.pane.attach_available, false);
  assert.equal(loaded.pane.attach_action_available, true);
  assert.match(String(loaded.pane.attach_note), /no bundle on disk/);
  assert.ok(['failed', 'blocked'].includes(String(loaded.pane.outcome)));
  const text = formatEvidenceAttachPaneText(loaded.pane, { useColor: false });
  assert.match(text, /\[a\] run attach/);
  assert.match(text, /attach_available=false is bundle-on-disk only/);
});

test('invalid trace pane does not claim attach action', () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-ev-bad-'));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-ev-repo-bad-'));
  fs.writeFileSync(path.join(tracesDir, 'bad.jsonl'), '\n', 'utf8');
  const loaded = loadEvidenceAttachPane('bad', { tracesDir, repoRoot });
  assert.equal(loaded.ok, false);
  assert.equal(loaded.pane.result_code, 'RUN_TRACE_INVALID');
  assert.equal(loaded.pane.attach_action_available, false);
  assert.equal(loaded.pane.outcome, null);
});

test('mergeAttachOutputPaths prepends bundle_dir after attach', () => {
  const merged = mergeAttachOutputPaths(
    {
      attach_available: false,
      attach_bundle_available: false,
      attach_bundle: null,
      output_paths: ['/tmp/trace.jsonl'],
      attach_command: 'ai-minions attach --run-id x',
    },
    { bundle_dir: '/tmp/report-bundles/x-1' },
  );
  assert.equal(merged.attach_available, true);
  assert.equal(merged.output_paths[0], '/tmp/report-bundles/x-1');
});

test('runOperatorEvidenceAttachPane triggers attach and shows copyable paths', async () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-ev-run-'));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-ev-repo-r-'));
  writeTrace(tracesDir, 'pane-run', [
    { event: 'session_start', task_id: 'pane-run', flow_mode: 'single_agent', ts_ms: 1 },
    { event: 'session_end', task_id: 'pane-run', done: true, gate_blocks: 0, ts_ms: 2 },
  ]);

  /** @type {string[]} */
  const answers = ['a', 'c', 'b'];
  /** @type {string[]} */
  const out = [];
  let attachCalls = 0;

  const result = await runOperatorEvidenceAttachPane({
    runId: 'pane-run',
    tracesDir,
    repoRoot,
    useColor: false,
    question: async () => answers.shift() ?? 'b',
    write: (t) => out.push(String(t)),
    runAttachFn: async ({ runId }) => {
      attachCalls += 1;
      const bundleDir = writeBundle(repoRoot, runId);
      return {
        ok: true,
        exitCode: 0,
        reason_code: 'ATTACH_OK',
        text: `bundle written to ${bundleDir}`,
        report: { ok: true, bundle_dir: bundleDir },
      };
    },
  });

  assert.equal(result.reason_code, 'EVIDENCE_ATTACH_PANE_BACK');
  assert.equal(attachCalls, 1);
  assert.ok(out.some((l) => l.includes('evidence / attach pane')));
  assert.ok(out.some((l) => l.includes('Running: ai-minions attach --run-id pane-run')));
  assert.ok(out.some((l) => l.includes('-- copyable --')));
  assert.ok(out.some((l) => l.includes('report-bundles')));
});

test('runOperatorEvidenceAttachPane requires run-id', async () => {
  /** @type {string[]} */
  const out = [];
  const result = await runOperatorEvidenceAttachPane({
    runId: '',
    question: async () => 'b',
    write: (t) => out.push(String(t)),
  });
  assert.equal(result.reason_code, 'EVIDENCE_ATTACH_PANE_RUN_ID_MISSING');
  assert.ok(out.some((l) => /run-id required/i.test(l)));
});

test('formatEvidenceAttachPaneText with useColor false never emits ANSI', () => {
  const text = formatEvidenceAttachPaneText(
    {
      run_id: 'x',
      trace_basename: 'x',
      trace_path: '/t/x.jsonl',
      result_code: 'RUN_FOUND',
      status: 'failed',
      outcome: 'failed',
      reason_code: null,
      next_safe_action: 'attach',
      attach_available: false,
      attach_bundle_available: false,
      attach_action_available: true,
      attach_result_code: 'RUN_ATTACH_READY',
      attach_note: 'attach_available=false means no bundle on disk yet; attach can still create useful evidence',
      attach_command: 'ai-minions attach --run-id x',
      attach_command_copyable: true,
      output_paths: [],
      attach_bundle: null,
      report_path: null,
      attach_md: null,
      privacy_notice_status: 'unknown',
      evidence_paths: [],
    },
    { useColor: false },
  );
  assert.equal(text.includes('\x1b['), false);
});
