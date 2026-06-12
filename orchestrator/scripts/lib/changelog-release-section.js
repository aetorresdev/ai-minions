"use strict";

/**
 * Validates CHANGELOG.md alpha release section structure.
 * Enforces mandatory alpha markers (presence + order) and machine-checkable
 * rules only — not every human guideline in the format doc.
 * @see docs/orchestrator/changelog-release-format.md § Validator scope (automated)
 */

/** @typedef {"alpha"|"legacy"} ChangelogReleaseProfile */

const ALPHA_ENFORCE_FROM = "0.6.0-alpha.1";

/** @type {{ id: string, pattern: RegExp }[]} */
const ALPHA_MARKERS = [
  { id: "release_claim", pattern: /\*\*Release claim:\*\*/ },
  { id: "prerequisite", pattern: /\*\*Prerequisite:\*\*/ },
  { id: "since", pattern: /\*\*Since \[/ },
  { id: "delta_table", pattern: /\| Area \|/ },
  { id: "release_url", pattern: /\*\*Release:\*\*/ },
  { id: "evidence", pattern: /\*\*Evidence \(operator\):\*\*/ },
  { id: "alpha_limitations", pattern: /\*\*Alpha limitations \(not production\):\*\*/ },
  { id: "added", pattern: /^### Added\s*$/m },
];

const HEADER_RE = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\s*$/m;
const TICKET_ID_RE = /\b(?:P\d+-\d+|A\d+-\d+|DEV-[A-Z0-9-]+|MODEL-GOV-\d+|RELEASE-[A-Z0-9-]+)\b/;

/**
 * @param {string} version
 * @returns {number[]|null}
 */
function parseVersionParts(version) {
  const m = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 0];
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 4; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * @param {string} version
 * @returns {ChangelogReleaseProfile}
 */
function profileForVersion(version) {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  return compareVersions(normalized, ALPHA_ENFORCE_FROM) >= 0 ? "alpha" : "legacy";
}

/**
 * @param {string} changelog
 * @returns {{ version: string, date: string, body: string, headerLine: string }[]}
 */
function parseReleaseSections(changelog) {
  const lines = changelog.split("\n");
  /** @type {{ version: string, date: string, body: string, headerLine: string }[]} */
  const sections = [];
  let current = null;

  for (const line of lines) {
    const hm = line.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\s*$/);
    if (hm) {
      if (current) sections.push(current);
      current = {
        version: hm[1],
        date: hm[2],
        headerLine: line,
        body: "",
      };
      continue;
    }
    if (line === "## [Unreleased]") {
      if (current) sections.push(current);
      current = null;
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * @param {string} sectionBody
 * @param {ChangelogReleaseProfile} profile
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateReleaseSection(sectionBody, profile) {
  /** @type {string[]} */
  const errors = [];

  if (profile === "legacy") {
    return { ok: true, errors };
  }

  let lastIndex = -1;
  for (const marker of ALPHA_MARKERS) {
    const match = marker.pattern.exec(sectionBody);
    if (!match || match.index === undefined) {
      errors.push(`missing:${marker.id}`);
      continue;
    }
    if (match.index < lastIndex) {
      errors.push(`out_of_order:${marker.id}`);
    }
    lastIndex = match.index;
  }

  if (!/npm test/i.test(sectionBody)) {
    errors.push("missing:evidence_npm_test");
  }

  if (profile === "alpha" && !/release-trivy-gate|security-trivy-scan/i.test(sectionBody)) {
    errors.push("missing:evidence_trivy");
  }

  if (TICKET_ID_RE.test(sectionBody)) {
    errors.push("forbidden:ticket_id_in_product_text");
  }

  const summary = sectionBody.split("\n").find((l) => l.trim() && !l.startsWith("**") && !l.startsWith("|") && !l.startsWith("#"));
  if (!summary || summary.trim().length < 40) {
    errors.push("missing:summary_paragraph");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * @param {string} changelog
 * @param {{ enforceFrom?: string }} [opts]
 * @returns {{ ok: boolean, errors: { version: string, errors: string[] }[] }}
 */
function validateChangelogReleaseFormat(changelog, opts = {}) {
  const enforceFrom = opts.enforceFrom ?? ALPHA_ENFORCE_FROM;
  const sections = parseReleaseSections(changelog);
  /** @type {{ version: string, errors: string[] }[]} */
  const allErrors = [];

  for (const section of sections) {
    if (section.version === "Unreleased") continue;
    if (compareVersions(section.version, enforceFrom) < 0) continue;

    const profile = profileForVersion(section.version);
    const headerMatch = section.headerLine.match(HEADER_RE);
    if (!headerMatch) {
      allErrors.push({ version: section.version, errors: ["invalid:header_format"] });
      continue;
    }

    const result = validateReleaseSection(section.body, profile);
    if (!result.ok) allErrors.push({ version: section.version, errors: result.errors });
  }

  return {
    ok: allErrors.length === 0,
    errors: allErrors,
  };
}

module.exports = {
  ALPHA_ENFORCE_FROM,
  ALPHA_MARKERS,
  compareVersions,
  parseReleaseSections,
  profileForVersion,
  validateChangelogReleaseFormat,
  validateReleaseSection,
};
