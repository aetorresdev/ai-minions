"use strict";

/**
 * Release governance record validator — fail-closed evidence for alpha tag cuts.
 * @see docs/orchestrator/release-governance-contract.md
 */

/** @typedef {"allow_tag_publish"|"block"} ReleaseGovernanceDecision */

const REQUIRED_STRING_FIELDS = [
  "version",
  "tag",
  "tag_commit",
  "changelog_section",
  "pre_release_url",
  "release_branch_commit",
];

/**
 * @param {unknown} record
 * @returns {{ ok: boolean, errors: string[], decision: ReleaseGovernanceDecision }}
 */
function validateReleaseGovernanceRecord(record) {
  /** @type {string[]} */
  const errors = [];

  if (!record || typeof record !== "object") {
    return { ok: false, errors: ["record_missing"], decision: "block" };
  }

  const rec = /** @type {Record<string, unknown>} */ (record);

  for (const key of REQUIRED_STRING_FIELDS) {
    const v = rec[key];
    if (typeof v !== "string" || !v.trim()) {
      errors.push(`missing:${key}`);
    }
  }

  const status = rec.evidence_status;
  if (status !== "complete" && status !== "incomplete") {
    errors.push("evidence_status_unknown");
  } else if (status !== "complete") {
    errors.push("evidence_status_incomplete");
  }

  if (typeof rec.pre_release_url === "string" && rec.pre_release_url.trim()) {
    if (!/^https:\/\/.+/i.test(rec.pre_release_url.trim())) {
      errors.push("invalid:pre_release_url");
    }
  }

  if (
    typeof rec.tag === "string"
    && typeof rec.version === "string"
    && rec.tag.trim()
    && rec.version.trim()
    && rec.tag.trim() !== rec.version.trim()
  ) {
    errors.push("tag_version_mismatch");
  }

  if (
    typeof rec.release_branch_commit === "string"
    && typeof rec.tag_commit === "string"
    && rec.release_branch_commit.trim()
    && rec.tag_commit.trim()
    && rec.release_branch_commit.trim() !== rec.tag_commit.trim()
  ) {
    errors.push("release_branch_commit_mismatch");
  }

  return {
    ok: errors.length === 0,
    errors,
    decision: errors.length === 0 ? "allow_tag_publish" : "block",
  };
}

module.exports = {
  REQUIRED_STRING_FIELDS,
  validateReleaseGovernanceRecord,
};
