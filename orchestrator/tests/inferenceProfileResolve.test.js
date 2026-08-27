"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveOllamaNumPredict,
  resolveOllamaThink,
  ollamaThinkFlagFromMode,
  DEFAULT_NUM_PREDICT,
} = require("../modules/model-runtime/inference-profile-resolve");

describe("resolveOllamaNumPredict", () => {
  it("prefers OLLAMA_NUM_PREDICT env over profiles", () => {
    const out = resolveOllamaNumPredict({
      env: { OLLAMA_NUM_PREDICT: "512" },
      role: "ARCHITECT",
      loadPolicy: () => ({
        policy: {
          provider_inference_profiles: {
            ollama: {
              default: { max_tokens: 8192, profile_source: "installer_default" },
              by_role: { ARCHITECT: { max_tokens: 16384, profile_source: "installer_default" } },
            },
          },
        },
      }),
    });
    assert.equal(out.num_predict, 512);
    assert.equal(out.inference_profile_mode, "env");
    assert.equal(out.profile_source, "env_ollama_num_predict");
  });

  it("applies by_role max_tokens when env unset", () => {
    const out = resolveOllamaNumPredict({
      env: {},
      role: "ARCHITECT",
      loadPolicy: () => ({
        policy: {
          provider_inference_profiles: {
            ollama: {
              default: { max_tokens: 8192, profile_source: "installer_default" },
              by_role: { ARCHITECT: { max_tokens: 16384, profile_source: "installer_default" } },
            },
          },
        },
      }),
    });
    assert.equal(out.num_predict, 16384);
    assert.equal(out.inference_profile_mode, "applied");
    assert.equal(out.profile_source, "installer_default");
    assert.equal(out.role, "ARCHITECT");
  });

  it("falls back to ollama default max_tokens", () => {
    const out = resolveOllamaNumPredict({
      env: {},
      role: "DEV",
      loadPolicy: () => ({
        policy: {
          provider_inference_profiles: {
            ollama: {
              default: { max_tokens: 8192, profile_source: "installer_default" },
            },
          },
        },
      }),
    });
    assert.equal(out.num_predict, 8192);
    assert.equal(out.inference_profile_mode, "applied");
  });

  it("defaults to 2048 when no profile", () => {
    const out = resolveOllamaNumPredict({
      env: {},
      role: "QA",
      loadPolicy: () => ({ policy: {} }),
    });
    assert.equal(out.num_predict, DEFAULT_NUM_PREDICT);
    assert.equal(out.inference_profile_mode, "default");
    assert.equal(out.profile_source, null);
  });

  it("falls back to AI_MINIONS_HOME when goal cwd has no .ai-minions config", () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const productHome = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minions-home-"));
    const goalCwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minions-goal-"));
    fs.mkdirSync(path.join(productHome, ".ai-minions"), { recursive: true });
    fs.writeFileSync(
      path.join(productHome, ".ai-minions", "model_policy.json"),
      JSON.stringify({ model_policy_version: 1, default_tier: "standard", tiers: { cheap: [], standard: [], strong: [], frontier: [] }, role_defaults: {}, rules: [] }),
    );
    const out = resolveOllamaNumPredict({
      cwd: goalCwd,
      env: { AI_MINIONS_HOME: productHome },
      role: "DEV",
      loadPolicy: (cwd) => {
        if (path.resolve(cwd) === productHome) {
          return {
            policy: {
              provider_inference_profiles: {
                ollama: { default: { max_tokens: 8192, profile_source: "installer_default" } },
              },
            },
          };
        }
        return { policy: {} };
      },
    });
    assert.equal(out.num_predict, 8192);
    assert.equal(out.inference_profile_mode, "applied");
    assert.equal(out.profile_source, "installer_default");
  });

  it("resolves thinking_mode from by_role and maps disabled → think:false", () => {
    const out = resolveOllamaNumPredict({
      env: {},
      role: "CERBERUS",
      loadPolicy: () => ({
        policy: {
          provider_inference_profiles: {
            ollama: {
              default: { max_tokens: 8192, thinking_mode: "enabled" },
              by_role: { CERBERUS: { max_tokens: 8192, thinking_mode: "disabled" } },
            },
          },
        },
      }),
    });
    assert.equal(out.thinking_mode, "disabled");
    assert.equal(out.think, false);
  });

  it("role entry without thinking_mode inherits the default entry's mode", () => {
    const out = resolveOllamaNumPredict({
      env: {},
      role: "ARCHITECT",
      loadPolicy: () => ({
        policy: {
          provider_inference_profiles: {
            ollama: {
              default: { max_tokens: 8192, thinking_mode: "disabled" },
              by_role: { ARCHITECT: { max_tokens: 16384 } },
            },
          },
        },
      }),
    });
    assert.equal(out.num_predict, 16384);
    assert.equal(out.thinking_mode, "disabled");
    assert.equal(out.think, false);
  });

  it("OLLAMA_NUM_PREDICT env override still carries profile thinking", () => {
    const out = resolveOllamaNumPredict({
      env: { OLLAMA_NUM_PREDICT: "512" },
      role: "QA",
      loadPolicy: () => ({
        policy: {
          provider_inference_profiles: {
            ollama: { default: { max_tokens: 8192, thinking_mode: "disabled" } },
          },
        },
      }),
    });
    assert.equal(out.num_predict, 512);
    assert.equal(out.inference_profile_mode, "env");
    assert.equal(out.think, false);
  });

  it("OLLAMA_NUM_PREDICT env wins when model_policy.json load throws", () => {
    const out = resolveOllamaNumPredict({
      env: { OLLAMA_NUM_PREDICT: "4096" },
      role: "DEV",
      loadPolicy: () => {
        throw new Error("corrupt model_policy.json");
      },
    });
    assert.equal(out.num_predict, 4096);
    assert.equal(out.inference_profile_mode, "env");
    assert.equal(out.profile_source, "env_ollama_num_predict");
  });
});

describe("ollamaThinkFlagFromMode", () => {
  it("maps provider-neutral modes to the Ollama think field", () => {
    assert.equal(ollamaThinkFlagFromMode("disabled"), false);
    assert.equal(ollamaThinkFlagFromMode("enabled"), true);
    // adaptive is not a literal Ollama payload value — omit, let model default.
    assert.equal(ollamaThinkFlagFromMode("adaptive"), undefined);
    assert.equal(ollamaThinkFlagFromMode(undefined), undefined);
    assert.equal(ollamaThinkFlagFromMode(""), undefined);
  });
});

describe("resolveOllamaThink", () => {
  it("prefers OLLAMA_THINK env over the profile", () => {
    const out = resolveOllamaThink({
      env: { OLLAMA_THINK: "1" },
      role: "CERBERUS",
      loadPolicy: () => ({
        policy: {
          provider_inference_profiles: {
            ollama: { default: { max_tokens: 8192, thinking_mode: "disabled" } },
          },
        },
      }),
    });
    assert.equal(out.think, true);
    assert.equal(out.profile_source, "env_ollama_think");
  });

  it("parses boolean-ish OLLAMA_THINK values", () => {
    const loadPolicy = () => ({ policy: {} });
    assert.equal(resolveOllamaThink({ env: { OLLAMA_THINK: "false" }, loadPolicy }).think, false);
    assert.equal(resolveOllamaThink({ env: { OLLAMA_THINK: "off" }, loadPolicy }).think, false);
    assert.equal(resolveOllamaThink({ env: { OLLAMA_THINK: "on" }, loadPolicy }).think, true);
    assert.equal(resolveOllamaThink({ env: { OLLAMA_THINK: "bogus" }, loadPolicy }).think, undefined);
  });

  it("omits think when the profile mode is adaptive", () => {
    const out = resolveOllamaThink({
      env: {},
      role: "ARCHITECT",
      loadPolicy: () => ({
        policy: {
          provider_inference_profiles: {
            ollama: {
              default: { max_tokens: 8192, thinking_mode: "disabled" },
              by_role: { ARCHITECT: { max_tokens: 16384, thinking_mode: "adaptive" } },
            },
          },
        },
      }),
    });
    assert.equal(out.think, undefined);
    assert.equal(out.thinking_mode, "adaptive");
  });
});
