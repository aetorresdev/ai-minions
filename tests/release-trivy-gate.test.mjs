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
 * Write a tiny fake "trivy" that prints version/help lines and exits with the given scan rc.
 * @param {{ versionLine?: string, versionRc?: number, helpLine?: string, scanRc?: number }} opts
 */
function makeFakeTrivy(opts = {}) {
  const {
    versionLine = "Version: 0.0.0-test",
    versionRc = 0,
    helpLine = "Usage: trivy [global flags] command [flags] target",
    scanRc = 0,
  } = opts;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trivy-gate-fake-"));
  const bin = path.join(dir, "trivy");
  // Fake binary: --version prints versionLine, --help prints helpLine;
  // any other invocation exits scanRc. Callers control both text payloads.
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\\n' ${JSON.stringify(versionLine)}
  exit ${versionRc}
fi
if [[ "\${1:-}" == "--help" ]]; then
  printf '%s\\n' ${JSON.stringify(helpLine)}
  exit 0
fi
exit ${scanRc}
`,
    { mode: 0o755 },
  );
  return { dir, bin };
}

/**
 * Copy the gate script into a throwaway repo layout (scripts/ + .trivy.yaml) so tests
 * can exercise config-dependent paths without mutating the real repository config.
 * @param {{ configContent: string }} opts
 */
function makeTempRepo(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trivy-gate-repo-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(GATE_SCRIPT, path.join(dir, "scripts", "release-trivy-gate.sh"));
  fs.writeFileSync(path.join(dir, ".trivy.yaml"), opts.configContent);
  return dir;
}

/** @param {string} repoDir @param {Record<string,string|undefined>} extraEnv */
function runGateIn(repoDir, extraEnv = {}) {
  return spawnSync("bash", [path.join(repoDir, "scripts", "release-trivy-gate.sh")], {
    encoding: "utf8",
    cwd: repoDir,
    env: {
      ...process.env,
      TRIVY_BIN: "/nonexistent/trivy-release-trivy-gate-test",
      RELEASE_TRIVY_GATE_SKIP_REASON: "",
      ...extraEnv,
    },
  });
}

const CONFIG_WITH_DEV_DEPS = "severity:\n  - HIGH\npkg:\n  include-dev-deps: true\n";
const CONFIG_WITHOUT_DEV_DEPS = "severity:\n  - HIGH\n";

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

  it("rejects a binary with a Version-shaped --version but no trivy in --help — BLOCKED", () => {
    const fake = makeFakeTrivy({
      versionLine: "Version: 9.9.9",
      helpLine: "Usage: totally-not-a-scanner [flags]",
    });
    try {
      const result = runGate({
        TRIVY_BIN: fake.bin,
        RELEASE_TRIVY_GATE_SKIP_REASON: "",
      });
      assert.equal(result.status, 2);
      assert.match(result.stdout, /^status=BLOCKED$/m);
      assert.match(result.stderr, /not a usable Trivy/);
    } finally {
      fs.rmSync(fake.dir, { recursive: true, force: true });
    }
  });

  it("accepts real-Trivy-shaped --version output (no product name in it)", () => {
    // Real `trivy --version` prints "Version: X.Y.Z" + DB metadata, no "trivy" string.
    const fake = makeFakeTrivy({
      versionLine: "Version: 0.69.1",
      scanRc: 0,
    });
    const repo = makeTempRepo({ configContent: CONFIG_WITH_DEV_DEPS });
    try {
      const result = runGateIn(repo, { TRIVY_BIN: fake.bin });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /^status=PASS$/m);
    } finally {
      fs.rmSync(fake.dir, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
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

  it("is BLOCKED (never PASS) when the trivy config drops pkg.include-dev-deps", () => {
    const fake = makeFakeTrivy({ versionLine: "Version: 0.0.0-test (trivy)", scanRc: 0 });
    const repo = makeTempRepo({ configContent: CONFIG_WITHOUT_DEV_DEPS });
    try {
      const result = runGateIn(repo, { TRIVY_BIN: fake.bin });
      assert.equal(result.status, 2);
      assert.match(result.stdout, /^status=BLOCKED$/m);
      assert.doesNotMatch(result.stdout, /^status=PASS$/m);
      assert.match(result.stderr, /include-dev-deps/);
    } finally {
      fs.rmSync(fake.dir, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("is BLOCKED when the trivy config file is missing entirely", () => {
    const fake = makeFakeTrivy({ versionLine: "Version: 0.0.0-test (trivy)", scanRc: 0 });
    const repo = makeTempRepo({ configContent: CONFIG_WITH_DEV_DEPS });
    fs.rmSync(path.join(repo, ".trivy.yaml"));
    try {
      const result = runGateIn(repo, { TRIVY_BIN: fake.bin });
      assert.equal(result.status, 2);
      assert.match(result.stdout, /^status=BLOCKED$/m);
      assert.match(result.stderr, /not found/);
    } finally {
      fs.rmSync(fake.dir, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("emits status=PASS in a repo whose config enables pkg.include-dev-deps", () => {
    const fake = makeFakeTrivy({ versionLine: "Version: 0.0.0-test (trivy)", scanRc: 0 });
    const repo = makeTempRepo({ configContent: CONFIG_WITH_DEV_DEPS });
    try {
      const result = runGateIn(repo, { TRIVY_BIN: fake.bin });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /^status=PASS$/m);
    } finally {
      fs.rmSync(fake.dir, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("repo .trivy.yaml enables pkg.include-dev-deps (dev-deps scan contract)", () => {
    const config = fs.readFileSync(path.join(REPO_ROOT, ".trivy.yaml"), "utf8");
    assert.match(config, /^pkg:\s*$/m);
    assert.match(config, /^\s+include-dev-deps:\s*true\s*$/m);
  });

  it("CI workflow enforces dev-deps scanning and runs this gate contract suite", () => {
    const workflow = fs.readFileSync(
      path.join(REPO_ROOT, ".github", "workflows", "security-trivy-scan.yml"),
      "utf8",
    );
    assert.match(workflow, /include-dev-deps/);
    assert.match(workflow, /release-trivy-gate\.test\.mjs/);
  });
});
