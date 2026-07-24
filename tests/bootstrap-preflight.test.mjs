import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  REASON_CODES,
  formatReportText,
  isTraceDirWritable,
  runBootstrapPreflight,
} from "../scripts/bootstrap-preflight.mjs";

describe("bootstrap-preflight", () => {
  it("fails when orchestrator package.json is missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-preflight-"));
    const report = await runBootstrapPreflight({ repoRoot: tmp });
    assert.equal(report.ok, false);
    const layout = report.checks.find((c) => c.id === "repo_layout");
    assert.equal(layout?.reason_code, REASON_CODES.REPO_LAYOUT);
  });

  it("passes layout and node when orchestrator package exists", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-preflight-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });

    const report = await runBootstrapPreflight({ repoRoot: tmp });
    const layout = report.checks.find((c) => c.id === "repo_layout");
    const node = report.checks.find((c) => c.id === "node_version");
    assert.equal(layout?.status, "pass");
    assert.equal(node?.status, "pass");
    assert.equal(node?.reason_code, REASON_CODES.OK);
  });

  it("maps unsupported Node major to NODE_VERSION_UNSUPPORTED when below minimum", () => {
    assert.equal(REASON_CODES.NODE_VERSION_UNSUPPORTED, "NODE_VERSION_UNSUPPORTED");
    assert.equal(REASON_CODES.NODE_VERSION, REASON_CODES.NODE_VERSION_UNSUPPORTED);
  });

  it("fails immediately on injected Node 20 and skips install/test", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-preflight-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');

    let npmCiCalled = false;
    let npmTestCalled = false;
    const report = await runBootstrapPreflight({
      repoRoot: tmp,
      install: true,
      runTest: true,
      nodeVersion: "20.0.0",
      runNpmCi: () => {
        npmCiCalled = true;
        return { status: 0 };
      },
      runNpmTest: () => {
        npmTestCalled = true;
        return { status: 0 };
      },
    });

    assert.equal(report.ok, false);
    assert.equal(npmCiCalled, false);
    assert.equal(npmTestCalled, false);
    const node = report.checks.find((c) => c.id === "node_version");
    assert.equal(node?.reason_code, REASON_CODES.NODE_VERSION_UNSUPPORTED);
    assert.match(node?.message || "", /Node\.js >= 22/);
    assert.equal(report.checks.some((c) => c.id === "npm_ci" || c.id === "npm_test"), false);
  });

  it("detects non-writable trace dir", () => {
    const fileAsDir = path.join(os.tmpdir(), `not-a-dir-${process.pid}`);
    fs.writeFileSync(fileAsDir, "x");
    try {
      assert.equal(isTraceDirWritable(fileAsDir), false);
    } finally {
      fs.unlinkSync(fileAsDir);
    }
  });

  it("formatReportText includes ok flag and reason codes", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-preflight-"));
    const report = await runBootstrapPreflight({ repoRoot: tmp });
    const text = formatReportText(report);
    assert.match(text, /bootstrap-preflight/);
    assert.match(text, /PREFLIGHT_REPO_LAYOUT/);
  });
});
