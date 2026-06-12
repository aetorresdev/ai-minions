"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const { validateReleaseGovernanceRecord } = require("../scripts/lib/release-governance-record");

const WORKFLOW_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "release-workflow.md");
const CONTRACT_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "release-governance-contract.md");
const CHECKLIST_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "alpha-release-checklist.md");
const FIXTURE_COMPLETE = path.join(__dirname, "fixtures", "release-governance-record.complete.json");

describe("release-workflow contract", () => {
  it("distinguishes pre-tag and post-tag phases", () => {
    const doc = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(doc, /Phase A — Release prep \(pre-tag/i);
    assert.match(doc, /Phase B — Tag and publish \(post-tag/i);
    assert.match(doc, /Do not mark post-tag items complete before the artifact exists/i);
  });

  it("documents human-owned steps and forbids automation claims", () => {
    const doc = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(doc, /human-owned/i);
    assert.match(doc, /must not.*tag or release publish/i);
    assert.match(doc, /Forbidden release claims/i);
    assert.match(doc, /Not.*full release automation/i);
  });

  it("cross-links governance contract and checklist", () => {
    const doc = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(doc, /release-governance-contract\.md/);
    assert.match(doc, /alpha-release-checklist\.md/);
  });
});

describe("release-governance contract", () => {
  it("defines required record fields and fail-closed validator", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /validateReleaseGovernanceRecord/);
    assert.match(doc, /evidence_status/);
    assert.match(doc, /Fail-closed/i);
    assert.match(doc, /allow_tag_publish/);
    assert.match(doc, /block/);
    assert.match(doc, /unknown/i);
  });

  it("states out of scope for full automation", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /Out of scope/i);
    assert.match(doc, /Agent-owned protected tag/i);
    assert.match(doc, /production-ready/i);
  });

  it("alpha-release-checklist references release discipline", () => {
    const doc = fs.readFileSync(CHECKLIST_PATH, "utf8");
    assert.match(doc, /release-workflow\.md/);
    assert.match(doc, /release-governance-contract\.md/);
  });
});

describe("validateReleaseGovernanceRecord", () => {
  it("accepts complete fixture record", () => {
    const record = JSON.parse(fs.readFileSync(FIXTURE_COMPLETE, "utf8"));
    const result = validateReleaseGovernanceRecord(record);
    assert.equal(result.ok, true, result.errors.join("; "));
    assert.equal(result.decision, "allow_tag_publish");
  });

  it("blocks missing pre_release_url", () => {
    const record = JSON.parse(fs.readFileSync(FIXTURE_COMPLETE, "utf8"));
    delete record.pre_release_url;
    const result = validateReleaseGovernanceRecord(record);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("missing:pre_release_url"));
    assert.equal(result.decision, "block");
  });

  it("blocks unknown evidence_status", () => {
    const record = JSON.parse(fs.readFileSync(FIXTURE_COMPLETE, "utf8"));
    record.evidence_status = "unknown";
    const result = validateReleaseGovernanceRecord(record);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("evidence_status_unknown"));
  });

  it("blocks incomplete evidence_status", () => {
    const record = JSON.parse(fs.readFileSync(FIXTURE_COMPLETE, "utf8"));
    record.evidence_status = "incomplete";
    const result = validateReleaseGovernanceRecord(record);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("evidence_status_incomplete"));
  });

  it("blocks invalid pre_release_url scheme", () => {
    const record = JSON.parse(fs.readFileSync(FIXTURE_COMPLETE, "utf8"));
    record.pre_release_url = "ftp://example.com/tag";
    const result = validateReleaseGovernanceRecord(record);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("invalid:pre_release_url"));
  });

  it("blocks tag/version mismatch", () => {
    const record = JSON.parse(fs.readFileSync(FIXTURE_COMPLETE, "utf8"));
    record.tag = "v0.8.0-alpha.2";
    const result = validateReleaseGovernanceRecord(record);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("tag_version_mismatch"));
  });

  it("blocks release branch commit mismatch", () => {
    const record = JSON.parse(fs.readFileSync(FIXTURE_COMPLETE, "utf8"));
    record.release_branch_commit = "deadbeef";
    const result = validateReleaseGovernanceRecord(record);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("release_branch_commit_mismatch"));
    assert.equal(result.decision, "block");
  });
});
