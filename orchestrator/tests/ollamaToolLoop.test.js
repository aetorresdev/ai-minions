"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { runOllama, runOllamaWithTools } = require("../modules/model-runtime/run-ollama");
const {
  toolDefsForAgent,
  toolNamesForAgent,
  resolveConfinedPath,
  executeOllamaTool,
  MAX_READ_BYTES,
} = require("../modules/model-runtime/ollama-tools");

function startMockOllama(handler) {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/chat" && req.method === "POST") {
      let data = "";
      req.on("data", (c) => { data += c; });
      req.on("end", () => {
        const body = JSON.parse(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(handler(body)));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve(server)));
  });
}

describe("ollama-tools executors", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-tools-"));
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "hello", "utf8");
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("read_file reads a file inside cwd", () => {
    const out = executeOllamaTool("read_file", { path: "a.txt" }, { cwd: tmpDir });
    assert.equal(out.ok, true);
    assert.equal(out.output, "hello");
  });

  it("write_file writes inside cwd and creates parents", () => {
    const out = executeOllamaTool("write_file", { path: "sub/b.txt", content: "xyz" }, { cwd: tmpDir });
    assert.equal(out.ok, true);
    assert.match(out.output, /^ok: wrote 3 bytes/);
    assert.equal(fs.readFileSync(path.join(tmpDir, "sub", "b.txt"), "utf8"), "xyz");
  });

  it("rejects absolute paths outside cwd", () => {
    const out = executeOllamaTool("read_file", { path: "/etc/passwd" }, { cwd: tmpDir });
    assert.equal(out.ok, false);
    assert.match(out.output, /^error: absolute path outside working directory/);
  });

  it("rejects .. escapes", () => {
    const out = executeOllamaTool("write_file", { path: "../evil.txt", content: "x" }, { cwd: tmpDir });
    assert.equal(out.ok, false);
    assert.match(out.output, /^error: path escapes working directory/);
  });

  it("rejects symlink escapes", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-tools-out-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "s3cret", "utf8");
      fs.symlinkSync(outside, path.join(tmpDir, "link"));
      const out = executeOllamaTool("read_file", { path: "link/secret.txt" }, { cwd: tmpDir });
      assert.equal(out.ok, false);
      assert.match(out.output, /^error:/);
      assert.equal(resolveConfinedPath(tmpDir, "link/secret.txt").ok, false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepts a cwd reached through a symlink (macOS tmpdir shape)", () => {
    // macOS: os.tmpdir() → /var/folders/... (symlink to /private/var/...).
    // Containment must compare realpath vs realpath, not the lexical root.
    const realDir = fs.realpathSync(tmpDir);
    const alias = path.join(os.tmpdir(), `ollama-tools-alias-${process.pid}`);
    fs.symlinkSync(realDir, alias);
    try {
      const out = executeOllamaTool("read_file", { path: "a.txt" }, { cwd: alias });
      assert.equal(out.ok, true);
      assert.equal(out.output, "hello");
      const wr = executeOllamaTool("write_file", { path: "sub/c.txt", content: "z" }, { cwd: alias });
      assert.equal(wr.ok, true);
      assert.equal(fs.readFileSync(path.join(tmpDir, "sub", "c.txt"), "utf8"), "z");
      // Escape protection still applies through the alias.
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-tools-out2-"));
      try {
        fs.writeFileSync(path.join(outside, "secret.txt"), "s3cret", "utf8");
        fs.symlinkSync(outside, path.join(tmpDir, "link2"));
        const esc = executeOllamaTool("read_file", { path: "link2/secret.txt" }, { cwd: alias });
        assert.equal(esc.ok, false);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    } finally {
      fs.unlinkSync(alias); // symlink, not a real dir — rmSync would follow it
    }
  });

  it("truncates large reads", () => {
    fs.writeFileSync(path.join(tmpDir, "big.txt"), "x".repeat(MAX_READ_BYTES + 100), "utf8");
    const out = executeOllamaTool("read_file", { path: "big.txt" }, { cwd: tmpDir });
    assert.equal(out.ok, true);
    assert.match(out.output, /\[truncated: showing first/);
  });

  it("bounded read never buffers the whole file (fd + hard byte cap)", () => {
    fs.writeFileSync(path.join(tmpDir, "huge.txt"), "x".repeat(MAX_READ_BYTES * 4), "utf8");

    const origReadSync = fs.readSync;
    const origReadFileSync = fs.readFileSync;
    /** @type {number[]} */
    const requestedLengths = [];
    let readFileSyncCalls = 0;
    fs.readSync = function (fd, buffer, offset, length, _position) {
      requestedLengths.push(length);
      return origReadSync.apply(fs, arguments);
    };
    fs.readFileSync = function () {
      readFileSyncCalls++;
      return origReadFileSync.apply(fs, arguments);
    };
    try {
      const out = executeOllamaTool("read_file", { path: "huge.txt" }, { cwd: tmpDir });
      assert.match(out.output, /\[truncated: showing first/);
    } finally {
      fs.readSync = origReadSync;
      fs.readFileSync = origReadFileSync;
    }

    assert.equal(readFileSyncCalls, 0, "read path must not use fs.readFileSync");
    assert.ok(requestedLengths.length > 0, "readSync was used");
    for (const len of requestedLengths) {
      assert.ok(
        len <= MAX_READ_BYTES + 1,
        `readSync requested ${len} bytes > cap ${MAX_READ_BYTES + 1}`,
      );
    }
  });

  it("unknown tool returns error string, never throws", () => {
    const out = executeOllamaTool("rm_rf", {}, { cwd: tmpDir });
    assert.equal(out.ok, false);
    assert.match(out.output, /^error: unknown tool/);
  });

  it("role tool grants: dev rw, qa/cerberus read-only, orchestrator none", () => {
    assert.deepEqual(toolNamesForAgent("dev-frontend"), ["read_file", "write_file"]);
    assert.deepEqual(toolNamesForAgent("qa"), ["read_file"]);
    assert.deepEqual(toolNamesForAgent("cerberus"), ["read_file"]);
    assert.deepEqual(toolNamesForAgent("orchestrator"), []);
    assert.equal(toolDefsForAgent("qa").length, 1);
  });
});

describe("runOllamaWithTools loop", () => {
  let server;
  let tmpDir;
  let savedEnv;
  /** @type {object[]} */
  let bodies;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-loop-"));
    fs.writeFileSync(path.join(tmpDir, "sudoku.html"), "<html>sudoku</html>", "utf8");
    savedEnv = {
      ORCH_SKIP_NETWORK_PERMISSION_GATE: process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE,
      OLLAMA_HOST: process.env.OLLAMA_HOST,
      OLLAMA_PORT: process.env.OLLAMA_PORT,
    };
    process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
    bodies = [];
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    if (server) await new Promise((r) => server.close(r));
    server = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function bindServer(handler) {
    return startMockOllama((body) => {
      bodies.push(body);
      return handler(body);
    }).then((s) => {
      server = s;
      process.env.OLLAMA_HOST = "127.0.0.1";
      process.env.OLLAMA_PORT = String(s.address().port);
    });
  }

  it("sends tools schema and executes read_file round-trip", async () => {
    await bindServer((body) => {
      if (body.messages.length === 2) {
        return {
          message: {
            content: "",
            tool_calls: [{ function: { name: "read_file", arguments: { path: "sudoku.html" } } }],
          },
          done_reason: "stop",
          eval_count: 12,
        };
      }
      return { message: { content: "findings: improvement none" }, done_reason: "stop", eval_count: 8 };
    });

    const defs = toolDefsForAgent("qa");
    const out = await runOllamaWithTools("sys", [{ role: "user", content: "review it" }], {
      model: "m", cwd: tmpDir, tools: defs, traceRole: "QA",
    });

    assert.deepEqual(bodies[0].tools, defs);
    assert.equal(out.content, "findings: improvement none");
    assert.equal(out.tool_rounds, 1);
    assert.equal(out.tools_used.length, 1);
    assert.equal(out.tools_used[0].name, "read_file");

    const toolMsg = bodies[1].messages.find((m) => m.role === "tool");
    assert.ok(toolMsg, "tool result message present in second request");
    assert.match(toolMsg.content, /sudoku/);
  });

  it("continuation request uses canonical Ollama tool message format", async () => {
    await bindServer((body) => {
      if (body.messages.length === 2) {
        return {
          message: {
            content: "",
            tool_calls: [{ function: { name: "read_file", arguments: { path: "sudoku.html" } } }],
          },
          done_reason: "stop",
        };
      }
      return { message: { content: "done" }, done_reason: "stop" };
    });

    await runOllamaWithTools("sys", [{ role: "user", content: "review it" }], {
      model: "m", cwd: tmpDir, tools: toolDefsForAgent("qa"), traceRole: "QA",
    });

    const assistantMsg = bodies[1].messages.find((m) => m.role === "assistant");
    assert.ok(assistantMsg, "assistant tool_call message preserved");
    assert.ok(Array.isArray(assistantMsg.tool_calls), "assistant keeps tool_calls array");
    assert.equal(assistantMsg.tool_calls[0].type, "function");
    assert.equal(assistantMsg.tool_calls[0].function.name, "read_file");
    assert.deepEqual(assistantMsg.tool_calls[0].function.arguments, { path: "sudoku.html" });

    const toolMsg = bodies[1].messages.find((m) => m.role === "tool");
    assert.equal(toolMsg.tool_name, "read_file");
    assert.equal(typeof toolMsg.content, "string");
    assert.ok(!("name" in toolMsg), "tool result uses tool_name, not name");
  });

  it("rejects tool calls not granted to the role (qa cannot write_file)", async () => {
    await bindServer((body) => {
      if (body.messages.length === 2) {
        return {
          message: {
            content: "",
            // Fabricated call: qa was only granted read_file.
            tool_calls: [{ function: { name: "write_file", arguments: { path: "evil.txt", content: "pwn" } } }],
          },
          done_reason: "stop",
        };
      }
      return { message: { content: "understood" }, done_reason: "stop" };
    });

    const out = await runOllamaWithTools("sys", [{ role: "user", content: "x" }], {
      model: "m", cwd: tmpDir, tools: toolDefsForAgent("qa"), traceRole: "QA",
    });

    assert.equal(fs.existsSync(path.join(tmpDir, "evil.txt")), false, "write_file must not execute for qa");
    const toolMsg = bodies[1].messages.find((m) => m.role === "tool");
    assert.match(toolMsg.content, /^error: tool not allowed for this agent: write_file/);
    assert.equal(out.tools_used[0].allowed, false);
  });

  it("write_file through the loop materializes the artifact", async () => {
    await bindServer((body) => {
      if (body.messages.length === 2) {
        return {
          message: {
            content: "",
            tool_calls: [{ function: { name: "write_file", arguments: { path: "out/app.html", content: "<html>app</html>" } } }],
          },
          done_reason: "stop",
        };
      }
      return { message: { content: "files_modified:\n  - out/app.html\nfiles_read:\n  - out/app.html\nvalidation_run: none" }, done_reason: "stop" };
    });

    const out = await runOllamaWithTools("sys", [{ role: "user", content: "build it" }], {
      model: "m", cwd: tmpDir, tools: toolDefsForAgent("dev-frontend"), traceRole: "DEV",
    });

    assert.equal(fs.readFileSync(path.join(tmpDir, "out", "app.html"), "utf8"), "<html>app</html>");
    assert.match(out.content, /files_modified/);
  });

  it("feeds executor errors back instead of throwing", async () => {
    await bindServer((body) => {
      if (body.messages.length === 2) {
        return {
          message: {
            content: "",
            tool_calls: [{ function: { name: "read_file", arguments: { path: "/etc/passwd" } } }],
          },
          done_reason: "stop",
        };
      }
      return { message: { content: "blocked path rejected" }, done_reason: "stop" };
    });

    const out = await runOllamaWithTools("sys", [{ role: "user", content: "x" }], {
      model: "m", cwd: tmpDir, tools: toolDefsForAgent("qa"), traceRole: "QA",
    });
    const toolMsg = bodies[1].messages.find((m) => m.role === "tool");
    assert.match(toolMsg.content, /^error: absolute path outside working directory/);
    assert.equal(out.content, "blocked path rejected");
    assert.equal(out.tools_used[0].allowed, true);
    assert.equal(out.tools_used[0].succeeded, false, "executor error must surface as succeeded=false");
  });

  it("caps loop at maxToolRounds", async () => {
    await bindServer(() => ({
      message: {
        content: "",
        tool_calls: [{ function: { name: "read_file", arguments: { path: "sudoku.html" } } }],
      },
      done_reason: "stop",
    }));

    const out = await runOllamaWithTools("sys", [{ role: "user", content: "x" }], {
      model: "m", cwd: tmpDir, tools: toolDefsForAgent("qa"), traceRole: "QA", maxToolRounds: 3,
    });
    assert.equal(out.tool_rounds, 3);
    assert.equal(bodies.length, 4);
  });

  it("plain runOllama still works without tools and returns empty tool_calls", async () => {
    await bindServer(() => ({ message: { content: "ok" }, done_reason: "stop" }));
    const out = await runOllama("sys", [{ role: "user", content: "x" }], { model: "m", cwd: tmpDir });
    assert.equal(out.content, "ok");
    assert.deepEqual(out.tool_calls, []);
  });
});

describe("askAgent local tool path", () => {
  let tmpDir;
  let agents;
  let ollamaRuntime;
  let original;
  const savedEnv = {};

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-agents-"));
    for (const k of ["ORCH_MODEL_MODE", "OLLAMA_MODEL"]) {
      savedEnv[k] = process.env[k];
    }
    process.env.ORCH_MODEL_MODE = "local_only";
    process.env.OLLAMA_MODEL = "stub-model";
    ollamaRuntime = require("../modules/model-runtime/run-ollama");
    original = ollamaRuntime.runOllamaWithTools;
    agents = require("../modules/shared/agents");
  });

  afterEach(() => {
    ollamaRuntime.runOllamaWithTools = original;
    for (const k of ["ORCH_MODEL_MODE", "OLLAMA_MODEL"]) {
      if (savedEnv[k] == null) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("tool note leads the system prompt for tool-capable roles", async () => {
    let seenSystem = "";
    ollamaRuntime.runOllamaWithTools = async (systemPrompt) => {
      seenSystem = systemPrompt;
      return { content: "files_read:\n  - a.js\nfiles_modified:\n  - a.js\nvalidation_run: none", tools_used: [], tool_calls: [] };
    };
    await agents.askAgent("dev-frontend", "Create a.js", { cwd: tmpDir });
    assert.match(seenSystem, /^## FILE TOOLS AVAILABLE/);
    assert.match(seenSystem, /Never claim you read or wrote a file without an actual tool call/);
  });

  it("retries once with a compact prompt when the model returns empty content and no tool calls", async () => {
    const calls = [];
    ollamaRuntime.runOllamaWithTools = async (_sys, messages) => {
      calls.push(messages[messages.length - 1].content);
      if (calls.length === 1) return { content: "", tool_calls: [], tools_used: [] };
      return { content: "files_read:\n  - a.js\nfiles_modified:\n  - a.js\nvalidation_run: none", tool_calls: [], tools_used: [] };
    };
    const { output, context_stats } = await agents.askAgent("dev-frontend", "Your task:\nCreate a.js", { cwd: tmpDir });
    assert.equal(calls.length, 2);
    assert.match(calls[1], new RegExp(`Working directory: ${tmpDir.replace(/[/\\]/g, "\\$&")}`));
    assert.match(output, /files_read/);
    assert.equal(context_stats.ollama_retried_after_empty, 1);
  });

  it("does not retry when the first reply already has content or tool calls", async () => {
    let calls = 0;
    ollamaRuntime.runOllamaWithTools = async () => {
      calls += 1;
      return { content: "files_read:\n  - a.js\nfiles_modified:\n  - a.js\nvalidation_run: none", tool_calls: [], tools_used: [] };
    };
    const { context_stats } = await agents.askAgent("dev-frontend", "Create a.js", { cwd: tmpDir });
    assert.equal(calls, 1);
    assert.equal(context_stats.ollama_retried_after_empty, undefined);
  });

  it("dev contract passes when files were actually written via write_file (YAML contract missing)", async () => {
    ollamaRuntime.runOllamaWithTools = async () => ({
      content: "Created the page with an inline grid and actions.",
      tool_calls: [],
      tools_used: [
        { name: "write_file", args: { path: "sudoku.html" }, allowed: true, succeeded: true },
        { name: "write_file", args: { path: "sudoku.html" }, allowed: true, succeeded: true },
      ],
    });
    const { output } = await agents.askAgent("dev-frontend", "Create sudoku.html", { cwd: tmpDir });
    assert.match(output, /files_read:\n {2}- sudoku\.html/);
    assert.match(output, /files_modified:\n {2}- sudoku\.html/);
    assert.match(output, /validation_run: write_file tool executed \(1 file\(s\)\)/);
  });

  it("dev contract still fails when no file was actually written", async () => {
    ollamaRuntime.runOllamaWithTools = async () => ({
      content: "I would create sudoku.html now.",
      tool_calls: [],
      tools_used: [{ name: "read_file", args: { path: "sudoku.html" }, allowed: true, succeeded: true }],
    });
    await assert.rejects(
      () => agents.askAgent("dev-frontend", "Create sudoku.html", { cwd: tmpDir }),
      /\[output contract\]/,
    );
  });

  it("allowed-but-failed write_file does NOT trigger the contract bypass", async () => {
    // Executor rejected the write (escape/oversize/IO) — allowed but not succeeded.
    ollamaRuntime.runOllamaWithTools = async () => ({
      content: "I wrote sudoku.html for you.",
      tool_calls: [],
      tools_used: [
        { name: "write_file", args: { path: "../sudoku.html" }, allowed: true, succeeded: false },
      ],
    });
    await assert.rejects(
      () => agents.askAgent("dev-frontend", "Create sudoku.html", { cwd: tmpDir }),
      /\[output contract\]/,
    );
  });

  it("unallowed write_file does NOT trigger the contract bypass", async () => {
    ollamaRuntime.runOllamaWithTools = async () => ({
      content: "I wrote sudoku.html for you.",
      tool_calls: [],
      tools_used: [
        { name: "write_file", args: { path: "sudoku.html" }, allowed: false, succeeded: false },
      ],
    });
    await assert.rejects(
      () => agents.askAgent("dev-frontend", "Create sudoku.html", { cwd: tmpDir }),
      /\[output contract\]/,
    );
  });

  it("failed compact retry is traced: exactly two calls and ollama_retried_after_empty=1 on the error", async () => {
    let calls = 0;
    ollamaRuntime.runOllamaWithTools = async () => {
      calls += 1;
      return { content: "", tool_calls: [], tools_used: [] };
    };
    let caught = null;
    try {
      await agents.askAgent("dev-frontend", "Your task:\nCreate a.js", { cwd: tmpDir });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected contract failure");
    assert.equal(calls, 2, "first attempt + exactly one compact retry");
    assert.match(caught.message, /\[output contract\]/);
    assert.equal(caught.context_stats?.ollama_retried_after_empty, 1);
  });

  it("retry that throws (timeout/HTTP) still carries ollama_retried_after_empty=1", async () => {
    let calls = 0;
    ollamaRuntime.runOllamaWithTools = async () => {
      calls += 1;
      if (calls === 1) return { content: "", tool_calls: [], tools_used: [] };
      const err = new Error("Ollama HTTP 502");
      err.context_stats = { ollama_prompt_tokens: 3 };
      throw err;
    };
    let caught = null;
    try {
      await agents.askAgent("dev-frontend", "Your task:\nCreate a.js", { cwd: tmpDir });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected thrown error from retry");
    assert.equal(calls, 2);
    assert.match(caught.message, /Ollama HTTP 502/);
    assert.equal(caught.context_stats?.ollama_retried_after_empty, 1);
    assert.equal(caught.context_stats?.ollama_prompt_tokens, 3, "prior stats preserved");
  });

  it("qa never gets write_file bypass — classification contract still enforced", async () => {
    ollamaRuntime.runOllamaWithTools = async () => ({
      content: "Looks fine.",
      tool_calls: [],
      tools_used: [{ name: "read_file", args: { path: "sudoku.html" }, allowed: true }],
    });
    await assert.rejects(
      () => agents.askAgent("qa", "Verify sudoku.html", { cwd: tmpDir, phase: "verify" }),
      /classify at least one finding/,
    );
  });
});
