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
const MODEL_ROUTING = {
  // Ollama-native roles — local is the primary, no fallback needed
  orchestrator: { primary: "qwen2.5-coder:7b",      fallback: null,                        localSafe: true  },
  summarizer:   { primary: "qwen2.5-coder:7b",      fallback: null,                        localSafe: true  },

  // Claude roles — grouped by local-safety
  owner:        { primary: "claude-haiku-4-5-20251001", fallback: "qwen2.5-coder:7b",      localSafe: true  },
  "dev-backend":{ primary: "claude-sonnet-4-6",        fallback: "claude-haiku-4-5-20251001", localSafe: false },
  "dev-frontend":{ primary: "claude-sonnet-4-6",       fallback: "claude-haiku-4-5-20251001", localSafe: false },
  "dev-devops": { primary: "claude-sonnet-4-6",        fallback: "claude-haiku-4-5-20251001", localSafe: false },
  architect:    { primary: "claude-sonnet-4-6",        fallback: null,                        localSafe: false },
  qa:           { primary: "claude-sonnet-4-6",        fallback: "claude-haiku-4-5-20251001", localSafe: false },
  cerberus:     { primary: "claude-sonnet-4-6",        fallback: null,                        localSafe: false },
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

const AGENTS = {
  // ── ORCHESTRATOR ────────────────────────────────────────────────────────────
  orchestrator: {
    name: "Orchestrator",
    title: "Orchestrator",
    mode: "ORCHESTRATOR",
    provider: "ollama",
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
Be concise. No praise, no repetition.`,
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

Always read existing files before modifying them. Write changes directly to the filesystem.
Run tests and linting. Include validation_run results in your handoff.
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

Always read existing files before modifying them. Write changes directly to the filesystem.
Include validation_run results (compile check, lint) in your handoff.
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

Minimum validation before handoff (Terraform): fmt → init → validate → tflint/checkov if present.
Other stacks: linter + install deps + run tests per README/CI.
If commands cannot run here, note that in handoff risks and list exact commands for QA.
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

async function askAgent(agentId, userMessage, { cwd } = {}) {
  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent "${agentId}". Available: ${Object.keys(AGENTS).join(", ")}`);
  if (agent.provider === "ollama") {
    return runOllama(agent.system, [{ role: "user", content: userMessage }], { model: agent.model });
  }
  const maxTokens = MAX_OUTPUT_TOKENS[agentId] ?? undefined;
  return runClaude(`${agent.system}\n\n---\n\n${userMessage}`, { cwd, model: agent.model, maxTokens });
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

module.exports = { askAgent, chatWithAgent, listAgents, AGENTS, summarizeHandoff, runOllama };
