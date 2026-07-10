import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runCohortUxFrictionLogCli } from "../scripts/cohort-ux-friction-log.mjs";
import {
  buildSessionFunnel,
  isIso8601Timestamp,
  parseFrictionLogLines,
  summarizeFrictionLog,
  validateFrictionEntry,
} from "../scripts/lib/cohort-ux-friction-log.mjs";

const VALID_ENTRY = {
  schema_version: 1,
  recorded_at: "2026-07-10T16:00:00Z",
  tester_id: "t1",
  session_id: "s1",
  step_index: 1,
  command: "first-run",
  outcome: "success",
  exit_code: 0,
  reason_code: "FIRST_RUN_READY",
};

describe("cohort-ux-friction-log", () => {
  it("isIso8601Timestamp accepts Z and offset timestamps", () => {
    assert.equal(isIso8601Timestamp("2026-07-10T16:00:00Z"), true);
    assert.equal(isIso8601Timestamp("2026-07-10T16:00:00.123Z"), true);
    assert.equal(isIso8601Timestamp("2026-07-10T10:00:00-06:00"), true);
  });

  it("validateFrictionEntry accepts minimal valid entry", () => {
    const result = validateFrictionEntry(VALID_ENTRY);
    assert.equal(result.ok, true);
  });

  it("validateFrictionEntry rejects unknown properties", () => {
    const result = validateFrictionEntry({ ...VALID_ENTRY, extra_field: true });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes("unknown property: extra_field")));
    }
  });

  it("validateFrictionEntry rejects non-ISO recorded_at", () => {
    const result = validateFrictionEntry({ ...VALID_ENTRY, recorded_at: "2026-07-10 16:00:00" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes("ISO 8601")));
    }
  });

  it("validateFrictionEntry rejects bad command", () => {
    const result = validateFrictionEntry({ ...VALID_ENTRY, command: "navigate-tui" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes("command")));
    }
  });

  it("parseFrictionLogLines reads example file", () => {
    const example = fs.readFileSync(
      path.join("docs/how-to/evidence/cohort-friction-log.example.jsonl"),
      "utf8",
    );
    const parsed = parseFrictionLogLines(example);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.entries.length, 5);
    }
  });

  it("buildSessionFunnel computes per-session conversions and drop-offs", () => {
    const example = fs.readFileSync(
      path.join("docs/how-to/evidence/cohort-friction-log.example.jsonl"),
      "utf8",
    );
    const parsed = parseFrictionLogLines(example);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const funnel = buildSessionFunnel(parsed.entries);
    assert.equal(funnel.sessions_total, 2);
    assert.equal(funnel.per_stage["first-run"].success, 2);
    assert.equal(funnel.per_stage.smoke.success, 0);
    assert.equal(funnel.drop_offs[0].sessions, 2);
    assert.equal(funnel.conversions[0].eligible_sessions, 2);
    assert.equal(funnel.conversions[0].success_sessions, 0);
    assert.equal(funnel.conversions[0].rate, 0);
  });

  it("buildSessionFunnel excludes smoke success from ineligible sessions", () => {
    const rows = [
      {
        ...VALID_ENTRY,
        session_id: "eligible",
        step_index: 1,
        command: "first-run",
        outcome: "success",
      },
      {
        ...VALID_ENTRY,
        session_id: "eligible",
        step_index: 2,
        command: "smoke",
        outcome: "success",
      },
      {
        ...VALID_ENTRY,
        session_id: "ineligible",
        step_index: 1,
        command: "first-run",
        outcome: "fail",
      },
      {
        ...VALID_ENTRY,
        session_id: "ineligible",
        step_index: 2,
        command: "smoke",
        outcome: "success",
      },
      {
        ...VALID_ENTRY,
        session_id: "out-of-order",
        step_index: 1,
        command: "smoke",
        outcome: "success",
      },
      {
        ...VALID_ENTRY,
        session_id: "out-of-order",
        step_index: 2,
        command: "first-run",
        outcome: "success",
      },
    ];
    const funnel = buildSessionFunnel(rows);
    const firstToSmoke = funnel.conversions[0];
    assert.equal(funnel.per_stage.smoke.success, 3);
    assert.equal(firstToSmoke.eligible_sessions, 2);
    assert.equal(firstToSmoke.continued_sessions, 1);
    assert.equal(firstToSmoke.success_sessions, 1);
    assert.equal(firstToSmoke.rate, 0.5);
  });

  it("summarizeFrictionLog derives promotion_hint from session funnel", () => {
    const example = fs.readFileSync(
      path.join("docs/how-to/evidence/cohort-friction-log.example.jsonl"),
      "utf8",
    );
    const parsed = parseFrictionLogLines(example);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const summary = summarizeFrictionLog(parsed.entries);
    assert.equal(summary.entry_count, 5);
    assert.equal(summary.session_funnel.sessions_total, 2);
    assert.equal(summary.signals.needed_run_selection, 1);
    assert.equal(summary.signals.inadequate_next_safe_action, 1);
    assert.equal(summary.promotion_hint, "review_for_v024_operator_ux");
  });

  it("cli validate passes on example file", () => {
    const result = runCohortUxFrictionLogCli([
      "node",
      "cohort-ux-friction-log.mjs",
      "validate",
      "docs/how-to/evidence/cohort-friction-log.example.jsonl",
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.reason_code, "FRICTION_LOG_OK");
  });

  it("cli append writes valid line", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "friction-log-"));
    const logFile = path.join(tmp, "log.jsonl");
    const result = runCohortUxFrictionLogCli([
      "node",
      "cohort-ux-friction-log.mjs",
      "append",
      "--file",
      logFile,
      "--entry",
      JSON.stringify(VALID_ENTRY),
    ]);
    assert.equal(result.ok, true);
    const text = fs.readFileSync(logFile, "utf8").trim();
    assert.ok(text.startsWith("{"));
    const validate = runCohortUxFrictionLogCli([
      "node",
      "cohort-ux-friction-log.mjs",
      "validate",
      logFile,
    ]);
    assert.equal(validate.ok, true);
  });
});
