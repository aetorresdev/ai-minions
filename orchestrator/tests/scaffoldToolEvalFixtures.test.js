"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");

const { manifestFromObject } = require("../security/load-tool-action-manifest");
const { ADAPTER_IDS } = require("../security/action-classifiers/adapter-registry");
const {
  SCAFFOLD_PLACEHOLDERS,
  isPlaceholderExpected,
  isScaffoldScenario,
  buildScaffoldScenarioForRule,
  buildScaffoldScenariosForTool,
  generateScaffoldScenarios,
  scaffoldToolEvalFixtures,
} = require("../security/scaffold-tool-eval-fixtures");

function syntheticManifest() {
  return manifestFromObject({
    version: "tool-action-manifest.orchestrator.v1",
    tools: {
      demo_cli: {
        id: "demo_cli",
        type: "shell_tool",
        risk_profile: "test",
        capabilities: ["demo.read"],
        aliases: ["demo-cli"],
        rules: [
          {
            id: "demo_plan",
            match: { type: "argv_prefix", argv: ["plan"] },
            action_class: "simulate",
            target_class: "cloud_infra",
          },
          {
            id: "demo_apply",
            match: { type: "argv_prefix", argv: ["apply"] },
            action_class: "external_side_effect",
            target_class: "cloud_infra",
          },
        ],
      },
      adapter_only: {
        id: "adapter_only",
        type: "shell_tool",
        risk_profile: "test",
        capabilities: ["demo.adapter"],
        aliases: ["adapter-only"],
        rules: [],
        adapter: "aws",
        delegate_unmatched_to_adapter: true,
      },
    },
  }, ADAPTER_IDS);
}

describe("scaffold-tool-eval-fixtures", () => {
  it("buildScaffoldScenarioForRule uses TODO placeholders not manifest action_class", () => {
    const entry = syntheticManifest().tools.demo_cli;
    const rule = entry.rules[0];
    const scenario = buildScaffoldScenarioForRule("demo_cli", entry, rule, 0);
    assert.equal(isScaffoldScenario(scenario), true);
    assert.equal(scenario.args.join(","), "plan");
    assert.equal(scenario.expected.action_class, SCAFFOLD_PLACEHOLDERS.ACTION_CLASS);
    assert.equal(scenario.expected.decision, SCAFFOLD_PLACEHOLDERS.DECISION);
    assert.equal(scenario.expected.domain, SCAFFOLD_PLACEHOLDERS.DOMAIN);
    assert.equal(scenario.expected.target_class, "cloud_infra");
    assert.notEqual(scenario.expected.action_class, rule.action_class);
    assert.ok(isPlaceholderExpected(scenario.expected));
  });

  it("buildScaffoldScenariosForTool emits one scenario per manifest rule", () => {
    const entry = syntheticManifest().tools.demo_cli;
    const scenarios = buildScaffoldScenariosForTool("demo_cli", entry);
    assert.equal(scenarios.length, 2);
    assert.equal(scenarios[0].id, "scaffold_demo_cli_demo_plan");
    assert.equal(scenarios[1].id, "scaffold_demo_cli_demo_apply");
  });

  it("buildScaffoldScenariosForTool baseline when no rules", () => {
    const entry = syntheticManifest().tools.adapter_only;
    const scenarios = buildScaffoldScenariosForTool("adapter_only", entry);
    assert.equal(scenarios.length, 1);
    assert.equal(scenarios[0].executable, "adapter-only");
    assert.equal(scenarios[0].args.length, 0);
  });

  it("generateScaffoldScenarios detects tools missing from fixtures", () => {
    const manifestState = syntheticManifest();
    const fixturesPath = path.join(os.tmpdir(), `tool-eval-empty-${Date.now()}.json`);
    fs.writeFileSync(fixturesPath, JSON.stringify({
      version: "tool-eval-fixtures.orchestrator.v1",
      scenarios: [],
    }, null, 2));

    const generated = generateScaffoldScenarios({
      fixturesPath,
      manifestState,
    });
    assert.equal(generated.ok, true);
    assert.deepEqual(generated.missing_tools, ["adapter_only", "demo_cli"]);
    assert.equal(generated.scenarios.length, 3);

    fs.unlinkSync(fixturesPath);
  });

  it("scaffoldToolEvalFixtures dry-run does not write output file", () => {
    const manifestState = syntheticManifest();
    const fixturesPath = path.join(os.tmpdir(), `tool-eval-empty-${Date.now()}.json`);
    const outputPath = path.join(os.tmpdir(), `tool-eval-scaffold-${Date.now()}.json`);
    fs.writeFileSync(fixturesPath, JSON.stringify({
      version: "tool-eval-fixtures.orchestrator.v1",
      scenarios: [],
    }, null, 2));

    const result = scaffoldToolEvalFixtures({
      fixturesPath,
      manifestState,
      outputPath,
      dryRun: true,
      toolIds: ["demo_cli"],
    });
    assert.equal(result.ok, true);
    assert.equal(result.dry_run, true);
    assert.ok(result.json.includes(SCAFFOLD_PLACEHOLDERS.ACTION_CLASS));
    assert.equal(fs.existsSync(outputPath), false);

    fs.unlinkSync(fixturesPath);
  });

  it("scaffoldToolEvalFixtures writes pending file for missing tools", () => {
    const manifestState = syntheticManifest();
    const fixturesPath = path.join(os.tmpdir(), `tool-eval-empty-${Date.now()}.json`);
    const outputPath = path.join(os.tmpdir(), `tool-eval-scaffold-${Date.now()}.json`);
    fs.writeFileSync(fixturesPath, JSON.stringify({
      version: "tool-eval-fixtures.orchestrator.v1",
      scenarios: [],
    }, null, 2));

    const result = scaffoldToolEvalFixtures({
      fixturesPath,
      manifestState,
      outputPath,
      toolIds: ["adapter_only"],
    });
    assert.equal(result.ok, true);
    assert.equal(result.wrote, true);
    assert.ok(fs.existsSync(outputPath));
    const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(written.scenarios.length, 1);
    assert.equal(written.scaffold_meta.missing_tools.join(","), "adapter_only");

    fs.unlinkSync(fixturesPath);
    fs.unlinkSync(outputPath);
  });
});
