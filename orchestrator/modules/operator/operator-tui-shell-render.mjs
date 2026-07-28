import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, render, renderToString, useApp, useInput, useStdout } from 'ink';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildShellModel,
  cycleFocus,
  moveNavSelection,
  moveRunSelection,
  resolveShellKeypress,
  shellModelToOptions,
  isInkLocalShellAction,
  contentSurfaceForLocalAction,
  navItemsForMovement,
} = require('./operator-tui-shell-model.js');
const { resolveShellTheme, focusBorderColor, toneColor, splashToneColor } = require('./operator-tui-theme.js');
const {
  buildSplashContent,
  resolveSplashDurationMs,
  resolveSplashFrameHeight,
  shouldSkipSplash,
} = require('./operator-tui-splash.js');
const {
  formatLandingLines,
  formatHelpLines,
  formatDiagnosticsLines,
} = require('./operator-tui-landing.js');
const {
  isNativeWorkflowAction,
  openNativeWorkflow,
  formatNativeWorkflowLines,
  applyNativeWorkflowKeypress,
  surfaceForWorkflow,
  createAsyncTransitionGate,
  NATIVE_LAUNCHER_EXECUTE_ACTION,
} = require('./operator-tui-native-workflows.js');
const {
  completeFixtureLoad,
} = require('./operator-tui-launcher-workflow.js');
const { formatSlashHelpText } = require('./operator-tui-slash-commands.js');
const { adaptActionResult } = require('./operator-tui-adapters.js');
const { pathToFileURL, fileURLToPath } = require('node:url');
const path = require('node:path');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURES_DATA = path.join(REPO_ROOT, 'scripts', 'lib', 'canonical-real-task-fixtures-data.mjs');

async function defaultLoadFixturePrompt(fixtureId) {
  const mod = await import(pathToFileURL(FIXTURES_DATA).href);
  const fixture = mod.getFixture(fixtureId);
  return fixture ? String(fixture.prompt ?? '') : '';
}

/**
 * Fullscreen Ink shell: optional brand splash, then header/nav/content/footer.
 * Uses React.createElement (no JSX toolchain). Presentation-only theme tokens.
 */

function formatField(field) {
  if (!field || typeof field !== 'object') return 'absent';
  if (field.availability === 'available') {
    if (field.value === null || field.value === undefined || field.value === '') return '(empty)';
    return String(field.value);
  }
  return String(field.availability);
}

function SplashApp(props) {
  const {
    model,
    splashMs,
    autoQuitMs,
    onContinue,
    onAbort,
  } = props;
  const { exit } = useApp();
  const theme = resolveShellTheme({ colorEnabled: model.colorEnabled });
  const height = resolveSplashFrameHeight(model.rows);
  const content = buildSplashContent({
    columns: model.columns,
    rows: height,
    version: model.version,
    readiness: model.readiness,
  });
  const continuedRef = useRef(false);

  const finish = () => {
    if (continuedRef.current) return;
    continuedRef.current = true;
    if (typeof onContinue === 'function') onContinue();
  };

  useEffect(() => {
    const duration = resolveSplashDurationMs(splashMs);
    const timer = setTimeout(finish, duration);
    return () => clearTimeout(timer);
  }, [splashMs]);

  useEffect(() => {
    if (!Number.isFinite(autoQuitMs) || autoQuitMs < 0) return undefined;
    const timer = setTimeout(() => exit(), autoQuitMs);
    return () => clearTimeout(timer);
  }, [autoQuitMs, exit]);

  useInput((input, key) => {
    if (key.ctrl && String(input).toLowerCase() === 'c') {
      if (typeof onAbort === 'function') onAbort();
      exit();
      return;
    }
    finish();
  });

  const renderSegments = (segments, keyPrefix) => React.createElement(
    Box,
    { key: keyPrefix, flexDirection: 'row' },
    ...(segments || []).map((seg, idx) => React.createElement(
      Text,
      {
        key: `${keyPrefix}-${idx}`,
        bold: seg.bold === true,
        color: splashToneColor(theme, seg.tone),
        dimColor: seg.tone === 'muted',
      },
      seg.text,
    )),
  );

  // Prefer a single Text for the triad when color is off (NO_COLOR / markers).
  // When color is on, paint Validate / Trace / Enforce with triad tokens.
  const triadNode = theme.triadValidate
    ? renderSegments(content.triadSegments, 'triad')
    : React.createElement(
      Text,
      { key: 'triad', color: theme.muted },
      content.triad || 'Validate • Trace • Enforce',
    );

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: model.columns,
      height,
      alignItems: 'center',
      justifyContent: content.density === 'minimal' ? 'flex-start' : 'center',
      borderStyle: 'double',
      borderColor: theme.focus,
      paddingX: 1,
    },
    ...(content.rows || []).map((row, idx) => renderSegments(row.segments, `art-${idx}`)),
    content.showSpacers
      ? React.createElement(Box, { height: 1 }, React.createElement(Text, null, ' '))
      : null,
    content.showProductTagline
      ? React.createElement(Text, { color: theme.accent }, content.productTagline || content.tagline)
      : null,
    triadNode,
    React.createElement(Text, { color: theme.muted }, content.subtitle),
    content.showSpacers
      ? React.createElement(Box, { height: 1 }, React.createElement(Text, null, ' '))
      : null,
    React.createElement(Text, { color: theme.warn }, content.hint),
    React.createElement(
      Text,
      { dimColor: true, color: theme.muted },
      content.disclaimer || 'Presentation polish only — not Web UI · not mouse · not durable resume',
    ),
  );
}

function ShellApp(props) {
  const { initialModel, autoQuitMs, onModelChange, onAbort, onRequestAction } = props;
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [model, setModel] = useState(initialModel);
  const modelRef = useRef(model);
  modelRef.current = model;
  const transitionGateRef = useRef(createAsyncTransitionGate());
  const theme = resolveShellTheme({ colorEnabled: model.colorEnabled });

  const commit = (next) => {
    setModel(next);
    if (typeof onModelChange === 'function') onModelChange(next);
  };

  const commitWorkflowResult = (current, result) => {
    if (result.action === 'ignore') return;
    if (result.action === 'cancel') {
      const prev = current.activeWorkflow;
      commit(buildShellModel({
        ...shellModelToOptions(current),
        activeWorkflow: null,
        pendingLauncherSelections: null,
        contentSurface: prev?.previousSurface ?? 'home',
        focus: prev?.previousFocus ?? 'nav',
      }));
      return;
    }
    if (result.action === 'execute' && result.selections) {
      commit(buildShellModel({
        ...shellModelToOptions(current),
        activeWorkflow: result.workflow ?? current.activeWorkflow,
        pendingLauncherSelections: result.selections,
        contentSurface: 'launcher_workflow',
        focus: 'content',
      }));
      requestAction(NATIVE_LAUNCHER_EXECUTE_ACTION);
      return;
    }
    if (
      result.action === 'blocked'
      || result.action === 'update'
      || result.action === 'selected'
      || result.action === 'busy'
    ) {
      const wf = result.workflow ?? current.activeWorkflow;
      commit(buildShellModel({
        ...shellModelToOptions(current),
        activeWorkflow: wf,
        selectedRunId: result.selectedRunId ?? current.selectedRunId,
        contentSurface: surfaceForWorkflow(wf),
        focus: 'content',
        selectedNavId: wf?.kind === 'run_browser' ? 'select' : (
          wf?.kind === 'launcher' ? 'launcher' : current.selectedNavId
        ),
      }));
    }
  };

  // Resize only — do not rebind on every nav/keystroke (was a remount/listener thrash).
  useEffect(() => {
    const onResize = () => {
      const current = modelRef.current;
      const columns = stdout?.columns ?? current.columns;
      const rows = stdout?.rows ?? current.rows;
      commit(buildShellModel({
        ...shellModelToOptions(current),
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
  }, [stdout]);

  useEffect(() => {
    if (!Number.isFinite(autoQuitMs) || autoQuitMs < 0) return undefined;
    const timer = setTimeout(() => exit(), autoQuitMs);
    return () => clearTimeout(timer);
  }, [autoQuitMs, exit]);

  const requestAction = (actionId) => {
    const id = actionId == null || String(actionId).trim() === ''
      ? null
      : String(actionId);
    // Never unmount without an action id — that returns TUI_SHELL_OK and looks like a silent quit.
    if (!id) return;
    if (typeof onRequestAction === 'function') {
      onRequestAction(id);
    }
    exit();
  };

  useInput((input, key) => {
    // Always resolve against the latest model — avoid stale focus after nav moves.
    const current = modelRef.current;
    const intent = resolveShellKeypress(input, key, current);
    const gate = transitionGateRef.current;

    if (intent.type === 'abort') {
      gate.invalidate();
      if (typeof onAbort === 'function') onAbort();
      exit();
      return;
    }
    if (intent.type === 'workflow_key') {
      const keyObj = key && typeof key === 'object' ? key : {};
      const isEscape = Boolean(keyObj.escape) || input === '\u001b';

      // Busy/loading: Esc cancels and invalidates in-flight loads; other keys consumed.
      if (current.activeWorkflow?.busy) {
        if (isEscape) {
          const token = gate.invalidate();
          void (async () => {
            const result = await applyNativeWorkflowKeypress(current, input, key, {
              loadFixturePrompt: defaultLoadFixturePrompt,
              deferFixtureLoad: true,
            });
            if (!gate.isCurrent(token)) return;
            commitWorkflowResult(modelRef.current, result);
          })();
        }
        return;
      }

      const token = gate.begin();
      void (async () => {
        const snapshot = modelRef.current;
        const result = await applyNativeWorkflowKeypress(snapshot, input, key, {
          loadFixturePrompt: defaultLoadFixturePrompt,
          deferFixtureLoad: true,
        });
        if (!gate.isCurrent(token)) return;

        if (result.action === 'busy' && result.pending?.type === 'fixture_load') {
          commitWorkflowResult(snapshot, result);
          let fixturePrompt = '';
          try {
            fixturePrompt = await defaultLoadFixturePrompt(result.pending.fixtureId);
          } catch {
            fixturePrompt = '';
          }
          if (!gate.isCurrent(token)) return;
          const completed = completeFixtureLoad(result.workflow, fixturePrompt, {});
          commitWorkflowResult(modelRef.current, completed);
          return;
        }

        commitWorkflowResult(snapshot, result);
      })();
      return;
    }
    if (intent.type === 'quit') {
      requestAction(intent.actionId);
      return;
    }
    if (intent.type === 'dispatch') {
      const actionId = intent.actionId;
      if (isNativeWorkflowAction(actionId)) {
        const workflow = openNativeWorkflow(current, actionId);
        if (workflow) {
          commit(buildShellModel({
            ...shellModelToOptions(current),
            activeWorkflow: workflow,
            contentSurface: surfaceForWorkflow(workflow),
            focus: 'content',
            selectedNavId: actionId === 'smoke' ? 'launcher' : actionId,
            commandInput: '',
          }));
          return;
        }
      }
      // Landing surfaces stay mounted — unmount+clear looks like TUI_SHELL_OK.
      if (isInkLocalShellAction(actionId)) {
        const surface = contentSurfaceForLocalAction(actionId) ?? 'home';
        commit(buildShellModel({
          ...shellModelToOptions(current),
          contentSurface: surface,
          selectedNavId: surface === 'diagnostics' ? 'diagnostics' : surface,
          focus: 'nav',
          commandInput: '',
          activeWorkflow: null,
        }));
        return;
      }
      requestAction(actionId);
      return;
    }
    if (intent.type === 'surface_home') {
      commit(buildShellModel({
        ...shellModelToOptions(current),
        contentSurface: 'home',
        selectedNavId: 'launcher',
        focus: 'nav',
        commandInput: '',
        activeWorkflow: null,
      }));
      return;
    }
    if (intent.type === 'cancel_input') {
      commit(buildShellModel({
        ...shellModelToOptions(current),
        focus: 'nav',
        commandInput: '',
      }));
      return;
    }
    if (intent.type === 'cycle_focus') {
      commit(cycleFocus(current));
      return;
    }
    if (intent.type === 'nav_move') {
      commit(moveNavSelection(current, intent.direction));
      return;
    }
    if (intent.type === 'run_move') {
      commit(moveRunSelection(current, intent.direction));
      return;
    }
    if (intent.type === 'input_submit' || intent.type === 'input_clear_submit') {
      commit(buildShellModel({ ...shellModelToOptions(current), commandInput: '' }));
      if (intent.type === 'input_submit' && intent.actionId) {
        const actionId = intent.actionId;
        const token = String(actionId).trim().toLowerCase();
        // Slash / typed tokens that map to Phase-1 native workflows stay in Ink.
        const nativeId = token === '/new' || token === 'new'
          ? 'launcher'
          : (token === '/runs' || token === 'runs'
            ? 'runs'
            : (token === 'select' || token === 's' ? 'select' : null));
        if (nativeId && isNativeWorkflowAction(nativeId)) {
          const workflow = openNativeWorkflow(current, nativeId);
          if (workflow) {
            commit(buildShellModel({
              ...shellModelToOptions(current),
              activeWorkflow: workflow,
              contentSurface: surfaceForWorkflow(workflow),
              focus: 'content',
              selectedNavId: nativeId === 'runs' ? 'runs' : (nativeId === 'select' ? 'select' : 'launcher'),
              commandInput: '',
            }));
            return;
          }
        }
        // /help lists slash vocabulary in-process (no remount).
        if (token === '/help') {
          commit(buildShellModel({
            ...shellModelToOptions(current),
            contentSurface: 'action_result',
            actionResult: adaptActionResult({
              action_id: '/help',
              ok: true,
              exitCode: 0,
              reason_code: 'TUI_SLASH_HELP',
              text: formatSlashHelpText(),
            }),
            focus: 'nav',
            commandInput: '',
            activeWorkflow: null,
          }));
          return;
        }
        // Bare help/home/diagnostics (and /home, /diagnostics) switch surfaces without unmount.
        const localToken = token === '/home' || token === 'home' ? 'home'
          : (token === '/diagnostics' || token === 'diagnostics' ? 'diagnostics'
            : (token === 'help' || token === '?' ? 'help' : token));
        if (isInkLocalShellAction(localToken)) {
          const surface = contentSurfaceForLocalAction(localToken) ?? 'home';
          commit(buildShellModel({
            ...shellModelToOptions(current),
            contentSurface: surface,
            selectedNavId: surface === 'diagnostics' ? 'diagnostics' : surface,
            focus: 'nav',
            commandInput: '',
            activeWorkflow: null,
          }));
          return;
        }
        requestAction(actionId);
      }
      return;
    }
    if (intent.type === 'input_backspace') {
      commit(buildShellModel({
        ...shellModelToOptions(current),
        commandInput: current.commandInput.slice(0, -1),
      }));
      return;
    }
    if (intent.type === 'input_char' && intent.char) {
      commit(buildShellModel({
        ...shellModelToOptions(current),
        commandInput: `${current.commandInput}${intent.char}`,
      }));
      return;
    }
    if (intent.type === 'start_slash') {
      commit(buildShellModel({
        ...shellModelToOptions(current),
        focus: 'input',
        commandInput: '/',
      }));
    }
  });

  const narrow = model.layout === 'narrow';
  const contentLines = buildContentLines(model);
  const readinessColor = model.readiness === 'ready'
    ? theme.ready
    : (model.readiness === 'blocked'
      ? theme.blocked
      : (model.readiness === 'failed'
        ? theme.danger
        : (model.readiness === 'unknown' || model.readiness === 'loading'
          ? theme.muted
          : theme.warn)));
  const showLandingHome = model.contentSurface === 'home' && model.landing;
  const navTitle = showLandingHome ? 'Quick Start' : 'Navigate';

  return React.createElement(
    Box,
    { flexDirection: 'column', width: model.columns, height: Math.max(12, model.rows) },
    React.createElement(
      Box,
      {
        borderStyle: 'double',
        borderColor: theme.brand,
        paddingX: 1,
        flexDirection: 'column',
      },
      React.createElement(
        Box,
        { justifyContent: 'space-between' },
        React.createElement(
          Text,
          { bold: theme.titleBold, color: theme.brand },
          showLandingHome ? (model.landing.hero.product || model.title) : `${model.title} v${model.version}`,
        ),
        React.createElement(
          Text,
          { color: theme.muted },
          showLandingHome ? `v${String(model.version).replace(/^v/i, '')}` : `[${model.layout}]`,
        ),
      ),
      showLandingHome
        ? React.createElement(
          Box,
          { flexDirection: 'column' },
          React.createElement(
            Text,
            { color: theme.accent },
            model.landing.hero.tagline,
          ),
          React.createElement(
            Text,
            { color: theme.muted },
            model.landing.hero.triad,
          ),
          React.createElement(
            Text,
            { dimColor: true, color: theme.muted },
            model.landing.hero.guardian_note,
          ),
        )
        : React.createElement(
          Text,
          { color: readinessColor },
          `readiness=${model.readiness}`
            + (model.selectedRunId ? ` · run=${model.selectedRunId}` : ''),
        ),
    ),
    React.createElement(
      Box,
      { flexDirection: narrow ? 'column' : 'row', flexGrow: 1 },
      React.createElement(
        Box,
        {
          flexDirection: 'column',
          width: narrow ? undefined : (showLandingHome ? 36 : 28),
          borderStyle: model.focus === 'nav' ? 'double' : 'single',
          borderColor: focusBorderColor(theme, model.focus === 'nav'),
          paddingX: 1,
        },
        React.createElement(Text, { bold: theme.sectionBold, color: theme.accent }, navTitle),
        React.createElement(
          Text,
          { dimColor: true, color: theme.muted },
          'keyboard — not clickable',
        ),
        ...(showLandingHome ? navItemsForMovement(model) : model.navItems).map((item) => {
          const selected = item.id === model.selectedNavId;
          const prefix = item.group === 'run' ? '  ' : '';
          const label = showLandingHome && item.id === 'launcher'
            ? 'Start New Run'
            : (showLandingHome && item.id === 'runs'
              ? 'Browse Runs'
              : (showLandingHome && item.id === 'diagnostics'
                ? 'System Status'
                : item.label));
          return React.createElement(
            Text,
            {
              key: item.id,
              bold: selected,
              color: selected ? theme.selected : undefined,
            },
            `${prefix}${selected ? '›' : ' '} ${item.key}. ${label}`,
          );
        }),
        model.selectedRunId
          ? React.createElement(
            Text,
            { dimColor: true, color: theme.muted },
            `run=${model.selectedRunId}`,
          )
          : null,
      ),
      React.createElement(
        Box,
        {
          flexDirection: 'column',
          flexGrow: 1,
          borderStyle: model.focus === 'content' ? 'double' : 'single',
          borderColor: focusBorderColor(theme, model.focus === 'content'),
          paddingX: 1,
        },
        showLandingHome
          ? React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(
              Text,
              { bold: theme.sectionBold, color: theme.accent },
              'System Readiness',
            ),
            React.createElement(
              Text,
              { color: readinessColor, bold: true },
              `Overall: ${model.landing.overall.label}`,
            ),
            React.createElement(
              Text,
              { color: theme.muted },
              `next: ${model.landing.overall.next_action}`,
            ),
            ...model.landing.readiness_rows.map((row, idx) => React.createElement(
              Text,
              {
                key: `r-${idx}`,
                color: toneColor(theme, row.tone),
              },
              `  ${row.label}: ${row.status_label}`,
            )),
            React.createElement(Box, { height: 1 }, React.createElement(Text, null, ' ')),
            React.createElement(
              Text,
              { bold: theme.sectionBold, color: theme.accent },
              'Recent Runs',
            ),
            ...(model.landing.recent_runs.length
              ? [
                React.createElement(
                  Text,
                  { key: 'rr-count', dimColor: true, color: theme.muted },
                  `Showing ${model.landing.recent_runs_showing} of ${model.landing.recent_runs_total}`,
                ),
                ...model.landing.recent_runs.map((run, idx) => React.createElement(
                  Text,
                  {
                    key: `rr-${idx}`,
                    color: toneColor(
                      theme,
                      run.activity_state === 'completed'
                        ? 'ok'
                        : (run.activity_state === 'blocked'
                          ? 'blocked'
                          : (run.activity_state === 'failed'
                            ? 'fail'
                            : (run.activity_state === 'active' ? 'warn' : 'unavailable'))),
                    ),
                  },
                  `  ${run.activity_label}  ${run.run_id}`
                    + (run.summary ? `  ${run.summary}` : '')
                    + (narrow ? '' : `  ${run.last_event_at ?? 'time unavailable'}`),
                )),
              ]
              : [
                React.createElement(
                  Text,
                  { key: 'rr-empty', color: theme.muted },
                  model.landing.empty_state
                    ? `  ${model.landing.empty_state.title}: ${model.landing.empty_state.body}`
                    : '  (No runs yet)',
                ),
              ]),
          )
          : React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(
              Text,
              { bold: theme.sectionBold, color: theme.accent },
              `Content · ${model.contentSurface}`,
            ),
            ...contentLines.map((line, idx) => React.createElement(
              Text,
              {
                key: `c-${idx}`,
                dimColor: line.startsWith('('),
                color: line.startsWith('(') ? theme.muted : undefined,
              },
              line,
            )),
          ),
      ),
    ),
    React.createElement(
      Box,
      {
        borderStyle: model.focus === 'input' ? 'double' : 'single',
        borderColor: focusBorderColor(theme, model.focus === 'input'),
        paddingX: 1,
      },
      React.createElement(Text, { color: theme.brand }, `> ${model.commandInput}`),
      React.createElement(
        Text,
        { dimColor: true, color: theme.selected },
        model.focus === 'input' ? '█' : '',
      ),
    ),
    React.createElement(
      Box,
      { paddingX: 1 },
      React.createElement(
        Text,
        { dimColor: true, color: theme.muted },
        model.footerHints,
      ),
    ),
    React.createElement(
      Box,
      { paddingX: 1 },
      React.createElement(Text, { dimColor: true, color: theme.muted }, model.disclaimer),
    ),
  );
}

/**
 * Root: optional first-paint splash, then shell chrome.
 * When splashOnly is set, splash continuation exits Ink so the entry can
 * discover readiness/runs and remount the shell (first-paint contract).
 */
function OperatorTuiRoot(props) {
  const {
    initialModel,
    showSplash = false,
    splashOnly = false,
    splashMs,
    autoQuitMs,
    onModelChange,
    onAbort,
    onRequestAction,
  } = props;
  const { exit } = useApp();
  const [phase, setPhase] = useState(showSplash ? 'splash' : 'shell');

  if (phase === 'splash') {
    return React.createElement(SplashApp, {
      model: initialModel,
      splashMs,
      autoQuitMs,
      onContinue: () => {
        if (splashOnly) {
          exit();
          return;
        }
        setPhase('shell');
      },
      onAbort,
    });
  }

  return React.createElement(ShellApp, {
    initialModel,
    autoQuitMs,
    onModelChange,
    onAbort,
    onRequestAction,
  });
}

/**
 * @param {object} model
 * @returns {string[]}
 */
function buildContentLines(model) {
  if (model.activeWorkflow) {
    return formatNativeWorkflowLines(model.activeWorkflow);
  }
  if (model.contentSurface === 'home') {
    if (model.landing) {
      return formatLandingLines(model.landing, {
        selectedNavId: model.selectedNavId,
        narrow: model.layout === 'narrow',
      });
    }
    return ['(landing unavailable)'];
  }
  if (model.contentSurface === 'diagnostics') {
    return formatDiagnosticsLines(model.home);
  }
  if (model.contentSurface === 'help') {
    return formatHelpLines();
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
  if (model.contentSurface === 'launcher') {
    if (!model.launcher.available) return ['(guided launcher summary unavailable)'];
    return [
      `agent_mode: ${model.launcher.agent_flow ?? '-'}`,
      `inference_lane: ${model.launcher.inference_lane ?? '-'} → ${model.launcher.inference_policy ?? 'unavailable'}`,
      `gate_posture: ${model.launcher.gate_posture ?? '-'}`,
      `goal: ${formatField(model.launcher.goal_summary)}`,
      `max_iterations: ${formatField(model.launcher.max_iterations)}`,
      `max_retries: ${formatField(model.launcher.max_retries)}`,
      `cost_limit_usd: ${formatField(model.launcher.cost_limit_usd)}`,
      `time_limit: ${formatField(model.launcher.time_limit)}`,
      `approved_artifacts: ${formatField(model.launcher.approved_artifacts)}`,
      `cerberus_gate: ${formatField(model.launcher.cerberus_gate)}`,
      `local_backend: ${formatField(model.launcher.local_backend)}`,
      `readiness: ${model.launcher.readiness ?? '-'}`,
      model.launcher.blocked_reason_code
        ? `blocked_reason_code: ${model.launcher.blocked_reason_code}`
        : null,
      model.launcher.equivalent_command
        ? `equivalent_command: ${model.launcher.equivalent_command}`
        : 'equivalent_command: unavailable',
    ].filter(Boolean);
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
 *   showSplash?: boolean,
 *   splashOnly?: boolean,
 *   splashMs?: number,
 *   onModelChange?: (model: object) => void,
 *   onRequestAction?: (actionId: string) => void,
 * }} options
 */
export async function renderOperatorTuiShell(options) {
  let aborted = false;
  /** @type {string | null} */
  let requestedAction = null;
  const showSplash = options.showSplash === true;
  const splashOnly = options.splashOnly === true;
  const instance = render(
    React.createElement(OperatorTuiRoot, {
      initialModel: options.model,
      showSplash,
      splashOnly,
      splashMs: options.splashMs,
      autoQuitMs: options.autoQuitMs,
      onModelChange: options.onModelChange,
      onAbort: () => {
        aborted = true;
      },
      onRequestAction: (actionId) => {
        requestedAction = actionId;
        // Forward to shell entry callback (belt-and-suspenders with return value).
        if (typeof options.onRequestAction === 'function') {
          options.onRequestAction(actionId);
        }
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
 * @param {{ columns?: number, rows?: number, showSplash?: boolean }} [opts]
 */
export function renderOperatorTuiShellToString(model, opts = {}) {
  const columns = opts.columns ?? model.columns ?? 80;
  const rows = opts.rows ?? model.rows ?? 24;
  const showSplash = opts.showSplash === true;
  return renderToString(
    React.createElement(OperatorTuiRoot, {
      initialModel: buildShellModel({ ...shellModelToOptions(model), columns, rows }),
      showSplash,
    }),
    { columns },
  );
}

export {
  ShellApp,
  SplashApp,
  OperatorTuiRoot,
  buildContentLines,
  formatField,
  shouldSkipSplash,
  resolveSplashDurationMs,
};
