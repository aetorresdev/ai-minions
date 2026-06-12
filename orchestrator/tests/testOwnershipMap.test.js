'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  OWNERS,
  KINDS,
  ENTRIES,
  listTestFiles,
  validateTestOwnershipMap,
  countByOwner,
} = require('../scripts/test-ownership-map');

describe('test-ownership-map', () => {
  it('maps every tests/**/*.test.js file with no orphans or stale entries', () => {
    const result = validateTestOwnershipMap();
    assert.equal(
      result.ok,
      true,
      [
        result.orphans.length ? `orphans:\n  ${result.orphans.join('\n  ')}` : '',
        result.stale.length ? `stale:\n  ${result.stale.join('\n  ')}` : '',
        result.invalid.length ? `invalid:\n  ${result.invalid.join('\n  ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    assert.equal(result.fileCount, result.entryCount);
    assert.equal(result.fileCount, listTestFiles().length);
  });

  it('uses only declared owners and kinds', () => {
    for (const [rel, meta] of Object.entries(ENTRIES)) {
      assert.ok(OWNERS.includes(meta.owner), `${rel} owner ${meta.owner}`);
      assert.ok(KINDS.includes(meta.kind), `${rel} kind ${meta.kind}`);
    }
  });

  it('labels cross-context tests as integration, contract, e2e, or architecture', () => {
    const crossKinds = new Set(['integration', 'contract', 'e2e', 'architecture']);
    const crossContext = Object.entries(ENTRIES).filter(([, m]) => crossKinds.has(m.kind));
    assert.ok(crossContext.length >= 20, 'expected explicit cross-context labels');
    const integration = crossContext.filter(([, m]) => m.kind === 'integration');
    assert.ok(integration.length >= 5, 'integration tests should be explicit');
  });

  it('places first-wave module-owned unit tests under tests/<owner>/', () => {
    const wave1 = ['trace', 'budget', 'worktree', 'operator'];
    for (const [rel, meta] of Object.entries(ENTRIES)) {
      if (wave1.includes(meta.owner) && meta.kind === 'unit') {
        assert.ok(
          rel.startsWith(`tests/${meta.owner}/`),
          `${rel} should live under tests/${meta.owner}/`,
        );
      }
    }
  });

  it('covers each bounded-context owner at least once', () => {
    const counts = countByOwner();
    for (const owner of OWNERS) {
      assert.ok(counts[owner] > 0, `no tests mapped to owner ${owner}`);
    }
  });
});
