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
 */

const { spawnSync } = require("child_process");
const http = require("http");

// ── Contract version ──────────────────────────────────────────────────────────
// Bump when handoff schema, role permissions, or gate sequence change.
// Passed to register_task so the envelope records the version that produced it.
const CONTRACT_VERSION = "1.0";

// ── Degraded-agent tracking ───────────────────────────────────────────────────
// When an agent falls back to a secondary model, its id is added here.
// The orchestrator reads this after each step via getDegradedAgents().
// clearDegradedAgents() is called at the start of each run.
const _degradedAgents = new Set();
function getDegradedAgents() { return new Set(_degradedAgents); }
function clearDegradedAgents() { _degradedAgents.clear(); }

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
 * Resolve the active model for a role, respecting env overrides.
 * @param {string} role - agent id
 * @returns {string} model id
 */
function resolveModel(role) {
  const envKey = `MODEL_OVERRIDE_${role.toUpperCase().replace(/-/g, "_")}`;
  if (process.env[envKey]) return process.env[envKey];
  return MODEL_ROUTING[role]?.primary ?? "claude-sonnet-4-6";
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
    system: `MODE: OWNER

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
    system: `MODE: ARCHITECT

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
    system: `MODE: DEV

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
    system: `MODE: DEV

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
    system: `MODE: DEV

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
    system: `MODE: QA

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
    system: `MODE: CERBERUS

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
OUTPUT RULE: Respond only with classified findings (blocker | improvement | nice-to-have).
Any narrative outside finding entries will cause your output to be rejected.
No praise, no repetition, no proposed solutions.`,
  },
};

// ── Ollama ────────────────────────────────────────────────────────────────────

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
        hostname: "localhost",
        port: 11434,
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
            resolve(parsed.message?.content?.trim() || "");
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

async function summarizeHandoff({ agentId, task, result, cwd, priorArtifacts = [] }) {
  const maxIn = parseInt(process.env.AI_TEAM_SUMMARIZE_MAX_INPUT_CHARS, 10) || 80000;
  let body = result.length > maxIn
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
  return runOllama(SUMMARY_SYSTEM, [{ role: "user", content: user }], { model, timeoutMs });
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
// Contracts:
//   orchestrator/plan   → JSON { steps: [{ agentId, task }] }
//   orchestrator/decide → JSON { done: bool, summary } or { done: false, corrections: [] }
//   dev-*               → mentions ≥1 file modified + ≥1 validation run
//   qa / cerberus       → ≥1 finding classified blocker|improvement|nice-to-have
//   owner / architect   → any non-empty output (free-form design/scope)
//   summarizer          → any non-empty output

const FINDING_RE    = /\b(blocker|improvement|nice-to-have)\b/i;
const FILE_RE       = /(?:files?_modified|modified|changed|updated|created|edited)\s*[:\-]?\s*\S|[`'"]?\/[\w./-]+\.\w{1,6}[`'"]?/i;
const VALIDATION_RE = /\b(validation_run|ran|executed|tested|passed|failed|lint|pytest|npm\s+test|terraform\s+validate|node\s+|output:)\b/i;
const FILES_READ_RE      = /\bfiles?_read\s*[:\-]?\s*(?:[\[`'"\w]|\n\s*-)/i;
const FILES_READ_EMPTY_RE = /\bfiles?_read\s*[:\-]?\s*(?:\[\s*\]|:\s*\[\s*\]|\s*\n(?!\s*-))/i;
const FILES_MODIFIED_RE  = /(?:files?_modified|modified)\s*[:\-]\s*\n((?:\s*-\s*\S[^\n]*\n?)+)/i;

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
    const readBlock = output.match(/\bfiles?_read\s*[:\-][^\n]*\n?([\s\S]*?)(?=\n\S|\n\n|$)/i)?.[0] || "";
    const unread = modified.filter(f => !readBlock.includes(f));
    if (unread.length > 0)
      return { valid: false, reason: `${agentId}: files_modified contains paths not declared in files_read: ${unread.join(", ")}`, gate_id: "files_read_vs_modified" };
    return { valid: true, reason: "", ...extractContextStats(agentId, output) };
  }

  if (agentId === "qa" || agentId === "cerberus") {
    if (!FINDING_RE.test(output))
      return { valid: false, reason: `${agentId}: output must classify at least one finding as blocker | improvement | nice-to-have`, gate_id: "finding_classification_missing" };
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
  const readMatch  = output.match(/\bfiles?_read\s*[:\-][^\n]*\n((?:\s*-\s*\S[^\n]*\n?)*)/i);
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
  const args = ["-p", prompt, "--dangerously-skip-permissions"];
  if (model) args.push("--model", model);
  if (maxTokens) args.push("--max-tokens", String(maxTokens));
  const result = spawnSync("claude", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
    cwd: cwd || process.cwd(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "claude CLI error");
  return result.stdout.trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

async function askAgent(agentId, userMessage, { cwd, sessionEnv, phase } = {}) {
  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent "${agentId}". Available: ${Object.keys(AGENTS).join(", ")}`);
  if (agent.provider === "ollama") {
    const output = await runOllama(agent.system, [{ role: "user", content: userMessage }], { model: agent.model });
    const check = validateOutput(agentId, output, { phase });
    if (!check.valid) { const err = new Error(`[output contract] ${check.reason}`); err.gate_id = check.gate_id; throw err; }
    return { output, context_stats: check.context_stats || null };
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
    const reply = await runOllama(agent.system, messages, { model: agent.model });
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

module.exports = { askAgent, chatWithAgent, listAgents, AGENTS, summarizeHandoff, runOllama, effectiveMode, resolveCredentials, buildEnvContext, CONTRACT_VERSION, FALLBACK_POLICY, validateOutput, getDegradedAgents, clearDegradedAgents };
