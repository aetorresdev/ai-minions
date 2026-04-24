/**
 * Agent definitions for the autonomous orchestrator example.
 *
 * Agents map to the MODE protocol defined in docs/orchestrator/agent-contract.md:
 *   orchestrator → ORCHESTRATOR  (Ollama — produces JSON plan/decide only)
 *   owner        → OWNER         (Haiku)
 *   architect    → ARCHITECT     (Sonnet — design only, no code)
 *   dev-backend  → DEV           (Sonnet)
 *   dev-frontend → DEV           (Sonnet)
 *   dev-devops   → DEV           (Sonnet — infra implementation)
 *   qa           → QA            (Sonnet)
 *   cerberus     → CERBERUS      (Sonnet — adversarial last-mile review)
 *
 * orchestrator and summarizer run on Ollama (local, no API key).
 * All other agents run via the claude CLI (active Claude Code session).
 *
 * Test-only system-path harness: when `ORCH_TEST_SYSTEM_PATH_HARNESS=1`, `askAgent` returns deterministic
 * plan/decide/DEV/CERBERUS outputs (see `tests/e2e.strict.test.js`). **Forbidden** outside that test subprocess.
 */

const {
  OLLAMA_MODEL,
  MODEL_ROUTING,
  FALLBACK_POLICY,
} = require("./agents/routing/model-routing");
const { ROLE_PERMISSION, effectiveMode } = require("./agents/permissions");

const {
  validateOutput,
  normalizeDevContractText,
  parseCerberusTripleTemplate,
  validateCerberusSemanticFloor,
  extractContextStats,
  cerberusFindingHasAnchor,
} = require("./agents/validate-output");
const { runOllama } = require("./agents/runtime/run-ollama");
const { runClaude, MAX_OUTPUT_TOKENS } = require("./agents/runtime/run-claude");
const { summarizeHandoff } = require("./agents/runtime/summarize-handoff");
const {
  OLLAMA_ARCHITECT_SYSTEM_APPEND,
  OLLAMA_DEV_SYSTEM_APPEND,
  OLLAMA_ORCHESTRATOR_PLAN_APPEND,
  OLLAMA_ORCHESTRATOR_DECIDE_APPEND,
} = require("./agents/prompts/ollama-appends");
const { buildAgents } = require("./agents/registry");

// ── Contract version ──────────────────────────────────────────────────────────
// Bump when handoff schema, role permissions, or gate sequence change.
// Passed to register_task so the envelope records the version that produced it.
// sync: docs/orchestrator/agent-contract.md § Output contracts + ALLOW/FORBID table
const CONTRACT_VERSION = "1.0";

// ── Degraded-agent tracking ───────────────────────────────────────────────────
// When an agent falls back to a secondary model, its id is added here.
// The orchestrator reads this after each step via getDegradedAgents().
// clearDegradedAgents() is called at the start of each run.
const _degradedAgents = new Set();
function getDegradedAgents() { return new Set(_degradedAgents); }
function clearDegradedAgents() { _degradedAgents.clear(); }

// ── Profile-based model selection ────────────────────────────────────────────
// Set via setModelProfile(profile, modelsConfig) at the start of each run.
// resolveModel() reads these to determine the active model per role.
// Priority: MODEL_OVERRIDE_<ROLE> env var > profile overrides > profile default > MODEL_ROUTING
let _activeProfile = null;
let _modelsConfig  = null;

/**
 * Configure the active model profile for this run.
 * Called once by run-orchestrator.js before any agent is invoked.
 * @param {string|null} profile - profile name from models.json (e.g. "fast", "balanced", "quality")
 * @param {object|null} modelsConfig - parsed models.json content
 */
function setModelProfile(profile, modelsConfig) {
  _activeProfile = profile || null;
  _modelsConfig  = modelsConfig || null;
}

// OLLAMA_MODEL / routing tables: ./agents/routing/model-routing.js — Ollama HTTP: ./agents/runtime/run-ollama.js

/**
 * Resolve the active model for a role.
 *
 * Priority (highest first):
 *   1. MODEL_OVERRIDE_<ROLE> env var          — always wins, retrocompatible
 *   2. profile overrides from models.json     — per-role within active profile
 *   3. profile default from models.json       — catch-all for active profile
 *   4. MODEL_ROUTING[role].primary            — hardcoded default (agents/routing/model-routing.js)
 *
 * @param {string} role - agent id (e.g. "dev-backend", "cerberus")
 * @returns {string} model id
 */
function resolveModel(role) {
  // 1. Env override — retrocompatible with existing MODEL_OVERRIDE_<ROLE> usage
  const envKey = `MODEL_OVERRIDE_${role.toUpperCase().replace(/-/g, "_")}`;
  if (process.env[envKey]) return process.env[envKey];

  // 2 + 3. Profile-based selection from models.json
  if (_activeProfile && _modelsConfig) {
    const prof = _modelsConfig.profiles?.[_activeProfile];
    if (prof) {
      const overrideKey = role.toUpperCase().replace(/-/g, "_");
      if (prof.overrides?.[overrideKey]) return prof.overrides[overrideKey];
      if (prof.default) return prof.default;
    }
  }

  // 4. MODEL_ROUTING fallback — throws on unknown role to surface misconfiguration early
  const routing = MODEL_ROUTING[role];
  if (!routing) throw new Error(`resolveModel: unknown role "${role}" — add it to MODEL_ROUTING in agents/routing/model-routing.js`);
  return routing.primary;
}

/**
 * Resolve fallback model for a role when primary fails.
 * Returns { model, degraded, reason } or throws if role must hard-fail.
 */
function resolveFallback(role) {
  const routing = MODEL_ROUTING[role];
  const policy  = FALLBACK_POLICY[role] ?? { degraded: false, reason: "unknown role" };

  if (!routing?.fallback) {
    if (!policy.degraded) {
      throw new Error(`[fallback] ${role}: no fallback model and degraded=false — hard fail. Reason: ${policy.reason}`);
    }
    throw new Error(`[fallback] ${role}: no fallback model configured`);
  }

  if (!policy.degraded) {
    throw new Error(`[fallback] ${role}: fallback model exists but policy requires hard fail. Reason: ${policy.reason}`);
  }

  return { model: routing.fallback, degraded: true, reason: policy.reason };
}

const AGENTS = buildAgents({ resolveModel, ollamaModel: OLLAMA_MODEL });

// ROLE_PERMISSION / effectiveMode: ./agents/permissions.js

/**
 * Resolve credential env vars and return a safe object (values, not var names).
 * Logs a warning for any missing env var — does not throw.
 */
function resolveCredentials(credentials, agentId) {
  if (!credentials || !credentials.length) return [];
  return credentials.map(({ name, type, vars }) => {
    const resolved = {};
    const missing = [];
    for (const [key, envVar] of Object.entries(vars)) {
      const val = process.env[envVar];
      if (val) {
        resolved[key] = val;
      } else {
        missing.push(envVar);
      }
    }
    if (missing.length) {
      console.warn(`[env] credential "${name}" (${agentId}): missing env vars: ${missing.join(", ")}`);
    }
    return { name, type, resolved, missing };
  });
}

/**
 * Build the ENVIRONMENT context string to inject into an agent's prompt.
 * Only includes credentials with at least one resolved var.
 */
function buildEnvContext(agentId, sessionEnv) {
  if (!sessionEnv) return "";
  const mode = effectiveMode(agentId, sessionEnv.mode);
  if (mode === "none") return "";

  const creds = resolveCredentials(sessionEnv.credentials, agentId);
  const available = creds.filter(c => Object.keys(c.resolved).length > 0);
  const blockers  = creds.filter(c => c.missing.length > 0);

  const lines = [
    `ENVIRONMENT ACCESS: mode=${mode}`,
    `You MAY${mode === "read" ? " NOT execute writes —" : ""} use the following credentials:`,
  ];

  for (const c of available) {
    const kvs = Object.entries(c.resolved).map(([k, v]) => `${k}=${v}`).join(", ");
    lines.push(`  ${c.name} (${c.type}): ${kvs}`);
  }

  if (blockers.length) {
    lines.push(`BLOCKERS — missing env vars (surface in handoff):`);
    for (const c of blockers) {
      lines.push(`  ${c.name}: ${c.missing.join(", ")}`);
    }
  }

  if (mode === "read") {
    lines.push("HARD LIMIT: read-only. Do not execute, apply, insert, update, or activate anything.");
  }

  return lines.join("\n");
}

// ── Backend override (test injection only) ────────────────────────────────────
// Use setBackend("ollama") in test harness before() hooks to force local model.
// Never set via env var in production — this variable is module-scoped only.
let _backendOverride = null;
function setBackend(name) { _backendOverride = (name === "ollama") ? "ollama" : null; }

// ── Public API ────────────────────────────────────────────────────────────────

async function askAgent(agentId, userMessage, { cwd, sessionEnv, phase } = {}) {
  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent "${agentId}". Available: ${Object.keys(AGENTS).join(", ")}`);

  // Deterministic test harness (tests/e2e.strict.test.js). Never set outside that suite.
  if (process.env.ORCH_TEST_SYSTEM_PATH_HARNESS === "1") {
    if (agentId === "orchestrator" && phase === "plan") {
      const stub = JSON.stringify({
        steps: [{ agentId: "dev-backend", task: "Add multiply to utils.js" }],
      });
      const check = validateOutput(agentId, stub, { phase: "plan" });
      if (!check.valid) {
        const err = new Error(`[output contract] ${check.reason}`);
        err.gate_id = check.gate_id;
        throw err;
      }
      return { output: stub, context_stats: null };
    }
    if (agentId === "orchestrator" && phase === "decide") {
      const stub = JSON.stringify({
        done: true,
        summary: "Strict gate path: DEV and CERBERUS handoffs exercised; state store gates passed.",
      });
      const check = validateOutput(agentId, stub, { phase: "decide" });
      if (!check.valid) {
        const err = new Error(`[output contract] ${check.reason}`);
        err.gate_id = check.gate_id;
        throw err;
      }
      return { output: stub, context_stats: null };
    }
    if (agentId === "dev-backend") {
      const stub = [
        "files_read:",
        "  - utils.js",
        "files_modified:",
        "  - utils.js",
        "validation_run: node -c utils.js → exit 0",
        "",
        "Added multiply(a, b) returning a * b in utils.js.",
      ].join("\n");
      const check = validateOutput(agentId, stub, { phase });
      if (!check.valid) {
        const err = new Error(`[output contract] ${check.reason}`);
        err.gate_id = check.gate_id;
        throw err;
      }
      return { output: stub, ...extractContextStats(agentId, stub) };
    }
    if (agentId === "cerberus") {
      // No line containing the word "blocker" — avoids detectBlockers() false positives on "(none)" lines.
      const stub = [
        "verdict: pass",
        "improvement: Reviewed utils.js multiply(); validation_run node -c referenced; no further issues.",
        "nice-to-have: (none)",
      ].join("\n");
      const check = validateOutput(agentId, stub, { phase });
      if (!check.valid) {
        const err = new Error(`[output contract] ${check.reason}`);
        err.gate_id = check.gate_id;
        throw err;
      }
      return { output: stub, context_stats: null };
    }
  }

  const forceOllama = _backendOverride === "ollama" && OLLAMA_MODEL;
  if (agent.provider === "ollama" || forceOllama) {
    const model = forceOllama ? OLLAMA_MODEL : agent.model;
    let systemForOllama = agent.system;
    if (agentId === "orchestrator") {
      systemForOllama =
        phase === "decide"
          ? `${agent.system}${OLLAMA_ORCHESTRATOR_DECIDE_APPEND}`
          : `${agent.system}${OLLAMA_ORCHESTRATOR_PLAN_APPEND}`;
    } else if (forceOllama) {
      if (agentId === "architect") {
        systemForOllama = `${agent.system}${OLLAMA_ARCHITECT_SYSTEM_APPEND}`;
      } else if (agentId.startsWith("dev-")) {
        systemForOllama = `${agent.system}${OLLAMA_DEV_SYSTEM_APPEND}`;
      }
    }
    const raw = await runOllama(systemForOllama, [{ role: "user", content: userMessage }], { model });
    const rawOut = raw.content == null ? "" : String(raw.content);
    const output = agentId.startsWith("dev-") ? normalizeDevContractText(rawOut) : rawOut;
    const check = validateOutput(agentId, output, { phase });
    if (!check.valid) {
      const err = new Error(`[output contract] ${check.reason}`);
      err.gate_id = check.gate_id;
      err.rawModelOutput = rawOut.slice(0, 8000);
      throw err;
    }
    const extracted = extractContextStats(agentId, output).context_stats;
    /** @type {Record<string, number>} */
    const context_stats = { ...extracted, ...(check.context_stats || {}) };
    if (raw.prompt_eval_count != null) context_stats.ollama_prompt_tokens = raw.prompt_eval_count;
    if (raw.eval_count != null) context_stats.ollama_completion_tokens = raw.eval_count;
    return { output, context_stats };
  }
  const maxTokens = MAX_OUTPUT_TOKENS[agentId] ?? undefined;
  const envContext = sessionEnv ? buildEnvContext(agentId, sessionEnv) : "";
  const systemPrompt = envContext
    ? `${agent.system}\n\n---\n\n${envContext}`
    : agent.system;
  const prompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

  let output;
  try {
    output = runClaude(prompt, { cwd, model: agent.model, maxTokens });
  } catch (primaryErr) {
    // Primary model failed — attempt fallback per policy
    let fb;
    try { fb = resolveFallback(agentId); } catch (policyErr) {
      throw new Error(`[${agentId}] primary failed and policy blocks fallback: ${policyErr.message}. Original: ${primaryErr.message}`);
    }
    if (!_degradedAgents.has(agentId)) {
      console.warn(`[${agentId}] primary failed — degraded mode with ${fb.model} (${fb.reason})`);
    }
    _degradedAgents.add(agentId);
    output = runClaude(prompt, { cwd, model: fb.model, maxTokens });
  }

  const check = validateOutput(agentId, output, { phase });
  if (!check.valid) { const err = new Error(`[output contract] ${check.reason}`); err.gate_id = check.gate_id; throw err; }
  return { output, context_stats: check.context_stats || null };
}

async function chatWithAgent(agentId, userMessage, history = [], { cwd } = {}) {
  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent "${agentId}". Available: ${Object.keys(AGENTS).join(", ")}`);
  if (agent.provider === "ollama") {
    const messages = [...history, { role: "user", content: userMessage }];
    const raw = await runOllama(agent.system, messages, { model: agent.model });
    const reply = raw.content;
    return { reply, history: [...messages, { role: "assistant", content: reply }] };
  }
  let conversationText = "";
  for (const msg of history) {
    conversationText += `${msg.role === "user" ? "User" : agent.name}: ${msg.content}\n\n`;
  }
  conversationText += `User: ${userMessage}`;
  const reply = runClaude(`${agent.system}\n\n---\n\nConversation:\n\n${conversationText}`, { cwd, model: agent.model });
  return {
    reply,
    history: [...history, { role: "user", content: userMessage }, { role: "assistant", content: reply }],
  };
}

function listAgents() {
  return Object.entries(AGENTS).map(([id, a]) => ({ id, name: a.name, title: a.title, mode: a.mode }));
}

module.exports = {
  askAgent,
  chatWithAgent,
  listAgents,
  AGENTS,
  summarizeHandoff,
  runOllama,
  normalizeDevContractText,
  effectiveMode,
  ROLE_PERMISSION,
  resolveCredentials,
  buildEnvContext,
  CONTRACT_VERSION,
  MODEL_ROUTING,
  resolveModel,
  resolveFallback,
  FALLBACK_POLICY,
  validateOutput,
  validateCerberusSemanticFloor,
  parseCerberusTripleTemplate,
  cerberusFindingHasAnchor,
  getDegradedAgents,
  clearDegradedAgents,
  setModelProfile,
  setBackend,
};
