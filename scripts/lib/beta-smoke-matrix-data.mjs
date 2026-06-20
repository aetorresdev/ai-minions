/**
 * Canonical beta smoke matrix axes and minimum gate cells.
 * Shared by run-beta-smoke-matrix.mjs, verify-usage-docs, and tests.
 */

/** @typedef {'required' | 'experimental'} GateClass */

/**
 * @typedef {Object} MatrixCellDef
 * @property {string} id
 * @property {'linux' | 'macos' | 'docker'} os
 * @property {'ollama' | 'openai-compat-local' | 'claude-cli-api'} provider
 * @property {'single-agent' | 'multi-agent'} flow
 * @property {'trivial' | 'realistic'} task_tier
 * @property {GateClass} gate
 * @property {string} [notes]
 */

export const MATRIX_SCHEMA_VERSION = 1;

export const MINIMUM_AXES = {
  os: ["linux", "macos", "docker"],
  provider: ["ollama", "openai-compat-local", "claude-cli-api"],
  flow: ["single-agent", "multi-agent"],
  task_tier: ["trivial", "realistic"],
  evidence: ["trace", "inspect", "bundle", "failure_reason"],
};

/** @type {MatrixCellDef[]} */
export const MINIMUM_GATE_CELLS = [
  {
    id: "linux-ollama-sa-trivial",
    os: "linux",
    provider: "ollama",
    flow: "single-agent",
    task_tier: "trivial",
    gate: "required",
    notes: "Default maintainer/CI dev path; primary smoke or runner:tui",
  },
  {
    id: "linux-ollama-sa-realistic",
    os: "linux",
    provider: "ollama",
    flow: "single-agent",
    task_tier: "realistic",
    gate: "required",
    notes: "Small code change (e.g. doc fix or test) with inspect + bundle",
  },
  {
    id: "linux-ollama-ma-trivial",
    os: "linux",
    provider: "ollama",
    flow: "multi-agent",
    task_tier: "trivial",
    gate: "required",
    notes: "Supervised multi-agent header; metrics directional only",
  },
  {
    id: "macos-ollama-sa-trivial",
    os: "macos",
    provider: "ollama",
    flow: "single-agent",
    task_tier: "trivial",
    gate: "required",
    notes: "Manual Mac host attestation; see install-evidence for Ollama reachability",
  },
  {
    id: "docker-ollama-sa-trivial",
    os: "docker",
    provider: "ollama",
    flow: "single-agent",
    task_tier: "trivial",
    gate: "required",
    notes: "Docker Desktop or Linux container; OLLAMA_HOST documented",
  },
  {
    id: "linux-claude-sa-trivial",
    os: "linux",
    provider: "claude-cli-api",
    flow: "single-agent",
    task_tier: "trivial",
    gate: "required",
    notes: "Remote path; privacy gate must pass; EXCEPTION if no credentials",
  },
  {
    id: "linux-openai-compat-sa-trivial",
    os: "linux",
    provider: "openai-compat-local",
    flow: "single-agent",
    task_tier: "trivial",
    gate: "experimental",
    notes: "LM Studio / local OpenAI-compatible server; EXCEPTION allowed pre-v0.16",
  },
];

export const CELL_RESULTS = ["PASS", "FAIL", "SKIP", "PENDING", "EXCEPTION"];

/**
 * @param {unknown} record
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateMatrixRecord(record) {
  /** @type {string[]} */
  const errors = [];

  if (!record || typeof record !== "object") {
    return { ok: false, errors: ["record must be an object"] };
  }

  const r = /** @type {Record<string, unknown>} */ (record);

  if (r.schema_version !== MATRIX_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${MATRIX_SCHEMA_VERSION}`);
  }

  if (!r.cells || typeof r.cells !== "object") {
    errors.push("cells object required");
    return { ok: false, errors };
  }

  const cells = /** @type {Record<string, unknown>} */ (r.cells);

  for (const def of MINIMUM_GATE_CELLS) {
    const cell = cells[def.id];
    if (!cell || typeof cell !== "object") {
      errors.push(`missing cell: ${def.id}`);
      continue;
    }
    const c = /** @type {Record<string, unknown>} */ (cell);
    if (!CELL_RESULTS.includes(String(c.result))) {
      errors.push(`${def.id}: invalid result ${JSON.stringify(c.result)}`);
    }
    if (c.exception != null && typeof c.exception !== "object") {
      errors.push(`${def.id}: exception must be object or null`);
    }
    if (c.evidence != null && typeof c.evidence !== "object") {
      errors.push(`${def.id}: evidence must be object`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * @param {Record<string, unknown>} cells
 * @param {{ requireGatePass?: boolean }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateGateResults(cells, options = {}) {
  /** @type {string[]} */
  const errors = [];

  for (const def of MINIMUM_GATE_CELLS) {
    if (def.gate !== "required" && !options.requireGatePass) continue;
    if (def.gate === "experimental") continue;

    const cell = cells[def.id];
    if (!cell || typeof cell !== "object") {
      errors.push(`gate cell missing: ${def.id}`);
      continue;
    }
    const c = /** @type {Record<string, unknown>} */ (cell);
    const result = String(c.result);

    if (result === "PASS") continue;

    if (result === "EXCEPTION") {
      const ex = c.exception;
      if (!ex || typeof ex !== "object") {
        errors.push(`${def.id}: EXCEPTION requires exception object`);
        continue;
      }
      const approved = /** @type {Record<string, unknown>} */ (ex).cerberus_approved;
      if (approved !== true) {
        errors.push(`${def.id}: EXCEPTION without cerberus_approved`);
      }
      continue;
    }

    if (options.requireGatePass) {
      errors.push(`${def.id}: gate blocked (result=${result})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * @param {string} mdText
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateMatrixDoc(mdText) {
  /** @type {string[]} */
  const errors = [];

  if (!mdText.includes("## Minimum gate cells")) {
    errors.push("missing section: ## Minimum gate cells");
  }
  if (!mdText.includes("PASS") || !mdText.includes("EXCEPTION")) {
    errors.push("missing result vocabulary (PASS / EXCEPTION)");
  }
  for (const axis of Object.keys(MINIMUM_AXES)) {
    if (!mdText.includes(axis.replace("_", " ")) && !mdText.includes(axis)) {
      // soft check — at least one axis keyword
    }
  }
  for (const def of MINIMUM_GATE_CELLS) {
    if (!mdText.includes(def.id)) {
      errors.push(`matrix doc missing cell id: ${def.id}`);
    }
  }
  for (const os of MINIMUM_AXES.os) {
    if (!mdText.toLowerCase().includes(os)) {
      errors.push(`matrix doc missing os axis value: ${os}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * @returns {Record<string, unknown>}
 */
export function buildEmptyMatrixRecord() {
  /** @type {Record<string, unknown>} */
  const cells = {};
  for (const def of MINIMUM_GATE_CELLS) {
    cells[def.id] = {
      result: "PENDING",
      task_id: null,
      repo_commit: null,
      evidence: {
        trace: false,
        inspect: false,
        bundle: false,
        failure_reason: null,
      },
      operator: null,
      run_date: null,
      notes: def.notes ?? null,
      exception: null,
    };
  }
  return {
    schema_version: MATRIX_SCHEMA_VERSION,
    updated_at: null,
    maintainer_notes:
      "Update cells after manual smoke runs. PASS or CERBERUS-approved EXCEPTION required before external beta.",
    cells,
  };
}
