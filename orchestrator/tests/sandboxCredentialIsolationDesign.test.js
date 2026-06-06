"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const DESIGN_PATH = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "orchestrator",
  "sandbox-credential-isolation-design.md",
);

describe("sandbox-credential-isolation-design", () => {
  it("defines trust boundaries and credential modes", () => {
    const doc = fs.readFileSync(DESIGN_PATH, "utf8");
    assert.match(doc, /Trust boundaries/i);
    assert.match(doc, /configured_reference/i);
    assert.match(doc, /brokered_use/i);
    assert.match(doc, /denied_reveal_export/i);
  });

  it("lists future sandbox and broker trace events", () => {
    const doc = fs.readFileSync(DESIGN_PATH, "utf8");
    for (const event of [
      "sandbox_required",
      "sandbox_entered",
      "sandbox_blocked",
      "credential_broker_used",
      "credential_material_denied",
    ]) {
      assert.match(doc, new RegExp(event));
    }
  });

  it("separates evaluator, broker, and sandbox layers", () => {
    const doc = fs.readFileSync(DESIGN_PATH, "utf8");
    assert.match(doc, /Permission evaluator/i);
    assert.match(doc, /Credential broker/i);
    assert.match(doc, /Sandbox/i);
    assert.match(doc, /do not conflate/i);
  });

  it("states design-only — no shipped sandbox claim", () => {
    const doc = fs.readFileSync(DESIGN_PATH, "utf8");
    assert.match(doc, /Design-only/i);
    assert.match(doc, /Not claimed/i);
    assert.match(doc, /No kernel/i);
  });
});
