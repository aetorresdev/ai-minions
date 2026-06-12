"use strict";

/**
 * Trace consumption helper for model tier gate denials (no policy evaluation).
 */

const GATE_ID = "model_tier_gate";

/**
 * @param {Record<string, unknown>[]} rows
 * @returns {{
 *   gate_id: string,
 *   denied_count: number,
 *   allowed_frontier_count: number,
 *   findings: Array<{
 *     reason_code: string,
 *     denial_reason: string,
 *     role: string | null,
 *     agent: string | null,
 *     step_id: string | null,
 *   }>,
 * }}
 */
function summarizeModelTierGateFromRows(rows) {
  /** @type {Array<Record<string, unknown>>} */
  const denials = [];
  let allowedFrontier = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (row.event === "model_tier_gate_denied") {
      denials.push(row);
      continue;
    }
    if (row.event === "model_selection" && row.model_tier === "frontier") {
      allowedFrontier += 1;
    }
  }

  return {
    gate_id: GATE_ID,
    denied_count: denials.length,
    allowed_frontier_count: allowedFrontier,
    findings: denials.map((row) => ({
      reason_code: typeof row.reason_code === "string" ? row.reason_code : "UNKNOWN",
      denial_reason: typeof row.denial_reason === "string" ? row.denial_reason : "",
      role: typeof row.role === "string" ? row.role : null,
      agent: typeof row.agent === "string" ? row.agent : null,
      step_id: typeof row.step_id === "string" ? row.step_id : null,
    })),
  };
}

module.exports = {
  GATE_ID,
  summarizeModelTierGateFromRows,
};
