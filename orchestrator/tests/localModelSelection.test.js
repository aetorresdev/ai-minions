"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const fixtureTags = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "ollama-tags-sample.json"), "utf8"),
);
const fixturePolicy = fs.readFileSync(
  path.join(__dirname, "fixtures", "model-policy-sample.yaml"),
  "utf8",
);

const {
  loadModelPolicy,
  rankDiscoveredModels,
  selectLocalModel,
  isInteractiveSelectionAllowed,
} = require("../local-model-selection");

function saveEnv(keys) {
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  return prev;
}

function restoreEnv(prev) {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function withTempPolicy(yamlContent, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-policy-test-"));
  fs.mkdirSync(path.join(dir, ".ai-minions"));
  fs.writeFileSync(path.join(dir, ".ai-minions", "model-policy.yaml"), yamlContent, "utf8");
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const mockDiscover = async () => ({
  backends: [{ backend_id: "ollama", available: true, host: "localhost", port: 11434, reason: null }],
  models: fixtureTags.models.map((m) => ({
    name: m.name,
    backend: "ollama",
    family: m.details?.family || null,
    size_bytes: m.size,
    context_length: null,
  })),
  missing_local_backend: null,
});

describe("local-model-selection — precedence", () => {
  const keys = ["ORCH_LOCAL_MODEL", "OLLAMA_MODEL", "ORCH_NON_INTERACTIVE"];
  let prev;

  beforeEach(() => {
    prev = saveEnv(keys);
    delete process.env.ORCH_LOCAL_MODEL;
    delete process.env.OLLAMA_MODEL;
    process.env.ORCH_NON_INTERACTIVE = "1";
  });

  afterEach(() => restoreEnv(prev));

  it("CLI beats env and yaml", async () => {
    await withTempPolicy(fixturePolicy, async (dir) => {
      process.env.ORCH_LOCAL_MODEL = "env-model";
      const result = await selectLocalModel({
        cwd: dir,
        cliModel: "cli-model",
        discover: mockDiscover,
        interactive: false,
      });
      assert.equal(result.selected_model, "cli-model");
      assert.equal(result.override_source, "cli");
    });
  });

  it("ORCH_LOCAL_MODEL beats model-policy.yaml", async () => {
    await withTempPolicy(fixturePolicy, async (dir) => {
      process.env.ORCH_LOCAL_MODEL = "env-model";
      const result = await selectLocalModel({
        cwd: dir,
        discover: mockDiscover,
        interactive: false,
      });
      assert.equal(result.selected_model, "env-model");
      assert.equal(result.override_source, "env_orchestr_local_model");
    });
  });

  it("OLLAMA_MODEL beats model-policy.yaml", async () => {
    await withTempPolicy(fixturePolicy, async (dir) => {
      process.env.OLLAMA_MODEL = "ollama-env-model";
      const result = await selectLocalModel({
        cwd: dir,
        discover: mockDiscover,
        interactive: false,
      });
      assert.equal(result.selected_model, "ollama-env-model");
      assert.equal(result.override_source, "env_ollama_model");
    });
  });

  it("model-policy.yaml default_model beats auto-detect", async () => {
    await withTempPolicy(fixturePolicy, async (dir) => {
      const result = await selectLocalModel({
        cwd: dir,
        discover: mockDiscover,
        interactive: false,
      });
      assert.equal(result.selected_model, "qwen2.5-coder:14b");
      assert.equal(result.override_source, "model_policy_yaml");
    });
  });

  it("auto-detect picks ranked model when no higher override", async () => {
    const result = await selectLocalModel({
      discover: mockDiscover,
      interactive: false,
    });
    assert.equal(result.override_source, "auto_detect");
    assert.ok(result.discovered_models.length >= 2);
    assert.equal(result.selected_model, "qwen2.5-coder:7b");
  });
});

describe("local-model-selection — non-interactive safety", () => {
  it("never calls promptFn when interactive is false", async () => {
    let prompted = false;
    await selectLocalModel({
      discover: mockDiscover,
      interactive: false,
      promptFn: async () => {
        prompted = true;
        return "1";
      },
    });
    assert.equal(prompted, false);
  });

  it("isInteractiveSelectionAllowed is false under ORCH_NON_INTERACTIVE", () => {
    const prev = process.env.ORCH_NON_INTERACTIVE;
    process.env.ORCH_NON_INTERACTIVE = "1";
    try {
      assert.equal(isInteractiveSelectionAllowed(), false);
    } finally {
      if (prev === undefined) delete process.env.ORCH_NON_INTERACTIVE;
      else process.env.ORCH_NON_INTERACTIVE = prev;
    }
  });
});

describe("local-model-selection — TTY prompt", () => {
  it("uses promptFn when interactive and multiple models", async () => {
    const result = await selectLocalModel({
      discover: mockDiscover,
      interactive: true,
      promptFn: async () => "2",
    });
    assert.equal(result.override_source, "tty_prompt");
    assert.equal(result.selected_model, "llama3.1:8b");
  });
});

describe("local-model-selection — ranking", () => {
  it("prefers coder/qwen family for code tasks", () => {
    const models = fixtureTags.models.map((m) => ({
      name: m.name,
      backend: "ollama",
      family: m.details?.family || null,
      size_bytes: m.size,
      context_length: null,
    }));
    const ranked = rankDiscoveredModels(models, { prefer_families: ["qwen2"] }, { taskHint: "code" });
    assert.equal(ranked[0].name, "qwen2.5-coder:7b");
  });

  it("loadModelPolicy reads yaml from .ai-minions", () => {
    withTempPolicy(fixturePolicy, (dir) => {
      const policy = loadModelPolicy(dir);
      assert.equal(policy.default_model, "qwen2.5-coder:14b");
    });
  });

  it("throws on invalid model-policy.yaml version", () => {
    withTempPolicy("model_policy_version: 99\n", (dir) => {
      assert.throws(() => loadModelPolicy(dir), /unsupported model_policy_version/);
    });
  });

  it("selectLocalModel propagates invalid yaml errors", async () => {
    await withTempPolicy("model_policy_version: 99\n", async (dir) => {
      await assert.rejects(
        () => selectLocalModel({ cwd: dir, discover: mockDiscover, interactive: false }),
        /unsupported model_policy_version/,
      );
    });
  });

  it("throws when max_size_bytes filters all discovered models", async () => {
    await assert.rejects(
      () =>
        selectLocalModel({
          discover: mockDiscover,
          interactive: false,
          loadPolicy: () => ({ model_policy_version: 1, max_size_bytes: 1 }),
        }),
      /max_size_bytes/,
    );
  });
});
