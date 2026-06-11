"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");
const { deriveRunScope, writeOrchRunContext } = require("../flow-hook-bridge");

describe("deriveRunScope", () => {
  it("extracts epic scope from goal", () => {
    const r = deriveRunScope("Implement bug lane epic: orchestrator trace fixes");
    assert.equal(r.scope_unknown_reason, null);
    assert.match(r.scope, /orchestrator trace fixes/i);
  });

  it("uses goal text when long enough", () => {
    const r = deriveRunScope("Fix session_id and flow_src in hook metrics");
    assert.equal(r.scope, "Fix session_id and flow_src in hook metrics");
    assert.equal(r.scope_unknown_reason, null);
  });

  it("marks unknown when goal is too short", () => {
    const r = deriveRunScope("fix");
    assert.equal(r.scope, "unknown");
    assert.equal(r.scope_unknown_reason, "goal_too_short_for_scope_derivation");
  });
});

describe("writeOrchRunContext", () => {
  it("writes orch-run-context.json and hook state under project .claude", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "orch-bridge-"));
    writeOrchRunContext(root, {
      taskId: "task-bridge-1",
      flowMode: "single_agent",
      goal: "Resolve session id for hook consumers",
    });

    const ctxPath = path.join(root, ".claude", "orch-run-context.json");
    assert.ok(fs.existsSync(ctxPath));
    const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
    assert.equal(ctx.session_id, "task-bridge-1");
    assert.equal(ctx.flow_src, "orchestrator_cli");
    assert.equal(ctx.flow_mode, "single_agent");
    assert.ok(ctx.scope && ctx.scope !== "unknown");

    const hookState = path.join(root, ".claude", "flow-hook-state", "task-task-bridge-1.json");
    assert.ok(fs.existsSync(hookState));
  });
});
