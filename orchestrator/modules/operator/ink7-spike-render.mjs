import React, { useEffect, useState } from 'react';
import { Box, Text, render, renderToString, useApp, useInput, useStdout } from 'ink';
import {
  applyLiveTick,
  buildSpikeShellModel,
  cycleFocus,
  moveSelection,
} from './ink7-spike-view-model.js';

/**
 * Fullscreen-ish shell: header, nav, content, footer, focus, command input.
 * createElement-free via automatic JSX transform is avoided — use createElement for CJS/ESM simplicity.
 */

function SpikeShell(props) {
  const { initialModel, autoQuitMs, onModelChange, onAbort } = props;
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
      commit(buildSpikeShellModel({
        ...model,
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

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (typeof onAbort === 'function') onAbort();
      exit();
      return;
    }
    if (input === 'q' && model.focus !== 'input') {
      exit();
      return;
    }
    if (key.tab) {
      commit(cycleFocus(model));
      return;
    }
    if (model.focus === 'nav' || model.focus === 'content') {
      if (key.upArrow || input === 'k') {
        commit(moveSelection(model, 'prev'));
        return;
      }
      if (key.downArrow || input === 'j') {
        commit(moveSelection(model, 'next'));
        return;
      }
      if (key.return) {
        commit(applyLiveTick(model, 1));
        return;
      }
    }
    if (model.focus === 'input') {
      if (key.return) {
        commit(buildSpikeShellModel({ ...model, commandInput: '' }));
        return;
      }
      if (key.backspace || key.delete) {
        commit(buildSpikeShellModel({
          ...model,
          commandInput: model.commandInput.slice(0, -1),
        }));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        commit(buildSpikeShellModel({
          ...model,
          commandInput: `${model.commandInput}${input}`,
        }));
      }
      return;
    }
    if (input === '/') {
      commit(buildSpikeShellModel({ ...model, focus: 'input' }));
    }
  });

  const selected = model.runs.find((r) => r.run_id === model.selectedRunId);
  const narrow = model.layout === 'narrow';

  return React.createElement(
    Box,
    { flexDirection: 'column', width: model.columns, height: Math.max(10, model.rows) },
    React.createElement(
      Box,
      { borderStyle: 'single', paddingX: 1 },
      React.createElement(Text, { bold: true }, model.title),
      React.createElement(Text, null, `  [${model.layout}] tick=${model.liveTick}`),
    ),
    React.createElement(
      Box,
      { flexDirection: narrow ? 'column' : 'row', flexGrow: 1 },
      React.createElement(
        Box,
        {
          flexDirection: 'column',
          width: narrow ? undefined : 18,
          borderStyle: model.focus === 'nav' ? 'double' : 'single',
          paddingX: 1,
        },
        React.createElement(Text, { bold: true }, 'Nav'),
        ...model.navItems.map((item) => React.createElement(Text, { key: item.id }, `· ${item.label}`)),
      ),
      React.createElement(
        Box,
        {
          flexDirection: 'column',
          flexGrow: 1,
          borderStyle: model.focus === 'content' ? 'double' : 'single',
          paddingX: 1,
        },
        React.createElement(Text, { bold: true }, 'Runs'),
        model.runs.length === 0
          ? React.createElement(Text, { dimColor: true }, '(none)')
          : model.runs.map((run) => React.createElement(
            Text,
            { key: run.run_id },
            `${run.run_id === model.selectedRunId ? '>' : ' '} ${run.run_id} ${run.status ?? '-'}`,
          )),
        React.createElement(Text, { bold: true }, 'Status'),
        React.createElement(
          Text,
          null,
          model.status
            ? `${model.status.run_id ?? '-'} · ${model.status.result_code ?? '-'} · ${model.status.outcome ?? '-'}`
            : selected
              ? `${selected.run_id} · ${selected.result_code ?? '-'}`
              : '(none)',
        ),
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
      React.createElement(Text, { dimColor: true }, model.footerHints),
    ),
    React.createElement(
      Box,
      { paddingX: 1 },
      React.createElement(Text, { dimColor: true }, model.disclaimer),
    ),
  );
}

/**
 * @param {{
 *   model: object,
 *   stdin?: NodeJS.ReadStream,
 *   stdout?: NodeJS.WriteStream,
 *   stderr?: NodeJS.WriteStream,
 *   autoQuitMs?: number,
 *   onModelChange?: (model: object) => void,
 * }} options
 */
export async function renderSpikeShell(options) {
  let aborted = false;
  const instance = render(
    React.createElement(SpikeShell, {
      initialModel: options.model,
      autoQuitMs: options.autoQuitMs,
      onModelChange: options.onModelChange,
      onAbort: () => {
        aborted = true;
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
  return { aborted, frames: null };
}

/**
 * Deterministic string render for tests (no raw mode / alternate screen).
 * @param {object} model
 * @param {{ columns?: number }} [opts]
 */
export function renderSpikeShellToString(model, opts = {}) {
  const columns = opts.columns ?? model.columns ?? 80;
  return renderToString(
    React.createElement(SpikeShell, {
      initialModel: buildSpikeShellModel({ ...model, columns }),
    }),
    { columns },
  );
}

export { SpikeShell };
