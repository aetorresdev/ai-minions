'use strict';

/**
 * Presentation-oriented landing view-model for the Ink shell.
 * Consumes adapter fields only — does not infer readiness, budgets, or gate outcomes.
 */

const LANDING_SCHEMA = '1';
const RECENT_RUNS_LIMIT = 5;

/** @typedef {'ready'|'needs_setup'|'blocked'|'loading'|'failed'|'unknown'} LandingOverallState */

/**
 * Bounded primary / secondary actions shown on the landing Quick Start panel.
 * Action ids map to shell dispatch targets (operator modules remain authoritative).
 * @returns {ReadonlyArray<{ key: string, id: string, label: string, description: string, primary?: boolean }>}
 */
function landingQuickStartActions() {
  return Object.freeze([
    {
      key: '1',
      id: 'launcher',
      label: 'Start New Run',
      description: 'Launch a new agent run',
      primary: true,
    },
    {
      key: '2',
      id: 'runs',
      label: 'Browse Runs',
      description: 'View and select recent runs',
    },
    {
      key: '3',
      id: 'diagnostics',
      label: 'System Status',
      description: 'Check readiness and diagnostics',
    },
    {
      key: '4',
      id: 'config',
      label: 'Settings',
      description: 'Configure models and environment',
    },
    {
      key: '5',
      id: 'help',
      label: 'Help',
      description: 'Documentation and key bindings',
    },
  ]);
}

/**
 * Top-level shell navigation (user goals). Selected-run views are contextual.
 * @param {{ selectedRunId?: string | null }} [options]
 * @returns {ReadonlyArray<{ key: string, id: string, label: string, description: string, group: string }>}
 */
function adaptShellNavigation(options = {}) {
  const primary = [
    { key: 'h', id: 'home', label: 'Home', description: 'Task-first landing', group: 'primary' },
    { key: '1', id: 'launcher', label: 'New Run', description: 'Start a new agent run', group: 'primary' },
    { key: '2', id: 'runs', label: 'Runs', description: 'Browse recent runs', group: 'primary' },
    {
      key: '3',
      id: 'diagnostics',
      label: 'System Status',
      description: 'Check readiness and diagnostics',
      group: 'primary',
    },
    {
      key: '4',
      id: 'config',
      label: 'Settings',
      description: 'Configure providers and environment',
      group: 'primary',
    },
    { key: '5', id: 'help', label: 'Help', description: 'Key bindings and guidance', group: 'primary' },
  ];
  const selectedRunId = options.selectedRunId == null || options.selectedRunId === ''
    ? null
    : String(options.selectedRunId);
  if (!selectedRunId) {
    return Object.freeze(primary);
  }
  return Object.freeze([
    ...primary,
    {
      key: 'o',
      id: 'status',
      label: 'Overview',
      description: 'Selected run status',
      group: 'run',
    },
    {
      key: 'm',
      id: 'monitor',
      label: 'Monitor',
      description: 'Live run monitor',
      group: 'run',
    },
    {
      key: 'e',
      id: 'evidence',
      label: 'Evidence',
      description: 'Evidence and attach',
      group: 'run',
    },
    {
      key: 'x',
      id: 'explain',
      label: 'Explain',
      description: 'Explain next safe action',
      group: 'run',
    },
  ]);
}

/**
 * Map adapter readiness fields → overall landing state (presentation only).
 * @param {{
 *   path_status?: string | null,
 *   credential_sufficiency?: string | null,
 *   model_policy?: string | null,
 *   cli_on_path?: boolean | null,
 * }} home
 * @returns {{
 *   state: LandingOverallState,
 *   label: string,
 *   next_action: string,
 *   reason_hint: string | null,
 * }}
 */
function deriveLandingOverall(home = {}) {
  const pathStatus = home.path_status == null ? null : String(home.path_status).toLowerCase();
  const creds = home.credential_sufficiency == null
    ? null
    : String(home.credential_sufficiency).toLowerCase();

  if (pathStatus === 'loading' || creds === 'unavailable') {
    return {
      state: 'loading',
      label: 'Loading',
      next_action: 'Wait for readiness discovery to finish',
      reason_hint: null,
    };
  }

  if (pathStatus === 'failed' || pathStatus === 'error' || pathStatus === 'probe_failed') {
    return {
      state: 'failed',
      label: 'Failed',
      next_action: 'Open System Status, then retry the readiness probe',
      reason_hint: pathStatus,
    };
  }

  if (
    pathStatus === 'blocked'
    || creds === 'blocked'
    || creds === 'insufficient'
    || creds === 'missing'
  ) {
    return {
      state: 'blocked',
      label: 'Blocked',
      next_action: 'Open Settings and complete the required remediation',
      reason_hint: creds || pathStatus,
    };
  }

  if (
    pathStatus === 'needs_setup'
    || pathStatus === 'not_ready'
    || pathStatus === 'missing'
    || pathStatus === 'inactive'
    || creds === 'needs_setup'
  ) {
    return {
      state: 'needs_setup',
      label: 'Needs setup',
      next_action: 'Open Settings for the exact remediation path',
      reason_hint: pathStatus || creds,
    };
  }

  if (pathStatus === 'ready' || pathStatus === 'ok' || pathStatus === 'active') {
    const remoteBlocked = creds === 'required' || creds === 'insufficient_remote';
    if (remoteBlocked) {
      return {
        state: 'blocked',
        label: 'Blocked',
        next_action: 'Provide required remote credentials via Settings',
        reason_hint: creds,
      };
    }
    return {
      state: 'ready',
      label: 'Ready',
      next_action: 'Start New Run — try the canonical fixture for a low-risk first success',
      reason_hint: null,
    };
  }

  if (pathStatus == null && creds == null) {
    return {
      state: 'unknown',
      label: 'Unknown',
      next_action: 'Open System Status to inspect available readiness fields',
      reason_hint: null,
    };
  }

  return {
    state: 'needs_setup',
    label: 'Needs setup',
    next_action: 'Open System Status, then Settings if remediation is listed',
    reason_hint: pathStatus || creds,
  };
}

/**
 * Compact readiness row for the landing checklist.
 * @param {string} label
 * @param {string} statusLabel
 * @param {'ok'|'warn'|'fail'|'blocked'|'loading'|'unavailable'} tone
 * @param {string | null} [detail]
 */
function readinessRow(label, statusLabel, tone, detail = null) {
  return {
    label,
    status_label: statusLabel,
    tone,
    detail: detail == null || detail === '' ? null : String(detail),
  };
}

/**
 * @param {string | null | undefined} value
 * @param {'ok'|'warn'|'fail'|'blocked'|'loading'|'unavailable'} [fallbackTone]
 */
function toneForScalar(value, fallbackTone = 'unavailable') {
  const v = value == null ? '' : String(value).toLowerCase();
  if (!v || v === 'unknown' || v === 'unavailable' || v === 'absent') return 'unavailable';
  if (v === 'loading') return 'loading';
  if (v === 'ready' || v === 'ok' || v === 'active' || v === 'not_required' || v === 'sufficient') {
    return 'ok';
  }
  if (v === 'blocked' || v === 'insufficient' || v === 'missing' || v === 'required') return 'blocked';
  if (v === 'failed' || v === 'error' || v === 'probe_failed') return 'fail';
  if (v === 'needs_setup' || v === 'not_ready' || v === 'inactive' || v === 'degraded') return 'warn';
  return fallbackTone;
}

/**
 * Classify a run row for landing activity / recent list (presentation labels only).
 * @param {{
 *   status?: string | null,
 *   outcome?: string | null,
 *   reason_code?: string | null,
 *   result_code?: string | null,
 * }} run
 */
function classifyRunActivity(run = {}) {
  const status = String(run.status ?? '').toLowerCase();
  const outcome = String(run.outcome ?? '').toLowerCase();
  const reason = String(run.reason_code ?? '').toLowerCase();
  const result = String(run.result_code ?? '').toLowerCase();

  const blocked = /cerberus|blocked|gate_block|policy_block/.test(`${reason} ${result} ${status} ${outcome}`)
    || status === 'blocked'
    || outcome === 'blocked';
  if (blocked) {
    return {
      state: 'blocked',
      label: 'BLOCKED',
      next_action: 'Open Overview for the selected run, then follow next_safe_action',
    };
  }

  if (
    status === 'failed'
    || status === 'error'
    || outcome === 'failed'
    || outcome === 'fail'
    || /fail/.test(result)
  ) {
    return {
      state: 'failed',
      label: 'FAILED',
      next_action: 'Open Evidence or Explain for the selected run',
    };
  }

  if (
    status === 'running'
    || status === 'active'
    || status === 'in_progress'
    || status === 'verifying'
    || outcome === 'running'
  ) {
    return {
      state: 'active',
      label: status === 'verifying' ? 'VERIFYING' : 'ACTIVE',
      next_action: 'Open Monitor for the selected run',
    };
  }

  if (
    status === 'complete'
    || status === 'completed'
    || status === 'success'
    || outcome === 'success'
    || outcome === 'passed'
    || outcome === 'pass'
  ) {
    return {
      state: 'completed',
      label: 'COMPLETED',
      next_action: 'Open Evidence / attach for the selected run',
    };
  }

  if (status === 'invalid' || result === 'run_trace_invalid') {
    return {
      state: 'failed',
      label: 'INVALID',
      next_action: 'Choose another run or inspect System Status',
    };
  }

  return {
    state: 'unknown',
    label: (status || outcome || 'UNKNOWN').toUpperCase(),
    next_action: 'Open Overview for details',
  };
}

/**
 * @param {ReadonlyArray<object>} runs
 * @param {number} [limit]
 */
function buildRecentRunPreview(runs, limit = RECENT_RUNS_LIMIT) {
  const list = Array.isArray(runs) ? runs : [];
  const sliced = list.slice(0, Math.max(0, limit));
  return sliced.map((run) => {
    const activity = classifyRunActivity(run);
    return {
      run_id: String(run.run_id ?? ''),
      summary: run.goal_summary == null || run.goal_summary === ''
        ? null
        : String(run.goal_summary),
      last_event_at: run.last_event_at == null ? null : String(run.last_event_at),
      status: run.status == null ? null : String(run.status),
      outcome: run.outcome == null ? null : String(run.outcome),
      reason_code: run.reason_code == null ? null : String(run.reason_code),
      agent_count: run.agent_count == null ? null : Number(run.agent_count),
      activity_state: activity.state,
      activity_label: activity.label,
    };
  });
}

/**
 * Build the landing view-model from shell adapter inputs.
 * @param {{
 *   home?: object,
 *   runs?: { runs?: object[], result_code?: string | null, next_safe_action?: string | null },
 *   selectedRunId?: string | null,
 *   version?: string | null,
 *   columns?: number,
 *   loading?: boolean,
 * }} [options]
 */
function buildLandingViewModel(options = {}) {
  const home = options.home && typeof options.home === 'object' ? options.home : {};
  const runsAdapter = options.runs && typeof options.runs === 'object' ? options.runs : { runs: [] };
  const runs = Array.isArray(runsAdapter.runs) ? runsAdapter.runs : [];
  const overall = options.loading === true
    ? {
      state: /** @type {LandingOverallState} */ ('loading'),
      label: 'Loading',
      next_action: 'Wait for readiness discovery to finish',
      reason_hint: null,
    }
    : deriveLandingOverall(home);

  const pathTone = toneForScalar(home.path_status);
  const credTone = toneForScalar(home.credential_sufficiency);
  const policyTone = home.model_policy == null || home.model_policy === ''
    ? 'unavailable'
    : 'ok';
  const envTone = home.cli_on_path === true
    ? 'ok'
    : (home.cli_on_path === false ? 'warn' : toneForScalar(home.path_status));

  const readinessRows = [
    readinessRow(
      'Model Policy',
      home.model_policy == null || home.model_policy === '' ? 'unavailable' : String(home.model_policy),
      policyTone,
    ),
    readinessRow(
      'Credentials',
      home.credential_sufficiency == null ? 'unavailable' : String(home.credential_sufficiency),
      credTone,
    ),
    readinessRow(
      'Environment',
      home.cli_on_path == null
        ? 'unavailable'
        : (home.cli_on_path ? 'OK' : 'CLI not on PATH'),
      envTone,
    ),
    readinessRow(
      'ai-minions Path',
      home.path_status == null ? 'unavailable' : String(home.path_status),
      pathTone,
    ),
    readinessRow(
      'Overall Status',
      overall.label.toUpperCase(),
      overall.state === 'ready'
        ? 'ok'
        : (overall.state === 'blocked'
          ? 'blocked'
          : (overall.state === 'failed'
            ? 'fail'
            : (overall.state === 'loading' ? 'loading' : 'warn'))),
      overall.reason_hint,
    ),
  ];

  const recent = buildRecentRunPreview(runs);
  const selectedRunId = options.selectedRunId == null || options.selectedRunId === ''
    ? null
    : String(options.selectedRunId);
  const selected = selectedRunId
    ? runs.find((r) => String(r.run_id) === selectedRunId) ?? null
    : (runs[0] ?? null);
  const activity = selected
    ? {
      ...classifyRunActivity(selected),
      run_id: String(selected.run_id ?? ''),
      available: true,
    }
    : {
      state: 'empty',
      label: 'NO RUNS',
      next_action: overall.state === 'ready'
        ? 'Start a run — canonical fixture is the low-risk first success path'
        : overall.next_action,
      run_id: null,
      available: false,
    };

  let emptyState = null;
  if (overall.state === 'loading') {
    emptyState = {
      kind: 'loading',
      title: 'Discovering readiness',
      body: 'Readiness and recent runs load after first paint. Fields stay unavailable until authoritative.',
    };
  } else if (overall.state === 'failed') {
    emptyState = {
      kind: 'failed',
      title: 'Readiness probe failed',
      body: 'Bounded failure — open System Status. Do not treat missing fields as success.',
    };
  } else if (overall.state === 'blocked' || overall.state === 'needs_setup') {
    emptyState = {
      kind: overall.state,
      title: overall.label,
      body: overall.next_action,
    };
  } else if (!runs.length) {
    emptyState = {
      kind: 'no_runs',
      title: 'No runs yet',
      body: overall.state === 'ready'
        ? 'Start a run to create the first trace. Canonical fixture is offered from New Run.'
        : overall.next_action,
    };
  }

  const version = options.version == null || options.version === ''
    ? (home.version == null ? 'unknown' : String(home.version))
    : String(options.version);

  return {
    schema: LANDING_SCHEMA,
    kind: 'landing',
    version,
    hero: {
      product: 'AI-MINIONS',
      tagline: 'Contract-First Multi-Agent Orchestration Harness',
      triad: 'Validate • Trace • Enforce',
      guardian_note: 'Cerberus guards contracts and gates — secondary system symbol',
    },
    overall,
    quick_start: landingQuickStartActions(),
    readiness_rows: readinessRows,
    recent_runs: recent,
    recent_runs_total: runs.length,
    recent_runs_showing: recent.length,
    activity,
    empty_state: emptyState,
    primary_action_id: 'launcher',
    footer_hints_wide: '↑/↓ Navigate · Enter Select · q Quit · ? Help · /=slash',
    footer_hints_narrow: '↑↓ · Enter · q · ?',
  };
}

/**
 * Plain-text landing lines for assertions / NO_COLOR parity (not shareable CLI JSON).
 * @param {ReturnType<typeof buildLandingViewModel>} landing
 * @param {{ selectedNavId?: string | null, narrow?: boolean }} [options]
 * @returns {string[]}
 */
function formatLandingLines(landing, options = {}) {
  const selectedNavId = options.selectedNavId == null ? null : String(options.selectedNavId);
  const narrow = options.narrow === true;
  const lines = [
    `${landing.hero.product}  ${landing.hero.triad}`,
    landing.hero.tagline,
    `v${String(landing.version).replace(/^v/i, '')}`,
    '',
    '== Quick Start ==',
  ];
  for (const item of landing.quick_start) {
    const marker = item.id === selectedNavId || (selectedNavId == null && item.primary)
      ? '>'
      : ' ';
    lines.push(
      `${marker} ${item.key}. ${item.label}`
      + (narrow ? '' : ` — ${item.description}`),
    );
  }
  lines.push('', '== System Readiness ==');
  lines.push(`Overall: ${landing.overall.label} · next: ${landing.overall.next_action}`);
  for (const row of landing.readiness_rows) {
    const detail = row.detail ? ` (${row.detail})` : '';
    lines.push(`  ${row.label}: ${row.status_label}${detail}`);
  }
  lines.push('', '== Current activity ==');
  if (landing.activity.available) {
    lines.push(
      `  ${landing.activity.activity_label ?? landing.activity.label}`
      + ` · ${landing.activity.run_id}`
      + ` · next: ${landing.activity.next_action}`,
    );
  } else {
    lines.push(`  ${landing.activity.label} · next: ${landing.activity.next_action}`);
  }
  lines.push('', '== Recent Runs ==');
  if (!landing.recent_runs.length) {
    lines.push('  (No runs yet)');
  } else {
    lines.push(
      `  Showing ${landing.recent_runs_showing} of ${landing.recent_runs_total}`,
    );
    for (const run of landing.recent_runs) {
      const summary = run.summary == null ? '(summary unavailable)' : run.summary;
      const when = run.last_event_at == null ? 'time unavailable' : run.last_event_at;
      const agents = run.agent_count == null ? 'agents unavailable' : `${run.agent_count} agents`;
      lines.push(
        `  ${run.activity_label}  ${run.run_id}  ${summary}  ${when}  ${agents}`,
      );
      if (run.reason_code) {
        lines.push(`    reason_code: ${run.reason_code}`);
      }
    }
  }
  if (landing.empty_state) {
    lines.push('', `== ${landing.empty_state.title} ==`, landing.empty_state.body);
  }
  return lines;
}

/**
 * Help surface copy (presentation only).
 * @returns {string[]}
 */
function formatHelpLines() {
  return [
    'ai-minions TUI — Help',
    '',
    'Navigation goals:',
    '  Home (h)       Task-first landing',
    '  New Run (1)    Guided launcher / canonical fixture',
    '  Runs (2)       Browse and select recent runs',
    '  Settings (4)   Providers, PATH, credentials readiness',
    '  Help (5 / ?)   This surface',
    '',
    'When a run is selected:',
    '  Overview (o)   Status / next_safe_action',
    '  Monitor (m)    Live phase + reason codes',
    '  Evidence (e)   Attach / bundle availability',
    '  Explain (x)    Explain next safe action',
    '',
    'Keys: ↑/↓ move · Enter select · Tab focus · / slash · q quit',
    'System Status (3): advanced diagnostics (git/path/credentials fields)',
    'Operator modules remain authoritative. Not claimed: Web UI · mouse · durable resume.',
  ];
}

/**
 * Advanced diagnostics lines (former raw home fields) — on demand only.
 * @param {object} home
 * @returns {string[]}
 */
function formatDiagnosticsLines(home = {}) {
  const lines = [
    'System Status / diagnostics',
    '(Advanced — not the default landing message)',
    '',
    `version: ${home.version ?? 'unavailable'}`,
    `git_commit: ${home.git_commit ?? 'unavailable'}`,
    `model_policy: ${home.model_policy ?? 'unavailable'}`,
    `path_status: ${home.path_status ?? 'unavailable'}`,
    `cli_on_path: ${home.cli_on_path == null ? 'unavailable' : String(home.cli_on_path)}`,
    `credential_sufficiency: ${home.credential_sufficiency ?? 'unavailable'}`,
    `remote_tokens_required: ${
      home.remote_tokens_required == null ? 'unavailable' : String(home.remote_tokens_required)
    }`,
  ];
  const providers = Array.isArray(home.providers) ? home.providers : [];
  if (!providers.length) {
    lines.push('providers: (none listed)');
  } else {
    lines.push('providers:');
    for (const p of providers) {
      lines.push(
        `  ${p.env_var ?? p.provider ?? 'provider'}: ${p.status ?? 'unavailable'}`
        + (p.required_for_policy ? ' (required)' : ''),
      );
    }
  }
  lines.push('', 'Raw reason codes and env names stay here — landing uses human summaries.');
  return lines;
}

module.exports = {
  LANDING_SCHEMA,
  RECENT_RUNS_LIMIT,
  landingQuickStartActions,
  adaptShellNavigation,
  deriveLandingOverall,
  classifyRunActivity,
  buildRecentRunPreview,
  buildLandingViewModel,
  formatLandingLines,
  formatHelpLines,
  formatDiagnosticsLines,
};
