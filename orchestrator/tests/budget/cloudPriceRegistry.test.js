"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  CLOUD_PRICE_BASELINES,
  pricingFreshness,
  buildSameCountCloudProjections,
} = require("../../modules/budget/cloud-price-registry");

describe("cloud-price-registry", () => {
  it("exposes one baseline per OpenAI Anthropic Google", () => {
    const providers = CLOUD_PRICE_BASELINES.map((b) => b.provider).sort();
    assert.deepEqual(providers, ["anthropic", "google", "openai"]);
  });

  it("pricingFreshness marks old rates stale", () => {
    assert.equal(pricingFreshness("2026-07-16", new Date("2026-07-20T00:00:00Z")), "fresh");
    assert.equal(pricingFreshness("2025-01-01", new Date("2026-07-16T00:00:00Z")), "stale");
  });

  it("buildSameCountCloudProjections computes advisory USD rows", () => {
    const rows = buildSameCountCloudProjections({
      prompt_tokens: 1000,
      completion_tokens: 500,
    });
    assert.equal(rows.length, 3);
    for (const r of rows) {
      assert.equal(r.is_billable, false);
      assert.equal(r.pricing_source, "registry");
      assert.ok(typeof r.total_usd === "number");
      assert.match(r.note, /same_count/);
    }
    const openai = rows.find((r) => r.provider === "openai");
    assert.ok(openai);
    // 1000/1e6 * 0.15 + 500/1e6 * 0.6 = 0.00015 + 0.0003 = 0.00045
    assert.equal(openai.total_usd, 0.00045);
  });
});
