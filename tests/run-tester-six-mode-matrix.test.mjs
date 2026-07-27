import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ANY_PROVIDER_ENV_VARS,
  MATRIX_DOC_REQUIRED_MARKERS,
  REASON_CODES,
  SIX_MODE_ROWS,
  assessCredentialPresence,
  assessMatrixRow,
  credentialRequirementByPolicy,
  validateMatrixDoc,
} from "../scripts/lib/tester-six-mode-matrix-data.mjs";
import {
  UNSUPPORTED_TIME_LIMIT_MSG,
  formatReportText,
  liveOutcomeToStepStatus,
  deriveLiveHarnessAggregate,
  parseArgs,
  rowStatusToStepStatus,
  runTesterSixModeMatrix,
  runTesterSixModeMatrixLive,
} from "../scripts/run-tester-six-mode-matrix.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_DOC = path.join(REPO_ROOT, "docs/how-to/tester-six-mode-matrix.md");

describe("tester-six-mode-matrix-data", () => {
  it("defines exactly six rows covering the matrix", () => {
    assert.equal(SIX_MODE_ROWS.length, 6);
    const ids = SIX_MODE_ROWS.map((r) => r.id).sort();
    assert.deepEqual(ids, [
      "ma-hybrid",
      "ma-local_only",
      "ma-remote_ok",
      "sa-hybrid",
      "sa-local_only",
      "sa-remote_ok",
    ]);
  });

  it("remote_ok rows declare any_provider OR via supported_provider_env_vars", () => {
    for (const row of SIX_MODE_ROWS.filter((r) => r.inference_mode === "remote_ok")) {
      assert.equal(row.credential_requirement, "any_provider");
      assert.deepEqual(row.supported_provider_env_vars, [...ANY_PROVIDER_ENV_VARS]);
      assert.equal("required_env_vars" in row, false);
    }
  });

  it("local_only rows declare credential_requirement not_required", () => {
    for (const row of SIX_MODE_ROWS.filter((r) => r.inference_mode === "local_only")) {
      assert.equal(row.credential_requirement, "not_required");
      assert.deepEqual(row.supported_provider_env_vars, []);
    }
  });

  it("credentialRequirementByPolicy is per-policy not a single global claim", () => {
    const policies = credentialRequirementByPolicy();
    assert.equal(policies.local_only, "not_required");
    assert.equal(policies.remote_ok, "any_provider");
    assert.equal(policies.hybrid, "any_provider");
  });

  it("committed runbook passes validateMatrixDoc", () => {
    const text = fs.readFileSync(MATRIX_DOC, "utf8");
    const check = validateMatrixDoc(text);
    assert.equal(check.ok, true, check.errors.join("; "));
    assert.ok(MATRIX_DOC_REQUIRED_MARKERS.length > 10);
  });

  it("hybrid rows always honest-skip", () => {
    for (const row of SIX_MODE_ROWS.filter((r) => r.inference_mode === "hybrid")) {
      const result = assessMatrixRow(row, {
        credentials: assessCredentialPresence({
          ANTHROPIC_API_KEY: "x",
          OPENAI_API_KEY: "y",
        }),
        localBackendReachable: true,
        skipLive: false,
      });
      assert.equal(result.status, "skip");
      assert.equal(result.reason_code, REASON_CODES.SKIP_HYBRID_UNSUPPORTED);
    }
  });

  it("remote_ok skips when no provider token present", () => {
    const row = SIX_MODE_ROWS.find((r) => r.id === "sa-remote_ok");
    const result = assessMatrixRow(row, {
      credentials: assessCredentialPresence({}),
      skipLive: false,
    });
    assert.equal(result.status, "skip");
    assert.equal(result.reason_code, REASON_CODES.SKIP_REMOTE_CREDENTIALS_MISSING);
  });

  it("remote_ok ready when any one provider token present", () => {
    const row = SIX_MODE_ROWS.find((r) => r.id === "sa-remote_ok");
    const result = assessMatrixRow(row, {
      credentials: assessCredentialPresence({ OPENAI_API_KEY: "token-present" }),
      skipLive: false,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.reason_code, REASON_CODES.READY);
    assert.equal(result.credential_requirement, "any_provider");
  });

  it("local_only skips when local backend explicitly unreachable", () => {
    const row = SIX_MODE_ROWS.find((r) => r.id === "sa-local_only");
    const result = assessMatrixRow(row, {
      credentials: assessCredentialPresence({}),
      localBackendReachable: false,
      skipLive: false,
    });
    assert.equal(result.status, "skip");
    assert.equal(result.reason_code, REASON_CODES.SKIP_LOCAL_BACKEND_MISSING);
  });

  it("local_only does not require remote tokens", () => {
    const row = SIX_MODE_ROWS.find((r) => r.id === "sa-local_only");
    const result = assessMatrixRow(row, {
      credentials: assessCredentialPresence({}),
      localBackendReachable: true,
      skipLive: false,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.reason_code, REASON_CODES.READY);
    assert.equal(result.credential_requirement, "not_required");
  });

  it("assessCredentialPresence never returns secret values", () => {
    const c = assessCredentialPresence({
      ANTHROPIC_API_KEY: "sk-ant-secret-should-not-leak",
      OPENAI_API_KEY: "",
    });
    assert.equal(c.anthropic, "present");
    assert.equal(c.openai, "missing");
    assert.equal(c.any_provider, true);
    const serialized = JSON.stringify(c);
    assert.equal(serialized.includes("sk-ant"), false);
  });
});

describe("run-tester-six-mode-matrix", () => {
  it("structure gate passes on committed doc with --skip-live semantics", async () => {
    const report = await runTesterSixModeMatrix({
      repoRoot: REPO_ROOT,
      skipLive: true,
      env: {},
      localBackendReachable: null,
    });
    assert.equal(report.ok, true);
    assert.equal(report.steps[0].id, "matrix_doc");
    assert.equal(report.steps[0].status, "pass");
    const hybrid = report.rows.filter((r) => r.id.includes("hybrid"));
    assert.equal(hybrid.length, 2);
    for (const h of hybrid) {
      assert.equal(h.reason_code, REASON_CODES.SKIP_HYBRID_UNSUPPORTED);
    }
    const text = formatReportText(report);
    assert.match(text, /tester-six-mode-matrix: OK/);
    assert.doesNotMatch(text, /sk-ant|sk-proj|AKIA/);
  });

  it("fails when matrix doc is missing markers", async () => {
    const report = await runTesterSixModeMatrix({
      repoRoot: path.join(REPO_ROOT, "does-not-exist-matrix-root"),
      skipLive: true,
      env: {},
    });
    assert.equal(report.ok, false);
    assert.equal(report.steps[0].reason_code, REASON_CODES.DOC_FAIL);
  });

  it("remote rows skip without credentials under skip-live", async () => {
    const report = await runTesterSixModeMatrix({
      repoRoot: REPO_ROOT,
      skipLive: true,
      env: {},
      localBackendReachable: true,
    });
    const saRemote = report.rows.find((r) => r.id === "sa-remote_ok");
    assert.equal(saRemote.reason_code, REASON_CODES.SKIP_REMOTE_CREDENTIALS_MISSING);
  });

  it("MATRIX_READY is never reported as PASS (eligibility ≠ executed pass)", async () => {
    assert.equal(rowStatusToStepStatus("ready"), "ready");
    assert.notEqual(rowStatusToStepStatus("ready"), "pass");

    const report = await runTesterSixModeMatrix({
      repoRoot: REPO_ROOT,
      skipLive: false,
      env: { OPENAI_API_KEY: "token-present" },
      localBackendReachable: true,
    });
    const readyRows = report.rows.filter((r) => r.reason_code === REASON_CODES.READY);
    assert.ok(readyRows.length >= 1, "expected at least one MATRIX_READY row");
    for (const row of readyRows) {
      assert.equal(row.status, "ready");
    }
    const readySteps = report.steps.filter((s) => s.reason_code === REASON_CODES.READY);
    assert.equal(readySteps.length, readyRows.length);
    for (const step of readySteps) {
      assert.equal(step.status, "ready");
      assert.notEqual(step.status, "pass");
    }
    const text = formatReportText(report);
    assert.match(text, /\[ready\]/);
    assert.doesNotMatch(text, /\[pass\] row:.*MATRIX_READY/);
    assert.equal(
      report.credential_status.credential_sufficiency,
      undefined,
      "must not hardcode global credential_sufficiency",
    );
    assert.equal(
      report.credential_status.credential_requirement_by_policy.local_only,
      "not_required",
    );
    assert.equal(
      report.credential_status.credential_requirement_by_policy.remote_ok,
      "any_provider",
    );
  });

  it("parseArgs keeps default non-live; execute-live is explicit", () => {
    const def = parseArgs([]);
    assert.equal(def.executeLive, false);
    assert.equal(def.skipLive, true);

    const ready = parseArgs(["--run-ready"]);
    assert.equal(ready.executeLive, false);
    assert.equal(ready.skipLive, false);

    const live = parseArgs([
      "--execute-live",
      "--fixture",
      "sudoku-html-app",
      "--rows",
      "sa-local_only,sa-remote_ok",
      "--evidence-dir",
      "/tmp/ev",
    ]);
    assert.equal(live.executeLive, true);
    assert.equal(live.fixtureId, "sudoku-html-app");
    assert.equal(live.rowIds, "sa-local_only,sa-remote_ok");
    assert.equal(live.evidenceDir, "/tmp/ev");
  });

  it("liveOutcomeToStepStatus never maps READY to pass", () => {
    assert.equal(liveOutcomeToStepStatus("PASS"), "pass");
    assert.equal(liveOutcomeToStepStatus("FAIL"), "fail");
    assert.equal(liveOutcomeToStepStatus("BLOCKED"), "blocked");
    assert.equal(liveOutcomeToStepStatus("SKIP"), "skip");
    assert.equal(rowStatusToStepStatus("ready"), "ready");
  });

  it("deriveLiveHarnessAggregate maps SKIP/BLOCKED without claiming PASS", () => {
    assert.equal(deriveLiveHarnessAggregate({
      ok: true,
      rows: [{ outcome: "SKIP", reason_code: "X" }],
    }), "SKIP");
    assert.equal(deriveLiveHarnessAggregate({
      ok: true,
      rows: [{ outcome: "BLOCKED", reason_code: "Y" }],
    }), "BLOCKED");
    assert.equal(deriveLiveHarnessAggregate({
      ok: true,
      aggregate_outcome: "PASS",
      rows: [{ outcome: "PASS" }],
    }), "PASS");
  });

  it("parseArgs rejects --time-limit with USAGE error (not silent ignore)", () => {
    assert.throws(
      () => parseArgs(["--execute-live", "--time-limit", "30", "--rows", "sa-local_only"]),
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, UNSUPPORTED_TIME_LIMIT_MSG);
        assert.equal(err.code, "USAGE");
        return true;
      },
    );
  });

  it("parseArgs does not consume -- tokens as values for value options", () => {
    assert.throws(
      () => parseArgs(["--skip-live", "--max-iterations", "--time-limit"]),
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, UNSUPPORTED_TIME_LIMIT_MSG);
        assert.equal(err.code, "USAGE");
        return true;
      },
    );
    assert.throws(
      () => parseArgs(["--fixture", "--not-a-real-flag"]),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /unknown option: --not-a-real-flag/);
        assert.equal(err.code, "USAGE");
        return true;
      },
    );
    assert.throws(
      () => parseArgs(["--rows"]),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /--rows requires a value/);
        assert.equal(err.code, "USAGE");
        return true;
      },
    );
    const ok = parseArgs([
      "--execute-live",
      "--fixture",
      "sudoku-html-app",
      "--rows",
      "sa-local_only",
      "--evidence-dir",
      "/tmp/ev",
      "--max-iterations",
      "12",
    ]);
    assert.equal(ok.fixtureId, "sudoku-html-app");
    assert.equal(ok.rowIds, "sa-local_only");
    assert.equal(ok.evidenceDir, "/tmp/ev");
    assert.equal(ok.maxIterations, "12");
  });

  it("parseArgs rejects unknown options", () => {
    assert.throws(
      () => parseArgs(["--skip-live", "--not-a-real-flag"]),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /unknown option: --not-a-real-flag/);
        assert.equal(err.code, "USAGE");
        return true;
      },
    );
  });

  it("CLI exits non-zero when --time-limit is passed", () => {
    const script = path.join(REPO_ROOT, "scripts/run-tester-six-mode-matrix.mjs");
    const result = spawnSync(
      process.execPath,
      [script, "--skip-live", "--time-limit", "30"],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    const combined = `${result.stderr || ""}\n${result.stdout || ""}`;
    assert.match(combined, /--time-limit is not supported/);
  });

  it("CLI exits non-zero when --max-iterations is followed by --time-limit", () => {
    const script = path.join(REPO_ROOT, "scripts/run-tester-six-mode-matrix.mjs");
    const result = spawnSync(
      process.execPath,
      [script, "--skip-live", "--max-iterations", "--time-limit"],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    const combined = `${result.stderr || ""}\n${result.stdout || ""}`;
    assert.match(combined, /--time-limit is not supported/);
  });

  it("CLI exits non-zero when unknown option is in value position", () => {
    const script = path.join(REPO_ROOT, "scripts/run-tester-six-mode-matrix.mjs");
    const result = spawnSync(
      process.execPath,
      [script, "--fixture", "--not-a-real-flag"],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    const combined = `${result.stderr || ""}\n${result.stdout || ""}`;
    assert.match(combined, /unknown option: --not-a-real-flag/);
  });

  it("runbook documents exit 0 for live SKIP/BLOCKED (never PASS)", () => {
    const text = fs.readFileSync(MATRIX_DOC, "utf8");
    assert.match(text, /Process exit codes/);
    assert.match(text, /BLOCKED.*never PASS|never PASS/i);
    assert.match(text, /structural\/configuration failure/i);
    assert.doesNotMatch(
      text,
      /Exit codes:\s*\*\*0\*\*\s*=\s*no structure failures \(skips allowed\)\s*·\s*\*\*1\*\*\s*=\s*blocker/,
    );
  });

  it("runTesterSixModeMatrixLive uses shared harness mock and does not claim PASS from readiness", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-live-"));
    const report = await runTesterSixModeMatrixLive({
      repoRoot: REPO_ROOT,
      fixtureId: "sudoku-html-app",
      rowIds: "sa-hybrid",
      evidenceDir: tmp,
      env: { ANTHROPIC_API_KEY: "token-present" },
      localBackendReachable: true,
      runLiveHarnessFn: async (opts) => {
        assert.equal(opts.executeLive, true);
        assert.equal(opts.fixtureId, "sudoku-html-app");
        assert.equal(opts.evidenceDir, tmp);
        return {
          ok: true,
          fixture_id: "sudoku-html-app",
          row_ids: ["sa-hybrid"],
          aggregate_outcome: "SKIP",
          reason_code: REASON_CODES.SKIP_HYBRID_UNSUPPORTED,
          rows: [
            {
              row_id: "sa-hybrid",
              outcome: "SKIP",
              reason_code: REASON_CODES.SKIP_HYBRID_UNSUPPORTED,
              run_id: null,
              task_id: null,
              message: "hybrid honest skip",
            },
          ],
        };
      },
    });
    assert.equal(report.evidence_class, "live_execution");
    assert.equal(report.ok, true);
    const harnessStep = report.steps.find((s) => s.id === "live_harness");
    assert.equal(harnessStep.status, "skip");
    assert.notEqual(harnessStep.status, "pass");
    const liveStep = report.steps.find((s) => s.id === "live:sa-hybrid");
    assert.equal(liveStep.status, "skip");
    assert.notEqual(liveStep.status, "pass");
    const text = formatReportText(report);
    assert.match(text, /live_harness:/);
    assert.match(text, /\[SKIP\] sa-hybrid/);
  });

  it("runTesterSixModeMatrixLive marks live_harness blocked when rows are blocked", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-live-blk-"));
    const report = await runTesterSixModeMatrixLive({
      repoRoot: REPO_ROOT,
      fixtureId: "sudoku-html-app",
      rowIds: "sa-local_only",
      evidenceDir: tmp,
      env: {},
      localBackendReachable: false,
      runLiveHarnessFn: async () => ({
        ok: true,
        fixture_id: "sudoku-html-app",
        row_ids: ["sa-local_only"],
        aggregate_outcome: "BLOCKED",
        reason_code: REASON_CODES.SKIP_LOCAL_BACKEND_MISSING,
        rows: [
          {
            row_id: "sa-local_only",
            outcome: "BLOCKED",
            reason_code: REASON_CODES.SKIP_LOCAL_BACKEND_MISSING,
            run_id: null,
            task_id: null,
            message: "local backend missing",
          },
        ],
      }),
    });
    const harnessStep = report.steps.find((s) => s.id === "live_harness");
    assert.equal(harnessStep.status, "blocked");
    assert.notEqual(harnessStep.status, "pass");
  });
});
