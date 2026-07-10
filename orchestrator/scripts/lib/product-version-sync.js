"use strict";

/**
 * Ensures operator-facing PRODUCT_VERSION matches the latest tagged CHANGELOG section.
 * @see docs/orchestrator/release-workflow.md — release-prep must bump product-version.js
 */

const fs = require("fs");
const path = require("path");
const { parseReleaseSections } = require("./changelog-release-section");

const PRODUCT_VERSION_RE = /const\s+PRODUCT_VERSION\s*=\s*'([^']+)'/;

/**
 * @param {string} version
 * @returns {string}
 */
function normalizeProductVersion(version) {
  const trimmed = String(version).trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

/**
 * @param {string} repoRoot
 * @returns {string|null}
 */
function readProductVersionFromFile(repoRoot) {
  const filePath = path.join(repoRoot, "orchestrator/modules/operator/product-version.js");
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(PRODUCT_VERSION_RE);
  return match ? match[1] : null;
}

/**
 * @param {string} changelog
 * @returns {string|null}
 */
function readLatestChangelogVersion(changelog) {
  const sections = parseReleaseSections(changelog);
  const latest = sections.find((section) => section.version !== "Unreleased");
  return latest ? normalizeProductVersion(latest.version) : null;
}

/**
 * @param {string} repoRoot
 * @param {{ changelog?: string, productVersion?: string }} [options]
 * @returns {{ ok: boolean, productVersion: string|null, changelogVersion: string|null, errors: string[] }}
 */
function validateProductVersionSync(repoRoot, options = {}) {
  const errors = [];
  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  const changelog =
    options.changelog ?? (fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "");
  const productVersion =
    options.productVersion ?? readProductVersionFromFile(repoRoot);
  const changelogVersion = readLatestChangelogVersion(changelog);

  if (!productVersion) {
    errors.push("product-version.js: missing PRODUCT_VERSION constant");
  }
  if (!changelogVersion) {
    errors.push("CHANGELOG.md: no tagged release section found (expected after [Unreleased])");
  }
  if (productVersion && changelogVersion) {
    const normalizedProduct = normalizeProductVersion(productVersion);
    if (normalizedProduct !== changelogVersion) {
      errors.push(
        `PRODUCT_VERSION (${normalizedProduct}) must match latest CHANGELOG section (${changelogVersion})`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    productVersion: productVersion ? normalizeProductVersion(productVersion) : null,
    changelogVersion,
    errors,
  };
}

module.exports = {
  PRODUCT_VERSION_RE,
  normalizeProductVersion,
  readProductVersionFromFile,
  readLatestChangelogVersion,
  validateProductVersionSync,
};
