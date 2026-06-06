"use strict";

const fs = require("fs");
const path = require("path");
const { runClassifiedInvocationPermissionGate } = require("./classified-invocation-permission-gate");
const { manifestFromObject } = require("./load-tool-action-manifest");
const { ADAPTER_IDS } = require("./action-classifiers/adapter-registry");

const DEFAULT_FIXTURES_PATH = path.join(__dirname, "tool-eval-fixtures.v1.json");

/** Approximate token footprint (chars/4 heuristic). */
const LARGE_RESPONSE_CHAR_THRESHOLD = 8000;

const TEST_MANIFESTS = {
  incomplete_tool: {
    version: "tool-action-manifest.orchestrator.v1",
    tools: {
      stub_no_rules: {
        id: "stub_no_rules",
        type: "shell_tool",
        risk_profile: "test",
        capabilities: ["test.stub"],
        aliases: ["stub-no-rules"],
        rules: [],
      },
    },
  },
};

function estimateTokenFootprint(text) {
  const s = text == null ? "" : String(text);
  const chars = s.length;
  return {
    chars,
    approx_tokens: Math.ceil(chars / 4),
  };
}

function largeResponseRecommendation(charCount) {
  const n = Number(charCount) || 0;
  if (n < LARGE_RESPONSE_CHAR_THRESHOLD) {
    return null;
  }
  return {
    recommendation: "progressive_disclosure_or_compact_response",
    reason: "tool_response_exceeds_threshold",
    threshold_chars: LARGE_RESPONSE_CHAR_THRESHOLD,
    actual_chars: n,
    guidance:
      "Return summaries, paginate, or expose compact fields; avoid dumping full payloads into agent context.",
  };
}

function loadToolEvalFixtures(filePath = DEFAULT_FIXTURES_PATH) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.scenarios)) {
    throw new Error("tool-eval fixtures: scenarios array required");
  }
  return parsed;
}

function classificationMatches(expected, classification, input) {
  const mismatches = [];
  if (expected.tool_id !== undefined) {
    const got = classification.tool_id ?? null;
    const want = expected.tool_id;
    if (got !== want) mismatches.push({ field: "tool_id", expected: want, actual: got });
  }
  if (expected.action_class !== undefined && classification.action_class !== expected.action_class) {
    mismatches.push({
      field: "action_class",
      expected: expected.action_class,
      actual: classification.action_class,
    });
  }
  if (expected.target_class !== undefined && classification.target_class !== expected.target_class) {
    mismatches.push({
      field: "target_class",
      expected: expected.target_class,
      actual: classification.target_class,
    });
  }
  if (expected.domain !== undefined && input.domain !== expected.domain) {
    mismatches.push({ field: "domain", expected: expected.domain, actual: input.domain });
  }
  return mismatches;
}

function permissionMatches(expected, output) {
  if (expected.decision === undefined) return [];
  if (output.decision === expected.decision) return [];
  return [{ field: "decision", expected: expected.decision, actual: output.decision }];
}

/**
 * Distinguish tool selection/classification failure from permission policy failure.
 * @returns {"pass" | "tool_selection" | "permission_policy"}
 */
function diagnoseFailureKind(classificationMismatches, permissionMismatches) {
  if (classificationMismatches.length === 0 && permissionMismatches.length === 0) {
    return "pass";
  }
  if (classificationMismatches.length > 0) {
    return "tool_selection";
  }
  return "permission_policy";
}

function resolveTestManifest(key) {
  const obj = TEST_MANIFESTS[key];
  if (!obj) return null;
  return manifestFromObject(obj, ADAPTER_IDS);
}

/**
 * @param {object} scenario fixture row
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]
 */
function runToolEvalScenario(scenario, opts = {}) {
  const repoRoot = opts.repoRoot != null ? String(opts.repoRoot) : process.cwd();
  const gateOpts = {
    repoRoot,
    executable: scenario.executable,
    args: Array.isArray(scenario.args) ? scenario.args : [],
    permissionProfileName: scenario.permission_profile || "dev-local",
    role: scenario.role || "DEV",
  };

  if (scenario.use_test_manifest) {
    const st = resolveTestManifest(scenario.use_test_manifest);
    if (!st || !st.valid) {
      throw new Error(`invalid test manifest: ${scenario.use_test_manifest}`);
    }
    const { classifyAction } = require("./action-classifiers/classify-action");
    const classification = classifyAction({
      executable: gateOpts.executable,
      args: gateOpts.args,
      ctx: { repoRoot },
      __testToolManifest: st,
    });
    const { evaluatePermission } = require("./evaluate-permission");
    const { loadPermissionConfig, resolveProfile } = require("./load-permission-config");
    const { loadProjectPolicy, mergeProjectPolicy } = require("./load-project-policy");
    const { permissionDomainForClassification } = require("./classified-invocation-permission-gate");
    const { traceSecurityDecision } = require("./trace-security-decision");
    const profileName = gateOpts.permissionProfileName;
    const cfg = loadPermissionConfig();
    const baseProfile = resolveProfile(profileName, cfg.profiles);
    const projectPolicy = loadProjectPolicy(repoRoot);
    const merged = mergeProjectPolicy(baseProfile, projectPolicy, profileName);
    const domain = permissionDomainForClassification(classification);
    const input = {
      actor: "tool-eval",
      role: gateOpts.role,
      tool: classification.tool_id || path.basename(gateOpts.executable),
      action_class: classification.action_class || "unknown",
      target_class: classification.target_class ?? null,
      domain,
      permission_profile: profileName,
      policy_source: merged.policy_source,
      profile: merged.profile,
    };
    const output = evaluatePermission(input);
    const gate = {
      input,
      output,
      tracePayload: traceSecurityDecision(input, output),
      classification,
    };
    return evaluateScenarioResult(scenario, gate);
  }

  const gate = runClassifiedInvocationPermissionGate(gateOpts);
  return evaluateScenarioResult(scenario, gate);
}

function evaluateScenarioResult(scenario, gate) {
  const expected = scenario.expected || {};
  const classificationMismatches = classificationMatches(expected, gate.classification, gate.input);
  const permissionMismatches = permissionMatches(expected, gate.output);
  const failure_kind = diagnoseFailureKind(classificationMismatches, permissionMismatches);
  const pass = failure_kind === "pass";

  const traceEvent = gate.tracePayload && gate.tracePayload.event;
  const permission_check_emitted = traceEvent === "permission_check";

  return {
    id: scenario.id,
    family: scenario.family,
    intent: scenario.intent,
    pass,
    failure_kind,
    classificationMismatches,
    permissionMismatches,
    classification: gate.classification,
    input: gate.input,
    output: gate.output,
    permission_check_emitted,
    tracePayload: gate.tracePayload,
  };
}

function runAllToolEvalFixtures(opts = {}) {
  const fixtures = loadToolEvalFixtures(opts.fixturesPath);
  const results = fixtures.scenarios.map((s) => runToolEvalScenario(s, opts));
  const failed = results.filter((r) => !r.pass);
  return {
    version: fixtures.version,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
}

/**
 * Manifest entry readiness for new tools (CERBERUS gate helper).
 * @param {object} toolEntry single tool object from manifest draft
 * @param {string} toolId
 */
function validateToolManifestEntry(toolEntry, toolId) {
  const { validateManifestRoot } = require("./load-tool-action-manifest");
  const wrapped = {
    version: "tool-action-manifest.orchestrator.v1",
    tools: { [toolId]: toolEntry },
  };
  const st = validateManifestRoot(wrapped, ADAPTER_IDS);
  return { ok: st.valid, errors: st.errors };
}

/**
 * Tools in manifest without any fixture coverage (by tool_id family).
 * @param {object} manifestState from getToolActionManifest()
 * @param {object[]} scenarios
 */
function listToolsMissingFixtureCoverage(manifestState, scenarios) {
  if (!manifestState || !manifestState.valid) return [];
  const covered = new Set();
  for (const s of scenarios) {
    const tid = s.expected && s.expected.tool_id;
    if (tid) covered.add(tid);
    if (s.family && manifestState.tools[s.family]) {
      covered.add(s.family);
    }
  }
  const missing = [];
  for (const toolId of Object.keys(manifestState.tools || {})) {
    if (!covered.has(toolId)) missing.push(toolId);
  }
  return missing.sort();
}

const {
  loadUntrustedContextFixtures,
  runAllUntrustedContextFixtures,
} = require("./untrusted-context-eval");

module.exports = {
  DEFAULT_FIXTURES_PATH,
  LARGE_RESPONSE_CHAR_THRESHOLD,
  TEST_MANIFESTS,
  estimateTokenFootprint,
  largeResponseRecommendation,
  loadToolEvalFixtures,
  runToolEvalScenario,
  runAllToolEvalFixtures,
  diagnoseFailureKind,
  validateToolManifestEntry,
  listToolsMissingFixtureCoverage,
  loadUntrustedContextFixtures,
  runAllUntrustedContextFixtures,
};
