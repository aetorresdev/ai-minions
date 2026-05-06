"use strict";

const fs = require("fs");
const path = require("path");
const { ACTION_CLASS_SET } = require("./action-classifiers/constants");

const DEFAULT_MANIFEST_PATH = path.join(__dirname, "tool-action-manifest.v1.json");

/** @type {object | null} */
let cache = null;

function validateMatchObject(toolId, where, m) {
  const errors = [];
  if (!m || typeof m !== "object") {
    errors.push(`tool "${toolId}" ${where}: match must be an object`);
    return errors;
  }
  if (m.type === "argv_prefix") {
    if (!Array.isArray(m.argv)) {
      errors.push(`tool "${toolId}" ${where}: match.argv must be an array`);
    }
  } else if (m.type === "argv0_prefix") {
    if (m.prefix == null || typeof m.prefix !== "string") {
      errors.push(`tool "${toolId}" ${where}: match.prefix must be a string`);
    }
  } else {
    errors.push(`tool "${toolId}" ${where}: unsupported match.type`);
  }
  return errors;
}

function validateRule(toolId, label, op) {
  const errors = [];
  if (!op || typeof op !== "object") {
    errors.push(`tool "${toolId}" ${label}: must be an object`);
    return errors;
  }
  if (typeof op.id !== "string" || !op.id.trim()) {
    errors.push(`tool "${toolId}" ${label}: id must be a non-empty string`);
  }
  if (!op.match || typeof op.match !== "object") {
    errors.push(`tool "${toolId}" ${label}: match required`);
  } else {
    errors.push(...validateMatchObject(toolId, label, op.match));
  }
  if (!op.action_class || typeof op.action_class !== "string") {
    errors.push(`tool "${toolId}" ${label}: action_class required`);
  } else if (!ACTION_CLASS_SET.has(op.action_class)) {
    errors.push(`tool "${toolId}" ${label}: invalid action_class`);
  }
  if (op.target_class != null && typeof op.target_class !== "string") {
    errors.push(`tool "${toolId}" ${label}: target_class must be a string when set`);
  }
  if (op.detail != null && typeof op.detail !== "string") {
    errors.push(`tool "${toolId}" ${label}: detail must be a string when set`);
  }
  return errors;
}

function validateToolsObject(tools, adapterIds) {
  const errors = [];
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    errors.push("tools must be a non-array object");
    return errors;
  }

  for (const [toolId, entry] of Object.entries(tools)) {
    if (!entry || typeof entry !== "object") {
      errors.push(`tool "${toolId}": must be an object`);
      continue;
    }
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      errors.push(`tool "${toolId}": id must be a non-empty string`);
    } else if (entry.id !== toolId) {
      errors.push(`tool "${toolId}": id must match tool key`);
    }
    if (entry.type !== "shell_tool") {
      errors.push(`tool "${toolId}": type must be "shell_tool"`);
    }
    if (typeof entry.risk_profile !== "string" || !entry.risk_profile.trim()) {
      errors.push(`tool "${toolId}": risk_profile is required`);
    }
    if (!Array.isArray(entry.capabilities)) {
      errors.push(`tool "${toolId}": capabilities must be an array`);
    } else {
      for (const c of entry.capabilities) {
        if (typeof c !== "string" || !c.trim()) {
          errors.push(`tool "${toolId}": each capability must be a non-empty string`);
        }
      }
    }

    if (!Array.isArray(entry.aliases) || entry.aliases.length === 0) {
      errors.push(`tool "${toolId}": aliases must be a non-empty array`);
    } else {
      for (const a of entry.aliases) {
        if (typeof a !== "string" || !a.trim()) {
          errors.push(`tool "${toolId}": each alias must be a non-empty string`);
        }
      }
    }

    if (entry.adapter != null && typeof entry.adapter !== "string") {
      errors.push(`tool "${toolId}": adapter must be a string when set`);
    }
    if (entry.adapter && adapterIds && !adapterIds.has(entry.adapter)) {
      errors.push(`tool "${toolId}": unknown adapter "${entry.adapter}"`);
    }

    if (entry.delegate_unmatched_to_adapter != null && typeof entry.delegate_unmatched_to_adapter !== "boolean") {
      errors.push(`tool "${toolId}": delegate_unmatched_to_adapter must be boolean`);
    }

    if (entry.rules != null) {
      if (!Array.isArray(entry.rules)) {
        errors.push(`tool "${toolId}": rules must be an array when set`);
      } else {
        entry.rules.forEach((op, idx) => {
          errors.push(...validateRule(toolId, `rules[${idx}]`, op));
        });
      }
    }

    if (entry.operations != null) {
      if (!Array.isArray(entry.operations)) {
        errors.push(`tool "${toolId}": operations (legacy) must be an array when set`);
      } else {
        entry.operations.forEach((op, idx) => {
          if (!op || typeof op !== "object") {
            errors.push(`tool "${toolId}" operations[${idx}]: must be an object`);
            return;
          }
          const label = `operations[${idx}]`;
          if (!op.match || typeof op.match !== "object") {
            errors.push(`tool "${toolId}" ${label}: match required`);
            return;
          }
          if (op.match.type !== "argv_prefix" && op.match.type !== "argv0_prefix") {
            errors.push(`tool "${toolId}" ${label}: unsupported match.type`);
            return;
          }
          if (op.match.type === "argv_prefix" && !Array.isArray(op.match.argv)) {
            errors.push(`tool "${toolId}" ${label}: match.argv must be an array`);
            return;
          }
          if (op.match.type === "argv0_prefix" && (op.match.prefix == null || typeof op.match.prefix !== "string")) {
            errors.push(`tool "${toolId}" ${label}: match.prefix must be a string`);
            return;
          }
          if (!op.action_class || typeof op.action_class !== "string") {
            errors.push(`tool "${toolId}" ${label}: action_class required`);
            return;
          }
          if (!ACTION_CLASS_SET.has(op.action_class)) {
            errors.push(`tool "${toolId}" ${label}: invalid action_class`);
          }
        });
      }
    }
  }

  return errors;
}

function buildAliasMap(tools) {
  const alias_to_tool = Object.create(null);
  if (!tools || typeof tools !== "object") return alias_to_tool;

  for (const [toolId, entry] of Object.entries(tools)) {
    if (!entry || !Array.isArray(entry.aliases)) continue;
    for (const a of entry.aliases) {
      const key = String(a).toLowerCase();
      if (alias_to_tool[key] && alias_to_tool[key] !== toolId) {
        throw new Error(`duplicate manifest alias "${key}"`);
      }
      alias_to_tool[key] = toolId;
    }
  }
  return alias_to_tool;
}

/**
 * @param {object} parsed JSON root
 * @param {Set<string>} [adapterIds] optional registry keys — when set, adapters are validated
 */
function validateManifestRoot(parsed, adapterIds) {
  const errors = [];
  if (!parsed || typeof parsed !== "object") {
    return { valid: false, errors: ["root must be an object"], version: "", tools: {}, alias_to_tool: {} };
  }
  if (typeof parsed.version !== "string" || !parsed.version.trim()) {
    errors.push("version must be a non-empty string");
  }

  const toolErrors = validateToolsObject(parsed.tools, adapterIds);
  errors.push(...toolErrors);

  let alias_to_tool = {};
  try {
    alias_to_tool = buildAliasMap(parsed.tools || {});
  } catch (e) {
    errors.push(e.message || String(e));
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    version: typeof parsed.version === "string" ? parsed.version : "",
    tools: valid && parsed.tools && typeof parsed.tools === "object" ? parsed.tools : {},
    alias_to_tool: valid ? alias_to_tool : {},
  };
}

/**
 * @param {string} filePath
 * @param {Set<string>} [adapterIds]
 */
function loadManifestFromPath(filePath, adapterIds) {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return {
      valid: false,
      errors: [`cannot read manifest: ${e.message || e}`],
      version: "",
      tools: {},
      alias_to_tool: {},
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      valid: false,
      errors: [`invalid JSON: ${e.message || e}`],
      version: "",
      tools: {},
      alias_to_tool: {},
    };
  }

  return validateManifestRoot(parsed, adapterIds);
}

/**
 * Build manifest state from an object (for tests).
 * @param {object} obj
 * @param {Set<string>} [adapterIds]
 */
function manifestFromObject(obj, adapterIds) {
  return validateManifestRoot(obj, adapterIds);
}

function resetToolActionManifestCache() {
  cache = null;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.manifestPath]
 * @param {Set<string>} [opts.adapterIds] defaults to require adapter-registry ids
 */
function loadToolActionManifest(opts = {}) {
  const { ADAPTER_IDS } = require("./action-classifiers/adapter-registry");
  const adapterRegistry = opts.adapterIds || ADAPTER_IDS;
  const manifestPath = opts.manifestPath || DEFAULT_MANIFEST_PATH;
  cache = loadManifestFromPath(manifestPath, adapterRegistry);
  return cache;
}

function getToolActionManifest() {
  if (!cache) {
    loadToolActionManifest();
  }
  return cache;
}

module.exports = {
  DEFAULT_MANIFEST_PATH,
  validateManifestRoot,
  loadManifestFromPath,
  manifestFromObject,
  loadToolActionManifest,
  getToolActionManifest,
  resetToolActionManifestCache,
  buildAliasMap,
};
