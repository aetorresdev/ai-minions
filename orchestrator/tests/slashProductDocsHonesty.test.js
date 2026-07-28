'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { getRepoRoot } = require('../repo-root');

describe('slash product docs honesty', () => {
  it('public contract pages do not describe slash commands as unavailable', async () => {
    const claimsUrl = pathToFileURL(
      path.join(getRepoRoot(), 'scripts/lib/operator-doc-claims.mjs'),
    ).href;
    const {
      SLASH_PRODUCT_HONESTY_PATHS,
      checkSlashUnavailableProductClaims,
      lineAllowsSlashUnavailableQualification,
    } = await import(claimsUrl);

    assert.ok(SLASH_PRODUCT_HONESTY_PATHS.includes('docs/how-to/operator-visibility-guide.md'));
    assert.ok(SLASH_PRODUCT_HONESTY_PATHS.includes('docs/orchestrator/ink7-framework-decision.md'));

    const failures = [];
    for (const fileRel of SLASH_PRODUCT_HONESTY_PATHS) {
      const abs = path.join(getRepoRoot(), fileRel);
      assert.ok(fs.existsSync(abs), `missing ${fileRel}`);
      const text = fs.readFileSync(abs, 'utf8');
      checkSlashUnavailableProductClaims(text, fileRel, (msg) => failures.push(msg));
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  it('allows ADR-scoped qualification without treating slash as product-unavailable', async () => {
    const claimsUrl = pathToFileURL(
      path.join(getRepoRoot(), 'scripts/lib/operator-doc-claims.mjs'),
    ).href;
    const {
      checkSlashUnavailableProductClaims,
      lineAllowsSlashUnavailableQualification,
    } = await import(claimsUrl);

    const adrLine =
      '**Not in this ADR alone:** slash commands (this ADR did not introduce them), Web UI.';
    assert.equal(lineAllowsSlashUnavailableQualification(adrLine), true);

    const failures = [];
    checkSlashUnavailableProductClaims(
      `${adrLine}\n`,
      'docs/orchestrator/ink7-framework-decision.md',
      (msg) => failures.push(msg),
    );
    assert.deepEqual(failures, []);

    checkSlashUnavailableProductClaims(
      '**Not claimed:** slash commands · Web UI\n',
      'docs/how-to/operator-visibility-guide.md',
      (msg) => failures.push(msg),
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /stale no-claim/);
  });
});
