#!/usr/bin/env node
/**
 * Canonical real-task fixtures — structure gate + optional artifact validation.
 * Does not print secret values. Does not invent hybrid runtime.
 *
 * Usage:
 *   node scripts/verify-canonical-real-task-fixtures.mjs [--json]
 *   node scripts/verify-canonical-real-task-fixtures.mjs --artifact <path> --fixture <id> [--json]
 *   node scripts/verify-canonical-real-task-fixtures.mjs --print-prompt <id>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIXTURE_SCHEMA_VERSION,
  REAL_TASK_FIXTURES,
  REASON_CODES,
  getFixture,
  getFixturePrompt,
  validateFixtureArtifact,
  validateFixtureData,
  validateFixtureDoc,
} from "./lib/canonical-real-task-fixtures-data.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ json: boolean, artifact: string | null, fixture: string | null, printPrompt: string | null, help?: boolean }} */
  const out = {
    json: false,
    artifact: null,
    fixture: null,
    printPrompt: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--artifact") out.artifact = argv[++i] ?? null;
    else if (a === "--fixture") out.fixture = argv[++i] ?? null;
    else if (a === "--print-prompt") out.printPrompt = argv[++i] ?? null;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

/**
 * @param {{
 *   repoRoot?: string,
 *   artifactPath?: string | null,
 *   fixtureId?: string | null,
 * }} [options]
 */
export function runCanonicalFixtureVerify(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const docPath = path.join(repoRoot, "docs/how-to/canonical-real-task-fixtures.md");
  const samplePath = path.join(
    repoRoot,
    "tests/fixtures/canonical-tasks/sudoku-html-app.sample.html",
  );

  /** @type {{ id: string, reason_code: string, status: 'pass' | 'fail', message: string }[]} */
  const steps = [];

  const dataCheck = validateFixtureData();
  steps.push({
    id: "fixture_data",
    reason_code: dataCheck.ok ? REASON_CODES.OK : REASON_CODES.DATA_FAIL,
    status: dataCheck.ok ? "pass" : "fail",
    message: dataCheck.ok
      ? `${REAL_TASK_FIXTURES.length} fixtures (schema v${FIXTURE_SCHEMA_VERSION})`
      : dataCheck.errors.join("; "),
  });

  const docText = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
  const docCheck = validateFixtureDoc(docText);
  steps.push({
    id: "fixture_doc",
    reason_code: docCheck.ok ? REASON_CODES.OK : REASON_CODES.DOC_FAIL,
    status: docCheck.ok ? "pass" : "fail",
    message: docCheck.ok
      ? "canonical-real-task-fixtures.md markers + prompts match"
      : docCheck.errors.join("; "),
  });

  if (fs.existsSync(samplePath)) {
    const sampleHtml = fs.readFileSync(samplePath, "utf8");
    const sudoku = getFixture("sudoku-html-app");
    const sampleCheck = sudoku
      ? validateFixtureArtifact(sudoku, sampleHtml)
      : { ok: false, errors: ["sudoku-html-app missing"] };
    steps.push({
      id: "sample_sudoku_artifact",
      reason_code: sampleCheck.ok ? REASON_CODES.OK : REASON_CODES.ARTIFACT_FAIL,
      status: sampleCheck.ok ? "pass" : "fail",
      message: sampleCheck.ok
        ? "shipped sudoku sample passes functional checks"
        : sampleCheck.errors.join("; "),
    });
  } else {
    steps.push({
      id: "sample_sudoku_artifact",
      reason_code: REASON_CODES.ARTIFACT_FAIL,
      status: "fail",
      message: `missing sample: ${path.relative(repoRoot, samplePath)}`,
    });
  }

  if (options.artifactPath) {
    const fixtureId = options.fixtureId || "sudoku-html-app";
    const fixture = getFixture(fixtureId);
    if (!fixture) {
      steps.push({
        id: "artifact",
        reason_code: REASON_CODES.ARTIFACT_FAIL,
        status: "fail",
        message: `unknown fixture id: ${fixtureId}`,
      });
    } else if (!fs.existsSync(options.artifactPath)) {
      steps.push({
        id: "artifact",
        reason_code: REASON_CODES.ARTIFACT_FAIL,
        status: "fail",
        message: `artifact not found: ${options.artifactPath}`,
      });
    } else {
      const html = fs.readFileSync(options.artifactPath, "utf8");
      const result = validateFixtureArtifact(fixture, html);
      steps.push({
        id: "artifact",
        reason_code: result.ok ? REASON_CODES.OK : REASON_CODES.ARTIFACT_FAIL,
        status: result.ok ? "pass" : "fail",
        message: result.ok
          ? `${fixtureId} artifact functional checks passed`
          : result.errors.join("; "),
      });
    }
  }

  const ok = steps.every((s) => s.status === "pass");
  return {
    ok,
    schema_version: FIXTURE_SCHEMA_VERSION,
    fixture_ids: REAL_TASK_FIXTURES.map((f) => f.id),
    steps,
  };
}

/**
 * @param {ReturnType<typeof runCanonicalFixtureVerify>} report
 */
export function formatReportText(report) {
  const lines = [
    `canonical-real-task-fixtures: ${report.ok ? "OK" : "FAIL"}`,
    `schema_version: ${report.schema_version}`,
    `fixtures: ${report.fixture_ids.join(", ")}`,
  ];
  for (const step of report.steps) {
    lines.push(`  [${step.status}] ${step.id} ${step.reason_code} — ${step.message}`);
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      [
        "Usage:",
        "  node scripts/verify-canonical-real-task-fixtures.mjs [--json]",
        "  node scripts/verify-canonical-real-task-fixtures.mjs --artifact <path> --fixture <id> [--json]",
        "  node scripts/verify-canonical-real-task-fixtures.mjs --print-prompt <id>",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  if (args.printPrompt) {
    try {
      process.stdout.write(`${getFixturePrompt(args.printPrompt)}\n`);
      process.exit(0);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  }

  const report = runCanonicalFixtureVerify({
    artifactPath: args.artifact,
    fixtureId: args.fixture,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReportText(report)}\n`);
  }

  if (!report.ok) {
    for (const step of report.steps.filter((s) => s.status === "fail")) {
      process.stderr.write(`blocker: ${step.reason_code}\n`);
    }
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
