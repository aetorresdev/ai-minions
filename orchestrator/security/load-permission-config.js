"use strict";

const path = require("path");
const fs = require("fs");

const SECURITY_DIR = __dirname;
const AGENTS_DIR = path.join(__dirname, "..", "agents");

const PROFILES_PATH = path.join(SECURITY_DIR, "permission-profiles.v1.json");
const CATALOG_PATH = path.join(SECURITY_DIR, "capability-catalog.v1.json");
const MATRIX_PATH = path.join(AGENTS_DIR, "capability-matrix.v1.json");

const VALID_PROFILES = ["dev-local", "ci-safe", "prod-guarded"];

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function validateMatrix(matrix) {
  if (!matrix.version) throw new Error("capability-matrix missing version");
  if (!matrix.domains || !Array.isArray(matrix.domains)) {
    throw new Error("capability-matrix missing domains array");
  }
  if (matrix.domains.length === 0) {
    throw new Error("capability-matrix domains array must not be empty");
  }
  if (!matrix.roles || typeof matrix.roles !== "object") {
    throw new Error("capability-matrix missing roles");
  }
  // matrix.domains is authoritative — no secondary enum here
}

function validateProfiles(profiles, matrixDomains) {
  if (!profiles.version) throw new Error("permission-profiles missing version");
  if (!profiles.profiles || typeof profiles.profiles !== "object") {
    throw new Error("permission-profiles missing profiles object");
  }
  for (const name of VALID_PROFILES) {
    if (!profiles.profiles[name]) {
      throw new Error(`permission-profiles missing required profile: ${name}`);
    }
  }
  // Each profile domain key must be a known domain
  for (const [profileName, profile] of Object.entries(profiles.profiles)) {
    if (!profile.domains) throw new Error(`profile ${profileName} missing domains`);
    for (const key of Object.keys(profile.domains)) {
      if (!matrixDomains.includes(key)) {
        throw new Error(`profile ${profileName} references unknown domain: ${key}`);
      }
    }
  }
}

function validateCatalog(catalog, matrixDomains) {
  if (!catalog.version) throw new Error("capability-catalog missing version");
  if (!catalog.extends) throw new Error("capability-catalog missing extends reference");
  if (!catalog.doc_categories || !Array.isArray(catalog.doc_categories.categories)) {
    throw new Error("capability-catalog missing doc_categories.categories");
  }
  // Catalog must not redefine domain list
  if (catalog.domains) {
    throw new Error("capability-catalog must not redefine domains — use extends reference only");
  }
  // capability_classes entries must reference valid domains
  if (catalog.capability_classes) {
    for (const [domainKey, _] of Object.entries(catalog.capability_classes)) {
      if (domainKey === "mcp" || domainKey === "context_retrieval") continue; // structured differently
      if (!matrixDomains.includes(domainKey)) {
        throw new Error(`capability-catalog capability_classes references unknown domain: ${domainKey}`);
      }
    }
  }
}

/**
 * Load and cross-validate all three permission config files.
 * Returns { matrix, profiles, catalog } or throws on schema/consistency error.
 */
function loadPermissionConfig() {
  const matrix = loadJson(MATRIX_PATH);
  const profiles = loadJson(PROFILES_PATH);
  const catalog = loadJson(CATALOG_PATH);

  validateMatrix(matrix);
  validateProfiles(profiles, matrix.domains);
  validateCatalog(catalog, matrix.domains);

  return { matrix, profiles, catalog };
}

/**
 * Resolve the active permission profile object for a given profile name.
 * Throws if the profile name is not recognized.
 */
function resolveProfile(profileName, profiles) {
  const profile = profiles.profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown permission profile: ${profileName}. Valid: ${VALID_PROFILES.join(", ")}`);
  }
  return profile;
}

module.exports = { loadPermissionConfig, resolveProfile, VALID_PROFILES };
