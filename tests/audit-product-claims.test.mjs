import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  REASON_CODES,
  formatReportText,
  runClaimAudit,
} from "../scripts/audit-product-claims.mjs";

describe("audit-product-claims", () => {
  it("fails when README is missing required markers", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claim-audit-"));
    fs.writeFileSync(path.join(tmp, "README.md"), "# Test\nNo limitations here.\n");
    const report = runClaimAudit({ repoRoot: tmp, paths: ["README.md"] });
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => c.reason_code === REASON_CODES.MISSING_README_MARKER));
  });

  it("flags forbidden affirmative claims outside code fences", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claim-audit-"));
    const rel = "docs/how-to/fresh-clone-evidence.md";
    fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), "# Doc\nThis product is production-ready today.\n");
    const report = runClaimAudit({ repoRoot: tmp, paths: [rel] });
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => c.reason_code === REASON_CODES.FORBIDDEN_PHRASE));
  });

  it("passes negated forbidden phrases", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claim-audit-"));
    const rel = "docs/how-to/fresh-clone-evidence.md";
    fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), "# Doc\nNot production-ready. No global installer.\n");
    const report = runClaimAudit({ repoRoot: tmp, paths: [rel] });
    assert.equal(report.ok, true);
  });

  it("formatReportText includes audit header", () => {
    const report = runClaimAudit({ repoRoot: "/nonexistent", paths: ["README.md"] });
    const text = formatReportText(report);
    assert.match(text, /product-claim audit/);
  });

  it("flags v0.26 deferred context-runtime and loop/graph claims", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claim-audit-"));
    const rel = "docs/how-to/fresh-clone-evidence.md";
    fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, rel),
      [
        "# Doc",
        "ai-minions automatically sends only the context each agent needs.",
        "unused tools and skills are hidden per step.",
        "required instructions can never be truncated.",
        "every invocation has a reproducible context hash.",
        "Canonical Loop Contract shipped.",
        "Execution Graph runtime shipped.",
        "bounded context-package runtime shipped.",
        "progressive disclosure shipped.",
      ].join("\n"),
    );
    const report = runClaimAudit({ repoRoot: tmp, paths: [rel] });
    assert.equal(report.ok, false);
    const forbidden = report.checks.filter((c) => c.reason_code === REASON_CODES.FORBIDDEN_PHRASE);
    assert.ok(forbidden.length >= 6, `expected multiple forbidden hits, got ${forbidden.length}`);
  });

  it("passes negated v0.26 deferred context-runtime claims", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claim-audit-"));
    const rel = "docs/how-to/fresh-clone-evidence.md";
    fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, rel),
      [
        "# Doc",
        "Not claimed: ai-minions automatically sends only the context each agent needs.",
        "Do not claim unused tools and skills are hidden per step.",
        "Not claimed: Canonical Loop Contract shipped.",
        "Not claimed: Execution Graph runtime shipped.",
      ].join("\n"),
    );
    const report = runClaimAudit({ repoRoot: tmp, paths: [rel] });
    assert.equal(report.ok, true);
  });
});
