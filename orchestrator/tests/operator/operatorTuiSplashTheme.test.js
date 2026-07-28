'use strict';

/**
 * Brand splash + Ink shell theme tokens (presentation only).
 * Cerberus brand splash markers + first-paint order.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveShellTheme,
  focusBorderColor,
  splashToneColor,
} = require('../../modules/operator/operator-tui-theme');
const {
  buildSplashContent,
  shouldSkipSplash,
  resolveSplashDurationMs,
  resolveSplashFrameHeight,
  resolveSplashDensity,
  splashBannerLines,
  wordmarkSegments,
  flattenSplashRows,
  landingGuardianRowsWide,
  WORDMARK,
  GUARDIAN_MARK,
  TRIAD_LABEL,
  DEFAULT_SPLASH_MS,
  SKIP_ENV,
} = require('../../modules/operator/operator-tui-splash');
const { buildShellModel } = require('../../modules/operator/operator-tui-shell-model');

test('resolveShellTheme returns hex palette + triad tokens when color enabled', () => {
  const prev = process.env.NO_COLOR;
  const prevColorterm = process.env.COLORTERM;
  delete process.env.NO_COLOR;
  delete process.env.COLORTERM;
  try {
    const theme = resolveShellTheme({ colorEnabled: true, truecolor: false });
    assert.equal(theme.brand, '#67D9F5');
    assert.equal(theme.brandPrimary, '#67D9F5');
    assert.equal(theme.brandCore, '#9B8CFF');
    assert.equal(theme.brandSecondary, '#9B8CFF');
    assert.equal(theme.accent, '#9B8CFF');
    assert.equal(theme.focus, '#67D9F5');
    assert.equal(theme.ready, '#55D6A5');
    assert.equal(theme.warn, '#E8C547');
    assert.equal(theme.danger, '#F07178');
    assert.equal(theme.triadValidate, '#67D9F5');
    assert.equal(theme.triadTrace, '#9B8CFF');
    assert.equal(theme.triadEnforce, '#F4B860');
    assert.equal(theme.blocked, '#D27BEA');
    assert.notEqual(theme.blocked, theme.danger);
    assert.notEqual(theme.warn, theme.palette.amber);
    assert.equal(theme.roleCerberus, '#D27BEA');
    assert.equal(theme.truecolor, false);
    assert.equal(theme.brandGradient, null);
    assert.equal(focusBorderColor(theme, true), '#67D9F5');
    assert.equal(focusBorderColor(theme, false), '#92A0B8');
    assert.equal(splashToneColor(theme, 'validate'), '#67D9F5');
    assert.equal(splashToneColor(theme, 'trace'), '#9B8CFF');
    assert.equal(splashToneColor(theme, 'enforce'), '#F4B860');

    const rich = resolveShellTheme({ colorEnabled: true, truecolor: true });
    assert.equal(rich.truecolor, true);
    assert.deepEqual(rich.brandGradient, ['#67D9F5', '#9B8CFF', '#F4B860']);
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
    if (prevColorterm === undefined) delete process.env.COLORTERM;
    else process.env.COLORTERM = prevColorterm;
  }
});

test('resolveShellTheme strips colors when NO_COLOR or colorEnabled=false', () => {
  const themeOff = resolveShellTheme({ colorEnabled: false });
  assert.equal(themeOff.brand, undefined);
  assert.equal(themeOff.focus, undefined);
  assert.equal(themeOff.triadValidate, undefined);
  assert.equal(themeOff.brandPrimary, undefined);

  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const theme = resolveShellTheme({ colorEnabled: true });
    assert.equal(theme.brand, undefined);
    assert.equal(theme.selected, undefined);
    assert.equal(splashToneColor(theme, 'validate'), undefined);
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('buildSplashContent includes Cerberus brand splash markers and version', () => {
  const wide = buildSplashContent({
    columns: 80,
    rows: 40,
    version: 'v0.26.0-beta.1',
    readiness: 'ready',
  });
  const joined = wide.lines.join('\n');
  assert.equal(wide.density, 'full');
  assert.ok(wide.lines.length >= 5);
  assert.match(joined, /VALIDATE/);
  assert.match(joined, /TRACE/);
  assert.match(joined, /ENFORCE/);
  assert.match(joined, new RegExp(GUARDIAN_MARK));
  assert.equal(wide.wordmark, WORDMARK);
  assert.match(wide.wordmark, /AI-MINIONS/);
  assert.equal(wide.triad, TRIAD_LABEL);
  assert.match(wide.triad, /Validate/);
  assert.match(wide.triad, /Trace/);
  assert.match(wide.triad, /Enforce/);
  assert.match(wide.subtitle, /0\.26\.0-beta\.1/);
  assert.match(wide.subtitle, /readiness=ready/);
  assert.match(wide.hint, /any key/i);
  assert.match(wide.productTagline, /Contract-First/i);
  assert.ok(wide.wordmarkSegments.length === WORDMARK.length);
  assert.ok(wide.triadSegments.some((s) => s.tone === 'validate' && /Validate/i.test(s.text)));

  const narrow = buildSplashContent({ columns: 40, rows: 40, version: '0.26.0-beta.1' });
  const narrowJoined = narrow.lines.join('\n');
  assert.equal(narrow.density, 'compact');
  assert.match(narrowJoined, /VALIDATE/);
  assert.match(narrowJoined, /TRACE/);
  assert.match(narrowJoined, /ENFORCE/);
  assert.match(narrowJoined, new RegExp(GUARDIAN_MARK));
  assert.equal(narrow.wordmark, WORDMARK);
  assert.ok(narrow.lines[0].length < splashBannerLines()[0].length
    || narrow.lines.length <= splashBannerLines().length);
});

test('resolveSplashFrameHeight fits reported rows and never pads to 24', () => {
  assert.equal(resolveSplashFrameHeight(12), 12);
  assert.equal(resolveSplashFrameHeight(8), 8);
  assert.equal(resolveSplashFrameHeight(40), 40);
  assert.equal(resolveSplashFrameHeight(undefined), 24);
  assert.equal(resolveSplashFrameHeight(0), 24);
  assert.equal(resolveSplashDensity(12, 80), 'minimal');
  assert.equal(resolveSplashDensity(20, 80), 'compact');
  assert.equal(resolveSplashDensity(40, 80), 'full');
});

test('buildSplashContent short TTY uses minimal density with continue affordance', () => {
  const short = buildSplashContent({
    columns: 80,
    rows: 12,
    version: '0.26.0-beta.1',
    readiness: 'loading',
  });
  assert.equal(short.density, 'minimal');
  assert.equal(short.frameHeight, 12);
  assert.equal(short.showProductTagline, false);
  assert.equal(short.showSpacers, false);
  assert.ok(short.lines.length <= 3);
  assert.match(short.lines.join('\n'), new RegExp(GUARDIAN_MARK));
  assert.match(short.hint, /any key|continue/i);
  assert.match(short.disclaimer, /not Web UI/i);
  assert.match(short.triad, /Validate/);
});

test('shouldSkipSplash respects AI_MINIONS_TUI_SKIP_SPLASH', () => {
  assert.equal(shouldSkipSplash({}), false);
  assert.equal(shouldSkipSplash({ [SKIP_ENV]: '1' }), true);
  assert.equal(shouldSkipSplash({ [SKIP_ENV]: 'true' }), true);
  assert.equal(shouldSkipSplash({ [SKIP_ENV]: '0' }), false);
});

test('resolveSplashDurationMs clamps and defaults', () => {
  assert.equal(resolveSplashDurationMs(undefined), DEFAULT_SPLASH_MS);
  assert.equal(resolveSplashDurationMs(-1), DEFAULT_SPLASH_MS);
  assert.equal(resolveSplashDurationMs(500), 500);
  assert.equal(resolveSplashDurationMs(99_999), 30_000);
});

test('icon mode defaults to nerd; NO_COLOR does not auto-degrade icons', () => {
  const {
    resolveIconMode,
    chromeIcon,
    ICONS_ENV,
    DEFAULT_ICON_MODE,
  } = require('../../modules/operator/operator-tui-icons');
  assert.equal(DEFAULT_ICON_MODE, 'nerd');
  assert.equal(resolveIconMode({}, {}), 'nerd');
  assert.equal(resolveIconMode({ icons: 'unicode' }, {}), 'unicode');
  assert.equal(resolveIconMode({ icons: 'ascii' }, {}), 'ascii');
  assert.equal(resolveIconMode({ icons: 'bogus' }, {}), 'nerd');
  assert.equal(resolveIconMode({}, { [ICONS_ENV]: 'ascii' }), 'ascii');
  // Honest: NO_COLOR alone does not switch icon mode.
  assert.equal(resolveIconMode({}, { NO_COLOR: '1' }), 'nerd');
  assert.equal(chromeIcon('unicode', 'selected'), '\u203a');
  assert.equal(chromeIcon('ascii', 'selected'), '>');
  assert.notEqual(chromeIcon('nerd', 'selected'), chromeIcon('ascii', 'selected'));

  const asciiArt = flattenSplashRows(landingGuardianRowsWide('ascii')).join('\n');
  for (const ch of asciiArt) {
    const cp = ch.codePointAt(0);
    assert.ok(
      cp === 0x09 || cp === 0x0a || cp === 0x0d || (cp >= 0x20 && cp <= 0x7e),
      `ascii guardian must be ASCII, got U+${cp.toString(16)}`,
    );
  }
  assert.match(asciiArt, /CERBERUS/);
  assert.match(asciiArt, /VALIDATE/);
});

test('wordmark gradient tones only when truecolor requested', () => {
  const plain = wordmarkSegments({ truecolor: false });
  assert.ok(plain.every((s) => s.tone === 'brand'));
  const rich = wordmarkSegments({ truecolor: true });
  assert.ok(rich.some((s) => s.tone === 'gradient-cyan'));
  assert.ok(rich.some((s) => s.tone === 'gradient-violet'));
  assert.ok(rich.some((s) => s.tone === 'gradient-amber'));
});

test('Ink renderToString splash shows Cerberus brand splash; shell shows themed chrome', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    columns: 80,
    rows: 40,
    colorEnabled: false,
  });

  const splash = renderOperatorTuiShellToString(model, { columns: 80, rows: 40, showSplash: true });
  assert.match(splash, /AI-MINIONS|ai-minions/i);
  assert.match(splash, /CERBERUS/i);
  assert.match(splash, /VALIDATE/i);
  assert.match(splash, /TRACE/i);
  assert.match(splash, /ENFORCE/i);
  assert.match(splash, /Validate/);
  assert.match(splash, /Trace/);
  assert.match(splash, /Enforce/);
  assert.match(splash, /Presentation polish only/i);
  assert.match(splash, /Press any key/i);

  const shell = renderOperatorTuiShellToString(model, { columns: 80, showSplash: false });
  assert.match(shell, /Quick Start|Navigate/);
  assert.match(shell, /keyboard/);
  assert.match(shell, /clickable/);
  assert.match(shell, /System Readiness|AI-MINIONS/);
  assert.doesNotMatch(shell, /Press any key/);
});

test('short TTY splash first paint stays within reported rows and shows continue hint', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const rows = 12;
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    columns: 80,
    rows,
    colorEnabled: false,
  });

  const splash = renderOperatorTuiShellToString(model, { columns: 80, rows, showSplash: true });
  const lineCount = splash.split('\n').length;
  assert.ok(
    lineCount <= rows,
    `expected first paint ? ${rows} lines (no 24-row pad), got ${lineCount}`,
  );
  assert.match(splash, /CERBERUS/i);
  assert.match(splash, /Validate|VALIDATE/i);
  assert.match(splash, /Trace|TRACE/i);
  assert.match(splash, /Enforce|ENFORCE/i);
  assert.match(splash, /Press any key|continue/i);
  assert.match(splash, /not Web UI|Presentation polish/i);
});

test('buildFirstPaintShellModel is version + loading/unavailable only', () => {
  const {
    buildFirstPaintShellModel,
    shouldShowProductionSplash,
  } = require('../../modules/operator/operator-tui-shell-entry');

  const model = buildFirstPaintShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    columns: 80,
    rows: 24,
    colorEnabled: false,
  });
  assert.equal(model.version, '0.26.0-beta.1');
  assert.equal(model.readiness, 'loading');
  assert.equal(model.home.credential_sufficiency, 'unavailable');
  assert.equal(model.runs.runs.length, 0);
  assert.equal(model.runs.result_code, 'RUNS_UNAVAILABLE');

  assert.equal(shouldShowProductionSplash({}), true);
  assert.equal(shouldShowProductionSplash({ maxLoops: 1 }), false);
  assert.equal(shouldShowProductionSplash({ autoQuitMs: 40 }), false);
  assert.equal(shouldShowProductionSplash({ skipSplash: true }), false);
  assert.equal(shouldShowProductionSplash({}, { [SKIP_ENV]: '1' }), false);
});

test('production entry: splash renderer before loadRuns / credential discovery', async () => {
  const {
    runOperatorTuiShell,
    TUI_SHELL_REASON,
  } = require('../../modules/operator/operator-tui-shell-entry');

  const order = [];
  let splashModelReadiness = null;
  let shellModelReadiness = null;
  let renderCalls = 0;

  const result = await runOperatorTuiShell({
    isTTY: true,
    splashMs: 0,
    // Unbounded loops ? production splash gate (not harness skip).
    buildAbout: () => {
      order.push('buildAbout');
      return { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' };
    },
    assessCredentials: () => {
      order.push('assessCredentials');
      return { credential_sufficiency: 'not_required', providers: [] };
    },
    assessPath: () => {
      order.push('assessPath');
      return { status: 'ready', on_path: true };
    },
    loadRuns: () => {
      order.push('loadRuns');
      return {
        ok: true,
        exitCode: 0,
        result_code: 'RUNS_EMPTY',
        next_safe_action: 'none',
        json: { result_code: 'RUNS_EMPTY', runs: [], next_safe_action: 'none' },
      };
    },
    importRenderer: async () => ({
      async renderOperatorTuiShell(opts) {
        renderCalls += 1;
        if (opts.showSplash === true) {
          order.push('splashRender');
          splashModelReadiness = opts.model?.readiness;
          assert.equal(opts.splashOnly, true);
          assert.equal(opts.model?.readiness, 'loading');
          return { aborted: false };
        }
        order.push('shellRender');
        shellModelReadiness = opts.model?.readiness;
        assert.equal(opts.showSplash, false);
        if (typeof opts.onRequestAction === 'function') {
          opts.onRequestAction('quit');
        }
        return { aborted: false, requestedAction: 'quit' };
      },
    }),
  });

  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.equal(renderCalls, 2);
  assert.equal(splashModelReadiness, 'loading');
  assert.equal(shellModelReadiness, 'ready');

  const splashIdx = order.indexOf('splashRender');
  const loadIdx = order.indexOf('loadRuns');
  const credIdx = order.indexOf('assessCredentials');
  const pathIdx = order.indexOf('assessPath');
  const shellIdx = order.indexOf('shellRender');
  assert.ok(splashIdx >= 0, `order=${order.join(',')}`);
  assert.ok(splashIdx < loadIdx, `splash before loadRuns: ${order.join(',')}`);
  assert.ok(splashIdx < credIdx, `splash before assessCredentials: ${order.join(',')}`);
  assert.ok(splashIdx < pathIdx, `splash before assessPath: ${order.join(',')}`);
  assert.ok(loadIdx < shellIdx, `loadRuns before shell remount: ${order.join(',')}`);
  assert.ok(order.indexOf('buildAbout') < splashIdx);
});

test('finite-loop harness still skips splash and discovers before shell', async () => {
  const { runOperatorTuiShell } = require('../../modules/operator/operator-tui-shell-entry');
  const order = [];

  const result = await runOperatorTuiShell({
    isTTY: true,
    maxLoops: 1,
    autoQuitMs: 40,
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => {
      order.push('assessCredentials');
      return { credential_sufficiency: 'not_required', providers: [] };
    },
    assessPath: () => {
      order.push('assessPath');
      return { status: 'ready', on_path: true };
    },
    loadRuns: () => {
      order.push('loadRuns');
      return {
        ok: true,
        exitCode: 0,
        result_code: 'RUNS_EMPTY',
        next_safe_action: 'none',
        json: { result_code: 'RUNS_EMPTY', runs: [], next_safe_action: 'none' },
      };
    },
    importRenderer: async () => ({
      async renderOperatorTuiShell(opts) {
        order.push(opts.showSplash === true ? 'splashRender' : 'shellRender');
        assert.equal(opts.showSplash, false);
        return { aborted: false };
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.ok(!order.includes('splashRender'), `order=${order.join(',')}`);
  assert.ok(order.indexOf('loadRuns') < order.indexOf('shellRender'));
  assert.equal(result.model.readiness, 'ready');
});
