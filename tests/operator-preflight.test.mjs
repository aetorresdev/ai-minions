import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  OPERATOR_REASON_CODES,
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
});
