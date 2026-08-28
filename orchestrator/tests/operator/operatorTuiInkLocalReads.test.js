'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isInkLocalAsyncReadAction,
  loadInkLocalReadPayload,
} = require('../../modules/operator/operator-tui-ink-local-reads');

test('isInkLocalAsyncReadAction recognizes status monitor explain only', () => {
  assert.equal(isInkLocalAsyncReadAction('status'), true);
  assert.equal(isInkLocalAsyncReadAction('monitor'), true);
  assert.equal(isInkLocalAsyncReadAction('explain'), true);
  assert.equal(isInkLocalAsyncReadAction('attach'), false);
  assert.equal(isInkLocalAsyncReadAction('home'), false);
});

test('loadInkLocalReadPayload uses injected operator readers', async () => {
  let seenRunId = null;
  const payload = await loadInkLocalReadPayload('status', {
    runId: 'run-test',
    runStatus: ({ runId }) => {
      seenRunId = runId;
      return { ok: true, exitCode: 0, json: { run_id: runId, status: 'RUNNING' } };
    },
  });
  assert.equal(seenRunId, 'run-test');
  assert.equal(payload.json.status, 'RUNNING');
});

test('loadInkLocalReadPayload honors abortSignal', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => loadInkLocalReadPayload('monitor', {
      runId: 'run-a',
      abortSignal: controller.signal,
      runStatus: () => ({ ok: true, json: { run_id: 'run-a' } }),
    }),
    (err) => err?.name === 'AbortError',
  );
});
