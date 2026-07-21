'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildRunSelectorListText,
  formatRunStatusPaneText,
  buildRunStatusPaneModel,
  resolveRunSelectorInput,
  loadRunStatusPane,
  runOperatorRunSelector,
} = require('../../modules/operator/operator-run-selector-tui');

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

test('buildRunSelectorListText empty store guidance', () => {
  const text = buildRunSelectorListText([], { useColor: false });
  assert.match(text, /run selector/);
  assert.match(text, /runs: \(none\)/);
  assert.match(text, /ai-minions smoke/);
  assert.equal(text.includes('\x1b['), false);
});

test('buildRunSelectorListText newest-first with cursor marker', () => {
  const text = buildRunSelectorListText(
    [
      { run_id: 'newer', status: 'running', outcome: 'unknown', result_code: 'RUN_STATE_UNKNOWN' },
      { run_id: 'older', status: 'complete', outcome: 'complete', result_code: 'RUN_FOUND' },
    ],
    { cursorIndex: 1, useColor: false },
  );
  assert.match(text, /> \[ 2\].*older/);
  assert.match(text, / {2}\[ 1\].*newer/);
  assert.match(text, /n\/j next/);
  assert.match(text, /p\/k prev/);
});

test('resolveRunSelectorInput index, nav, back, and run id', () => {
  const runs = [
    { run_id: 'alpha' },
    { run_id: 'beta' },
  ];
  assert.equal(resolveRunSelectorInput('2', { runs, cursorIndex: 0 }).run.run_id, 'beta');
  assert.equal(resolveRunSelectorInput('n', { runs, cursorIndex: 0 }).cursorIndex, 1);
  assert.equal(resolveRunSelectorInput('p', { runs, cursorIndex: 0 }).cursorIndex, 1);
  assert.equal(resolveRunSelectorInput('', { runs, cursorIndex: 1 }).run.run_id, 'beta');
  assert.equal(resolveRunSelectorInput('beta', { runs, cursorIndex: 0 }).run.run_id, 'beta');
  assert.equal(resolveRunSelectorInput('b', { runs, cursorIndex: 0 }).action, 'back');
  assert.equal(resolveRunSelectorInput('99', { runs, cursorIndex: 0 }).action, 'unknown');
});

test('status pane keeps invalid traces as RUN_TRACE_INVALID without inferred outcome', () => {
  const entry = {
    run_id: 'bad-trace',
    result_code: 'RUN_TRACE_INVALID',
    status: 'invalid',
    outcome: null,
    reason_code: 'OPERATOR_TRACE_INVALID',
    select_command: "ai-minions status --run-id bad-trace",
    trace_file: '/tmp/bad-trace.jsonl',
  };
  const model = buildRunStatusPaneModel(entry, {
    ok: false,
    result_code: 'RUN_TRACE_INVALID',
    reason_code: 'OPERATOR_TRACE_INVALID',
    next_safe_action: 'Trace file is empty; re-run with a valid completed trace JSONL.',
    trace_file: '/tmp/bad-trace.jsonl',
  });
  assert.equal(model.result_code, 'RUN_TRACE_INVALID');
  assert.equal(model.outcome, null);
  assert.equal(model.status, 'invalid');
  assert.equal(model.attach_action_available, false);
  const text = formatRunStatusPaneText(model, { useColor: false });
  assert.match(text, /RUN_TRACE_INVALID/);
  assert.match(text, /reason_code:\s+OPERATOR_TRACE_INVALID/);
  assert.match(text, /attach not available/);
  assert.equal(text.includes('\x1b['), false);
});

test('loadRunStatusPane covers empty store, invalid, failed, and successful runs', () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-selector-'));

  writeTrace(tracesDir, 'ok-run', [
    { event: 'session_start', task_id: 'ok-run', flow_mode: 'single_agent', ts_ms: 1 },
    { event: 'session_end', task_id: 'ok-run', done: true, gate_blocks: 0, ts_ms: 2 },
  ]);
  writeTrace(tracesDir, 'fail-run', [
    { event: 'session_start', task_id: 'fail-run', flow_mode: 'single_agent', ts_ms: 10 },
    { event: 'session_end', task_id: 'fail-run', done: false, iterations: 2, gate_blocks: 0, ts_ms: 11 },
  ]);
  fs.writeFileSync(path.join(tracesDir, 'bad-run.jsonl'), '\n', 'utf8');

  const ok = loadRunStatusPane(
    {
      run_id: 'ok-run',
      result_code: 'RUN_FOUND',
      trace_file: path.join(tracesDir, 'ok-run.jsonl'),
      select_command: 'ai-minions status --run-id ok-run',
    },
    { tracesDir },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.pane.outcome, 'complete');
  assert.match(String(ok.pane.next_safe_action), /./);
  assert.match(ok.pane.attach_hint, /ai-minions attach --run-id ok-run/);

  const failed = loadRunStatusPane(
    {
      run_id: 'fail-run',
      result_code: 'RUN_FOUND',
      trace_file: path.join(tracesDir, 'fail-run.jsonl'),
      select_command: 'ai-minions status --run-id fail-run',
    },
    { tracesDir },
  );
  assert.equal(failed.ok, true);
  assert.equal(failed.pane.outcome, 'failed');
  assert.equal(failed.pane.status, 'failed');

  const invalid = loadRunStatusPane(
    {
      run_id: 'bad-run',
      result_code: 'RUN_TRACE_INVALID',
      trace_file: path.join(tracesDir, 'bad-run.jsonl'),
      select_command: 'ai-minions status --run-id bad-run',
    },
    { tracesDir },
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.result_code, 'RUN_TRACE_INVALID');
  assert.equal(invalid.pane.outcome, null);
});

test('runOperatorRunSelector empty store returns RUN_SELECTOR_EMPTY', async () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-selector-empty-'));
  /** @type {string[]} */
  const out = [];
  const result = await runOperatorRunSelector({
    tracesDir,
    question: async () => 'b',
    write: (t) => out.push(String(t)),
    useColor: false,
  });
  assert.equal(result.reason_code, 'RUN_SELECTOR_EMPTY');
  assert.equal(result.selected_run_id, null);
  assert.ok(out.some((l) => l.includes('runs: (none)')));
});

test('runOperatorRunSelector selects by index and shows status pane', async () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-selector-pick-'));
  writeTrace(tracesDir, 'pick-me', [
    { event: 'session_start', task_id: 'pick-me', flow_mode: 'single_agent', ts_ms: 1 },
    { event: 'session_end', task_id: 'pick-me', done: true, gate_blocks: 0, ts_ms: 2 },
  ]);
  /** @type {string[]} */
  const out = [];
  const result = await runOperatorRunSelector({
    tracesDir,
    question: async () => '1',
    write: (t) => out.push(String(t)),
    useColor: false,
  });
  assert.equal(result.reason_code, 'RUN_SELECTOR_SELECTED');
  assert.equal(result.selected_run_id, 'pick-me');
  assert.ok(out.some((l) => l.includes('Status pane')));
  assert.ok(out.some((l) => l.includes('pick-me')));
  assert.ok(out.some((l) => l.includes('attach_hint:')));
});

test('selector list with useColor false never emits ANSI', () => {
  const text = buildRunSelectorListText(
    [{ run_id: 'x', status: 'failed', outcome: 'failed', result_code: 'RUN_FOUND' }],
    { useColor: false },
  );
  assert.equal(text.includes('\x1b['), false);
});

test('formatRunIdArg-safe select_command retained on pane for unsafe ids', () => {
  const model = buildRunStatusPaneModel(
    {
      run_id: 'task $(x)',
      result_code: 'RUN_TRACE_INVALID',
      select_command: "ai-minions status --run-id 'task $(x)'",
      trace_file: "/tmp/task $(x).jsonl",
    },
    { ok: false, result_code: 'RUN_TRACE_INVALID', reason_code: 'OPERATOR_TRACE_INVALID' },
  );
  assert.match(model.select_command, /'task \$\(x\)'/);
});
