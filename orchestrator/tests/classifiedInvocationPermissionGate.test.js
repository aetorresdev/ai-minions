"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  runClassifiedInvocationPermissionGate,
  permissionDomainForClassification,
} = require("../security/classified-invocation-permission-gate");
const { spawnClassifiedSync } = require("../agents/runtime/run-classified-shell.js");
const { loadToolActionManifest, resetToolActionManifestCache } = require("../security/load-tool-action-manifest");
const cp = require("child_process");

describe("classified-invocation permission gate", () => {
  beforeEach(() => {
    resetToolActionManifestCache();
    loadToolActionManifest();
  });

  it("maps git tool to git domain; terraform to filesystem", () => {
    assert.equal(permissionDomainForClassification({ tool_id: "git" }), "git");
    assert.equal(permissionDomainForClassification({ tool_id: "terraform" }), "filesystem");
    assert.equal(permissionDomainForClassification({ tool_id: null }), "filesystem");
  });

  it("dev-local allows terraform plan (simulate) via filesystem domain", () => {
    const gate = runClassifiedInvocationPermissionGate({
      repoRoot: process.cwd(),
      permissionProfileName: "dev-local",
      executable: "terraform",
      args: ["plan"],
      role: "DEV",
    });
    assert.equal(gate.input.domain, "filesystem");
    assert.equal(gate.input.action_class, "simulate");
    assert.equal(gate.output.decision, "allow");
    assert.equal(gate.output.reason_code, "read_or_simulate_allowed");
    assert.equal(gate.input.tool, "terraform");
  });

  it("ci-safe denies terraform apply (external_side_effect)", () => {
    const gate = runClassifiedInvocationPermissionGate({
      repoRoot: process.cwd(),
      permissionProfileName: "ci-safe",
      executable: "terraform",
      args: ["apply", "-auto-approve"],
      role: "DEV",
    });
    assert.equal(gate.output.decision, "deny");
    assert.equal(gate.output.reason_code, "unknown_external_target_denied");
  });

  it("ci-safe allows git diff (read) under read_only git domain", () => {
    const gate = runClassifiedInvocationPermissionGate({
      repoRoot: process.cwd(),
      permissionProfileName: "ci-safe",
      executable: "git",
      args: ["diff"],
      role: "DEV",
    });
    assert.equal(gate.input.domain, "git");
    assert.equal(gate.input.action_class, "read");
    assert.equal(gate.output.decision, "allow");
  });

  it("ci-safe denies git push (external_side_effect)", () => {
    const gate = runClassifiedInvocationPermissionGate({
      repoRoot: process.cwd(),
      permissionProfileName: "ci-safe",
      executable: "git",
      args: ["push"],
      role: "DEV",
    });
    assert.equal(gate.input.domain, "git");
    assert.equal(gate.output.decision, "deny");
  });

  it("unknown executable denies with unknown_action_class_denied", () => {
    const gate = runClassifiedInvocationPermissionGate({
      repoRoot: process.cwd(),
      permissionProfileName: "dev-local",
      executable: "/nonexistent/obscure-bin-xyz",
      args: ["x"],
      role: "DEV",
    });
    assert.equal(gate.input.action_class, "unknown");
    assert.equal(gate.output.decision, "deny");
    assert.equal(gate.output.reason_code, "unknown_action_class_denied");
  });
});

describe("spawnClassifiedSync", () => {
  let origSpawn;

  beforeEach(() => {
    resetToolActionManifestCache();
    loadToolActionManifest();
    origSpawn = cp.spawnSync;
  });

  it("runs spawn after allow; records stub result", () => {
    let seenExe;
    let seenArgs;
    cp.spawnSync = (exe, args, _opts) => {
      seenExe = exe;
      seenArgs = args;
      return { error: null, status: 0, stdout: "ok", stderr: "" };
    };
    try {
      const r = spawnClassifiedSync("terraform", ["plan"], {
        cwd: process.cwd(),
        permissionProfileName: "dev-local",
        traceRole: "DEV",
      });
      assert.equal(r.status, 0);
      assert.equal(seenExe, "terraform");
      assert.deepEqual(seenArgs, ["plan"]);
    } finally {
      cp.spawnSync = origSpawn;
    }
  });

  it("throws CLASSIFIED_SHELL_DENIED when policy denies", () => {
    cp.spawnSync = () => assert.fail("spawn must not run");
    try {
      assert.throws(
        () =>
          spawnClassifiedSync("terraform", ["apply", "-auto-approve"], {
            cwd: process.cwd(),
            permissionProfileName: "ci-safe",
          }),
        (err) => err.code === "CLASSIFIED_SHELL_DENIED"
      );
    } finally {
      cp.spawnSync = origSpawn;
    }
  });
});
