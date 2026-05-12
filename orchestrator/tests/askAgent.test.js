/**
 * Integration tests for askAgent() — verifies contract enforcement and fallback behavior.
 *
 * Strategy: monkey-patch child_process.spawnSync before requiring agents.js
 * so runClaude() returns controlled output without invoking the claude CLI.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const cp = require("child_process");

// ── spawnSync stub ────────────────────────────────────────────────────────────
// Must patch before require so runClaude() captures the stub in its closure.

let callCount    = 0;
let calledModels = [];
// Queue of responses: each entry is { output, error } consumed in order.
// If queue is empty, falls back to defaultResponse.
let responseQueue   = [];
let defaultResponse = { output: "", error: null };

function stubSpawnSync(cmd, args, _opts) {
  callCount++;
  const modelIdx = args.indexOf("--model");
  if (modelIdx !== -1) calledModels.push(args[modelIdx + 1]);
  const resp = responseQueue.length ? responseQueue.shift() : defaultResponse;
  if (resp.error) return { error: resp.error, status: 1, stdout: "", stderr: "" };
  return { error: null, status: 0, stdout: resp.output + "\n", stderr: "" };
}

cp.spawnSync = stubSpawnSync;
const { askAgent, getDegradedAgents, clearDegradedAgents, inferModelFallbackReason } = require("../agents");

// ── helpers ───────────────────────────────────────────────────────────────────

function reset(output, error = null) {
  defaultResponse = { output, error };
  responseQueue   = [];
  callCount       = 0;
  calledModels    = [];
}

function queueResponses(...responses) {
  callCount    = 0;
  calledModels = [];
  responseQueue = responses.map(r =>
    typeof r === "string" ? { output: r, error: null } : r
  );
}

const VALID_PLAN = JSON.stringify({ steps: [{ agentId: "dev-backend", task: "implement" }] });
const VALID_DECIDE_DONE = JSON.stringify({ done: true, summary: "all good" });
const VALID_DEV_OUTPUT  = [
  "files_read:",
  "  - src/api.py",
  "files_modified:",
  "  - src/api.py",
  "validation_run: pytest — 5 passed",
].join("\n");
const VALID_QA_OUTPUT   = "- blocker: missing auth\n- improvement: add pagination";

// ── orchestrator / plan ───────────────────────────────────────────────────────

describe("askAgent — orchestrator/plan", () => {
  beforeEach(() => reset(VALID_PLAN));

  it("returns output when plan JSON is valid", async () => {
    const { output } = await askAgent("orchestrator", "plan this", { phase: "plan" });
    assert.ok(output.includes("steps"));
  });

  it("throws [output contract] when plan JSON is invalid", async () => {
    reset("not json at all");
    await assert.rejects(
      () => askAgent("orchestrator", "plan this", { phase: "plan" }),
      /\[output contract\]/
    );
  });

  it("throws when plan steps array is empty", async () => {
    reset(JSON.stringify({ steps: [] }));
    await assert.rejects(
      () => askAgent("orchestrator", "plan this", { phase: "plan" }),
      /\[output contract\]/
    );
  });
});

// ── orchestrator / decide ─────────────────────────────────────────────────────

describe("askAgent — orchestrator/decide", () => {
  it("returns output when decide JSON is valid (done=true)", async () => {
    reset(VALID_DECIDE_DONE);
    const { output } = await askAgent("orchestrator", "decide", { phase: "decide" });
    assert.ok(output.includes("done"));
  });

  it("throws when done=true has no summary", async () => {
    reset(JSON.stringify({ done: true }));
    await assert.rejects(
      () => askAgent("orchestrator", "decide", { phase: "decide" }),
      /\[output contract\]/
    );
  });

  it("throws when done=false has no corrections", async () => {
    reset(JSON.stringify({ done: false }));
    await assert.rejects(
      () => askAgent("orchestrator", "decide", { phase: "decide" }),
      /\[output contract\]/
    );
  });
});

// ── dev-backend ───────────────────────────────────────────────────────────────

describe("askAgent — dev-backend", () => {
  it("returns output when contract is met", async () => {
    reset(VALID_DEV_OUTPUT);
    const { output, context_stats } = await askAgent("dev-backend", "implement X");
    assert.ok(output.length > 0);
    assert.ok(context_stats, "should include context_stats");
    assert.equal(context_stats.files_read_count, 1);
    assert.equal(context_stats.files_modified_count, 1);
  });

  it("throws when file reference is missing", async () => {
    reset("Tests passed: pytest — 5 passed.");
    await assert.rejects(
      () => askAgent("dev-backend", "implement X"),
      /\[output contract\]/
    );
  });

  it("throws when validation run is missing", async () => {
    reset("Modified `/src/api.py` — no tests run.");
    await assert.rejects(
      () => askAgent("dev-backend", "implement X"),
      /\[output contract\]/
    );
  });
});

// ── qa / cerberus ─────────────────────────────────────────────────────────────

describe("askAgent — qa", () => {
  it("returns output when finding is classified", async () => {
    reset(VALID_QA_OUTPUT);
    const { output } = await askAgent("qa", "review this");
    assert.ok(output.length > 0);
  });

  it("throws when no finding is classified", async () => {
    reset("Everything looks good.");
    await assert.rejects(
      () => askAgent("qa", "review this"),
      /\[output contract\]/
    );
  });
});

// ── fallback behavior ─────────────────────────────────────────────────────────

describe("askAgent — fallback", () => {
  it("falls back to secondary model when primary fails, returns valid output", async () => {
    queueResponses(
      { output: "", error: new Error("primary unavailable") },  // primary fails
      { output: VALID_DEV_OUTPUT }                               // fallback succeeds
    );
    const { output } = await askAgent("dev-backend", "implement X");
    assert.ok(output.includes("pytest"));
    assert.equal(callCount, 2, "should have called spawnSync twice (primary + fallback)");
  });

  it("throws immediately when architect primary fails (degraded=false)", async () => {
    reset("", new Error("model unavailable"));
    await assert.rejects(
      () => askAgent("architect", "design this"),
      /policy blocks fallback/
    );
  });

  it("throws immediately when cerberus primary fails (degraded=false)", async () => {
    reset("", new Error("model unavailable"));
    await assert.rejects(
      () => askAgent("cerberus", "review this"),
      /policy blocks fallback/
    );
  });

  it("returns model_fallback_segments in context_stats after fallback", async () => {
    queueResponses(
      { output: "", error: new Error("primary unavailable") },
      { output: VALID_DEV_OUTPUT }
    );
    const { output, context_stats } = await askAgent("dev-backend", "implement X");
    assert.ok(output.includes("pytest"));
    assert.ok(context_stats && Array.isArray(context_stats.model_fallback_segments));
    assert.equal(context_stats.model_fallback_segments.length, 2);
    assert.equal(context_stats.model_fallback_segments[0].status, "fallback_triggered");
    assert.equal(context_stats.model_fallback_segments[0].fallback_reason, "model_error");
    assert.equal(context_stats.model_fallback_segments[1].status, "completed");
    assert.equal(context_stats.model_fallback_segments[1].usage_accounting_status, "unknown_provider_usage");
    assert.ok(typeof context_stats.model_fallback_segments[1].fallback_from === "string");
  });
});

describe("inferModelFallbackReason", () => {
  it("classifies common primary failure messages", () => {
    assert.equal(inferModelFallbackReason(new Error("quota exceeded")), "model_quota_exhausted");
    assert.equal(inferModelFallbackReason(new Error("Context limit hit")), "model_context_limit");
    assert.equal(inferModelFallbackReason(new Error("Rate limit exceeded")), "model_rate_limited");
    assert.equal(inferModelFallbackReason(new Error("timeout waiting")), "model_timeout");
    assert.equal(inferModelFallbackReason(new Error("something else")), "model_error");
  });
});

// ── unknown agent ─────────────────────────────────────────────────────────────

describe("askAgent — unknown agent", () => {
  it("throws for unknown agentId", async () => {
    await assert.rejects(
      () => askAgent("made-up-agent", "do something"),
      /Unknown agent/
    );
  });
});

// ── degraded-agent tracking ───────────────────────────────────────────────────

describe("getDegradedAgents / clearDegradedAgents", () => {
  beforeEach(() => {
    callCount = 0;
    calledModels = [];
    responseQueue = [];
    clearDegradedAgents();
  });

  it("is empty after clearDegradedAgents", () => {
    assert.equal(getDegradedAgents().size, 0);
  });

  it("records agent id when fallback is used", async () => {
    queueResponses(
      { output: "", error: new Error("primary unavailable") },
      { output: VALID_DEV_OUTPUT }
    );
    await askAgent("dev-backend", "implement X");
    assert.ok(getDegradedAgents().has("dev-backend"));
  });

  it("does not record agent when primary succeeds", async () => {
    queueResponses({ output: VALID_DEV_OUTPUT });
    await askAgent("dev-backend", "implement X");
    assert.equal(getDegradedAgents().has("dev-backend"), false);
  });

  it("clearDegradedAgents empties the set", async () => {
    queueResponses(
      { output: "", error: new Error("fail") },
      { output: VALID_DEV_OUTPUT }
    );
    await askAgent("dev-backend", "implement X");
    assert.ok(getDegradedAgents().size > 0);
    clearDegradedAgents();
    assert.equal(getDegradedAgents().size, 0);
  });

  it("getDegradedAgents returns a copy — external mutations do not affect internal state", async () => {
    queueResponses(
      { output: "", error: new Error("fail") },
      { output: VALID_DEV_OUTPUT }
    );
    await askAgent("dev-backend", "implement X");
    const copy = getDegradedAgents();
    copy.clear();
    assert.ok(getDegradedAgents().size > 0);
  });
});
