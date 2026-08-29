'use strict';

const { NATIVE_LAUNCHER_EXECUTE_ACTION } = require('./operator-tui-native-workflows');

/** @typedef {'pending'|'success'|'failed'|'cancelled'|'timed_out'|'superseded'} TuiActionStatus */

const TUI_ACTION_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed_out',
  SUPERSEDED: 'superseded',
});

const TUI_ACTION_KIND = Object.freeze({
  START_RUN: 'START_RUN',
  CONTINUE_CURRENT: 'CONTINUE_CURRENT',
  ATTACH_GENERATION: 'ATTACH_GENERATION',
  STATUS_REFRESH: 'STATUS_REFRESH',
  MONITOR_REFRESH: 'MONITOR_REFRESH',
  READ_SURFACE: 'READ_SURFACE',
});

const TUI_ACTION_REASON = Object.freeze({
  DUPLICATE_REJECTED: 'TUI_ACTION_DUPLICATE',
  NESTED_IO_BUSY: 'TUI_ACTION_NESTED_IO_BUSY',
  SUPERSEDED: 'TUI_ACTION_SUPERSEDED',
  TIMED_OUT: 'TUI_ACTION_TIMED_OUT',
  CANCELLED: 'TUI_ACTION_CANCELLED',
  STALE_CONTEXT: 'TUI_ACTION_STALE_CONTEXT',
});

/** @type {Record<string, { concurrency: 'serialize'|'latest_wins', scope: 'session'|'run', timeout_ms: number | null }>} */
const DEFAULT_ACTION_POLICIES = Object.freeze({
  [TUI_ACTION_KIND.START_RUN]: {
    concurrency: 'serialize',
    scope: 'session',
    timeout_ms: null,
  },
  [TUI_ACTION_KIND.CONTINUE_CURRENT]: {
    concurrency: 'serialize',
    scope: 'run',
    timeout_ms: null,
  },
  [TUI_ACTION_KIND.ATTACH_GENERATION]: {
    concurrency: 'serialize',
    scope: 'run',
    timeout_ms: null,
  },
  [TUI_ACTION_KIND.STATUS_REFRESH]: {
    concurrency: 'latest_wins',
    scope: 'run',
    timeout_ms: 120_000,
  },
  [TUI_ACTION_KIND.MONITOR_REFRESH]: {
    concurrency: 'latest_wins',
    scope: 'run',
    timeout_ms: 60_000,
  },
  [TUI_ACTION_KIND.READ_SURFACE]: {
    concurrency: 'latest_wins',
    scope: 'run',
    timeout_ms: 30_000,
  },
});

/**
 * Map shell/nested action ids to executor action kinds.
 * @param {unknown} actionId
 * @returns {string}
 */
/**
 * @param {string} actionKind
 * @param {unknown} [actionId]
 * @returns {string}
 */
function labelForActionKind(actionKind, actionId) {
  switch (actionKind) {
    case TUI_ACTION_KIND.START_RUN:
      return 'Launching run';
    case TUI_ACTION_KIND.ATTACH_GENERATION:
      return 'Attaching generation';
    case TUI_ACTION_KIND.STATUS_REFRESH:
      return 'Refreshing status';
    case TUI_ACTION_KIND.MONITOR_REFRESH:
      return 'Refreshing monitor';
    case TUI_ACTION_KIND.CONTINUE_CURRENT:
      return 'Continuing run';
    default:
      return `Running ${String(actionId ?? 'action')}`;
  }
}

/**
 * @param {unknown} actionId
 * @param {{ actionKind?: string, requestId?: string | null, label?: string, started_at?: number | null }} [extras]
 * @returns {{ action_id: string, action_kind: string, request_id: string | null, label: string, started_at: number | null }}
 */
function buildPendingOperatorAction(actionId, extras = {}) {
  const actionKind = extras.actionKind ?? mapShellActionToActionKind(actionId);
  return {
    action_id: String(actionId ?? ''),
    action_kind: actionKind,
    request_id: extras.requestId ?? null,
    label: extras.label ?? labelForActionKind(actionKind, actionId),
    started_at: extras.started_at ?? null,
  };
}

function mapShellActionToActionKind(actionId) {
  const id = String(actionId ?? '').trim().toLowerCase();
  if (id === NATIVE_LAUNCHER_EXECUTE_ACTION || id === 'launcher_execute') {
    return TUI_ACTION_KIND.START_RUN;
  }
  if (id === 'attach') return TUI_ACTION_KIND.ATTACH_GENERATION;
  if (id === 'status') return TUI_ACTION_KIND.STATUS_REFRESH;
  if (id === 'explain') return TUI_ACTION_KIND.STATUS_REFRESH;
  if (id === 'monitor') return TUI_ACTION_KIND.MONITOR_REFRESH;
  if (id === 'continue' || id === 'resume') return TUI_ACTION_KIND.CONTINUE_CURRENT;
  return TUI_ACTION_KIND.READ_SURFACE;
}

/**
 * @param {string} actionKind
 * @returns {{ concurrency: 'serialize'|'latest_wins', scope: 'session'|'run', timeout_ms: number | null }}
 */
function policyForActionKind(actionKind) {
  return DEFAULT_ACTION_POLICIES[actionKind]
    ?? DEFAULT_ACTION_POLICIES[TUI_ACTION_KIND.READ_SURFACE];
}

/**
 * @param {{ runId?: string | null, surface?: string | null }} requestCtx
 * @param {{ runId?: string | null, surface?: string | null }} activeCtx
 * @param {{ scope: 'session'|'run' }} policy
 * @returns {boolean}
 */
function contextsMatch(requestCtx, activeCtx, policy, actionKind) {
  if (policy.scope === 'session') return true;
  const reqRun = requestCtx?.runId ?? null;
  const activeRun = activeCtx?.runId ?? null;
  if (reqRun !== activeRun) return false;
  if (!activeKeyIncludesSurface(actionKind)) return true;
  const reqSurface = requestCtx?.surface ?? null;
  const activeSurface = activeCtx?.surface ?? null;
  if (reqSurface == null || activeSurface == null) return true;
  return reqSurface === activeSurface;
}

/**
 * @param {string} actionKind
 * @returns {boolean}
 */
function activeKeyIncludesSurface(actionKind) {
  return actionKind === TUI_ACTION_KIND.STATUS_REFRESH
    || actionKind === TUI_ACTION_KIND.MONITOR_REFRESH
    || actionKind === TUI_ACTION_KIND.READ_SURFACE;
}

/**
 * @param {unknown} actionId
 * @param {string} reasonCode
 * @param {string} [text]
 * @returns {{ action_id: string, ok: boolean, exit_code: number, reason_code: string, text: string }}
 */
function buildTerminalActionResult(actionId, reasonCode, text) {
  return {
    action_id: String(actionId ?? ''),
    ok: false,
    exit_code: 0,
    reason_code: reasonCode,
    text: text ?? reasonCode,
  };
}

/**
 * Map abort/signal interruption to the executor's terminal request state.
 * Timeout and supersede also abort the signal — prefer those over CANCELLED.
 * @param {object | null | undefined} request
 * @returns {{ status: string, reason_code: string, text: string }}
 */
function resolveAbortedRequestOutcome(request) {
  if (!request) {
    return {
      status: TUI_ACTION_STATUS.CANCELLED,
      reason_code: TUI_ACTION_REASON.CANCELLED,
      text: 'Action cancelled.',
    };
  }
  if (request.status === TUI_ACTION_STATUS.TIMED_OUT) {
    return {
      status: TUI_ACTION_STATUS.TIMED_OUT,
      reason_code: TUI_ACTION_REASON.TIMED_OUT,
      text: 'Action timed out.',
    };
  }
  if (request.status === TUI_ACTION_STATUS.SUPERSEDED) {
    return {
      status: TUI_ACTION_STATUS.SUPERSEDED,
      reason_code: request.reason_code ?? TUI_ACTION_REASON.SUPERSEDED,
      text: 'Action superseded.',
    };
  }
  if (request.status === TUI_ACTION_STATUS.CANCELLED) {
    return {
      status: TUI_ACTION_STATUS.CANCELLED,
      reason_code: TUI_ACTION_REASON.CANCELLED,
      text: 'Action cancelled.',
    };
  }
  return {
    status: TUI_ACTION_STATUS.CANCELLED,
    reason_code: TUI_ACTION_REASON.CANCELLED,
    text: 'Action cancelled.',
  };
}

/**
 * @param {string} actionKind
 * @param {string | null} runId
 * @param {string | null} surface
 * @returns {{ runId: string | null, surface: string | null }}
 */
function actionContextForKind(actionKind, runId, surface) {
  return {
    runId: runId ?? null,
    surface: activeKeyIncludesSurface(actionKind) ? (surface ?? null) : null,
  };
}

/**
 * @param {string} actionKind
 * @param {{ runId?: string | null, surface?: string | null }} context
 * @param {{ scope: 'session'|'run' }} policy
 * @returns {string}
 */
function activeKeyFor(actionKind, context, policy) {
  if (policy.scope === 'session') return `session:${actionKind}`;
  const runId = context?.runId ?? '_none_';
  if (activeKeyIncludesSurface(actionKind)) {
    const surface = context?.surface ?? '_any_';
    return `${actionKind}:${runId}:${surface}`;
  }
  return `${actionKind}:${runId}`;
}

/**
 * Correlated async operator-action executor for the TUI shell boundary.
 * @param {{
 *   now?: () => number,
 *   createId?: () => string,
 *   policies?: Record<string, object>,
 * }} [options]
 */
function createTuiActionExecutor(options = {}) {
  let seq = 0;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const createId = typeof options.createId === 'function'
    ? options.createId
    : () => `tui-req-${++seq}-${now()}`;
  /** @type {Map<string, object>} */
  const requests = new Map();
  /** @type {Map<string, string>} */
  const activeByKey = new Map();
  /** @type {{ runId: string | null, surface: string | null }} */
  let currentContext = { runId: null, surface: null };

  function markSuperseded(request) {
    request.status = TUI_ACTION_STATUS.SUPERSEDED;
    request.reason_code = TUI_ACTION_REASON.SUPERSEDED;
    request.completed_at = now();
    if (request.abortController && typeof request.abortController.abort === 'function') {
      request.abortController.abort();
    }
    const key = activeKeyFor(request.action_kind, request.context, request.policy);
    if (activeByKey.get(key) === request.request_id) activeByKey.delete(key);
  }

  /**
   * @param {{ actionKind: string, context?: { runId?: string | null, surface?: string | null } }} input
   * @returns {{
   *   accepted: boolean,
   *   request?: object,
   *   reason_code?: string,
   *   duplicate_of?: string,
   * }}
   */
  function beginRequest(input) {
    const actionKind = String(input?.actionKind ?? TUI_ACTION_KIND.READ_SURFACE);
    const policy = policyForActionKind(actionKind);
    const context = {
      runId: input?.context?.runId ?? null,
      surface: input?.context?.surface ?? null,
    };
    const key = activeKeyFor(actionKind, context, policy);

    if (policy.concurrency === 'serialize') {
      const activeId = activeByKey.get(key);
      if (activeId) {
        const active = requests.get(activeId);
        if (active && active.status === TUI_ACTION_STATUS.PENDING) {
          return {
            accepted: false,
            reason_code: TUI_ACTION_REASON.DUPLICATE_REJECTED,
            duplicate_of: activeId,
          };
        }
      }
    } else if (policy.concurrency === 'latest_wins') {
      const activeId = activeByKey.get(key);
      if (activeId) {
        const prev = requests.get(activeId);
        if (prev && prev.status === TUI_ACTION_STATUS.PENDING) {
          markSuperseded(prev);
        }
      }
    }

    /** @type {object} */
    const request = {
      request_id: createId(),
      action_kind: actionKind,
      started_at: now(),
      completed_at: null,
      context: { ...context },
      policy: { ...policy },
      status: TUI_ACTION_STATUS.PENDING,
      reason_code: null,
      abortController: typeof AbortController !== 'undefined' ? new AbortController() : null,
    };
    requests.set(request.request_id, request);
    activeByKey.set(key, request.request_id);
    return { accepted: true, request };
  }

  /**
   * @param {{ runId?: string | null, surface?: string | null }} context
   */
  function noteContextChange(context) {
    currentContext = {
      runId: context?.runId ?? null,
      surface: context?.surface ?? null,
    };
    for (const req of requests.values()) {
      if (req.status !== TUI_ACTION_STATUS.PENDING) continue;
      if (contextsMatch(req.context, currentContext, req.policy, req.action_kind)) continue;
      req.status = TUI_ACTION_STATUS.SUPERSEDED;
      req.reason_code = TUI_ACTION_REASON.STALE_CONTEXT;
      req.completed_at = now();
      if (req.abortController && typeof req.abortController.abort === 'function') {
        req.abortController.abort();
      }
      const key = activeKeyFor(req.action_kind, req.context, req.policy);
      if (activeByKey.get(key) === req.request_id) activeByKey.delete(key);
    }
  }

  /**
   * @param {string} requestId
   * @param {{ runId?: string | null, surface?: string | null }} [context]
   * @returns {{ apply: boolean, reason_code?: string, request?: object }}
   */
  function shouldApplyResult(requestId, context = currentContext) {
    const req = requests.get(requestId);
    if (!req) {
      return { apply: false, reason_code: TUI_ACTION_REASON.STALE_CONTEXT };
    }
    if (req.status !== TUI_ACTION_STATUS.PENDING) {
      return { apply: false, reason_code: req.reason_code ?? TUI_ACTION_REASON.STALE_CONTEXT };
    }
    if (!contextsMatch(req.context, context, req.policy, req.action_kind)) {
      req.status = TUI_ACTION_STATUS.SUPERSEDED;
      req.reason_code = TUI_ACTION_REASON.STALE_CONTEXT;
      req.completed_at = now();
      const key = activeKeyFor(req.action_kind, req.context, req.policy);
      if (activeByKey.get(key) === req.request_id) activeByKey.delete(key);
      return { apply: false, reason_code: TUI_ACTION_REASON.STALE_CONTEXT, request: req };
    }
    return { apply: true, request: req };
  }

  /**
   * @param {string} requestId
   * @param {{
   *   status?: TuiActionStatus,
   *   reason_code?: string | null,
   *   context?: { runId?: string | null, surface?: string | null },
   * }} [outcome]
   */
  function completeRequest(requestId, outcome = {}) {
    const req = requests.get(requestId);
    if (!req) return { ok: false, applied: false };

    const terminalStatus = outcome.status ?? TUI_ACTION_STATUS.SUCCESS;
    const context = outcome.context ?? currentContext;

    if (terminalStatus === TUI_ACTION_STATUS.SUCCESS || terminalStatus === TUI_ACTION_STATUS.FAILED) {
      const gate = shouldApplyResult(requestId, context);
      if (!gate.apply) {
        return { ok: true, applied: false, reason_code: gate.reason_code, request: req };
      }
    }

    req.status = terminalStatus;
    req.reason_code = outcome.reason_code ?? req.reason_code;
    req.completed_at = now();
    const key = activeKeyFor(req.action_kind, req.context, req.policy);
    if (activeByKey.get(key) === req.request_id) activeByKey.delete(key);
    return { ok: true, applied: true, request: req };
  }

  /**
   * @param {string} requestId
   */
  function cancelRequest(requestId) {
    const req = requests.get(requestId);
    if (!req || req.status !== TUI_ACTION_STATUS.PENDING) return { ok: false };
    if (req.abortController && typeof req.abortController.abort === 'function') {
      req.abortController.abort();
    }
    req.status = TUI_ACTION_STATUS.CANCELLED;
    req.reason_code = TUI_ACTION_REASON.CANCELLED;
    req.completed_at = now();
    const key = activeKeyFor(req.action_kind, req.context, req.policy);
    if (activeByKey.get(key) === req.request_id) activeByKey.delete(key);
    return { ok: true, request: req };
  }

  function cancelAllPending() {
    /** @type {object[]} */
    const cancelled = [];
    for (const req of requests.values()) {
      if (req.status !== TUI_ACTION_STATUS.PENDING) continue;
      const outcome = cancelRequest(req.request_id);
      if (outcome.ok && outcome.request) cancelled.push(outcome.request);
    }
    return { ok: true, cancelled };
  }

  /**
   * @param {string} requestId
   * @param {number} timeoutMs
   * @param {{ setTimeout?: Function, clearTimeout?: Function }} [timers]
   */
  function scheduleTimeout(requestId, timeoutMs, timers = {}) {
    const setTimer = timers.setTimeout ?? setTimeout;
    const clearTimer = timers.clearTimeout ?? clearTimeout;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { cancel: () => {} };

    const handle = setTimer(() => {
      const req = requests.get(requestId);
      if (!req || req.status !== TUI_ACTION_STATUS.PENDING) return;
      if (req.abortController && typeof req.abortController.abort === 'function') {
        req.abortController.abort();
      }
      req.status = TUI_ACTION_STATUS.TIMED_OUT;
      req.reason_code = TUI_ACTION_REASON.TIMED_OUT;
      req.completed_at = now();
      const key = activeKeyFor(req.action_kind, req.context, req.policy);
      if (activeByKey.get(key) === req.request_id) activeByKey.delete(key);
    }, timeoutMs);

    return {
      cancel: () => clearTimer(handle),
    };
  }

  /**
   * @param {string} actionKind
   * @param {{ runId?: string | null, surface?: string | null }} [context]
   * @returns {boolean}
   */
  function isPending(actionKind, context = currentContext) {
    const policy = policyForActionKind(actionKind);
    const key = activeKeyFor(actionKind, context, policy);
    const id = activeByKey.get(key);
    if (!id) return false;
    const req = requests.get(id);
    return req?.status === TUI_ACTION_STATUS.PENDING;
  }

  return {
    beginRequest,
    completeRequest,
    shouldApplyResult,
    cancelRequest,
    cancelAllPending,
    noteContextChange,
    scheduleTimeout,
    isPending,
    getRequest: (id) => requests.get(id),
    get currentContext() {
      return { ...currentContext };
    },
  };
}

module.exports = {
  TUI_ACTION_STATUS,
  TUI_ACTION_KIND,
  TUI_ACTION_REASON,
  DEFAULT_ACTION_POLICIES,
  labelForActionKind,
  buildPendingOperatorAction,
  buildTerminalActionResult,
  resolveAbortedRequestOutcome,
  actionContextForKind,
  activeKeyIncludesSurface,
  mapShellActionToActionKind,
  policyForActionKind,
  createTuiActionExecutor,
};
