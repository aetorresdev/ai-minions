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

const { askAgent, summarizeHandoff } = require("./agents");
const { formatArtifactLine, envInt, truncateForContext } = require("./context-utils");
const { spawnSync } = require("child_process");
const { randomUUID } = require("crypto");

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

function agentLabel(agentId) {
  const color = AGENT_COLORS[agentId] || "";
  return `${color}${BOLD}[${agentId}]${RESET}`;
}

function log(agentId, message) {
  const ts = new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`${DIM}${ts}${RESET} ${agentLabel(agentId)} ${message}`);
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
 * An empty or unparseable YAML passes (compact-handoff may not have run).
 *
 * Required keys:
 *   DEV      → files_modified OR validation_run
 *   QA       → verdict AND (findings OR issues)
 *   CERBERUS → verdict AND blockers must be empty/absent
 *
 * Returns { valid: boolean, reason: string }
 */
function validateHandoffStructure(mode, yaml) {
  if (!yaml || !yaml.trim()) return { valid: true, reason: "" };

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
 * }} options
 */
async function run(goal, options = {}) {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const cwd           = options.cwd || process.cwd();
  const flowMode      = options.flowMode || "single_agent";
  const taskId        = options.taskId || `task-${randomUUID().slice(0, 8)}`;
  const approvedArtifacts = options.approvedArtifacts || [];
  const skipStateMcp  = options.skipStateMcp === true;

  const maxContextChars = options.maxContextCharsPerArtifact
    ?? envInt("AI_TEAM_MAX_CONTEXT_CHARS", DEFAULT_MAX_CONTEXT_CHARS);
  const maxReviewChars  = options.maxReviewCharsPerArtifact
    ?? envInt("AI_TEAM_MAX_REVIEW_CHARS_PER_ARTIFACT", DEFAULT_MAX_REVIEW_CHARS);
  const stepSummary = options.stepSummary !== undefined
    ? Boolean(options.stepSummary)
    : process.env.AI_TEAM_STEP_SUMMARY !== "0";

  const artifacts = [];
  let plan        = { steps: [] };
  let iterations  = 0;
  let done        = false;
  let summary     = "";
  let currentMode = "ORCHESTRATOR";

  log("orchestrator", `Working directory: ${cwd}`);
  log("orchestrator", `task_id: ${taskId} | flow: ${flowMode} | max_iterations: ${maxIterations}`);
  log("orchestrator", `Context: ${stepSummary ? "Ollama handoff between steps" : "no Ollama summary"}; truncation: ${maxContextChars > 0 ? `${maxContextChars} chars/step` : "off"}`);

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
      }, { cwd });
      if (!reg.ok) throw new Error(reg.error || "register_task failed");
      log("gate", `Task registered — envelope: ${reg.envelope_path}`);
    } catch (err) {
      log("gate", `WARNING: Could not register task in state store (${err.message}). Continuing without hard gates.`);
    }
  }

  // ── Phase 1: plan ─────────────────────────────────────────────────────────────
  log("orchestrator", "Planning...");
  const planPrompt = `MODE: ORCHESTRATOR
FLOW: ${flowMode}
GOAL: ${goal}
MAX_ITERATIONS: ${maxIterations}
Working directory: ${cwd}

Decompose this goal into ordered execution steps following the MODE protocol.
Assign one agent per step. Reply with JSON only.`;

  const planResponse = await askAgent("orchestrator", planPrompt, { cwd });
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
  while (!done && iterations < maxIterations) {
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
    for (const step of steps) {
      const agentId = step.agentId || step.agent;
      if (!agentId || !VALID_WORKER_AGENTS.has(agentId)) continue;

      const contextBlock = contextHeader + [goal, ...artifacts.map(contextChunk)].join("\n\n---\n\n");
      log(agentId, `Executing: ${step.task.slice(0, 80)}${step.task.length > 80 ? "..." : ""}`);

      const result = await askAgent(
        agentId,
        `Working directory: ${cwd}\n\nContext:\n${contextBlock}\n\nYour task:\n${step.task}`,
        { cwd }
      );

      // ── Compact handoff (compact-handoff MCP) ──────────────────────────────
      let handoffYaml = "";
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
          log("gate", `WARNING: compact_handoff failed (${err.message}). Using empty handoff.`);
        }
      }

      // ── Structural handoff validation (per-MODE key check) ────────────────
      if (AGENTS_REQUIRING_GATE.has(agentId) && handoffYaml) {
        const sv = validateHandoffStructure(toMode, handoffYaml);
        if (!sv.valid) {
          log("gate", `🟥 Handoff structure invalid (${toMode}): ${sv.reason}`);
          artifacts.push({ agentId, task: step.task, result, handoffYaml,
            gateBlocked: true, gateReason: `handoff_structure: ${sv.reason}` });
          continue;
        }
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
            artifacts.push({ agentId, task: step.task, result, handoffYaml,
              gateBlocked: true, gateReason: `goal_alignment: ${alignment.notes}` });
            continue;
          } else {
            log("gate", `🟩 Goal aligned (confidence: ${alignment.confidence ?? "n/a"})`);
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
            artifacts.push({ agentId, task: step.task, result, handoffYaml,
              gateBlocked: true, gateReason: (vt.errors || []).join("; ") });
            continue;
          }

          log("gate", `🟩 Transition allowed — advancing to ${nextMode}`);
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
        ...(handoffSummary ? { handoffSummary } : {}),
      });
      log(agentId, `Done (${result.length} chars)`);
    }

    // ── Cerberus review ───────────────────────────────────────────────────────
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
Only blockers require another DEV iteration.`;

    const cerberusResult = await askAgent("cerberus", cerberusPrompt, { cwd });
    log("cerberus", `Review ready (${cerberusResult.length} chars)`);

    // ── Compact cerberus handoff + advance to ORCHESTRATOR ────────────────────
    if (!skipStateMcp) {
      try {
        const cerberusHandoff = callCompactHandoff({
          text: cerberusResult,
          modeCompleted: "CERBERUS",
          nextMode: "ORCHESTRATOR",
          iteration: iterations,
          maxIterations,
          flowMode,
        }, { cwd });

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
        log("gate", `WARNING: Cerberus gate error (${err.message})`);
      }
    }

    // ── ORCHESTRATOR decides ──────────────────────────────────────────────────
    log("orchestrator", "Evaluating result...");
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

Cerberus review:
${cerberusResult}

Is this done? Remember: only Cerberus "blocker" findings require another iteration.
"improvement" and "nice-to-have" findings go to backlog — they do not block completion.
Reply with JSON only.`;

    const decideResponse = await askAgent("orchestrator", decidePrompt, { cwd });
    const decide = extractJson(decideResponse);

    if (decide && decide.done === true) {
      done = true;
      summary = decide.summary || "Completed.";
      log("orchestrator", `✓ Done: ${summary}`);
    } else if (decide && Array.isArray(decide.corrections) && decide.corrections.length > 0) {
      log("orchestrator", `↻ Iterating — ${decide.corrections.length} correction(s):`);
      decide.corrections.forEach((c) =>
        log(c.agentId || "?", `Correction: ${c.task.slice(0, 80)}${c.task.length > 80 ? "..." : ""}`)
      );
      plan = { steps: decide.corrections };
    } else {
      done = true;
      summary = "Stopped (no corrections or invalid orchestrator response).";
      log("orchestrator", summary);
    }
  }

  if (!done) {
    summary = `Stopped after ${maxIterations} iteration(s).`;
    log("orchestrator", summary);
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

  return { done, summary, artifacts, iterations, taskId };
}

module.exports = { run };
