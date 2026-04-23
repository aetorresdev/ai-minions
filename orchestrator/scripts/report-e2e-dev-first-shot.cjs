#!/usr/bin/env node
/**
 * Runs the DEV output-contract smoke with maxIterations=1 only (E2E_DEV_CONTRACT_FIRST_SHOT=1),
 * several times, and prints pass rate. Intended for CI summary / local tuning — not a substitute
 * for the default E2E lane (maxIterations=2), which proves loop recovery.
 *
 * Env:
 *   E2E_FIRST_SHOT_RUNS  — number of repetitions (default 5)
 *   OLLAMA_MODEL         — inherited from caller
 *   GITHUB_STEP_SUMMARY  — if set, appends a markdown block (GitHub Actions)
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const orchestratorRoot = path.join(__dirname, "..");
const runs = Math.max(1, parseInt(process.env.E2E_FIRST_SHOT_RUNS || "5", 10) || 5);
const node = process.execPath;

let pass = 0;

for (let i = 0; i < runs; i++) {
  const r = spawnSync(
    node,
    [
      "--test",
      "--test-concurrency=1",
      "--test-name-pattern=dev-backend passes output contract",
      "tests/e2e.test.js",
    ],
    {
      cwd: orchestratorRoot,
      env: { ...process.env, E2E_DEV_CONTRACT_FIRST_SHOT: "1" },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const ok = r.status === 0;
  if (ok) pass++;
  console.log(`[first-shot] run ${i + 1}/${runs} exit=${r.status} pass=${ok}`);
}

const rate = pass / runs;
const summary = {
  runs,
  pass,
  fail: runs - pass,
  first_shot_pass_rate: Number(rate.toFixed(4)),
};

console.log(`[first-shot] summary ${JSON.stringify(summary)}`);

const md = [
  "### DEV contract — first-shot lane (informational)",
  "",
  `- **Runs:** ${runs} (each with E2E_DEV_CONTRACT_FIRST_SHOT=1, single iteration only)`,
  `- **Pass:** ${pass} / ${runs}`,
  `- **Rate:** ${(rate * 100).toFixed(1)}%`,
  "",
  "This lane measures **first DEV attempt** contract success. It is **not** the same signal as the default E2E smoke (maxIterations: 2), which allows the loop to recover after a bad first reply.",
  "",
].join("\n");

const ghs = process.env.GITHUB_STEP_SUMMARY;
if (ghs) {
  try {
    fs.appendFileSync(ghs, `${md}\n`);
  } catch (e) {
    console.warn("[first-shot] could not append GITHUB_STEP_SUMMARY:", e.message);
  }
}

// Always exit 0 so a dedicated optional workflow step stays green while still publishing the metric.
process.exit(0);
