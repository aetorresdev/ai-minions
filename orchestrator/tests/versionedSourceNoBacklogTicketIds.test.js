"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const { BACKLOG_CASE_ID_RE, LANE_ID_RE } = require("../scripts/check-doc-runtime-claims");

const ORCH_ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.join(ORCH_ROOT, "..");
const HOOKS_ROOT = path.join(REPO_ROOT, "scripts", "hooks");

const SELF = path.basename(__filename);

/** Tests that intentionally embed fixture case ids for the drift linter. */
const EXCLUDED_REL = new Set([
  "orchestrator/tests/versionedSourceNoBacklogTicketIds.test.js",
  "orchestrator/tests/docRuntimeDriftCheck.test.js",
]);

function collectFiles(root, ext) {
  /** @type {string[]} */
  const out = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(ext)) out.push(full);
    }
  }
  walk(root);
  return out.sort();
}

function findBacklogIds(text) {
  const caseHits = text.match(BACKLOG_CASE_ID_RE) || [];
  const laneHits = text.match(LANE_ID_RE) || [];
  return [...new Set([...caseHits, ...laneHits])];
}

describe("versioned source omits backlog ticket ids", () => {
  for (const filePath of collectFiles(ORCH_ROOT, ".js")) {
    const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
    if (path.basename(filePath) === SELF || EXCLUDED_REL.has(rel)) continue;
    it(`${rel} has no backlog case or lane ids`, () => {
      const hits = findBacklogIds(fs.readFileSync(filePath, "utf8"));
      assert.deepEqual(hits, [], `${rel}: ${hits.join(", ")}`);
    });
  }

  if (fs.existsSync(HOOKS_ROOT)) {
    for (const filePath of collectFiles(HOOKS_ROOT, ".py")) {
      const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
      it(`${rel} has no backlog case or lane ids`, () => {
        const hits = findBacklogIds(fs.readFileSync(filePath, "utf8"));
        assert.deepEqual(hits, [], `${rel}: ${hits.join(", ")}`);
      });
    }
  }
});
