"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const {
  normalizeProductVersion,
  readLatestChangelogVersion,
  readProductVersionFromFile,
  validateProductVersionSync,
} = require("../scripts/lib/product-version-sync");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CHANGELOG_PATH = path.join(REPO_ROOT, "CHANGELOG.md");
const WORKFLOW_PATH = path.join(REPO_ROOT, "docs", "orchestrator", "release-workflow.md");
const FORMAT_DOC_PATH = path.join(REPO_ROOT, "docs", "orchestrator", "changelog-release-format.md");

describe("product-version-sync", () => {
  it("normalizes changelog versions with v prefix", () => {
    assert.equal(normalizeProductVersion("0.24.0-beta.1"), "v0.24.0-beta.1");
    assert.equal(normalizeProductVersion("v0.24.0-beta.1"), "v0.24.0-beta.1");
  });

  it("reads latest tagged section after [Unreleased]", () => {
    const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");
    assert.equal(readLatestChangelogVersion(changelog), "v0.24.0-beta.1");
  });

  it("PRODUCT_VERSION matches latest CHANGELOG section on repo tree", () => {
    const result = validateProductVersionSync(REPO_ROOT);
    assert.equal(result.ok, true, result.errors.join("; "));
    assert.equal(result.productVersion, result.changelogVersion);
    assert.equal(readProductVersionFromFile(REPO_ROOT), result.productVersion);
  });

  it("fails when PRODUCT_VERSION drifts from CHANGELOG", () => {
    const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");
    const result = validateProductVersionSync(REPO_ROOT, {
      changelog,
      productVersion: "v0.21.0-beta.1",
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /must match latest CHANGELOG section/);
  });

  it("release-workflow documents mandatory product-version bump", () => {
    const doc = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(doc, /product-version\.js/);
    assert.match(doc, /PRODUCT_VERSION/);
  });

  it("changelog format doc references product-version sync validator", () => {
    const doc = fs.readFileSync(FORMAT_DOC_PATH, "utf8");
    assert.match(doc, /product-version-sync/);
  });
});
