"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RUNNER = path.join(__dirname, "..", "..", "run-orchestrator.js");

function runHelp(extraArgs = []) {
  return spawnSync(process.execPath, [RUNNER, "--help", ...extraArgs], {
    encoding: "utf8",
    cwd: path.join(__dirname, "..", ".."),
  });
}

test("run-orchestrator --help exits 0 and documents command groups", () => {
  const r = runHelp();
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = r.stdout;
  assert.match(out, /Command groups/);
  assert.match(out, /run\s+node run-orchestrator/);
  assert.match(out, /explain\s+npm run explain-run/);
  assert.match(out, /launch\s+npm run runner:tui/);
  assert.match(out, /operator-guided-run\.md/);
  assert.match(out, /preflight.*run.*status/s);
  assert.match(out, /Runner exit codes/);
  assert.match(out, /worktree create\|remove\|list\|status\|contract\|promote/);
  assert.match(out, /metrics\s+npm run metrics:export-scenarios/);
  assert.match(out, /dashboard npm run dashboard:console/);
  assert.match(out, /QA_SPEC \/ QA_EXEC/);
  assert.match(out, /report\s+npm run tokens:report/);
  assert.match(out, /validate\s+npm test/);
  assert.match(out, /resume\s+Not implemented/);
  assert.match(out, /--skip-gates/);
  assert.match(out, /ORCH_TRACES_DIR/);
  assert.match(out, /ORCH_SKILL_REGISTRY_ENFORCE/);
  assert.match(out, /skill-registry-contract\.md/);
  assert.match(out, /usage-smoke-guide\.md/);
  assert.match(out, /operator-slash-commands\.md/);
  assert.doesNotMatch(out, /production-ready/i);
});

test("run-orchestrator -h matches --help", () => {
  const a = spawnSync(process.execPath, [RUNNER, "-h"], { encoding: "utf8", cwd: path.join(__dirname, "..", "..") });
  const b = runHelp();
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  assert.equal(a.stdout, b.stdout);
});

test("run-orchestrator without goal exits 1 and points to --help", () => {
  const r = spawnSync(process.execPath, [RUNNER], {
    encoding: "utf8",
    cwd: path.join(__dirname, "..", ".."),
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--help/);
});

test("run-orchestrator exits 2 for invalid minions.md in --cwd", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minions-invalid-"));
  fs.writeFileSync(path.join(tmp, "minions.md"), "```json\n{ bad json\n```", "utf8");

  const r = spawnSync(process.execPath, [RUNNER, "--cwd", tmp, "Smoke"], {
    encoding: "utf8",
    cwd: path.join(__dirname, "..", ".."),
  });

  assert.equal(r.status, 2);
  assert.match(r.stderr, /minions\.md/);
});
