'use strict';

/**
 * Live harness — execute canonical fixtures through ai-minions operator contracts.
 * Shared by the six-mode matrix (--execute-live) and TUI guided launcher post-run path.
 * Never calls provider APIs directly. Readiness alone is never PASS.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  buildGuidedLauncherModel,
  LAUNCHER_REASON,
} = require('./operator-guided-launcher-model');
const { runOperatorStatus } = require('./operator-trace-command');

const LIVE_HARNESS_SCHEMA = '1';

/** Lazy to avoid circular requires with guided-first-run / pane. */
function getRunSmoke() {
  return require('./operator-guided-first-run').runSmoke;
}

function getRunAttach() {
  return require('./operator-guided-first-run').runAttach;
}

/** @typedef {'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP'} LiveOutcome */

const LIVE_REASON = Object.freeze({
  PASS: 'LIVE_HARNESS_PASS',
  FAIL: 'LIVE_HARNESS_FAIL',
  BLOCKED: 'LIVE_HARNESS_BLOCKED',
  SKIP_HYBRID: 'MATRIX_SKIP_HYBRID_UNSUPPORTED',
  SKIP_LOCAL: 'MATRIX_SKIP_LOCAL_BACKEND_MISSING',
  SKIP_REMOTE: 'MATRIX_SKIP_REMOTE_CREDENTIALS_MISSING',
  SKIP_NOT_REQUESTED: 'MATRIX_SKIP_LIVE_NOT_REQUESTED',
  FIXTURE_UNKNOWN: 'LIVE_HARNESS_FIXTURE_UNKNOWN',
  ROW_UNKNOWN: 'LIVE_HARNESS_ROW_UNKNOWN',
  ROW_NOT_IN_FIXTURE: 'LIVE_HARNESS_ROW_NOT_IN_FIXTURE',
  SELECTION_EMPTY: 'LIVE_HARNESS_SELECTION_EMPTY',
  EVIDENCE_DIR_REQUIRED: 'LIVE_HARNESS_EVIDENCE_DIR_REQUIRED',
  ARTIFACT_MISSING: 'LIVE_HARNESS_ARTIFACT_MISSING',
  VERIFIER_FAIL: 'LIVE_HARNESS_VERIFIER_FAIL',
  PRIVACY_FAIL: 'LIVE_HARNESS_PRIVACY_FAIL',
  STATUS_FAIL: 'LIVE_HARNESS_STATUS_FAIL',
  ATTACH_FAIL: 'LIVE_HARNESS_ATTACH_FAIL',
  LAUNCH_FAIL: 'LIVE_HARNESS_LAUNCH_FAIL',
  MISSING_RUN_IDS: 'LIVE_HARNESS_MISSING_RUN_IDS',
  TERMINAL_NOT_SUCCESS: 'LIVE_HARNESS_TERMINAL_NOT_SUCCESS',
  READY_IS_NOT_PASS: 'LIVE_HARNESS_READY_IS_NOT_PASS',
});

const DEFAULT_FIXTURE_ID = 'sudoku-html-app';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES_DATA = path.join(REPO_ROOT, 'scripts', 'lib', 'canonical-real-task-fixtures-data.mjs');
const MATRIX_DATA = path.join(REPO_ROOT, 'scripts', 'lib', 'tester-six-mode-matrix-data.mjs');

/**
 * Deterministic parse of comma/space-separated row ids (sorted unique).
 * @param {unknown} raw
 * @returns {string[]}
 */
function parseRowIdSelection(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((r) => String(r).trim()).filter(Boolean))].sort();
  }
  const parts = String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)].sort();
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeFixtureId(raw) {
  const id = String(raw ?? DEFAULT_FIXTURE_ID).trim();
  return id || DEFAULT_FIXTURE_ID;
}

/**
 * Load fixture + matrix row definitions (ESM data modules).
 * @param {{
 *   loadFixtures?: () => Promise<object>,
 *   loadMatrix?: () => Promise<object>,
 * }} [deps]
 */
async function loadHarnessCatalog(deps = {}) {
  const fixturesMod = deps.loadFixtures
    ? await deps.loadFixtures()
    : await import(pathToFileURL(FIXTURES_DATA).href);
  const matrixMod = deps.loadMatrix
    ? await deps.loadMatrix()
    : await import(pathToFileURL(MATRIX_DATA).href);
  return { fixturesMod, matrixMod };
}

/**
 * Resolve fixture + selected matrix rows deterministically.
 * @param {{
 *   fixtureId?: string | null,
 *   rowIds?: unknown,
 *   fixturesMod?: object,
 *   matrixMod?: object,
 * }} input
 */
function resolveLiveHarnessSelection(input = {}) {
  const fixtureId = normalizeFixtureId(input.fixtureId);
  const selectedIds = parseRowIdSelection(input.rowIds);
  /** @type {string[]} */
  const errors = [];

  const fixturesMod = input.fixturesMod;
  const matrixMod = input.matrixMod;
  if (!fixturesMod || !matrixMod) {
    return {
      ok: false,
      fixture_id: fixtureId,
      row_ids: selectedIds,
      fixture: null,
      rows: [],
      errors: ['catalog modules required'],
      reason_code: LIVE_REASON.SELECTION_EMPTY,
    };
  }

  const getFixture = fixturesMod.getFixture;
  const fixture = typeof getFixture === 'function'
    ? getFixture(fixtureId)
    : (fixturesMod.REAL_TASK_FIXTURES || []).find((f) => f.id === fixtureId);

  if (!fixture) {
    errors.push(`unknown fixture id: ${fixtureId}`);
    return {
      ok: false,
      fixture_id: fixtureId,
      row_ids: selectedIds,
      fixture: null,
      rows: [],
      errors,
      reason_code: LIVE_REASON.FIXTURE_UNKNOWN,
    };
  }

  if (selectedIds.length === 0) {
    errors.push('at least one matrix row id is required');
    return {
      ok: false,
      fixture_id: fixtureId,
      row_ids: selectedIds,
      fixture,
      rows: [],
      errors,
      reason_code: LIVE_REASON.SELECTION_EMPTY,
    };
  }

  const sixRows = matrixMod.SIX_MODE_ROWS || [];
  const byId = new Map(sixRows.map((r) => [r.id, r]));
  /** @type {object[]} */
  const rows = [];
  for (const id of selectedIds) {
    const row = byId.get(id);
    if (!row) {
      errors.push(`unknown matrix row id: ${id}`);
      continue;
    }
    const allowed = Array.isArray(fixture.matrix_row_ids) ? fixture.matrix_row_ids : [];
    if (allowed.length > 0 && !allowed.includes(id)) {
      errors.push(`row ${id} not declared on fixture ${fixtureId}`);
      continue;
    }
    rows.push(row);
  }

  if (errors.length > 0) {
    const reason = errors.some((e) => e.startsWith('unknown matrix'))
      ? LIVE_REASON.ROW_UNKNOWN
      : LIVE_REASON.ROW_NOT_IN_FIXTURE;
    return {
      ok: false,
      fixture_id: fixtureId,
      row_ids: selectedIds,
      fixture,
      rows: [],
      errors,
      reason_code: reason,
    };
  }

  return {
    ok: true,
    fixture_id: fixtureId,
    row_ids: selectedIds,
    fixture,
    rows,
    errors: [],
    reason_code: LIVE_REASON.PASS,
  };
}

/**
 * Build guided-launcher model for a matrix row + fixture (shared launch semantics).
 * @param {{
 *   row: { id: string, agent_flow: string, inference_mode: string },
 *   fixture: { id: string, prompt: string },
 *   maxIterations?: unknown,
 *   timeLimit?: unknown,
 *   gatePosture?: string,
 *   localBackendReachable?: boolean | null,
 *   env?: NodeJS.ProcessEnv,
 *   buildLauncher?: typeof buildGuidedLauncherModel,
 * }} input
 */
function buildLiveHarnessLaunchModel(input) {
  const buildLauncher = input.buildLauncher ?? buildGuidedLauncherModel;
  const gatePosture = input.gatePosture ?? 'degraded';
  return buildLauncher({
    agentFlow: input.row.agent_flow,
    inferenceLane: input.row.inference_mode,
    gatePosture,
    goalSource: 'fixture',
    fixtureId: input.fixture.id,
    fixturePrompt: input.fixture.prompt,
    goal: input.fixture.prompt,
    maxIterations: input.maxIterations,
    timeLimit: input.timeLimit,
    localBackendReachable: input.localBackendReachable,
    env: input.env,
    deterministicVerifiers: ['canonical_fixture_artifact'],
  });
}

/**
 * Locate expected fixture artifacts under cwd (and common nested names).
 * @param {{ cwd: string, expectedArtifacts: string[], existsSync?: typeof fs.existsSync }} input
 * @returns {{ found: string[], missing: string[] }}
 */
function locateFixtureArtifacts(input) {
  const existsSync = input.existsSync ?? fs.existsSync;
  const cwd = input.cwd;
  /** @type {string[]} */
  const found = [];
  /** @type {string[]} */
  const missing = [];
  for (const name of input.expectedArtifacts) {
    const candidates = [
      path.join(cwd, name),
      path.join(cwd, 'out', name),
      path.join(cwd, 'dist', name),
    ];
    const hit = candidates.find((p) => existsSync(p));
    if (hit) found.push(hit);
    else missing.push(name);
  }
  return { found, missing };
}

/**
 * Classify a live row from evidence parts. Readiness alone never yields PASS.
 * @param {{
 *   readiness?: 'ready' | 'blocked' | 'skip' | string | null,
 *   blockedReasonCode?: string | null,
 *   launchOk?: boolean | null,
 *   runId?: string | null,
 *   taskId?: string | null,
 *   terminalSuccess?: boolean | null,
 *   statusOk?: boolean | null,
 *   attachOk?: boolean | null,
 *   verifierOk?: boolean | null,
 *   privacyOk?: boolean | null,
 *   privacyBlocked?: boolean | null,
 * }} evidence
 * @returns {{ outcome: LiveOutcome, reason_code: string, message: string }}
 */
function classifyLiveHarnessOutcome(evidence = {}) {
  if (evidence.readiness === 'skip') {
    const code = evidence.blockedReasonCode || LIVE_REASON.SKIP_NOT_REQUESTED;
    return {
      outcome: 'SKIP',
      reason_code: code,
      message: 'row skipped before live execution',
    };
  }
  if (evidence.readiness === 'blocked') {
    return {
      outcome: 'BLOCKED',
      reason_code: evidence.blockedReasonCode || LIVE_REASON.BLOCKED,
      message: 'launch blocked by readiness gate',
    };
  }

  // Explicit: MATRIX_READY / launcher ready without execution is never PASS.
  if (evidence.launchOk == null && evidence.runId == null && evidence.taskId == null) {
    return {
      outcome: 'BLOCKED',
      reason_code: LIVE_REASON.READY_IS_NOT_PASS,
      message: 'readiness or MATRIX_READY alone cannot satisfy PASS — live execution required',
    };
  }

  if (evidence.launchOk === false) {
    return {
      outcome: 'FAIL',
      reason_code: LIVE_REASON.LAUNCH_FAIL,
      message: 'harness launch via operator contract failed',
    };
  }

  const runId = evidence.runId || evidence.taskId || null;
  if (!runId) {
    return {
      outcome: 'FAIL',
      reason_code: LIVE_REASON.MISSING_RUN_IDS,
      message: 'run_id/task_id missing after launch',
    };
  }

  if (evidence.terminalSuccess === false) {
    return {
      outcome: 'FAIL',
      reason_code: LIVE_REASON.TERMINAL_NOT_SUCCESS,
      message: 'terminal status is not success',
    };
  }

  if (evidence.statusOk === false) {
    return {
      outcome: 'FAIL',
      reason_code: LIVE_REASON.STATUS_FAIL,
      message: 'status evidence missing or failed',
    };
  }

  if (evidence.attachOk === false) {
    return {
      outcome: 'FAIL',
      reason_code: LIVE_REASON.ATTACH_FAIL,
      message: 'attach evidence missing or failed',
    };
  }

  if (evidence.privacyBlocked === true || evidence.privacyOk === false) {
    return {
      outcome: 'FAIL',
      reason_code: LIVE_REASON.PRIVACY_FAIL,
      message: 'privacy scan failed or blocked',
    };
  }

  if (evidence.verifierOk === false) {
    return {
      outcome: 'FAIL',
      reason_code: LIVE_REASON.VERIFIER_FAIL,
      message: 'canonical artifact verifier failed',
    };
  }

  if (
    evidence.launchOk === true
    && evidence.terminalSuccess === true
    && evidence.statusOk === true
    && evidence.attachOk === true
    && evidence.privacyOk === true
    && evidence.verifierOk === true
    && runId
  ) {
    return {
      outcome: 'PASS',
      reason_code: LIVE_REASON.PASS,
      message: 'terminal success + artifact verifier + status + attach + clean privacy scan',
    };
  }

  return {
    outcome: 'BLOCKED',
    reason_code: LIVE_REASON.BLOCKED,
    message: 'incomplete evidence chain — cannot claim PASS',
  };
}

/**
 * Extract privacy pass/fail from attach report checks (no secret values).
 * @param {object | null | undefined} attachReport
 */
function summarizePrivacyFromAttach(attachReport) {
  if (!attachReport || typeof attachReport !== 'object') {
    return { privacyOk: false, privacyBlocked: true, reason_code: LIVE_REASON.PRIVACY_FAIL };
  }
  const checks = Array.isArray(attachReport.checks) ? attachReport.checks : [];
  const privacy = checks.find((c) => c && c.id === 'privacy_scan');
  if (!privacy) {
    return { privacyOk: false, privacyBlocked: true, reason_code: LIVE_REASON.PRIVACY_FAIL };
  }
  if (privacy.status === 'fail') {
    return {
      privacyOk: false,
      privacyBlocked: true,
      reason_code: String(privacy.reason_code || LIVE_REASON.PRIVACY_FAIL),
    };
  }
  return {
    privacyOk: privacy.status === 'pass' || privacy.status === 'warn',
    privacyBlocked: false,
    reason_code: String(privacy.reason_code || 'PRIVACY_OK'),
  };
}

/**
 * Verify fixture artifacts with canonical verifier (dynamic ESM).
 * @param {{
 *   fixture: { id: string },
 *   artifactPaths: string[],
 *   validateFixtureArtifact?: Function,
 *   readFileSync?: typeof fs.readFileSync,
 *   loadFixtures?: () => Promise<object>,
 * }} input
 */
async function verifyFixtureArtifacts(input) {
  if (!input.artifactPaths.length) {
    return {
      ok: false,
      reason_code: LIVE_REASON.ARTIFACT_MISSING,
      errors: ['no artifact paths'],
    };
  }
  let validate = input.validateFixtureArtifact;
  if (!validate) {
    const mod = input.loadFixtures
      ? await input.loadFixtures()
      : await import(pathToFileURL(FIXTURES_DATA).href);
    validate = mod.validateFixtureArtifact;
  }
  const readFileSync = input.readFileSync ?? fs.readFileSync;
  /** @type {string[]} */
  const errors = [];
  for (const artifactPath of input.artifactPaths) {
    const html = readFileSync(artifactPath, 'utf8');
    const result = validate(input.fixture, html);
    if (!result.ok) {
      errors.push(...(result.errors || [`verifier failed for ${path.basename(artifactPath)}`]));
    }
  }
  return {
    ok: errors.length === 0,
    reason_code: errors.length === 0 ? LIVE_REASON.PASS : LIVE_REASON.VERIFIER_FAIL,
    errors,
  };
}

/**
 * Launch one row through existing smoke/start contracts (no provider bypass).
 * @param {{
 *   launchModel: ReturnType<typeof buildGuidedLauncherModel>,
 *   cwd?: string,
 *   useColor?: boolean,
 *   runSmokeFn?: Function,
 *   runStartFn?: Function,
 * }} input
 */
async function launchViaOperatorContract(input) {
  const model = input.launchModel;
  if (!model.can_launch || !model.launch_options) {
    return {
      ok: false,
      exitCode: 0,
      reason_code: model.blocked_reason_code || LAUNCHER_REASON.GOAL_REQUIRED,
      launched: false,
      task_id: null,
      run_id: null,
      terminal_status: null,
      result: null,
    };
  }

  const launch = model.launch_options;
  const runSmokeFn = input.runSmokeFn ?? getRunSmoke();
  let result;
  if (
    launch.flowMode === 'single_agent'
    && launch.skipGates === true
    && (launch.maxIterations === 1 || launch.maxIterations == null)
  ) {
    result = await runSmokeFn({
      goal: launch.goal,
      cwd: input.cwd,
      modelPolicy: launch.modelPolicy,
      skipGates: true,
      maxIterations: 1,
      useColor: input.useColor === true,
    });
  } else {
    const runStart = input.runStartFn
      ?? require('./ai-minions-cli').runStart;
    result = await runStart({
      goal: launch.goal,
      cwd: input.cwd,
      flowMode: launch.flowMode,
      modelPolicy: launch.modelPolicy,
      skipGates: launch.skipGates === true,
      maxIterations: launch.maxIterations,
    });
  }

  const taskId = result.task_id
    ?? result.launched?.task_id
    ?? null;
  const terminal = result.launched?.terminal_status ?? null;
  const ok = result.ok !== false && (result.exitCode == null || result.exitCode === 0);
  return {
    ok,
    exitCode: result.exitCode ?? (ok ? 0 : 1),
    reason_code: result.reason_code ?? (ok ? LIVE_REASON.PASS : LIVE_REASON.LAUNCH_FAIL),
    launched: true,
    task_id: taskId == null ? null : String(taskId),
    run_id: taskId == null ? null : String(taskId),
    terminal_status: terminal == null ? null : String(terminal),
    model_policy: result.model_policy ?? launch.modelPolicy ?? null,
    model: result.model ?? null,
    result,
  };
}

/**
 * Execute one matrix row end-to-end through operator contracts + evidence chain.
 * @param {{
 *   row: object,
 *   fixture: object,
 *   cwd?: string,
 *   evidenceDir?: string | null,
 *   maxIterations?: unknown,
 *   timeLimit?: unknown,
 *   gatePosture?: string,
 *   localBackendReachable?: boolean | null,
 *   env?: NodeJS.ProcessEnv,
 *   useColor?: boolean,
 *   buildLauncher?: typeof buildGuidedLauncherModel,
 *   runSmokeFn?: Function,
 *   runStartFn?: Function,
 *   runStatusFn?: typeof runOperatorStatus,
 *   runAttachFn?: Function,
 *   validateFixtureArtifact?: Function,
 *   loadFixtures?: () => Promise<object>,
 *   nowMs?: () => number,
 *   writeFileSync?: typeof fs.writeFileSync,
 *   mkdirSync?: typeof fs.mkdirSync,
 *   existsSync?: typeof fs.existsSync,
 *   readFileSync?: typeof fs.readFileSync,
 * }} options
 */
async function executeLiveHarnessRow(options) {
  const started = (options.nowMs ?? Date.now)();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  const launchModel = buildLiveHarnessLaunchModel({
    row: options.row,
    fixture: options.fixture,
    maxIterations: options.maxIterations,
    timeLimit: options.timeLimit,
    gatePosture: options.gatePosture,
    localBackendReachable: options.localBackendReachable,
    env,
    buildLauncher: options.buildLauncher,
  });

  /** @type {Record<string, unknown>} */
  const evidenceBase = {
    schema: LIVE_HARNESS_SCHEMA,
    fixture_id: options.fixture.id,
    fixture_version: options.fixture.status ?? null,
    prompt_hash: hashStable(String(options.fixture.prompt || '')),
    row_id: options.row.id,
    agent_mode: options.row.agent_flow,
    model_policy: launchModel.inference_policy,
    inference_lane: launchModel.inference_lane,
    equivalent_command: launchModel.equivalent_command,
    readiness: launchModel.readiness,
    blocked_reason_code: launchModel.blocked_reason_code,
  };

  if (launchModel.readiness === 'skip' || !launchModel.can_launch) {
    const classified = classifyLiveHarnessOutcome({
      readiness: launchModel.readiness,
      blockedReasonCode: launchModel.blocked_reason_code,
    });
    return finalizeRowEvidence({
      ...evidenceBase,
      ...classified,
      run_id: null,
      task_id: null,
      artifact_paths: [],
      status: null,
      attach: null,
      verifier: null,
      privacy: null,
      elapsed_ms: (options.nowMs ?? Date.now)() - started,
      launched: false,
    }, options);
  }

  const launch = await launchViaOperatorContract({
    launchModel,
    cwd,
    useColor: options.useColor,
    runSmokeFn: options.runSmokeFn,
    runStartFn: options.runStartFn,
  });

  const runId = launch.run_id || launch.task_id;
  const terminalFail = launch.terminal_status != null
    && /^(fail|failed|blocked|error)$/i.test(String(launch.terminal_status));
  const terminalOk = launch.ok === true && !terminalFail;

  let statusResult = null;
  let statusOk = false;
  if (runId) {
    const runStatus = options.runStatusFn ?? runOperatorStatus;
    statusResult = runStatus({ runId: String(runId), json: true });
    statusOk = statusResult.ok === true;
  }

  let attachResult = null;
  let attachOk = false;
  let privacySummary = { privacyOk: false, privacyBlocked: true, reason_code: LIVE_REASON.PRIVACY_FAIL };
  if (runId) {
    const runAttach = options.runAttachFn
      ?? (async (opts) => getRunAttach()(opts));
    const rowEvidenceDir = options.evidenceDir
      ? path.join(options.evidenceDir, String(options.row.id), 'attach')
      : undefined;
    attachResult = await runAttach({
      runId: String(runId),
      cwd,
      outDir: rowEvidenceDir,
      json: true,
    });
    attachOk = attachResult.ok === true;
    privacySummary = summarizePrivacyFromAttach(attachResult.report || attachResult.json);
  }

  const expected = Array.isArray(options.fixture.expected_artifacts)
    ? options.fixture.expected_artifacts
    : [];
  const located = locateFixtureArtifacts({
    cwd,
    expectedArtifacts: expected,
    existsSync: options.existsSync,
  });
  let verifier = {
    ok: false,
    reason_code: LIVE_REASON.ARTIFACT_MISSING,
    errors: located.missing.map((m) => `missing artifact: ${m}`),
  };
  if (located.found.length > 0 && located.missing.length === 0) {
    verifier = await verifyFixtureArtifacts({
      fixture: options.fixture,
      artifactPaths: located.found,
      validateFixtureArtifact: options.validateFixtureArtifact,
      loadFixtures: options.loadFixtures,
      readFileSync: options.readFileSync,
    });
  }

  const classified = classifyLiveHarnessOutcome({
    readiness: 'ready',
    launchOk: launch.ok,
    runId,
    taskId: launch.task_id,
    terminalSuccess: terminalOk,
    statusOk,
    attachOk,
    verifierOk: verifier.ok === true,
    privacyOk: privacySummary.privacyOk,
    privacyBlocked: privacySummary.privacyBlocked,
  });

  return finalizeRowEvidence({
    ...evidenceBase,
    ...classified,
    run_id: runId,
    task_id: launch.task_id,
    backend_model: launch.model ?? null,
    model_policy_resolved: launch.model_policy ?? launchModel.inference_policy,
    terminal_status: launch.terminal_status,
    artifact_paths: located.found,
    missing_artifacts: located.missing,
    status: statusResult
      ? {
        ok: statusOk,
        reason_code: statusResult.reason_code ?? statusResult.result_code ?? null,
        result_code: statusResult.result_code ?? null,
      }
      : null,
    attach: attachResult
      ? {
        ok: attachOk,
        reason_code: attachResult.reason_code ?? null,
        bundle_dir: attachResult.report?.bundle_dir ?? null,
      }
      : null,
    verifier: {
      ok: verifier.ok === true,
      reason_code: verifier.reason_code,
      errors: verifier.errors || [],
    },
    privacy: {
      ok: privacySummary.privacyOk,
      blocked: privacySummary.privacyBlocked,
      reason_code: privacySummary.reason_code,
    },
    elapsed_ms: (options.nowMs ?? Date.now)() - started,
    launched: true,
    equivalent_command: launchModel.equivalent_command,
  }, options);
}

/**
 * @param {Record<string, unknown>} rowEvidence
 * @param {{ evidenceDir?: string | null, writeFileSync?: typeof fs.writeFileSync, mkdirSync?: typeof fs.mkdirSync }} options
 */
function finalizeRowEvidence(rowEvidence, options) {
  const payload = {
    ...rowEvidence,
    // Never claim PASS from a model "done" statement alone — classification already enforces chain.
    note: 'PASS requires terminal success, artifacts, verifier, status, attach, and privacy — not readiness or done text alone',
  };
  if (options.evidenceDir) {
    const mkdirSync = options.mkdirSync ?? fs.mkdirSync;
    const writeFileSync = options.writeFileSync ?? fs.writeFileSync;
    const dir = path.join(options.evidenceDir, String(rowEvidence.row_id));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'live-harness-row.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  return payload;
}

/**
 * Stable non-cryptographic hash for prompt identity (no secret content beyond fixture prompt).
 * @param {string} text
 */
function hashStable(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Run live harness for selected fixture + rows.
 * @param {{
 *   fixtureId?: string,
 *   rowIds?: unknown,
 *   evidenceDir?: string | null,
 *   cwd?: string,
 *   maxIterations?: unknown,
 *   timeLimit?: unknown,
 *   gatePosture?: string,
 *   localBackendReachable?: boolean | null,
 *   env?: NodeJS.ProcessEnv,
 *   useColor?: boolean,
 *   executeLive?: boolean,
 *   loadFixtures?: () => Promise<object>,
 *   loadMatrix?: () => Promise<object>,
 *   executeRowFn?: typeof executeLiveHarnessRow,
 *   writeFileSync?: typeof fs.writeFileSync,
 *   mkdirSync?: typeof fs.mkdirSync,
 * }} [options]
 */
async function runLiveHarness(options = {}) {
  if (options.executeLive === false) {
    return {
      ok: true,
      schema: LIVE_HARNESS_SCHEMA,
      evidence_class: 'readiness_only',
      message: 'live execution not requested — readiness alone is never PASS',
      reason_code: LIVE_REASON.SKIP_NOT_REQUESTED,
      rows: [],
    };
  }

  if (!options.evidenceDir) {
    return {
      ok: false,
      schema: LIVE_HARNESS_SCHEMA,
      evidence_class: 'live_execution',
      reason_code: LIVE_REASON.EVIDENCE_DIR_REQUIRED,
      message: '--evidence-dir is required for live execution',
      rows: [],
    };
  }

  const catalog = await loadHarnessCatalog({
    loadFixtures: options.loadFixtures,
    loadMatrix: options.loadMatrix,
  });
  const selection = resolveLiveHarnessSelection({
    fixtureId: options.fixtureId,
    rowIds: options.rowIds,
    fixturesMod: catalog.fixturesMod,
    matrixMod: catalog.matrixMod,
  });

  if (!selection.ok) {
    return {
      ok: false,
      schema: LIVE_HARNESS_SCHEMA,
      evidence_class: 'live_execution',
      reason_code: selection.reason_code,
      message: selection.errors.join('; '),
      fixture_id: selection.fixture_id,
      row_ids: selection.row_ids,
      rows: [],
      errors: selection.errors,
    };
  }

  const mkdirSync = options.mkdirSync ?? fs.mkdirSync;
  mkdirSync(options.evidenceDir, { recursive: true });

  const executeRow = options.executeRowFn ?? executeLiveHarnessRow;
  /** @type {object[]} */
  const rows = [];
  for (const row of selection.rows) {
    const result = await executeRow({
      row,
      fixture: selection.fixture,
      cwd: options.cwd,
      evidenceDir: options.evidenceDir,
      maxIterations: options.maxIterations,
      timeLimit: options.timeLimit,
      gatePosture: options.gatePosture,
      localBackendReachable: options.localBackendReachable,
      env: options.env,
      useColor: options.useColor,
      loadFixtures: options.loadFixtures,
      writeFileSync: options.writeFileSync,
      mkdirSync: options.mkdirSync,
    });
    rows.push(result);
  }

  const summaryPath = path.join(options.evidenceDir, 'live-harness-summary.json');
  const summary = {
    schema: LIVE_HARNESS_SCHEMA,
    evidence_class: 'live_execution',
    fixture_id: selection.fixture_id,
    row_ids: selection.row_ids,
    rows: rows.map((r) => ({
      row_id: r.row_id,
      outcome: r.outcome,
      reason_code: r.reason_code,
      run_id: r.run_id,
      task_id: r.task_id,
    })),
  };
  const writeFileSync = options.writeFileSync ?? fs.writeFileSync;
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const hasFail = rows.some((r) => r.outcome === 'FAIL');
  const hasPass = rows.some((r) => r.outcome === 'PASS');
  // Structure ok if no FAIL (SKIP/BLOCKED allowed); PASS is recorded separately.
  return {
    ok: !hasFail,
    schema: LIVE_HARNESS_SCHEMA,
    evidence_class: 'live_execution',
    fixture_id: selection.fixture_id,
    row_ids: selection.row_ids,
    has_pass: hasPass,
    summary_path: summaryPath,
    rows,
  };
}

/**
 * Collect + classify post-run evidence for a TUI/matrix-shared path after launch.
 * @param {{
 *   fixture: object,
 *   rowId: string,
 *   runId: string,
 *   cwd?: string,
 *   evidenceDir?: string | null,
 *   launchOk?: boolean,
 *   terminalStatus?: string | null,
 *   modelPolicy?: string | null,
 *   agentMode?: string | null,
 *   equivalentCommand?: string | null,
 *   runStatusFn?: typeof runOperatorStatus,
 *   runAttachFn?: Function,
 *   validateFixtureArtifact?: Function,
 *   loadFixtures?: () => Promise<object>,
 *   existsSync?: typeof fs.existsSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   writeFileSync?: typeof fs.writeFileSync,
 *   mkdirSync?: typeof fs.mkdirSync,
 * }} input
 */
async function collectLiveHarnessPostRun(input) {
  const runId = String(input.runId || '').trim();
  const cwd = input.cwd ?? process.cwd();

  let statusOk = false;
  let statusResult = null;
  if (runId) {
    const runStatus = input.runStatusFn ?? runOperatorStatus;
    statusResult = runStatus({ runId, json: true });
    statusOk = statusResult.ok === true;
  }

  let attachOk = false;
  let attachResult = null;
  let privacySummary = { privacyOk: false, privacyBlocked: true, reason_code: LIVE_REASON.PRIVACY_FAIL };
  if (runId) {
    const runAttach = input.runAttachFn
      ?? (async (opts) => getRunAttach()(opts));
    attachResult = await runAttach({
      runId,
      cwd,
      outDir: input.evidenceDir
        ? path.join(input.evidenceDir, String(input.rowId), 'attach')
        : undefined,
      json: true,
    });
    attachOk = attachResult.ok === true;
    privacySummary = summarizePrivacyFromAttach(attachResult.report || attachResult.json);
  }

  const expected = Array.isArray(input.fixture.expected_artifacts)
    ? input.fixture.expected_artifacts
    : [];
  const located = locateFixtureArtifacts({
    cwd,
    expectedArtifacts: expected,
    existsSync: input.existsSync,
  });
  let verifier = {
    ok: false,
    reason_code: LIVE_REASON.ARTIFACT_MISSING,
    errors: located.missing.map((m) => `missing artifact: ${m}`),
  };
  if (located.found.length && !located.missing.length) {
    verifier = await verifyFixtureArtifacts({
      fixture: input.fixture,
      artifactPaths: located.found,
      validateFixtureArtifact: input.validateFixtureArtifact,
      loadFixtures: input.loadFixtures,
      readFileSync: input.readFileSync,
    });
  }

  const classified = classifyLiveHarnessOutcome({
    readiness: 'ready',
    launchOk: input.launchOk !== false,
    runId,
    taskId: runId,
    terminalSuccess: input.launchOk !== false,
    statusOk,
    attachOk,
    verifierOk: verifier.ok === true,
    privacyOk: privacySummary.privacyOk,
    privacyBlocked: privacySummary.privacyBlocked,
  });

  return finalizeRowEvidence({
    schema: LIVE_HARNESS_SCHEMA,
    fixture_id: input.fixture.id,
    prompt_hash: hashStable(String(input.fixture.prompt || '')),
    row_id: input.rowId,
    agent_mode: input.agentMode ?? null,
    model_policy: input.modelPolicy ?? null,
    equivalent_command: input.equivalentCommand ?? null,
    ...classified,
    run_id: runId || null,
    task_id: runId || null,
    terminal_status: input.terminalStatus ?? null,
    artifact_paths: located.found,
    missing_artifacts: located.missing,
    status: statusResult
      ? { ok: statusOk, reason_code: statusResult.reason_code ?? null }
      : null,
    attach: attachResult
      ? {
        ok: attachOk,
        reason_code: attachResult.reason_code ?? null,
        bundle_dir: attachResult.report?.bundle_dir ?? null,
      }
      : null,
    verifier: {
      ok: verifier.ok === true,
      reason_code: verifier.reason_code,
      errors: verifier.errors || [],
    },
    privacy: {
      ok: privacySummary.privacyOk,
      blocked: privacySummary.privacyBlocked,
      reason_code: privacySummary.reason_code,
    },
    launched: true,
  }, input);
}

/**
 * Map matrix row id from agent flow + inference lane (shared with TUI).
 * @param {string} agentFlow
 * @param {string} inferenceLane
 * @returns {string}
 */
function matrixRowIdFromModes(agentFlow, inferenceLane) {
  const flow = String(agentFlow) === 'multi_agent' ? 'ma' : 'sa';
  const lane = String(inferenceLane || 'local_only');
  return `${flow}-${lane}`;
}

module.exports = {
  LIVE_HARNESS_SCHEMA,
  LIVE_REASON,
  DEFAULT_FIXTURE_ID,
  parseRowIdSelection,
  normalizeFixtureId,
  resolveLiveHarnessSelection,
  buildLiveHarnessLaunchModel,
  locateFixtureArtifacts,
  classifyLiveHarnessOutcome,
  summarizePrivacyFromAttach,
  verifyFixtureArtifacts,
  launchViaOperatorContract,
  executeLiveHarnessRow,
  collectLiveHarnessPostRun,
  runLiveHarness,
  matrixRowIdFromModes,
  hashStable,
  loadHarnessCatalog,
};
