/**
 * Handoff summarizer (Ollama /api/chat).
 */

'use strict';

const { runOllama } = require('./run-ollama');

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

module.exports = { summarizeHandoff };
