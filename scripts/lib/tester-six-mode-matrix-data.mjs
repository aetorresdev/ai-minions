/**
 * Six-mode tester matrix — agent flow × inference policy.
 * Shared by run-tester-six-mode-matrix.mjs, verify-usage-docs, and tests.
 *
 * Product policy names: local_only | remote_ok | hybrid (hybrid reserved / unsupported).
 * Issue wording "remote only" maps to remote_ok (not a separate CLI value).
 */

/** @typedef {'single_agent' | 'multi_agent'} AgentFlow */
/** @typedef {'local_only' | 'remote_ok' | 'hybrid'} InferenceMode */
/** @typedef {'pass' | 'fail' | 'skip' | 'ready'} RowStatus */
/** @typedef {'not_required' | 'any_provider'} CredentialRequirement */

/**
 * @typedef {Object} MatrixRowDef
 * @property {string} id
 * @property {AgentFlow} agent_flow
 * @property {InferenceMode} inference_mode
 * @property {string} title
 * @property {boolean} hybrid_honest_skip
 * @property {CredentialRequirement} credential_requirement
 * @property {string[]} supported_provider_env_vars
 * @property {string[]} required_local_services
 * @property {string} command_template
 * @property {string} follow_up
 */

export const MATRIX_SCHEMA_VERSION = 1;

export const REASON_CODES = Object.freeze({
  OK: "MATRIX_OK",
  DOC_FAIL: "MATRIX_DOC_FAIL",
  ROW_FAIL: "MATRIX_ROW_FAIL",
  SKIP_HYBRID_UNSUPPORTED: "MATRIX_SKIP_HYBRID_UNSUPPORTED",
  SKIP_LOCAL_BACKEND_MISSING: "MATRIX_SKIP_LOCAL_BACKEND_MISSING",
  SKIP_REMOTE_CREDENTIALS_MISSING: "MATRIX_SKIP_REMOTE_CREDENTIALS_MISSING",
  SKIP_LIVE_NOT_REQUESTED: "MATRIX_SKIP_LIVE_NOT_REQUESTED",
  READY: "MATRIX_READY",
});

/** Provider env vars accepted under any_provider (either-or, not both required). */
export const ANY_PROVIDER_ENV_VARS = Object.freeze([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
]);

/** @type {MatrixRowDef[]} */
export const SIX_MODE_ROWS = Object.freeze([
  {
    id: "sa-local_only",
    agent_flow: "single_agent",
    inference_mode: "local_only",
    title: "Single-agent + local_only",
    hybrid_honest_skip: false,
    credential_requirement: "not_required",
    supported_provider_env_vars: [],
    required_local_services: ["ollama"],
    command_template:
      "ai-minions smoke --model-policy local_only",
    follow_up:
      "ai-minions status --run-id <run_id> && ai-minions attach --run-id <run_id>",
  },
  {
    id: "sa-remote_ok",
    agent_flow: "single_agent",
    inference_mode: "remote_ok",
    title: "Single-agent + remote_ok (remote-only inference)",
    hybrid_honest_skip: false,
    credential_requirement: "any_provider",
    supported_provider_env_vars: [...ANY_PROVIDER_ENV_VARS],
    required_local_services: [],
    command_template:
      "ai-minions smoke --model-policy remote_ok",
    follow_up:
      "ai-minions status --run-id <run_id> && ai-minions attach --run-id <run_id>",
  },
  {
    id: "sa-hybrid",
    agent_flow: "single_agent",
    inference_mode: "hybrid",
    title: "Single-agent + hybrid",
    hybrid_honest_skip: true,
    credential_requirement: "any_provider",
    supported_provider_env_vars: [...ANY_PROVIDER_ENV_VARS],
    required_local_services: ["ollama"],
    command_template:
      "(unsupported) — do not pass --model-policy hybrid",
    follow_up: "N/A until hybrid policy ships",
  },
  {
    id: "ma-local_only",
    agent_flow: "multi_agent",
    inference_mode: "local_only",
    title: "Multi-agent + local_only",
    hybrid_honest_skip: false,
    credential_requirement: "not_required",
    supported_provider_env_vars: [],
    required_local_services: ["ollama"],
    command_template:
      'ai-minions start --flow multi_agent --model-policy local_only --skip-gates --iterations 1 --goal "List three files in repo root and stop"',
    follow_up:
      "ai-minions status --run-id <run_id> && ai-minions attach --run-id <run_id>",
  },
  {
    id: "ma-remote_ok",
    agent_flow: "multi_agent",
    inference_mode: "remote_ok",
    title: "Multi-agent + remote_ok (remote-only inference)",
    hybrid_honest_skip: false,
    credential_requirement: "any_provider",
    supported_provider_env_vars: [...ANY_PROVIDER_ENV_VARS],
    required_local_services: [],
    command_template:
      'ai-minions start --flow multi_agent --model-policy remote_ok --skip-gates --iterations 1 --goal "List three files in repo root and stop"',
    follow_up:
      "ai-minions status --run-id <run_id> && ai-minions attach --run-id <run_id>",
  },
  {
    id: "ma-hybrid",
    agent_flow: "multi_agent",
    inference_mode: "hybrid",
    title: "Multi-agent + hybrid",
    hybrid_honest_skip: true,
    credential_requirement: "any_provider",
    supported_provider_env_vars: [...ANY_PROVIDER_ENV_VARS],
    required_local_services: ["ollama"],
    command_template:
      "(unsupported) — do not pass --model-policy hybrid",
    follow_up: "N/A until hybrid policy ships",
  },
]);

/** Required markers in the tester six-mode runbook how-to. */
export const MATRIX_DOC_REQUIRED_MARKERS = Object.freeze([
  { needle: "sa-local_only", label: "sa-local_only row id" },
  { needle: "sa-remote_ok", label: "sa-remote_ok row id" },
  { needle: "sa-hybrid", label: "sa-hybrid row id" },
  { needle: "ma-local_only", label: "ma-local_only row id" },
  { needle: "ma-remote_ok", label: "ma-remote_ok row id" },
  { needle: "ma-hybrid", label: "ma-hybrid row id" },
  { needle: "local_only", label: "local_only policy" },
  { needle: "remote_ok", label: "remote_ok policy" },
  { needle: "hybrid", label: "hybrid policy mention" },
  { needle: "MATRIX_SKIP_HYBRID_UNSUPPORTED", label: "hybrid skip reason code" },
  { needle: "MATRIX_SKIP_REMOTE_CREDENTIALS_MISSING", label: "remote skip reason code" },
  { needle: "MATRIX_SKIP_LOCAL_BACKEND_MISSING", label: "local skip reason code" },
  { needle: "ANTHROPIC_API_KEY", label: "anthropic env var name" },
  { needle: "OPENAI_API_KEY", label: "openai env var name" },
  { needle: "OLLAMA_HOST", label: "ollama host env var" },
  { needle: "ai-minions doctor", label: "doctor preflight" },
  { needle: "ai-minions init", label: "init preflight" },
  { needle: "ai-minions status", label: "status follow-up" },
  { needle: "ai-minions attach", label: "attach follow-up" },
  { needle: "operator-feedback-issue", label: "feedback issue link" },
  { needle: "PRIVACY.md", label: "privacy prerequisite" },
  { needle: "any_provider", label: "credential sufficiency honesty" },
  { needle: "at least one", label: "at-least-one token copy" },
  { needle: "no remote token is required", label: "local_only no-token rule" },
  { needle: "no silent remote fallback", label: "local_only no-fallback rule" },
  { needle: "never secret values", label: "no secret values rule" },
  { needle: "honest skip", label: "hybrid honest skip wording" },
  { needle: "PASS", label: "pass criteria" },
  { needle: "FAIL", label: "fail criteria" },
  { needle: "SKIP", label: "skip criteria" },
  { needle: "run-tester-six-mode-matrix.mjs", label: "matrix runner script" },
]);

/**
 * @param {string} docText
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateMatrixDoc(docText) {
  /** @type {string[]} */
  const errors = [];
  if (!docText || !String(docText).trim()) {
    return { ok: false, errors: ["matrix doc empty or missing"] };
  }
  const text = String(docText);
  for (const { needle, label } of MATRIX_DOC_REQUIRED_MARKERS) {
    if (!text.includes(needle)) {
      errors.push(`missing required marker: ${label} (${needle})`);
    }
  }
  for (const row of SIX_MODE_ROWS) {
    if (!text.includes(row.id)) {
      errors.push(`missing row id: ${row.id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Env-status only — never returns or logs secret values.
 * remote_ok sufficiency = at least one of ANTHROPIC_API_KEY / OPENAI_API_KEY present.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *   anthropic: 'present' | 'missing',
 *   openai: 'present' | 'missing',
 *   any_provider: boolean,
 *   ollama_host: string,
 *   ollama_port: string,
 * }}
 */
export function assessCredentialPresence(env = process.env) {
  const anthropic = env.ANTHROPIC_API_KEY && String(env.ANTHROPIC_API_KEY).trim()
    ? "present"
    : "missing";
  const openai = env.OPENAI_API_KEY && String(env.OPENAI_API_KEY).trim()
    ? "present"
    : "missing";
  return {
    anthropic,
    openai,
    any_provider: anthropic === "present" || openai === "present",
    ollama_host: env.OLLAMA_HOST ? String(env.OLLAMA_HOST) : "127.0.0.1",
    ollama_port: env.OLLAMA_PORT ? String(env.OLLAMA_PORT) : "11434",
  };
}

/**
 * Credential sufficiency policy keyed by inference mode (not a single global claim).
 * @returns {{ local_only: CredentialRequirement, remote_ok: CredentialRequirement, hybrid: CredentialRequirement }}
 */
export function credentialRequirementByPolicy() {
  return {
    local_only: "not_required",
    remote_ok: "any_provider",
    hybrid: "any_provider",
  };
}

/**
 * @param {MatrixRowDef} row
 * @param {{
 *   credentials?: ReturnType<typeof assessCredentialPresence>,
 *   localBackendReachable?: boolean | null,
 *   skipLive?: boolean,
 * }} [options]
 * @returns {{
 *   id: string,
 *   status: RowStatus,
 *   reason_code: string,
 *   message: string,
 *   command: string,
 *   credential_requirement: CredentialRequirement,
 * }}
 */
export function assessMatrixRow(row, options = {}) {
  const credentials = options.credentials ?? assessCredentialPresence();
  const skipLive = options.skipLive !== false;
  const localReachable = options.localBackendReachable;

  if (row.hybrid_honest_skip || row.inference_mode === "hybrid") {
    return {
      id: row.id,
      status: "skip",
      reason_code: REASON_CODES.SKIP_HYBRID_UNSUPPORTED,
      message:
        "hybrid model policy is not implemented — honest skip (do not claim pass)",
      command: row.command_template,
      credential_requirement: row.credential_requirement,
    };
  }

  const needsLocal = row.required_local_services.includes("ollama");
  if (needsLocal && localReachable === false) {
    return {
      id: row.id,
      status: "skip",
      reason_code: REASON_CODES.SKIP_LOCAL_BACKEND_MISSING,
      message:
        "local Ollama endpoint not reachable — skip (not a false pass)",
      command: row.command_template,
      credential_requirement: row.credential_requirement,
    };
  }

  if (row.credential_requirement === "any_provider" && !credentials.any_provider) {
    return {
      id: row.id,
      status: "skip",
      reason_code: REASON_CODES.SKIP_REMOTE_CREDENTIALS_MISSING,
      message:
        `no supported provider token present (need at least one of ${row.supported_provider_env_vars.join(" or ")}) — skip`,
      command: row.command_template,
      credential_requirement: row.credential_requirement,
    };
  }

  if (skipLive) {
    return {
      id: row.id,
      status: "skip",
      reason_code: REASON_CODES.SKIP_LIVE_NOT_REQUESTED,
      message:
        "credentials/endpoints appear sufficient for a live attempt; live smoke not requested (--skip-live)",
      command: row.command_template,
      credential_requirement: row.credential_requirement,
    };
  }

  return {
    id: row.id,
    status: "ready",
    reason_code: REASON_CODES.READY,
    message:
      "row eligible for live tester execution (manual runbook or --run-ready readiness only; does not execute smoke)",
    command: row.command_template,
    credential_requirement: row.credential_requirement,
  };
}

/**
 * @param {{
 *   credentials?: ReturnType<typeof assessCredentialPresence>,
 *   localBackendReachable?: boolean | null,
 *   skipLive?: boolean,
 * }} [options]
 */
export function assessAllRows(options = {}) {
  return SIX_MODE_ROWS.map((row) => assessMatrixRow(row, options));
}
