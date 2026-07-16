"use strict";

/**
 * Versioned same-count cloud price registry (advisory only).
 * Not provider billing · not tokenizer-equivalent workload cost · no runtime network fetch.
 *
 * Rates are USD per 1M tokens (standard text API, non-batch, non-cached input).
 * Refresh by editing this file and bumping checked_at after verifying official pages.
 */

/** Days after checked_at before projections are marked stale. */
const STALE_AFTER_DAYS = 90;

/**
 * One representative baseline per major provider.
 * @type {ReadonlyArray<{
 *   provider: string,
 *   model: string,
 *   usd_per_mtok_prompt: number,
 *   usd_per_mtok_completion: number,
 *   pricing_mode: string,
 *   source_url: string,
 *   checked_at: string,
 * }>}
 */
const CLOUD_PRICE_BASELINES = Object.freeze([
  Object.freeze({
    provider: "openai",
    model: "gpt-4o-mini",
    usd_per_mtok_prompt: 0.15,
    usd_per_mtok_completion: 0.6,
    pricing_mode: "standard",
    source_url: "https://developers.openai.com/api/docs/pricing",
    checked_at: "2026-07-16",
  }),
  Object.freeze({
    provider: "anthropic",
    model: "claude-haiku-4.5",
    usd_per_mtok_prompt: 1.0,
    usd_per_mtok_completion: 5.0,
    pricing_mode: "standard",
    source_url: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    checked_at: "2026-07-16",
  }),
  Object.freeze({
    provider: "google",
    model: "gemini-2.0-flash",
    usd_per_mtok_prompt: 0.1,
    usd_per_mtok_completion: 0.4,
    pricing_mode: "standard_paid",
    source_url: "https://ai.google.dev/gemini-api/docs/pricing",
    checked_at: "2026-07-16",
  }),
]);

/**
 * @param {string} checkedAt YYYY-MM-DD
 * @param {Date} [now]
 * @returns {"fresh"|"stale"|"unknown"}
 */
function pricingFreshness(checkedAt, now = new Date()) {
  if (typeof checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) {
    return "unknown";
  }
  const checkedMs = Date.parse(`${checkedAt}T00:00:00Z`);
  if (!Number.isFinite(checkedMs)) return "unknown";
  const ageDays = (now.getTime() - checkedMs) / (86400 * 1000);
  if (ageDays < 0) return "unknown";
  return ageDays <= STALE_AFTER_DAYS ? "fresh" : "stale";
}

/**
 * @param {number} x
 * @returns {number}
 */
function roundUsd(x) {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * Project Ollama-observed token counts onto registry baselines.
 * Same counts ≠ same tokenizer / workload — advisory only.
 *
 * @param {{ prompt_tokens: number, completion_tokens: number }} totals
 * @param {{ now?: Date, baselines?: typeof CLOUD_PRICE_BASELINES }} [options]
 * @returns {object[]}
 */
function buildSameCountCloudProjections(totals, options = {}) {
  const prompt = Number(totals.prompt_tokens) || 0;
  const completion = Number(totals.completion_tokens) || 0;
  if (prompt <= 0 && completion <= 0) return [];

  const baselines = options.baselines ?? CLOUD_PRICE_BASELINES;
  const now = options.now ?? new Date();

  return baselines.map((b) => {
    const input_usd = roundUsd((prompt / 1e6) * b.usd_per_mtok_prompt);
    const output_usd = roundUsd((completion / 1e6) * b.usd_per_mtok_completion);
    return {
      provider: b.provider,
      model: b.model,
      input_usd,
      output_usd,
      total_usd: roundUsd(input_usd + output_usd),
      pricing_mode: b.pricing_mode,
      pricing_source: "registry",
      source_url: b.source_url,
      checked_at: b.checked_at,
      freshness: pricingFreshness(b.checked_at, now),
      is_billable: false,
      note: "same_count_cloud_price_projection_not_provider_billing",
    };
  });
}

module.exports = {
  CLOUD_PRICE_BASELINES,
  STALE_AFTER_DAYS,
  pricingFreshness,
  buildSameCountCloudProjections,
};
