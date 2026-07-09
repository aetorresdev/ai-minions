"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildAttachSummaryMd,
  buildAttachManagementSummaryMd,
  buildRedactionReportJson,
  computeBundleChecksums,
  filterAttachUploadFiles,
  writeHumanReadableAttachArtifacts,
  finalizeHumanReadableAttachBundle,
} = require("../../modules/operator/operator-attach-bundle");
const { loadOperatorTraceContext } = require("../../modules/operator/operator-trace-command");

const FIXTURES = path.join(__dirname, "..", "fixtures", "operator-trace-summary");

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

test("buildAttachManagementSummaryMd includes required management fields", () => {
  const ctx = loadOperatorTraceContext({
    filePath: path.join(FIXTURES, "complete.v1.jsonl"),
    existsSync: (p) => !String(p).includes("report-bundles"),
    readFileSync: (p) => loadFixture(path.basename(p)),
    repoRoot: "/tmp/repo",
  });
  assert.equal(ctx.ok, true);
  const md = buildAttachManagementSummaryMd(ctx, { inspectOk: true });
  assert.match(md, /Outcome/);
  assert.match(md, /User-visible blocker/);
  assert.match(md, /Business impact/);
  assert.match(md, /Cost \/ token estimate/);
  assert.match(md, /Recommended next action/);
  assert.match(md, /Confidence level/);
  assert.match(md, /Not claimed/);
});

test("buildAttachSummaryMd uses bundle basename not local path", () => {
  const ctx = loadOperatorTraceContext({
    filePath: path.join(FIXTURES, "blocked.v1.jsonl"),
    existsSync: (p) => !String(p).includes("report-bundles"),
    readFileSync: (p) => loadFixture(path.basename(p)),
    repoRoot: "/tmp/repo",
  });
  assert.equal(ctx.ok, true);
  const md = buildAttachSummaryMd(ctx, {
    inspectOk: false,
    repoCommit: "abc123",
    bundleBasename: "fix-blocked-2026-07-08",
  });
  assert.match(md, /fix-blocked-2026-07-08/);
  assert.doesNotMatch(md, /\/bundles\//);
  assert.match(md, /Next safe action/);
});

test("filterAttachUploadFiles excludes raw markdown and operator notes", () => {
  const filtered = filterAttachUploadFiles([
    "privacy-scan.json",
    "SUMMARY.md",
    "MANAGEMENT_SUMMARY.md",
    "shareable/SUMMARY.md",
    "shareable/MANAGEMENT_SUMMARY.md",
    "shareable/OPERATOR_NOTES.md",
    "shareable/trace/t.jsonl",
  ]);
  assert.deepEqual(filtered, [
    "privacy-scan.json",
    "shareable/SUMMARY.md",
    "shareable/MANAGEMENT_SUMMARY.md",
    "shareable/trace/t.jsonl",
  ]);
});

test("buildRedactionReportJson includes checksums and scanner evidence", () => {
  const report = buildRedactionReportJson(
    { privacy_scan_status: "ok", reason_code: "PRIVACY_OK" },
    ["shareable/trace/t.jsonl"],
    { "shareable/trace/t.jsonl": "deadbeef" },
  );
  assert.equal(report.schema_version, "1");
  assert.ok(report.scanner_evidence);
  assert.deepEqual(report.checksums_sha256, { "shareable/trace/t.jsonl": "deadbeef" });
});

test("writeHumanReadableAttachArtifacts creates local layout before privacy scan", () => {
  const bundleDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "attach-hr-"));
  const traceDir = path.join(bundleDir, "trace");
  fs.mkdirSync(traceDir, { recursive: true });
  const traceFile = path.join(FIXTURES, "complete.v1.jsonl");
  fs.copyFileSync(traceFile, path.join(traceDir, "fix-complete.jsonl"));
  fs.writeFileSync(
    path.join(bundleDir, "inspect-report.json"),
    JSON.stringify({ ok: true, checks: [] }),
    "utf8",
  );

  const result = writeHumanReadableAttachArtifacts({
    bundleDir,
    taskId: "fix-complete",
    traceFile,
    repoRoot: "/tmp/repo",
    inspectOk: true,
    inspectChecks: [],
    repoCommit: "16501a4",
    fsOps: {
      existsSync: (p) => !String(p).includes("report-bundles"),
      readFileSync: (p) => {
        if (String(p).includes("complete.v1.jsonl")) return loadFixture("complete.v1.jsonl");
        return fs.readFileSync(p, "utf8");
      },
    },
  });

  assert.equal(result.operator_context_ok, true);
  assert.ok(fs.existsSync(path.join(bundleDir, "SUMMARY.md")));
  assert.ok(fs.existsSync(path.join(bundleDir, "OPERATOR_NOTES.md")));
  assert.ok(fs.existsSync(path.join(bundleDir, "MANAGEMENT_SUMMARY.md")));
  assert.ok(!fs.existsSync(path.join(bundleDir, "redaction-report.json")));
  assert.ok(fs.existsSync(path.join(bundleDir, "traces", "fix-complete.jsonl")));
  assert.ok(fs.existsSync(path.join(bundleDir, "evidence", "inspect-report.json")));

  const notes = fs.readFileSync(path.join(bundleDir, "OPERATOR_NOTES.md"), "utf8");
  assert.match(notes, /Local paths/);
  assert.match(notes, /Local-only/);
});

test("finalizeHumanReadableAttachBundle writes redaction report after privacy scan", () => {
  const bundleDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "attach-fin-"));
  fs.writeFileSync(
    path.join(bundleDir, "privacy-scan.json"),
    JSON.stringify({ privacy_scan_status: "ok", reason_code: "PRIVACY_OK" }),
    "utf8",
  );
  fs.mkdirSync(path.join(bundleDir, "shareable"), { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "shareable", "SUMMARY.md"), "# ok\n", "utf8");

  const uploadFiles = ["privacy-scan.json", "shareable/SUMMARY.md"];
  const result = finalizeHumanReadableAttachBundle({
    bundleDir,
    privacySummary: { privacy_scan_status: "ok", reason_code: "PRIVACY_OK" },
    uploadFiles,
  });

  assert.ok(fs.existsSync(path.join(bundleDir, "redaction-report.json")));
  assert.ok(result.upload_files.includes("redaction-report.json"));
  const report = JSON.parse(fs.readFileSync(path.join(bundleDir, "redaction-report.json"), "utf8"));
  assert.equal(report.privacy_scan.reason_code, "PRIVACY_OK");
  const checksums = computeBundleChecksums(bundleDir, ["shareable/SUMMARY.md"]);
  assert.ok(checksums["shareable/SUMMARY.md"]);
});
