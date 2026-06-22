"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const ORCH = path.join(__dirname, "..");

describe("modules physical layout", () => {
  describe("gates", () => {
    it("physical modules/gates tree exists", () => {
      for (const rel of [
        "modules/gates/index.js",
        "modules/gates/governance-gate.js",
        "modules/gates/approval-policy-gate.js",
        "modules/gates/doubt-review.js",
        "modules/gates/review-record.js",
        "modules/gates/merge-governance/index.js",
        "modules/gates/merge-governance/pr-boundary-governance-gate.js",
      ]) {
        assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
      }
    });

    it("root shims re-export the same gate APIs", () => {
      const shimGov = require("../governance-gate");
      const canonGov = require("../modules/gates/governance-gate");
      assert.equal(shimGov.GOVERNANCE_GATE_ID, canonGov.GOVERNANCE_GATE_ID);
      assert.equal(typeof shimGov.buildApprovalGrantedPayload, "function");

      const shimMerge = require("../merge-governance");
      const canonMerge = require("../modules/gates/merge-governance");
      assert.equal(shimMerge.GATE_ID, canonMerge.GATE_ID);
      assert.equal(typeof shimMerge.evaluatePrBoundaryGovernance, "function");

      const shimPolicy = require("../approval-policy-gate");
      const canonPolicy = require("../modules/gates/approval-policy-gate");
      assert.deepEqual(shimPolicy.APPROVAL_GATE_IDS, canonPolicy.APPROVAL_GATE_IDS);
      assert.equal(typeof shimPolicy.evaluateApprovalGate, "function");

      const shimDoubt = require("../doubt-review");
      const canonDoubt = require("../modules/gates/doubt-review");
      assert.equal(shimDoubt.DOUBT_REVIEW_SCHEMA_VERSION, canonDoubt.DOUBT_REVIEW_SCHEMA_VERSION);
      assert.equal(typeof shimDoubt.traceDoubtReviewCycle, "function");

      const shimReview = require("../review-record");
      const canonReview = require("../modules/gates/review-record");
      assert.equal(shimReview.REVIEW_SCHEMA_VERSION, canonReview.REVIEW_SCHEMA_VERSION);
      assert.equal(typeof shimReview.buildReviewRecord, "function");
    });

    it("modules/gates index aggregates exports", () => {
      const gates = require("../modules/gates");
      assert.equal(typeof gates.evaluatePrBoundaryGovernance, "function");
      assert.equal(typeof gates.governanceRunnerShouldHold, "function");
      assert.equal(typeof gates.evaluateApprovalGate, "function");
      assert.equal(typeof gates.traceDoubtReviewCycle, "function");
      assert.equal(typeof gates.buildReviewRecord, "function");
    });
  });

  describe("contracts", () => {
    it("physical modules/contracts tree exists with design validators", () => {
      for (const rel of [
        "modules/contracts/index.js",
        "modules/contracts/bv-reviewer-design.js",
        "modules/contracts/progressive-disclosure-design.js",
        "modules/contracts/self-improvement-loop-design.js",
      ]) {
        assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
      }
    });

    it("root shims re-export the same contract validator APIs", () => {
      const shimBv = require("../bv-reviewer-design");
      const canonBv = require("../modules/contracts/bv-reviewer-design");
      assert.equal(shimBv.VALUE_REVIEW_SCHEMA_VERSION, canonBv.VALUE_REVIEW_SCHEMA_VERSION);
      assert.equal(typeof shimBv.validateValueReviewTraceLine, "function");

      const shimPd = require("../progressive-disclosure-design");
      const canonPd = require("../modules/contracts/progressive-disclosure-design");
      assert.equal(shimPd.DISCLOSURE_SCHEMA_VERSION, canonPd.DISCLOSURE_SCHEMA_VERSION);
      assert.equal(typeof shimPd.validateContextDisclosureTraceLine, "function");

      const shimSi = require("../self-improvement-loop-design");
      const canonSi = require("../modules/contracts/self-improvement-loop-design");
      assert.equal(shimSi.IMPROVEMENT_PROPOSAL_SCHEMA_VERSION, canonSi.IMPROVEMENT_PROPOSAL_SCHEMA_VERSION);
      assert.equal(typeof shimSi.validateImprovementProposalTraceLine, "function");
    });

    it("modules/contracts index aggregates contracts-owned validators only", () => {
      const contracts = require("../modules/contracts");
      assert.equal(typeof contracts.validateValueReviewTraceLine, "function");
      assert.equal(typeof contracts.validateImprovementProposalTraceLine, "function");
      assert.equal(contracts.validateContextDisclosureTraceLine, undefined);
    });

    it("progressive disclosure remains reachable via shim and canonical path", () => {
      assert.equal(typeof require("../progressive-disclosure-design").validateContextDisclosureTraceLine, "function");
      assert.equal(
        typeof require("../modules/contracts/progressive-disclosure-design").validateContextDisclosureTraceLine,
        "function",
      );
    });
  });

  describe("recovery", () => {
    it("physical modules/recovery tree exists", () => {
      for (const rel of [
        "modules/recovery/index.js",
        "modules/recovery/recovery-sweep.js",
        "modules/recovery/session-resume.js",
      ]) {
        assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
      }
    });

    it("root shims re-export the same recovery APIs", () => {
      const shimSweep = require("../recovery-sweep");
      const canonSweep = require("../modules/recovery/recovery-sweep");
      assert.equal(shimSweep.RECOVERY_SCHEMA_VERSION, canonSweep.RECOVERY_SCHEMA_VERSION);
      assert.equal(typeof shimSweep.summarizeRecoveryFromRows, "function");

      const shimResume = require("../session-resume");
      const canonResume = require("../modules/recovery/session-resume");
      assert.equal(shimResume.SESSION_RESUME_SCHEMA_VERSION, canonResume.SESSION_RESUME_SCHEMA_VERSION);
      assert.equal(typeof shimResume.summarizeSessionResumeFromRows, "function");
    });

    it("modules/recovery index aggregates exports", () => {
      const recovery = require("../modules/recovery");
      assert.equal(typeof recovery.summarizeRecoveryFromRows, "function");
      assert.equal(typeof recovery.summarizeSessionResumeFromRows, "function");
    });
  });

  describe("trace", () => {
    it("physical modules/trace tree exists", () => {
      for (const rel of [
        "modules/trace/index.js",
        "modules/trace/trace-schema.js",
        "modules/trace/trace-writer.js",
        "modules/trace/trace-append.js",
        "modules/trace/trace-redact.js",
        "modules/trace/trace-lifecycle-events.js",
        "modules/trace/context-hygiene-signals.js",
        "modules/trace/run-outcome-summary.js",
        "modules/trace/otel-genai-trace-map.js",
      ]) {
        assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
      }
    });

    it("root shims re-export the same trace APIs", () => {
      const shimSchema = require("../trace-schema");
      const canonSchema = require("../modules/trace/trace-schema");
      assert.equal(shimSchema.TRACE_LINE_WRITER_VERSION, canonSchema.TRACE_LINE_WRITER_VERSION);
      assert.equal(typeof shimSchema.validateTraceLine, "function");

      const shimWriter = require("../trace-writer");
      const canonWriter = require("../modules/trace/trace-writer");
      assert.equal(shimWriter.TRACE_SCHEMA_VERSION, canonWriter.TRACE_SCHEMA_VERSION);
      assert.equal(typeof shimWriter.traceEvent, "function");

      const shimOutcome = require("../run-outcome-summary");
      const canonOutcome = require("../modules/trace/run-outcome-summary");
      assert.equal(typeof shimOutcome.buildRunOutcomeSummary, "function");
      assert.equal(typeof shimOutcome.formatRunOutcomeSummaryLines, "function");
    });

    it("modules/trace index aggregates core exports", () => {
      const trace = require("../modules/trace");
      assert.equal(typeof trace.validateTraceLine, "function");
      assert.equal(typeof trace.traceEvent, "function");
      assert.equal(typeof trace.buildRunOutcomeSummary, "function");
      assert.equal(typeof trace.mapTraceRowsToOtelSpans, "function");
    });

    it("trace-schema resolves bundled schema from modules/trace", () => {
      const { validateTraceLine } = require("../modules/trace/trace-schema");
      const row = {
        ts: "2026-04-15T12:00:00.000Z",
        ts_ms: 1713182400000,
        trace_schema_version: "2",
        task_id: "physical-layout-fixture",
        event: "session_start",
        flow_mode: "single_agent",
        max_iterations: 1,
        cwd: "/tmp",
        goal: "x",
      };
      const result = validateTraceLine(row);
      assert.equal(result.ok, true, result.errors?.join("; "));
    });
  });

  describe("budget", () => {
    it("physical modules/budget tree exists", () => {
      for (const rel of [
        "modules/budget/index.js",
        "modules/budget/token-usage-summary.js",
        "modules/budget/token-trace-report.js",
        "modules/budget/cost-accounting-dimensions.js",
      ]) {
        assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
      }
    });

    it("root shims re-export the same budget APIs", () => {
      const shimSummary = require("../token-usage-summary");
      const canonSummary = require("../modules/budget/token-usage-summary");
      assert.equal(typeof shimSummary.buildTokenUsageSummary, "function");
      assert.equal(shimSummary.buildTokenUsageSummary, canonSummary.buildTokenUsageSummary);

      const shimCost = require("../cost-accounting-dimensions");
      const canonCost = require("../modules/budget/cost-accounting-dimensions");
      assert.equal(typeof shimCost.buildRunCostAccountingFromReport, "function");
      assert.equal(shimCost.buildRunCostAccountingFromReport, canonCost.buildRunCostAccountingFromReport);

      const shimReport = require("../token-trace-report");
      const canonReport = require("../modules/budget/token-trace-report");
      assert.equal(typeof shimReport.buildReport, "function");
      assert.equal(typeof shimReport.parseJsonl, "function");
      assert.equal(shimReport.buildReport, canonReport.buildReport);
    });

    it("modules/budget index aggregates core exports", () => {
      const budget = require("../modules/budget");
      assert.equal(typeof budget.buildTokenUsageSummary, "function");
      assert.equal(typeof budget.buildRunCostAccountingFromReport, "function");
      assert.equal(typeof budget.buildReport, "function");
      assert.equal(typeof budget.parseJsonl, "function");
    });

  });

  describe("worktree", () => {
    it("physical modules/worktree tree exists", () => {
      for (const rel of [
        "modules/worktree/index.js",
        "modules/worktree/worktree-isolation.js",
        "modules/worktree/worktree-result-promotion.js",
        "modules/worktree/worktree-cleanup-safety.js",
        "modules/worktree/run-workdir-contract.js",
        "modules/worktree/trace-workspace-lifecycle.js",
      ]) {
        assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
      }
    });

    it("root shims re-export the same worktree APIs", () => {
      const shimIso = require("../worktree-isolation");
      const canonIso = require("../modules/worktree/worktree-isolation");
      assert.equal(shimIso.BINDING_SCHEMA_VERSION, canonIso.BINDING_SCHEMA_VERSION);
      assert.equal(typeof shimIso.createIsolatedWorktree, "function");
      assert.equal(shimIso.planWorktree, canonIso.planWorktree);

      const shimContract = require("../run-workdir-contract");
      const canonContract = require("../modules/worktree/run-workdir-contract");
      assert.equal(shimContract.CONTRACT_SCHEMA_VERSION, canonContract.CONTRACT_SCHEMA_VERSION);
      assert.equal(typeof shimContract.readRunWorkdirContract, "function");

      const shimLifecycle = require("../trace-workspace-lifecycle");
      const canonLifecycle = require("../modules/worktree/trace-workspace-lifecycle");
      assert.equal(typeof shimLifecycle.summarizeWorkspaceLifecycleFromRows, "function");
      assert.deepEqual(shimLifecycle.WORKSPACE_EVENTS, canonLifecycle.WORKSPACE_EVENTS);
      assert.equal(shimLifecycle.summarizeWorkspaceLifecycleFromRows, canonLifecycle.summarizeWorkspaceLifecycleFromRows);

      const shimPromotion = require("../worktree-result-promotion");
      const canonPromotion = require("../modules/worktree/worktree-result-promotion");
      assert.equal(shimPromotion.PROMOTION_SCHEMA_VERSION, canonPromotion.PROMOTION_SCHEMA_VERSION);
      assert.equal(typeof shimPromotion.promoteWorktreeResults, "function");
      assert.equal(shimPromotion.promoteWorktreeResults, canonPromotion.promoteWorktreeResults);
      assert.equal(shimPromotion.validatePromotionEligibility, canonPromotion.validatePromotionEligibility);

      const shimCleanup = require("../worktree-cleanup-safety");
      const canonCleanup = require("../modules/worktree/worktree-cleanup-safety");
      assert.equal(typeof shimCleanup.validateCleanupTarget, "function");
      assert.equal(shimCleanup.validateCleanupTarget, canonCleanup.validateCleanupTarget);
      assert.equal(shimCleanup.isUnderAllowedRoot, canonCleanup.isUnderAllowedRoot);
    });

    it("modules/worktree index aggregates core exports", () => {
      const worktree = require("../modules/worktree");
      assert.equal(typeof worktree.createIsolatedWorktree, "function");
      assert.equal(typeof worktree.readRunWorkdirContract, "function");
      assert.equal(typeof worktree.promoteWorktreeResults, "function");
      assert.equal(typeof worktree.validateCleanupTarget, "function");
      assert.equal(typeof worktree.summarizeWorkspaceLifecycleFromRows, "function");
    });
  });

  describe("operator", () => {
    it("physical modules/operator tree exists", () => {
      for (const rel of [
        "modules/operator/index.js",
        "modules/operator/console-dashboard.js",
        "modules/operator/control-plane-tui.js",
        "modules/operator/explain-run.js",
        "modules/operator/operator-cli-help.js",
        "modules/operator/project-template-cli.js",
        "modules/operator/runner-budget-view.js",
        "modules/operator/runner-launcher.js",
        "modules/operator/runner-preflight.js",
        "modules/operator/runner-trace-viewer.js",
        "modules/operator/runner-tui-cli.js",
        "modules/operator/scenario-metrics-export.js",
      ]) {
        assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
      }
    });

    it("root shims re-export the same operator APIs", () => {
      const shimHelp = require("../operator-cli-help");
      const canonHelp = require("../modules/operator/operator-cli-help");
      assert.equal(typeof shimHelp.printOperatorCliHelp, "function");
      assert.equal(shimHelp.printOperatorCliHelp, canonHelp.printOperatorCliHelp);

      const shimPreflight = require("../runner-preflight");
      const canonPreflight = require("../modules/operator/runner-preflight");
      assert.equal(typeof shimPreflight.buildRunPreflight, "function");
      assert.equal(shimPreflight.buildRunPreflight, canonPreflight.buildRunPreflight);

      const shimTrace = require("../runner-trace-viewer");
      const canonTrace = require("../modules/operator/runner-trace-viewer");
      assert.equal(typeof shimTrace.runTraceViewer, "function");
      assert.equal(shimTrace.runTraceViewer, canonTrace.runTraceViewer);

      const shimBudget = require("../runner-budget-view");
      const canonBudget = require("../modules/operator/runner-budget-view");
      assert.equal(typeof shimBudget.runBudgetView, "function");
      assert.equal(shimBudget.runBudgetView, canonBudget.runBudgetView);
    });

    it("runner-model-routing canonical path lives under model-runtime with root shim", () => {
      assert.ok(fs.existsSync(path.join(ORCH, "modules/model-runtime/runner-model-routing.js")));
      assert.ok(fs.existsSync(path.join(ORCH, "runner-model-routing.js")));
      assert.equal(fs.existsSync(path.join(ORCH, "modules/operator/runner-model-routing.js")), false);
    });

    it("modules/operator index aggregates core exports", () => {
      const operator = require("../modules/operator");
      assert.equal(typeof operator.printOperatorCliHelp, "function");
      assert.equal(typeof operator.buildDashboardText, "function");
      assert.equal(typeof operator.deriveExplain, "function");
      assert.equal(typeof operator.collectRunsFromDir, "function");
      assert.equal(typeof operator.runTraceViewer, "function");
      assert.equal(typeof operator.main, "function");
    });

    it("runner-launcher requires root orchestrator.js (not ./orchestrator under operator)", () => {
      const launcherSource = fs.readFileSync(
        path.join(ORCH, "modules/operator/runner-launcher.js"),
        "utf8",
      );
      assert.match(launcherSource, /require\(["']\.\.\/\.\.\/orchestrator["']\)/);
      assert.doesNotMatch(launcherSource, /require\(["']\.\/orchestrator["']\)/);
    });
  });

  describe("model-runtime", () => {
    it("physical modules/model-runtime tree exists", () => {
      for (const rel of [
        "modules/model-runtime/index.js",
        "modules/model-runtime/model-policy-config.js",
        "modules/model-runtime/model-tier-gate.js",
        "modules/model-runtime/local-model-discovery.js",
        "modules/model-runtime/local-model-selection.js",
        "modules/model-runtime/local-model-policy.js",
        "modules/model-runtime/runner-model-routing.js",
        "modules/model-runtime/flow-hook-bridge.js",
      ]) {
        assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
      }
    });

    it("root shims re-export the same model-runtime APIs", () => {
      const shimDiscovery = require("../local-model-discovery");
      const canonDiscovery = require("../modules/model-runtime/local-model-discovery");
      assert.equal(shimDiscovery.OLLAMA_BACKEND_ID, canonDiscovery.OLLAMA_BACKEND_ID);
      assert.equal(typeof shimDiscovery.discoverLocalModels, "function");
      assert.equal(shimDiscovery.discoverLocalModels, canonDiscovery.discoverLocalModels);

      const shimSelection = require("../local-model-selection");
      const canonSelection = require("../modules/model-runtime/local-model-selection");
      assert.equal(shimSelection.SUPPORTED_POLICY_VERSION, canonSelection.SUPPORTED_POLICY_VERSION);
      assert.equal(typeof shimSelection.selectLocalModel, "function");
      assert.equal(shimSelection.selectLocalModel, canonSelection.selectLocalModel);

      const shimPolicy = require("../local-model-policy");
      const canonPolicy = require("../modules/model-runtime/local-model-policy");
      assert.equal(shimPolicy.GATE_ID, canonPolicy.GATE_ID);
      assert.equal(typeof shimPolicy.isLocalOnlyModeEnabled, "function");
      assert.equal(shimPolicy.isLocalOnlyModeEnabled, canonPolicy.isLocalOnlyModeEnabled);

      const shimRouting = require("../runner-model-routing");
      const canonRouting = require("../modules/model-runtime/runner-model-routing");
      assert.equal(typeof shimRouting.buildRoleRoutingPreview, "function");
      assert.equal(shimRouting.buildRoleRoutingPreview, canonRouting.buildRoleRoutingPreview);

      const shimBridge = require("../flow-hook-bridge");
      const canonBridge = require("../modules/model-runtime/flow-hook-bridge");
      assert.equal(typeof shimBridge.deriveRunScope, "function");
      assert.equal(shimBridge.deriveRunScope, canonBridge.deriveRunScope);
    });

    it("modules/model-runtime index aggregates core exports", () => {
      const modelRuntime = require("../modules/model-runtime");
      assert.equal(typeof modelRuntime.discoverLocalModels, "function");
      assert.equal(typeof modelRuntime.selectLocalModel, "function");
      assert.equal(typeof modelRuntime.isLocalOnlyModeEnabled, "function");
      assert.equal(typeof modelRuntime.buildRoleRoutingPreview, "function");
      assert.equal(typeof modelRuntime.deriveRunScope, "function");
      assert.equal(typeof modelRuntime.loadModelPolicyConfig, "function");
      assert.equal(typeof modelRuntime.evaluateModelTierGate, "function");
    });
  });

  describe("module README stubs", () => {
    const PHYSICAL_CONTEXTS = [
      "gates",
      "contracts",
      "recovery",
      "trace",
      "budget",
      "worktree",
      "operator",
      "model-runtime",
    ];
    const REQUIRED_SECTIONS = [
      "## Ownership",
      "Must not own",
      "## Allowed imports",
      "module-boundaries.md",
      "## Forbidden",
      "## Related contracts",
    ];

    for (const ctx of PHYSICAL_CONTEXTS) {
      it(`${ctx} README stub links module-boundaries adjacency`, () => {
        const readme = path.join(ORCH, "modules", ctx, "README.md");
        assert.ok(fs.existsSync(readme), `missing ${readme}`);
        const text = fs.readFileSync(readme, "utf8");
        for (const section of REQUIRED_SECTIONS) {
          assert.ok(text.includes(section), `${ctx} README missing: ${section}`);
        }
      });
    }
  });
});
