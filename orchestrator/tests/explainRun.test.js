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
