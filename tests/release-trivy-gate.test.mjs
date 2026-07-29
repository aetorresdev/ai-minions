import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "release-trivy-gate.sh");

/** @param {Record<string,string>} extraEnv */
function runGate(extraEnv = {}) {
  return spawnSync("bash", [GATE_SCRIPT], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // Deterministic missing scanner without mutating PATH (keeps `uv` etc. resolvable).
      TRIVY_BIN: "/nonexistent/trivy-release-trivy-gate-test",
      ...extraEnv,
    },
  });
}

describe("release-trivy-gate.sh", () => {
  it("is BLOCKED (never PASS) when trivy is missing, with non-zero exit", () => {
    delete process.env.RELEASE_TRIVY_GATE_SKIP_REASON;
    const result = runGate({ RELEASE_TRIVY_GATE_SKIP_REASON: "" });

    assert.notEqual(result.status, 0, "missing scanner must exit non-zero");
    assert.match(result.stdout, /^status=BLOCKED$/m);
    assert.doesNotMatch(result.stdout, /^status=PASS$/m);
    assert.match(result.stderr, /BLOCKED/);
    assert.match(result.stderr, /not found on PATH/);
  });

  it("prints remediation pointing to install docs and the CI workflow", () => {
    const result = runGate({ RELEASE_TRIVY_GATE_SKIP_REASON: "" });

    assert.match(result.stderr, /aquasecurity\.github\.io\/trivy/i);
    assert.match(result.stderr, /security-trivy-scan\.yml/);
    assert.match(result.stderr, /aquasecurity\/trivy-action/);
  });

  it("is SKIPPED (not PASS) only with an explicit non-empty skip reason, exit 0", () => {
    const result = runGate({ RELEASE_TRIVY_GATE_SKIP_REASON: "unit-test documented opt-out" });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^status=SKIPPED$/m);
    assert.doesNotMatch(result.stdout, /^status=PASS$/m);
    assert.match(result.stderr, /unit-test documented opt-out/);
  });

  it("never emits status=PASS unless the scanner actually ran", () => {
    for (const env of [
      { RELEASE_TRIVY_GATE_SKIP_REASON: "" },
      { RELEASE_TRIVY_GATE_SKIP_REASON: "any reason" },
    ]) {
      const result = runGate(env);
      assert.doesNotMatch(result.stdout, /^status=PASS$/m);
    }
  });

  it("script documents PASS/BLOCKED/SKIPPED/FAIL status contract in its header", () => {
    const source = fs.readFileSync(GATE_SCRIPT, "utf8");
    assert.match(source, /status=PASS/);
    assert.match(source, /status=BLOCKED/);
    assert.match(source, /status=SKIPPED/);
    assert.match(source, /status=FAIL/);
  });

  it("security-posture.md documents the PASS/BLOCKED/SKIPPED status semantics", () => {
    const doc = fs.readFileSync(
      path.join(REPO_ROOT, "docs", "orchestrator", "security-posture.md"),
      "utf8",
    );
    assert.match(doc, /\bPASS\b/);
    assert.match(doc, /\bBLOCKED\b/);
    assert.match(doc, /\bSKIPPED\b/);
    assert.match(doc, /supplementary/i);
  });
});
