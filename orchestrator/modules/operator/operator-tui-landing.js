'use strict';

/**
 * Presentation-oriented landing view-model for the Ink shell.
 * Consumes adapter fields only — does not infer readiness, budgets, or gate outcomes.
 */

const {
  landingGuardianPlainLines,
  landingGuardianRowsWide,
  landingGuardianRowsMid,
} = require('./operator-tui-splash');
const { resolveIconMode } = require('./operator-tui-icons');
const {
  buildLandingGuardianArt,
  buildPixelWordmarkRows,
  buildTextWordmarkSegments,
  sectionTitleWithPixelIcon,
} = require('./operator-tui-pixel-art');

const LANDING_SCHEMA = '1';
const RECENT_RUNS_LIMIT = 5;

/** @typedef {'ready'|'needs_setup'|'blocked'|'loading'|'failed'|'unknown'} LandingOverallState */
/** @typedef {'wide'|'mid'|'compact'} LandingLayoutMode */

/**
 * Landing composition thresholds (task-first home — not splash).
 * Wide: ≥100 cols and ≥24 rows. Mid: 80–99 cols (≥24 rows). Compact: <80 cols or short TTY.
 * Height-aware density (see resolveLandingComposition) may still drop lower-priority
 * blocks inside mid/compact so the frame fits the reported row count.
 * @param {unknown} columns
 * @param {unknown} rows
 * @returns {LandingLayoutMode}
 */
function landingLayoutForViewport(columns, rows) {
  const cols = Number(columns);
  const r = Number(rows);
  const c = Number.isFinite(cols) && cols >= 1 ? cols : 80;
  const rowCount = Number.isFinite(r) && r >= 1 ? r : 24;
  if (c < 80 || rowCount < 24) return 'compact';
  if (c < 100) return 'mid';
  return 'wide';
}

/**
 * @typedef {{
 *   show_guardian: boolean,
 *   show_product: boolean,
 *   show_tagline: boolean,
 *   show_triad: boolean,
 *   show_primary_cta: boolean,
 *   show_guardian_note: boolean,
 *   show_quick_start: boolean,
 *   show_quick_start_hint: boolean,
 *   quick_start_limit: number,
 *   show_readiness: boolean,
 *   show_readiness_next: boolean,
 *   show_readiness_details: boolean,
 *   show_recent_runs: boolean,
 *   recent_runs_limit: number,
 *   recent_empty_short: boolean,
 *   section_icon_rows?: number,
 *   drops: string[],
 * }} LandingComposition
 */

/** Chrome always present on the home surface (header + command + footer). */
const LANDING_CHROME_ROWS = 7;

/**
 * Full composition defaults for a layout mode (before row-budget drops).
 * @param {LandingLayoutMode} layout
 * @returns {LandingComposition}
 */
function defaultLandingComposition(layout) {
  return {
    show_guardian: layout !== 'compact',
    show_product: true,
    show_tagline: true,
    show_triad: true,
    show_primary_cta: true,
    show_guardian_note: layout !== 'compact',
    show_quick_start: true,
    show_quick_start_hint: true,
    quick_start_limit: 5,
    show_readiness: true,
    show_readiness_next: true,
    show_readiness_details: true,
    show_recent_runs: true,
    recent_runs_limit: RECENT_RUNS_LIMIT,
    recent_empty_short: false,
    section_icon_rows: 0,
    drops: [],
  };
}

/**
 * Drop order for row pressure — lowest priority first.
 * Lock v2 (≥80×24): keep compact guardian through panel pressure; reduce/hide
 * Recent Runs and decorative copy before omitting Cerberus. Never drops Start
 * New Run or Overall. `recent_empty_short` applies only when the run board is empty.
 */
const LANDING_COMPOSITION_DROP_STEPS = Object.freeze([
  {
    id: 'recent_empty_short',
    apply(c) {
      c.recent_empty_short = true;
    },
  },
  {
    id: 'reduce_recent',
    apply(c) {
      if (c.show_recent_runs && c.recent_runs_limit > 1) {
        c.recent_runs_limit = 1;
      }
    },
  },
  {
    id: 'hide_guardian_note',
    apply(c) {
      c.show_guardian_note = false;
    },
  },
  {
    id: 'hide_tagline',
    apply(c) {
      c.show_tagline = false;
    },
  },
  {
    id: 'hide_triad',
    apply(c) {
      c.show_triad = false;
    },
  },
  // Recent goes before Quick Start / readiness cuts — menus beat run history under pressure.
  {
    id: 'hide_recent',
    apply(c) {
      c.show_recent_runs = false;
      c.recent_runs_limit = 0;
    },
  },
  // Extreme short TTY only (gated in the composition loop for ≥80×24).
  {
    id: 'hide_readiness_details',
    apply(c) {
      c.show_readiness_details = false;
    },
  },
  {
    id: 'hide_readiness_next',
    apply(c) {
      c.show_readiness_next = false;
    },
  },
  {
    id: 'quick_start_primary_only',
    apply(c) {
      c.quick_start_limit = 1;
      c.show_quick_start_hint = false;
    },
  },
  {
    id: 'hide_guardian',
    apply(c) {
      c.show_guardian = false;
    },
  },
  {
    id: 'hide_quick_start',
    apply(c) {
      c.show_quick_start = false;
    },
  },
  {
    id: 'hide_product',
    apply(c) {
      c.show_product = false;
    },
  },
]);

/** Typical operator viewports must keep full Quick Start + readiness details. */
function isTypicalLandingViewport(columns, rows) {
  return Number(columns) >= 80 && Number(rows) >= 24;
}

/**
 * Estimate rendered row count for a composition (Ink borders + wrap heuristics).
 * Used only to decide drops; tests assert real Ink output ≤ reported rows.
 * Recent entries are one truncated line each — do not reserve wrap rows.
 * @param {LandingComposition} composition
 * @param {LandingLayoutMode} layout
 * @param {number} columns
 * @param {number} [guardianArtRows] actual guardian_rows.length when known
 * @param {number} [recentRunCount] actual runs.length when known (caps limit)
 * @param {number} [productArtRows] pixel wordmark rows when known (else 1)
 * @returns {number}
 */
function estimateLandingCompositionRows(
  composition,
  layout,
  columns,
  guardianArtRows,
  recentRunCount,
  productArtRows,
) {
  const cols = Number.isFinite(columns) && columns >= 1 ? columns : 80;
  const contentWidth = Math.max(16, cols - 4);

  let hero = 0;
  if (composition.show_product) {
    const productN = Number.isFinite(Number(productArtRows)) && Number(productArtRows) > 0
      ? Math.floor(Number(productArtRows))
      : 1;
    hero += productN;
  }
  if (composition.show_tagline) hero += 1;
  if (composition.show_triad) hero += 1;
  if (composition.show_primary_cta) hero += 1;
  if (composition.show_guardian_note) {
    hero += cols < 56 ? 2 : 1;
  }

  // Wide: guardian in bordered column beside hero → max(guardian, hero).
  // Mid (≥80): guardian beside hero without border → max(guardian, hero).
  // Compact: guardian stacked above hero → sum.
  let guardianLines = 0;
  if (composition.show_guardian) {
    const artN = Number.isFinite(Number(guardianArtRows)) && Number(guardianArtRows) > 0
      ? Math.floor(Number(guardianArtRows))
      : (layout === 'wide' ? 8 : (layout === 'mid' ? 9 : 0));
    guardianLines = layout === 'wide' ? artN + 2 : artN;
  }

  let bodyTop;
  if ((layout === 'wide' || layout === 'mid') && composition.show_guardian) {
    bodyTop = Math.max(guardianLines, hero);
  } else {
    bodyTop = (layout === 'compact' && composition.show_guardian ? guardianLines : 0) + hero;
  }

  const panel = (inner) => (inner > 0 ? inner + 2 : 0);

  let quickInner = 0;
  if (composition.show_quick_start) {
    // Title may include a 2-row lock icon block beside the label.
    quickInner = composition.section_icon_rows > 1 ? 2 : 1;
    if (composition.show_quick_start_hint) {
      // Mid/wide Quick Start is width 36; hint wraps on that pane.
      const qsContentWidth = layout === 'compact'
        ? contentWidth
        : Math.max(12, Math.min(34, cols - 2));
      quickInner += Math.max(1, Math.ceil('keyboard — not clickable'.length / qsContentWidth));
    }
    quickInner += Math.max(1, Number(composition.quick_start_limit) || 1);
  }

  let readyInner = 0;
  if (composition.show_readiness) {
    readyInner = (composition.section_icon_rows > 1 ? 2 : 1) + 1; // title + Overall
    if (composition.show_readiness_next) {
      // Mid readiness pane shares the row with Quick Start (~cols-36).
      const readyWidth = layout === 'compact'
        ? contentWidth
        : Math.max(20, cols - (composition.show_quick_start ? 40 : 4));
      const nextChars = 72;
      readyInner += Math.max(1, Math.ceil(nextChars / readyWidth));
    }
    if (composition.show_readiness_details) readyInner += 5;
  }

  let recentInner = 0;
  if (composition.show_recent_runs) {
    recentInner = composition.section_icon_rows > 1 ? 2 : 1;
    // Empty short only when the board is empty — never under-count real run rows.
    if (composition.recent_empty_short) {
      recentInner += 1;
    } else if (composition.recent_runs_limit > 0) {
      const limit = Math.max(0, Number(composition.recent_runs_limit) || 0);
      const known = Number.isFinite(Number(recentRunCount)) && Number(recentRunCount) >= 0
        ? Math.floor(Number(recentRunCount))
        : limit;
      const shown = Math.min(limit, known);
      recentInner += shown > 0 ? 1 + shown : 1;
    } else {
      recentInner += 1;
    }
  }

  const quickRows = panel(quickInner);
  const readyRows = panel(readyInner);
  const recentRows = panel(recentInner);
  const panels = layout === 'compact'
    ? quickRows + readyRows + recentRows
    : Math.max(quickRows, readyRows) + recentRows;

  // +1 slack so borderline wrap / yoga padding does not exceed the TTY.
  return LANDING_CHROME_ROWS + bodyTop + panels + 1;
}

/**
 * Height-aware landing composition: fit reported rows by dropping lower-priority
 * content before sacrificing Start New Run or the explicit Overall readiness line.
 * @param {unknown} columns
 * @param {unknown} rows
 * @param {{ guardianArtRows?: number, sectionIconRows?: number, productArtRows?: number }} [opts]
 * @returns {{ layout: LandingLayoutMode, composition: LandingComposition, estimated_rows: number }}
 */
function resolveLandingComposition(columns, rows, opts = {}) {
  const cols = Number(columns);
  const r = Number(rows);
  const c = Number.isFinite(cols) && cols >= 1 ? cols : 80;
  const rowCount = Number.isFinite(r) && r >= 1 ? Math.floor(r) : 24;
  const layout = landingLayoutForViewport(c, rowCount);
  const composition = defaultLandingComposition(layout);
  const guardianArtRows = Number(opts.guardianArtRows);
  const sectionIconRows = Number(opts.sectionIconRows);
  const productArtRows = Number(opts.productArtRows);
  if (Number.isFinite(sectionIconRows) && sectionIconRows > 0) {
    composition.section_icon_rows = Math.floor(sectionIconRows);
  }

  const productN = Number.isFinite(productArtRows) && productArtRows > 0
    ? Math.floor(productArtRows)
    : undefined;

  let estimated = estimateLandingCompositionRows(
    composition,
    layout,
    c,
    Number.isFinite(guardianArtRows) ? guardianArtRows : undefined,
    undefined,
    productN,
  );
  for (const step of LANDING_COMPOSITION_DROP_STEPS) {
    if (estimated <= rowCount) break;
    step.apply(composition);
    composition.drops.push(step.id);
    // Invariants: primary CTA + Overall readiness always remain.
    composition.show_primary_cta = true;
    composition.show_readiness = true;
    estimated = estimateLandingCompositionRows(
      composition,
      layout,
      c,
      Number.isFinite(guardianArtRows) ? guardianArtRows : undefined,
      undefined,
      productN,
    );
  }

  return { layout, composition, estimated_rows: estimated };
}

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
 * Collapse CR/LF to a single terminal-safe line (Ink wrap:truncate does not strip newlines).
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function terminalSafeSingleLine(value, fallback = '') {
  if (value == null) return fallback;
  return String(value)
    .replace(/\r\n/g, ' ')
    .replace(/[\r\n]/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .trim();
}

/**
 * One-line Recent Runs entry (no wrap). Truncates to fit content width.
 * Normalizes activity_label / run_id / summary / last_event_at before truncating
 * so embedded CR/LF cannot become extra physical Ink rows.
 * @param {{ activity_label?: string, run_id?: string, summary?: string | null, last_event_at?: string | null }} run
 * @param {number} columns
 * @param {{ compact?: boolean }} [opts]
 * @returns {string}
 */
function formatRecentRunEntryLine(run, columns, opts = {}) {
  const compact = opts.compact === true;
  const activity = terminalSafeSingleLine(run.activity_label, 'UNKNOWN') || 'UNKNOWN';
  const runId = terminalSafeSingleLine(run.run_id, '');
  const summary = terminalSafeSingleLine(run.summary, '');
  const whenRaw = terminalSafeSingleLine(run.last_event_at, '');
  const when = whenRaw === '' ? 'time unavailable' : whenRaw;
  let line = `  ${activity}  ${runId}`
    + (summary ? `  ${summary}` : '')
    + (compact ? '' : `  ${when}`);
  const max = Math.max(12, (Number.isFinite(Number(columns)) ? Number(columns) : 80) - 4);
  if (line.length > max) {
    line = `${line.slice(0, Math.max(1, max - 1))}…`;
  }
  return line;
}

/**
 * Build the landing view-model from shell adapter inputs.
 * @param {{
 *   home?: object,
 *   runs?: { runs?: object[], result_code?: string | null, next_safe_action?: string | null },
 *   selectedRunId?: string | null,
 *   version?: string | null,
 *   columns?: number,
 *   rows?: number,
 *   loading?: boolean,
 *   icons?: string,
 *   iconMode?: string,
 *   art?: string,
 *   artMode?: string,
 *   guardianStyle?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 */
function buildLandingViewModel(options = {}) {
  const home = options.home && typeof options.home === 'object' ? options.home : {};
  const runsAdapter = options.runs && typeof options.runs === 'object' ? options.runs : { runs: [] };
  const runs = Array.isArray(runsAdapter.runs) ? runsAdapter.runs : [];
  const columns = Number.isFinite(Number(options.columns)) ? Number(options.columns) : 80;
  const rows = Number.isFinite(Number(options.rows)) ? Number(options.rows) : 24;
  const iconMode = resolveIconMode(options);
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const layout = landingLayoutForViewport(columns, rows);
  const artOpts = {
    layout,
    icons: iconMode,
    art: options.art,
    artMode: options.artMode,
    guardianStyle: options.guardianStyle,
    env,
  };
  let pixelArt = buildLandingGuardianArt(artOpts);
  // Probe section icon height (lock v2 icons are two Braille rows).
  const sectionIconProbe = sectionTitleWithPixelIcon('Quick Start', 'quick_start', artOpts);
  const sectionIconRows = sectionIconProbe && typeof sectionIconProbe === 'object'
    && Array.isArray(sectionIconProbe.lines)
    ? sectionIconProbe.lines.length
    : 0;

  // Lock v2 3×5 pixel wordmark on wide arcade landings only (hero column budget).
  // Mid/compact keep scannable uppercase text (gradient when truecolor).
  const truecolor = options.truecolor === true;
  const colorEnabled = options.colorEnabled !== false;
  let product_rows = [];
  if (colorEnabled && layout === 'wide' && columns >= 100) {
    product_rows = buildPixelWordmarkRows({
      ...artOpts,
      truecolor,
    });
  }
  const product_segments = buildTextWordmarkSegments({
    truecolor,
    text: 'AI-MINIONS',
  });
  // Pixel rows + one text line when pixel is shown; text-only otherwise.
  let productArtRows = product_rows.length > 0
    ? product_rows.length + 1
    : 1;

  // Art-aware composition: demote art first (without consuming drop steps), then
  // apply drop order. Typical ≥80×24 keeps full Quick Start + readiness details.
  const composition = defaultLandingComposition(layout);
  composition.section_icon_rows = sectionIconRows;
  // Empty run boards: reserve one empty line, not recent_runs_limit phantom rows.
  if (runs.length === 0) {
    composition.recent_empty_short = true;
  }
  // Semantic labels replace the hero triad — drop before estimating row pressure.
  if (pixelArt.hide_hero_triad && composition.show_triad) {
    composition.show_triad = false;
    composition.drops.push('hide_triad_semantic');
  }
  const runCount = runs.length;
  const typicalViewport = isTypicalLandingViewport(columns, rows);
  const estimateNow = () => estimateLandingCompositionRows(
    composition,
    layout,
    columns,
    composition.show_guardian ? pixelArt.rows.length : 0,
    runCount,
    composition.show_product ? productArtRows : 0,
  );
  let estimated = estimateNow();

  // Art demotions — do not advance/skip LANDING_COMPOSITION_DROP_STEPS.
  // Prefer compact lock art on typical viewports; only go minimal when still over.
  while (estimated > rows) {
    let demoted = false;
    if (product_rows.length > 0) {
      product_rows = [];
      productArtRows = 1;
      composition.drops.push('product_text');
      demoted = true;
    } else if (
      pixelArt.variant === 'wide'
      && pixelArt.rows.length > 0
      && !composition.drops.includes('guardian_compact')
    ) {
      pixelArt = buildLandingGuardianArt({ ...artOpts, layout: 'mid' });
      composition.drops.push('guardian_compact');
      demoted = true;
    } else if (
      !typicalViewport
      && pixelArt.variant === 'compact'
      && pixelArt.rows.length > 0
      && !composition.drops.includes('guardian_minimal')
    ) {
      pixelArt = buildLandingGuardianArt({ ...artOpts, layout: 'compact' });
      composition.drops.push('guardian_minimal');
      demoted = true;
    }
    if (!demoted) break;
    estimated = estimateNow();
  }

  for (const step of LANDING_COMPOSITION_DROP_STEPS) {
    if (estimated <= rows) break;
    // recent_empty_short is empty-board only — never under-count real run rows.
    if (step.id === 'recent_empty_short' && runCount > 0) {
      continue;
    }
    if (step.id === 'recent_empty_short' && composition.recent_empty_short) {
      continue;
    }
    if (step.id === 'reduce_recent' && (!composition.show_recent_runs || composition.recent_runs_limit <= 1)) {
      continue;
    }
    // ≥80×24: never shrink Quick Start to CTA-only or strip readiness details/next.
    if (
      typicalViewport
      && (
        step.id === 'hide_readiness_details'
        || step.id === 'hide_readiness_next'
        || step.id === 'quick_start_primary_only'
      )
    ) {
      continue;
    }
    // After hide_recent on typical mid/wide, if still over: demote compact→minimal once.
    if (
      typicalViewport
      && step.id === 'hide_guardian'
      && pixelArt.variant === 'compact'
      && pixelArt.rows.length > 0
      && !composition.drops.includes('guardian_minimal')
    ) {
      pixelArt = buildLandingGuardianArt({ ...artOpts, layout: 'compact' });
      composition.drops.push('guardian_minimal');
      estimated = estimateNow();
      if (estimated <= rows) continue;
    }
    step.apply(composition);
    composition.drops.push(step.id);
    composition.show_primary_cta = true;
    composition.show_readiness = true;
    estimated = estimateNow();
  }
  const resolved = { layout, composition, estimated_rows: estimated };

  const showGuardian = composition.show_guardian === true
    && pixelArt.resolution.effective !== 'none';
  let guardian_lines = [];
  let guardian_rows = [];
  if (showGuardian) {
    if (pixelArt.resolution.effective === 'arcade' && pixelArt.rows.length > 0) {
      guardian_rows = pixelArt.rows;
      guardian_lines = pixelArt.lines;
    } else {
      guardian_lines = landingGuardianPlainLines(layout, iconMode);
      guardian_rows = layout === 'wide'
        ? landingGuardianRowsWide(iconMode)
        : (layout === 'mid' ? landingGuardianRowsMid(iconMode) : []);
    }
  }
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

  const allReadinessRows = [
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
  const readinessRows = composition.show_readiness_details ? allReadinessRows : [];

  const recentLimit = composition.show_recent_runs
    ? Math.max(0, Number(composition.recent_runs_limit) || 0)
    : 0;
  const recent = buildRecentRunPreview(runs, recentLimit);
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
      body: composition.recent_empty_short
        ? 'Waiting for readiness…'
        : 'Readiness and recent runs load after first paint. Fields stay unavailable until authoritative.',
    };
  } else if (overall.state === 'failed') {
    emptyState = {
      kind: 'failed',
      title: 'Readiness probe failed',
      body: composition.recent_empty_short
        ? 'Open System Status'
        : 'Bounded failure — open System Status. Do not treat missing fields as success.',
    };
  } else if (overall.state === 'blocked' || overall.state === 'needs_setup') {
    emptyState = {
      kind: overall.state,
      title: overall.label,
      body: composition.recent_empty_short
        ? 'Open Settings'
        : overall.next_action,
    };
  } else if (!runs.length) {
    emptyState = {
      kind: 'no_runs',
      title: 'No runs yet',
      body: composition.recent_empty_short
        ? 'Start New Run'
        : (overall.state === 'ready'
          ? 'Start a run to create the first trace. Canonical fixture is offered from New Run.'
          : overall.next_action),
    };
  }

  const version = options.version == null || options.version === ''
    ? (home.version == null ? 'unknown' : String(home.version))
    : String(options.version);

  const quickStartAll = landingQuickStartActions();
  const quickStart = composition.show_quick_start
    ? quickStartAll.slice(0, Math.max(1, Number(composition.quick_start_limit) || 1))
    : [];

  const sectionIcons = {
    quick_start: sectionTitleWithPixelIcon('Quick Start', 'quick_start', {
      icons: iconMode,
      art: options.art,
      artMode: options.artMode,
      env,
    }),
    readiness: sectionTitleWithPixelIcon('System Readiness', 'readiness', {
      icons: iconMode,
      art: options.art,
      artMode: options.artMode,
      env,
    }),
    recent_runs: sectionTitleWithPixelIcon('Recent Runs', 'recent_runs', {
      icons: iconMode,
      art: options.art,
      artMode: options.artMode,
      env,
    }),
  };
  /** Plain-string titles for text formatters (icon rows joined). */
  const sectionTitles = Object.fromEntries(
    Object.entries(sectionIcons).map(([key, value]) => {
      if (value && typeof value === 'object' && Array.isArray(value.lines)) {
        return [key, `${value.lines.join(' ')} ${value.label}`.trim()];
      }
      return [key, String(value ?? '')];
    }),
  );

  return {
    schema: LANDING_SCHEMA,
    kind: 'landing',
    version,
    layout,
    columns,
    rows,
    iconMode,
    art: pixelArt.resolution,
    guardian_style: pixelArt.resolution.guardianStyle,
    composition,
    estimated_rows: resolved.estimated_rows,
    show_guardian: showGuardian && guardian_lines.length > 0,
    guardian_lines,
    guardian_rows,
    guardian_display_width: pixelArt.display_width,
    section_icons: sectionIcons,
    section_titles: sectionTitles,
    hero: {
      product: 'AI-MINIONS',
      product_rows,
      product_segments,
      tagline: 'Contract-First Multi-Agent Orchestration Harness',
      triad: 'Validate • Trace • Enforce',
      guardian_note: 'Cerberus guards contracts and gates — secondary system symbol',
    },
    overall,
    quick_start: quickStart,
    readiness_rows: readinessRows,
    recent_runs: recent,
    recent_runs_total: runs.length,
    recent_runs_showing: recent.length,
    activity,
    empty_state: emptyState,
    primary_action_id: 'launcher',
    footer_hints_wide: '↑/↓ Navigate · Enter Select · Esc Home · q Quit · ? Help · /=slash',
    footer_hints_narrow: '↑↓ · Enter · Esc · q · ?',
  };
}

/**
 * Plain-text landing lines for assertions / NO_COLOR parity (not shareable CLI JSON).
 * Top-to-bottom grouping matches the approved task-first composition.
 * @param {ReturnType<typeof buildLandingViewModel>} landing
 * @param {{ selectedNavId?: string | null, narrow?: boolean }} [options]
 * @returns {string[]}
 */
function formatLandingLines(landing, options = {}) {
  const selectedNavId = options.selectedNavId == null ? null : String(options.selectedNavId);
  const narrow = options.narrow === true || landing.layout === 'compact';
  const comp = landing.composition && typeof landing.composition === 'object'
    ? landing.composition
    : defaultLandingComposition(landing.layout || 'compact');
  const lines = [];
  if (comp.show_guardian && landing.show_guardian && landing.guardian_lines.length) {
    lines.push('== Guardian ==');
    lines.push(...landing.guardian_lines);
    lines.push('');
  }
  lines.push('== Primary ==');
  if (comp.show_product) {
    lines.push(
      `${landing.hero.product}`
      + (comp.show_triad ? `  ${landing.hero.triad}` : ''),
    );
  } else if (comp.show_triad) {
    lines.push(landing.hero.triad);
  }
  if (comp.show_tagline) lines.push(landing.hero.tagline);
  lines.push(`v${String(landing.version).replace(/^v/i, '')}`);
  if (comp.show_primary_cta) {
    const marker = selectedNavId == null || selectedNavId === 'launcher' ? '>' : ' ';
    lines.push(`${marker} 1. Start New Run`);
  }
  if (comp.show_guardian_note) lines.push(landing.hero.guardian_note);
  if (comp.show_quick_start && landing.quick_start.length) {
    lines.push('', '== Quick Start ==');
    for (const item of landing.quick_start) {
      const marker = item.id === selectedNavId || (selectedNavId == null && item.primary)
        ? '>'
        : ' ';
      lines.push(
        `${marker} ${item.key}. ${item.label}`
        + (narrow || !comp.show_quick_start_hint ? '' : ` — ${item.description}`),
      );
    }
  }
  lines.push('', '== System Readiness ==');
  lines.push(
    comp.show_readiness_next
      ? `Overall: ${landing.overall.label} · next: ${landing.overall.next_action}`
      : `Overall: ${landing.overall.label}`,
  );
  if (comp.show_readiness_details) {
    for (const row of landing.readiness_rows) {
      const detail = row.detail ? ` (${row.detail})` : '';
      lines.push(`  ${row.label}: ${row.status_label}${detail}`);
    }
  }
  if (comp.show_recent_runs) {
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
      lines.push(
        comp.recent_empty_short && landing.empty_state
          ? `  ${landing.empty_state.title}: ${landing.empty_state.body}`
          : '  (No runs yet)',
      );
    } else {
      lines.push(
        `  Showing ${landing.recent_runs_showing} of ${landing.recent_runs_total}`,
      );
      for (const run of landing.recent_runs) {
        lines.push(formatRecentRunEntryLine(run, landing.columns ?? (narrow ? 60 : 100), {
          compact: narrow,
        }));
      }
    }
  }
  if (landing.empty_state && !comp.show_recent_runs) {
    // Keep empty/loading signal only when recent panel is dropped.
    lines.push('', `== ${landing.empty_state.title} ==`, landing.empty_state.body);
  } else if (landing.empty_state && !comp.recent_empty_short && landing.recent_runs.length) {
    lines.push('', `== ${landing.empty_state.title} ==`, landing.empty_state.body);
  }
  lines.push('', `== Controls ==`, narrow ? landing.footer_hints_narrow : landing.footer_hints_wide);
  return lines;
}

/**
 * In-process Help topics (presentation only — never dispatch shell remounts).
 * Selecting a topic must stay mounted; digits here are topic keys, not Quick Start.
 * Catalog covers navigation + selected-run Overview / Monitor / Evidence / Explain.
 * @returns {ReadonlyArray<{ id: string, key: string, label: string, lines: string[] }>}
 */
function helpTopics() {
  return Object.freeze([
    Object.freeze({
      id: 'navigation',
      key: '1',
      label: 'Help overview · Navigation',
      lines: Object.freeze([
        'Navigation goals (shell surfaces):',
        '  Home (h)            Task-first landing',
        '  New Run (1)         Guided launcher / canonical fixture',
        '  Runs (2)            Browse and select recent runs',
        '  System Status (3)   Advanced diagnostics (git/path/credentials)',
        '  Settings (4)        Providers, PATH, credentials readiness',
        '  Help (5 / ?)        This Help topic browser',
        '',
        'Leave Help with Esc (topic list → Home). Digits inside Help open topics only.',
      ]),
    }),
    Object.freeze({
      id: 'overview',
      key: '2',
      label: 'Overview (o)',
      lines: Object.freeze([
        'Overview (hotkey o) — when a run is selected:',
        '  Shows the seeded selected-run status snapshot on the shell model.',
        '  Fields: result_code · status · outcome · reason_code · next_safe_action.',
        '  In-process only — no remount, no fresh status query.',
        '  Fresh status: CLI `ai-minions status` or slash `/status`.',
        '',
        'This key is inactive while the Help surface is open (use Esc → Home first).',
      ]),
    }),
    Object.freeze({
      id: 'monitor',
      key: '3',
      label: 'Monitor (m)',
      lines: Object.freeze([
        'Monitor (hotkey m) — when a run is selected:',
        '  Live phase + reason codes for the selected run (read-only).',
        '  Opens the live monitor surface inside Ink when a run is selected.',
        '',
        'This key is inactive while the Help surface is open (use Esc → Home first).',
      ]),
    }),
    Object.freeze({
      id: 'evidence',
      key: '4',
      label: 'Evidence (e)',
      lines: Object.freeze([
        'Evidence (hotkey e) — when a run is selected:',
        '  Seeded attach / bundle availability from the shell evidence model.',
        '  In-process only — no attach prompt, no remount.',
        '  Attach generation: nested pane / CLI `ai-minions attach` / slash `/attach`.',
        '',
        'Digit 4 here opens this topic — never Settings (that would remount / look like quit).',
      ]),
    }),
    Object.freeze({
      id: 'explain',
      key: '5',
      label: 'Explain (x)',
      lines: Object.freeze([
        'Explain (hotkey x) — when a run is selected:',
        '  Shares the Overview status surface (reason_code / next_safe_action).',
        '  Seeded snapshot only — never synthesized from presentation text.',
        '  Fresh explain: CLI / slash `/explain`.',
        '',
        'This key is inactive while the Help surface is open (use Esc → Home first).',
      ]),
    }),
    Object.freeze({
      id: 'keys',
      key: '6',
      label: 'Keys and input',
      lines: Object.freeze([
        'Keys:',
        '  ↑/↓ move · Enter select · Esc back · Tab focus · / slash · q quit',
        '  Top-level s is ignored (use Runs / ↑↓).',
        '  Legacy readline matrix: AI_MINIONS_TUI_LEGACY=1 only.',
        '',
        'Inside Help: ↑/↓ topics · digit open topic · Enter open · Esc close topic / Home.',
      ]),
    }),
    Object.freeze({
      id: 'display',
      key: '7',
      label: 'Icons and display',
      lines: Object.freeze([
        'Icons: AI_MINIONS_TUI_ICONS=nerd|unicode|ascii',
        '  Default nerd — operator choice; not auto glyph detect.',
        '  NO_COLOR does not switch icon mode.',
        '',
        'Art: AI_MINIONS_TUI_ART=auto|arcade|text|none',
        '  auto → arcade for nerd/unicode; text for ascii.',
        '  Invalid ART values fail closed to auto; reason stays in debug across remounts.',
        '  Guardian: AI_MINIONS_TUI_GUARDIAN=neon|semantic (default semantic=lock v2; neon opt-in).',
        '',
        'Selecting this topic never opens Settings (that would remount / look like quit).',
      ]),
    }),
    Object.freeze({
      id: 'limits',
      key: '8',
      label: 'Honest product limits',
      lines: Object.freeze([
        'Operator modules remain authoritative.',
        'Not claimed: Web UI · mouse clicks on labels · durable resume.',
        'Help topics are in-process only — no nested readline from this surface.',
        'Cold start always lands on Home — Start New Run requires an explicit open.',
      ]),
    }),
  ]);
}

/**
 * Help surface copy — topic list or open topic body (presentation only).
 * @param {{
 *   selectedTopicId?: string | null,
 *   openTopicId?: string | null,
 * }} [options]
 * @returns {string[]}
 */
function formatHelpLines(options = {}) {
  const topics = helpTopics();
  const openId = options.openTopicId == null || options.openTopicId === ''
    ? null
    : String(options.openTopicId);
  if (openId) {
    const topic = topics.find((t) => t.id === openId) ?? topics[0];
    return [
      `ai-minions TUI — Help · ${topic.label}`,
      '',
      ...topic.lines,
      '',
      'Esc back to topic list · q quit',
    ];
  }
  const selectedId = options.selectedTopicId == null || options.selectedTopicId === ''
    ? topics[0]?.id
    : String(options.selectedTopicId);
  return [
    'ai-minions TUI — Help',
    '',
    'Topics (in-process — selecting does not exit the TUI):',
    ...topics.map((t) => {
      const mark = t.id === selectedId ? '>' : ' ';
      return `  ${mark} ${t.key}. ${t.label}`;
    }),
    '',
    '↑/↓ move · Enter / digit open topic · Esc Home · q quit',
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
  LANDING_CHROME_ROWS,
  LANDING_COMPOSITION_DROP_STEPS,
  isTypicalLandingViewport,
  landingLayoutForViewport,
  defaultLandingComposition,
  estimateLandingCompositionRows,
  resolveLandingComposition,
  landingQuickStartActions,
  adaptShellNavigation,
  deriveLandingOverall,
  classifyRunActivity,
  buildRecentRunPreview,
  formatRecentRunEntryLine,
  buildLandingViewModel,
  formatLandingLines,
  helpTopics,
  formatHelpLines,
  formatDiagnosticsLines,
};
