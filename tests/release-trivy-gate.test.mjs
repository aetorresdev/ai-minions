import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "release-trivy-gate.sh");

/** @param {Record<string,string|undefined>} extraEnv */
function runGate(extraEnv = {}) {
  const env = {
    ...process.env,
    // Deterministic missing scanner without mutating PATH (keeps `uv` etc. resolvable).
    TRIVY_BIN: "/nonexistent/trivy-release-trivy-gate-test",
    ...extraEnv,
  };
  // Allow tests to clear the skip reason explicitly.
  if (Object.prototype.hasOwnProperty.call(extraEnv, "RELEASE_TRIVY_GATE_SKIP_REASON")
      && extraEnv.RELEASE_TRIVY_GATE_SKIP_REASON === undefined) {
    delete env.RELEASE_TRIVY_GATE_SKIP_REASON;
  }
  return spawnSync("bash", [GATE_SCRIPT], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env,
  });
}

/**
 * Write a tiny fake "trivy" that prints a version line and exits with the given scan rc.
 * @param {{ versionLine?: string, versionRc?: number, scanRc?: number }} opts
 */
function makeFakeTrivy(opts = {}) {
  const {
    versionLine = "Version: 0.0.0-test",
    versionRc = 0,
    scanRc = 0,
  } = opts;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trivy-gate-fake-"));
  const bin = path.join(dir, "trivy");
  // Fake binary: --version prints versionLine; any other invocation exits scanRc.
  // Include "trivy" in the version string only when versionLine contains it (callers control).
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\\n' ${JSON.stringify(versionLine)}
  exit ${versionRc}
fi
exit ${scanRc}
`,
    { mode: 0o755 },
  );
  return { dir, bin };
}

describe("release-trivy-gate.sh", () => {
  it("is BLOCKED (never PASS) when trivy is missing, with non-zero exit", () => {
    const result = runGate({ RELEASE_TRIVY_GATE_SKIP_REASON: "" });

    assert.notEqual(result.status, 0, "missing scanner must exit non-zero");
    assert.match(result.stdout, /^status=BLOCKED$/m);
    assert.doesNotMatch(result.stdout, /^status=PASS$/m);
    assert.match(result.stderr, /BLOCKED/);
    assert.match(result.stderr, /not found on PATH/);
  });

  it("prints remediation pointing to install docs and the CI workflow", () => {
    const result = runGate({ RELEASE_TRIVY_GATE_SKIP_REASON: "" });

    assert.match(result.stderr, /trivy\.dev/i);
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

  it("treats whitespace-only SKIP_REASON as empty (BLOCKED, not SKIPPED)", () => {
    const result = runGate({ RELEASE_TRIVY_GATE_SKIP_REASON: " " });

    assert.equal(result.status, 2);
    assert.match(result.stdout, /^status=BLOCKED$/m);
    assert.doesNotMatch(result.stdout, /^status=SKIPPED$/m);
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

  it("rejects /bin/true as TRIVY_BIN (fake PASS) — BLOCKED", () => {
    const result = runGate({
      TRIVY_BIN: "/bin/true",
      RELEASE_TRIVY_GATE_SKIP_REASON: "",
    });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /^status=BLOCKED$/m);
    assert.match(result.stderr, /not a usable Trivy/);
  });

  it("rejects /bin/false as TRIVY_BIN (fake FAIL) — BLOCKED, never FAIL", () => {
    const result = runGate({
      TRIVY_BIN: "/bin/false",
      RELEASE_TRIVY_GATE_SKIP_REASON: "",
    });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /^status=BLOCKED$/m);
    assert.doesNotMatch(result.stdout, /^status=FAIL$/m);
  });

  it("maps scanner exit 1 from a validated Trivy binary to status=FAIL", () => {
    const fake = makeFakeTrivy({
      versionLine: "Version: 0.0.0-test (trivy)",
      scanRc: 1,
    });
    try {
      const result = runGate({
        TRIVY_BIN: fake.bin,
        RELEASE_TRIVY_GATE_SKIP_REASON: "",
      });
      assert.equal(result.status, 1);
      assert.match(result.stdout, /^status=FAIL$/m);
    } finally {
      fs.rmSync(fake.dir, { recursive: true, force: true });
    }
  });

  it("maps non-1 scanner errors from a validated Trivy binary to status=BLOCKED", () => {
    const fake = makeFakeTrivy({
      versionLine: "Version: 0.0.0-test (trivy)",
      scanRc: 3,
    });
    try {
      const result = runGate({
        TRIVY_BIN: fake.bin,
        RELEASE_TRIVY_GATE_SKIP_REASON: "",
      });
      assert.equal(result.status, 2);
      assert.match(result.stdout, /^status=BLOCKED$/m);
      assert.match(result.stderr, /operational\/scanner error/);
    } finally {
      fs.rmSync(fake.dir, { recursive: true, force: true });
    }
  });

  it("emits status=BLOCKED when uv lock fails (does not exit bare)", () => {
    const fake = makeFakeTrivy({
      versionLine: "Version: 0.0.0-test (trivy)",
      scanRc: 0,
    });
    // Shadow `uv` with a failing stub earlier on PATH; keep real dirs so gate enters uv branch.
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "trivy-gate-uv-"));
    const uvStub = path.join(binDir, "uv");
    fs.writeFileSync(uvStub, "#!/usr/bin/env bash\nexit 42\n", { mode: 0o755 });
    try {
      const result = runGate({
        TRIVY_BIN: fake.bin,
        RELEASE_TRIVY_GATE_SKIP_REASON: "",
        PATH: `${binDir}:${process.env.PATH || ""}`,
      });
      assert.equal(result.status, 2);
      assert.match(result.stdout, /^status=BLOCKED$/m);
      assert.match(result.stderr, /uv lock failed/);
    } finally {
      fs.rmSync(fake.dir, { recursive: true, force: true });
      fs.rmSync(binDir, { recursive: true, force: true });
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
