"use strict";

/**
 * Observable context hygiene signals (trace events only — no enforcement).
 * See docs/orchestrator/context-hygiene-signals.md
 */

const { pickTraceMeta } = require("./trace-lifecycle-events");

/** @typedef {{ signal_id: string, severity: "info"|"warn", suggestion: string, metrics?: Record<string, number> }} HygieneSignal */

const DEFAULT_THRESHOLDS = {
  largePromptTokens: 8000,
  growthRateWarn: 1.5,
  freshRunIterationMin: 5,
  compactionIterationMin: 2,
};

/**
 * @param {typeof DEFAULT_THRESHOLDS} [thresholds]
 */
function createContextHygieneTracker(thresholds = DEFAULT_THRESHOLDS) {
  /** @type {{ lastPromptTokens: number|null, lastLargeFingerprint: string|null, runPeakPrompt: number, lastAgent: string|null }} */
  const state = {
    lastPromptTokens: null,
    lastLargeFingerprint: null,
    runPeakPrompt: 0,
    lastAgent: null,
  };

  /**
   * @param {string} agent
   * @param {number} iteration
   * @param {Record<string, unknown>} stats
   * @returns {HygieneSignal[]}
   */
  function observeContextStats(agent, iteration, stats) {
    /** @type {HygieneSignal[]} */
    const signals = [];
    const prompt =
      typeof stats.ollama_prompt_tokens === "number" && !Number.isNaN(stats.ollama_prompt_tokens)
        ? stats.ollama_prompt_tokens
        : 0;

    if (state.lastPromptTokens != null && prompt > 0 && prompt >= state.lastPromptTokens * thresholds.growthRateWarn) {
      signals.push({
        signal_id: "context_growth_rate",
        severity: "warn",
        suggestion: "Context grew quickly between agent calls — consider compact handoff or a narrower GOAL.",
        metrics: {
          prompt_tokens: prompt,
          previous_prompt_tokens: state.lastPromptTokens,
          growth_ratio: Math.round((prompt / state.lastPromptTokens) * 100) / 100,
        },
      });
    }

    if (prompt >= thresholds.largePromptTokens) {
      const fingerprint = `${agent}:${iteration}:${prompt}`;
      if (state.lastLargeFingerprint === fingerprint) {
        signals.push({
          signal_id: "repeated_large_input_detected",
          severity: "warn",
          suggestion: "Large prompt repeated without change — avoid re-pasting; reference paths or prior handoff.",
          metrics: { prompt_tokens: prompt },
        });
      }
      state.lastLargeFingerprint = fingerprint;
    }

    if (prompt >= thresholds.largePromptTokens && iteration >= thresholds.compactionIterationMin) {
      signals.push({
        signal_id: "compaction_recommended",
        severity: "info",
        suggestion: "Prompt size is high mid-run — compact handoff before the next role may help.",
        metrics: { prompt_tokens: prompt, iteration },
      });
    }

    if (
      iteration >= thresholds.freshRunIterationMin &&
      prompt > 0 &&
      prompt >= state.runPeakPrompt * 0.9 &&
      state.runPeakPrompt >= thresholds.largePromptTokens
    ) {
      signals.push({
        signal_id: "fresh_run_recommended",
        severity: "info",
        suggestion: "Many iterations with sustained large context — a new run with a fresh GOAL may be cheaper.",
        metrics: { prompt_tokens: prompt, iteration, run_peak_prompt_tokens: state.runPeakPrompt },
      });
    }

    if (prompt > state.runPeakPrompt) state.runPeakPrompt = prompt;
    if (prompt > 0) state.lastPromptTokens = prompt;
    state.lastAgent = agent;
    return signals;
  }

  return { observeContextStats, _state: state };
}

/**
 * @param {(taskId: string, ev: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {string} agent
 * @param {HygieneSignal} signal
 * @param {Record<string, unknown>} meta
 */
function emitContextHygieneSignal(traceEvent, taskId, agent, signal, meta) {
  traceEvent(taskId, {
    event: "context_hygiene_signal",
    agent,
    active_role: agent,
    signal_id: signal.signal_id,
    severity: signal.severity,
    suggestion: signal.suggestion,
  ...(signal.metrics ? { metrics: signal.metrics } : {}),
    ...pickTraceMeta(meta),
  });
}

/**
 * @param {(taskId: string, ev: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {string} agent
 * @param {number} iteration
 * @param {Record<string, unknown>} stats
 * @param {Record<string, unknown>} meta
 * @param {{ observeContextStats: Function }} tracker
 */
function emitContextHygieneSignalsFromStats(traceEvent, taskId, agent, iteration, stats, meta, tracker) {
  if (!stats || typeof stats !== "object") return;
  const signals = tracker.observeContextStats(agent, iteration, stats);
  for (const signal of signals) {
    emitContextHygieneSignal(traceEvent, taskId, agent, signal, { iteration, ...meta });
  }
}

module.exports = {
  DEFAULT_THRESHOLDS,
  createContextHygieneTracker,
  emitContextHygieneSignal,
  emitContextHygieneSignalsFromStats,
};
