"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  ollamaThinkingObserved,
  assessOllamaThinkingCompliance,
} = require("../modules/model-runtime/ollama-thinking-compliance");

describe("ollamaThinkingObserved", () => {
  it("detects non-empty message.thinking", () => {
    assert.equal(
      ollamaThinkingObserved({ message: { thinking: "internal reasoning" } }),
      true,
    );
  });

  it("ignores empty or missing thinking", () => {
    assert.equal(ollamaThinkingObserved({ message: { thinking: "  " } }), false);
    assert.equal(ollamaThinkingObserved({ message: { content: "hi" } }), false);
    assert.equal(ollamaThinkingObserved({}), false);
  });
});

describe("assessOllamaThinkingCompliance", () => {
  it("passes when think:false and no thinking returned", () => {
    const out = assessOllamaThinkingCompliance(false, { message: { content: "ok" } });
    assert.equal(out.ok, true);
    assert.equal(out.ollama_think_requested, 0);
    assert.equal(out.ollama_thinking_observed, 0);
    assert.equal(out.ollama_think, 0);
  });

  it("fails when think:false but model returned thinking content", () => {
    const out = assessOllamaThinkingCompliance(
      false,
      { message: { thinking: "hidden", content: "" } },
    );
    assert.equal(out.ok, false);
    assert.equal(out.gate_id, "THINKING_NOT_DISABLED");
    assert.equal(out.ollama_thinking_observed, 1);
    assert.equal(out.ollama_think, 1);
  });

  it("records observed thinking when think was omitted", () => {
    const out = assessOllamaThinkingCompliance(undefined, {
      message: { thinking: "reason", content: "answer" },
    });
    assert.equal(out.ok, true);
    assert.equal(out.ollama_think_requested, null);
    assert.equal(out.ollama_thinking_observed, 1);
  });
});
