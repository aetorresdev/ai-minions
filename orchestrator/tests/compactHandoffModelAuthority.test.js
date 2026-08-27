"use strict";

/**
 * Contract: compact-handoff resolves its Ollama model from
 * model-policy.yaml::default_model — the same install-time local default
 * field consumed by selectLocalModel() when CLI/env overrides are absent.
 * Per-role tier routing remains model_policy.json only (orchestrator agents).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { selectLocalModel } = require("../modules/model-runtime/local-model-selection");

const INSTALL_YAML = `model_policy_version: 1
default_model: policy-default:7b
local_backend:
  backend_id: ollama
  support_status: supported
  host: 127.0.0.1
  port: 11434
  base_url: http://127.0.0.1:11434
  endpoint_scope: localhost
`;

describe("compact-handoff model authority contract", () => {
  it("selectLocalModel uses the same yaml default_model field as compact-handoff", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "compact-handoff-auth-"));
    fs.mkdirSync(path.join(tmp, ".ai-minions"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".ai-minions", "model-policy.yaml"), INSTALL_YAML, "utf8");

    const prev = {
      ORCH_LOCAL_MODEL: process.env.ORCH_LOCAL_MODEL,
      OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    };
    delete process.env.ORCH_LOCAL_MODEL;
    delete process.env.OLLAMA_MODEL;

    try {
      const out = await selectLocalModel({
        cwd: tmp,
        interactive: false,
        discover: async () => ({
          backends: [{
            backend_id: "ollama",
            available: true,
            host: "127.0.0.1",
            port: 11434,
            reason: null,
          }],
          models: [{
            name: "policy-default:7b",
            backend_id: "ollama",
            family: null,
            size_bytes: null,
            context_length: null,
          }],
          missing_local_backend: null,
        }),
      });
      assert.equal(out.selected_model, "policy-default:7b");
      assert.match(out.selection_reason, /default_model from \.ai-minions\/model-policy\.yaml/);
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
