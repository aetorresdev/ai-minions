"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  loadToolEvalFixtures,
  runAllToolEvalFixtures,
  runToolEvalScenario,
  diagnoseFailureKind,
  estimateTokenFootprint,
  largeResponseRecommendation,
  validateToolManifestEntry,
  listToolsMissingFixtureCoverage,
  LARGE_RESPONSE_CHAR_THRESHOLD,
} = require("../security/tool-eval");
const { loadToolActionManifest, resetToolActionManifestCache } = require("../security/load-tool-action-manifest");

describe("tool-eval — harness fixtures", () => {
  beforeEach(() => {
    resetToolActionManifestCache();
    loadToolActionManifest();
  });

  it("loads versioned fixture matrix", () => {
    const fx = loadToolEvalFixtures();
    assert.equal(fx.version, "tool-eval-fixtures.orchestrator.v1");
    assert.ok(fx.scenarios.length >= 25);
    const families = new Set(fx.scenarios.map((s) => s.family));
    for (const f of [
      "filesystem",
      "git",
      "terraform",
      "kubectl",
      "aws",
      "n8n",
      "jenkins",
      "gcloud",
      "gsutil",
      "bq",
      "github_actions",
      "unknown",
    ]) {
      assert.ok(families.has(f), `missing family ${f}`);
    }
  });

  it("all default fixtures pass", () => {
    const summary = runAllToolEvalFixtures();
    if (summary.failed > 0) {
      const detail = summary.results
        .filter((r) => !r.pass)
        .map((r) => `${r.id}: ${JSON.stringify(r.classificationMismatches)} ${JSON.stringify(r.permissionMismatches)}`)
        .join("\n");
      assert.fail(`${summary.failed} fixture(s) failed:\n${detail}`);
    }
    assert.equal(summary.failed, 0);
    assert.equal(summary.passed, summary.total);
  });

  it("each scenario emits permission_check trace payload", () => {
    const summary = runAllToolEvalFixtures();
    for (const r of summary.results) {
      assert.equal(r.permission_check_emitted, true, `${r.id} missing permission_check`);
      assert.equal(r.tracePayload.event, "permission_check");
      assert.ok(r.tracePayload.decision);
    }
  });

  it("diagnoseFailureKind separates tool_selection vs permission_policy", () => {
    assert.equal(diagnoseFailureKind([], []), "pass");
    assert.equal(diagnoseFailureKind([{ field: "action_class" }], []), "tool_selection");
    assert.equal(diagnoseFailureKind([], [{ field: "decision" }]), "permission_policy");
    assert.equal(
      diagnoseFailureKind([{ field: "action_class" }], [{ field: "decision" }]),
      "tool_selection",
    );
  });

  it("terraform_apply_ci_safe is permission_policy not tool_selection", () => {
    const fx = loadToolEvalFixtures();
    const scenario = fx.scenarios.find((s) => s.id === "terraform_apply_ci_safe_permission_denied");
    assert.ok(scenario);
    const r = runToolEvalScenario(scenario);
    assert.equal(r.failure_kind, "pass");
    assert.equal(r.intent, "permission_policy");
    assert.equal(r.output.decision, "deny");
    assert.equal(r.classification.action_class, "external_side_effect");
  });

  it("unknown_executable is tool_selection path (unknown action_class)", () => {
    const fx = loadToolEvalFixtures();
    const scenario = fx.scenarios.find((s) => s.id === "unknown_executable_tool_selection");
    const r = runToolEvalScenario(scenario);
    assert.equal(r.pass, true);
    assert.equal(r.classification.action_class, "unknown");
    assert.equal(r.output.decision, "deny");
  });

  it("incomplete manifest tool yields unknown not allow", () => {
    const fx = loadToolEvalFixtures();
    const scenario = fx.scenarios.find((s) => s.id === "manifest_incomplete_tool_unknown");
    const r = runToolEvalScenario(scenario);
    assert.equal(r.classification.action_class, "unknown");
    assert.equal(r.output.decision, "deny");
    assert.notEqual(r.output.decision, "allow");
  });

  it("validateToolManifestEntry rejects incomplete metadata", () => {
    const bad = validateToolManifestEntry(
      {
        id: "bad",
        type: "shell_tool",
        aliases: ["bad-cli"],
      },
      "bad",
    );
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.includes("risk_profile")));
  });

  it("estimateTokenFootprint and largeResponseRecommendation", () => {
    const small = estimateTokenFootprint("hello");
    assert.equal(small.chars, 5);
    assert.equal(small.approx_tokens, 2);
    assert.equal(largeResponseRecommendation(100), null);
    const big = largeResponseRecommendation(LARGE_RESPONSE_CHAR_THRESHOLD + 1);
    assert.equal(big.recommendation, "progressive_disclosure_or_compact_response");
  });

  it("every manifest tool has fixture coverage", () => {
    const fx = loadToolEvalFixtures();
    const st = loadToolActionManifest();
    const missing = listToolsMissingFixtureCoverage(st, fx.scenarios);
    assert.deepEqual(
      missing,
      [],
      `manifest tools without fixtures: ${missing.join(", ") || "(none)"}`,
    );
  });
});
