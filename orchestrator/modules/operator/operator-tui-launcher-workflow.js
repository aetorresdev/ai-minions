'use strict';

/**
 * Guided launcher native workflow controller (presentation state machine).
 * Operator modules remain authoritative for readiness / launch execution.
 */

const {
  AGENT_FLOW_OPTIONS,
  INFERENCE_LANE_OPTIONS,
  CANONICAL_FIXTURE_OPTIONS,
  LAUNCHER_REASON,
  buildGuidedLauncherModel,
  formatGuidedLauncherLines,
} = require('./operator-guided-launcher-model');
const {
  createSelectState,
  resolveSelectKeypress,
  formatSelectLines,
} = require('./operator-tui-select-controller');

/** Default smoke goal text — keep in sync with operator-guided-first-run DEFAULT_SMOKE_GOAL. */
const DEFAULT_SMOKE_GOAL = [
  'MODE: QA',
  'FLOW: single_agent',
  'Beta smoke validation (QA role): read README.md and orchestrator/package.json.',
  'Your reply MUST START with YAML (no markdown fence before it) containing:',
  'files_read:, files_modified:, validation_run:',
  'List README.md and orchestrator/package.json under files_read.',
  'files_modified must only contain paths already listed in files_read.',
  'validation_run must cite a real command (e.g. test -f README.md).',
  'Classify at least one finding as blocker | improvement | nice-to-have.',
  'After YAML, name one more file visible in the repo root in one sentence. Stop.',
].join(' ');

const LAUNCHER_WORKFLOW_KIND = 'launcher';

const STEPS = Object.freeze([
  'agent_flow',
  'inference_lane',
  'gate_posture',
  'goal_source',
  'fixture',
  'custom_goal',
  'preview',
  'confirm',
]);

/**
 * @returns {{ id: string, label: string, disabled?: boolean, note?: string|null, reason_code?: string|null }[]}
 */
function optionsForStep(step) {
  if (step === 'agent_flow') {
    return AGENT_FLOW_OPTIONS.map((o) => ({
      id: o.id,
      label: `${o.label} (${o.cli_value})`,
    }));
  }
  if (step === 'inference_lane') {
    return INFERENCE_LANE_OPTIONS.map((o) => ({
      id: o.id,
      label: `${o.label} → ${o.product_policy ?? 'unsupported'}`,
      disabled: !o.enabled,
      note: o.note ?? null,
      reason_code: o.disabled_reason_code ?? null,
    }));
  }
  if (step === 'gate_posture') {
    return [
      { id: 'degraded', label: 'degraded (--skip-gates) — typical smoke / matrix cell' },
      { id: 'strict', label: 'strict (MCP gates / CERBERUS path enabled)' },
    ];
  }
  if (step === 'goal_source') {
    return [
      { id: 'default_smoke', label: 'default smoke goal (guided CLI smoke contract)' },
      { id: 'fixture', label: 'canonical tester fixture' },
      { id: 'custom', label: 'custom prompt' },
    ];
  }
  if (step === 'fixture') {
    return CANONICAL_FIXTURE_OPTIONS.map((f) => ({
      id: f.id,
      label: `${f.title} [${f.id}]`,
    }));
  }
  if (step === 'confirm') {
    return [
      { id: 'launch', label: 'Launch with the equivalent command' },
      { id: 'back', label: 'Back to preview' },
    ];
  }
  return [];
}

/**
 * @param {{
 *   defaultSmokeGoal?: string,
 *   previousSurface?: string,
 *   previousFocus?: string,
 * }} [opts]
 */
function createLauncherWorkflow(opts = {}) {
  const step = 'agent_flow';
  return {
    kind: LAUNCHER_WORKFLOW_KIND,
    step,
    select: createSelectState(optionsForStep(step)),
    selections: {
      agentFlow: 'single_agent',
      inferenceLane: 'local_only',
      gatePosture: 'degraded',
      goalSource: 'default_smoke',
      fixtureId: null,
      goal: '',
    },
    textBuffer: '',
    inlineError: null,
    blockedReasonCode: null,
    previewModel: null,
    previewLines: [],
    defaultSmokeGoal: opts.defaultSmokeGoal ?? DEFAULT_SMOKE_GOAL,
    previousSurface: opts.previousSurface ?? 'home',
    previousFocus: opts.previousFocus ?? 'nav',
  };
}

/**
 * @param {object} workflow
 * @param {string} step
 * @returns {object}
 */
function withStep(workflow, step) {
  if (step === 'custom_goal') {
    return {
      ...workflow,
      step,
      select: createSelectState([]),
      textBuffer: workflow.selections.goal || '',
      inlineError: null,
    };
  }
  if (step === 'preview') {
    return {
      ...workflow,
      step,
      select: createSelectState([]),
      inlineError: null,
    };
  }
  return {
    ...workflow,
    step,
    select: createSelectState(optionsForStep(step)),
    inlineError: null,
  };
}

/**
 * Build preview model from current selections (no launch).
 * @param {object} workflow
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   credentials?: object,
 *   localBackendReachable?: boolean | null,
 *   fixturePrompt?: string | null,
 * }} [ctx]
 */
function buildPreviewFromWorkflow(workflow, ctx = {}) {
  const sel = workflow.selections;
  let goal = sel.goal;
  if (sel.goalSource === 'default_smoke') {
    goal = workflow.defaultSmokeGoal;
  } else if (sel.goalSource === 'fixture') {
    goal = ctx.fixturePrompt ?? sel.goal ?? '';
  }
  const model = buildGuidedLauncherModel({
    agentFlow: sel.agentFlow,
    inferenceLane: sel.inferenceLane,
    gatePosture: sel.gatePosture,
    goalSource: sel.goalSource,
    goal,
    fixtureId: sel.fixtureId,
    fixturePrompt: ctx.fixturePrompt ?? null,
    defaultSmokeGoal: workflow.defaultSmokeGoal,
    localBackendReachable: ctx.localBackendReachable,
    credentials: ctx.credentials,
    env: ctx.env,
    maxIterations: sel.gatePosture === 'degraded' && sel.agentFlow === 'single_agent'
      ? 1
      : undefined,
  });
  return {
    ...workflow,
    previewModel: model,
    previewLines: formatGuidedLauncherLines(model),
    selections: { ...sel, goal },
  };
}

/**
 * @param {object} workflow
 * @returns {string[]}
 */
function formatLauncherWorkflowLines(workflow) {
  const lines = [
    'Guided launcher (native)',
    `step: ${workflow.step}`,
  ];
  if (workflow.inlineError) {
    lines.push(`error: ${workflow.inlineError}`);
  }
  if (workflow.blockedReasonCode) {
    lines.push(`blocked_reason_code: ${workflow.blockedReasonCode}`);
  }
  if (workflow.step === 'custom_goal') {
    lines.push('Enter custom goal prompt:');
    lines.push(`> ${workflow.textBuffer || ''}`);
    lines.push('Type · Enter confirm · Esc back');
    return lines;
  }
  if (workflow.step === 'preview') {
    lines.push('== Pre-launch execution summary ==');
    lines.push(...(workflow.previewLines || []));
    if (workflow.previewModel && !workflow.previewModel.can_launch) {
      lines.push(
        `cannot launch: ${workflow.previewModel.blocked_reason_code ?? LAUNCHER_REASON.GOAL_REQUIRED}`,
      );
      if (workflow.previewModel.remediation) {
        lines.push(`remediation: ${workflow.previewModel.remediation}`);
      }
      lines.push('Esc cancel · Enter → confirm step (or back)');
    } else {
      lines.push('Enter → confirm launch · Esc cancel');
    }
    return lines;
  }
  lines.push(...formatSelectLines(workflow.select, {
    title: `Choose: ${workflow.step.replace(/_/g, ' ')}`,
    hint: '↑/↓ move · Enter confirm · Esc cancel/back',
  }));
  lines.push(
    `sel: mode=${workflow.selections.agentFlow} lane=${workflow.selections.inferenceLane} `
    + `gate=${workflow.selections.gatePosture} goal=${workflow.selections.goalSource}`,
  );
  return lines;
}

/**
 * Advance after a confirmed choice at the current step.
 * @param {object} workflow
 * @param {{ id: string }} option
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   credentials?: object,
 *   localBackendReachable?: boolean | null,
 *   loadFixturePrompt?: (id: string) => Promise<string>,
 * }} [ctx]
 * @returns {Promise<{
 *   action: 'update'|'cancel'|'execute'|'blocked',
 *   workflow?: object,
 *   reason_code?: string,
 *   selections?: object,
 * }>}
 */
async function advanceLauncherWorkflow(workflow, option, ctx = {}) {
  const step = workflow.step;
  const sel = { ...workflow.selections };

  if (step === 'agent_flow') {
    sel.agentFlow = option.id;
    return { action: 'update', workflow: withStep({ ...workflow, selections: sel }, 'inference_lane') };
  }

  if (step === 'inference_lane') {
    if (option.id === 'hybrid' || option.disabled) {
      const blocked = buildPreviewFromWorkflow(
        {
          ...workflow,
          selections: { ...sel, inferenceLane: 'hybrid' },
        },
        ctx,
      );
      return {
        action: 'blocked',
        workflow: {
          ...blocked,
          step: 'preview',
          select: createSelectState([]),
          blockedReasonCode: LAUNCHER_REASON.HYBRID_UNSUPPORTED,
          inlineError: 'Hybrid inference lane is unsupported',
        },
        reason_code: LAUNCHER_REASON.HYBRID_UNSUPPORTED,
      };
    }
    sel.inferenceLane = option.id;
    return { action: 'update', workflow: withStep({ ...workflow, selections: sel }, 'gate_posture') };
  }

  if (step === 'gate_posture') {
    sel.gatePosture = option.id;
    return { action: 'update', workflow: withStep({ ...workflow, selections: sel }, 'goal_source') };
  }

  if (step === 'goal_source') {
    sel.goalSource = option.id;
    if (option.id === 'fixture') {
      return { action: 'update', workflow: withStep({ ...workflow, selections: sel }, 'fixture') };
    }
    if (option.id === 'custom') {
      sel.goal = '';
      return { action: 'update', workflow: withStep({ ...workflow, selections: sel }, 'custom_goal') };
    }
    sel.goal = workflow.defaultSmokeGoal;
    let next = buildPreviewFromWorkflow({ ...workflow, selections: sel }, ctx);
    next = withStep(next, 'preview');
    return { action: 'update', workflow: next };
  }

  if (step === 'fixture') {
    sel.fixtureId = option.id;
    sel.goalSource = 'fixture';
    let fixturePrompt = '';
    if (typeof ctx.loadFixturePrompt === 'function') {
      fixturePrompt = await ctx.loadFixturePrompt(option.id);
    }
    sel.goal = fixturePrompt;
    let next = buildPreviewFromWorkflow(
      { ...workflow, selections: sel },
      { ...ctx, fixturePrompt },
    );
    next = withStep(next, 'preview');
    return { action: 'update', workflow: next };
  }

  if (step === 'confirm') {
    if (option.id === 'back') {
      return { action: 'update', workflow: withStep(workflow, 'preview') };
    }
    if (option.id === 'launch') {
      return {
        action: 'execute',
        workflow,
        selections: {
          agentFlow: sel.agentFlow,
          inferenceLane: sel.inferenceLane,
          gatePosture: sel.gatePosture,
          goalSource: sel.goalSource,
          fixtureId: sel.fixtureId,
          goal: sel.goal,
          confirm: true,
        },
      };
    }
  }

  if (step === 'preview') {
    const model = workflow.previewModel;
    if (model && !model.can_launch) {
      return { action: 'update', workflow: withStep(workflow, 'confirm') };
    }
    return { action: 'update', workflow: withStep(workflow, 'confirm') };
  }

  return { action: 'update', workflow };
}

/**
 * @param {object} workflow
 * @returns {{ action: 'update'|'cancel', workflow?: object }}
 */
function backLauncherWorkflow(workflow) {
  const order = STEPS;
  const idx = order.indexOf(workflow.step);
  if (workflow.step === 'agent_flow' || idx <= 0) {
    return { action: 'cancel' };
  }
  if (workflow.step === 'preview' || workflow.step === 'confirm') {
    // Back from preview → goal source (or fixture/custom depending on selection).
    const src = workflow.selections.goalSource;
    if (src === 'fixture') return { action: 'update', workflow: withStep(workflow, 'fixture') };
    if (src === 'custom') return { action: 'update', workflow: withStep(workflow, 'custom_goal') };
    return { action: 'update', workflow: withStep(workflow, 'goal_source') };
  }
  if (workflow.step === 'fixture' || workflow.step === 'custom_goal') {
    return { action: 'update', workflow: withStep(workflow, 'goal_source') };
  }
  const prev = order[idx - 1];
  // Skip fixture/custom when going back from goal_source.
  if (workflow.step === 'goal_source') {
    return { action: 'update', workflow: withStep(workflow, 'gate_posture') };
  }
  return { action: 'update', workflow: withStep(workflow, prev) };
}

/**
 * Apply a keypress to the launcher workflow.
 * @param {object} workflow
 * @param {string} input
 * @param {object} key
 * @param {object} [ctx]
 */
async function applyLauncherWorkflowKeypress(workflow, input, key = {}, ctx = {}) {
  const keyObj = key && typeof key === 'object' ? key : {};
  const isReturn = Boolean(keyObj.return) || input === '\r' || input === '\n';

  if (workflow.step === 'custom_goal') {
    if (keyObj.escape || input === '\u001b') {
      return backLauncherWorkflow(workflow);
    }
    if (isReturn) {
      const goal = String(workflow.textBuffer ?? '').trim();
      if (!goal) {
        return {
          action: 'update',
          workflow: {
            ...workflow,
            inlineError: 'Goal prompt required',
            blockedReasonCode: LAUNCHER_REASON.GOAL_REQUIRED,
          },
        };
      }
      const sel = { ...workflow.selections, goal, goalSource: 'custom' };
      let next = buildPreviewFromWorkflow({ ...workflow, selections: sel }, ctx);
      next = withStep(next, 'preview');
      return { action: 'update', workflow: next };
    }
    if (keyObj.backspace || keyObj.delete) {
      return {
        action: 'update',
        workflow: {
          ...workflow,
          textBuffer: String(workflow.textBuffer ?? '').slice(0, -1),
          inlineError: null,
        },
      };
    }
    if (input && !keyObj.ctrl && !keyObj.meta && input !== '\r' && input !== '\n') {
      return {
        action: 'update',
        workflow: {
          ...workflow,
          textBuffer: `${workflow.textBuffer ?? ''}${input}`,
          inlineError: null,
        },
      };
    }
    return { action: 'update', workflow };
  }

  if (workflow.step === 'preview') {
    if (keyObj.escape || input === '\u001b') {
      return backLauncherWorkflow(workflow);
    }
    if (isReturn) {
      return advanceLauncherWorkflow(workflow, { id: 'next' }, ctx);
    }
    return { action: 'ignore' };
  }

  const resolved = resolveSelectKeypress(input, key, workflow.select);
  if (resolved.type === 'cancel') {
    return backLauncherWorkflow(workflow);
  }
  if (resolved.type === 'move' && resolved.state) {
    return {
      action: 'update',
      workflow: { ...workflow, select: resolved.state, inlineError: null },
    };
  }
  if (resolved.type === 'disabled') {
    if (resolved.option?.id === 'hybrid') {
      return advanceLauncherWorkflow(workflow, resolved.option, ctx);
    }
    return {
      action: 'update',
      workflow: {
        ...workflow,
        inlineError: `Choice disabled${resolved.option?.reason_code ? `: ${resolved.option.reason_code}` : ''}`,
        blockedReasonCode: resolved.option?.reason_code ?? null,
      },
    };
  }
  if (resolved.type === 'confirm' && resolved.option) {
    return advanceLauncherWorkflow(
      { ...workflow, select: resolved.state ?? workflow.select },
      resolved.option,
      ctx,
    );
  }
  return { action: 'ignore' };
}

module.exports = {
  LAUNCHER_WORKFLOW_KIND,
  STEPS,
  createLauncherWorkflow,
  formatLauncherWorkflowLines,
  buildPreviewFromWorkflow,
  applyLauncherWorkflowKeypress,
  advanceLauncherWorkflow,
  backLauncherWorkflow,
  optionsForStep,
};
