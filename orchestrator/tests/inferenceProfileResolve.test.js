"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveOllamaNumPredict,
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
});
