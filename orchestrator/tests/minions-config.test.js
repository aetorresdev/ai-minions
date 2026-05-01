"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadMinionsProjectConfig,
  validateMinionsShape,
} = require("../minions-config");

describe("minions.md project contract", () => {
  it("missing file returns null config without error", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minions-absent-"));
    const r = loadMinionsProjectConfig(dir);
    assert.equal(r.error, null);
    assert.equal(r.config, null);
    assert.equal(r.path, null);
  });

  it("valid minimal JSON block parses", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minions-ok-"));
    fs.writeFileSync(
      path.join(dir, "minions.md"),
      `# Title\n\n\`\`\`json\n{"minions_contract_version":"0.1"}\n\`\`\`\n`,
      "utf8",
    );
    const r = loadMinionsProjectConfig(dir);
    assert.equal(r.error, null);
    assert.equal(r.config?.minions_contract_version, "0.1");
  });

  it("invalid JSON yields error", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minions-bad-"));
    fs.writeFileSync(path.join(dir, "minions.md"), "```json\nnot json\n```", "utf8");
    const r = loadMinionsProjectConfig(dir);
    assert.ok(r.error && r.error.includes("parse"));
  });

  it("unknown key yields validation error", () => {
    const v = validateMinionsShape({
      minions_contract_version: "0.1",
      extra: true,
    });
    assert.equal(v.ok, false);
  });

  it("orchestrator.trace_scenario_id accepted", () => {
    const v = validateMinionsShape({
      minions_contract_version: "0.1",
      orchestrator: { trace_scenario_id: "smoke-local" },
    });
    assert.equal(v.ok, true);
  });
});
