/**
 * Default role→model routing and fallback degradation policy.
 * Consumed by agents.js (resolveModel, resolveFallback, AGENTS getters, runOllama paths).
 *
 * Extension notes (provider): see agents.js askAgent() dispatch — add provider on entries here
 * and implement runner there.
 */

// ── Ollama model config ───────────────────────────────────────────────────────
// Set OLLAMA_MODEL to use a local model for orchestrator/summarizer roles.
// If not set or Ollama is unreachable, these roles fall back to claude-haiku.
//
// Supported local models (run `ollama pull <model>` first):
//   qwen2.5-coder:7b (default if OLLAMA_MODEL is set)
//   llama3.1:8b, mistral:7b, codellama:13b, deepseek-coder:6.7b
//
// If OLLAMA_MODEL is not set → Ollama is disabled, roles use OLLAMA_FALLBACK_MODEL.
const OLLAMA_MODEL          = process.env.OLLAMA_MODEL || null;
const OLLAMA_FALLBACK_MODEL = "claude-haiku-4-5-20251001";  // used when Ollama unavailable

// ── Model routing config ──────────────────────────────────────────────────────
//
// primary    : model used when Claude CLI is available
// fallback   : model to use if primary is unavailable or rate-limited
// localSafe  : true = Ollama can substitute for this role (output is structured/JSON)
//              false = requires a cloud model; local fallback degrades quality unacceptably
//
// To override at runtime: set MODEL_OVERRIDE_<ROLE>=<model-id> env var
// e.g. MODEL_OVERRIDE_QA=claude-haiku-4-5-20251001
//
// ── Provider extension point ──────────────────────────────────────────────────
// To add OpenAI, Gemini, or other providers:
//   1. Add a runner function (e.g. runOpenAI, runGemini) modeled after runOllama()
//   2. Add provider: "openai" | "gemini" to the relevant MODEL_ROUTING entries
//   3. In askAgent(), dispatch to the new runner based on routing.provider
//      (same pattern as the existing ollama branch)
// validateOutput(), context_stats, and all gates are provider-agnostic —
// they operate on output text regardless of who generated it.
// Note: provider routing only applies to the multi-agent runner (run-orchestrator.js).
// Single-agent (Claude Code header) always uses the Anthropic API.

const MODEL_ROUTING = {
  // Ollama-native roles — fall back to claude-haiku if Ollama not available
  orchestrator: { primary: OLLAMA_MODEL || OLLAMA_FALLBACK_MODEL, fallback: OLLAMA_FALLBACK_MODEL, localSafe: true,  provider: OLLAMA_MODEL ? "ollama" : "claude" },
  summarizer:   { primary: OLLAMA_MODEL || OLLAMA_FALLBACK_MODEL, fallback: OLLAMA_FALLBACK_MODEL, localSafe: true,  provider: OLLAMA_MODEL ? "ollama" : "claude" },

  // Claude roles — grouped by local-safety
  // provider defaults to "claude" when not specified (uses runClaude / claude CLI)
  owner:        { primary: "claude-haiku-4-5-20251001", fallback: OLLAMA_MODEL || OLLAMA_FALLBACK_MODEL, localSafe: true  },
  "dev-backend":{ primary: "claude-sonnet-4-6",        fallback: "claude-haiku-4-5-20251001", localSafe: false },
  "dev-frontend":{ primary: "claude-sonnet-4-6",       fallback: "claude-haiku-4-5-20251001", localSafe: false },
  "dev-devops": { primary: "claude-sonnet-4-6",        fallback: "claude-haiku-4-5-20251001", localSafe: false },
  architect:    { primary: "claude-sonnet-4-6",        fallback: null,                        localSafe: false },
  qa:           { primary: "claude-sonnet-4-6",        fallback: "claude-haiku-4-5-20251001", localSafe: false },
  cerberus:     { primary: "claude-sonnet-4-6",        fallback: null,                        localSafe: false },
};

// ── Fallback policy ───────────────────────────────────────────────────────────
//
// Defines what happens when both primary and fallback models fail for a role.
//
// degraded: true  → run with fallback model, log warning, continue flow
// degraded: false → hard fail, block step, surface as blocker in artifacts
//
// Roles with degraded: false are critical — their output cannot be safely
// approximated by a weaker model (adversarial review, infra decisions).
//
const FALLBACK_POLICY = {
  orchestrator:  { degraded: true,  reason: "JSON plan only — local model acceptable" },
  summarizer:    { degraded: true,  reason: "Summary only — local model acceptable" },
  owner:         { degraded: true,  reason: "Scope decisions tolerate lower model quality" },
  "dev-backend": { degraded: true,  reason: "Haiku fallback acceptable with careful review" },
  "dev-frontend":{ degraded: true,  reason: "Haiku fallback acceptable with careful review" },
  "dev-devops":  { degraded: true,  reason: "Haiku fallback acceptable with careful review" },
  architect:     { degraded: false, reason: "Design decisions require strong reasoning — no fallback" },
  qa:            { degraded: true,  reason: "Haiku fallback acceptable; CERBERUS catches gaps" },
  cerberus:      { degraded: false, reason: "Adversarial review must not be degraded — hard fail" },
};

module.exports = {
  OLLAMA_MODEL,
  OLLAMA_FALLBACK_MODEL,
  MODEL_ROUTING,
  FALLBACK_POLICY,
};
