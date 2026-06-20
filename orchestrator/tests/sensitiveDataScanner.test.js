"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, afterEach } = require("node:test");
const {
  REASON_CODES,
  scanSensitiveData,
  redactOutboundText,
  prepareOutboundRemoteText,
  applyPrivacySanitizeToBundle,
  createPrivacyPolicyError,
} = require("../security/sensitive-data-scanner");

function fakeSkOpenAI() {
  return "sk-" + "m".repeat(21);
}

function fakeAwsAccessKeyId() {
  return String.fromCharCode(65, 75, 73, 65) + "0".repeat(16);
}

function fakeGithubPatShape() {
  const prefix = String.fromCharCode(103, 104, 112, 95);
  return `${prefix}${"p".repeat(36)}`;
}

describe("SensitiveDataScanner", () => {
  const envBackup = {};

  afterEach(() => {
    for (const key of Object.keys(envBackup)) {
      if (envBackup[key] === undefined) delete process.env[key];
      else process.env[key] = envBackup[key];
    }
    for (const key of Object.keys(envBackup)) delete envBackup[key];
  });

  function setEnv(key, value) {
    if (!(key in envBackup)) envBackup[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it("scanSensitiveData reports OK for clean text", () => {
    const result = scanSensitiveData("hello world");
    assert.equal(result.reason_code, REASON_CODES.OK);
    assert.equal(result.privacy_scan_status, "ok");
    assert.deepEqual(result.redaction_counts, { pii: 0, secret: 0 });
  });

  it("redacts email and phone PII", () => {
    const email = "user" + "@" + "example.com";
    const phone = "555-123-4567";
    const { text, scanResult } = redactOutboundText(`contact ${email} or ${phone}`);
    assert.equal(scanResult.reason_code, REASON_CODES.PII_REDACTED);
    assert.ok(scanResult.redaction_counts.pii >= 2);
    assert.ok(!text.includes(email));
    assert.ok(!text.includes(phone));
    assert.ok(text.includes("[REDACTED:email]"));
    assert.ok(text.includes("[REDACTED:phone]"));
  });

  it("redacts secret shapes with privacy-owned redaction", () => {
    const sk = fakeSkOpenAI();
    const aws = fakeAwsAccessKeyId();
    const gh = fakeGithubPatShape();
    const { text, scanResult } = redactOutboundText(`keys ${sk} ${aws} ${gh}`);
    assert.equal(scanResult.reason_code, REASON_CODES.SECRET_REDACTED);
    assert.ok(scanResult.redaction_counts.secret >= 3);
    assert.ok(!text.includes(sk));
    assert.ok(!text.includes(aws));
    assert.ok(!text.includes(gh));
  });

  it("redacts URL credentials and counts them as secrets", () => {
    const url = "https:" + "//" + "user" + ":" + "pass" + "@" + "example.com/path";
    const { text, scanResult } = redactOutboundText(`see ${url}`);
    assert.equal(scanResult.reason_code, REASON_CODES.SECRET_REDACTED);
    assert.ok(scanResult.redaction_counts.secret >= 1);
    assert.ok(text.includes("[REDACTED:url-creds]"));
    assert.ok(!text.includes("pass@"));
  });

  it("redacts .env-style secrets as secret redactions", () => {
    const line = "API_KEY=supersecretvalue";
    const { text, scanResult } = redactOutboundText(line);
    assert.equal(scanResult.reason_code, REASON_CODES.SECRET_REDACTED);
    assert.ok(!text.includes("supersecretvalue"));
    assert.ok(text.includes("[REDACTED:env_secret]"));
  });

  it("remote redaction ignores ORCH_TRACE_SKIP_SECRET_REDACT", () => {
    setEnv("ORCH_TRACE_SKIP_SECRET_REDACT", "1");
    delete process.env.CI;
    const sk = fakeSkOpenAI();
    const aws = fakeAwsAccessKeyId();
    const gh = fakeGithubPatShape();
    const bearer = "Bearer " + "z".repeat(20);
    const out = prepareOutboundRemoteText(`tokens ${sk} ${aws} ${gh} ${bearer}`, {
      remote: true,
      agentId: "dev-backend",
    });
    assert.ok(!out.includes(sk));
    assert.ok(!out.includes(aws));
    assert.ok(!out.includes(gh));
    assert.ok(!out.includes(bearer.slice(7)));
    assert.ok(out.includes("[REDACTED:api_token]"));
  });

  it("blocks remote path when scan is forced to fail", () => {
    setEnv("PRIVACY_SCAN_FORCE_FAIL", "1");
    assert.throws(
      () => prepareOutboundRemoteText("prompt body", { remote: true, agentId: "dev-backend" }),
      (err) => err.gate_id === "PRIVACY_SANITIZE_GATE" && err.code === "PRIVACY_SANITIZE_BLOCKED",
    );
  });

  it("still redacts shareable copy when local scan is forced to fail", () => {
    setEnv("PRIVACY_SCAN_FORCE_FAIL", "1");
    const sk = fakeSkOpenAI();
    const email = "ops" + "@" + "example.org";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-force-fail-"));
    try {
      const traceDir = path.join(dir, "trace");
      fs.mkdirSync(traceDir, { recursive: true });
      const traceBody = `{"goal":"leak ${sk} and ${email}"}\n`;
      fs.writeFileSync(path.join(traceDir, "task-1.jsonl"), traceBody, "utf8");
      fs.writeFileSync(
        path.join(dir, "manifest.json"),
        `${JSON.stringify({ bundle_version: "1", files: ["trace/task-1.jsonl"] }, null, 2)}\n`,
        "utf8",
      );

      applyPrivacySanitizeToBundle(dir);
      const shareable = fs.readFileSync(path.join(dir, "shareable", "trace", "task-1.jsonl"), "utf8");
      assert.ok(!shareable.includes(sk));
      assert.ok(!shareable.includes(email));

      const { text, scanResult } = redactOutboundText(traceBody, { remote: false });
      assert.equal(scanResult.reason_code, REASON_CODES.UNAVAILABLE);
      assert.ok(!text.includes(sk));
      assert.ok(!text.includes(email));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applyPrivacySanitizeToBundle writes shareable redacted copies", () => {
    const sk = fakeSkOpenAI();
    const email = "ops" + "@" + "example.org";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-bundle-"));
    try {
      const traceDir = path.join(dir, "trace");
      fs.mkdirSync(traceDir, { recursive: true });
      const traceBody = `{"goal":"use ${sk} and ${email}"}\n`;
      fs.writeFileSync(path.join(traceDir, "task-1.jsonl"), traceBody, "utf8");
      fs.writeFileSync(
        path.join(dir, "manifest.json"),
        `${JSON.stringify({ bundle_version: "1", files: ["trace/task-1.jsonl"] }, null, 2)}\n`,
        "utf8",
      );

      const result = applyPrivacySanitizeToBundle(dir);
      assert.equal(result.summary.redaction_counts.secret >= 1, true);
      assert.ok(result.shareable_files.some((f) => f.includes("shareable/trace/task-1.jsonl")));

      const shareable = fs.readFileSync(path.join(dir, "shareable", "trace", "task-1.jsonl"), "utf8");
      assert.ok(!shareable.includes(sk));
      assert.ok(!shareable.includes(email));
      assert.ok(fs.existsSync(path.join(dir, "privacy-scan.json")));

      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
      assert.ok(manifest.privacy_scan);
      assert.ok(manifest.upload_files.length > 0);
      assert.ok(manifest.local_only_files.includes("trace/task-1.jsonl"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createPrivacyPolicyError sets gate metadata", () => {
    const err = createPrivacyPolicyError("blocked", { reason_code: REASON_CODES.FAILED_BLOCKED });
    assert.equal(err.gate_id, "PRIVACY_SANITIZE_GATE");
    assert.equal(err.reason_code, REASON_CODES.FAILED_BLOCKED);
  });
});
