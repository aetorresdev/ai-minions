"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const {
  runRootImportGuard,
  ORCH_ROOT,
  SHIM_HEADER_RE,
} = require("../scripts/check-root-import-guard");

describe("root-import-guard", () => {
  it("current orchestrator root passes allowlist", () => {
    const violations = runRootImportGuard();
    assert.deepEqual(violations, [], violations.map((v) => `${v.file} ${v.rule}`).join("; "));
  });

  it("shim header regex matches compat shims", () => {
    const sample = "'use strict';\n/** @deprecated Import from `modules/trace/trace-schema` — compat shim. */\n";
    assert.match(sample, SHIM_HEADER_RE);
  });

  it("detects unallowlisted new root runtime file", () => {
    const probe = path.join(ORCH_ROOT, "__root_import_probe__.js");
    fs.writeFileSync(probe, "'use strict';\nmodule.exports = {};\n");
    try {
      const violations = runRootImportGuard();
      const probeHits = violations.filter((v) => v.file === "__root_import_probe__.js");
      assert.equal(probeHits.length, 1);
      assert.equal(probeHits[0].rule, "root_file_not_allowlisted");
    } finally {
      fs.unlinkSync(probe);
    }
  });

  it("detects shim allowlist entry without compat header", () => {
    const probe = path.join(ORCH_ROOT, "__root_import_shim_probe__.js");
    fs.writeFileSync(probe, "'use strict';\nmodule.exports = {};\n");
    try {
      const violations = runRootImportGuard(
        { "__root_import_shim_probe__.js": "shim" },
        ["__root_import_shim_probe__.js"],
      );
      assert.equal(violations.length, 1);
      assert.equal(violations[0].rule, "shim_header_missing");
    } finally {
      fs.unlinkSync(probe);
    }
  });

  it("allows documented entrypoints without shim header", () => {
    const violations = runRootImportGuard(
      { "cli.js": "entrypoint", "run-orchestrator.js": "entrypoint" },
      ["cli.js", "run-orchestrator.js"],
    );
    assert.deepEqual(violations, []);
  });
});
