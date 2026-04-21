"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { findRepoRoot, getRepoRoot, isRepoRoot } = require("../repo-root.js");

test("getRepoRoot returns a directory with hook + MCP markers", () => {
  const r = getRepoRoot();
  assert.ok(isRepoRoot(r));
  assert.ok(fs.existsSync(path.join(r, "mcp-servers", "compact-handoff", "server.py")));
});

test("findRepoRoot walks up from nested package path", () => {
  const fromTests = findRepoRoot(__dirname);
  const fromPkg = getRepoRoot();
  assert.strictEqual(fromTests, fromPkg);
});

test("invalid REPO_ROOT throws", () => {
  const prev = process.env.REPO_ROOT;
  process.env.REPO_ROOT = "/this/path/does/not/exist/for/repo/root";
  try {
    assert.throws(
      () => findRepoRoot(__dirname),
      /REPO_ROOT|invalid|missing/i
    );
  } finally {
    if (prev === undefined) {
      delete process.env.REPO_ROOT;
    } else {
      process.env.REPO_ROOT = prev;
    }
  }
});
