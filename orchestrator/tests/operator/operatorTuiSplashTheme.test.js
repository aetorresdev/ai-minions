'use strict';

/**
 * Brand splash + Ink shell theme tokens (presentation only).
 * Cerberus option C splash markers + first-paint order.
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
  splashBannerLines,
  WORDMARK,
  GUARDIAN_MARK,
  TRIAD_LABEL,
  DEFAULT_SPLASH_MS,
  SKIP_ENV,
} = require('../../modules/operator/operator-tui-splash');
const { buildShellModel } = require('../../modules/operator/operator-tui-shell-model');

test('resolveShellTheme returns cyan brand + triad tokens when color enabled', () => {
  const prev = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const theme = resolveShellTheme({ colorEnabled: true });
    assert.equal(theme.brand, 'cyan');
    assert.equal(theme.brandPrimary, 'cyan');
    assert.equal(theme.brandCore, 'blueBright');
    assert.equal(theme.brandSecondary, 'magenta');
    assert.equal(theme.accent, 'blueBright');
    assert.equal(theme.focus, 'cyan');
    assert.equal(theme.ready, 'green');
    assert.equal(theme.triadValidate, 'cyan');
    assert.equal(theme.triadTrace, 'blueBright');
    assert.equal(theme.triadEnforce, 'magenta');
    assert.equal(theme.blocked, 'magentaBright');
    assert.notEqual(theme.blocked, theme.danger);
    assert.equal(theme.roleCerberus, 'magentaBright');
    assert.equal(focusBorderColor(theme, true), 'cyan');
    assert.equal(focusBorderColor(theme, false), 'gray');
    assert.equal(splashToneColor(theme, 'validate'), 'cyan');
    assert.equal(splashToneColor(theme, 'trace'), 'blueBright');
    assert.equal(splashToneColor(theme, 'enforce'), 'magenta');
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
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

test('buildSplashContent includes Cerberus option C markers and version', () => {
  const wide = buildSplashContent({
    columns: 80,
    version: 'v0.26.0-beta.1',
    readiness: 'ready',
  });
  const joined = wide.lines.join('\n');
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

  const narrow = buildSplashContent({ columns: 40, version: '0.26.0-beta.1' });
  const narrowJoined = narrow.lines.join('\n');
  assert.match(narrowJoined, /VALIDATE/);
  assert.match(narrowJoined, /TRACE/);
  assert.match(narrowJoined, /ENFORCE/);
  assert.match(narrowJoined, new RegExp(GUARDIAN_MARK));
  assert.equal(narrow.wordmark, WORDMARK);
  assert.ok(narrow.lines[0].length < splashBannerLines()[0].length
    || narrow.lines.length <= splashBannerLines().length);
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

test('Ink renderToString splash shows Cerberus option C; shell shows themed chrome', async () => {
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

  const splash = renderOperatorTuiShellToString(model, { columns: 80, showSplash: true });
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
    // Unbounded loops → production splash gate (not harness skip).
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
