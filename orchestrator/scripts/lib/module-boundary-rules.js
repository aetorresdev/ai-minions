"use strict";

const path = require("path");

/** @typedef {import("./module-boundary-rules").ModuleId} ModuleId */

/** @typedef {"run-control"|"contracts"|"gates"|"permissions"|"tools"|"model-runtime"|"trace"|"recovery"|"budget"|"worktree"|"operator"|"disclosure"|"shared"|"external"|"unclassified"} ModuleId */

/** Adjacency matrix from docs/orchestrator/module-boundaries.md */
const ALLOWED_IMPORTS = {
  "run-control": new Set(["contracts", "gates", "permissions", "tools", "model-runtime", "trace", "recovery", "budget", "worktree", "shared", "external"]),
  contracts: new Set(["shared", "external"]),
  gates: new Set(["contracts", "permissions", "trace", "shared", "external"]),
  permissions: new Set(["contracts", "tools", "trace", "shared", "external"]),
  tools: new Set(["contracts", "permissions", "trace", "shared", "external"]),
  "model-runtime": new Set(["contracts", "permissions", "tools", "trace", "budget", "operator", "shared", "external"]),
  trace: new Set(["contracts", "recovery", "budget", "worktree", "shared", "external"]),
  recovery: new Set(["contracts", "gates", "permissions", "shared", "external"]),
  budget: new Set(["contracts", "model-runtime", "trace", "shared", "external"]),
  worktree: new Set(["contracts", "trace", "shared", "external"]),
  operator: new Set(["run-control", "contracts", "trace", "budget", "worktree", "model-runtime", "shared", "external"]),
  disclosure: new Set(["contracts", "tools", "shared", "external"]),
  shared: new Set(["shared", "external", "contracts", "trace", "permissions", "tools", "gates", "budget", "worktree", "model-runtime", "run-control", "operator"]),
  external: new Set(),
  unclassified: new Set(["shared", "external", "contracts", "trace", "recovery", "permissions", "tools", "gates", "budget", "worktree", "model-runtime", "run-control", "operator", "unclassified"]),
};

/** First match wins — order: specific paths before broad prefixes. */
const MODULE_PATTERNS = [
  { id: "gates", patterns: [/^modules\/gates\//, /^governance-gate\.js$/, /^merge-governance\//, /^approval-policy-gate\.js$/, /^doubt-review\.js$/, /^review-record\.js$/] },
  { id: "permissions", patterns: [/^modules\/permissions\//, /^agents\/permissions\.js$/, /^agents\/capability-matrix\.js$/, /^credential-broker\.js$/, /^environment-parser\.js$/, /^security\/(?:load-project-policy|trace-security-decision|action-classifiers|resolve-mcp-trust-level|classification-reasons|match-manifest-operation|sensitive-data-scanner|.*permission.*|.*-gate\.js|classified|claude-cli|network|mcp|trace-role-capability)/] },
  { id: "tools", patterns: [/^modules\/tools\//, /^security\/tool-eval/, /^security\/skill-registry/, /^security\/untrusted-context/, /^security\/load-tool-action-manifest/, /^mcp-client\.js$/] },
  { id: "model-runtime", patterns: [/^modules\/model-runtime\//, /^agents\/runtime\//, /^agents\/routing\//, /^local-model-/, /^local-runtime-endpoint/, /^runner-model-routing/, /^flow-hook-bridge/] },
  { id: "recovery", patterns: [/^modules\/recovery\//, /^recovery-sweep/, /^session-resume/] },
  { id: "worktree", patterns: [/^modules\/worktree\//, /^trace-workspace-lifecycle/, /^worktree-/, /^run-workdir-contract/] },
  { id: "trace", patterns: [/^modules\/trace\//, /^trace-/, /^run-outcome-summary/, /^otel-genai-trace-map/, /^context-hygiene-signals/] },
  { id: "budget", patterns: [/^modules\/budget\//, /^token-usage-summary/, /^token-trace-report/, /^cost-accounting-dimensions/] },
  { id: "operator", patterns: [/^modules\/operator\//, /^explain-run/, /^control-plane-tui/, /^runner-(?!model-routing)/, /^operator-cli-help/, /^project-template-cli/, /^scenario-metrics-export/, /^console-dashboard/] },
  { id: "disclosure", patterns: [/^modules\/contracts\/progressive-disclosure-design/, /^progressive-disclosure-design/] },
  { id: "contracts", patterns: [/^modules\/contracts\//, /-design\.js$/, /^agents\/validate-output/] },
  { id: "run-control", patterns: [/^modules\/run-control\//, /^orchestrator\.js$/, /^run-loop-helpers/, /^run-phases\//, /^run-state/, /^qa-spec-flow/, /^context-utils/, /^cli\.js$/, /^run-orchestrator/] },
  { id: "shared", patterns: [/^modules\/shared\//, /^repo-root/, /^minions-config/, /^decision-engine/, /^agents\.js$/, /^agents\/registry\.js$/, /^agents\/prompts\//, /^portable-project-template/, /^scripts\//] },
];

/** Policy modules trace must not import for decisions. */
const POLICY_MODULES = new Set(["permissions", "gates"]);

/** Gate shell paths — gates must not spawn subprocess/git via these. */
const GATE_SHELL_TARGETS = [
  /^child_process$/,
  /worktree-isolation/,
  /worktree-result-promotion/,
  /run-orchestrator/,
  /cli\.js$/,
];

/** Model-runtime must not import approval/governance gate modules directly. */
const MODEL_RUNTIME_FORBIDDEN_TARGETS = [
  /approval-policy-gate/,
  /governance-gate/,
  /doubt-review/,
  /review-record/,
  /modules\/gates\/(?!index)/,
];

const NODE_BUILTINS = new Set([
  "assert", "assert/strict", "async_hooks", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "fs/promises", "http", "http2",
  "https", "inspector", "module", "net", "os", "path", "path/posix", "path/win32", "perf_hooks", "process",
  "punycode", "querystring", "readline", "repl", "stream", "stream/promises", "string_decoder", "sys", "timers",
  "timers/promises", "tls", "trace_events", "tty", "url", "util", "util/types", "v8", "vm", "wasi", "worker_threads", "zlib",
  "node:assert", "node:assert/strict", "node:async_hooks", "node:buffer", "node:child_process", "node:cluster",
  "node:console", "node:constants", "node:crypto", "node:dgram", "node:diagnostics_channel", "node:dns", "node:domain",
  "node:events", "node:fs", "node:fs/promises", "node:http", "node:http2", "node:https", "node:inspector", "node:module",
  "node:net", "node:os", "node:path", "node:perf_hooks", "node:process", "node:querystring", "node:readline", "node:repl",
  "node:stream", "node:string_decoder", "node:test", "node:timers", "node:timers/promises", "node:tls", "node:trace_events",
  "node:tty", "node:url", "node:util", "node:v8", "node:vm", "node:worker_threads", "node:zlib",
]);

/**
 * @param {string} relPath path relative to orchestrator/ using forward slashes
 * @returns {ModuleId}
 */
function classifyModule(relPath) {
  const norm = relPath.replace(/\\/g, "/");
  for (const { id, patterns } of MODULE_PATTERNS) {
    for (const re of patterns) {
      if (re.test(norm)) return /** @type {ModuleId} */ (id);
    }
  }
  return "unclassified";
}

/**
 * @param {string} specifier
 * @returns {boolean}
 */
function isExternalSpecifier(specifier) {
  if (NODE_BUILTINS.has(specifier)) return true;
  if (specifier.startsWith("node:")) return true;
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return true;
  return false;
}

/**
 * @param {string} fromFile absolute path to source file
 * @param {string} specifier require target
 * @param {string} orchRoot orchestrator root
 * @returns {string|null} resolved .js path or null if external/unresolvable
 */
function resolveLocalImport(fromFile, specifier, orchRoot) {
  if (isExternalSpecifier(specifier)) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    path.join(base, "index.js"),
  ];
  for (const candidate of candidates) {
    if (candidate.startsWith(orchRoot) && candidate.endsWith(".js")) {
      try {
        const fs = require("fs");
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/**
 * @param {ModuleId} from
 * @param {ModuleId} to
 * @returns {boolean}
 */
function matrixAllows(from, to) {
  if (from === to) return true;
  const allowed = ALLOWED_IMPORTS[from];
  if (!allowed) return true;
  return allowed.has(to);
}

/**
 * @param {string} relFrom
 * @param {ModuleId} fromMod
 * @param {string} specifier
 * @param {ModuleId} toMod
 * @returns {{ rule: string, message: string } | null}
 */
function checkHardRules(relFrom, fromMod, specifier, toMod) {
  if (fromMod === "trace" && POLICY_MODULES.has(toMod)) {
    return { rule: "trace-not-policy", message: "trace must not import policy modules (permissions/gates)" };
  }
  if (fromMod === "gates") {
    if (specifier === "child_process" || specifier.startsWith("node:child_process")) {
      return { rule: "gates-not-shell", message: "gates must not import child_process" };
    }
    for (const re of GATE_SHELL_TARGETS) {
      if (re.test(specifier)) {
        return { rule: "gates-not-shell", message: "gates must not import shell/worktree execution paths" };
      }
    }
  }
  if (fromMod === "model-runtime") {
    for (const re of MODEL_RUNTIME_FORBIDDEN_TARGETS) {
      if (re.test(specifier)) {
        return { rule: "model-runtime-not-approval", message: "model-runtime must not import approval/governance gates" };
      }
    }
  }
  return null;
}

module.exports = {
  ALLOWED_IMPORTS,
  MODULE_PATTERNS,
  classifyModule,
  isExternalSpecifier,
  resolveLocalImport,
  matrixAllows,
  checkHardRules,
  NODE_BUILTINS,
};
