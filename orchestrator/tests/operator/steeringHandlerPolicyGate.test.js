'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  evaluateSteeringHandlerPolicy,
  isMutationSteeringAction,
  suggestsBlockedAdvance,
} = require('../../modules/operator/steering-handler-policy-gate');

test('evaluateSteeringHandlerPolicy fails closed without trace', () => {
  const r = evaluateSteeringHandlerPolicy({
    surface: 'status',
    proposed_action: 'advance to merge',
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason_code, 'STEERING_TRACE_REQUIRED');
});

test('evaluateSteeringHandlerPolicy blocks mutation on read-only tui', () => {
  const r = evaluateSteeringHandlerPolicy({
    surface: 'tui',
    trace_loaded: true,
    read_only: true,
    proposed_action: 'approve merge',
    trace_ref: '/traces/t.jsonl',
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason_code, 'STEERING_READ_ONLY_SURFACE');
});

test('evaluateSteeringHandlerPolicy blocks advance steering on blocked runs', () => {
  const r = evaluateSteeringHandlerPolicy({
    surface: 'guided',
    trace_loaded: true,
    blocked: true,
    outcome: 'blocked',
    proposed_action: 'approve release',
    trace_ref: '/traces/t.jsonl',
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason_code, 'STEERING_BLOCKED_ADVANCE');
});

test('suggestsBlockedAdvance ignores do-not-merge guidance', () => {
  assert.equal(
    suggestsBlockedAdvance('Do not merge or claim gate-complete until blockers are resolved.'),
    false,
  );
});

test('isMutationSteeringAction detects approve prefix', () => {
  assert.equal(isMutationSteeringAction('approve merge'), true);
  assert.equal(isMutationSteeringAction('inspect trace only'), false);
});

test('evaluateSteeringHandlerPolicy allows trace-backed informational steering', () => {
  const r = evaluateSteeringHandlerPolicy({
    surface: 'tui',
    trace_loaded: true,
    read_only: true,
    outcome: 'complete',
    proposed_action: 'Run may advance; attach trace and report bundle if handing off to review.',
    trace_ref: '/traces/t.jsonl',
  });
  assert.equal(r.allowed, true);
  assert.equal(r.reason_code, 'STEERING_ALLOWED');
});
