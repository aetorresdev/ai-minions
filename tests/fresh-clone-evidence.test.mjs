import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  REASON_CODES,
  formatReportText,
  runFreshCloneEvidence,
} from "../scripts/run-fresh-clone-evidence.mjs";

describe("run-fresh-clone-evidence", () => {
  it("fails entry-path preflight when orchestrator layout is missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-evidence-"));
    const report = await runFreshCloneEvidence({ repoRoot: tmp });
    assert.equal(report.ok, false);
    const preflight = report.steps.find((s) => s.id === "bootstrap_preflight");
    assert.equal(preflight?.reason_code, REASON_CODES.PREFLIGHT);
  });

  it("passes layout and smoke plan on minimal orchestrator tree", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-evidence-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.writeFileSync(path.join(orch, "run-orchestrator.js"), "// stub\n");

    const report = await runFreshCloneEvidence({ repoRoot: tmp });
    const preflight = report.steps.find((s) => s.id === "bootstrap_preflight");
    const smokePlan = report.steps.find((s) => s.id === "primary_smoke_plan");
    assert.equal(preflight?.status, "pass");
    assert.equal(smokePlan?.status, "pass");
    assert.equal(report.ok, false);
  });

  it("skips npm test by default", async () => {
    const report = await runFreshCloneEvidence();
    const npm = report.steps.find((s) => s.id === "npm_test");
    assert.equal(npm?.status, "skip");
  });

  it("formatReportText includes evidence_class", async () => {
    const report = await runFreshCloneEvidence({ repoRoot: "/nonexistent" });
    const text = formatReportText(report);
    assert.match(text, /evidence_class/);
  });
});
