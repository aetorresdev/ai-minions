'use strict';

/**
 * Arcade / pixel-art Cerberus — unit + checkpoint comparison fixtures.
 * Checkpoint validation never rewrites fixtures (use scripts/regenerate-*).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ART_ENV,
  GUARDIAN_STYLE_ENV,
  DEFAULT_GUARDIAN_STYLE,
  resolveArtMode,
  buildLandingGuardianArt,
  neonCerberusRows,
  semanticCerberusRows,
  flattenArtRows,
  measureArtRowsWidth,
  sectionPixelIcon,
  sectionTitleWithPixelIcon,
  formatArtResolutionDebug,
} = require('../../modules/operator/operator-tui-pixel-art');
const { buildLandingViewModel } = require('../../modules/operator/operator-tui-landing');
const { buildShellModel, formatShellText, shellModelToOptions } = require('../../modules/operator/operator-tui-shell-model');

const CHECKPOINT_DIR = path.join(__dirname, '../fixtures/tui/pixel-art-checkpoint');

function readyHome() {
  return {
    version: '0.26.0-beta.1',
    git_commit: 'abc1234',
    model_policy: 'local_only',
    path_status: 'ready',
    cli_on_path: true,
    credential_sufficiency: 'not_required',
    remote_tokens_required: false,
    providers: [],
  };
}

test('resolveArtMode: auto/arcade/text/none and invalid fail-closed', () => {
  assert.equal(resolveArtMode({ art: 'arcade' }, {}).effective, 'arcade');
  assert.equal(resolveArtMode({ art: 'text' }, {}).effective, 'text');
  assert.equal(resolveArtMode({ art: 'none' }, {}).effective, 'none');
  assert.equal(
    resolveArtMode({ art: 'auto', icons: 'unicode' }, {}).effective,
    'arcade',
  );
  assert.equal(
    resolveArtMode({ art: 'auto', icons: 'ascii' }, {}).effective,
    'text',
  );
  const bad = resolveArtMode({ art: 'sixel' }, {});
  assert.equal(bad.mode, 'auto');
  assert.equal(bad.effective, 'arcade'); // default icons=nerd → arcade under auto
  assert.match(String(bad.reason), /invalid_art_mode:sixel/);
  assert.equal(bad.requested, 'sixel');
});

test('resolveArtMode: guardian style neon|semantic; default neon; invalid → neon', () => {
  assert.equal(DEFAULT_GUARDIAN_STYLE, 'neon');
  assert.equal(resolveArtMode({ guardianStyle: 'semantic' }, {}).guardianStyle, 'semantic');
  assert.equal(resolveArtMode({ guardianStyle: 'neon' }, {}).guardianStyle, 'neon');
  assert.equal(resolveArtMode({}, {}).guardianStyle, 'neon');
  const bad = resolveArtMode({ guardianStyle: 'ember' }, {});
  assert.equal(bad.guardianStyle, 'neon');
  assert.equal(bad.guardianStyleRequested, 'ember');
  assert.match(String(bad.guardianStyleReason), /invalid_guardian_style:ember/);
});

test('neon and semantic wide sprites are deterministic matrices', () => {
  const neon = neonCerberusRows('wide', 'unicode');
  const semantic = semanticCerberusRows('wide', 'unicode');
  assert.ok(neon.length >= 4);
  assert.ok(semantic.length >= 4);
  assert.ok(flattenArtRows(neon).some((l) => /CERBERUS/.test(l)));
  assert.ok(flattenArtRows(semantic).some((l) => /VALIDATE/.test(l)));
  assert.ok(flattenArtRows(semantic).some((l) => /TRACE/.test(l)));
  assert.ok(flattenArtRows(semantic).some((l) => /ENFORCE/.test(l)));
  // Neon stays compact; Semantic uses lock v2 wide (58 cols + labels).
  assert.ok(measureArtRowsWidth(neon) <= 30, 'neon guardian ≤ ~30% of 120 cols');
  assert.ok(measureArtRowsWidth(semantic) <= 68, 'semantic lock wide ≤ showcase width');
  // Faithful Braille cells — not five-line filled-block approximations alone.
  const joined = flattenArtRows(semantic).join('\n');
  assert.match(joined, /[\u2800-\u28ff]/u);
  assert.doesNotMatch(joined, /[▶▣◷]/u);
});

test('ascii arcade sprites avoid block tofu path', () => {
  const rows = neonCerberusRows('wide', 'ascii');
  const joined = flattenArtRows(rows).join('\n');
  assert.ok(!/[█▀▄]/.test(joined), 'ascii sprite must not use block cells');
  assert.match(joined, /CERBERUS|V.*T.*E/);
});

test('buildLandingGuardianArt: none omits; text leaves splash path empty; arcade fills rows', () => {
  const none = buildLandingGuardianArt({ layout: 'wide', icons: 'unicode', art: 'none' });
  assert.deepEqual(none.rows, []);
  const text = buildLandingGuardianArt({ layout: 'wide', icons: 'unicode', art: 'text' });
  assert.deepEqual(text.rows, []);
  const arcade = buildLandingGuardianArt({ layout: 'wide', icons: 'unicode', art: 'arcade' });
  assert.ok(arcade.rows.length > 0);
  assert.equal(arcade.resolution.effective, 'arcade');
  assert.equal(arcade.resolution.guardianStyle, 'neon');
});

test('landing wires arcade guardian and section icons; semantic hides triad', () => {
  const neon = buildLandingViewModel({
    home: readyHome(),
    columns: 120,
    rows: 36,
    icons: 'unicode',
    art: 'arcade',
    guardianStyle: 'neon',
  });
  assert.equal(neon.art.effective, 'arcade');
  assert.equal(neon.show_guardian, true);
  assert.ok(neon.guardian_lines.some((l) => /CERBERUS/.test(l)));
  assert.equal(neon.composition.show_triad, true);
  assert.match(neon.section_titles.quick_start, /Quick Start/);
  const icon = sectionPixelIcon('quick_start', { art: 'arcade', icons: 'unicode' });
  assert.ok(icon);
  assert.ok(icon.includes('\n'), 'lock v2 section icons are two Braille rows');
  assert.doesNotMatch(icon, /[▶▣◷]/u);
  assert.equal(icon.split('\n').length, 2);

  const semantic = buildLandingViewModel({
    home: readyHome(),
    columns: 120,
    rows: 36,
    icons: 'unicode',
    art: 'arcade',
    guardianStyle: 'semantic',
  });
  assert.equal(semantic.composition.show_triad, false);
  assert.ok(semantic.guardian_lines.some((l) => /VALIDATE/.test(l)));
  assert.equal(semantic.guardian_style, 'semantic');
});

test('default arcade guardian is Neon (Semantic opt-in)', () => {
  const landing = buildLandingViewModel({
    home: readyHome(),
    columns: 120,
    rows: 36,
    icons: 'unicode',
    art: 'arcade',
  });
  assert.equal(landing.guardian_style, 'neon');
  assert.equal(landing.composition.show_triad, true);
  assert.ok(landing.guardian_lines.some((l) => /CERBERUS/.test(l)));
});

test('first-paint pixel renderer performs no I/O (sync pure matrices)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../modules/operator/operator-tui-pixel-art.js'),
    'utf8',
  );
  assert.ok(!/require\(['"]node:fs['"]\)/.test(src));
  assert.ok(!/require\(['"]fs['"]\)/.test(src));
  assert.ok(!/require\(['"]node:child_process['"]\)/.test(src));
  assert.ok(!/require\(['"]node:net['"]\)/.test(src));
  assert.ok(!/fetch\s*\(/.test(src));
  buildLandingGuardianArt({ layout: 'wide', icons: 'unicode', art: 'arcade' });
});

test('checkpoint 120x36: Neon vs Semantic share operational content; fixtures immutable', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const { measureLandingRender } = await import(
    '../../scripts/lib/tui-landing-render-metrics.mjs'
  );
  const base = {
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [], result_code: 'RUNS_EMPTY' },
    contentSurface: 'home',
    selectedNavId: 'launcher',
    columns: 120,
    rows: 36,
    icons: 'unicode',
    truecolor: false,
    art: 'arcade',
  };
  const neonModel = buildShellModel({ ...base, guardianStyle: 'neon' });
  const semanticModel = buildShellModel({ ...base, guardianStyle: 'semantic' });
  const neonOut = renderOperatorTuiShellToString(neonModel, { columns: 120, rows: 36 });
  const semanticOut = renderOperatorTuiShellToString(semanticModel, { columns: 120, rows: 36 });

  for (const [label, out] of [['neon', neonOut], ['semantic', semanticOut]]) {
    assert.match(out, /Start New Run/, label);
    assert.match(out, /Overall:/, label);
    assert.match(out, /System Readiness/, label);
    assert.match(out, /Recent Runs/, label);
    assert.match(out, /AI-MINIONS/, label);
    assert.ok(!/F1|F2|health bar|99%/.test(out), `${label}: no fabricated chrome`);
    const m = measureLandingRender(out, { columns: 120, rows: 36 });
    assert.ok(m.rendered_lines <= 36, `${label}: rows ${m.rendered_lines} > 36`);
    assert.ok(m.max_display_width <= 120, `${label}: width ${m.max_display_width} > 120`);
    assert.equal(m.fits_viewport, true, `${label}: must fit 120×36`);
  }
  assert.match(neonOut, /Validate • Trace • Enforce|Validate/);
  assert.match(semanticOut, /VALIDATE/);
  assert.match(semanticOut, /TRACE/);
  assert.match(semanticOut, /ENFORCE/);
  assert.ok(
    !/Validate • Trace • Enforce/.test(semanticOut)
      || (semanticOut.match(/VALIDATE/g) || []).length >= 1,
  );

  const neonPath = path.join(CHECKPOINT_DIR, 'neon-120x36.txt');
  const semanticPath = path.join(CHECKPOINT_DIR, 'semantic-guardians-120x36.txt');
  assert.ok(fs.existsSync(neonPath), 'neon checkpoint fixture missing — run regenerate-pixel-art-checkpoints.js');
  assert.ok(fs.existsSync(semanticPath), 'semantic checkpoint fixture missing — run regenerate-pixel-art-checkpoints.js');
  assert.equal(neonOut, fs.readFileSync(neonPath, 'utf8'));
  assert.equal(semanticOut, fs.readFileSync(semanticPath, 'utf8'));
});

test('production Ink renderer: semantic/neon fit 120×36, 80×24, 50×16 without wrap overflow', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const { measureLandingRender } = await import(
    '../../scripts/lib/tui-landing-render-metrics.mjs'
  );
  const base = {
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [], result_code: 'RUNS_EMPTY' },
    contentSurface: 'home',
    selectedNavId: 'launcher',
    icons: 'unicode',
    truecolor: false,
    art: 'arcade',
  };
  for (const [columns, rows] of [[120, 36], [80, 24], [50, 16]]) {
    for (const guardianStyle of ['neon', 'semantic']) {
      const model = buildShellModel({ ...base, columns, rows, guardianStyle });
      const out = renderOperatorTuiShellToString(model, { columns, rows });
      const m = measureLandingRender(out, { columns, rows });
      const id = `${guardianStyle}@${columns}x${rows}`;
      assert.ok(
        m.rendered_lines <= rows,
        `${id}: rows ${m.rendered_lines} > ${rows} (reject overflow)`,
      );
      assert.ok(
        m.max_display_width <= columns,
        `${id}: width ${m.max_display_width} > ${columns} (reject wrap)`,
      );
      assert.equal(m.fits_viewport, true, `${id}: fits_viewport`);
      assert.match(out, /Start New Run/, id);
      assert.match(out, /Overall:/, id);
      if (columns >= 80 && rows >= 24 && guardianStyle === 'semantic') {
        assert.ok(
          model.landing.guardian_rows.length > 0,
          `${id}: lock v2 compact/wide guardian required`,
        );
        assert.match(out, /VALIDATE/, id);
      }
      if (columns < 80 || rows < 24) {
        assert.equal(model.landing.guardian_rows.length, 0, `${id}: minimal hides art`);
      }
    }
  }
});

test('env ART_ENV / GUARDIAN_STYLE_ENV honored', () => {
  const env = { [ART_ENV]: 'none', [GUARDIAN_STYLE_ENV]: 'semantic' };
  const r = resolveArtMode({}, env);
  assert.equal(r.effective, 'none');
  assert.equal(r.guardianStyle, 'semantic');
  assert.equal(sectionTitleWithPixelIcon('Quick Start', 'quick_start', { env }), 'Quick Start');
});

test('invalid ART reason persists in debug across shellModelToOptions remount', () => {
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [], result_code: 'RUNS_EMPTY' },
    contentSurface: 'home',
    selectedNavId: 'launcher',
    columns: 120,
    rows: 36,
    icons: 'unicode',
    art: 'sixel',
  });
  assert.match(String(model.landing.art.reason), /invalid_art_mode:sixel/);
  const debug = formatShellText(model);
  assert.match(debug, /art_reason=invalid_art_mode:sixel/);
  assert.match(String(formatArtResolutionDebug(model.landing.art)), /invalid_art_mode:sixel/);

  const remountOpts = shellModelToOptions(model);
  assert.equal(remountOpts.art, 'sixel');
  const remounted = buildShellModel({
    ...remountOpts,
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [], result_code: 'RUNS_EMPTY' },
  });
  assert.match(String(remounted.landing.art.reason), /invalid_art_mode:sixel/);
  assert.match(formatShellText(remounted), /art_reason=invalid_art_mode:sixel/);
});
