/**
 * C-T2: committed SHA256 baselines for deterministic gate logic (validateOutput,
 * validateHandoffStructure). Catches accidental contract drift across CI runs.
 *
 * Refresh baselines after intentional contract changes:
 *   UPDATE_GATE_BASELINE=1 node --test tests/determinismBaseline.test.js
 */
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateOutput } = require("../agents");
const { validateHandoffStructure } = require("../orchestrator");

const FIXTURE = path.join(__dirname, "fixtures", "gate-determinism-baseline.json");

function snapValidateOutput(agentId, output, opts = {}) {
  const r = validateOutput(agentId, output, opts);
  const o = { valid: r.valid, reason: r.reason ?? "" };
  if (r.gate_id != null) o.gate_id = r.gate_id;
  return o;
}

function snapHandoff(mode, yaml, opts) {
  const r = validateHandoffStructure(mode, yaml, opts);
  return { valid: r.valid, reason: r.reason ?? "" };
}

function hashCanonical(obj) {
  const keys = Object.keys(obj).sort();
  const normalized = {};
  for (const k of keys) normalized[k] = obj[k];
  return crypto.createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

function collectCases() {
  return [
    {
      id: "vo_plan_valid",
      snap: () =>
        snapValidateOutput(
          "orchestrator",
          JSON.stringify({ steps: [{ agentId: "dev-backend", task: "fix bug" }] }),
          { phase: "plan" }
        ),
    },
    {
      id: "vo_plan_empty_steps",
      snap: () => snapValidateOutput("orchestrator", JSON.stringify({ steps: [] }), { phase: "plan" }),
    },
    {
      id: "vo_decide_done_ok",
      snap: () =>
        snapValidateOutput("orchestrator", JSON.stringify({ done: true, summary: "ok" }), { phase: "decide" }),
    },
    {
      id: "vo_dev_valid",
      snap: () =>
        snapValidateOutput(
          "dev-backend",
          "files_read:\n  - x.js\nfiles_modified:\n  - x.js\nvalidation_run: npm test"
        ),
    },
    {
      id: "vo_dev_no_files_read",
      snap: () => snapValidateOutput("dev-backend", "validation_run: npm test only"),
    },
    {
      id: "vo_qa_blocker",
      snap: () => snapValidateOutput("qa", "blocker: missing tests"),
    },
    {
      id: "vo_qa_unclassified",
      snap: () => snapValidateOutput("qa", "looks fine to me"),
    },
    {
      id: "vhs_dev_empty_strict",
      snap: () => snapHandoff("DEV", "", { strict: true }),
    },
    {
      id: "vhs_dev_empty_soft",
      snap: () => snapHandoff("DEV", "", { strict: false }),
    },
    {
      id: "vhs_dev_valid_strict",
      snap: () =>
        snapHandoff("DEV", "files_modified:\n  - a.js\nvalidation_run: pass", { strict: true }),
    },
    {
      id: "vhs_qa_invalid_strict",
      snap: () => snapHandoff("QA", "goal: only", { strict: true }),
    },
    {
      id: "vhs_cerberus_blockers_strict",
      snap: () => snapHandoff("CERBERUS", "verdict: fail\nblockers:\n  - x\n", { strict: true }),
    },
  ];
}

describe("C-T2 gate determinism baseline", () => {
  test("hashes match committed fixture (UPDATE_GATE_BASELINE=1 to refresh)", () => {
    const cases = collectCases();
    const actual = {};
    for (const c of cases) {
      actual[c.id] = hashCanonical(c.snap());
    }

    if (process.env.UPDATE_GATE_BASELINE === "1") {
      const payload = {
        schemaVersion: 1,
        description:
          "SHA256 of canonical {valid,reason,gate_id?} gate snapshots. Regenerate: UPDATE_GATE_BASELINE=1 node --test tests/determinismBaseline.test.js",
        hashes: actual,
      };
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      console.log(`[determinismBaseline] wrote ${FIXTURE}`);
      return;
    }

    assert.ok(fs.existsSync(FIXTURE), `Missing fixture ${FIXTURE} — run UPDATE_GATE_BASELINE=1`);
    const expected = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    assert.equal(expected.schemaVersion, 1, "fixture schemaVersion must be 1");
    const expHashes = expected.hashes;
    assert.ok(expHashes && typeof expHashes === "object", "fixture must contain hashes object");

    const mismatches = [];
    for (const id of Object.keys(actual)) {
      if (expHashes[id] !== actual[id]) {
        mismatches.push({ id, expected: expHashes[id], actual: actual[id] });
      }
    }
    for (const id of Object.keys(expHashes)) {
      if (!(id in actual)) mismatches.push({ id, expected: expHashes[id], actual: "(removed case)" });
    }

    assert.deepEqual(
      mismatches,
      [],
      mismatches.length
        ? `Gate baseline drift — intentional? Update fixture:\n${JSON.stringify(mismatches, null, 2)}`
        : ""
    );
  });
});
