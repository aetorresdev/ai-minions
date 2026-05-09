"use strict";

/**
 * Run-level rollups for permission_check trace lines (session_end + offline rescans).
 * Uses only decision / reason_code / domain / tool — no prompts or secrets.
 *
 * Cardinality: repeated_denials capped at 64 to match trace-v2-line.schema.json maxItems.
 */

/**
 * @param {Array<{ decision?: string, reason_code?: string, domain?: string, tool?: string }>} rows
 * @returns {{
 *   permission_check_total: number,
 *   by_decision: { allow: number, deny: number, requires_approval: number },
 *   reason_codes_top: Array<{ reason_code: string, count: number }>,
 *   repeated_denials: Array<{ fingerprint: string, count: number, tool: string, domain: string, reason_code: string }>
 * }}
 */
function aggregatePermissionCheckRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const by_decision = { allow: 0, deny: 0, requires_approval: 0 };
  /** @type {Record<string, number>} */
  const reason_code_counts = {};
  /** @type {Record<string, number>} */
  const denial_counts = {};

  for (const r of list) {
    const d = r.decision;
    if (d === "allow") by_decision.allow += 1;
    else if (d === "deny") by_decision.deny += 1;
    else if (d === "requires_approval") by_decision.requires_approval += 1;

    const rc = r.reason_code != null ? String(r.reason_code) : "";
    reason_code_counts[rc] = (reason_code_counts[rc] || 0) + 1;

    if (d === "deny") {
      const tool = r.tool != null ? String(r.tool) : "";
      const domain = r.domain != null ? String(r.domain) : "";
      const fp = JSON.stringify([tool, domain, rc]);
      denial_counts[fp] = (denial_counts[fp] || 0) + 1;
    }
  }

  const reason_codes_top = Object.entries(reason_code_counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([reason_code, count]) => ({ reason_code, count }));

  const repeated_denials = Object.entries(denial_counts)
    .filter(([, n]) => n >= 2)
    .map(([fingerprint, count]) => {
      let tool = "";
      let domain = "";
      let reason_code = "";
      try {
        const parsed = JSON.parse(fingerprint);
        if (Array.isArray(parsed) && parsed.length >= 3) {
          tool = String(parsed[0]);
          domain = String(parsed[1]);
          reason_code = String(parsed[2]);
        }
      } catch {
        /* ignore */
      }
      return { fingerprint, count, tool, domain, reason_code };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 64);

  return {
    permission_check_total: list.length,
    by_decision,
    reason_codes_top,
    repeated_denials,
  };
}

/**
 * @param {Array<{ event?: string, decision?: string, reason_code?: string, domain?: string, tool?: string }>} allRows — full trace JSONL rows
 */
function aggregatePermissionChecksFromTraceRows(allRows) {
  const checks = [];
  for (const r of allRows || []) {
    if (r && r.event === "permission_check") {
      checks.push({
        decision: r.decision,
        reason_code: r.reason_code,
        domain: r.domain,
        tool: r.tool,
      });
    }
  }
  return aggregatePermissionCheckRows(checks);
}

module.exports = {
  aggregatePermissionCheckRows,
  aggregatePermissionChecksFromTraceRows,
};
