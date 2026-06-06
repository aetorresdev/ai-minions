"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_REGISTRY_PATH = path.join(__dirname, "skill-registry.v1.json");
const REGISTRY_VERSION = "skill-registry.orchestrator.v1";

const KNOWN_ROLES = Object.freeze([
  "ORCHESTRATOR",
  "OWNER",
  "ARCHITECT",
  "DEV",
  "QA",
  "CERBERUS",
]);

const DISCLOSURE_MODES = Object.freeze(["index", "full", "hidden"]);

function expectedSkillRegistryPath(skillId) {
  return `skills/${skillId}/SKILL.md`;
}

/**
 * @param {string} [filePath]
 * @param {string} [repoRoot]
 */
function loadSkillRegistry(filePath = DEFAULT_REGISTRY_PATH, repoRoot = process.cwd()) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const validation = validateSkillRegistry(parsed, repoRoot);
  return {
    registry: parsed,
    ...validation,
  };
}

/**
 * @param {object} registry
 * @param {string} repoRoot
 */
function validateSkillRegistry(registry, repoRoot) {
  const errors = [];
  if (!registry || typeof registry !== "object") {
    return { valid: false, errors: ["registry must be an object"] };
  }
  if (registry.version !== REGISTRY_VERSION) {
    errors.push(`version must be "${REGISTRY_VERSION}"`);
  }
  if (registry.default_policy !== "deny_unlisted") {
    errors.push('default_policy must be "deny_unlisted"');
  }
  const skills = registry.skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) {
    errors.push("skills must be a non-array object");
    return { valid: false, errors };
  }

  for (const [key, entry] of Object.entries(skills)) {
    const label = `skills.${key}`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${label}: must be an object`);
      continue;
    }
    if (entry.id !== key) {
      errors.push(`${label}: id must match registry key`);
    }
    const wantPath = expectedSkillRegistryPath(key);
    if (typeof entry.path !== "string" || !entry.path.trim()) {
      errors.push(`${label}: path required`);
    } else if (entry.path !== wantPath) {
      errors.push(`${label}: path must be "${wantPath}"`);
    } else if (entry.path.includes("..") || path.isAbsolute(entry.path)) {
      errors.push(`${label}: path must be repo-relative under skills/<id>/`);
    } else {
      const abs = path.join(repoRoot, entry.path);
      if (!fs.existsSync(abs)) {
        errors.push(`${label}: path not found: ${entry.path}`);
      }
    }
    if (!Array.isArray(entry.allowed_roles) || entry.allowed_roles.length === 0) {
      errors.push(`${label}: allowed_roles must be a non-empty array`);
    } else {
      for (const role of entry.allowed_roles) {
        if (!KNOWN_ROLES.includes(role)) {
          errors.push(`${label}: unknown role "${role}"`);
        }
      }
    }
    if (entry.disclosure != null && !DISCLOSURE_MODES.includes(entry.disclosure)) {
      errors.push(`${label}: invalid disclosure`);
    }
    if (entry.conformant != null && typeof entry.conformant !== "boolean") {
      errors.push(`${label}: conformant must be boolean when set`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {object} opts
 * @param {string} opts.skillId
 * @param {string} [opts.role]
 * @param {object} opts.registry
 */
function evaluateSkillRegistryAccess(opts) {
  const skillId = opts.skillId != null ? String(opts.skillId).trim().toLowerCase() : "";
  const role = opts.role != null ? String(opts.role).trim().toUpperCase() : "";
  const registry = opts.registry || {};
  const skills = registry.skills || {};

  if (!skillId) {
    return deny("skill_id_missing", { skill_id: skillId, role });
  }

  const entry = skills[skillId];
  if (!entry) {
    return deny("skill_not_registered", { skill_id: skillId, role });
  }

  if (!role) {
    return deny("role_missing", { skill_id: skillId, role });
  }

  if (!KNOWN_ROLES.includes(role)) {
    return deny("role_unknown", { skill_id: skillId, role });
  }

  const allowed = Array.isArray(entry.allowed_roles) ? entry.allowed_roles : [];
  if (!allowed.includes(role)) {
    return deny("role_not_allowed_for_skill", { skill_id: skillId, role, entry });
  }

  return allow({ skill_id: skillId, role, entry });
}

function allow(ctx) {
  const output = {
    decision: "allow",
    reason_code: "skill_registry_allowed",
    skill_id: ctx.skill_id,
    role: ctx.role,
    disclosure: ctx.entry.disclosure || "index",
    conformant: ctx.entry.conformant === true,
  };
  return {
    output,
    tracePayload: traceSkillRegistryDecision(output),
  };
}

function deny(reason_code, ctx) {
  const output = {
    decision: "deny",
    reason_code,
    skill_id: ctx.skill_id,
    role: ctx.role,
  };
  return {
    output,
    tracePayload: traceSkillRegistryDecision(output),
  };
}

/**
 * @param {object} output from evaluateSkillRegistryAccess
 */
function traceSkillRegistryDecision(output) {
  return {
    event: "skill_registry_check",
    skill_id: output.skill_id != null ? String(output.skill_id) : "",
    role: output.role != null ? String(output.role) : "",
    decision: output.decision,
    reason_code: output.reason_code,
    disclosure: output.disclosure != null ? String(output.disclosure) : null,
    conformant: output.conformant === true,
  };
}

/**
 * @param {object} registry
 * @returns {string[]}
 */
function listRegisteredSkillIds(registry) {
  if (!registry || !registry.skills) return [];
  return Object.keys(registry.skills).sort();
}

/**
 * @param {string} repoRoot
 * @param {string} skillsDir relative path default skills
 * @returns {string[]} skill ids on disk but missing from registry
 */
function listSkillsMissingFromRegistry(registry, repoRoot, skillsDir = "skills") {
  const abs = path.join(repoRoot, skillsDir);
  if (!fs.existsSync(abs)) return [];
  const registered = new Set(listRegisteredSkillIds(registry));
  const missing = [];
  for (const name of fs.readdirSync(abs)) {
    const skillMd = path.join(abs, name, "SKILL.md");
    if (!fs.statSync(path.join(abs, name)).isDirectory()) continue;
    if (!fs.existsSync(skillMd)) continue;
    if (!registered.has(name)) missing.push(name);
  }
  return missing.sort();
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  REGISTRY_VERSION,
  KNOWN_ROLES,
  DISCLOSURE_MODES,
  expectedSkillRegistryPath,
  loadSkillRegistry,
  validateSkillRegistry,
  evaluateSkillRegistryAccess,
  traceSkillRegistryDecision,
  listRegisteredSkillIds,
  listSkillsMissingFromRegistry,
};
