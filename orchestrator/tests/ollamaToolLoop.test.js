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
    assert.equal(out, "hello");
  });

  it("write_file writes inside cwd and creates parents", () => {
    const out = executeOllamaTool("write_file", { path: "sub/b.txt", content: "xyz" }, { cwd: tmpDir });
    assert.match(out, /^ok: wrote 3 bytes/);
    assert.equal(fs.readFileSync(path.join(tmpDir, "sub", "b.txt"), "utf8"), "xyz");
  });

  it("rejects absolute paths outside cwd", () => {
    const out = executeOllamaTool("read_file", { path: "/etc/passwd" }, { cwd: tmpDir });
    assert.match(out, /^error: absolute path outside working directory/);
  });

  it("rejects .. escapes", () => {
    const out = executeOllamaTool("write_file", { path: "../evil.txt", content: "x" }, { cwd: tmpDir });
    assert.match(out, /^error: path escapes working directory/);
  });

  it("rejects symlink escapes", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-tools-out-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "s3cret", "utf8");
      fs.symlinkSync(outside, path.join(tmpDir, "link"));
      const out = executeOllamaTool("read_file", { path: "link/secret.txt" }, { cwd: tmpDir });
      assert.match(out, /^error:/);
      assert.equal(resolveConfinedPath(tmpDir, "link/secret.txt").ok, false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("truncates large reads", () => {
    fs.writeFileSync(path.join(tmpDir, "big.txt"), "x".repeat(MAX_READ_BYTES + 100), "utf8");
    const out = executeOllamaTool("read_file", { path: "big.txt" }, { cwd: tmpDir });
    assert.match(out, /\[truncated: showing first/);
  });

  it("unknown tool returns error string, never throws", () => {
    const out = executeOllamaTool("rm_rf", {}, { cwd: tmpDir });
    assert.match(out, /^error: unknown tool/);
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
