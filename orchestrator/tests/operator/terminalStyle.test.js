"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const {
  resolveColorMode,
  shouldUseAnsi,
  resolveUseColorForCli,
  ansi,
  formatStatusTag,
} = require("../../modules/operator/terminal-style");
const { runOperatorStatus } = require("../../modules/operator/operator-trace-command");
const { printAiMinionsCliHelp } = require("../../modules/operator/operator-cli-help");

const CLI_PATH = path.join(__dirname, "..", "..", "ai-minions-cli.js");
const ORCH_CWD = path.join(__dirname, "..", "..");
const FIXTURE = path.join(__dirname, "..", "fixtures", "operator-trace-summary", "blocked.v1.jsonl");

describe("terminal-style policy", () => {
  it("NO_COLOR wins over --color=always", () => {
    assert.equal(resolveColorMode(["--color=always"], { NO_COLOR: "1" }), "never");
    assert.equal(
      resolveUseColorForCli(["--color=always"], { env: { NO_COLOR: "1" }, isTTY: true }),
      false,
    );
  });

  it("auto is off when not a TTY; always forces on", () => {
    assert.equal(shouldUseAnsi("auto", false), false);
    assert.equal(shouldUseAnsi("always", false), true);
    assert.equal(shouldUseAnsi("never", true), false);
  });

  it("--json disables color even with --color=always", () => {
    assert.equal(
      resolveUseColorForCli(["--color=always", "--json"], { json: true, isTTY: true, env: {} }),
      false,
    );
  });

  it("formatStatusTag emits ANSI only when useColor", () => {
    assert.equal(formatStatusTag("pass", false), "[PASS]");
    assert.ok(formatStatusTag("fail", true).includes("\x1b["));
    assert.equal(ansi(false, "31", "x"), "x");
  });
});

describe("operator status/explain color surfaces", () => {
  it("status --color=always includes ANSI; --json does not", () => {
    const env = { ...process.env };
    delete env.NO_COLOR;
    const color = spawnSync(
      process.execPath,
      [CLI_PATH, "status", "--file", FIXTURE, "--color=always"],
      { encoding: "utf8", cwd: ORCH_CWD, env },
    );
    assert.equal(color.status, 0, color.stderr || color.stdout);
    assert.ok(color.stdout.includes("\x1b["), "expected ANSI in status stdout");

    const json = spawnSync(
      process.execPath,
      [CLI_PATH, "status", "--file", FIXTURE, "--json", "--color=always"],
      { encoding: "utf8", cwd: ORCH_CWD, env },
    );
    assert.equal(json.status, 0, json.stderr || json.stdout);
    assert.equal(json.stdout.includes("\x1b["), false, "JSON must stay plain");
  });

  it("NO_COLOR strips ANSI from status even with --color=always", () => {
    const r = spawnSync(
      process.execPath,
      [CLI_PATH, "status", "--file", FIXTURE, "--color=always"],
      { encoding: "utf8", cwd: ORCH_CWD, env: { ...process.env, NO_COLOR: "1" } },
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.equal(r.stdout.includes("\x1b["), false);
  });

  it("runOperatorStatus respects useColor flag", () => {
    const plain = runOperatorStatus({ filePath: FIXTURE, useColor: false });
    assert.equal(plain.ok, true);
    assert.equal(plain.text.includes("\x1b["), false);
    const withColor = runOperatorStatus({ filePath: FIXTURE, useColor: true });
    assert.ok(withColor.text.includes("\x1b["));
  });
});

describe("help color", () => {
  it("help --color=always includes ANSI", () => {
    const env = { ...process.env };
    delete env.NO_COLOR;
    const r = spawnSync(process.execPath, [CLI_PATH, "--help", "--color=always"], {
      encoding: "utf8",
      cwd: ORCH_CWD,
      env,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.ok(r.stdout.includes("\x1b["));
    assert.match(r.stdout, /--color auto\|always\|never/);
  });

  it("printAiMinionsCliHelp plain has no ANSI", () => {
    let out = "";
    const orig = console.log;
    console.log = (...args) => {
      out += args.join(" ") + "\n";
    };
    try {
      printAiMinionsCliHelp({ useColor: false });
    } finally {
      console.log = orig;
    }
    assert.equal(out.includes("\x1b["), false);
  });
});
