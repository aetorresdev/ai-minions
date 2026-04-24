/**
 * Ollama-specific system prompt appendices for ARCHITECT, DEV-*, ORCHESTRATOR (plan/decide).
 */

'use strict';

/** Appended to ARCHITECT system when `setBackend("ollama")` routes that role through Ollama (E2E / local). */
const OLLAMA_ARCHITECT_SYSTEM_APPEND = `

---
## OLLAMA — OUTPUT SHAPE (hard gate; print before any design prose)

Local models often skip structure unless it comes first. **Start your reply** with this YAML block (use real repo paths from the user task or cwd — never \`files_read: []\`):

files_read:
  - path/from/task/or/cwd.ext

Design summary:
(architecture / trade-offs / risks here — after the block above.)
`;

/** Appended to DEV-* system when `setBackend("ollama")` routes those roles through Ollama (E2E / local). */
const OLLAMA_DEV_SYSTEM_APPEND = `

---
## OLLAMA — DEV OUTPUT FORMAT (hard gate)

Start with YAML (no markdown fence before it if possible). Use real paths from the task/cwd — not placeholders.

files_read:
  - <path>
files_modified:
  - <path>
validation_run: <shell command + outcome (grep/node/npm test/wc)>

Rules: non-empty files_read and files_modified lists; every modified path must appear under files_read; validation_run required; never files_read: [].
After the YAML, at most 2 short lines of prose.
`;

/** Appended to ORCHESTRATOR system when that role is served by Ollama (local models often ignore “JSON only” in the base prompt). */
const OLLAMA_ORCHESTRATOR_PLAN_APPEND = `

---
## OLLAMA — PLAN JSON ONLY (hard gate)

Reply with **one** JSON object only. No markdown fences, no prose before or after.

Shape:
{"steps":[{"agentId":"dev-backend","task":"concrete task string"}]}

agentId must be one of: owner, architect, dev-backend, dev-frontend, dev-devops, qa, cerberus.
steps must be a non-empty array. The first character of your reply must be \`{\`.
`;

const OLLAMA_ORCHESTRATOR_DECIDE_APPEND = `

---
## OLLAMA — DECIDE JSON ONLY (hard gate)

Reply with **one** JSON object only. No markdown fences, no prose before or after.

If work is complete:
{"done":true,"summary":"one brief sentence"}

If another iteration is needed:
{"done":false,"corrections":[{"agentId":"dev-backend","task":"what to fix"}]}

The first character of your reply must be \`{\`.
`;

module.exports = {
  OLLAMA_ARCHITECT_SYSTEM_APPEND,
  OLLAMA_DEV_SYSTEM_APPEND,
  OLLAMA_ORCHESTRATOR_PLAN_APPEND,
  OLLAMA_ORCHESTRATOR_DECIDE_APPEND,
};
