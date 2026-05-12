"use strict";

/**
 * Optional trace events for compaction lifecycle and model-fallback lifecycle.
 * Observability only; token rollups stay **`context_stats`**-based and cost guards are unchanged.
 */

/**
 * @param {Record<string, unknown>} meta
 * @returns {Record<string, unknown>}
 */
function pickTraceMeta(meta) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (typeof meta.iteration === "number") out.iteration = meta.iteration;
  if (typeof meta.step_id === "string" && meta.step_id.length) out.step_id = meta.step_id;
  if (typeof meta.step_index === "number") out.step_index = meta.step_index;
  if (typeof meta.intent_id === "string" && meta.intent_id.length) out.intent_id = meta.intent_id;
  if (typeof meta.parent_step_id === "string" && meta.parent_step_id.length) {
    out.parent_step_id = meta.parent_step_id;
  }
  if (typeof meta.phase === "string" && meta.phase.length) out.phase = meta.phase;
  return out;
}

/**
 * @param {(taskId: string, ev: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {string} attributedToRole
 * @param {Record<string, unknown>} meta
 */
function emitContextCompactionStarted(traceEvent, taskId, attributedToRole, meta) {
  traceEvent(taskId, {
    event: "context_compaction_started",
    execution_actor: "context_compactor",
    attributed_to_role: attributedToRole,
    invocation_type: "context_compaction",
    trigger_reason: "handoff_policy",
    ...pickTraceMeta(meta),
  });
}

/**
 * @param {(taskId: string, ev: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {string} attributedToRole
 * @param {Record<string, unknown>} meta
 * @param {{ ollama_prompt_tokens?: number, ollama_completion_tokens?: number }} compactRes
 */
function emitContextCompactionCompleted(traceEvent, taskId, attributedToRole, meta, compactRes) {
  /** @type {Record<string, unknown>} */
  const row = {
    event: "context_compaction_completed",
    execution_actor: "context_compactor",
    attributed_to_role: attributedToRole,
    invocation_type: "context_compaction",
    trigger_reason: "handoff_policy",
    ...pickTraceMeta(meta),
  };
  if (typeof compactRes.ollama_prompt_tokens === "number" && !Number.isNaN(compactRes.ollama_prompt_tokens)) {
    row.ollama_prompt_tokens = compactRes.ollama_prompt_tokens;
  }
  if (typeof compactRes.ollama_completion_tokens === "number" && !Number.isNaN(compactRes.ollama_completion_tokens)) {
    row.ollama_completion_tokens = compactRes.ollama_completion_tokens;
  }
  traceEvent(taskId, row);
}

/**
 * @param {(taskId: string, ev: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {string} agentId
 * @param {Record<string, unknown> | null | undefined} stats
 * @param {Record<string, unknown>} meta
 */
function emitModelFallbackLifecycleIfNeeded(traceEvent, taskId, agentId, stats, meta) {
  const segs = stats && stats.model_fallback_segments;
  if (!Array.isArray(segs) || segs.length < 2) return;
  const src = segs[0];
  const tgt = segs[1];
  if (!src || !tgt || typeof src !== "object" || typeof tgt !== "object") return;

  const base = {
    active_role: agentId,
    agent_id: agentId,
    role: agentId,
    ...pickTraceMeta(meta),
    source_model_name: typeof src.model_name === "string" ? src.model_name : "",
    target_model_name: typeof tgt.model_name === "string" ? tgt.model_name : "",
    source_model_backend: typeof src.model_backend === "string" ? src.model_backend : "unknown",
    target_model_backend: typeof tgt.model_backend === "string" ? tgt.model_backend : "unknown",
    fallback_reason: typeof src.fallback_reason === "string" ? src.fallback_reason : "model_error",
    model_fallback_chain_length: segs.length,
  };

  traceEvent(taskId, { event: "model_fallback_required", ...base });
  traceEvent(taskId, { event: "model_fallback_started", ...base });

  /** @type {Record<string, unknown>} */
  const done = { event: "model_fallback_completed", ...base };
  if (typeof src.ollama_prompt_tokens === "number" && !Number.isNaN(src.ollama_prompt_tokens)) {
    done.source_ollama_prompt_tokens = src.ollama_prompt_tokens;
  }
  if (typeof src.ollama_completion_tokens === "number" && !Number.isNaN(src.ollama_completion_tokens)) {
    done.source_ollama_completion_tokens = src.ollama_completion_tokens;
  }
  if (typeof tgt.ollama_prompt_tokens === "number" && !Number.isNaN(tgt.ollama_prompt_tokens)) {
    done.target_ollama_prompt_tokens = tgt.ollama_prompt_tokens;
  }
  if (typeof tgt.ollama_completion_tokens === "number" && !Number.isNaN(tgt.ollama_completion_tokens)) {
    done.target_ollama_completion_tokens = tgt.ollama_completion_tokens;
  }
  traceEvent(taskId, done);
}

module.exports = {
  pickTraceMeta,
  emitContextCompactionStarted,
  emitContextCompactionCompleted,
  emitModelFallbackLifecycleIfNeeded,
};
