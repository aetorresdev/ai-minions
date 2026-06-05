"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const RUN_PHASES_DIR = path.join(__dirname, "..", "run-phases");

/** Locked manifest — update only with intentional phase additions. */
const PHASE_MANIFEST = [
  { file: "phase-context.js", exports: ["createPhaseContext"] },
  { file: "phase-deps.js", exports: [
    "buildGateHandlingDeps",
    "flattenGateHandlingDeps",
    "buildIterationFinalizationDeps",
    "flattenIterationFinalizationDeps",
    "buildSessionEndDeps",
    "flattenSessionEndDeps",
  ] },
  { file: "session-start.js", exports: ["executeSessionStartPhase"] },
  { file: "plan-resolution.js", exports: ["executePlanResolutionPhase"] },
  { file: "step-execution.js", exports: ["executeStepAgentInvocation"] },
  { file: "gate-handling.js", exports: ["executeGateHandlingPhase"] },
  { file: "iteration-finalization.js", exports: ["finalizeStepArtifact", "executeIterationFinalizationPhase"] },
  { file: "session-end.js", exports: ["executeSessionEndPhase"] },
];

describe("run-phases manifest", () => {
  it("lists every file in run-phases/ (no drift)", () => {
    const onDisk = fs.readdirSync(RUN_PHASES_DIR).filter((f) => f.endsWith(".js")).sort();
    const expected = PHASE_MANIFEST.map((e) => e.file).sort();
    assert.deepEqual(onDisk, expected, `run-phases/ files changed — update PHASE_MANIFEST in ${path.basename(__filename)}`);
  });

  for (const entry of PHASE_MANIFEST) {
    it(`${entry.file} exports ${entry.exports.join(", ")}`, () => {
      const mod = require(path.join(RUN_PHASES_DIR, entry.file));
      for (const name of entry.exports) {
        assert.equal(typeof mod[name], "function", `${entry.file} must export function ${name}`);
      }
      const extra = Object.keys(mod).filter((k) => !entry.exports.includes(k));
      assert.deepEqual(extra, [], `${entry.file} has unexpected exports: ${extra.join(", ")}`);
    });
  }
});
