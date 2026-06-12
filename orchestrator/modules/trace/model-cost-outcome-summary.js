"use strict";

/**
 * Tier-level cost/outcome rollup from trace evidence (no policy evaluation).
 */

const { inferModelTier, MODEL_TIERS } = require("./model-selection-trace");

const TIER_ORDER = /** @type {const} */ ([...MODEL_TIERS, "unknown"]);

/**
 * @param {number} x
 * @returns {number}
 */
function roundUsd(x) {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * @param {string} tier
 * @returns {number}
 */
function tierSortKey(tier) {
  const idx = TIER_ORDER.indexOf(/** @type {typeof TIER_ORDER[number]} */ (tier));
  return idx >= 0 ? idx : TIER_ORDER.length;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ tier: string, missingMetadata: boolean }}
 */
function resolveModelTier(row) {
  const explicit = typeof row.model_tier === "string" ? row.model_tier : null;
  const explicitValid = explicit != null
    && MODEL_TIERS.includes(/** @type {typeof MODEL_TIERS[number]} */ (explicit));
  if (explicitValid) {
    return { tier: explicit, missingMetadata: false };
  }
  const model = typeof row.model === "string" ? row.model : "";
  if (model) {
    return { tier: inferModelTier(model), missingMetadata: !explicitValid };
  }
  return { tier: "unknown", missingMetadata: true };
}

/**
 * @param {string} tier
 * @returns {{
 *   model_tier: string,
 *   steps: number,
 *   cost_usd: number,
 *   gate_failures: number,
 *   retries: number,
 *   roles: Set<string>,
 *   agents: Set<string>,
 * }}
 */
function emptyTierBucket(tier) {
  return {
    model_tier: tier,
    steps: 0,
    cost_usd: 0,
    gate_failures: 0,
    retries: 0,
    roles: new Set(),
    agents: new Set(),
  };
}

/**
 * @param {Record<string, unknown>[]} rows
 * @returns {{
 *   computed_from: string,
 *   tiers: Array<{
 *     model_tier: string,
 *     steps: number,
 *     cost_usd: number,
 *     gate_failures: number,
 *     retries: number,
 *     roles: string[],
 *     agents: string[],
 *   }>,
 *   total_steps: number,
 *   missing_tier_metadata_count: number,
 * }}
 */
function summarizeModelCostOutcomeFromRows(rows) {
  /** @type {Map<string, ReturnType<typeof emptyTierBucket>>} */
  const buckets = new Map();
  /** @type {Map<string, string>} */
  const stepTier = new Map();
  let missingTierMetadata = 0;

  const ensure = (tier) => {
    if (!buckets.has(tier)) buckets.set(tier, emptyTierBucket(tier));
    return /** @type {ReturnType<typeof emptyTierBucket>} */ (buckets.get(tier));
  };

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const ev = row.event;

    if (ev === "model_selection") {
      const { tier, missingMetadata } = resolveModelTier(row);
      if (missingMetadata) missingTierMetadata += 1;
      const b = ensure(tier);
      b.steps += 1;
      const cost = typeof row.estimated_cost_usd === "number" && !Number.isNaN(row.estimated_cost_usd)
        ? row.estimated_cost_usd
        : 0;
      b.cost_usd += cost;
      if (typeof row.role === "string") b.roles.add(row.role);
      if (typeof row.agent === "string") b.agents.add(row.agent);
      if (typeof row.step_id === "string" && row.step_id.length) {
        stepTier.set(row.step_id, tier);
      }
      continue;
    }

    if (ev === "model_tier_gate_denied") {
      const { tier, missingMetadata } = resolveModelTier(row);
      if (missingMetadata) missingTierMetadata += 1;
      const b = ensure(tier);
      b.gate_failures += 1;
      if (typeof row.role === "string") b.roles.add(row.role);
      if (typeof row.agent === "string") b.agents.add(row.agent);
      continue;
    }

    if (ev === "agent_done" && row.edge_type === "retry") {
      const sid = typeof row.step_id === "string" ? row.step_id : null;
      const tier = sid && stepTier.has(sid) ? /** @type {string} */ (stepTier.get(sid)) : "unknown";
      ensure(tier).retries += 1;
    }
  }

  const tiers = [...buckets.values()]
    .map((b) => ({
      model_tier: b.model_tier,
      steps: b.steps,
      cost_usd: roundUsd(b.cost_usd),
      gate_failures: b.gate_failures,
      retries: b.retries,
      roles: [...b.roles].sort(),
      agents: [...b.agents].sort(),
    }))
    .sort((a, b) => tierSortKey(a.model_tier) - tierSortKey(b.model_tier));

  return {
    computed_from: "model_selection|model_tier_gate_denied|agent_done",
    tiers,
    total_steps: tiers.reduce((n, t) => n + t.steps, 0),
    missing_tier_metadata_count: missingTierMetadata,
  };
}

module.exports = {
  summarizeModelCostOutcomeFromRows,
};
