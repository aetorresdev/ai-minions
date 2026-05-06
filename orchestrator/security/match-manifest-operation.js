"use strict";

/**
 * First matching rule wins. Match types:
 * - argv_prefix: args start with token sequence (case-insensitive)
 * - argv0_prefix: first arg starts with prefix string (case-insensitive)
 */
function matchArgvPrefix(args, prefix) {
  if (!prefix || prefix.length === 0) return true;
  if (!args || args.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (String(args[i]).toLowerCase() !== String(prefix[i]).toLowerCase()) return false;
  }
  return true;
}

function matchArgv0Prefix(args, prefixStr) {
  if (args.length === 0 || prefixStr == null) return false;
  const a0 = String(args[0]);
  return a0.toLowerCase().startsWith(String(prefixStr).toLowerCase());
}

/**
 * Build ordered rule list: `rules` (canonical), then legacy `operations`.
 * @param {object} entry tool manifest entry
 * @returns {object[]}
 */
function flattenRules(entry) {
  const out = [];
  if (entry && Array.isArray(entry.rules)) {
    for (const r of entry.rules) {
      if (r && typeof r === "object") out.push(r);
    }
  }
  if (entry && Array.isArray(entry.operations)) {
    entry.operations.forEach((op, idx) => {
      if (op && typeof op === "object") {
        out.push({
          ...op,
          id: op.id || `legacy_operation_${idx}`,
        });
      }
    });
  }
  return out;
}

/**
 * @returns {{ action_class: string, target_class?: string, id?: string, detail?: string } | null}
 */
function matchToolRules(args, entry) {
  const rules = flattenRules(entry);
  if (rules.length === 0) return null;

  for (const op of rules) {
    if (!op || typeof op !== "object") continue;
    const m = op.match;
    const action_class = op.action_class;
    if (!action_class || typeof action_class !== "string") continue;

    if (!m || typeof m !== "object") continue;

    if (m.type === "argv_prefix" && Array.isArray(m.argv)) {
      if (matchArgvPrefix(args, m.argv)) {
        return {
          action_class,
          target_class: typeof op.target_class === "string" ? op.target_class : undefined,
          id: typeof op.id === "string" ? op.id : undefined,
          detail: typeof op.detail === "string" ? op.detail : undefined,
        };
      }
    }

    if (m.type === "argv0_prefix" && m.prefix != null) {
      if (matchArgv0Prefix(args, m.prefix)) {
        return {
          action_class,
          target_class: typeof op.target_class === "string" ? op.target_class : undefined,
          id: typeof op.id === "string" ? op.id : undefined,
          detail: typeof op.detail === "string" ? op.detail : undefined,
        };
      }
    }
  }
  return null;
}

/** @deprecated use matchToolRules */
function matchOperations(args, operations) {
  return matchToolRules(args, { rules: [], operations });
}

module.exports = {
  matchArgvPrefix,
  matchArgv0Prefix,
  matchToolRules,
  flattenRules,
  matchOperations,
};
