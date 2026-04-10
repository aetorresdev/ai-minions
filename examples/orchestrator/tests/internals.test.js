/**
 * Unit tests for orchestrator internals: _sanitize and _hashGoal (trace redaction).
 *
 * Uses Node.js built-in test runner (node:test). Requires Node >= 18.
 * No Claude auth, no Ollama, no MCPs required.
 *
 * Degraded-agent tracking (getDegradedAgents/clearDegradedAgents) is tested
 * in askAgent.test.js where the spawnSync stub is already configured.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// orchestrator.js requires agents.js which calls spawnSync at module load time
// in some code paths — stub it to prevent errors during require.
const cp = require("child_process");
cp.spawnSync = () => ({ error: null, status: 0, stdout: "\n", stderr: "" });

const { _sanitize, _hashGoal } = require("../orchestrator");
const { validateOutput } = require("../agents");

describe("_hashGoal", () => {
  it("returns a 12-char hex string", () => {
    const h = _hashGoal("my goal");
    assert.match(h, /^[0-9a-f]{12}$/);
  });

  it("is deterministic for the same input", () => {
    assert.equal(_hashGoal("abc"), _hashGoal("abc"));
  });

  it("differs for different inputs", () => {
    assert.notEqual(_hashGoal("goal A"), _hashGoal("goal B"));
  });
});

describe("_sanitize — goal field", () => {
  it("preserves goal up to 80 chars and appends hash when TRACE_REDACT_GOAL is unset", () => {
    const shortGoal = "short goal";
    const out = _sanitize({ event: "session_start", goal: shortGoal });
    assert.ok(out.goal.includes(shortGoal), "should include original text");
    assert.match(out.goal, /\[sha256:[0-9a-f]{12}\]/, "should include hash suffix");
  });

  it("truncates goal longer than 80 chars", () => {
    const longGoal = "a".repeat(120);
    const out = _sanitize({ event: "session_start", goal: longGoal });
    // Should contain the 80-char prefix (no more)
    assert.ok(out.goal.startsWith("a".repeat(80)), "should include 80-char prefix");
    assert.ok(!out.goal.includes("a".repeat(81)), "should not include char 81+");
  });

  it("does not modify event without a goal field", () => {
    const out = _sanitize({ event: "agent_done", agent: "dev-backend" });
    assert.equal(out.agent, "dev-backend");
    assert.equal("goal" in out, false);
  });
});

describe("_sanitize — other fields", () => {
  it("truncates task to 120 chars", () => {
    const out = _sanitize({ task: "x".repeat(200) });
    assert.equal(out.task.length, 120);
  });

  it("truncates reason to 300 chars", () => {
    const out = _sanitize({ reason: "r".repeat(400) });
    assert.equal(out.reason.length, 300);
  });

  it("truncates summary to 300 chars", () => {
    const out = _sanitize({ summary: "s".repeat(400) });
    assert.equal(out.summary.length, 300);
  });

  it("does not mutate the original event object", () => {
    const original = { goal: "some goal", task: "some task" };
    _sanitize(original);
    assert.equal(original.goal, "some goal");
    assert.equal(original.task, "some task");
  });
});

describe("validateOutput — context gating (files_read)", () => {
  const devOutput = (filesRead) =>
    `${filesRead}\nmodified: /src/app.js\nvalidation_run: npm test → pass`;

  it("rejects architect output missing files_read", () => {
    const r = validateOutput("architect", "Design: use module X. Components: A, B.");
    assert.equal(r.valid, false);
    assert.match(r.reason, /files_read/);
  });

  it("accepts architect output with files_read", () => {
    const r = validateOutput("architect", "files_read: [docs/api.yaml]\nDesign: use module X.");
    assert.equal(r.valid, true);
  });

  it("rejects dev-backend output missing files_read", () => {
    const r = validateOutput("dev-backend", "modified: /src/app.js\nvalidation_run: npm test → pass");
    assert.equal(r.valid, false);
    assert.match(r.reason, /files_read/);
  });

  it("accepts dev-backend output with files_read", () => {
    const r = validateOutput("dev-backend", devOutput("files_read: [src/app.js]"));
    assert.equal(r.valid, true);
  });

  it("accepts dev-devops output with files_read block syntax", () => {
    const r = validateOutput("dev-devops", devOutput("files_read:\n  - main.tf\n  - variables.tf"));
    assert.equal(r.valid, true);
  });

  it("rejects dev-frontend output missing files_read even with file and validation", () => {
    const r = validateOutput("dev-frontend", "modified: /src/App.tsx\nvalidation_run: lint → pass");
    assert.equal(r.valid, false);
    assert.match(r.reason, /files_read/);
  });
});

