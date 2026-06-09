"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const ORCH = path.join(__dirname, "..");

describe("module refactor slice 3 (recovery)", () => {
  it("physical modules/recovery tree exists", () => {
    for (const rel of [
      "modules/recovery/index.js",
      "modules/recovery/recovery-sweep.js",
      "modules/recovery/session-resume.js",
    ]) {
      assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
    }
  });

  it("root shims re-export the same recovery APIs", () => {
    const shimSweep = require("../recovery-sweep");
    const canonSweep = require("../modules/recovery/recovery-sweep");
    assert.equal(shimSweep.RECOVERY_SCHEMA_VERSION, canonSweep.RECOVERY_SCHEMA_VERSION);
    assert.equal(typeof shimSweep.summarizeRecoveryFromRows, "function");

    const shimResume = require("../session-resume");
    const canonResume = require("../modules/recovery/session-resume");
    assert.equal(shimResume.SESSION_RESUME_SCHEMA_VERSION, canonResume.SESSION_RESUME_SCHEMA_VERSION);
    assert.equal(typeof shimResume.summarizeSessionResumeFromRows, "function");
  });

  it("modules/recovery index aggregates exports", () => {
    const recovery = require("../modules/recovery");
    assert.equal(typeof recovery.summarizeRecoveryFromRows, "function");
    assert.equal(typeof recovery.summarizeSessionResumeFromRows, "function");
  });
});
