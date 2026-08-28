import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, render, renderToString, useApp, useInput, useStdout } from 'ink';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildShellModel,
  cycleFocus,
  moveNavSelection,
  moveRunSelection,
  moveHelpTopicSelection,
  openHelpTopic,
  closeHelpTopic,
  resolveShellKeypress,
  shellModelToOptions,
  navItemsForMovement,
} = require('./operator-tui-shell-model.js');
const {
  applyInkLocalSurfaceTransition,
  normalizeInkLocalActionToken,
} = require('./operator-tui-shell-controller.js');
const { resolveShellTheme, focusBorderColor, toneColor, splashToneColor, brandGradientStop } = require('./operator-tui-theme.js');
const { chromeIcon, resolveIconMode } = require('./operator-tui-icons.js');
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
  formatRecentRunEntryLine,
} = require('./operator-tui-landing.js');
const {
  isNativeWorkflowAction,
  openNativeWorkflow,
  formatNativeWorkflowEntries,
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
const {
  formatRunsBoardEntryLines,
  actionEligibilityDisplayLabel,
  fieldOrUnavailable,
} = require('./operator-run-list.js');
const { pathToFileURL, fileURLToPath } = require('node:url');
const path = require('node:path');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURES_DATA = path.join(REPO_ROOT, 'scripts', 'lib', 'canonical-real-task-fixtures-data.mjs');

// Ink styles Text/borders via chalk, whose level is snapshot at import from
// the ambient terminal (supports-color keys on TTY/TERM/COLORTERM/FORCE_COLOR;
// NO_COLOR is never consulted). Resolve chalk from Ink's own location — it may
// be nested under ink/node_modules, and importing 'chalk' here could bind a
// different instance than the one Ink renders with.
const inkChalkSpecifier = require.resolve('chalk', {
  paths: [path.dirname(require.resolve('ink'))],
});
const { default: inkChalk } = await import(pathToFileURL(inkChalkSpecifier).href);

/**
 * When the shell model disables color (NO_COLOR / explicit colorEnabled:false),
 * zero SGR may be emitted on every host — pin Ink's chalk to level 0 for the
 * render instead of inheriting the operator's interactive-terminal
 * capabilities. Level is restored afterwards.
 * @param {boolean} disabled
 * @param {() => unknown} fn
 */
function withColorDisabled(disabled, fn) {
  if (!disabled) return fn();
  const prev = inkChalk.level;
  inkChalk.level = 0;
  try {
    return fn();
  } finally {
    inkChalk.level = prev;
  }
}

async function defaultLoadFixturePrompt(fixtureId) {
  const mod = await import(pathToFileURL(FIXTURES_DATA).href);
  const fixture = mod.getFixture(fixtureId);
  return fixture ? String(fixture.prompt ?? '') : '';
}

/**
 * Splash-tone Text row for guardian art segments (Ink: Box row of Text nodes).
 * @param {object} theme
 * @param {Array<{ text: string, tone?: string, bold?: boolean }>} segments
 * @param {string} keyPrefix
 */
function renderGuardianSegments(theme, segments, keyPrefix) {
  return React.createElement(
    Box,
    { key: keyPrefix, flexDirection: 'row', flexShrink: 0 },
    ...(segments || []).map((seg, idx) => React.createElement(
      Text,
      {
        key: `${keyPrefix}-${idx}`,
        bold: seg.bold === true,
        color: splashToneColor(theme, seg.tone),
        dimColor: seg.tone === 'muted',
        wrap: 'truncate',
      },
      seg.text,
    )),
  );
}

/**
 * Section title with optional multi-row lock icon (lock v2 icons are 2 Braille rows).
 * @param {object} theme
 * @param {string | { lines?: string[], label?: string } | null | undefined} title
 * @param {string} fallback
 */
function renderSectionTitle(theme, title, fallback) {
  if (title && typeof title === 'object' && Array.isArray(title.lines) && title.lines.length > 0) {
    const label = String(title.label ?? fallback);
    return React.createElement(
      Box,
      { flexDirection: 'row', flexShrink: 0 },
      React.createElement(
        Box,
        { flexDirection: 'column', flexShrink: 0, marginRight: 1 },
        ...title.lines.map((line, idx) => React.createElement(
          Text,
          { key: `sec-ico-${idx}`, color: theme.accent },
          line,
        )),
      ),
      React.createElement(
        Text,
        { bold: theme.sectionBold, color: theme.accent },
        label,
      ),
    );
  }
  const text = typeof title === 'string' && title
    ? title
    : fallback;
  return React.createElement(
    Text,
    { bold: theme.sectionBold, color: theme.accent },
    text,
  );
}

/**
 * Brand wordmark — optional truecolor cyan→violet→amber gradient on the wordmark only.
 * @param {object} theme
 * @param {string} text
 * @param {string} keyPrefix
 */
function renderBrandWordmark(theme, text, keyPrefix) {
  const label = String(text ?? '');
  if (!theme.truecolor || !theme.brandGradient) {
    return React.createElement(
      Text,
      { key: keyPrefix, bold: theme.titleBold, color: theme.brand },
      label,
    );
  }
  const chars = label.split('');
  return React.createElement(
    Box,
    { key: keyPrefix, flexDirection: 'row' },
    ...chars.map((ch, idx) => React.createElement(
      Text,
      {
        key: `${keyPrefix}-${idx}`,
        bold: theme.titleBold,
        color: brandGradientStop(theme, idx, chars.length),
      },
      ch,
    )),
  );
}

/**
 * Task-first landing composition (post-splash). Not the brand splash.
 * @param {{
 *   model: object,
 *   theme: object,
 *   readinessColor: string | undefined,
 * }} props
 */
function LandingHomeView(props) {
  const { model, theme, readinessColor } = props;
  const landing = model.landing;
  const landingLayout = model.landingLayout || landing.layout || 'compact';
  const compact = landingLayout === 'compact';
  const iconMode = resolveIconMode({ icons: model.iconMode || landing.iconMode });
  const selectedMark = chromeIcon(iconMode, 'selected');
  const comp = landing.composition && typeof landing.composition === 'object'
    ? landing.composition
    : {
      show_guardian: landing.show_guardian === true,
      show_product: true,
      show_tagline: true,
      show_triad: true,
      show_primary_cta: true,
      show_guardian_note: landingLayout !== 'compact',
      show_quick_start: true,
      show_quick_start_hint: true,
      quick_start_limit: 5,
      show_readiness: true,
      show_readiness_next: true,
      show_readiness_details: true,
      show_recent_runs: true,
      recent_runs_limit: 5,
      recent_empty_short: false,
    };
  const showGuardian = comp.show_guardian === true
    && landing.show_guardian === true
    && Array.isArray(landing.guardian_rows)
    && landing.guardian_rows.length > 0;
  const quickItems = (navItemsForMovement(model) || [])
    .filter((item) => ['launcher', 'runs', 'diagnostics', 'config', 'help'].includes(item.id))
    .slice(0, Math.max(1, Number(comp.quick_start_limit) || 1));

  const quickStartPanel = comp.show_quick_start
    ? React.createElement(
      Box,
      {
        flexDirection: 'column',
        borderStyle: model.focus === 'nav' ? 'double' : 'single',
        borderColor: focusBorderColor(theme, model.focus === 'nav'),
        paddingX: 1,
        width: compact ? undefined : 36,
        flexGrow: compact ? 1 : 0,
      },
      renderSectionTitle(
        theme,
        (landing.section_icons && landing.section_icons.quick_start)
          || (landing.section_titles && landing.section_titles.quick_start),
        'Quick Start',
      ),
      ...(comp.show_quick_start_hint
        ? [React.createElement(
          Text,
          { key: 'qs-hint', dimColor: true, color: theme.muted },
          'keyboard — not clickable',
        )]
        : []),
      ...quickItems.map((item) => {
        const selected = item.id === model.selectedNavId;
        const label = item.id === 'launcher'
          ? 'Start New Run'
          : (item.id === 'runs'
            ? 'Browse Runs'
            : (item.id === 'diagnostics'
              ? 'System Status'
              : item.label));
        return React.createElement(
          Text,
          {
            key: item.id,
            bold: selected,
            color: selected ? theme.selected : undefined,
          },
          `${selected ? selectedMark : ' '} ${item.key}. ${label}`,
        );
      }),
    )
    : null;

  const readinessPanel = React.createElement(
    Box,
    {
      flexDirection: 'column',
      // Readiness is informational on landing — content focus belongs to Recent Runs.
      borderStyle: 'single',
      borderColor: theme.muted,
      paddingX: 1,
      flexGrow: comp.show_recent_runs || comp.show_quick_start ? 1 : 0,
    },
    renderSectionTitle(
      theme,
      (landing.section_icons && landing.section_icons.readiness)
        || (landing.section_titles && landing.section_titles.readiness),
      'System Readiness',
    ),
    React.createElement(
      Text,
      { color: readinessColor, bold: true },
      `Overall: ${landing.overall.label}`,
    ),
    ...(comp.show_readiness_next
      ? [React.createElement(
        Text,
        { key: 'ready-next', color: theme.muted },
        `next: ${landing.overall.next_action}`,
      )]
      : []),
    ...(comp.show_readiness_details
      ? landing.readiness_rows.map((row, idx) => React.createElement(
        Text,
        {
          key: `r-${idx}`,
          color: toneColor(theme, row.tone),
        },
        `  ${row.label}: ${row.status_label}`,
      ))
      : []),
  );

  const recentRunsPanel = comp.show_recent_runs
    ? React.createElement(
      Box,
      {
        flexDirection: 'column',
        borderStyle: model.focus === 'content' ? 'double' : 'single',
        borderColor: focusBorderColor(theme, model.focus === 'content'),
        paddingX: 1,
        flexGrow: 1,
      },
      renderSectionTitle(
        theme,
        (landing.section_icons && landing.section_icons.recent_runs)
          || (landing.section_titles && landing.section_titles.recent_runs),
        'Recent Runs',
      ),
      ...(landing.recent_runs.length
        ? [
          React.createElement(
            Text,
            { key: 'rr-count', dimColor: true, color: theme.muted, wrap: 'truncate' },
            `Showing ${landing.recent_runs_showing} of ${landing.recent_runs_total}`
              + (model.focus === 'content' ? ' · ↑/↓ select · Enter open' : ''),
          ),
          ...landing.recent_runs.map((run, idx) => {
            const selected = run.run_id === model.selectedRunId;
            const mark = model.focus === 'content' && selected ? selectedMark : ' ';
            return React.createElement(
              Text,
              {
                key: `rr-${idx}`,
                wrap: 'truncate',
                bold: model.focus === 'content' && selected,
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
              `${mark}${formatRecentRunEntryLine(run, model.columns, { compact })}`,
            );
          }),
        ]
        : [
          React.createElement(
            Text,
            { key: 'rr-empty', color: theme.muted, wrap: 'truncate' },
            landing.empty_state
              ? `  ${landing.empty_state.title}: ${landing.empty_state.body}`
              : '  (No runs yet · Enter opens Browse Runs)',
          ),
        ]),
    )
    : null;

  const primaryChildren = [];
  if (comp.show_product) {
    const productRows = Array.isArray(landing.hero?.product_rows)
      ? landing.hero.product_rows
      : [];
    const productSegs = Array.isArray(landing.hero?.product_segments)
      ? landing.hero.product_segments
      : [];
    if (productRows.length > 0) {
      for (let i = 0; i < productRows.length; i += 1) {
        primaryChildren.push(renderGuardianSegments(
          theme,
          productRows[i].segments || [],
          `product-px-${i}`,
        ));
      }
    }
    if (productSegs.length > 0) {
      primaryChildren.push(renderGuardianSegments(
        theme,
        productSegs,
        'product-grad',
      ));
    } else if (productRows.length === 0) {
      primaryChildren.push(renderBrandWordmark(theme, landing.hero.product, 'product'));
    }
  }
  if (comp.show_tagline) {
    primaryChildren.push(React.createElement(
      Text,
      { key: 'tagline', color: theme.accent },
      landing.hero.tagline,
    ));
  }
  if (comp.show_triad) {
    primaryChildren.push(React.createElement(
      Text,
      { key: 'triad', color: theme.muted },
      landing.hero.triad,
    ));
  }
  if (comp.show_primary_cta) {
    primaryChildren.push(React.createElement(
      Text,
      {
        key: 'cta',
        bold: true,
        color: model.selectedNavId === 'launcher' ? theme.selected : theme.brand,
      },
      `${model.selectedNavId === 'launcher' ? selectedMark : ' '} 1. Start New Run`,
    ));
  }
  if (comp.show_guardian_note) {
    primaryChildren.push(React.createElement(
      Text,
      { key: 'gnote', dimColor: true, color: theme.muted },
      landing.hero.guardian_note,
    ));
  }

  const primaryBrand = React.createElement(
    Box,
    { flexDirection: 'column', flexGrow: 1, flexShrink: 1, paddingX: 1 },
    ...primaryChildren,
  );

  // Guardian column: Neon stays compact (~30% of 120). Semantic lock v2 wide is
  // ~58 cells — reserve exact width with flexShrink:0 so Yoga cannot shrink the
  // column (shrink wraps Braille rows and doubles rendered height).
  const guardianArtWidth = Number(landing.guardian_display_width) > 0
    ? Number(landing.guardian_display_width)
    : 22;
  const guardianArtRows = Array.isArray(landing.guardian_rows)
    ? landing.guardian_rows.length
    : 0;
  const maxGuardianCols = Math.max(36, Math.floor(Number(model.columns) * 0.55));
  const guardianColumnWidth = Math.min(
    maxGuardianCols,
    Math.max(22, guardianArtWidth + 4),
  );
  // Wide and mid (≥80 cols): guardian beside primary brand so compact lock art
  // does not steal vertical budget from Quick Start / System Readiness.
  const sideBySideGuardian = showGuardian
    && (landingLayout === 'wide' || landingLayout === 'mid');

  const guardianColumn = sideBySideGuardian && landingLayout === 'wide'
    ? React.createElement(
      Box,
      {
        flexDirection: 'column',
        paddingX: 1,
        borderStyle: 'single',
        borderColor: theme.muted,
        width: guardianColumnWidth,
        flexShrink: 0,
        height: guardianArtRows + 2,
      },
      ...landing.guardian_rows.map((row, idx) => renderGuardianSegments(
        theme,
        row.segments || [],
        `g-${idx}`,
      )),
    )
    : (sideBySideGuardian && landingLayout === 'mid'
      ? React.createElement(
        Box,
        {
          flexDirection: 'column',
          paddingX: 1,
          width: guardianColumnWidth,
          flexShrink: 0,
          height: guardianArtRows > 0 ? guardianArtRows : undefined,
        },
        ...landing.guardian_rows.map((row, idx) => renderGuardianSegments(
          theme,
          row.segments || [],
          `gm-${idx}`,
        )),
      )
      : null);

  const guardianStacked = showGuardian && landingLayout === 'compact'
    ? React.createElement(
      Box,
      {
        flexDirection: 'column',
        paddingX: 1,
        flexShrink: 0,
        height: guardianArtRows > 0 ? guardianArtRows : undefined,
      },
      ...landing.guardian_rows.map((row, idx) => renderGuardianSegments(
        theme,
        row.segments || [],
        `gc-${idx}`,
      )),
    )
    : null;

  const heroRow = guardianColumn
    ? React.createElement(
      Box,
      { flexDirection: 'row' },
      guardianColumn,
      primaryBrand,
    )
    : React.createElement(
      Box,
      { flexDirection: 'column' },
      ...(guardianStacked ? [guardianStacked] : []),
      primaryBrand,
    );

  const panelChildren = [];
  if (compact) {
    if (quickStartPanel) panelChildren.push(quickStartPanel);
    panelChildren.push(readinessPanel);
    if (recentRunsPanel) panelChildren.push(recentRunsPanel);
  } else {
    panelChildren.push(React.createElement(
      Box,
      { key: 'mid-row', flexDirection: 'row', flexGrow: 1 },
      ...(quickStartPanel ? [quickStartPanel] : []),
      readinessPanel,
    ));
    if (recentRunsPanel) panelChildren.push(recentRunsPanel);
  }

  const panelsRow = React.createElement(
    Box,
    { flexDirection: 'column', flexGrow: 0 },
    ...panelChildren,
  );

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: model.columns,
    },
    React.createElement(
      Box,
      {
        borderStyle: 'double',
        borderColor: theme.brand,
        paddingX: 1,
        justifyContent: 'space-between',
      },
      React.createElement(Text, { color: theme.brand }, `[>] ${model.title}`),
      React.createElement(
        Text,
        { color: theme.muted },
        `v${String(model.version).replace(/^v/i, '')}`,
      ),
    ),
    heroRow,
    panelsRow,
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
      React.createElement(Text, { dimColor: true, color: theme.muted }, model.footerHints),
    ),
  );
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
  const theme = resolveShellTheme({
    colorEnabled: model.colorEnabled,
    truecolor: model.truecolor,
  });
  const height = resolveSplashFrameHeight(model.rows);
  const content = buildSplashContent({
    columns: model.columns,
    rows: height,
    version: model.version,
    readiness: model.readiness,
    icons: model.iconMode,
    truecolor: theme.truecolor,
    art: model.landing?.art?.requested ?? model.artMode,
    guardianStyle: model.landing?.guardian_style
      ?? model.landing?.art?.guardianStyle
      ?? model.guardianStyle,
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
  const triadNode = content.showTriad === false
    ? null
    : (theme.triadValidate
      ? renderSegments(content.triadSegments, 'triad')
      : React.createElement(
        Text,
        { key: 'triad', color: theme.muted },
        content.triad || 'Validate • Trace • Enforce',
      ));

  const wordmarkNodes = Array.isArray(content.wordmarkRows) && content.wordmarkRows.length > 0
    ? content.wordmarkRows.map((row, idx) => renderSegments(row.segments, `wm-px-${idx}`))
    : [
      renderSegments(
        content.wordmarkSegments && content.wordmarkSegments.length > 0
          ? content.wordmarkSegments
          : [{ text: content.wordmark || 'AI-MINIONS', tone: 'brand', bold: true }],
        'wm-text',
      ),
    ];

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
    ...wordmarkNodes,
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
  const theme = resolveShellTheme({
    colorEnabled: model.colorEnabled,
    truecolor: model.truecolor,
  });

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
    if (intent.type === 'help_move') {
      commit(moveHelpTopicSelection(current, intent.direction));
      return;
    }
    if (intent.type === 'help_open') {
      commit(openHelpTopic(current, intent.topicId));
      return;
    }
    if (intent.type === 'help_close_topic') {
      commit(closeHelpTopic(current));
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
      {
        const next = applyInkLocalSurfaceTransition(current, actionId);
        if (next) {
          commit(next);
          return;
        }
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
        {
          const next = applyInkLocalSurfaceTransition(current, normalizeInkLocalActionToken(token));
          if (next) {
            commit(next);
            return;
          }
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
  const contentEntries = buildContentEntries(model);
  const readinessColor = model.readiness === 'ready'
    ? theme.ready
    : (model.readiness === 'blocked'
      ? theme.blocked
      : (model.readiness === 'failed'
        ? theme.danger
        : (model.readiness === 'unknown' || model.readiness === 'loading'
          ? theme.muted
          : theme.warn)));

  if (model.contentSurface === 'home' && model.landing) {
    return React.createElement(LandingHomeView, {
      model,
      theme,
      readinessColor,
    });
  }

  return React.createElement(
    Box,
    { flexDirection: 'column', width: model.columns, height: Math.max(1, Number(model.rows) || 24) },
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
          `${model.title} v${model.version}`,
        ),
        React.createElement(
          Text,
          { color: theme.muted },
          `[${model.layout}]`,
        ),
      ),
      React.createElement(
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
          width: narrow ? undefined : 28,
          borderStyle: model.focus === 'nav' ? 'double' : 'single',
          borderColor: focusBorderColor(theme, model.focus === 'nav'),
          paddingX: 1,
        },
        React.createElement(Text, { bold: theme.sectionBold, color: theme.accent }, 'Navigate'),
        React.createElement(
          Text,
          { dimColor: true, color: theme.muted },
          'keyboard — not clickable',
        ),
        ...model.navItems.map((item) => {
          const selected = item.id === model.selectedNavId;
          const prefix = item.group === 'run' ? '  ' : '';
          return React.createElement(
            Text,
            {
              key: item.id,
              bold: selected,
              color: selected ? theme.selected : undefined,
            },
            `${prefix}${selected ? '›' : ' '} ${item.key}. ${item.label}`,
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
        React.createElement(
          Box,
          { flexDirection: 'column', paddingTop: 1 },
          React.createElement(
            Text,
            { bold: theme.sectionBold, color: theme.accent },
            `Content · ${model.contentSurface}`,
          ),
          React.createElement(Text, { key: 'c-pad' }, ' '),
          ...contentEntries.map((entry, idx) => {
            const line = entry.text ?? '';
            const selected = entry.selected === true;
            const muted = entry.muted === true
              || line.startsWith('(')
              || entry.kind === 'note'
              || entry.kind === 'hint'
              || entry.kind === 'footer';
            if (entry.kind === 'spacer' || line === '') {
              return React.createElement(Text, { key: `c-${idx}` }, ' ');
            }
            return React.createElement(
              Text,
              {
                key: `c-${idx}`,
                bold: selected,
                dimColor: muted && !selected,
                color: selected
                  ? theme.selected
                  : (muted ? theme.muted : undefined),
                // Truncate unselected noise; keep selected rows wrapping so the › marker stays visible.
                wrap: selected ? 'wrap' : 'truncate',
              },
              line,
            );
          }),
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
 * @returns {Array<{ text: string, selected?: boolean, muted?: boolean, kind?: string }>}
 */
function buildContentEntries(model) {
  if (model.activeWorkflow) {
    return formatNativeWorkflowEntries(model.activeWorkflow);
  }
  return buildContentLines(model).map((text) => ({
    text: String(text),
    muted: String(text).startsWith('('),
  }));
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
        narrow: model.layout === 'narrow' || model.landingLayout === 'compact',
      });
    }
    return ['(landing unavailable)'];
  }
  if (model.contentSurface === 'diagnostics') {
    return formatDiagnosticsLines(model.home);
  }
  if (model.contentSurface === 'help') {
    return formatHelpLines({
      selectedTopicId: model.helpSelectedTopicId,
      openTopicId: model.helpOpenTopicId,
    });
  }
  if (model.contentSurface === 'runs') {
    if (!model.runs.runs.length) return ['(none)', `result_code: ${model.runs.result_code}`];
    return model.runs.runs.flatMap((run) => formatRunsBoardEntryLines(run, {
      selected: run.run_id === model.selectedRunId,
    }));
  }
  if (model.contentSurface === 'status') {
    if (!model.status.available) {
      return ['(status unavailable)', `selected: ${model.selectedRunId ?? '-'}`];
    }
    // Missing eligibility fails closed to Unavailable (never invent Inspect/Resume).
    const eligibility = model.status.action_eligibility == null || model.status.action_eligibility === ''
      ? 'unavailable'
      : model.status.action_eligibility;
    return [
      `run_id: ${model.status.run_id ?? '-'}`,
      `title: ${fieldOrUnavailable(model.status.goal_summary)}`,
      `created_at: ${fieldOrUnavailable(model.status.created_at)}`,
      `updated_at: ${fieldOrUnavailable(model.status.last_event_at)}`,
      `current_phase: ${fieldOrUnavailable(model.status.current_phase)}`,
      `result_code: ${model.status.result_code ?? '-'}`,
      `status: ${model.status.status ?? '-'}`,
      `outcome: ${model.status.outcome ?? '-'}`,
      `reason_code: ${fieldOrUnavailable(model.status.reason_code)}`,
      `action: ${actionEligibilityDisplayLabel(eligibility)}`,
      `next_safe_action: ${model.status.next_safe_action ?? '-'}`,
      'Esc back to run list · selection preserved',
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
      `snapshot_ok: ${String(model.config.snapshot_ok)}`,
      `doctor_status: ${model.config.doctor_status ?? 'not_run'}`,
      `doctor_ok: ${model.config.doctor_ok == null ? 'n/a' : String(model.config.doctor_ok)}`,
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
 *   interactive?: boolean,
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
  // Hold chalk at level 0 for the whole session when the model disables color —
  // Ink re-renders on every state change, so a sync scope is not enough.
  const suppressColor = Boolean(options.model) && options.model.colorEnabled === false;
  const prevChalkLevel = suppressColor ? inkChalk.level : undefined;
  if (suppressColor) inkChalk.level = 0;
  let instance;
  try {
    instance = render(
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
        // Undefined defers to Ink's CI/TTY detection; explicit boolean overrides it.
        interactive: options.interactive,
      },
    );
    await instance.waitUntilExit();
  } finally {
    if (suppressColor) inkChalk.level = prevChalkLevel;
  }
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
  const initialModel = buildShellModel({ ...shellModelToOptions(model), columns, rows });
  return withColorDisabled(
    initialModel.colorEnabled === false,
    () => renderToString(
      React.createElement(OperatorTuiRoot, {
        initialModel,
        showSplash,
      }),
      { columns },
    ),
  );
}

export {
  ShellApp,
  SplashApp,
  OperatorTuiRoot,
  buildContentEntries,
  buildContentLines,
  formatField,
  shouldSkipSplash,
  resolveSplashDurationMs,
};
