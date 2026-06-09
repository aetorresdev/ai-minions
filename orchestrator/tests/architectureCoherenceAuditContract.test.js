"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const DOCS_DIR = path.join(__dirname, "..", "..", "docs", "orchestrator");

const AUDIT_DOCS = [
  "architecture-coherence-audit.md",
  "module-ownership-map.md",
  "root-file-inventory.md",
];

const ALLOWED_MATRIX_STATES = [
  "implemented",
  "partial",
  "design-only",
  "planned",
  "not claimed",
];

describe("architecture-coherence-audit-contract", () => {
  for (const name of AUDIT_DOCS) {
    it(`ships ${name}`, () => {
      const docPath = path.join(DOCS_DIR, name);
      assert.ok(fs.existsSync(docPath), `missing ${name}`);
    });
  }

  it("coherence audit uses only allowed matrix states and movement plan", () => {
    const doc = fs.readFileSync(path.join(DOCS_DIR, "architecture-coherence-audit.md"), "utf8");
    assert.match(doc, /physical refactor movement plan|Recommended physical refactor movement plan/i);
    assert.match(doc, /modules\/recovery/i);
    assert.doesNotMatch(doc, /modular monolith refactor complete/i);
    assert.match(doc, /Not.*claim/i);
    for (const state of ALLOWED_MATRIX_STATES) {
      assert.match(doc, new RegExp(`\\*\\*${state}\\*\\*|${state}`));
    }
  });

  it("root inventory classifies orchestrator.js and recovery files", () => {
    const doc = fs.readFileSync(path.join(DOCS_DIR, "root-file-inventory.md"), "utf8");
    assert.match(doc, /orchestrator\.js/);
    assert.match(doc, /recovery-sweep\.js/);
    assert.match(doc, /session-resume\.js/);
    assert.match(doc, /Stay at root|ALLOWED/i);
  });

  it("ownership map declares recovery and gates physical module", () => {
    const doc = fs.readFileSync(path.join(DOCS_DIR, "module-ownership-map.md"), "utf8");
    assert.match(doc, /modules\/gates/i);
    assert.match(doc, /recovery/i);
    assert.match(doc, /Must not own/i);
  });

  it("audit docs omit backlog ticket ids (DOC-NO-TICKET-SRC-1)", () => {
    const ticketId = /\b[A-Z][0-9]+-[0-9]+\b/;
    for (const name of AUDIT_DOCS) {
      const doc = fs.readFileSync(path.join(DOCS_DIR, name), "utf8");
      assert.doesNotMatch(doc, ticketId, `${name} must not embed backlog ticket ids`);
    }
  });
});
