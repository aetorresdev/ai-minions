import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  OPERATOR_REASON_CODES,
  buildRuntimePreflightChecks,
  classifyRunnerBlocker,
  formatReportText,
  parseRunnerPreflightOutput,
  runOperatorPreflight,
} from "../scripts/operator-preflight.mjs";

describe("operator-preflight", () => {
  it("classifyRunnerBlocker maps known runner messages", () => {
    assert.equal(
      classifyRunnerBlocker("unknown model policy: bogus"),
      OPERATOR_REASON_CODES.MODEL_POLICY_UNKNOWN,
    );
    assert.equal(
      classifyRunnerBlocker("ollama backend unreachable"),
      OPERATOR_REASON_CODES.OLLAMA_UNREACHABLE,
    );
    assert.equal(
      classifyRunnerBlocker("missing local backend: ollama"),
      OPERATOR_REASON_CODES.LOCAL_BACKEND_MISSING,
    );
    assert.equal(classifyRunnerBlocker("something else"), OPERATOR_REASON_CODES.RUNNER_PREFLIGHT_BLOCKED);
  });

  it("parseRunnerPreflightOutput reads ok and blockers", () => {
    const sample = `Runner preflight
  model_policy:      local_only
  ok:                false
  blockers:
    - ollama backend unreachable
`;
    const parsed = parseRunnerPreflightOutput(sample);
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.blockers, ["ollama backend unreachable"]);
  });

  it("stops at bootstrap layer and preserves PREFLIGHT_*", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "operator-preflight-"));
    const report = await runOperatorPreflight({
      repoRoot: tmp,
      bootstrapOnly: true,
      skipRuntimePreflight: true,
      invokeRunner: () => {
        throw new Error("runner should not run");
      },
    });
    assert.equal(report.ok, false);
    assert.equal(report.layer_stopped, "bootstrap");
    const layout = report.checks.find((c) => c.id === "bootstrap_repo_layout");
    assert.equal(layout?.reason_code, "PREFLIGHT_REPO_LAYOUT");
    assert.equal(layout?.operator_reason_code, OPERATOR_REASON_CODES.BOOTSTRAP_BLOCKED);
    const text = formatReportText(report);
    assert.match(text, /PREFLIGHT_REPO_LAYOUT/);
    assert.match(text, /OPERATOR_BOOTSTRAP_BLOCKED/);
  });

  it("maps runner blockers to OPERATOR_* when bootstrap passes", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "operator-preflight-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });

    const report = await runOperatorPreflight({
      repoRoot: tmp,
      skipRuntimePreflight: true,
      invokeRunner: () => ({
        exitCode: 2,
        stdout: `Runner preflight
  ok: false
  blockers:
    - ollama backend unreachable
`,
        stderr: "",
      }),
    });

    assert.equal(report.ok, false);
    assert.equal(report.layer_stopped, "runner");
    const runner = report.checks.find((c) => c.operator_reason_code === OPERATOR_REASON_CODES.OLLAMA_UNREACHABLE);
    assert.ok(runner);
    assert.equal(runner?.layer, "runner");
  });

  it("passes when bootstrap and runner layers succeed", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "operator-preflight-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });

    const report = await runOperatorPreflight({
      repoRoot: tmp,
      skipRuntimePreflight: true,
      invokeRunner: () => ({
        exitCode: 0,
        stdout: `Runner preflight
  ok: true
`,
        stderr: "",
      }),
    });

    assert.equal(report.ok, true);
    assert.equal(report.layer_stopped, null);
    assert.ok(report.checks.some((c) => c.operator_reason_code === OPERATOR_REASON_CODES.OK));
  });

  it("stops at runtime layer when install config blocked", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "operator-preflight-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });

    const report = await runOperatorPreflight({
      repoRoot: tmp,
      modelPolicy: "local_only",
      invokeRunner: () => {
        throw new Error("runner should not run when runtime blocked");
      },
      runRuntimePreflight: () => ({
        runtime_preflight: {
          overall_status: "blocked",
          model_policy: "local_only",
          components: [
            {
              component_id: "config:model-policy-yaml",
              component_type: "config",
              status: "blocked",
              reason_code: "RUNTIME_PREFLIGHT_BLOCKED",
              message: "missing config",
            },
          ],
        },
      }),
    });

    assert.equal(report.ok, false);
    assert.equal(report.layer_stopped, "runtime");
    assert.equal(report.runtime_preflight?.overall_status, "blocked");
    const checks = buildRuntimePreflightChecks({
      runtime_preflight: report.runtime_preflight,
    });
    assert.ok(checks.some((c) => c.status === "fail"));
  });

  it("includes runtime_preflight ok in chain when mocked healthy", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "operator-preflight-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });

    const report = await runOperatorPreflight({
      repoRoot: tmp,
      runRuntimePreflight: () => ({
        runtime_preflight: {
          overall_status: "ok",
          model_policy: "local_only",
          components: [
            {
              component_id: "mcp:orchestrator-state",
              component_type: "mcp",
              status: "ok",
              reason_code: "RUNTIME_PREFLIGHT_OK",
              message: "ok",
            },
          ],
        },
      }),
      invokeRunner: () => ({
        exitCode: 0,
        stdout: "Runner preflight\n  ok: true\n",
        stderr: "",
      }),
    });

    assert.equal(report.ok, true);
    assert.equal(report.runtime_preflight?.overall_status, "ok");
    const text = formatReportText(report);
    assert.match(text, /runtime_preflight: ok/);
  });
});
