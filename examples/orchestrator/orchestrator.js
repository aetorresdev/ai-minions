/**
 * Autonomous orchestrator loop following the MODE protocol.
 *
 * Flow per iteration:
 *   1. ORCHESTRATOR plans (Ollama → JSON steps)
 *   2. Each step runs the assigned agent (claude CLI)
 *   3. compact-handoff MCP compacts each agent output → YAML
 *   4. orchestrator-state MCP validates alignment + gates the transition
 *   5. CERBERUS reviews the full iteration output
 *   6. ORCHESTRATOR decides: done or corrections (blockers only)
 *
 * Hard gates (orchestrator-state MCP):
 *   - register_task at session start
 *   - validate_goal_alignment before every DEV→QA and QA→CERBERUS advance
 *   - validate_transition dry-run before advance_mode
 *   - advance_mode records every MODE transition on disk
 *   - close_task at session end
 *
 * Requires:
 *   - claude CLI in PATH with active session
 *   - Ollama at localhost:11434 with qwen2.5-coder:7b
 *   - orchestrator-state MCP registered (claude mcp add orchestrator-state ...)
 *   - compact-handoff MCP registered (claude mcp add compact-handoff ...)
 */

const { askAgent, summarizeHandoff, CONTRACT_VERSION, getDegradedAgents, clearDegradedAgents } = require("./agents");
const { formatArtifactLine, envInt, truncateForContext } = require("./context-utils");
const { spawnSync } = require("child_process");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

// ── Execution trace ───────────────────────────────────────────────────────────
// Writes one JSONL event per step to ~/.claude/metrics/traces/<task_id>.jsonl
// Event types: session_start, agent_start, agent_done, gate_result,
//              contract_fail, iteration_done, session_end
//
// Sensitive field handling:
//   goal  → truncated to 80 chars + SHA-256 hash (TRACE_REDACT_GOAL=1 omits text entirely)
//   task  → truncated to 120 chars
//   reason/summary → truncated to 300 chars
// Trace write failures emit a one-time stderr warning (not silenced).

const TRACES_DIR = path.join(require("os").homedir(), ".claude", "metrics", "traces");
const TRACE_REDACT_GOAL = process.env.TRACE_REDACT_GOAL === "1";
let _traceWarnEmitted = false;

function _hashGoal(text) {
  return require("crypto").createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function _sanitize(event) {
  const out = { ...event };
  if ("goal" in out) {
    const h = _hashGoal(out.goal);
    out.goal = TRACE_REDACT_GOAL ? `[redacted:${h}]` : `${String(out.goal).slice(0, 80)}… [sha256:${h}]`;
  }
  if ("task"    in out) out.task    = String(out.task).slice(0, 120);
  if ("reason"  in out) out.reason  = String(out.reason).slice(0, 300);
  if ("summary" in out) out.summary = String(out.summary).slice(0, 300);
  return out;
}

function traceEvent(taskId, event) {
  try {
    fs.mkdirSync(TRACES_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), task_id: taskId, ..._sanitize(event) });
    fs.appendFileSync(path.join(TRACES_DIR, `${taskId}.jsonl`), line + "\n");
  } catch (err) {
    if (!_traceWarnEmitted) {
      process.stderr.write(`[trace] WARNING: could not write trace (${err.message}) — tracing disabled for this session\n`);
      _traceWarnEmitted = true;
    }
  }
}

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_MAX_CONTEXT_CHARS = 12000;
const DEFAULT_MAX_REVIEW_CHARS = 0;

const AGENT_COLORS = {
  orchestrator:  "\x1b[90m",  // gray
  owner:         "\x1b[35m",  // magenta
  architect:     "\x1b[36m",  // cyan
  "dev-backend": "\x1b[32m",  // green
  "dev-frontend":"\x1b[34m",  // blue
  "dev-devops":  "\x1b[33m",  // yellow
  qa:            "\x1b[33m",  // yellow
  cerberus:      "\x1b[31m",  // red
  summarizer:    "\x1b[96m",  // bright cyan
  gate:          "\x1b[95m",  // magenta bright
};
const RESET = "\x1b[0m";
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";

const AGENT_ICONS = {
  orchestrator:  "◉",
  owner:         "◆",
  architect:     "⬢",
  "dev-backend": "●",
  "dev-frontend":"●",
  "dev-devops":  "●",
  qa:            "▲",
  cerberus:      "✕",
  summarizer:    "◈",
  gate:          "⊙",
};

function agentLabel(agentId) {
  const color = AGENT_COLORS[agentId] || "";
  const icon  = AGENT_ICONS[agentId] || "·";
  return `${color}${BOLD}${icon} [${agentId.toUpperCase()}]${RESET}`;
}

function log(agentId, message) {
  const ts = new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`${DIM}${ts}${RESET} ${agentLabel(agentId)} ${message}`);
}

function logRoleSwitch(fromId, toId) {
  const fromColor = AGENT_COLORS[fromId] || "";
  const toColor   = AGENT_COLORS[toId]   || "";
  const fromIcon  = AGENT_ICONS[fromId]  || "·";
  const toIcon    = AGENT_ICONS[toId]    || "·";
  const sep = "─".repeat(52);
  console.log(`\n${DIM}${sep}${RESET}`);
  console.log(`${fromColor}${BOLD}${fromIcon} ${fromId.toUpperCase()}${RESET} ${BOLD}→${RESET} ${toColor}${BOLD}${toIcon} ${toId.toUpperCase()}${RESET}`);
  console.log(`${DIM}${sep}${RESET}\n`);
}

const AGENT_STATE_FILE = require("os").homedir() + "/.claude/metrics/active-agent.json";

function writeAgentState(agentId, goal) {
  try {
    const goalHash = _hashGoal(goal);
    const goalField = TRACE_REDACT_GOAL
      ? `[redacted:${goalHash}]`
      : `${String(goal).slice(0, 80)}… [sha256:${goalHash}]`;
    require("fs").writeFileSync(AGENT_STATE_FILE, JSON.stringify({
      flow: "multi_agent",
      goal: goalField,
      active_agent: agentId.toUpperCase(),
      updated_at: new Date().toISOString(),
    }));
  } catch { /* non-fatal */ }
}

function extractJson(text) {
  const trimmed = text.trim();
  const block = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = block ? block[1].trim() : trimmed;
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Handoff structural validation ────────────────────────────────────────────

/**
 * Shallow key-presence check on a handoff YAML string per MODE.
 * No semantic parsing — validates structural completeness only.
 *
 * @param {string} mode - ORCHESTRATOR mode (DEV, QA, CERBERUS, ...)
 * @param {string} yaml - handoff YAML produced by compact-handoff MCP
 * @param {{ strict?: boolean }} options
 *   strict=false (default): empty YAML passes — compact-handoff may not be registered
 *   strict=true:            empty YAML fails — compact-handoff is required in strict mode
 *
 * Required keys:
 *   DEV      → files_modified OR validation_run
 *   QA       → verdict AND (findings OR issues)
 *   CERBERUS → verdict AND blockers must be empty/absent
 *
 * Returns { valid: boolean, reason: string }
 */
function validateHandoffStructure(mode, yaml, { strict = false } = {}) {
  if (!yaml || !yaml.trim()) {
    if (strict) return { valid: false, reason: `${mode} handoff is empty — compact_handoff must be called before advance_mode in strict mode` };
    return { valid: true, reason: "" };
  }

  // Extract top-level keys from YAML without a full parser
  // Matches "key:" at the start of a line (with optional leading spaces)
  const presentKeys = new Set();
  for (const line of yaml.split("\n")) {
    const m = line.match(/^\s{0,2}(\w[\w_-]*):/);
    if (m) presentKeys.add(m[1]);
  }

  if (mode === "DEV") {
    if (!presentKeys.has("files_modified") && !presentKeys.has("validation_run")) {
      return { valid: false, reason: "DEV handoff must include files_modified or validation_run" };
    }
  } else if (mode === "QA") {
    if (!presentKeys.has("verdict")) {
      return { valid: false, reason: "QA handoff must include verdict" };
    }
    if (!presentKeys.has("findings") && !presentKeys.has("issues")) {
      return { valid: false, reason: "QA handoff must include findings or issues" };
    }
  } else if (mode === "CERBERUS") {
    if (!presentKeys.has("verdict")) {
      return { valid: false, reason: "CERBERUS handoff must include verdict" };
    }
    // Block if blockers key is present with a non-empty list
    if (presentKeys.has("blockers")) {
      const blockersMatch = yaml.match(/^blockers\s*:\s*\n((?:\s+-[^\n]+\n?)+)/m);
      if (blockersMatch) {
        return { valid: false, reason: "CERBERUS handoff has open blockers — resolve before closing" };
      }
    }
  }

  return { valid: true, reason: "" };
}

// ── MCP gate helpers ──────────────────────────────────────────────────────────

/**
 * Call an orchestrator-state MCP tool via the claude CLI.
 * Returns parsed JSON response or throws on failure.
 */
function callStateMcp(toolName, args, { cwd } = {}) {
  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  const prompt = `Call the MCP tool orchestrator-state.${toolName} with these arguments and return only the raw JSON response, no other text:\n${toolName}(${argsStr})`;
  const timeoutMs = parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10) || 60000;
  const result = spawnSync("claude", ["-p", prompt, "--dangerously-skip-permissions"], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: timeoutMs,
    cwd: cwd || process.cwd(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "claude CLI error calling MCP");
  const parsed = extractJson(result.stdout.trim());
  if (!parsed) throw new Error(`orchestrator-state.${toolName} returned non-JSON: ${result.stdout.slice(0, 300)}`);
  return parsed;
}

/**
 * Call compact-handoff MCP to compact agent output into handoff YAML.
 */
/**
 * When true, compact_handoff failure is a hard gate (gateBlocked).
 * When false, failure uses explicit fallback metadata (run continues in degraded mode).
 * Default: same as strict mode — derived from !skipStateMcp unless overridden.
 */
function resolveRequireHandoff(options) {
  if (typeof options.requireHandoff === "boolean") return options.requireHandoff;
  return options.skipStateMcp !== true;
}

/** Structured metadata when compact_handoff fails in degraded mode (policy B). */
function compactHandoffDegradedMeta(err) {
  const msg = err && err.message ? String(err.message) : "unknown error";
  return {
    handoff_compression: "unavailable",
    handoff_fallback_used: true,
    handoff_error: msg,
  };
}

/** Artifact fields when compact_handoff fails in strict mode (policy A). */
function compactHandoffStrictFailureFields(err) {
  const msg = err && err.message ? String(err.message) : "unknown error";
  return {
    handoffYaml: "",
    gateBlocked: true,
    gateReason: `compact_handoff failed: ${msg}`,
    handoff_compression: "failed",
    handoff_error: msg,
  };
}

function callCompactHandoff({ text, modeCompleted, nextMode, iteration, maxIterations, flowMode }, { cwd } = {}) {
  const prompt = `Call the MCP tool compact-handoff.compact_handoff with these arguments and return only the raw YAML string, no other text:
compact_handoff(
  text=${JSON.stringify(text)},
  mode_completed=${JSON.stringify(modeCompleted)},
  next_mode=${JSON.stringify(nextMode)},
  iteration=${iteration},
  max_iterations=${maxIterations},
  flow_mode=${JSON.stringify(flowMode)}
)`;
  const timeoutMs = parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10) || 120000;
  const result = spawnSync("claude", ["-p", prompt, "--dangerously-skip-permissions"], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: timeoutMs,
    cwd: cwd || process.cwd(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "claude CLI error calling compact-handoff");
  return result.stdout.trim();
}

// ── Blocker detection (deterministic) ────────────────────────────────────────
//
// Parses CERBERUS output for blocker findings without model interpretation.
// Returns { count, items } where items are the matched lines.
//
// Matches lines like:
//   - blocker: missing validation
//   **blocker** — no auth check
//   type: blocker
//   [blocker] broken flow
//
const BLOCKER_LINE_RE = /^.*\bblocker\b.*$/gim;

function detectBlockers(cerberusOutput) {
  const matches = cerberusOutput.match(BLOCKER_LINE_RE) || [];
  return { count: matches.length, items: matches.map(l => l.trim()) };
}

// ── MODE mapping ──────────────────────────────────────────────────────────────

const AGENT_TO_MODE = {
  owner:         "OWNER",
  architect:     "ARCHITECT",
  "dev-backend": "DEV",
  "dev-frontend":"DEV",
  "dev-devops":  "DEV",
  qa:            "QA",
  cerberus:      "CERBERUS",
};

const VALID_WORKER_AGENTS = new Set(Object.keys(AGENT_TO_MODE));

// Agents that require compact_handoff + validate_goal_alignment before advancing
const AGENTS_REQUIRING_GATE = new Set(["dev-backend", "dev-frontend", "dev-devops", "qa", "cerberus"]);

// ── Ollama connectivity check ─────────────────────────────────────────────────

/**
 * Ping Ollama API to verify it is reachable.
 * Returns true if Ollama responds, false otherwise.
 */
function checkOllama() {
  const host = process.env.OLLAMA_HOST || "localhost";
  const port = parseInt(process.env.OLLAMA_PORT || "11434", 10);
  return new Promise((resolve) => {
    const http = require("http");
    const req = http.request({ hostname: host, port, path: "/api/tags", method: "GET" }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
    req.end();
  });
}

// ── Environment access parsing ────────────────────────────────────────────────

/**
 * Parse the ENVIRONMENT block from a session prompt header.
 * Supports:
 *   ENVIRONMENT:
 *     mode: read | write
 *     credentials:
 *       - name: n8n
 *         type: api_key
 *         vars:
 *           url: N8N_URL
 *           key: N8N_API_KEY
 *
 * Returns null if no ENVIRONMENT block found.
 * Returns { mode: "read"|"write", credentials: [{ name, type, vars: {} }] }
 */
function parseEnvironment(prompt) {
  // Extract everything after ENVIRONMENT: until next top-level key or end
  const envMatch = prompt.match(/^ENVIRONMENT:\s*\n((?:[ \t]+[^\n]*\n?)*)/m);
  if (!envMatch) return null;

  const block = envMatch[1];

  // Parse mode
  const modeMatch = block.match(/^\s+mode:\s*(read|write)\s*$/m);
  const mode = modeMatch ? modeMatch[1] : "read";  // default: read (safe)

  // Parse credentials list — each starts with "- name:"
  const credentials = [];
  const credBlocks = block.split(/\n\s+-\s+name:/);
  for (let i = 1; i < credBlocks.length; i++) {
    const cb = credBlocks[i];
    const name = cb.match(/^([^\n]+)/)?.[1]?.trim();
    const type = cb.match(/\btype:\s*([^\n]+)/)?.[1]?.trim();
    if (!name || !type) continue;

    // Parse vars block (indented key: ENV_VAR pairs)
    const vars = {};
    const varsMatch = cb.match(/\bvars:\s*\n((?:\s{8,}[^\n]+\n?)*)/);
    if (varsMatch) {
      for (const line of varsMatch[1].split("\n")) {
        const kv = line.match(/^\s+(\w+):\s*([^\s#][^\n]*)/);
        if (kv) vars[kv[1].trim()] = kv[2].trim();
      }
    }
    credentials.push({ name, type, vars });
  }

  return { mode, credentials };
}

// ── Main run function ─────────────────────────────────────────────────────────

/**
 * Runs the orchestrator loop.
 * @param {string} goal - Goal / epic / task description
 * @param {{
 *   maxIterations?: number,
 *   cwd?: string,
 *   flowMode?: string,
 *   taskId?: string,
 *   approvedArtifacts?: string[],
 *   maxContextCharsPerArtifact?: number,
 *   maxReviewCharsPerArtifact?: number,
 *   stepSummary?: boolean,
 *   skipStateMcp?: boolean
 *   requireHandoff?: boolean — if set, overrides default: strict (!skipStateMcp) requires compact_handoff; degraded skips hard fail
 * }} options
 */
async function run(goal, options = {}) {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const cwd           = options.cwd || process.cwd();
  const flowMode      = options.flowMode || "single_agent";
  const taskId        = options.taskId || `task-${randomUUID().slice(0, 8)}`;
  const approvedArtifacts = options.approvedArtifacts || [];
  const skipStateMcp  = options.skipStateMcp === true;
  const requireHandoff = resolveRequireHandoff(options);

  const maxContextChars = options.maxContextCharsPerArtifact
    ?? envInt("AI_TEAM_MAX_CONTEXT_CHARS", DEFAULT_MAX_CONTEXT_CHARS);
  const maxReviewChars  = options.maxReviewCharsPerArtifact
    ?? envInt("AI_TEAM_MAX_REVIEW_CHARS_PER_ARTIFACT", DEFAULT_MAX_REVIEW_CHARS);
  const stepSummary = options.stepSummary !== undefined
    ? Boolean(options.stepSummary)
    : process.env.AI_TEAM_STEP_SUMMARY !== "0";

  const sessionEnv = options.sessionEnv || parseEnvironment(goal) || null;

  const artifacts = [];
  let plan        = { steps: [] };
  let iterations  = 0;
  let done          = false;
  let summary       = "";
  let manualReview  = false;  // set true in gate-blocked or CERBERUS-unresolved paths
  let currentMode = "ORCHESTRATOR";
  const degradedInRun = new Set(); // agents that ran in fallback at least once this run
  clearDegradedAgents();

  log("orchestrator", `Working directory: ${cwd}`);
  log("orchestrator", `task_id: ${taskId} | flow: ${flowMode} | max_iterations: ${maxIterations}`);
  if (sessionEnv) {
    const credNames = sessionEnv.credentials.map(c => c.name).join(", ");
    log("orchestrator", `Environment: mode=${sessionEnv.mode} | credentials: ${credNames || "none"}`);
  }

  // ── Ollama connectivity check ────────────────────────────────────────────────
  const ollamaModel = process.env.OLLAMA_MODEL || null;
  if (ollamaModel) {
    const ollamaOk = await checkOllama();
    if (!ollamaOk) {
      log("orchestrator", `WARNING: OLLAMA_MODEL=${ollamaModel} set but Ollama unreachable at ${process.env.OLLAMA_HOST || "localhost"}:${process.env.OLLAMA_PORT || "11434"}. orchestrator/summarizer will use claude-haiku fallback.`);
    } else {
      log("orchestrator", `Ollama ready — model: ${ollamaModel}`);
    }
  } else {
    log("orchestrator", "Ollama not configured (OLLAMA_MODEL unset) — orchestrator/summarizer using claude-haiku.");
  }
  log("orchestrator", `Context: ${stepSummary ? "Ollama handoff between steps" : "no Ollama summary"}; truncation: ${maxContextChars > 0 ? `${maxContextChars} chars/step` : "off"}`);
  traceEvent(taskId, {
    event: "session_start",
    flow_mode: flowMode,
    max_iterations: maxIterations,
    cwd,
    goal: goal.slice(0, 200),
    require_handoff: requireHandoff,
  });

  // ── Degraded mode banner ──────────────────────────────────────────────────────
  if (skipStateMcp) {
    const YELLOW = "\x1b[33m", BOLD = "\x1b[1m", RESET = "\x1b[0m";
    console.log(`\n${YELLOW}${BOLD}⚠  DEGRADED MODE — hard gates DISABLED${RESET}`);
    console.log(`${YELLOW}   orchestrator-state and compact-handoff MCPs are not active.`);
    console.log(`   No transitions are recorded. No goal alignment is checked.`);
    console.log(`   No approved-artifact enforcement. Output contracts still apply.`);
    console.log(`   Run without --skip-gates to enable strict mode.\n${RESET}`);
    traceEvent(taskId, { event: "degraded_mode", reason: "skipStateMcp=true" });
  }

  // ── Register task (state store) ──────────────────────────────────────────────
  if (!skipStateMcp) {
    log("gate", `Registering task "${taskId}" in state store...`);
    try {
      const reg = callStateMcp("register_task", {
        goal,
        task_id: taskId,
        flow_mode: flowMode,
        max_iterations: maxIterations,
        approved_artifacts: JSON.stringify(approvedArtifacts),
        contract_version: CONTRACT_VERSION,
      }, { cwd });
      if (!reg.ok) throw new Error(reg.error || "register_task failed");
      log("gate", `Task registered — envelope: ${reg.envelope_path}`);
    } catch (err) {
      log("gate", `\x1b[33m\x1b[1m⚠  DEGRADED MODE — state store unavailable\x1b[0m (${err.message}). Continuing without hard gates.`);
      traceEvent(taskId, { event: "degraded_mode", reason: err.message });
    }
  }

  // ── Phase 1: plan ─────────────────────────────────────────────────────────────
  log("orchestrator", "Planning...");
  const multiAgentPlanConstraint =
    flowMode === "multi_agent"
      ? `

Hard requirement for FLOW multi_agent: "steps" MUST include at least one implementation agent (agentId dev-backend, dev-frontend, or dev-devops) with a concrete code-edit task, and a later step with agentId qa that reviews that implementation. For goals that change source files, do NOT emit a plan with only owner or architect — those roles scope or design; implementation and QA review are mandatory in this flow.`
      : "";
  const planPrompt = `MODE: ORCHESTRATOR
FLOW: ${flowMode}
GOAL: ${goal}
MAX_ITERATIONS: ${maxIterations}
Working directory: ${cwd}

Decompose this goal into ordered execution steps following the MODE protocol.
Assign one agent per step. Reply with JSON only.${multiAgentPlanConstraint}`;

  const { output: planResponse } = await askAgent("orchestrator", planPrompt, { cwd, sessionEnv, phase: "plan" });
  const parsed = extractJson(planResponse);
  if (parsed && Array.isArray(parsed.steps)) {
    plan = parsed;
    log("orchestrator", `Plan ready — ${plan.steps.length} step(s):`);
    plan.steps.forEach((s, i) => log(s.agentId || "?", `Step ${i + 1}: ${s.task}`));
  }

  // ── Advance ORCHESTRATOR → first MODE ────────────────────────────────────────
  const firstAgent = plan.steps[0]?.agentId;
  if (!skipStateMcp && firstAgent && AGENT_TO_MODE[firstAgent]) {
    try {
      callStateMcp("advance_mode", {
        task_id: taskId,
        to_mode: AGENT_TO_MODE[firstAgent],
        from_mode: "ORCHESTRATOR",
        handoff_yaml: "",
        iteration: -1,
      }, { cwd });
      currentMode = AGENT_TO_MODE[firstAgent];
    } catch (err) {
      log("gate", `WARNING: advance_mode failed (${err.message})`);
    }
  }

  // ── Main loop ─────────────────────────────────────────────────────────────────
  const RED = "\x1b[31m", BOLD_C = "\x1b[1m", RESET_C = "\x1b[0m";
  while (!done && iterations < maxIterations) {
    if (skipStateMcp) {
      console.log(`${RED}${BOLD_C}  ⚠ NO HARD GATES ACTIVE — iteration unprotected${RESET_C}`);
    }
    iterations += 1;
    log("orchestrator", `── Iteration ${iterations}/${maxIterations} ──`);

    const steps = plan.steps && plan.steps.length ? plan.steps : [];
    const contextHeader = stepSummary
      ? "Prior steps = Ollama handoff summaries. Full detail is in the repo/cwd — open cited files as needed.\n\n"
      : maxContextChars > 0
        ? "Prior steps may be truncated; use cwd, git diff, and mentioned paths.\n\n"
        : "";

    function contextChunk(a) {
      return stepSummary && a.handoffSummary
        ? `## Handoff (${a.agentId})\n${a.handoffSummary}`
        : formatArtifactLine(a, maxContextChars);
    }

    // ── Execute each step ───────────────────────────────────────────────────────
    let previousAgentId = null;
    for (const step of steps) {
      const agentId = step.agentId || step.agent;
      if (!agentId || !VALID_WORKER_AGENTS.has(agentId)) continue;

      if (previousAgentId && previousAgentId !== agentId) logRoleSwitch(previousAgentId, agentId);
      previousAgentId = agentId;

      const contextBlock = contextHeader + [goal, ...artifacts.map(contextChunk)].join("\n\n---\n\n");
      writeAgentState(agentId, goal);
      log(agentId, `Executing: ${step.task.slice(0, 80)}${step.task.length > 80 ? "..." : ""}`);
      const stepStart = Date.now();
      traceEvent(taskId, { event: "agent_start", agent: agentId, iteration: iterations, task: step.task.slice(0, 200) });

      let result, contextStats;
      try {
        const agentResult = await askAgent(
          agentId,
          `Working directory: ${cwd}\n\nContext:\n${contextBlock}\n\nYour task:\n${step.task}`,
          { cwd, sessionEnv }
        );
        result = agentResult.output;
        contextStats = agentResult.context_stats || null;
      } catch (err) {
        const duration_ms = Date.now() - stepStart;
        const isCritical = ["architect", "qa", "cerberus"].includes(agentId);
        const gateId = err.gate_id || null;
        traceEvent(taskId, { event: "contract_fail", agent: agentId, iteration: iterations, duration_ms, reason: err.message.slice(0, 300), critical: isCritical, ...(gateId ? { gate_id: gateId } : {}) });
        log(agentId, `🟥 Output contract failed: ${err.message}`);
        artifacts.push({ agentId, task: step.task, result: "", gateBlocked: true, gateReason: err.message });
        if (isCritical) {
          log(agentId, `🟥 Critical role contract fail — stopping iteration (no QA/CERBERUS/ARCHITECT degradation allowed)`);
          break;
        }
        continue;
      }
      // Collect any agents that fell back to a secondary model during this call
      for (const id of getDegradedAgents()) degradedInRun.add(id);
      clearDegradedAgents();
      const stepDegraded = degradedInRun.has(agentId);
      traceEvent(taskId, { event: "agent_done", agent: agentId, iteration: iterations, duration_ms: Date.now() - stepStart, output_chars: result.length, ...(stepDegraded ? { degraded: true } : {}) });
      if (contextStats) traceEvent(taskId, { event: "context_stats", agent: agentId, iteration: iterations, ...contextStats });

      // ── Compact handoff (compact-handoff MCP) ──────────────────────────────
      let handoffYaml = "";
      /** @type {Record<string, unknown>} */
      let handoffCompressionMeta = {};
      const toMode = AGENT_TO_MODE[agentId];
      const nextStepIdx = steps.indexOf(step) + 1;
      const nextAgent   = steps[nextStepIdx]?.agentId;
      const nextMode    = nextAgent ? (AGENT_TO_MODE[nextAgent] || "ORCHESTRATOR") : "ORCHESTRATOR";

      if (AGENTS_REQUIRING_GATE.has(agentId)) {
        log("gate", `Compacting handoff for ${agentId} → ${nextMode}...`);
        try {
          handoffYaml = callCompactHandoff({
            text: result,
            modeCompleted: toMode,
            nextMode,
            iteration: iterations,
            maxIterations,
            flowMode,
          }, { cwd });
          log("gate", `Handoff YAML ready (${handoffYaml.length} chars)`);
        } catch (err) {
          const msg = err.message || String(err);
          if (requireHandoff) {
            traceEvent(taskId, {
              event: "compact_handoff_failed",
              agent: agentId,
              iteration: iterations,
              message: msg.slice(0, 400),
              phase: "worker_step",
            });
            log("gate", `🟥 compact_handoff failed (strict — hard fail): ${msg}`);
            artifacts.push({
              agentId,
              task: step.task,
              result,
              ...compactHandoffStrictFailureFields(err),
            });
            continue;
          }
          traceEvent(taskId, {
            event: "compact_handoff_fallback",
            agent: agentId,
            iteration: iterations,
            message: msg.slice(0, 400),
            phase: "worker_step",
          });
          handoffCompressionMeta = compactHandoffDegradedMeta(err);
          log("gate", `⚠ compact_handoff unavailable (degraded — continuing without YAML compression): ${msg}`);
        }
      }

      // ── Structural handoff validation (per-MODE key check) ────────────────
      if (AGENTS_REQUIRING_GATE.has(agentId)) {
        const sv = validateHandoffStructure(toMode, handoffYaml, { strict: requireHandoff });
        if (!sv.valid) {
          log("gate", `🟥 Handoff structure invalid (${toMode}): ${sv.reason}`);
          traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, gate: "handoff_structure", passed: false, reason: sv.reason });
          artifacts.push({ agentId, task: step.task, result, handoffYaml,
            gateBlocked: true, gateReason: `handoff_structure: ${sv.reason}` });
          continue;
        }
        traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, gate: "handoff_structure", passed: true });
      }

      // ── validate_goal_alignment + advance_mode ─────────────────────────────
      if (!skipStateMcp && AGENTS_REQUIRING_GATE.has(agentId) && handoffYaml) {
        try {
          log("gate", `Validating goal alignment for ${agentId}...`);
          const alignment = callStateMcp("validate_goal_alignment", {
            task_id: taskId,
            handoff_yaml: handoffYaml,
          }, { cwd });

          if (!alignment.ok) {
            log("gate", `WARNING: validate_goal_alignment failed: ${alignment.error}`);
          } else if (alignment.aligned === false) {
            log("gate", `🟥 Goal not aligned: ${alignment.notes}. Skipping advance_mode for this step.`);
            traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, gate: "goal_alignment", passed: false, confidence: alignment.confidence, reason: alignment.notes });
            artifacts.push({ agentId, task: step.task, result, handoffYaml,
              gateBlocked: true, gateReason: `goal_alignment: ${alignment.notes}` });
            continue;
          } else {
            log("gate", `🟩 Goal aligned (confidence: ${alignment.confidence ?? "n/a"})`);
            traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, gate: "goal_alignment", passed: true, confidence: alignment.confidence });
          }

          log("gate", `validate_transition: ${currentMode} → ${nextMode} (iteration ${iterations})`);
          const vt = callStateMcp("validate_transition", {
            task_id: taskId,
            from_mode: currentMode,
            to_mode: nextMode,
            handoff_yaml: handoffYaml,
            iteration: iterations,
          }, { cwd });

          if (!vt.allowed) {
            log("gate", `🟥 Transition blocked: ${(vt.errors || []).join("; ")}`);
            traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, gate: "transition", from_mode: currentMode, to_mode: nextMode, passed: false, reason: (vt.errors || []).join("; ") });
            artifacts.push({ agentId, task: step.task, result, handoffYaml,
              gateBlocked: true, gateReason: (vt.errors || []).join("; ") });
            continue;
          }

          log("gate", `🟩 Transition allowed — advancing to ${nextMode}`);
          traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, gate: "transition", from_mode: currentMode, to_mode: nextMode, passed: true });
          const adv = callStateMcp("advance_mode", {
            task_id: taskId,
            to_mode: nextMode,
            from_mode: currentMode,
            handoff_yaml: handoffYaml,
            iteration: iterations,
          }, { cwd });

          if (adv.ok) {
            currentMode = nextMode;
            log("gate", `Mode advanced → ${currentMode}`);
          } else {
            log("gate", `WARNING: advance_mode returned ok=false: ${adv.error || JSON.stringify(adv.errors)}`);
          }
        } catch (err) {
          log("gate", `WARNING: State MCP gate error (${err.message}). Continuing without gate.`);
        }
      }

      // ── Ollama step summary ────────────────────────────────────────────────
      let handoffSummary = "";
      if (stepSummary) {
        log("summarizer", `Summarizing ${agentId} output (Ollama)...`);
        try {
          handoffSummary = await summarizeHandoff({ agentId, task: step.task, result, cwd, priorArtifacts: artifacts });
          log("summarizer", `Summary ready (${handoffSummary.length} chars)`);
        } catch (err) {
          log("summarizer", `Ollama failed (${err.message}); next step uses truncation.`);
        }
      }

      artifacts.push({
        agentId,
        task: step.task,
        result,
        handoffYaml,
        gateBlocked: false,
        ...(handoffSummary ? { handoffSummary } : {}),
        ...(Object.keys(handoffCompressionMeta).length ? handoffCompressionMeta : {}),
      });
      log(agentId, `Done (${result.length} chars)`);
    }

    // ── Cerberus review ───────────────────────────────────────────────────────
    logRoleSwitch(previousAgentId || "orchestrator", "cerberus");
    log("cerberus", "Reviewing deliverables...");
    const reviewChunks = artifacts.map((a) => {
      const { text } = truncateForContext(a.result, maxReviewChars);
      return `## ${a.agentId} — ${a.task}\n\n${text}`;
    });
    const cerberusPrompt = `Working directory: ${cwd}

Original goal: ${goal}

Deliverables from iteration ${iterations}:

${reviewChunks.join("\n\n---\n\n")}

Review the above. Classify each finding as blocker | improvement | nice-to-have.
Only blockers require another DEV iteration.

Your reply must begin with these three lines in this exact order (use (none) when a category has nothing to report; no preamble before blocker:):
blocker: ...
improvement: ...
nice-to-have: ...`;

    const { output: cerberusResult } = await askAgent("cerberus", cerberusPrompt, { cwd, sessionEnv });
    log("cerberus", `Review ready (${cerberusResult.length} chars)`);

    // ── Compact cerberus handoff + advance to ORCHESTRATOR ────────────────────
    if (!skipStateMcp) {
      let cerberusHandoff = "";
      try {
        cerberusHandoff = callCompactHandoff({
          text: cerberusResult,
          modeCompleted: "CERBERUS",
          nextMode: "ORCHESTRATOR",
          iteration: iterations,
          maxIterations,
          flowMode,
        }, { cwd });
      } catch (err) {
        const msg = err.message || String(err);
        if (requireHandoff) {
          traceEvent(taskId, {
            event: "compact_handoff_failed",
            agent: "cerberus",
            iteration: iterations,
            message: msg.slice(0, 400),
            phase: "cerberus_advance",
          });
          log("gate", `🟥 compact_handoff failed (strict — CERBERUS → ORCHESTRATOR): ${msg}`);
          artifacts.push({
            agentId: "cerberus",
            task: "(session review) Deliverable review before decide",
            result: cerberusResult,
            ...compactHandoffStrictFailureFields(err),
          });
        } else {
          traceEvent(taskId, {
            event: "compact_handoff_fallback",
            agent: "cerberus",
            iteration: iterations,
            message: msg.slice(0, 400),
            phase: "cerberus_advance",
          });
          log("gate", `⚠ compact_handoff unavailable (degraded — CERBERUS advance): ${msg}`);
        }
      }
      if (cerberusHandoff) {
        try {
          const vt = callStateMcp("validate_transition", {
            task_id: taskId,
            from_mode: "CERBERUS",
            to_mode: "ORCHESTRATOR",
            handoff_yaml: cerberusHandoff,
            iteration: iterations,
          }, { cwd });

          if (vt.allowed) {
            callStateMcp("advance_mode", {
              task_id: taskId,
              to_mode: "ORCHESTRATOR",
              from_mode: "CERBERUS",
              handoff_yaml: cerberusHandoff,
              iteration: iterations,
            }, { cwd });
            currentMode = "ORCHESTRATOR";
          }
        } catch (err) {
          log("gate", `WARNING: Cerberus transition gate error (${err.message})`);
        }
      }
    }

    // ── Hard blocker enforcement (deterministic) ──────────────────────────────
    // Detect blockers from CERBERUS output directly — does not rely on the
    // orchestrator model to interpret whether iteration is required.
    // If blockers exist and iterations remain → force iterate.
    // If no blockers → allow orchestrator to declare done.
    const cerberusBlockers = detectBlockers(cerberusResult);
    traceEvent(taskId, { event: "cerberus_check", iteration: iterations, blockers: cerberusBlockers.count, items: cerberusBlockers.items.slice(0, 5) });

    if (cerberusBlockers.count > 0 && iterations < maxIterations) {
      log("cerberus", `🟥 ${cerberusBlockers.count} blocker(s) detected — forcing iteration (deterministic)`);
      cerberusBlockers.items.forEach(b => log("cerberus", `  ↳ ${b.slice(0, 120)}`));

      // Ask orchestrator only for corrections — done=true is not an option when blockers exist
      const artifactsBlob = artifacts
        .map((a) => {
          const { text } = truncateForContext(a.result, maxReviewChars);
          return `## ${a.agentId}\nTask: ${a.task}\n\n${text}`;
        })
        .join("\n\n---\n\n");

      const correctPrompt = `Original goal:
${goal}

Iteration: ${iterations}/${maxIterations}

Deliverables:
${artifactsBlob}

Cerberus blockers (must be fixed):
${cerberusBlockers.items.join("\n")}

List the correction steps required. Reply with JSON: { "done": false, "corrections": [{ "agentId": "...", "task": "..." }] }`;

      logRoleSwitch("cerberus", "orchestrator");
      const { output: correctResponse } = await askAgent("orchestrator", correctPrompt, { cwd, sessionEnv, phase: "decide" });
      const corrections = extractJson(correctResponse);
      if (corrections && Array.isArray(corrections.corrections) && corrections.corrections.length > 0) {
        log("orchestrator", `↻ Correcting — ${corrections.corrections.length} step(s):`);
        corrections.corrections.forEach((c) =>
          log(c.agentId || "?", `Correction: ${c.task.slice(0, 80)}${c.task.length > 80 ? "..." : ""}`)
        );
        traceEvent(taskId, { event: "iteration_done", iteration: iterations, outcome: "iterate", blockers: cerberusBlockers.count, corrections: corrections.corrections.length });
        plan = { steps: corrections.corrections };
      } else {
        // Orchestrator failed to produce corrections — generate generic DEV retry
        log("orchestrator", "WARNING: orchestrator returned no corrections — retrying last DEV steps");
        traceEvent(taskId, { event: "iteration_done", iteration: iterations, outcome: "iterate_fallback", blockers: cerberusBlockers.count });
        plan = { steps: artifacts.filter(a => a.agentId?.startsWith("dev-")).map(a => ({ agentId: a.agentId, task: `Fix blockers: ${cerberusBlockers.items.slice(0, 2).join("; ")}` })) };
      }
      continue;
    }

    if (cerberusBlockers.count > 0 && iterations >= maxIterations) {
      done = false;
      manualReview = true;
      summary = `Max iterations reached with ${cerberusBlockers.count} gate-blocked CERBERUS finding(s). Manual review required.`;
      log("orchestrator", `⚠ ${summary}`);
      traceEvent(taskId, { event: "iteration_done", iteration: iterations, outcome: "max_iterations_with_blockers", blockers: cerberusBlockers.count });
      continue;
    }

    // ── Gate-blocked artifact enforcement ────────────────────────────────────
    // Any artifact with gateBlocked:true in this iteration is an implicit blocker.
    // gateBlocked means a hard contract or gate failed — CERBERUS silence does not clear it.
    // This covers: output contract failures (missing files_read, files_modified,
    // validation_run), handoff structure failures, and goal alignment failures.
    const gateBlockedArtifacts = artifacts.filter(a => a.gateBlocked);
    if (gateBlockedArtifacts.length > 0) {
      const gateBlockReasons = gateBlockedArtifacts.map(a => `${a.agentId}: ${a.gateReason || "gate blocked"}`);
      traceEvent(taskId, { event: "gate_blocked_completion", iteration: iterations, count: gateBlockedArtifacts.length, reasons: gateBlockReasons });
      if (iterations < maxIterations) {
        log("orchestrator", `🟥 ${gateBlockedArtifacts.length} gate-blocked artifact(s) — cannot mark done (forcing iteration):`);
        gateBlockReasons.forEach(r => log("orchestrator", `  ↳ ${r}`));
        traceEvent(taskId, { event: "iteration_done", iteration: iterations, outcome: "gate_blocked_iterate", gate_blocks: gateBlockedArtifacts.length });
        // Retry the blocked steps
        plan = { steps: gateBlockedArtifacts.map(a => ({ agentId: a.agentId, task: a.task })) };
        continue;
      } else {
        done = false;
        manualReview = true;
        summary = `Max iterations reached with ${gateBlockedArtifacts.length} gate-blocked artifact(s). Manual review required. Blocked: ${gateBlockReasons.join("; ")}`;
        log("orchestrator", `⚠ ${summary}`);
        traceEvent(taskId, { event: "iteration_done", iteration: iterations, outcome: "max_iterations_with_gate_blocks", gate_blocks: gateBlockedArtifacts.length });
        continue;
      }
    }

    // ── ORCHESTRATOR decides (no blockers path) ───────────────────────────────
    logRoleSwitch("cerberus", "orchestrator");
    log("orchestrator", "No blockers — evaluating completion...");
    const artifactsBlob = artifacts
      .map((a) => {
        const { text } = truncateForContext(a.result, maxReviewChars);
        return `## ${a.agentId}\nTask: ${a.task}\n\n${text}`;
      })
      .join("\n\n---\n\n");

    const decidePrompt = `Original goal:
${goal}

Iteration: ${iterations}/${maxIterations}

Deliverables:
${artifactsBlob}

Cerberus review (no blockers):
${cerberusResult}

No blockers were found. Confirm completion or list any remaining corrections.
Reply with JSON only.`;

    let decideResponse = "";
    try {
      const { output } = await askAgent("orchestrator", decidePrompt, { cwd, sessionEnv, phase: "decide" });
      decideResponse = output;
    } catch (decideErr) {
      log("orchestrator", `⚠ Decide contract failed (${decideErr.message}) — treating as stopped`);
      traceEvent(taskId, { event: "decide_contract_fail", reason: decideErr.message });
    }
    const decide = extractJson(decideResponse);

    if (decide && decide.done === true) {
      done = true;
      summary = decide.summary || "Completed.";
      log("orchestrator", `✓ Done: ${summary}`);
      traceEvent(taskId, { event: "iteration_done", iteration: iterations, outcome: "done", summary: summary.slice(0, 200) });
    } else if (decide && Array.isArray(decide.corrections) && decide.corrections.length > 0) {
      log("orchestrator", `↻ Iterating — ${decide.corrections.length} correction(s):`);
      decide.corrections.forEach((c) =>
        log(c.agentId || "?", `Correction: ${c.task.slice(0, 80)}${c.task.length > 80 ? "..." : ""}`)
      );
      traceEvent(taskId, { event: "iteration_done", iteration: iterations, outcome: "iterate", corrections: decide.corrections.length });
      plan = { steps: decide.corrections };
    } else {
      done = true;
      summary = "Stopped (no corrections or invalid orchestrator response).";
      log("orchestrator", summary);
      traceEvent(taskId, { event: "iteration_done", iteration: iterations, outcome: "stopped", summary });
    }
  }

  if (!done && !summary) {
    summary = `Stopped after ${maxIterations} iteration(s).`;
    log("orchestrator", summary);
  }

  // ── Surface degraded compact_handoff fallback in summary (structured data is on artifacts) ──
  const handoffFallbackArtifacts = artifacts.filter((a) => a.handoff_fallback_used === true);
  if (handoffFallbackArtifacts.length > 0) {
    const agents = [...new Set(handoffFallbackArtifacts.map((a) => a.agentId))].join(", ");
    const err0 = handoffFallbackArtifacts[0].handoff_error || "unknown";
    const note = `[handoff compression unavailable for ${agents} — continued without compact_handoff; error: ${String(err0).slice(0, 120)}]`;
    summary = summary ? `${summary}\n${note}` : note;
  }

  // ── Record session summary artifact before closing ───────────────────────
  if (!skipStateMcp) {
    try {
      const sessionSummary = [
        `goal: ${goal}`,
        `iterations: ${iterations}/${maxIterations}`,
        `agents_run: ${[...new Set(artifacts.map(a => a.agentId))].join(", ")}`,
        `outcome: ${summary}`,
        artifacts.length > 0
          ? `last_artifacts:\n${artifacts.slice(-3).map(a => `  - ${a.agentId}: ${a.task.slice(0, 80)}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n");

      callStateMcp("record_artifact", {
        task_id: taskId,
        artifact_id: "session-summary",
        content: sessionSummary,
        agent_id: "orchestrator",
      }, { cwd });
      log("gate", "Session summary recorded in envelope.");
    } catch (err) {
      log("gate", `WARNING: record_artifact failed (${err.message})`);
    }
  }

  // ── Close task (state store) ──────────────────────────────────────────────
  if (!skipStateMcp) {
    try {
      callStateMcp("close_task", { task_id: taskId, reason: summary }, { cwd });
      log("gate", `Task "${taskId}" closed in state store.`);
    } catch (err) {
      log("gate", `WARNING: close_task failed (${err.message})`);
    }
  }

  // Clear active agent state
  try { require("fs").unlinkSync(AGENT_STATE_FILE); } catch { /* already gone */ }

  const qaDegraded = degradedInRun.has("qa");
  if (qaDegraded) {
    log("qa", "⚠ QA ran in degraded mode (fallback model) — coverage may be reduced. Manual review recommended.");
  }
  const manualReviewRecommended = qaDegraded || manualReview;
  const handoffFallbackAny = artifacts.some((a) => a.handoff_fallback_used === true);
  traceEvent(taskId, {
    event: "session_end",
    iterations,
    done,
    summary: summary.slice(0, 200),
    agents_run: [...new Set(artifacts.map((a) => a.agentId))],
    gate_blocks: artifacts.filter((a) => a.gateBlocked).length,
    ...(qaDegraded ? { qa_degraded: true } : {}),
    ...(manualReviewRecommended ? { manual_review_recommended: true } : {}),
    ...(handoffFallbackAny ? { handoff_fallback_used: true } : {}),
  });

  return { done, summary, artifacts, iterations, taskId };
}

module.exports = {
  run,
  detectBlockers,
  validateHandoffStructure,
  _sanitize,
  _hashGoal,
  resolveRequireHandoff,
  compactHandoffDegradedMeta,
  compactHandoffStrictFailureFields,
};
