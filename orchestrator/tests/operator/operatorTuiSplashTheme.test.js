'use strict';

/**
 * Brand splash + Ink shell theme tokens (presentation only).
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveShellTheme,
  focusBorderColor,
} = require('../../modules/operator/operator-tui-theme');
const {
  buildSplashContent,
  shouldSkipSplash,
  resolveSplashDurationMs,
  splashBannerLines,
  DEFAULT_SPLASH_MS,
  SKIP_ENV,
} = require('../../modules/operator/operator-tui-splash');
const { buildShellModel } = require('../../modules/operator/operator-tui-shell-model');

test('resolveShellTheme returns cyan brand when color enabled', () => {
  const prev = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const theme = resolveShellTheme({ colorEnabled: true });
    assert.equal(theme.brand, 'cyan');
    assert.equal(theme.accent, 'blueBright');
    assert.equal(theme.focus, 'cyan');
    assert.equal(theme.ready, 'green');
    assert.equal(focusBorderColor(theme, true), 'cyan');
    assert.equal(focusBorderColor(theme, false), 'gray');
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('resolveShellTheme strips colors when NO_COLOR or colorEnabled=false', () => {
  const themeOff = resolveShellTheme({ colorEnabled: false });
  assert.equal(themeOff.brand, undefined);
  assert.equal(themeOff.focus, undefined);

  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const theme = resolveShellTheme({ colorEnabled: true });
    assert.equal(theme.brand, undefined);
    assert.equal(theme.selected, undefined);
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('buildSplashContent includes brand mark and version', () => {
  const wide = buildSplashContent({
    columns: 80,
    version: 'v0.26.0-beta.1',
    readiness: 'ready',
  });
  assert.ok(wide.lines.length >= 3);
  assert.ok(wide.lines.some((l) => /ai-minions/i.test(l)));
  assert.match(wide.subtitle, /0\.26\.0-beta\.1/);
  assert.match(wide.subtitle, /readiness=ready/);
  assert.match(wide.hint, /any key/i);
  assert.match(wide.tagline, /keyboard/i);

  const narrow = buildSplashContent({ columns: 40, version: '0.26.0-beta.1' });
  assert.ok(narrow.lines.some((l) => /ai-minions/i.test(l)));
  assert.ok(narrow.lines[0].length < splashBannerLines()[0].length);
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

test('Ink renderToString splash shows brand; shell shows themed chrome', async () => {
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
  assert.match(splash, /ai-minions/i);
  assert.match(splash, /Presentation polish only/i);
  assert.match(splash, /Press any key/i);

  const shell = renderOperatorTuiShellToString(model, { columns: 80, showSplash: false });
  assert.match(shell, /Actions/);
  assert.match(shell, /keyboard keys/);
  assert.match(shell, /clickable/);
  assert.match(shell, /Content ·/);
  assert.doesNotMatch(shell, /Press any key/);
});
