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

  it("classifies recovery paths as recovery module (not trace)", () => {
    assert.equal(classifyModule("modules/recovery/recovery-sweep.js"), "recovery");
    assert.equal(classifyModule("modules/recovery/session-resume.js"), "recovery");
    assert.equal(classifyModule("recovery-sweep.js"), "recovery");
    assert.equal(classifyModule("session-resume.js"), "recovery");
  });

  it("classifies worktree paths as worktree module (canonical and root shims)", () => {
    assert.equal(classifyModule("modules/worktree/worktree-isolation.js"), "worktree");
    assert.equal(classifyModule("modules/worktree/trace-workspace-lifecycle.js"), "worktree");
    assert.equal(classifyModule("modules/worktree/run-workdir-contract.js"), "worktree");
    assert.equal(classifyModule("worktree-isolation.js"), "worktree");
    assert.equal(classifyModule("trace-workspace-lifecycle.js"), "worktree");
    assert.equal(classifyModule("run-workdir-contract.js"), "worktree");
    assert.equal(classifyModule("worktree-result-promotion.js"), "worktree");
  });

  it("classifies budget paths as budget module (canonical and root shims)", () => {
    assert.equal(classifyModule("modules/budget/token-trace-report.js"), "budget");
    assert.equal(classifyModule("modules/budget/token-usage-summary.js"), "budget");
    assert.equal(classifyModule("modules/budget/cost-accounting-dimensions.js"), "budget");
    assert.equal(classifyModule("token-trace-report.js"), "budget");
    assert.equal(classifyModule("token-usage-summary.js"), "budget");
    assert.equal(classifyModule("cost-accounting-dimensions.js"), "budget");
  });

  it("classifies operator paths as operator module (canonical and root shims)", () => {
    assert.equal(classifyModule("modules/operator/console-dashboard.js"), "operator");
    assert.equal(classifyModule("modules/operator/runner-tui-cli.js"), "operator");
    assert.equal(classifyModule("modules/operator/runner-budget-view.js"), "operator");
    assert.equal(classifyModule("console-dashboard.js"), "operator");
    assert.equal(classifyModule("runner-tui-cli.js"), "operator");
    assert.equal(classifyModule("runner-budget-view.js"), "operator");
    assert.equal(classifyModule("explain-run.js"), "operator");
    assert.equal(classifyModule("operator-cli-help.js"), "operator");
    assert.equal(classifyModule("runner-model-routing.js"), "model-runtime");
  });

  it("allowlist has no grandfathered violations under modules/recovery", () => {
    const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
    const all = [...(raw.matrix || []), ...(raw.hard || [])];
    for (const key of all) {
      assert.ok(!key.startsWith("modules/recovery/"), `modules/recovery should be clean: ${key}`);
    }
  });

  it("classifies security helper paths under permissions or tools", () => {
    assert.equal(classifyModule("security/load-project-policy.js"), "permissions");
    assert.equal(classifyModule("security/trace-security-decision.js"), "permissions");
    assert.equal(classifyModule("security/action-classifiers/classify-action.js"), "permissions");
    assert.equal(classifyModule("security/load-tool-action-manifest.js"), "tools");
    assert.equal(classifyModule("security/sensitive-data-scanner.js"), "permissions");
    assert.equal(classifyModule("portable-project-template.js"), "shared");
    assert.equal(classifyModule("context-utils.js"), "run-control");
  });

  it("allowlist shrunk for v0.16 boundary hardening (matrix ≤ 8)", () => {
    const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
    const matrixCount = (raw.matrix || []).length;
    const total = matrixCount + (raw.hard || []).length;
    assert.ok(matrixCount <= 8, `expected <= 8 matrix allowlist entries, got ${matrixCount}`);
    assert.ok(total <= 9, `expected <= 9 total allowlist entries, got ${total}`);
    assert.ok(total < 15, "allowlist should be smaller than v0.10 baseline (15)");
  });

  it("formalized operator ↔ model-runtime adjacency removes runner grandfather keys", () => {
    const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
    const matrix = raw.matrix || [];
    for (const prefix of [
      "modules/operator/runner-launcher.js",
      "modules/operator/runner-preflight.js",
      "modules/operator/runner-tui-cli.js",
      "modules/model-runtime/runner-model-routing.js",
    ]) {
      assert.ok(
        !matrix.some((k) => k.startsWith(prefix)),
        `expected no grandfather for ${prefix}`,
      );
    }
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
