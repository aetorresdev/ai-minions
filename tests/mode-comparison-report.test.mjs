import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ALLOWED_RESULTS,
  REASON_CODES,
  REPORT_DOC_REQUIRED_MARKERS,
  REPORT_SCHEMA_VERSION,
  buildComparisonReport,
  emptyEvidenceTemplate,
  evidenceFromMatrixRows,
  formatComparisonMarkdown,
  mergeEvidenceRows,
  normalizeMeasuredOrUnavailable,
  normalizeRowResult,
  validateEvidenceInput,
  validatePassEvidenceMinimum,
  validateReportDoc,
} from "../scripts/lib/mode-comparison-report-data.mjs";
import { REASON_CODES as MATRIX_CODES } from "../scripts/lib/tester-six-mode-matrix-data.mjs";
import {
  generateModeComparisonReport,
} from "../scripts/generate-mode-comparison-report.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DOC = path.join(REPO_ROOT, "docs/how-to/mode-comparison-report.md");
const EVIDENCE_TEMPLATE = path.join(
  REPO_ROOT,
  "docs/how-to/evidence/mode-comparison-evidence.template.json",
);

describe("mode-comparison-report-data", () => {
  it("committed how-to passes validateReportDoc", () => {
    const text = fs.readFileSync(REPORT_DOC, "utf8");
    const check = validateReportDoc(text);
    assert.equal(check.ok, true, check.errors.join("; "));
    assert.ok(REPORT_DOC_REQUIRED_MARKERS.length > 10);
  });

  it("READY is never normalized to PASS", () => {
    assert.equal(normalizeRowResult("ready"), "ready");
    assert.equal(normalizeRowResult("READY"), "ready");
    assert.equal(normalizeRowResult("pass"), "pass");
    assert.deepEqual([...ALLOWED_RESULTS].sort(), ["fail", "pass", "ready", "skip"]);
  });

  it("tokens/cost null or empty become unavailable — never fake 0", () => {
    assert.equal(normalizeMeasuredOrUnavailable(null), "unavailable");
    assert.equal(normalizeMeasuredOrUnavailable(undefined), "unavailable");
    assert.equal(normalizeMeasuredOrUnavailable(""), "unavailable");
    assert.equal(normalizeMeasuredOrUnavailable("unavailable"), "unavailable");
    assert.equal(normalizeMeasuredOrUnavailable(42), 42);
    assert.equal(normalizeMeasuredOrUnavailable(0), 0); // measured zero is allowed
  });

  it("hybrid matrix rows stay skip with MATRIX_SKIP_HYBRID_UNSUPPORTED in report", () => {
    const matrixRows = [
      {
        id: "sa-hybrid",
        status: "skip",
        reason_code: MATRIX_CODES.SKIP_HYBRID_UNSUPPORTED,
        message: "honest skip",
        command: "(unsupported)",
      },
      {
        id: "ma-hybrid",
        status: "skip",
        reason_code: MATRIX_CODES.SKIP_HYBRID_UNSUPPORTED,
        message: "honest skip",
        command: "(unsupported)",
      },
    ];
    const report = buildComparisonReport({ matrixRows, source: "test" });
    const hybrids = report.rows.filter((r) => r.inference_mode === "hybrid");
    assert.equal(hybrids.length, 2);
    for (const h of hybrids) {
      assert.equal(h.result, "skip");
      assert.equal(h.reason_code, MATRIX_CODES.SKIP_HYBRID_UNSUPPORTED);
      assert.equal(h.tokens, "unavailable");
      assert.equal(h.cost, "unavailable");
    }
  });

  it("READY from matrix is not promoted to PASS when merging empty evidence", () => {
    const seeds = evidenceFromMatrixRows([
      {
        id: "sa-remote_ok",
        status: "ready",
        reason_code: MATRIX_CODES.READY,
        command: "ai-minions smoke --model-policy remote_ok",
      },
    ]);
    const merged = mergeEvidenceRows(seeds, []);
    const row = merged.find((r) => r.row_id === "sa-remote_ok");
    assert.equal(row.result, "ready");
    const report = buildComparisonReport({
      matrixRows: [
        {
          id: "sa-remote_ok",
          status: "ready",
          reason_code: MATRIX_CODES.READY,
          command: "x",
        },
      ],
    });
    const out = report.rows.find((r) => r.row_id === "sa-remote_ok");
    assert.equal(out.result, "ready");
    assert.ok(report.honesty.ready_is_not_pass);
    assert.ok(report.markdown === undefined);
    const md = formatComparisonMarkdown(report);
    assert.match(md, /READY is not PASS/);
    assert.match(md, /\*\*READY\*\*/);
    assert.doesNotMatch(md, /sa-remote_ok[\s\S]*\*\*PASS\*\*/);
  });

  it("evidence override can set PASS with attach evidence and measured tokens", () => {
    const report = buildComparisonReport({
      matrixRows: [
        {
          id: "sa-local_only",
          status: "ready",
          reason_code: MATRIX_CODES.READY,
          command: "ai-minions smoke --model-policy local_only",
        },
      ],
      evidenceRows: [
        {
          row_id: "sa-local_only",
          result: "pass",
          reason_code: "MATRIX_OK",
          run_id: "run-1",
          task_id: "task-1",
          artifact_paths: ["sudoku.html"],
          attach_path: "/tmp/bundle/ATTACH.md",
          attach_available: true,
          trace_path: "/tmp/traces/task-1.jsonl",
          status_evidence: "status ok",
          tokens: 1200,
          cost: 0.01,
          fixture_id: "sudoku-html-app",
        },
      ],
      fixture_id: "sudoku-html-app",
    });
    const row = report.rows.find((r) => r.row_id === "sa-local_only");
    assert.equal(row.result, "pass");
    assert.equal(row.tokens, 1200);
    assert.equal(row.cost, 0.01);
    assert.equal(row.evidence.attach_available, true);
    assert.equal(report.counts.pass, 1);
  });

  it("hybrid evidence overrides pass/ready stay skip (sa-hybrid and ma-hybrid)", () => {
    for (const rowId of ["sa-hybrid", "ma-hybrid"]) {
      for (const override of ["pass", "ready"]) {
        const seeds = evidenceFromMatrixRows([
          {
            id: rowId,
            status: "skip",
            reason_code: MATRIX_CODES.SKIP_HYBRID_UNSUPPORTED,
            command: "(unsupported)",
          },
        ]);
        const merged = mergeEvidenceRows(seeds, [
          {
            row_id: rowId,
            result: /** @type {'pass'|'ready'} */ (override),
            reason_code: "MATRIX_OK",
            agent_flow: "forged_flow",
            model_policy: "remote_ok",
            run_id: "run-x",
            task_id: "task-x",
            artifact_paths: ["x.html"],
            status_evidence: "ok",
            attach_available: true,
          },
        ]);
        const row = merged.find((r) => r.row_id === rowId);
        assert.equal(row.result, "skip", `${rowId} override ${override}`);
        assert.equal(row.reason_code, MATRIX_CODES.SKIP_HYBRID_UNSUPPORTED);
        assert.equal(row.model_policy, "hybrid");
        assert.ok(
          row.agent_flow === "single_agent" || row.agent_flow === "multi_agent",
        );
        assert.notEqual(row.agent_flow, "forged_flow");

        const report = buildComparisonReport({
          matrixRows: [
            {
              id: rowId,
              status: "skip",
              reason_code: MATRIX_CODES.SKIP_HYBRID_UNSUPPORTED,
            },
          ],
          evidenceRows: [
            {
              row_id: rowId,
              result: /** @type {'pass'|'ready'} */ (override),
              model_policy: "local_only",
              agent_flow: "forged_flow",
            },
          ],
        });
        const out = report.rows.find((r) => r.row_id === rowId);
        assert.equal(out.result, "skip");
        assert.equal(out.reason_code, MATRIX_CODES.SKIP_HYBRID_UNSUPPORTED);
        assert.equal(out.inference_mode, "hybrid");
        assert.notEqual(out.agent_flow, "forged_flow");
      }
    }
  });

  it("validateEvidenceInput rejects hybrid pass/ready overrides", () => {
    for (const rowId of ["sa-hybrid", "ma-hybrid"]) {
      for (const result of ["pass", "ready"]) {
        const check = validateEvidenceInput({
          rows: [{ row_id: rowId, result }],
        });
        assert.equal(check.ok, false, `${rowId} ${result}`);
        assert.ok(
          check.errors.some((e) => e.includes("must remain skip")),
          check.errors.join("; "),
        );
      }
    }
  });

  it("validateEvidenceInput rejects incomplete PASS without minimum evidence", () => {
    const incomplete = validateEvidenceInput({
      rows: [{ row_id: "sa-local_only", result: "pass" }],
    });
    assert.equal(incomplete.ok, false);
    assert.ok(incomplete.errors.some((e) => e.includes("artifact_paths")));
    assert.ok(incomplete.errors.some((e) => e.includes("run_id or task_id")));
    assert.ok(incomplete.errors.some((e) => e.includes("status_evidence")));
    assert.ok(
      incomplete.errors.some((e) => e.includes("attach_path or attach_available")),
    );

    const complete = validateEvidenceInput({
      rows: [
        {
          row_id: "sa-local_only",
          result: "pass",
          artifact_paths: ["sudoku.html"],
          run_id: "run-1",
          status_evidence: "status ok",
          attach_available: true,
        },
      ],
    });
    assert.equal(complete.ok, true, complete.errors.join("; "));
  });

  it('rejects PASS when attach_available is the string "false"', () => {
    const row = {
      row_id: "sa-local_only",
      result: "pass",
      artifact_paths: ["sudoku.html"],
      run_id: "run-1",
      status_evidence: "status ok",
      attach_available: "false",
    };
    const gate = validatePassEvidenceMinimum(/** @type {any} */ (row));
    assert.equal(gate.ok, false);
    assert.ok(
      gate.errors.some((e) => e.includes("boolean")),
      gate.errors.join("; "),
    );
    assert.ok(
      gate.errors.some((e) => e.includes("attach_path or attach_available")),
      gate.errors.join("; "),
    );

    const input = validateEvidenceInput({ rows: [/** @type {any} */ (row)] });
    assert.equal(input.ok, false);
    assert.ok(input.errors.some((e) => e.includes("boolean")));
  });

  it("buildComparisonReport demotes incomplete PASS to FAIL (central gate)", () => {
    const report = buildComparisonReport({
      matrixRows: [
        {
          id: "sa-local_only",
          status: "ready",
          reason_code: MATRIX_CODES.READY,
          command: "ai-minions smoke --model-policy local_only",
        },
      ],
      evidenceRows: [
        {
          row_id: "sa-local_only",
          result: "pass",
          reason_code: "MATRIX_OK",
          // Intentionally incomplete — no artifacts / run / status / attach
        },
      ],
      source: "from-matrix-json-bypass",
    });
    const row = report.rows.find((r) => r.row_id === "sa-local_only");
    assert.equal(row.result, "fail");
    assert.equal(row.reason_code, REASON_CODES.ROW_FAIL);
    assert.match(row.message, /PASS rejected/);
    assert.equal(report.counts.pass, 0);
    assert.ok(report.counts.fail >= 1);

    const coerced = buildComparisonReport({
      evidenceRows: [
        /** @type {any} */ ({
          row_id: "sa-remote_ok",
          result: "pass",
          artifact_paths: ["out.html"],
          run_id: "run-2",
          status_evidence: "ok",
          attach_available: "false",
        }),
      ],
    });
    const coercedRow = coerced.rows.find((r) => r.row_id === "sa-remote_ok");
    assert.equal(coercedRow.result, "fail");
    assert.equal(coercedRow.evidence.attach_available, false);
    assert.equal(coercedRow.reason_code, REASON_CODES.ROW_FAIL);
  });

  it("injected secret token never appears in Markdown or JSON report", () => {
    const secret = "sk-" + "c".repeat(24);
    const ant = "sk-ant-" + "d".repeat(20);
    const proj = "sk-proj-" + "e".repeat(20);
    const report = buildComparisonReport({
      matrixRows: [
        {
          id: "sa-local_only",
          status: "ready",
          reason_code: MATRIX_CODES.READY,
          command: "ai-minions smoke --model-policy local_only",
        },
      ],
      evidenceRows: [
        {
          row_id: "sa-local_only",
          result: "fail",
          reason_code: "MATRIX_ROW_FAIL",
          tester_notes: `leak ${secret} ant ${ant} proj ${proj}`,
          status_evidence: `Bearer ${"a".repeat(24)}`,
          command: `echo ${secret}`,
          selected_model: secret,
          selected_provider: ant,
          attach_path: `/tmp/${proj}/ATTACH.md`,
          message: `failed with ${secret}`,
        },
      ],
    });
    const md = formatComparisonMarkdown(report);
    const json = JSON.stringify(report, null, 2);
    for (const s of [secret, ant, proj]) {
      const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      assert.doesNotMatch(md, re);
      assert.doesNotMatch(json, re);
    }
    assert.match(md, /\[REDACTED:api_token\]/);
    assert.match(json, /\[REDACTED:api_token\]/);
  });

  it("validateEvidenceInput rejects unknown row ids, bad results, and secret-shaped fields", () => {
    assert.equal(
      validateEvidenceInput({
        rows: [
          {
            row_id: "sa-local_only",
            result: "ready",
          },
        ],
      }).ok,
      true,
    );
    assert.equal(
      validateEvidenceInput({
        rows: [{ row_id: "nope", result: "pass" }],
      }).ok,
      false,
    );
    assert.equal(
      validateEvidenceInput({
        rows: [{ row_id: "sa-local_only", result: "won" }],
      }).ok,
      false,
    );
    const secretCheck = validateEvidenceInput({
      rows: [
        {
          row_id: "sa-local_only",
          result: "fail",
          tester_notes: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        },
      ],
    });
    assert.equal(secretCheck.ok, false);
    assert.ok(secretCheck.errors.some((e) => e.includes("secret-shaped")));
  });

  it("emptyEvidenceTemplate covers six rows and schema version", () => {
    const t = emptyEvidenceTemplate();
    assert.equal(t.schema_version, REPORT_SCHEMA_VERSION);
    assert.equal(t.rows.length, 6);
    assert.ok(fs.existsSync(EVIDENCE_TEMPLATE));
    const committed = JSON.parse(fs.readFileSync(EVIDENCE_TEMPLATE, "utf8"));
    assert.equal(committed.rows.length, 6);
    assert.equal(
      committed.rows.find((r) => r.row_id === "sa-hybrid").reason_code,
      "MATRIX_SKIP_HYBRID_UNSUPPORTED",
    );
  });
});

describe("generate-mode-comparison-report", () => {
  it("structure generation succeeds and writes markdown+json", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mode-cmp-"));
    const result = await generateModeComparisonReport({
      repoRoot: REPO_ROOT,
      skipLive: true,
      probeLocal: false,
      fixtureId: "sudoku-html-app",
    });
    assert.equal(result.ok, true, result.steps.map((s) => s.message).join("; "));
    assert.equal(result.report.rows.length, 6);
    assert.ok(result.markdown.includes("Mode comparison report"));
    assert.ok(result.markdown.includes("unavailable"));
    assert.ok(result.report.honesty.no_invented_cross_mode_scores);

    const hybrid = result.report.rows.filter((r) => r.inference_mode === "hybrid");
    assert.equal(hybrid.length, 2);
    for (const h of hybrid) {
      assert.equal(h.result, "skip");
      assert.equal(h.reason_code, MATRIX_CODES.SKIP_HYBRID_UNSUPPORTED);
    }

    // No PASS invented from structure-only gate
    assert.equal(result.report.counts.pass, 0);

    fs.writeFileSync(path.join(tmp, "mode-comparison-report.md"), result.markdown);
    fs.writeFileSync(
      path.join(tmp, "mode-comparison-report.json"),
      JSON.stringify(result.report, null, 2),
    );
    assert.ok(fs.existsSync(path.join(tmp, "mode-comparison-report.md")));
  });

  it("doc failure surfaces COMPARE_DOC_FAIL", async () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "mode-cmp-repo-"));
    fs.mkdirSync(path.join(tmpRepo, "docs/how-to"), { recursive: true });
    fs.writeFileSync(path.join(tmpRepo, "docs/how-to/mode-comparison-report.md"), "# empty\n");
    // Matrix doc also required by runTesterSixModeMatrix — copy real matrix data path won't work
    // without matrix doc. Provide minimal matrix doc markers by copying from repo.
    fs.copyFileSync(
      path.join(REPO_ROOT, "docs/how-to/tester-six-mode-matrix.md"),
      path.join(tmpRepo, "docs/how-to/tester-six-mode-matrix.md"),
    );
    const result = await generateModeComparisonReport({
      repoRoot: tmpRepo,
      skipLive: true,
    });
    assert.equal(result.ok, false);
    const docStep = result.steps.find((s) => s.id === "comparison_doc");
    assert.equal(docStep.status, "fail");
    assert.equal(docStep.reason_code, REASON_CODES.DOC_FAIL);
  });
});
