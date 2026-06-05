'use strict';

/**
 * Scaffold placeholder tool-eval fixtures for manifest tools missing coverage.
 * Does not invoke the classifier or infer final expected values from runtime.
 */

const fs = require('fs');
const path = require('path');
const { loadToolActionManifest } = require('./load-tool-action-manifest');
const {
  DEFAULT_FIXTURES_PATH,
  loadToolEvalFixtures,
  listToolsMissingFixtureCoverage,
} = require('./tool-eval');

const SCAFFOLD_PLACEHOLDERS = Object.freeze({
  ACTION_CLASS: 'TODO_EXPECTED_ACTION_CLASS',
  DECISION: 'TODO_EXPECTED_DECISION',
  DOMAIN: 'TODO_EXPECTED_DOMAIN',
});

const DEFAULT_SCAFFOLD_OUTPUT = path.join(
  __dirname,
  'tool-eval-fixtures.scaffold.pending.json',
);

/**
 * @param {unknown} expected
 * @returns {boolean}
 */
function isPlaceholderExpected(expected) {
  if (!expected || typeof expected !== 'object') return false;
  const e = /** @type {Record<string, unknown>} */ (expected);
  return e.action_class === SCAFFOLD_PLACEHOLDERS.ACTION_CLASS
    || e.decision === SCAFFOLD_PLACEHOLDERS.DECISION
    || e.domain === SCAFFOLD_PLACEHOLDERS.DOMAIN;
}

/**
 * @param {object} scenario
 * @returns {boolean}
 */
function isScaffoldScenario(scenario) {
  return scenario != null && scenario.scaffold === true;
}

/**
 * @param {string} toolId
 * @param {object} toolEntry
 * @param {object} rule
 * @param {number} index
 * @returns {object}
 */
function buildScaffoldScenarioForRule(toolId, toolEntry, rule, index) {
  const alias = Array.isArray(toolEntry.aliases) && toolEntry.aliases.length
    ? String(toolEntry.aliases[0])
    : toolId;
  const argv = rule && rule.match && Array.isArray(rule.match.argv)
    ? rule.match.argv.map((a) => String(a))
    : [];
  const ruleId = rule && rule.id ? String(rule.id) : `rule_${index}`;
  /** @type {Record<string, unknown>} */
  const expected = {
    tool_id: toolId,
    action_class: SCAFFOLD_PLACEHOLDERS.ACTION_CLASS,
    domain: SCAFFOLD_PLACEHOLDERS.DOMAIN,
    decision: SCAFFOLD_PLACEHOLDERS.DECISION,
  };
  if (rule && typeof rule.target_class === 'string' && rule.target_class.trim()) {
    expected.target_class = rule.target_class;
  }

  return {
    id: `scaffold_${toolId}_${ruleId}`,
    family: toolId,
    intent: 'scaffold_review_required',
    description: 'SCAFFOLD: human review required — replace TODO_* in expected before merge',
    executable: alias,
    args: argv,
    permission_profile: 'dev-local',
    role: 'DEV',
    scaffold: true,
    scaffold_source_rule: rule && rule.id ? rule.id : null,
    expected,
  };
}

/**
 * @param {string} toolId
 * @param {object} toolEntry
 * @returns {object[]}
 */
function buildScaffoldScenariosForTool(toolId, toolEntry) {
  const rules = Array.isArray(toolEntry.rules) ? toolEntry.rules : [];
  if (rules.length) {
    return rules.map((rule, index) => buildScaffoldScenarioForRule(toolId, toolEntry, rule, index));
  }

  const alias = Array.isArray(toolEntry.aliases) && toolEntry.aliases.length
    ? String(toolEntry.aliases[0])
    : toolId;
  return [{
    id: `scaffold_${toolId}_baseline`,
    family: toolId,
    intent: 'scaffold_review_required',
    description: 'SCAFFOLD: human review required — no manifest rules; fill argv + expected',
    executable: alias,
    args: [],
    permission_profile: 'dev-local',
    role: 'DEV',
    scaffold: true,
    scaffold_source_rule: null,
    expected: {
      tool_id: toolId,
      action_class: SCAFFOLD_PLACEHOLDERS.ACTION_CLASS,
      domain: SCAFFOLD_PLACEHOLDERS.DOMAIN,
      decision: SCAFFOLD_PLACEHOLDERS.DECISION,
    },
  }];
}

/**
 * @param {{
 *   fixturesPath?: string,
 *   manifestState?: object,
 *   toolIds?: string[],
 * }} [options]
 */
function generateScaffoldScenarios(options = {}) {
  const fixturesPath = options.fixturesPath || DEFAULT_FIXTURES_PATH;
  const fixtures = loadToolEvalFixtures(fixturesPath);
  const manifestState = options.manifestState || loadToolActionManifest();
  if (!manifestState.valid) {
    return { ok: false, error: 'invalid_manifest', errors: manifestState.errors || [] };
  }

  const missing = options.toolIds && options.toolIds.length
    ? options.toolIds.slice().sort()
    : listToolsMissingFixtureCoverage(manifestState, fixtures.scenarios);

  /** @type {object[]} */
  const scenarios = [];
  for (const toolId of missing) {
    const entry = manifestState.tools[toolId];
    if (!entry) continue;
    scenarios.push(...buildScaffoldScenariosForTool(toolId, entry));
  }

  return {
    ok: true,
    version: fixtures.version,
    missing_tools: missing,
    scenarios,
  };
}

/**
 * @param {{
 *   fixturesPath?: string,
 *   outputPath?: string,
 *   dryRun?: boolean,
 *   toolIds?: string[],
 * }} [options]
 */
function scaffoldToolEvalFixtures(options = {}) {
  const generated = generateScaffoldScenarios(options);
  if (!generated.ok) return generated;

  const outputPath = options.outputPath || DEFAULT_SCAFFOLD_OUTPUT;
  const payload = {
    version: generated.version,
    scaffold_meta: {
      generated_at: new Date().toISOString(),
      missing_tools: generated.missing_tools,
      placeholder_policy: 'human_review_required_no_classifier_inference',
    },
    scenarios: generated.scenarios,
  };

  if (options.dryRun === true) {
    return {
      ok: true,
      dry_run: true,
      output_path: outputPath,
      missing_tools: generated.missing_tools,
      scenario_count: generated.scenarios.length,
      scenarios: generated.scenarios,
      json: `${JSON.stringify(payload, null, 2)}\n`,
    };
  }

  if (!generated.scenarios.length) {
    return {
      ok: true,
      wrote: false,
      output_path: outputPath,
      missing_tools: [],
      scenario_count: 0,
      message: 'no_missing_tools',
    };
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    wrote: true,
    output_path: outputPath,
    missing_tools: generated.missing_tools,
    scenario_count: generated.scenarios.length,
    scenarios: generated.scenarios,
  };
}

module.exports = {
  SCAFFOLD_PLACEHOLDERS,
  DEFAULT_SCAFFOLD_OUTPUT,
  isPlaceholderExpected,
  isScaffoldScenario,
  buildScaffoldScenarioForRule,
  buildScaffoldScenariosForTool,
  generateScaffoldScenarios,
  scaffoldToolEvalFixtures,
};
