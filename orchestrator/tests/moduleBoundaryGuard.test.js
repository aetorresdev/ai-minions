"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const {
  runCheck,
  ALLOWLIST_PATH,
  ORCH_ROOT,
} = require("../scripts/check-module-boundaries");
const { classifyModule } = require("../scripts/lib/module-boundary-rules");

describe("module-boundary guard", () => {
  it("passes on current orchestrator tree", () => {
    const { violations, scanned } = runCheck();
    assert.equal(violations.length, 0, violations.map((v) => v.message).join("; "));
    assert.ok(scanned > 50);
  });

  it("allowlist exists and modules/gates has no grandfathered violations", () => {
    assert.ok(fs.existsSync(ALLOWLIST_PATH));
    const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
    const all = [...(raw.matrix || []), ...(raw.hard || [])];
    for (const key of all) {
      assert.ok(!key.startsWith("modules/gates/"), `modules/gates should be clean: ${key}`);
    }
  });

  it("classifies modules/gates paths as gates module", () => {
    assert.equal(classifyModule("modules/gates/governance-gate.js"), "gates");
    assert.equal(classifyModule("modules/gates/merge-governance/index.js"), "gates");
    assert.equal(classifyModule("governance-gate.js"), "gates");
  });

  it("classifies progressive-disclosure as disclosure before generic contracts patterns", () => {
    assert.equal(
      classifyModule("modules/contracts/progressive-disclosure-design.js"),
      "disclosure",
    );
    assert.equal(classifyModule("progressive-disclosure-design.js"), "disclosure");
    assert.equal(classifyModule("modules/contracts/bv-reviewer-design.js"), "contracts");
  });

  it("detects new hard-rule violations under modules/gates", () => {
    const tmpDir = path.join(ORCH_ROOT, "modules", "gates", "__boundary_probe__");
    fs.mkdirSync(tmpDir, { recursive: true });
    const probeFile = path.join(tmpDir, "probe.js");
    fs.writeFileSync(
      probeFile,
      "'use strict';\nconst cp = require('child_process');\nmodule.exports = { cp };\n",
    );
    try {
      const { violations } = runCheck();
      const probeViolations = violations.filter((v) => v.from.includes("__boundary_probe__"));
      assert.equal(probeViolations.length, 1);
      assert.equal(probeViolations[0].rule, "gates-not-shell");
    } finally {
      fs.unlinkSync(probeFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it("detects new matrix violations under modules/gates", () => {
    const tmpDir = path.join(ORCH_ROOT, "modules", "gates", "__boundary_probe_matrix__");
    fs.mkdirSync(tmpDir, { recursive: true });
    const probeFile = path.join(tmpDir, "probe.js");
    fs.writeFileSync(
      probeFile,
      "'use strict';\nconst mcp = require('../../../mcp-client');\nmodule.exports = { mcp };\n",
    );
    try {
      const { violations } = runCheck();
      const probeViolations = violations.filter((v) => v.from.includes("__boundary_probe_matrix__"));
      assert.equal(probeViolations.length, 1);
      assert.equal(probeViolations[0].rule, "matrix");
      assert.equal(probeViolations[0].fromModule, "gates");
      assert.equal(probeViolations[0].toModule, "tools");
    } finally {
      fs.unlinkSync(probeFile);
      fs.rmdirSync(tmpDir);
    }
  });
});
