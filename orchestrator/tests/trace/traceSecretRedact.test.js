"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const cp = require("child_process");
/** Preserve real spawn for CLI smoke tests below (orchestrator load may rely on stubbed spawn). */
const spawnSyncReal = cp.spawnSync;
cp.spawnSync = () => ({ error: null, status: 0, stdout: "\n", stderr: "" });

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { redactSensitivePlaintext, sanitizeTraceRowsForRead } = require("../../modules/trace/trace-redact");
const { _sanitize } = require("../../orchestrator");

/** Runtime-built shapes only — GitHub push protection decodes Base64 and flags embedded tokens. */
function fakeSkOpenAI() {
  return "sk-" + "m".repeat(21);
}
function fakeGithubPatPrefix() {
  return String.fromCharCode(103, 104, 112, 95);
}
function fakeSlackBotPrefix() {
  return String.fromCharCode(120, 111, 120, 98);
}
function fakeAwsAccessKeyId() {
  return String.fromCharCode(65, 75, 73, 65) + "0".repeat(16);
}
function fakeSlackTokenShape() {
  return `${fakeSlackBotPrefix()}-1234567890-1234567890-${"n".repeat(24)}`;
}
function fakeGithubPatShape() {
  return `${fakeGithubPatPrefix()}${"p".repeat(36)}`;
}

test("redactSensitivePlaintext redacts Bearer-shaped tokens", () => {
  const t = "Bearer " + "z".repeat(20);
  assert.match(redactSensitivePlaintext(`pre ${t} post`), /\[REDACTED:bearer\]/);
});

test("redactSensitivePlaintext redacts sk- shaped API tokens", () => {
  const sk = fakeSkOpenAI();
  const out = redactSensitivePlaintext(`x ${sk} y`);
  assert.match(out, /\[REDACTED:api_token\]/);
  assert.ok(!out.includes(sk));
});

test("redactSensitivePlaintext redacts AWS access key id shape", () => {
  const k = fakeAwsAccessKeyId();
  assert.match(redactSensitivePlaintext(`k=${k}`), /\[REDACTED:aws_access_key\]/);
});

test("redactSensitivePlaintext redacts GitHub PAT shape", () => {
  const g = fakeGithubPatShape();
  assert.match(redactSensitivePlaintext(`t ${g}`), /\[REDACTED:github_pat\]/);
});

test("redactSensitivePlaintext redacts Slack bot token shape", () => {
  const x = fakeSlackTokenShape();
  assert.match(redactSensitivePlaintext(`msg ${x}`), /\[REDACTED:slack_token\]/);
});

test("redactSensitivePlaintext redacts URL user:password before @", () => {
  const u = "https:" + "//" + "u" + ":" + "pw" + "@" + "example.com/path";
  const out = redactSensitivePlaintext(`see ${u}`);
  assert.match(out, /\[REDACTED-url-creds\]@example\.com/);
  assert.ok(!out.includes("pw@"), "URL password must not survive");
});

test("_sanitize applies redaction to reason, summary, task, and transition_reason.details", () => {
  const bearer = "Bearer " + "a".repeat(20);
  const row = _sanitize({
    event: "contract_fail",
    reason: `fail: ${bearer} tail`,
    summary: `summary ${bearer}`,
    task: `task ${bearer}`,
    transition_reason: { type: "CONTRACT_FAIL", details: `d ${bearer}`, reason_code: "CONTRACT_OR_DECIDE_FAILURE" },
  });
  assert.ok(!String(row.reason).includes("aaaa"), row.reason);
  assert.ok(String(row.reason).includes("[REDACTED:bearer]"));
  assert.ok(String(row.summary).includes("[REDACTED:bearer]"));
  assert.ok(String(row.task).includes("[REDACTED:bearer]"));
  assert.ok(String(row.transition_reason.details).includes("[REDACTED:bearer]"));
});

test("_sanitize redacts cerberus_check items and gate_blocked reasons", () => {
  const sk = fakeSkOpenAI();
  const out = _sanitize({
    event: "cerberus_check",
    items: [`blocker: ${sk}`, "ok line"],
    reasons: [`r: ${sk}`],
    errors: [`e: ${sk}`],
  });
  assert.ok(!JSON.stringify(out.items).includes(sk));
  assert.ok(String(out.items[0]).includes("[REDACTED:api_token]"));
});

test("ORCH_TRACE_SKIP_SECRET_REDACT=1 leaves literals intact (not under CI)", (t) => {
  const prevCi = process.env.CI;
  t.after(() => {
    delete process.env.ORCH_TRACE_SKIP_SECRET_REDACT;
    if (prevCi !== undefined) process.env.CI = prevCi;
    else delete process.env.CI;
  });
  delete process.env.CI;
  process.env.ORCH_TRACE_SKIP_SECRET_REDACT = "1";
  const sk = fakeSkOpenAI();
  assert.equal(redactSensitivePlaintext(`x ${sk}`), `x ${sk}`);
});

test("CI=true with ORCH_TRACE_SKIP_SECRET_REDACT=1 fails loading trace-redact", () => {
  const dir = path.join(__dirname, "..", "..");
  const r = spawnSyncReal(
    process.execPath,
    ["-e", "require('./trace-redact.js')"],
    {
      cwd: dir,
      env: { ...process.env, CI: "true", ORCH_TRACE_SKIP_SECRET_REDACT: "1" },
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 1, r.stderr || r.stdout);
  assert.match(String(r.stderr || ""), /ORCH_TRACE_SKIP_SECRET_REDACT|CI|local-only/i);
});

test("sanitizeTraceRowsForRead redacts nested strings", () => {
  const sk = fakeSkOpenAI();
  const rows = sanitizeTraceRowsForRead([
    {
      event: "session_start",
      goal: `g ${sk}`,
      transition_reason: { details: `d ${sk}`, reason_code: "X", type: "ITERATE" },
    },
  ]);
  const s = JSON.stringify(rows);
  assert.ok(!s.includes(sk));
  assert.ok(s.includes("[REDACTED:api_token]"));
});

test("token-trace-report --json omits raw api-token-shaped goal from file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-ttred-"));
  try {
    const sk = "sk-" + "d".repeat(25);
    const jsonl = [
      { ts: "t0", task_id: "tid-tr", event: "session_start", flow_mode: "single_agent", max_iterations: 1, goal: `k ${sk} z` },
      { ts: "t1", task_id: "tid-tr", event: "session_end", iterations: 1, done: true },
    ].map(JSON.stringify).join("\n");
    const fp = path.join(dir, "tid-tr.jsonl");
    fs.writeFileSync(fp, jsonl, "utf8");
    const bin = path.join(__dirname, "..", "..", "token-trace-report.js");
    const r = spawnSyncReal(process.execPath, [bin, "--file", fp, "--json"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.ok(!r.stdout.includes(sk), "stdout must not contain raw token");
    assert.match(r.stdout, /\[REDACTED:api_token\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explain-run --json omits raw api-token-shaped goal from file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-exred-"));
  try {
    const sk = "sk-" + "e".repeat(25);
    const jsonl = [
      { ts: "t0", ts_ms: 1, task_id: "tid-ex", event: "session_start", flow_mode: "single_agent", goal: `plan ${sk} end` },
      { ts: "t1", ts_ms: 2, task_id: "tid-ex", event: "session_end", outcome: "done" },
    ].map(JSON.stringify).join("\n");
    const fp = path.join(dir, "tid-ex.jsonl");
    fs.writeFileSync(fp, jsonl, "utf8");
    const bin = path.join(__dirname, "..", "..", "explain-run.js");
    const r = spawnSyncReal(process.execPath, [bin, "--file", fp, "--json"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.ok(!r.stdout.includes(sk));
    assert.match(r.stdout, /\[REDACTED:api_token\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
