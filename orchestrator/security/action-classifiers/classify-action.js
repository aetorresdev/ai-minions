"use strict";

const path = require("path");
const { ACTION_CLASS_SET } = require("./constants");
const { matchToolRules } = require("../match-manifest-operation");
const { getToolActionManifest } = require("../load-tool-action-manifest");
const { adapters } = require("./adapter-registry");
const R = require("../classification-reasons");

function normalizeExecutable(executable) {
  const base = path.basename(executable || "").toLowerCase();
  return base.replace(/\.(exe|bat|cmd)$/i, "");
}

function isJenkinsCliJar(name) {
  return name === "jenkins-cli.jar" || name.endsWith("/jenkins-cli.jar");
}

/**
 * Canonical manifest lookup key + argv forwarded to adapters (after docker-compose shim).
 * @returns {{ lookupKey: string, forwarded: string[], filesystemExe: string } | null}
 */
function preprocessInvocation(executable, args) {
  const raw = normalizeExecutable(executable);
  if (!raw) return null;

  let forwarded = Array.isArray(args) ? args.slice() : [];
  let lookupKey = raw;

  if (raw === "docker-compose" || raw === "docker-compose-v1") {
    lookupKey = "docker";
    forwarded = ["compose", ...forwarded];
  } else if (raw === "podman") {
    lookupKey = "docker";
  }

  if (isJenkinsCliJar(raw)) {
    lookupKey = "jenkins";
  }

  return { lookupKey, forwarded, filesystemExe: raw };
}

function ensure(base) {
  const ac = base.action_class;
  if (!ac || typeof ac !== "string" || !ACTION_CLASS_SET.has(ac)) {
    return {
      action_class: "unknown",
      target_class: null,
      reason_code: R.CLASSIFIER_INVALID_OUTPUT,
      tool_id: base.tool_id ?? null,
      manifest_action_id: base.manifest_action_id ?? null,
      detail: "classifier_invalid_output",
    };
  }
  return {
    action_class: ac,
    target_class: base.target_class != null ? base.target_class : null,
    reason_code: base.reason_code,
    tool_id: base.tool_id ?? null,
    manifest_action_id: base.manifest_action_id ?? null,
    detail: typeof base.detail === "string" ? base.detail : "",
  };
}

/**
 * @param {object} input
 * @param {string} input.executable
 * @param {string[]} [input.args]
 * @param {object} [input.ctx] optional { repoRoot } for filesystem adapter
 * @param {object} [input.__testToolManifest] **tests only**
 */
function classifyAction(input) {
  const args = Array.isArray(input.args) ? input.args : [];
  const ctxBase = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  const manifestState = input.__testToolManifest || getToolActionManifest();

  if (!manifestState.valid) {
    return ensure({
      action_class: "unknown",
      reason_code: R.MANIFEST_INVALID,
      detail: "manifest_invalid",
    });
  }

  const pre = preprocessInvocation(input.executable, args);
  if (!pre) {
    return ensure({
      action_class: "unknown",
      reason_code: R.MISSING_EXECUTABLE,
      detail: "missing_executable",
    });
  }

  const { lookupKey, forwarded, filesystemExe } = pre;
  const toolId = manifestState.alias_to_tool[lookupKey.toLowerCase()];

  if (!toolId) {
    return ensure({
      action_class: "unknown",
      reason_code: R.UNKNOWN_TOOL,
      tool_id: null,
      detail: `${R.UNKNOWN_TOOL}:${lookupKey}`,
    });
  }

  const entry = manifestState.tools[toolId];
  if (!entry || typeof entry !== "object") {
    return ensure({
      action_class: "unknown",
      reason_code: R.MANIFEST_TOOL_MISSING,
      tool_id: toolId,
      detail: "manifest_tool_missing",
    });
  }

  const manifestHit = matchToolRules(forwarded, entry);
  if (manifestHit) {
    return ensure({
      action_class: manifestHit.action_class,
      target_class: manifestHit.target_class ?? null,
      reason_code: R.CLASSIFIED_BY_MANIFEST,
      tool_id: toolId,
      manifest_action_id: manifestHit.id || null,
      detail: manifestHit.detail || `manifest:${manifestHit.id || toolId}`,
    });
  }

  const adapterKey = typeof entry.adapter === "string" ? entry.adapter : null;
  const delegateUnmatched = entry.delegate_unmatched_to_adapter === true;
  const rules = Array.isArray(entry.rules) ? entry.rules : [];
  const legacyOps = Array.isArray(entry.operations) ? entry.operations : [];
  const hasRules = rules.length > 0 || legacyOps.length > 0;
  const delegateBecauseAdapterOnly = !hasRules && !!adapterKey;
  const runAdapter = adapterKey && (delegateUnmatched || delegateBecauseAdapterOnly);

  if (runAdapter) {
    const adapter = adapters[adapterKey];
    if (!adapter || typeof adapter.classify !== "function") {
      return ensure({
        action_class: "unknown",
        reason_code: R.MISSING_ADAPTER,
        tool_id: toolId,
        detail: `${R.MISSING_ADAPTER}:${adapterKey}`,
      });
    }
    const adapterCtx =
      adapterKey === "filesystem" ? { ...ctxBase, executable: filesystemExe } : ctxBase;
    const rawOut = adapter.classify(forwarded, adapterCtx);
    const rc =
      rawOut && rawOut.action_class === "unknown"
        ? R.UNKNOWN_ACTION_CLASS
        : R.CLASSIFIED_BY_ADAPTER;
    return ensure({
      ...rawOut,
      reason_code: rc,
      tool_id: toolId,
      manifest_action_id: null,
    });
  }

  return ensure({
    action_class: "unknown",
    reason_code: R.UNKNOWN_ACTION_CLASS,
    tool_id: toolId,
    manifest_action_id: null,
    detail: `${R.UNKNOWN_ACTION_CLASS}:${toolId}`,
  });
}

function getFilesystemBinaryAliases() {
  const st = getToolActionManifest();
  if (!st.valid || !st.tools.filesystem || !Array.isArray(st.tools.filesystem.aliases)) {
    return new Set();
  }
  return new Set(st.tools.filesystem.aliases.map((a) => String(a).toLowerCase()));
}

module.exports = {
  classifyAction,
  normalizeExecutable,
  getFilesystemBinaryAliases,
  get FILESYSTEM_BINARIES() {
    return getFilesystemBinaryAliases();
  },
};
