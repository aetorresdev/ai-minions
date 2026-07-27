import React, { useEffect, useState } from 'react';
import { Box, Text, render, renderToString, useApp, useInput, useStdout } from 'ink';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildShellModel,
  cycleFocus,
  moveNavSelection,
  moveRunSelection,
  shellModelToOptions,
} = require('./operator-tui-shell-model.js');

/**
 * Fullscreen Ink shell: header, nav, content, footer, focus, command input.
 * Uses React.createElement (no JSX toolchain).
 */

function formatField(field) {
  if (!field || typeof field !== 'object') return 'absent';
  if (field.availability === 'available') {
    if (field.value === null || field.value === undefined || field.value === '') return '(empty)';
    return String(field.value);
  }
  return String(field.availability);
}

function ShellApp(props) {
  const { initialModel, autoQuitMs, onModelChange, onAbort, onRequestAction } = props;
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [model, setModel] = useState(initialModel);

  const commit = (next) => {
    setModel(next);
    if (typeof onModelChange === 'function') onModelChange(next);
  };

  useEffect(() => {
    const onResize = () => {
      const columns = stdout?.columns ?? model.columns;
      const rows = stdout?.rows ?? model.rows;
      commit(buildShellModel({
        ...shellModelToOptions(model),
        columns,
        rows,
      }));
    };
    if (stdout && typeof stdout.on === 'function') {
      stdout.on('resize', onResize);
      return () => {
        if (typeof stdout.off === 'function') stdout.off('resize', onResize);
        else if (typeof stdout.removeListener === 'function') stdout.removeListener('resize', onResize);
      };
    }
    return undefined;
  }, [stdout, model]);

  useEffect(() => {
    if (!Number.isFinite(autoQuitMs) || autoQuitMs < 0) return undefined;
    const timer = setTimeout(() => exit(), autoQuitMs);
    return () => clearTimeout(timer);
  }, [autoQuitMs, exit]);

  const requestAction = (actionId) => {
    if (typeof onRequestAction === 'function') {
      onRequestAction(actionId);
    }
    exit();
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (typeof onAbort === 'function') onAbort();
      exit();
      return;
    }
    if (input === 'q' && model.focus !== 'input') {
      requestAction('quit');
      return;
    }
    if (key.tab) {
      commit(cycleFocus(model));
      return;
    }
    if (model.focus === 'nav') {
      if (key.upArrow || input === 'k') {
        commit(moveNavSelection(model, 'prev'));
        return;
      }
      if (key.downArrow || input === 'j') {
        commit(moveNavSelection(model, 'next'));
        return;
      }
      if (key.return) {
        requestAction(model.selectedNavId);
        return;
      }
    }
    if (model.focus === 'content') {
      if (key.upArrow || input === 'k') {
        commit(moveRunSelection(model, 'prev'));
        return;
      }
      if (key.downArrow || input === 'j') {
        commit(moveRunSelection(model, 'next'));
        return;
      }
      if (key.return && model.selectedRunId) {
        requestAction('monitor');
        return;
      }
    }
    if (model.focus === 'input') {
      if (key.return) {
        const token = model.commandInput.trim();
        commit(buildShellModel({ ...shellModelToOptions(model), commandInput: '' }));
        if (token) requestAction(token);
        return;
      }
      if (key.backspace || key.delete) {
        commit(buildShellModel({
          ...shellModelToOptions(model),
          commandInput: model.commandInput.slice(0, -1),
        }));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        commit(buildShellModel({
          ...shellModelToOptions(model),
          commandInput: `${model.commandInput}${input}`,
        }));
      }
      return;
    }
    if (input === '/') {
      commit(buildShellModel({ ...shellModelToOptions(model), focus: 'input' }));
    }
  });

  const narrow = model.layout === 'narrow';
  const contentLines = buildContentLines(model);

  return React.createElement(
    Box,
    { flexDirection: 'column', width: model.columns, height: Math.max(12, model.rows) },
    React.createElement(
      Box,
      { borderStyle: 'single', paddingX: 1 },
      React.createElement(Text, { bold: true }, `${model.title} v${model.version}`),
      React.createElement(Text, null, `  readiness=${model.readiness}  [${model.layout}]`),
    ),
    React.createElement(
      Box,
      { flexDirection: narrow ? 'column' : 'row', flexGrow: 1 },
      React.createElement(
        Box,
        {
          flexDirection: 'column',
          width: narrow ? undefined : 28,
          borderStyle: model.focus === 'nav' ? 'double' : 'single',
          paddingX: 1,
        },
        React.createElement(Text, { bold: true }, 'Actions'),
        ...model.navItems.map((item) => React.createElement(
          Text,
          { key: item.id },
          `${item.id === model.selectedNavId ? '>' : ' '} [${item.key}] ${item.label}`,
        )),
      ),
      React.createElement(
        Box,
        {
          flexDirection: 'column',
          flexGrow: 1,
          borderStyle: model.focus === 'content' ? 'double' : 'single',
          paddingX: 1,
        },
        React.createElement(Text, { bold: true }, `Content · ${model.contentSurface}`),
        ...contentLines.map((line, idx) => React.createElement(
          Text,
          { key: `c-${idx}`, dimColor: line.startsWith('(') },
          line,
        )),
      ),
    ),
    React.createElement(
      Box,
      {
        borderStyle: model.focus === 'input' ? 'double' : 'single',
        paddingX: 1,
      },
      React.createElement(Text, null, `> ${model.commandInput}`),
      React.createElement(Text, { dimColor: true }, model.focus === 'input' ? '█' : ''),
    ),
    React.createElement(
      Box,
      { paddingX: 1 },
      React.createElement(
        Text,
        { dimColor: true },
        `sel=${model.selectedRunId ?? '(none)'} · ${model.footerHints}`,
      ),
    ),
    React.createElement(
      Box,
      { paddingX: 1 },
      React.createElement(Text, { dimColor: true }, model.disclaimer),
    ),
  );
}

/**
 * @param {object} model
 * @returns {string[]}
 */
function buildContentLines(model) {
  if (model.contentSurface === 'home') {
    return [
      `version: ${model.home.version ?? '-'}`,
      `git: ${model.home.git_commit ?? '-'}`,
      `model_policy: ${model.home.model_policy ?? '-'}`,
      `path_status: ${model.home.path_status ?? '-'}`,
      `cli_on_path: ${String(model.home.cli_on_path)}`,
      `credential_sufficiency: ${model.home.credential_sufficiency ?? '-'}`,
      ...(model.home.providers || []).map(
        (p) => `${p.env_var}: ${p.status}${p.required_for_policy ? ' (required)' : ''}`,
      ),
    ];
  }
  if (model.contentSurface === 'runs') {
    if (!model.runs.runs.length) return ['(none)', `result_code: ${model.runs.result_code}`];
    return model.runs.runs.map((run) => (
      `${run.run_id === model.selectedRunId ? '>' : ' '} ${run.run_id} `
      + `${run.status ?? '-'} / ${run.outcome ?? '-'} / ${run.result_code ?? '-'}`
    ));
  }
  if (model.contentSurface === 'status') {
    if (!model.status.available) {
      return ['(status unavailable)', `selected: ${model.selectedRunId ?? '-'}`];
    }
    return [
      `run_id: ${model.status.run_id ?? '-'}`,
      `result_code: ${model.status.result_code ?? '-'}`,
      `status: ${model.status.status ?? '-'}`,
      `outcome: ${model.status.outcome ?? '-'}`,
      `reason_code: ${model.status.reason_code ?? '-'}`,
      `next_safe_action: ${model.status.next_safe_action ?? '-'}`,
    ];
  }
  if (model.contentSurface === 'evidence') {
    if (!model.evidence.available) return ['(evidence unavailable)'];
    return [
      `run_id: ${model.evidence.run_id ?? '-'}`,
      `result_code: ${model.evidence.result_code ?? '-'}`,
      `attach_available: ${String(model.evidence.attach_available)}`,
      `attach_bundle_available: ${String(model.evidence.attach_bundle_available)}`,
      `attach_action_available: ${String(model.evidence.attach_action_available)}`,
      `reason_code: ${model.evidence.reason_code ?? '-'}`,
      `next_safe_action: ${model.evidence.next_safe_action ?? '-'}`,
    ];
  }
  if (model.contentSurface === 'config') {
    if (!model.config.available) return ['(config readiness unavailable)'];
    return [
      `path_status: ${model.config.path_status ?? '-'}`,
      `model_policy: ${model.config.model_policy ?? '-'}`,
      `doctor_ok: ${String(model.config.doctor_ok)}`,
      `credential_sufficiency: ${model.config.credential_sufficiency ?? '-'}`,
      `next_safe_action: ${model.config.next_safe_action ?? '-'}`,
      ...(model.config.remediations || []).map((r) => `· ${r}`),
    ];
  }
  if (model.contentSurface === 'lifecycle' || model.contentSurface === 'monitor') {
    const { formatLiveMonitorLines } = require('./operator-tui-live-monitor.js');
    // Prefer pre-built monitor model from shell; fall back to lifecycle lines.
    if (model.monitor) {
      return formatLiveMonitorLines(model.monitor);
    }
    const lc = model.lifecycle;
    return [
      `goal: ${formatField(lc.goal_summary)}`,
      `iteration: ${formatField(lc.current_iteration)} / ${formatField(lc.max_iteration)}`,
      `phase: ${formatField(lc.current_role_phase)}`,
      `gate: ${formatField(lc.latest_gate)} verdict=${formatField(lc.latest_verdict)}`,
      `blocker: ${formatField(lc.latest_blocker)}`,
      `retry: ${formatField(lc.retry_count)} / ${formatField(lc.retry_limit)}`,
      `cost: ${formatField(lc.measured_cost)} budget=${formatField(lc.configured_budget)}`,
      `elapsed: ${formatField(lc.elapsed)} limit=${formatField(lc.time_limit)}`,
      `stop: ${formatField(lc.terminal_stop_reason)} human=${formatField(lc.human_action_required)}`,
    ];
  }
  if (model.actionResult) {
    return [
      `action: ${model.actionResult.action_id ?? '-'}`,
      `ok: ${String(model.actionResult.ok)} exit=${model.actionResult.exit_code}`,
      `reason_code: ${model.actionResult.reason_code ?? '-'}`,
      `next_safe_action: ${model.actionResult.next_safe_action ?? '-'}`,
      model.actionResult.error ? `error: ${model.actionResult.error}` : null,
      model.actionResult.text
        ? String(model.actionResult.text).split('\n').slice(0, 8).join(' | ')
        : null,
    ].filter(Boolean);
  }
  return ['(empty)'];
}

/**
 * @param {{
 *   model: object,
 *   stdin?: NodeJS.ReadStream,
 *   stdout?: NodeJS.WriteStream,
 *   stderr?: NodeJS.WriteStream,
 *   autoQuitMs?: number,
 *   onModelChange?: (model: object) => void,
 *   onRequestAction?: (actionId: string) => void,
 * }} options
 */
export async function renderOperatorTuiShell(options) {
  let aborted = false;
  /** @type {string | null} */
  let requestedAction = null;
  const instance = render(
    React.createElement(ShellApp, {
      initialModel: options.model,
      autoQuitMs: options.autoQuitMs,
      onModelChange: options.onModelChange,
      onAbort: () => {
        aborted = true;
      },
      onRequestAction: (actionId) => {
        requestedAction = actionId;
      },
    }),
    {
      stdin: options.stdin,
      stdout: options.stdout,
      stderr: options.stderr,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  await instance.waitUntilExit();
  return { aborted, requestedAction, frames: null };
}

/**
 * Deterministic string render for tests (no raw mode / alternate screen).
 * @param {object} model
 * @param {{ columns?: number }} [opts]
 */
export function renderOperatorTuiShellToString(model, opts = {}) {
  const columns = opts.columns ?? model.columns ?? 80;
  return renderToString(
    React.createElement(ShellApp, {
      initialModel: buildShellModel({ ...shellModelToOptions(model), columns }),
    }),
    { columns },
  );
}

export { ShellApp, buildContentLines, formatField };
