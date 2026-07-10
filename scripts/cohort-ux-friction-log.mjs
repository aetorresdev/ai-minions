#!/usr/bin/env node
/**
 * Cohort UX discovery friction log — validate, append, summarize.
 *
 * Usage:
 *   node scripts/cohort-ux-friction-log.mjs validate <file.jsonl>
 *   node scripts/cohort-ux-friction-log.mjs append --file <file.jsonl> --entry '<json>'
 *   node scripts/cohort-ux-friction-log.mjs append --file <file.jsonl> < entry.json
 *   node scripts/cohort-ux-friction-log.mjs summarize <file.jsonl> [--json]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCHEMA_VERSION,
  parseFrictionLogLines,
  summarizeFrictionLog,
  validateFrictionEntry,
} from "./lib/cohort-ux-friction-log.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REASON_CODES = {
  OK: "FRICTION_LOG_OK",
  VALIDATION_FAILED: "FRICTION_LOG_VALIDATION_FAILED",
  FILE_READ_FAILED: "FRICTION_LOG_FILE_READ_FAILED",
  FILE_WRITE_FAILED: "FRICTION_LOG_FILE_WRITE_FAILED",
  USAGE: "FRICTION_LOG_USAGE",
};

/**
 * @param {string} filePath
 */
function readLogFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason_code: REASON_CODES.FILE_READ_FAILED, message };
  }
}

function usage() {
  return [
    "Usage:",
    "  node scripts/cohort-ux-friction-log.mjs validate <file.jsonl>",
    "  node scripts/cohort-ux-friction-log.mjs append --file <file.jsonl> --entry '<json>'",
    "  node scripts/cohort-ux-friction-log.mjs summarize <file.jsonl> [--json]",
  ].join("\n");
}

/**
 * @param {string[]} argv
 */
export function runCohortUxFrictionLogCli(argv) {
  const args = argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    return { ok: false, reason_code: REASON_CODES.USAGE, message: usage() };
  }

  if (cmd === "validate") {
    const file = args[1];
    if (!file) {
      return { ok: false, reason_code: REASON_CODES.USAGE, message: usage() };
    }
    const text = readLogFile(path.resolve(file));
    if (typeof text !== "string") {
      return text;
    }
    const parsed = parseFrictionLogLines(text);
    if (!parsed.ok) {
      return {
        ok: false,
        reason_code: REASON_CODES.VALIDATION_FAILED,
        message: parsed.errors.join("\n"),
      };
    }
    return {
      ok: true,
      reason_code: REASON_CODES.OK,
      entry_count: parsed.entries.length,
    };
  }

  if (cmd === "append") {
    let file = null;
    let entryRaw = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--file" && args[i + 1]) {
        file = args[++i];
      } else if (args[i] === "--entry" && args[i + 1]) {
        entryRaw = args[++i];
      }
    }
    if (!file) {
      return { ok: false, reason_code: REASON_CODES.USAGE, message: usage() };
    }
    if (!entryRaw) {
      entryRaw = fs.readFileSync(0, "utf8").trim();
    }
    let entry;
    try {
      entry = JSON.parse(entryRaw);
    } catch (err) {
      return {
        ok: false,
        reason_code: REASON_CODES.VALIDATION_FAILED,
        message: `invalid entry JSON: ${err instanceof Error ? err.message : "parse error"}`,
      };
    }
    const validated = validateFrictionEntry(entry);
    if (!validated.ok) {
      return {
        ok: false,
        reason_code: REASON_CODES.VALIDATION_FAILED,
        message: validated.errors.join("; "),
      };
    }
    const outPath = path.resolve(file);
    const line = `${JSON.stringify(validated.entry)}\n`;
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.appendFileSync(outPath, line, "utf8");
    } catch (err) {
      return {
        ok: false,
        reason_code: REASON_CODES.FILE_WRITE_FAILED,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    return { ok: true, reason_code: REASON_CODES.OK, file: outPath };
  }

  if (cmd === "summarize") {
    const file = args[1];
    const asJson = args.includes("--json");
    if (!file) {
      return { ok: false, reason_code: REASON_CODES.USAGE, message: usage() };
    }
    const text = readLogFile(path.resolve(file));
    if (typeof text !== "string") {
      return text;
    }
    const parsed = parseFrictionLogLines(text);
    if (!parsed.ok) {
      return {
        ok: false,
        reason_code: REASON_CODES.VALIDATION_FAILED,
        message: parsed.errors.join("\n"),
      };
    }
    const summary = summarizeFrictionLog(parsed.entries);
    if (asJson) {
      return { ok: true, reason_code: REASON_CODES.OK, summary };
    }
    const lines = [
      `entries: ${summary.entry_count} · sessions: ${summary.session_count} · testers: ${summary.tester_count}`,
      "session_funnel:",
    ];
    for (const [cmdName, row] of Object.entries(summary.session_funnel.per_stage)) {
      lines.push(
        `  ${cmdName}: sessions_attempted=${row.attempted} success=${row.success} fail=${row.fail} abandon=${row.abandon}`,
      );
    }
    for (const conv of summary.session_funnel.conversions) {
      const rate = conv.rate == null ? "n/a" : String(conv.rate);
      lines.push(
        `  conversion ${conv.from}→${conv.to}: eligible=${conv.eligible_sessions} continued=${conv.continued_sessions} success=${conv.success_sessions} rate=${rate}`,
      );
    }
    for (const drop of summary.session_funnel.drop_offs) {
      lines.push(`  drop_off after ${drop.after_stage}: sessions=${drop.sessions}`);
    }
    lines.push(
      `signals: inadequate_next_safe_action=${summary.signals.inadequate_next_safe_action} needed_run_selection=${summary.signals.needed_run_selection} missing_info=${summary.signals.missing_info_reports}`,
    );
    lines.push(`promotion_hint: ${summary.promotion_hint}`);
    return { ok: true, reason_code: REASON_CODES.OK, message: lines.join("\n"), summary };
  }

  return { ok: false, reason_code: REASON_CODES.USAGE, message: usage() };
}

function main() {
  const result = runCohortUxFrictionLogCli(process.argv);
  if (!result.ok) {
    if (result.message) {
      console.error(result.message);
    }
    if (result.reason_code) {
      console.error(`reason_code: ${result.reason_code}`);
    }
    process.exit(1);
  }
  if (result.summary && process.argv.includes("--json")) {
    console.log(JSON.stringify(result.summary, null, 2));
  } else if (result.message) {
    console.log(result.message);
  } else if (result.entry_count != null) {
    console.log(`reason_code: ${result.reason_code}`);
    console.log(`entry_count: ${result.entry_count}`);
  } else {
    console.log(`reason_code: ${result.reason_code}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
