'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { loadOperatorTraceContext } = require('../../modules/operator/operator-trace-command');
const {
  runTraceBasedEvalFixture,
  evaluateLoadedOperatorContext,
  evaluateMissingTraceContext,
  collectTraceBlockingReasonCodes,
  findForbiddenClaim,
} = require('../../modules/operator/operator-trace-based-evals');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'operator-trace-summary');

function fixtureLoadContext(opts) {
  return loadOperatorTraceContext({
    ...opts,
    existsSync: (p) => !String(p).includes('missing-eval-fixture'),
    readFileSync: (p) => {
      const base = path.basename(p);
      if (fs.existsSync(path.join(FIXTURES, base))) {
        return fs.readFileSync(path.join(FIXTURES, base), 'utf8');
      }
      return fs.readFileSync(p, 'utf8');
    },
    repoRoot: '/tmp/repo',
  });
}

const FIXTURE_CASES = [
  { name: 'complete.v1.jsonl', expectOutcome: 'complete' },
  { name: 'blocked.v1.jsonl', expectOutcome: 'blocked', expectTraceBlocking: 'FRONTIER_UNAUTHORIZED_SOURCE' },
  { name: 'degraded.v1.jsonl', expectOutcome: 'degraded' },
];

for (const fc of FIXTURE_CASES) {
  test(`trace-based eval passes fixture ${fc.name}`, () => {
    const filePath = path.join(FIXTURES, fc.name);
    const { eval: result } = runTraceBasedEvalFixture({
      filePath,
      loadContext: fixtureLoadContext,
    });
    assert.equal(result.ok, true, result.failures.join('; '));
    const ctx = fixtureLoadContext({ filePath });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.summary.outcome, fc.expectOutcome);
    if (fc.expectTraceBlocking) {
      const codes = collectTraceBlockingReasonCodes(ctx.rows);
      assert.ok(codes.includes(fc.expectTraceBlocking));
      const gateHit = (ctx.summary.blocked_gates || []).some((g) => g.includes(fc.expectTraceBlocking));
      assert.ok(gateHit, `blocked_gates should reference ${fc.expectTraceBlocking}`);
    }
  });
}

test('collectTraceBlockingReasonCodes reads model_tier_gate_denied', () => {
  const ctx = fixtureLoadContext({ filePath: path.join(FIXTURES, 'blocked.v1.jsonl') });
  assert.equal(ctx.ok, true);
  const codes = collectTraceBlockingReasonCodes(ctx.rows);
  assert.deepEqual(codes, ['FRONTIER_UNAUTHORIZED_SOURCE']);
});

test('trace-based eval fails closed on missing trace', () => {
  const ctx = fixtureLoadContext({
    filePath: path.join(FIXTURES, 'missing-eval-fixture.jsonl'),
    runId: 'missing-eval-fixture',
  });
  assert.equal(ctx.ok, false);
  const result = evaluateMissingTraceContext(ctx);
  assert.equal(result.ok, true, result.failures.join('; '));
});

test('blocked fixture TUI does not claim complete outcome', () => {
  const ctx = fixtureLoadContext({ filePath: path.join(FIXTURES, 'blocked.v1.jsonl') });
  assert.equal(ctx.ok, true);
  const result = evaluateLoadedOperatorContext(ctx);
  assert.equal(result.ok, true, result.failures.join('; '));
  const outcomeCheck = result.checks.find((c) => c.id === 'outcome_not_false_complete');
  assert.ok(outcomeCheck?.pass);
});

test('complete fixture management summary does not invent billing USD', () => {
  const ctx = fixtureLoadContext({ filePath: path.join(FIXTURES, 'complete.v1.jsonl') });
  assert.equal(ctx.ok, true);
  assert.equal(ctx.cost_token_summary.run.cost_status, 'not_billing');
  const result = evaluateLoadedOperatorContext(ctx);
  assert.equal(result.ok, true, result.failures.join('; '));
});

test('forbidden claim scan resumes after Not claimed section', () => {
  const hit = findForbiddenClaim([
    '## Not claimed',
    '- Business ROI or productivity metrics',
    '',
    '## Management summary',
    'This run is production-ready and guaranteed.',
  ].join('\n'));
  assert.ok(hit);
});

test('forbidden claim scan catches report text after attach Not claimed section', () => {
  const hit = findForbiddenClaim([
    '# Attach management',
    '## Not claimed',
    '- Production-ready operation',
    '',
    '# Operator report',
    'This run is production-ready.',
  ].join('\n'));
  assert.ok(hit);
});

test('forbidden claim scan ignores negated billing-accurate disclaimers', () => {
  const hit = findForbiddenClaim(
    '> **Read-only RUN_ANALYST** — trace-derived narrative; not billing-accurate.',
  );
  assert.equal(hit, undefined);
});

test('forbidden claim scan ignores unsupported-claim checklist wording', () => {
  const hit = findForbiddenClaim(
    '[ ] No unsupported ROI/billing/productivity claims',
  );
  assert.equal(hit, undefined);
});
