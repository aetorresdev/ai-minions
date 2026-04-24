/**
 * Unit tests for validateOutput() — output contract enforcement.
 * Uses Node.js built-in test runner (node:test). Requires Node >= 18.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { validateOutput, normalizeDevContractText } = require("../agents");
const { qaAgentDoneTraceExtras } = require("../agents/validate-output");

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(agentId, output, opts) {
  const r = validateOutput(agentId, output, opts ?? {});
  assert.equal(r.valid, true, `expected valid but got: ${r.reason}`);
}

function fail(agentId, output, opts, expectReason) {
  const r = validateOutput(agentId, output, opts ?? {});
  assert.equal(r.valid, false, `expected invalid but got valid`);
  if (expectReason) assert.match(r.reason, expectReason);
}

// ── Empty output (all roles) ──────────────────────────────────────────────────

describe("empty output", () => {
  it("rejects empty string", () => fail("orchestrator", ""));
  it("rejects whitespace-only", () => fail("dev-backend", "   \n  "));
  it("rejects null", () => fail("qa", null));
});

// ── orchestrator / plan ───────────────────────────────────────────────────────

describe("orchestrator / plan", () => {
  it("accepts valid plan JSON", () => ok("orchestrator",
    JSON.stringify({ steps: [{ agentId: "dev-backend", task: "implement API" }] })
  ));

  it("accepts plan wrapped in markdown code block", () => ok("orchestrator",
    "```json\n" + JSON.stringify({ steps: [{ agentId: "qa", task: "test" }] }) + "\n```"
  ));

  it("rejects non-JSON", () => fail("orchestrator", "here is the plan", {}, /not valid JSON/));

  it("rejects empty steps array", () => fail("orchestrator",
    JSON.stringify({ steps: [] }), {}, /non-empty array/
  ));

  it("rejects step missing agentId", () => fail("orchestrator",
    JSON.stringify({ steps: [{ task: "do something" }] }), {}, /missing agentId or task/
  ));

  it("rejects step missing task", () => fail("orchestrator",
    JSON.stringify({ steps: [{ agentId: "dev-backend" }] }), {}, /missing agentId or task/
  ));
});

// ── orchestrator / decide ─────────────────────────────────────────────────────

describe("orchestrator / decide", () => {
  it("accepts done=true with summary", () => ok("orchestrator",
    JSON.stringify({ done: true, summary: "all good" }), { phase: "decide" }
  ));

  it("accepts done=false with corrections", () => ok("orchestrator",
    JSON.stringify({ done: false, corrections: [{ agentId: "dev-backend", task: "fix auth" }] }),
    { phase: "decide" }
  ));

  it("rejects missing done field", () => fail("orchestrator",
    JSON.stringify({ summary: "done" }), { phase: "decide" }, /missing 'done' boolean/
  ));

  it("rejects done=true without summary", () => fail("orchestrator",
    JSON.stringify({ done: true }), { phase: "decide" }, /requires 'summary'/
  ));

  it("rejects done=false with empty corrections", () => fail("orchestrator",
    JSON.stringify({ done: false, corrections: [] }), { phase: "decide" }, /non-empty 'corrections/
  ));

  it("rejects done=false without corrections key", () => fail("orchestrator",
    JSON.stringify({ done: false }), { phase: "decide" }, /non-empty 'corrections/
  ));
});

// ── dev-* ─────────────────────────────────────────────────────────────────────

describe("dev-backend", () => {
  it("accepts output with file path and validation run", () => ok("dev-backend",
    "files_read: [src/api/users.py]\nfiles_modified:\n- src/api/users.py\nTests passed: pytest — 12 passed."
  ));

  it("accepts files_modified keyword", () => ok("dev-backend",
    "files_read: [src/main.js]\nfiles_modified:\n- src/main.js\nvalidation_run: npm test — passed"
  ));

  it("accepts terraform validate pattern", () => ok("dev-devops",
    "files_read: [infra/main.tf]\nfiles_modified:\n- infra/main.tf\nterraform validate — Success"
  ));

  it("rejects output with no file reference", () => fail("dev-backend",
    "All tests passed.", {}, /must declare files_read\[\]|must mention at least one file/
  ));

  it("rejects output with file but no validation", () => fail("dev-backend",
    "Modified /src/api.py but did not run tests.", {}, /must declare files_read\[\]|must include at least one validation/
  ));

  it("applies same contract to dev-frontend", () => fail("dev-frontend",
    "Updated some components.", {}, /must declare files_read\[\]|must mention at least one file|must include at least one validation/
  ));

  it("applies same contract to dev-devops", () => fail("dev-devops",
    "Ran terraform plan.", {}, /must declare files_read\[\]|must mention at least one file/
  ));

  it("accepts dev-backend YAML-first Ollama-style handoff (three blocks)", () => ok("dev-backend",
    "files_read:\n  - src/api.ts\nfiles_modified:\n  - src/api.ts\nvalidation_run: npm test → exit 0\n\nAdded null check on request body."
  ));
});

// ── qa / cerberus ─────────────────────────────────────────────────────────────

describe("qa", () => {
  it("accepts output with blocker finding", () => ok("qa",
    "- blocker: missing input validation on POST /users"
  ));

  it("accepts output with improvement finding", () => ok("qa",
    "Finding: improvement — add pagination to GET /items"
  ));

  it("accepts output with nice-to-have finding", () => ok("qa",
    "nice-to-have: add JSDoc to helper functions"
  ));

  it("rejects output with no classified finding", () => fail("qa",
    "Everything looks good, no issues found.", {}, /must classify at least one finding/
  ));
});

describe("cerberus", () => {
  it("accepts output with blocker", () => ok("cerberus",
    "**blocker**: no rate limiting on the endpoint"
  ));

  it("accepts three-line Ollama-style template with (none) fillers + anchored improvement", () => ok("cerberus",
    "blocker: (none)\nimprovement: add logging for errors in src/server.ts\nnice-to-have: (none)\n"
  ));

  it("rejects output with no classification", () => fail("cerberus",
    "The implementation is solid. Nothing to flag.", {}, /must classify at least one finding/
  ));

  it("rejects review-ready fluff without labels", () => fail("cerberus",
    "Review ready.", {}, /must classify at least one finding/
  ));

  it("rejects triple-template boilerplate (semantic floor)", () => fail("cerberus",
    "blocker: none\nimprovement: code could be improved\nnice-to-have: consider optimization\n",
    {},
    /boilerplate filler/
  ));

  it("accepts triple when all lines are vacuous (explicit no-finding template)", () => ok("cerberus",
    "blocker: (none)\nimprovement: none\nnice-to-have: n/a\n"
  ));

  it("rejects vacuous blocker without concrete improvement or nice-to-have", () => fail("cerberus",
    "blocker: (none)\nimprovement: ok\nnice-to-have: fine\n",
    {},
    /reads as boilerplate filler|concrete detail/
  ));

  it("accepts triple with vacuous blocker and substantive improvement", () => ok("cerberus",
    "blocker: (none)\nimprovement: add bounds check on divide() in calculator.js before return\nnice-to-have: (none)\n"
  ));

  it("rejects vacuous blocker when improvement is long but unanchored", () => fail("cerberus",
    "blocker: (none)\nimprovement: consider improving overall code quality and maintainability across the service\nnice-to-have: (none)\n",
    {},
    /explicit anchor|cerberus_anchor_required/i
  ));

  it("accepts vacuous blocker when improvement cites npm test only", () => ok("cerberus",
    "blocker: none\nimprovement: ran npm test and fixed assertion in handler\nnice-to-have: none\n"
  ));
});

// ── architect (files_read contract) ─────────────────────────────────────────

describe("architect", () => {
  it("accepts output with non-empty files_read YAML list first", () => ok("architect",
    "files_read:\n  - src/api.js\nDesign: prefer idempotent handlers and bounded retries."
  ));

  it("accepts inline files_read array form", () => ok("architect",
    "files_read: [docs/design.md]\nTrade-off: sync vs async boundary at the service edge."
  ));

  it("rejects output without files_read", () => fail("architect",
    "Use an event-driven pattern with a queue at the boundary.",
    {},
    /files_read/
  ));

  it("rejects output with empty files_read", () => fail("architect",
    "files_read: []\nAbstract design only.",
    {},
    /files_read|empty|must not be empty/i
  ));

  it("accepts architect with Design summary line after files_read (Ollama-style shape)", () => ok("architect",
    "files_read:\n  - src/service.ts\nDesign summary:\nPrefer bounded queues; idempotent consumers."
  ));
});

describe("normalizeDevContractText", () => {
  it("strips leading ```yaml fence before validateOutput", () => {
    const raw = "```yaml\nfiles_read:\n  - marker.txt\nfiles_modified:\n  - marker.txt\nvalidation_run: grep E2E marker.txt → ok\n```";
    const n = normalizeDevContractText(raw);
    ok("dev-backend", n);
  });

  it("trims short preamble before files_read", () => {
    const raw = "Sure.\n\nfiles_read:\n  - marker.txt\nfiles_modified:\n  - marker.txt\nvalidation_run: wc -l marker.txt\n";
    const n = normalizeDevContractText(raw);
    ok("dev-backend", n);
  });
});

describe("qaAgentDoneTraceExtras", () => {
  it("returns empty object when three-line template is absent", () => {
    assert.deepEqual(qaAgentDoneTraceExtras("Only prose with blocker keyword inline but no template."), {});
  });

  it("marks triple template and substantive blocker", () => {
    const out = qaAgentDoneTraceExtras(
      "blocker: npm test fails in src/x.js\nimprovement: add types\nnice-to-have: (none)",
    );
    assert.deepEqual(out, { qa_triple_template: true, qa_blocker_non_vacuous: true });
  });

  it("marks triple template with vacuous blocker", () => {
    const out = qaAgentDoneTraceExtras(
      "blocker: (none)\nimprovement: use const\nnice-to-have: (none)",
    );
    assert.deepEqual(out, { qa_triple_template: true, qa_blocker_non_vacuous: false });
  });
});

// ── free-form roles ───────────────────────────────────────────────────────────

describe("owner / summarizer", () => {
  it("owner accepts any non-empty output", () => ok("owner", "Scope: deliver feature X by Friday."));
  it("summarizer accepts any non-empty output", () => ok("summarizer", "## Delivered\nAPI endpoint added."));
});
