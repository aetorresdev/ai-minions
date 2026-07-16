'use strict';

/**
 * Product release version (operator-facing). Distinct from orchestrator/package.json version.
 * MUST match the latest tagged section in root CHANGELOG.md — enforced by productVersionSync.test.js.
 */
const PRODUCT_VERSION = 'v0.23.0-beta.1';

module.exports = {
  PRODUCT_VERSION,
};
