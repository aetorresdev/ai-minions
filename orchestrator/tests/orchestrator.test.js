/**
 * Unit tests for detectBlockers() and validateHandoffStructure().
 * Uses Node.js built-in test runner (node:test). Requires Node >= 18.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  detectBlockers,
  validateHandoffStructure,
  stripLeadingOwnerArchitectForDegradedMultiAgent,
} = require("../orchestrator");

// ── detectBlockers ────────────────────────────────────────────────────────────

describe("detectBlockers", () => {
  it("returns count=0 for output with no blockers", () => {
    const r = detectBlockers("improvement: add pagination\nnice-to-have: JSDoc");
    assert.equal(r.count, 0);
    assert.deepEqual(r.items, []);
  });

  it("detects a simple blocker line", () => {
    const r = detectBlockers("- blocker: missing auth check");
    assert.equal(r.count, 1);
    assert.match(r.items[0], /blocker/);
  });

  it("detects blocker in bold markdown", () => {
    const r = detectBlockers("**blocker** — no input validation");
    assert.equal(r.count, 1);
  });

  it("detects blocker as YAML key", () => {
    const r = detectBlockers("type: blocker\ndescription: broken flow");
    assert.equal(r.count, 1);
  });

  it("detects blocker in brackets", () => {
    const r = detectBlockers("[blocker] SQL injection risk");
    assert.equal(r.count, 1);
  });

  it("detects multiple blockers across lines", () => {
    const r = detectBlockers([
      "- blocker: no rate limiting",
      "- improvement: add caching",
      "- blocker: missing CSRF token",
      "- nice-to-have: improve docs",
    ].join("\n"));
    assert.equal(r.count, 2);
    assert.equal(r.items.length, 2);
  });

  it("is case-insensitive", () => {
    const r = detectBlockers("BLOCKER: critical security gap");
    assert.equal(r.count, 1);
  });

  it("does not match 'blocker' inside another word", () => {
    // 'unblocker' or 'preblocker' should not match due to \b word boundary
    const r = detectBlockers("this is an unblocker step");
    assert.equal(r.count, 0);
  });

  it("trims whitespace from matched items", () => {
    const r = detectBlockers("   - blocker: leading spaces   ");
    assert.equal(r.items[0].startsWith(" "), false);
  });

  it("handles empty string", () => {
    const r = detectBlockers("");
    assert.equal(r.count, 0);
  });
});

// ── validateHandoffStructure ──────────────────────────────────────────────────

describe("validateHandoffStructure / DEV", () => {
  it("passes when files_modified present", () => {
    const r = validateHandoffStructure("DEV", "files_modified:\n  - src/api.py\n");
    assert.equal(r.valid, true);
  });

  it("passes when validation_run present", () => {
    const r = validateHandoffStructure("DEV", "validation_run: pytest — 12 passed\n");
    assert.equal(r.valid, true);
  });

  it("passes when both present", () => {
    const r = validateHandoffStructure("DEV", "files_modified:\n  - src/api.py\nvalidation_run: passed\n");
    assert.equal(r.valid, true);
  });

  it("fails when neither present", () => {
    const r = validateHandoffStructure("DEV", "summary: did stuff\n");
    assert.equal(r.valid, false);
    assert.match(r.reason, /files_modified or validation_run/);
  });

  it("passes on empty YAML in soft mode (compact-handoff may not be registered)", () => {
    const r = validateHandoffStructure("DEV", "");
    assert.equal(r.valid, true);
  });

  it("fails on empty YAML in strict mode", () => {
    const r = validateHandoffStructure("DEV", "", { strict: true });
    assert.equal(r.valid, false);
    assert.match(r.reason, /empty.*strict mode|strict mode.*empty/i);
  });

  it("fails on empty YAML in strict mode for QA", () => {
    const r = validateHandoffStructure("QA", "   \n", { strict: true });
    assert.equal(r.valid, false);
    assert.match(r.reason, /empty/i);
  });

  it("passes DEV strict when files_modified is nested under handoff (compact-handoff shape)", () => {
    const yaml = "handoff:\n  goal: x\n  files_modified:\n    - utils.js\n  validation_run: node -c utils.js\n";
    const r = validateHandoffStructure("DEV", yaml, { strict: true });
    assert.equal(r.valid, true);
  });
});

describe("validateHandoffStructure / QA", () => {
  it("passes with verdict and findings", () => {
    const r = validateHandoffStructure("QA", "verdict: pass\nfindings:\n  - type: improvement\n");
    assert.equal(r.valid, true);
  });

  it("QA_EXEC matches QA rules", () => {
    const r = validateHandoffStructure("QA_EXEC", "verdict: fail\nissues:\n  - broken\n");
    assert.equal(r.valid, true);
  });

  it("passes with verdict and issues", () => {
    const r = validateHandoffStructure("QA", "verdict: fail\nissues:\n  - broken\n");
    assert.equal(r.valid, true);
  });

  it("fails when verdict missing", () => {
    const r = validateHandoffStructure("QA", "findings:\n  - ok\n");
    assert.equal(r.valid, false);
    assert.match(r.reason, /verdict/);
  });

  it("fails when findings and issues both missing", () => {
    const r = validateHandoffStructure("QA", "verdict: pass\n");
    assert.equal(r.valid, false);
    assert.match(r.reason, /findings or issues/);
  });
});

describe("validateHandoffStructure / QA_SPEC", () => {
  it("passes with required keys", () => {
    const yaml = [
      "test_strategy: unit",
      "acceptance_criteria:",
      "  - multiply works",
      "validation_commands:",
      "  - npm test",
    ].join("\n");
    const r = validateHandoffStructure("QA_SPEC", yaml, { strict: true });
    assert.equal(r.valid, true);
  });

  it("fails without acceptance_criteria", () => {
    const r = validateHandoffStructure("QA_SPEC", "test_strategy: x\nvalidation_commands:\n  - t\n", {
      strict: true,
    });
    assert.equal(r.valid, false);
  });
});

describe("validateHandoffStructure / CERBERUS", () => {
  it("passes with verdict and empty blockers", () => {
    const r = validateHandoffStructure("CERBERUS", "verdict: pass\nblockers: []\n");
    assert.equal(r.valid, true);
  });

  it("passes with verdict and no blockers key", () => {
    const r = validateHandoffStructure("CERBERUS", "verdict: pass\nimprovements:\n  - add caching\n");
    assert.equal(r.valid, true);
  });

  it("fails when verdict missing", () => {
    const r = validateHandoffStructure("CERBERUS", "blockers: []\n");
    assert.equal(r.valid, false);
    assert.match(r.reason, /verdict/);
  });

  it("fails when blockers list is non-empty", () => {
    const yaml = "verdict: fail\nblockers:\n  - missing auth\n  - SQL injection\n";
    const r = validateHandoffStructure("CERBERUS", yaml);
    assert.equal(r.valid, false);
    assert.match(r.reason, /open blockers/);
  });
});

describe("validateHandoffStructure / ARCHITECT", () => {
  it("passes with decisions", () => {
    const r = validateHandoffStructure("ARCHITECT", "decisions:\n  - use postgres\n");
    assert.equal(r.valid, true);
  });

  it("passes with nested pending_for_next_mode under handoff", () => {
    const yaml = "handoff:\n  pending_for_next_mode:\n    - implement api\n";
    const r = validateHandoffStructure("ARCHITECT", yaml);
    assert.equal(r.valid, true);
  });

  it("fails without required architect keys", () => {
    const r = validateHandoffStructure("ARCHITECT", "design: approved");
    assert.equal(r.valid, false);
    assert.match(r.reason, /ARCHITECT handoff must include/);
  });
});

describe("validateHandoffStructure / exempt modes", () => {
  it("OWNER always passes", () => {
    const r = validateHandoffStructure("OWNER", "anything goes here");
    assert.equal(r.valid, true);
  });

  it("ORCHESTRATOR always passes", () => {
    const r = validateHandoffStructure("ORCHESTRATOR", "");
    assert.equal(r.valid, true);
  });
});

describe("stripLeadingOwnerArchitectForDegradedMultiAgent", () => {
  it("strips leading owner and architect when a dev-* step remains", () => {
    const steps = [
      { agentId: "owner", task: "spec" },
      { agentId: "architect", task: "design" },
      { agentId: "dev-backend", task: "code" },
      { agentId: "qa", task: "review" },
      { agentId: "cerberus", task: "audit" },
    ];
    const out = stripLeadingOwnerArchitectForDegradedMultiAgent(steps);
    assert.equal(out.length, 3);
    assert.equal(out[0].agentId, "dev-backend");
    assert.equal(out[1].agentId, "qa");
    assert.equal(out[2].agentId, "cerberus");
  });

  it("returns the same array when dev is already first", () => {
    const steps = [{ agentId: "dev-backend", task: "x" }, { agentId: "qa", task: "y" }];
    const out = stripLeadingOwnerArchitectForDegradedMultiAgent(steps);
    assert.deepEqual(out, steps);
  });

  it("does not strip when no dev-* step would remain", () => {
    const steps = [{ agentId: "owner", task: "x" }, { agentId: "qa", task: "y" }];
    const out = stripLeadingOwnerArchitectForDegradedMultiAgent(steps);
    assert.deepEqual(out, steps);
  });
});
