"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  checkVersionedSourceNoTicketIds,
  findBacklogIds,
} = require("../scripts/check-versioned-source-no-ticket-ids");

describe("versioned source omits backlog ticket ids", () => {
  it("findBacklogIds detects case ids and lane shorthand", () => {
    const hits = findBacklogIds("// release slice ref\nconst x = 'FOO-BAR-1';\n");
    assert.ok(hits.includes("FOO-BAR-1"));
  });

  it("findBacklogIds detects groomed lane pattern", () => {
    const hits = findBacklogIds("see slice E99-1 in backlog only");
    assert.ok(hits.includes("E99-1"));
  });

  it("fails on synthetic source with groomed ids", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "no-ticket-src-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "evil.js"), "// E99-1 todo\n");
    const result = checkVersionedSourceNoTicketIds({ repoRoot: tmp });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.file === "orchestrator/evil.js"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("repo versioned source paths pass DOC-NO-TICKET-SRC-1", () => {
    const result = checkVersionedSourceNoTicketIds();
    assert.equal(
      result.ok,
      true,
      result.violations.map((v) => `${v.file}: ${v.ids.join(", ")}`).join("\n"),
    );
  });
});
