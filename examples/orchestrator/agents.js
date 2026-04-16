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

const { spawnSync } = require("child_process");
const http = require("http");

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
const OLLAMA_HOST           = process.env.OLLAMA_HOST || "localhost";
const OLLAMA_PORT           = parseInt(process.env.OLLAMA_PORT || "11434", 10);

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

/**
 * Resolve the active model for a role.
 *
 * Priority (highest first):
 *   1. MODEL_OVERRIDE_<ROLE> env var          — always wins, retrocompatible
 *   2. profile overrides from models.json     — per-role within active profile
 *   3. profile default from models.json       — catch-all for active profile
 *   4. MODEL_ROUTING[role].primary            — hardcoded default (current behavior)
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
  if (!routing) throw new Error(`resolveModel: unknown role "${role}" — add it to MODEL_ROUTING in agents.js`);
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

const AGENTS = {
  // ── ORCHESTRATOR ────────────────────────────────────────────────────────────
  orchestrator: {
    name: "Orchestrator",
    title: "Orchestrator",
    mode: "ORCHESTRATOR",
    get provider() { return OLLAMA_MODEL ? "ollama" : "claude"; },
    get model() { return resolveModel("orchestrator"); },
    system: `You are the Orchestrator of an autonomous agent team. You receive a goal and coordinate
Owner, Architect, Dev (backend/frontend/devops), QA, and Cerberus agents following the MODE protocol.

MODE sequence: ORCHESTRATOR → OWNER (optional) → ARCHITECT (if design needed) → DEV → QA → CERBERUS → done or iterate.

Your responsibilities:
1. PLAN: decompose the goal into ordered steps. Each step has one agentId and a concrete task.
   Valid agentIds: owner, architect, dev-backend, dev-frontend, dev-devops, qa, cerberus.
2. DECIDE: after execution and Cerberus review, output done or corrections.

Rules:
- DEV agents must not self-review. QA reviews DEV output. Cerberus reviews after QA.
- Cerberus findings: only "blocker" items require another DEV iteration.
  "improvement" and "nice-to-have" go to backlog — they do not block the flow.
- If iteration >= max_iterations, output done=true with a note rather than looping further.
- When writing tasks, mention the relevant skill when applicable:
    backend/qa + n8n workflows      → "use the managing-n8n skill"
    devops + Terraform              → "use the creating-terraform or reviewing-terraform skill"
    devops + CI/CD                  → "use the creating-circleci or reviewing-circleci skill"
    devops + observability          → "use the configuring-observability skill"
    architect + diagrams            → "use the creating-diagrams skill"
    owner + feature spec            → "use the feature-spec-and-tasks skill"
    any code review for quality     → "use the simplify skill"

Respond with valid JSON only — no markdown, no extra text.

For "plan" request:
{ "steps": [ { "agentId": "owner"|"architect"|"dev-backend"|"dev-frontend"|"dev-devops"|"qa"|"cerberus", "task": "..." }, ... ] }

For "decide" request — done:
{ "done": true, "summary": "brief summary of what was delivered" }

For "decide" request — iterate:
{ "done": false, "corrections": [ { "agentId": "...", "task": "..." }, ... ] }`,
  },

  // ── OWNER ────────────────────────────────────────────────────────────────────
  owner: {
    name: "Owner",
    title: "Project Owner",
    mode: "OWNER",
    get model() { return resolveModel("owner"); },
    system: `---
## 🟣 ROLE: OWNER
STATE: ACTIVE

You are the Project Owner. Your role is to define scope, priorities, and definition of done.
You decide what gets built and what does not. You validate that results meet the original objective.

ALLOW: user stories, acceptance criteria, success metrics, prioritization, scope decisions.
FORBID: implementing code; detailed technical review substituting QA or Cerberus.

When a task requires a feature spec, use the feature-spec-and-tasks skill.
When given a contract or requirements to implement, use the contracts-with-llm skill.

Be concise and direct. No praise, no repetition of what you were told.`,
  },

  // ── ARCHITECT ────────────────────────────────────────────────────────────────
  architect: {
    name: "Architect",
    title: "Software / Infra Architect",
    mode: "ARCHITECT",
    get model() { return resolveModel("architect"); },
    system: `---
## 🟠 ROLE: ARCHITECT
STATE: ACTIVE

You are the Architect. Your role is to design — components, trade-offs, patterns, infrastructure.
You produce decisions and diagrams, not code.

ALLOW: component design, API contracts, infrastructure topology, trade-off analysis,
       cost controls (infra), security architecture, technology selection with justification.
FORBID: writing application code or complete HCL/Terraform (only resource proposals if the flow requires it).

Skills available — invoke via the Skill tool when relevant:
- designing-terraform: AWS infrastructure design before writing Terraform
- creating-diagrams: architecture diagrams (AWS icons PNG or Mermaid)
- contracts-with-llm: API and LLM contracts

Always produce a handoff that lists: design decisions, component list, risks, and what DEV must implement.
Be concise. No praise, no repetition.

CONTEXT EFFICIENCY: Before reading any file, declare which files are relevant to this task:
  files_read: [list only what you need]
Then read only those files, only the sections relevant to your decision.
Do not reproduce entire files in your response — summarize what you read.
One targeted read per artifact, not multiple full loads. Do not re-read the same file.`,
  },

  // ── DEV — Backend ────────────────────────────────────────────────────────────
  "dev-backend": {
    name: "Backend Dev",
    title: "Backend Developer",
    mode: "DEV",
    get model() { return resolveModel("dev-backend"); },
    system: `---
## 🟢 ROLE: DEV
STATE: ACTIVE

You are a senior backend developer. Implement per spec — APIs, data models, integrations, security.

ALLOW: write production code, run tests and linting, commit locally, document decisions in handoff.
FORBID: evaluate "overall quality" (that is QA's job); assume QA or Cerberus role;
        question requirements unless there is an explicit blocker (then surface it, do not self-resolve).

Skills available — invoke via the Skill tool when relevant:
- managing-n8n: create, validate, document, or optimize n8n workflows
- simplify: review written code for reuse, quality, and efficiency
- git-best-practices: branch naming, PR workflow, commit conventions
- claude-api: when the code uses the Anthropic SDK or Claude API

Before reading any file, declare which files are relevant:
  files_read: [list only what you need]
Then read only those files. Your handoff MUST include both fields or it will be rejected:
  files_modified: [every file you changed]
  validation_run: [commands and results]
Be concise. No praise, no repetition.`,
  },

  // ── DEV — Frontend ───────────────────────────────────────────────────────────
  "dev-frontend": {
    name: "Frontend Dev",
    title: "Frontend Developer",
    mode: "DEV",
    get model() { return resolveModel("dev-frontend"); },
    system: `---
## 🟢 ROLE: DEV
STATE: ACTIVE

You are a senior frontend developer. Implement per spec — UI components, state, API integration, accessibility.

ALLOW: write production code, verify compilation, document decisions in handoff.
FORBID: evaluate "overall quality" (that is QA's job); assume QA or Cerberus role;
        question requirements unless there is an explicit blocker.

Skills available — invoke via the Skill tool when relevant:
- simplify: review written code for reuse, quality, and efficiency
- git-best-practices: branch naming, PR workflow, commit conventions

Before reading any file, declare which files are relevant:
  files_read: [list only what you need]
Then read only those files. Your handoff MUST include both fields or it will be rejected:
  files_modified: [every file you changed]
  validation_run: [commands and results]
Be concise. No praise, no repetition.`,
  },

  // ── DEV — DevOps ─────────────────────────────────────────────────────────────
  "dev-devops": {
    name: "DevOps Dev",
    title: "DevOps Engineer",
    mode: "DEV",
    get model() { return resolveModel("dev-devops"); },
    system: `---
## 🟢 ROLE: DEV
STATE: ACTIVE

You are a senior DevOps engineer. Implement infrastructure and pipelines per the Architect's design —
Terraform, CI/CD, containers, observability.

ALLOW: write IaC and pipeline config, run dry-runs and validation (terraform validate, docker build,
       kubectl diff), commit locally, document decisions in handoff.
FORBID: redesign architecture (that is ARCHITECT's job); self-review quality (that is QA's job).

Skills available — invoke via the Skill tool when relevant:
- creating-terraform: scaffold Terraform components following team conventions
- reviewing-terraform: audit .tf files for security, naming, best practices
- creating-circleci: generate CircleCI pipeline configs
- reviewing-circleci: audit CircleCI configs
- configuring-observability: OTEL collector and Grafana dashboard configs
- reviewing-docker: audit Dockerfiles for quality and security
- git-best-practices: branch naming, PR workflow, commit conventions

Before reading any file, declare which files are relevant:
  files_read: [list only what you need]
Then read only those files. Minimum validation before handoff (Terraform): fmt → init → validate → tflint/checkov if present.
Other stacks: linter + install deps + run tests per README/CI.
If commands cannot run here, note that in handoff risks and list exact commands for QA.
Your handoff MUST include both fields or it will be rejected:
  files_modified: [every file you changed]
  validation_run: [commands and results]
Be concise. No praise, no repetition.`,
  },

  // ── QA ───────────────────────────────────────────────────────────────────────
  qa: {
    name: "QA",
    title: "QA Engineer",
    mode: "QA",
    get model() { return resolveModel("qa"); },
    system: `---
## 🔵 ROLE: QA
STATE: ACTIVE

You are the QA engineer. Your job is to break things — test cases, edge cases, evidence.

ALLOW: test cases, edge cases, acceptance checklist, run validation scripts, report real results.
       When returning findings to DEV, classify each as: blocker | improvement | nice-to-have.
       Only "blocker" items require another DEV iteration.
FORBID: write production code or change business logic; approve without evidence;
        return to DEV without classifying findings.

Skills available — invoke via the Skill tool when relevant:
- managing-n8n: validate and audit n8n workflows
- reviewing-terraform: audit Terraform changes in the delivery
- reviewing-docker: audit Dockerfiles in the delivery
- reviewing-circleci: audit CircleCI configs in the delivery

Always read the code you are testing. Run tests and report real results.
For each platform-specific artifact, invoke the relevant skill and apply its validation checklist before passing to CERBERUS. Do not approve assumptions about platform behavior without verifying them.

OUTPUT RULE: Respond only with the required format (findings list + verdict).
Any text outside this format will cause your output to be rejected.
No explanations, no praise, no repetition.`,
  },

  // ── CERBERUS ─────────────────────────────────────────────────────────────────
  cerberus: {
    name: "Cerberus",
    title: "Adversarial Reviewer",
    mode: "CERBERUS",
    get model() { return resolveModel("cerberus"); },
    system: `---
## 🔴 ROLE: CERBERUS
STATE: ACTIVE

You are Cerberus — adversarial last-mile review after DEV and QA have signed off.
You review output already approved by DEV+QA. Assume there are errors.

ALLOW: question simplicity (is there a simpler way?), security (unconsidered attack vectors?),
       design (architectural flaws DEV and QA missed?), hidden assumptions, open questions.
       Maximum: "consider option A vs B" in 1–2 lines if proposing alternatives.
FORBID: implement, patch, or propose detailed solutions in the same turn.
        You are not an additional QA — you operate after the DEV→QA flow has closed.

Skills available — invoke via the Skill tool when relevant:
- reviewing-terraform, reviewing-docker, reviewing-circleci: per artifact domain
- proposal-review: review consulting proposals or specs
- audit-patterns: detect recurring patterns across the session

Classify each finding as: blocker | improvement | nice-to-have.
Only blockers require another DEV iteration. The rest go to backlog.

MANDATORY SHAPE — your entire reply must contain these three line prefixes in order (ASCII, lowercase keys, first non-blank lines):
blocker: <one line, or exactly (none)>
improvement: <one line, or exactly (none)>
nice-to-have: <one line, or exactly (none)>

After those three lines you may add bullets with extra detail (still using blocker/improvement/nice-to-have vocabulary where relevant).
Do not reply with only acknowledgements ("review ready", "looks good", "no issues", "LGTM") — that fails the output contract.
No praise-only paragraphs before the three required lines; no proposed full solutions in this turn.`,
  },
};

// ── Ollama ────────────────────────────────────────────────────────────────────

/**
 * Call Ollama `/api/chat` (non-streaming).
 * @returns {Promise<{ content: string, prompt_eval_count?: number, eval_count?: number }>}
 *   `prompt_eval_count` / `eval_count` come from Ollama when present (C-T4 telemetry); omit when absent.
 */
function runOllama(systemPrompt, messages, { model = "qwen2.5-coder:7b", timeoutMs } = {}) {
  const body = JSON.stringify({
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    stream: false,
  });

  return new Promise((resolve, reject) => {
    const ms = timeoutMs ?? (parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10) || 180000);
    const req = http.request(
      {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.message?.content?.trim() || "";
            /** @type {{ content: string, prompt_eval_count?: number, eval_count?: number }} */
            const out = { content };
            if (typeof parsed.prompt_eval_count === "number" && !Number.isNaN(parsed.prompt_eval_count)) {
              out.prompt_eval_count = parsed.prompt_eval_count;
            }
            if (typeof parsed.eval_count === "number" && !Number.isNaN(parsed.eval_count)) {
              out.eval_count = parsed.eval_count;
            }
            resolve(out);
          } catch (e) {
            reject(new Error(`Error parsing Ollama response: ${e.message}\nRaw: ${data}`));
          }
        });
      }
    );
    req.setTimeout(ms, () => req.destroy(new Error(`Ollama timed out after ${ms}ms`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Handoff summarizer (Ollama) ───────────────────────────────────────────────

const SUMMARY_SYSTEM = `You are a technical summarizer for handoffs between agents in the same pipeline.
Your output will be read by the NEXT agent. Preserve actionable context: file names, APIs, decisions, errors.

Respond in English, in brief markdown, with these sections (use ## headings):
## Delivered / artifacts
## Files and paths (explicit list if mentioned)
## Decisions and constraints
## Commands / tests (if any)
## For the next step (pending items, risks, what the next agent must assume)

Be faithful to the source text — do not invent. If something is not stated, say "not indicated".
Max ~900 words. Prioritize what the next agent needs to avoid repeating work or breaking coherence.`;

/**
 * @returns {Promise<{ summary: string, ollama_prompt_tokens?: number, ollama_completion_tokens?: number }>}
 */
async function summarizeHandoff({ agentId, task, result, cwd, priorArtifacts = [] }) {
  const maxIn = parseInt(process.env.AI_TEAM_SUMMARIZE_MAX_INPUT_CHARS, 10) || 80000;
  const body =
    result.length > maxIn
      ? result.slice(0, maxIn) + "\n\n[... truncated for summarizer; agent produced more output ...]"
      : result;

  const priorBlock = priorArtifacts
    .filter((a) => a.handoffSummary)
    .map((a) => `### ${a.agentId}\nTask: ${a.task}\n\n${a.handoffSummary}`)
    .join("\n\n---\n\n");

  const user = `Working directory: ${cwd}

## Prior step summaries (pipeline)
${priorBlock || "(None — this is the first step.)"}

---

## Current step to summarize
- Agent: ${agentId}
- Assigned task:
${task}

## Full agent output (to condense into handoff)
${body}`;

  const model = process.env.AI_TEAM_SUMMARY_MODEL || "qwen2.5-coder:7b";
  const timeoutMs = parseInt(process.env.AI_TEAM_SUMMARY_TIMEOUT_MS, 10) || 240000;
  const raw = await runOllama(SUMMARY_SYSTEM, [{ role: "user", content: user }], { model, timeoutMs });
  return {
    summary: raw.content,
    ...(raw.prompt_eval_count != null ? { ollama_prompt_tokens: raw.prompt_eval_count } : {}),
    ...(raw.eval_count != null ? { ollama_completion_tokens: raw.eval_count } : {}),
  };
}

// ── Environment access — role permission matrix ───────────────────────────────

// Fixed permission per role. Session mode is the ceiling — roles cannot exceed it.
// "none"  = no credentials consumed
// "read"  = query, describe, logs, plan/diff, dry-run
// "write" = all read + execute, apply, insert, update, activate
const ROLE_PERMISSION = {
  orchestrator:  "none",
  owner:         "none",
  architect:     "read",
  "dev-backend": "write",
  "dev-frontend":"read",
  "dev-devops":  "write",
  qa:            "read",
  cerberus:      "read",   // hardcoded — cannot be elevated
  summarizer:    "none",
};

/**
 * Returns the effective access mode for a role given the session ceiling.
 * CERBERUS is always read regardless of session mode.
 */
function effectiveMode(agentId, sessionMode) {
  const rolePerm = ROLE_PERMISSION[agentId] ?? "none";
  if (rolePerm === "none") return "none";
  if (agentId === "cerberus") return "read";  // hardcoded
  if (sessionMode === "read") return "read";  // ceiling
  return rolePerm;  // write only if role allows and session allows
}

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

// ── Output contract validation (strict mode) ─────────────────────────────────
//
// Each role has a minimum output contract. If the output does not meet it,
// validateOutput() returns { valid: false, reason } — the caller throws.
// No silent retry. No auto-correction. Hard fail.
//
// sync: docs/orchestrator/agent-contract.md § Output contracts
// sync: CLAUDE.md § MODE protocol (role close checklist)
//
// Contracts:
//   orchestrator/plan   → JSON { steps: [{ agentId, task }] }
//   orchestrator/decide → JSON { done: bool, summary } or { done: false, corrections: [] }
//   dev-*               → mentions ≥1 file modified + ≥1 validation run
//   qa                  → ≥1 finding classified blocker|improvement|nice-to-have (token presence only)
//   cerberus            → same tokens + semantic floor + vacuous-blocker anchor when three-line template is used (sync: agent-contract.md § format vs quality)
//   owner / architect   → any non-empty output (free-form design/scope)
//   summarizer          → any non-empty output

const FINDING_RE    = /\b(blocker|improvement|nice-to-have)\b/i;

/**
 * Multi-word boilerplate substrings (length ≥ 12) — substring match OK.
 * Avoid short phrases like "looks good" that appear inside legitimate sentences.
 */
const CERBERUS_FILLER_SUBSTRINGS = [
  "code could be improved",
  "consider optimization",
  "could be improved",
  "nothing to flag",
  "nothing to report",
  "everything looks good",
  "looks good to me",
  "overall good",
  "no issues found",
  "no major issues",
  "may want to consider",
  "should be fine",
  "works as expected",
];

/** Entire field is just noise (exact match after trim + trailing dots). */
const CERBERUS_FILLER_EXACT = new Set([
  "lgtm",
  "looks good",
  "ok",
  "fine",
]);

function _normalizeFindingVal(s) {
  return String(s || "").trim().toLowerCase().replace(/[()]/g, "");
}

function _isVacuousFindingVal(val) {
  const n = _normalizeFindingVal(val);
  if (!n) return true;
  return ["none", "n/a", "na", "n.a.", "no", "...", "-"].includes(n);
}

function _cerberusLineHasFiller(val) {
  const t = String(val || "").trim().toLowerCase().replace(/\.+$/g, "");
  if (!t) return false;
  if (CERBERUS_FILLER_EXACT.has(t)) return true;
  return CERBERUS_FILLER_SUBSTRINGS.some((p) => t.includes(p));
}

/**
 * CERBERUS-SIGNAL-3anchor: when blocker is vacuous, improvement/nice-to-have need a weak textual anchor
 * (path, test ref, code span, HTTP/error-ish signal) — not proof the claim is true.
 * @param {string} s
 * @returns {boolean}
 */
function _cerberusFindingHasAnchor(s) {
  const t = String(s || "");
  if (!t.trim()) return false;
  const patterns = [
    /\b[\w./-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|tf|yaml|yml|json|md|html|css|java|kt|cs)\b/i,
    /\/[\w.-]+(?:\/[\w.-]+)+/,
    /`[^`\n]{2,}`/,
    /\b(?:unit|integration|e2e)\s+tests?\b/i,
    /\b(?:jest|mocha|pytest|vitest|cypress|playwright)\b/i,
    /\bnpm\s+test\b|\bterraform\s+validate\b|\bgo\s+test\b/i,
    /\btest\s*[(:]/i,
    /\bHTTP\s*\d{3}\b|\bstatus\s*(?:code)?\s*\d{3}\b/i,
    /\b(?:exception|stack\s*trace|throw|thrown|panic|segfault|oom)\b/i,
    /\b(?:race\s+condition|deadlock|data\s+race)\b/i,
    /\b(?:endpoint|route)\s+[`"']?\/[\w./-]+/i,
    /\bline\s+\d+\b/i,
    /\b[\w$]{3,}\([^)\n]{0,80}\)/,
  ];
  return patterns.some((re) => re.test(t));
}

/**
 * Parse leading `blocker:` / `improvement:` / `nice-to-have:` lines (markdown bullets ok).
 * @returns {{ blocker: string, improvement: string, nice: string } | null} null if not all three present
 */
function parseCerberusTripleTemplate(output) {
  const lines = String(output).split(/\r?\n/);
  const out = { blocker: null, improvement: null, nice: null };
  for (const line of lines) {
    const kb = line.match(/^[\s>*-]*blocker\s*:\s*(.*)$/i);
    if (kb && out.blocker === null) out.blocker = kb[1].trim();
    const ki = line.match(/^[\s>*-]*improvement\s*:\s*(.*)$/i);
    if (ki && out.improvement === null) out.improvement = ki[1].trim();
    const kn = line.match(/^[\s>*-]*nice-to-have\s*:\s*(.*)$/i);
    if (kn && out.nice === null) out.nice = kn[1].trim();
  }
  if (out.blocker !== null && out.improvement !== null && out.nice !== null) return out;
  return null;
}

/** Minimal semantic floor for CERBERUS when the three-line template is used. */
function validateCerberusSemanticFloor(output) {
  const t = parseCerberusTripleTemplate(output);
  if (!t) return { ok: true };

  // All three vacuous = explicit "no classified findings" — allowed so CERBERUS can finish
  // when upstream artifacts are already gate-blocked (E2E Sc15b); still passes FINDING_RE via keywords.
  if (_isVacuousFindingVal(t.blocker) && _isVacuousFindingVal(t.improvement) && _isVacuousFindingVal(t.nice)) {
    return { ok: true };
  }

  for (const [label, val] of [["blocker", t.blocker], ["improvement", t.improvement], ["nice-to-have", t.nice]]) {
    if (_cerberusLineHasFiller(val)) {
      return {
        ok: false,
        reason: `${label} reads as boilerplate filler — cite a concrete risk, path, or behavior`,
        gate_id: "cerberus_semantic_filler",
      };
    }
  }

  if (_isVacuousFindingVal(t.blocker)) {
    const hasImp = !_isVacuousFindingVal(t.improvement);
    const hasNice = !_isVacuousFindingVal(t.nice);
    if (!hasImp && !hasNice) {
      return {
        ok: false,
        reason: "vacuous blocker requires a non-empty improvement or nice-to-have line",
        gate_id: "cerberus_vacuous_without_substance",
      };
    }
    const impAnch = hasImp && _cerberusFindingHasAnchor(t.improvement);
    const niceAnch = hasNice && _cerberusFindingHasAnchor(t.nice);
    if (!impAnch && !niceAnch) {
      return {
        ok: false,
        reason:
          "vacuous blocker requires improvement or nice-to-have with an explicit anchor (file path, test/tool ref, `code`, line N, HTTP/status, error/race, or callable)",
        gate_id: "cerberus_anchor_required",
      };
    }
  }

  return { ok: true };
}
const VALIDATION_RE      = /\b(validation_run|ran|executed|tested|passed|failed|lint|pytest|npm\s+test|terraform\s+validate|node\s+|output:)\b/i;
const FILES_READ_RE      = /\bfiles?_read\s*[:-]?\s*(?:[[`'"\w]|\n\s*-)/i;
const FILES_READ_EMPTY_RE = /\bfiles?_read\s*[:-]?\s*(?:\[\s*]|:\s*\[\s*]|\s*\n(?!\s*-))/i;
const FILES_MODIFIED_RE  = /(?:files?_modified|modified)\s*[:-]\s*\n((?:\s*-\s*\S[^\n]*\n?)+)/i;

/**
 * Validate agent output against its role contract.
 * @param {string} agentId
 * @param {string} output
 * @param {{ phase?: "plan"|"decide" }} options
 * @returns {{ valid: boolean, reason: string, gate_id?: string, context_stats?: object }}
 */
function validateOutput(agentId, output, { phase } = {}) {
  if (!output || !output.trim()) {
    return { valid: false, reason: `${agentId}: empty output`, gate_id: "empty_output" };
  }

  if (agentId === "orchestrator") {
    const raw = output.trim().replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");
    const json = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    if (!json) return { valid: false, reason: "orchestrator: output is not valid JSON", gate_id: "orchestrator_json" };

    if (phase === "decide") {
      if (typeof json.done !== "boolean")
        return { valid: false, reason: "orchestrator/decide: missing 'done' boolean field", gate_id: "orchestrator_decide_done" };
      if (json.done && !json.summary)
        return { valid: false, reason: "orchestrator/decide: done=true requires 'summary'", gate_id: "orchestrator_decide_summary" };
      if (!json.done && (!Array.isArray(json.corrections) || json.corrections.length === 0))
        return { valid: false, reason: "orchestrator/decide: done=false requires non-empty 'corrections[]'", gate_id: "orchestrator_decide_corrections" };
    } else {
      if (!Array.isArray(json.steps) || json.steps.length === 0)
        return { valid: false, reason: "orchestrator/plan: 'steps' must be a non-empty array", gate_id: "orchestrator_plan_steps" };
      for (const s of json.steps) {
        if (!s.agentId || !s.task)
          return { valid: false, reason: `orchestrator/plan: step missing agentId or task — ${JSON.stringify(s)}`, gate_id: "orchestrator_plan_step_fields" };
      }
    }
    return { valid: true, reason: "" };
  }

  if (agentId === "architect") {
    if (!FILES_READ_RE.test(output))
      return { valid: false, reason: `${agentId}: output must declare files_read[] before reading artifacts`, gate_id: "files_read_missing" };
    if (FILES_READ_EMPTY_RE.test(output))
      return { valid: false, reason: `${agentId}: files_read[] must not be empty — declare at least one file`, gate_id: "files_read_empty" };
    return { valid: true, reason: "", ...extractContextStats(agentId, output) };
  }

  if (agentId.startsWith("dev-")) {
    if (!FILES_READ_RE.test(output))
      return { valid: false, reason: `${agentId}: output must declare files_read[] before reading artifacts`, gate_id: "files_read_missing" };
    if (FILES_READ_EMPTY_RE.test(output))
      return { valid: false, reason: `${agentId}: files_read[] must not be empty — declare at least one file`, gate_id: "files_read_empty" };
    if (!VALIDATION_RE.test(output))
      return { valid: false, reason: `${agentId}: output must include at least one validation run (lint, test, terraform validate, etc.)`, gate_id: "validation_run_missing" };
    // files_modified is mandatory — absence is not allowed (would bypass the cross-check gate)
    const modifiedMatch = output.match(FILES_MODIFIED_RE);
    if (!modifiedMatch)
      return { valid: false, reason: `${agentId}: output must include a files_modified: list — absence bypasses the context gate`, gate_id: "files_modified_missing" };
    // Strict mode: every file in files_modified must appear in files_read
    const modified = modifiedMatch[1].split("\n")
      .map(l => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
    const readBlock = output.match(/\bfiles?_read\s*[:-][^\n]*\n?([\s\S]*?)(?=\n\S|\n\n|$)/i)?.[0] || "";
    const unread = modified.filter(f => !readBlock.includes(f));
    if (unread.length > 0)
      return { valid: false, reason: `${agentId}: files_modified contains paths not declared in files_read: ${unread.join(", ")}`, gate_id: "files_read_vs_modified" };
    return { valid: true, reason: "", ...extractContextStats(agentId, output) };
  }

  if (agentId === "qa") {
    if (!FINDING_RE.test(output))
      return { valid: false, reason: `${agentId}: output must classify at least one finding as blocker | improvement | nice-to-have`, gate_id: "finding_classification_missing" };
    return { valid: true, reason: "" };
  }

  if (agentId === "cerberus") {
    if (!FINDING_RE.test(output))
      return { valid: false, reason: `${agentId}: output must classify at least one finding as blocker | improvement | nice-to-have`, gate_id: "finding_classification_missing" };
    const sem = validateCerberusSemanticFloor(output);
    if (!sem.ok)
      return { valid: false, reason: sem.reason, gate_id: sem.gate_id };
    return { valid: true, reason: "" };
  }

  // owner, summarizer — any non-empty output passes
  return { valid: true, reason: "" };
}

/**
 * Extract context efficiency stats from agent output.
 * Parses files_read and files_modified counts for trace metrics.
 * @param {string} agentId
 * @param {string} output
 * @returns {{ context_stats: { files_read_count: number, files_modified_count: number } }}
 */
function extractContextStats(agentId, output) {
  const readMatch  = output.match(/\bfiles?_read\s*[:-][^\n]*\n((?:\s*-\s*\S[^\n]*\n?)*)/i);
  const modMatch   = output.match(FILES_MODIFIED_RE);
  const filesRead  = readMatch  ? readMatch[1].split("\n").map(l => l.trim()).filter(l => l.startsWith("-")).length : 0;
  const filesModified = modMatch ? modMatch[1].split("\n").map(l => l.trim()).filter(l => l.startsWith("-")).length : 0;
  return { context_stats: { files_read_count: filesRead, files_modified_count: filesModified } };
}

// ── Output token limits (hard cap per role) ───────────────────────────────────
// Only applied to roles that produce structured/JSON output — not code agents.
// DEV/ARCHITECT/QA/CERBERUS are excluded: cutting mid-code breaks output.
const MAX_OUTPUT_TOKENS = {
  orchestrator: 400,   // JSON plan or decide only
  summarizer:   500,   // structured handoff summary
};

// ── Claude CLI ────────────────────────────────────────────────────────────────

function runClaude(prompt, { cwd, model, maxTokens } = {}) {
  const timeoutMs = parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10) || 180000;
  // Pass prompt via stdin ("-p -") to avoid the claude CLI arg parser treating
  // prompt content that starts with "---" or "--" as unknown CLI flags.
  const args = ["-p", "-", "--dangerously-skip-permissions"];
  if (model) args.push("--model", model);
  if (maxTokens) args.push("--max-tokens", String(maxTokens));
  const result = spawnSync("claude", args, {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
    cwd: cwd || process.cwd(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "claude CLI error");
  return result.stdout.trim();
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
    const raw = await runOllama(agent.system, [{ role: "user", content: userMessage }], { model });
    const output = raw.content;
    const check = validateOutput(agentId, output, { phase });
    if (!check.valid) { const err = new Error(`[output contract] ${check.reason}`); err.gate_id = check.gate_id; throw err; }
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
  effectiveMode,
  resolveCredentials,
  buildEnvContext,
  CONTRACT_VERSION,
  FALLBACK_POLICY,
  validateOutput,
  validateCerberusSemanticFloor,
  parseCerberusTripleTemplate,
  cerberusFindingHasAnchor: _cerberusFindingHasAnchor,
  getDegradedAgents,
  clearDegradedAgents,
  setModelProfile,
  setBackend,
};
