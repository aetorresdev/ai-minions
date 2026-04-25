"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { parseJsonl, enforceLimits, deriveExplain, resolveLatestRunFile } = require("../explain-run");

// ── helpers ──────────────────────────────────────────────────────────────────

function line(obj) { return JSON.stringify(obj); }

function makeTrace(events) {
  return events.map((e) => line(e)).join("\n");
}

function baseSession(overrides = {}) {
  return {
    run_id: "run-1",
    task_id: "task-1",
    ts_ms: 1000,
    trace_schema_version: "2",
    event: "session_start",
    goal: "do the thing",
    flow_mode: "single_agent",
    ...overrides,
  };
}

// ── parseJsonl ───────────────────────────────────────────────────────────────

describe("parseJsonl", () => {
  it("parses valid lines", () => {
    const text = [line({ a: 1 }), line({ b: 2 })].join("\n");
    const { rows, skipped } = parseJsonl(text);
    assert.equal(rows.length, 2);
    assert.equal(skipped, 0);
  });

  it("skips invalid JSON lines and counts them", () => {
    const text = [line({ a: 1 }), "not json", line({ b: 2 }), "{bad}"].join("\n");
    const { rows, skipped } = parseJsonl(text);
    assert.equal(rows.length, 2);
    assert.equal(skipped, 2);
  });

  it("skips blank lines silently", () => {
    const text = "\n" + line({ a: 1 }) + "\n\n" + line({ b: 2 }) + "\n";
    const { rows, skipped } = parseJsonl(text);
    assert.equal(rows.length, 2);
    assert.equal(skipped, 0);
  });
});

// ── enforceLimits ────────────────────────────────────────────────────────────

describe("enforceLimits", () => {
  it("passes through small input unchanged", () => {
    const text = makeTrace([baseSession(), { event: "session_end", outcome: "done", ts_ms: 2000 }]);
    const { text: out, truncated } = enforceLimits(text);
    assert.equal(truncated, false);
    assert.equal(out, text);
  });

  it("truncates to last session_end when line limit exceeded", () => {
    // Build 10,001 lines where session_end is at line 5
    const lines = [];
    lines.push(line(baseSession({ ts_ms: 1000 })));
    lines.push(line({ event: "session_end", outcome: "done", ts_ms: 2000 }));
    for (let i = 0; i < 9999; i++) lines.push(line({ event: "iteration_done", outcome: "iterate", ts_ms: 3000 + i }));
    const text = lines.join("\n");
    const { truncated, text: out } = enforceLimits(text);
    assert.equal(truncated, true);
    // Output must contain session_end
    assert.ok(out.includes("session_end"));
    // Output must NOT contain all 10001 lines
    assert.ok(out.split("\n").filter((l) => l.trim()).length < 10001);
  });
});

// ── deriveExplain — clean trace ──────────────────────────────────────────────

describe("deriveExplain — clean trace", () => {
  it("extracts goal and flow_mode from first session_start", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      { event: "session_end", outcome: "done", ts_ms: 5000 },
    ];
    const r = deriveExplain(rows);
    assert.equal(r.goal, "do the thing");
    assert.equal(r.flow_mode, "single_agent");
  });

  it("counts retries from iteration_done with outcome=iterate", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      { event: "iteration_done", outcome: "iterate", ts_ms: 2000 },
      { event: "iteration_done", outcome: "iterate", ts_ms: 3000 },
      { event: "iteration_done", outcome: "done",    ts_ms: 4000 },
      { event: "session_end",    outcome: "done",    ts_ms: 5000 },
    ];
    const r = deriveExplain(rows);
    assert.equal(r.retries, 2);
    assert.equal(r.final_status, "done");
  });

  it("sums cost_usd only from lines that have it", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      { event: "iteration_done", outcome: "done", cost_usd: 0.001, ts_ms: 2000 },
      { event: "iteration_done", outcome: "done", cost_usd: 0.002, ts_ms: 3000 },
      { event: "session_end",    outcome: "done", ts_ms: 4000 },
    ];
    const r = deriveExplain(rows);
    assert.ok(typeof r.cost_usd === "number");
    assert.ok(Math.abs(r.cost_usd - 0.003) < 1e-9);
  });

  it("omits cost_usd when no lines have token data", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      { event: "session_end", outcome: "done", ts_ms: 2000 },
    ];
    const r = deriveExplain(rows);
    assert.equal(r.cost_usd, undefined);
    assert.ok(Array.isArray(r.rollup_steps));
    assert.equal(r.rollup_steps.length, 0);
  });
});

// ── deriveExplain: consumption shapes (success, contract_fail rollup, multi-intent) ───

describe("deriveExplain — consumption acceptance shapes", () => {
  it("successful run: done outcome, rollup shows step not failed, optional QA signal", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      {
        event: "context_stats",
        step_id: "step-ok",
        agent: "dev-backend",
        iteration: 0,
        intent_id: "intent-a",
        ollama_prompt_tokens: 100,
        ollama_completion_tokens: 20,
        ts_ms: 1100,
      },
      { event: "agent_done", step_id: "step-ok", intent_id: "intent-a", edge_type: "success", ts_ms: 1200 },
      {
        event: "agent_done",
        step_id: "step-ok",
        agent: "qa",
        qa_triple_template: true,
        qa_blocker_non_vacuous: false,
        ts_ms: 1300,
      },
      { event: "iteration_done", iteration: 0, outcome: "done", ts_ms: 2000 },
      { event: "session_end", outcome: "done", ts_ms: 3000 },
    ];
    const r = deriveExplain(rows);
    assert.equal(r.final_status, "done");
    assert.ok(Array.isArray(r.rollup_steps));
    assert.equal(r.rollup_steps.length, 1);
    assert.equal(r.rollup_steps[0].step_id, "step-ok");
    assert.equal(r.rollup_steps[0].step_failed, false);
    assert.equal(r.rollup_steps[0].qa_triple_template, true);
    assert.equal(r.rollup_steps[0].qa_blocker_non_vacuous, false);
    assert.deepEqual(r.intent_ids, ["intent-a"]);
  });

  it("blocked-style run: contract_fail surfaces as step_failed in rollup", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      {
        event: "context_stats",
        step_id: "step-bad",
        agent: "dev-backend",
        ollama_prompt_tokens: 5,
        ollama_completion_tokens: 0,
        ts_ms: 1100,
      },
      { event: "agent_done", step_id: "step-bad", edge_type: "success", ts_ms: 1150 },
      { event: "contract_fail", step_id: "step-bad", ts_ms: 1200 },
      { event: "iteration_done", iteration: 0, outcome: "done", failure_type: "contract_mismatch", ts_ms: 2000 },
      { event: "session_end", outcome: "done", ts_ms: 3000 },
    ];
    const r = deriveExplain(rows);
    assert.equal(r.final_status, "done");
    assert.equal(r.failure_type, "contract_mismatch");
    assert.equal(r.rollup_steps.length, 1);
    assert.equal(r.rollup_steps[0].step_failed, true);
    assert.equal(r.rollup_steps[0].contract_fail, true);
  });

  it("run with multiple distinct intent_ids (grouping order = first appearance)", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      {
        event: "context_stats",
        step_id: "a",
        intent_id: "third",
        ollama_prompt_tokens: 1,
        ollama_completion_tokens: 0,
        ts_ms: 1100,
      },
      {
        event: "context_stats",
        step_id: "b",
        intent_id: "first",
        ollama_prompt_tokens: 2,
        ollama_completion_tokens: 0,
        ts_ms: 1200,
      },
      {
        event: "context_stats",
        step_id: "c",
        intent_id: "second",
        ollama_prompt_tokens: 3,
        ollama_completion_tokens: 0,
        ts_ms: 1300,
      },
      { event: "session_end", outcome: "done", ts_ms: 2000 },
    ];
    const r = deriveExplain(rows);
    assert.deepEqual(r.intent_ids, ["third", "first", "second"]);
    assert.equal(r.rollup_steps.length, 3);
  });
});

// ── deriveExplain — intent_ids, rollup_steps, failure_axis ───────────────────

describe("deriveExplain — intent, rollup, failure_axis", () => {
  it("collects intent_ids, iteration_done_summary, last_failure_axis, rollup_steps", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      {
        event: "context_stats",
        step_id: "s1",
        intent_id: "i-b",
        ollama_prompt_tokens: 10,
        ollama_completion_tokens: 0,
        ts_ms: 1100,
      },
      {
        event: "context_stats",
        step_id: "s2",
        intent_id: "i-a",
        ollama_prompt_tokens: 5,
        ollama_completion_tokens: 0,
        ts_ms: 1200,
      },
      {
        event: "iteration_done",
        iteration: 0,
        outcome: "iterate",
        failure_axis: "policy",
        intent_ids: ["i-b"],
        ts_ms: 2000,
      },
      {
        event: "iteration_done",
        iteration: 1,
        outcome: "done",
        failure_axis: "none",
        intent_ids: ["i-b", "i-a"],
        ts_ms: 3000,
      },
      { event: "session_end", outcome: "done", ts_ms: 4000 },
    ];
    const r = deriveExplain(rows);
    assert.deepEqual(r.intent_ids, ["i-b", "i-a"]);
    assert.equal(r.last_failure_axis, "none");
    assert.ok(Array.isArray(r.iteration_done_summary));
    assert.equal(r.iteration_done_summary.length, 2);
    assert.equal(r.iteration_done_summary[0].failure_axis, "policy");
    assert.deepEqual(r.iteration_done_summary[0].intent_ids, ["i-b"]);
    assert.ok(Array.isArray(r.rollup_steps));
    assert.equal(r.rollup_steps.length, 2);
    assert.equal(r.rollup_steps[0].step_id, "s1");
    assert.equal(r.rollup_steps[0].ollama_total_tokens, 10);
  });
});

// ── deriveExplain — run_state_snapshot on session_end ────────────────────────

describe("deriveExplain — run_state_snapshot", () => {
  it("takes last session_end snapshot and builds run_snapshot", () => {
    const snap1 = {
      run: { task_id: "t1", iteration: 0, flow_mode: "single_agent", goal: "g1" },
      step: { step_id: "s0", agent_id: "dev", status: "completed", intent: { kind: "x" } },
    };
    const snap2 = {
      run: { task_id: "t1", iteration: 1, flow_mode: "single_agent", goal: "g2" },
      step: null,
    };
    const rows = [
      baseSession({ ts_ms: 1000 }),
      { event: "session_end", outcome: "iterate", ts_ms: 2000, run_state_snapshot: snap1 },
      { event: "session_end", outcome: "done", ts_ms: 3000, run_state_snapshot: snap2 },
    ];
    const r = deriveExplain(rows);
    assert.deepEqual(r.run_state_snapshot, snap2);
    assert.deepEqual(r.run_snapshot, {
      task_id: "t1",
      iteration: 1,
      flow_mode: "single_agent",
      goal: "g2",
      step: null,
    });
  });

  it("fills goal / flow_mode from snapshot when session_start absent", () => {
    const snap = {
      run: { task_id: "orphan", iteration: 0, flow_mode: "multi_agent", goal: "from snap" },
      step: null,
    };
    const rows = [
      { event: "session_end", outcome: "done", ts_ms: 1000, run_state_snapshot: snap },
    ];
    const r = deriveExplain(rows);
    assert.equal(r.goal, "from snap");
    assert.equal(r.flow_mode, "multi_agent");
  });
});

// ── deriveExplain — no session_start ────────────────────────────────────────

describe("deriveExplain — no session_start", () => {
  it("omits goal and flow_mode", () => {
    const rows = [
      { event: "iteration_done", outcome: "done", ts_ms: 2000 },
      { event: "session_end",    outcome: "done", ts_ms: 3000 },
    ];
    const r = deriveExplain(rows);
    assert.equal(r.goal,      undefined);
    assert.equal(r.flow_mode, undefined);
    assert.equal(r.final_status, "done");
  });
});

// ── deriveExplain — no failure_type ─────────────────────────────────────────

describe("deriveExplain — failure_type handling", () => {
  it("uses UNKNOWN when run failed but failure_type absent from trace", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      { event: "session_end", outcome: "failed", ts_ms: 3000 },
    ];
    const r = deriveExplain(rows);
    assert.equal(r.failure_type, "UNKNOWN");
  });

  it("uses failure_type from trace field when present", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      { event: "iteration_done", outcome: "failed", failure_type: "tool_error", ts_ms: 2000 },
      { event: "session_end",    outcome: "failed", ts_ms: 3000 },
    ];
    const r = deriveExplain(rows);
    assert.equal(r.failure_type, "tool_error");
  });

  it("does NOT set failure_type when run succeeded and field absent", () => {
    const rows = [
      baseSession({ ts_ms: 1000 }),
      { event: "session_end", outcome: "done", ts_ms: 2000 },
    ];
    const r = deriveExplain(rows);
    assert.equal(r.failure_type, undefined);
  });
});

// ── deriveExplain — out-of-order timestamps ──────────────────────────────────

describe("deriveExplain — ts_ms ordering", () => {
  it("derives final_status correctly when rows are disordered", () => {
    // session_end appears first in array but has highest ts_ms
    const rows = [
      { event: "session_end",    outcome: "done",    ts_ms: 9000 },
      { event: "iteration_done", outcome: "iterate", ts_ms: 2000 },
      baseSession({ ts_ms: 1000 }),
    ];
    // Caller is responsible for sorting before deriveExplain — replicate what main() does
    const sorted = rows.slice().sort((a, b) => (a.ts_ms || 0) - (b.ts_ms || 0));
    const r = deriveExplain(sorted);
    assert.equal(r.retries, 1);
    assert.equal(r.final_status, "done");
    assert.equal(r.goal, "do the thing");
  });
});

// ── resolveLatestRunFile ─────────────────────────────────────────────────────

describe("resolveLatestRunFile", () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "explain-run-test-"));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for empty directory", () => {
    const result = resolveLatestRunFile(tmpDir);
    assert.equal(result, null);
  });

  it("returns null for non-existent directory", () => {
    const result = resolveLatestRunFile(path.join(tmpDir, "no-such-dir"));
    assert.equal(result, null);
  });

  it("picks file with highest ts_ms", () => {
    const a = path.join(tmpDir, "run-a.jsonl");
    const b = path.join(tmpDir, "run-b.jsonl");
    fs.writeFileSync(a, line({ ts_ms: 1000, event: "session_start" }));
    fs.writeFileSync(b, line({ ts_ms: 9999, event: "session_start" }));
    const result = resolveLatestRunFile(tmpDir);
    assert.equal(result, b);
  });

  it("breaks ties by highest sequence_id", () => {
    const c = path.join(tmpDir, "run-c.jsonl");
    const d = path.join(tmpDir, "run-d.jsonl");
    fs.writeFileSync(c, line({ ts_ms: 9999, sequence_id: 1, event: "session_start" }));
    fs.writeFileSync(d, line({ ts_ms: 9999, sequence_id: 5, event: "session_start" }));
    const result = resolveLatestRunFile(tmpDir);
    assert.equal(result, d);
  });
});

// ── corrupt trace (best-effort) ───────────────────────────────────────────────

describe("corrupt trace — best-effort", () => {
  it("skips corrupt lines and still derives from valid lines", () => {
    const text = [
      line(baseSession({ ts_ms: 1000 })),
      "CORRUPTED LINE",
      line({ event: "iteration_done", outcome: "iterate", ts_ms: 2000 }),
      "{invalid json",
      line({ event: "session_end", outcome: "done", ts_ms: 3000 }),
    ].join("\n");

    const { rows, skipped } = parseJsonl(text);
    assert.equal(skipped, 2);

    const sorted = rows.slice().sort((a, b) => (a.ts_ms || 0) - (b.ts_ms || 0));
    const r = deriveExplain(sorted);
    assert.equal(r.retries, 1);
    assert.equal(r.final_status, "done");
    assert.equal(r.goal, "do the thing");
  });
});
