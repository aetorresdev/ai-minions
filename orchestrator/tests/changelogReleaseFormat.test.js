"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const {
  ALPHA_ENFORCE_FROM,
  ALPHA_MARKERS,
  parseReleaseSections,
  profileForVersion,
  validateChangelogReleaseFormat,
  validateReleaseSection,
} = require("../scripts/lib/changelog-release-section");

const CHANGELOG_PATH = path.join(__dirname, "..", "..", "CHANGELOG.md");
const FORMAT_DOC_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "changelog-release-format.md");
const WORKFLOW_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "release-workflow.md");

describe("changelog-release-format contract doc", () => {
  it("defines alpha profile markers and template", () => {
    const doc = fs.readFileSync(FORMAT_DOC_PATH, "utf8");
    assert.match(doc, /Alpha profile — mandatory block order/);
    assert.match(doc, /\*\*Release claim:\*\*/);
    assert.match(doc, /\*\*Evidence \(operator\):\*\*/);
    assert.match(doc, /Copy-paste template/);
    for (const marker of ALPHA_MARKERS) {
      if (marker.id === "added") {
        assert.match(doc, /### Added/);
      } else {
        assert.match(doc, marker.pattern);
      }
    }
  });

  it("release-workflow references changelog format contract", () => {
    const doc = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(doc, /changelog-release-format\.md/);
  });
});

describe("validateChangelogReleaseFormat", () => {
  it("accepts alpha sections from enforce floor onward in CHANGELOG.md", () => {
    const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");
    const result = validateChangelogReleaseFormat(changelog);
    assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  });

  it("accepts v0.8.0-alpha.1 section with alpha profile", () => {
    const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");
    const section = parseReleaseSections(changelog).find((s) => s.version === "0.8.0-alpha.1");
    assert.ok(section);
    assert.equal(profileForVersion(section.version), "alpha");
    const result = validateReleaseSection(section.body, "alpha");
    assert.equal(result.ok, true, result.errors.join("; "));
  });

  it("uses legacy profile for pre-0.6 versions", () => {
    assert.equal(profileForVersion("0.5.0-alpha.1"), "legacy");
    assert.equal(profileForVersion("0.1.0-alpha.1"), "legacy");
  });

  it("blocks alpha section missing release claim", () => {
    const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");
    const section = parseReleaseSections(changelog).find((s) => s.version === "0.8.0-alpha.1");
    assert.ok(section);
    const body = section.body.replace(/\*\*Release claim:\*\*[^\n]*\n?/, "");
    const result = validateReleaseSection(body, "alpha");
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("missing:release_claim"));
  });

  it("enforcement floor is 0.6.0-alpha.1", () => {
    assert.equal(ALPHA_ENFORCE_FROM, "0.6.0-alpha.1");
    assert.equal(profileForVersion("0.6.0-alpha.1"), "alpha");
    assert.equal(profileForVersion("0.5.0-alpha.1"), "legacy");
  });
});
