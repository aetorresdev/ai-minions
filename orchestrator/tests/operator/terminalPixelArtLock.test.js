'use strict';

/**
 * Semantic Guardians terminal lock v2 — matrix + fixture validation.
 * Fixture regeneration is a separate script; this file never writes fixtures.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const lock = require('../../modules/operator/assets/semantic-guardians-matrix.json');
const {
  MATRIX_COLORS,
  blockRows,
  brailleRows,
  buildLandingCanvas,
  guardianRows,
} = require('../../modules/operator/terminal-pixel-art');

const FIXTURES = path.join(__dirname, '../fixtures/tui/terminal-pixel-art');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('matrix variants are dimensionally valid and hash-locked', () => {
  for (const variant of Object.values(lock.variants)) {
    assert.equal(variant.rows.length, variant.dot_height);
    for (const row of variant.rows) {
      assert.equal(row.length, variant.dot_width);
      assert.match(row, /^[.CBVMA]+$/);
    }
    assert.equal(
      sha256(Buffer.from(variant.rows.join('\n'), 'utf8')),
      variant.matrix_sha256,
    );
  }
});

test('primary art uses only one-column Unicode Braille cells', () => {
  for (const variantName of ['showcase', 'wide', 'compact']) {
    const variant = lock.variants[variantName];
    const rows = brailleRows(variantName);
    assert.equal(rows.length, variant.terminal_rows);
    rows.forEach((row) => {
      assert.equal(row.length, variant.terminal_columns);
      row.forEach(({ char }) => {
        assert.ok(
          char === ' '
            || (char.codePointAt(0) >= 0x2800 && char.codePointAt(0) <= 0x28ff),
        );
      });
    });
  }
});

test('block fallback uses only block elements and spaces', () => {
  const chars = blockRows('wide')
    .flat()
    .map(({ char }) => char)
    .join('');
  assert.match(chars, /^[ █▀▄]+$/);
  assert.doesNotMatch(chars, /[\u2800-\u28ff]/u);
});

test('semantic colors and labels survive the wide render', () => {
  const canvas = buildLandingCanvas({ columns: 120, rows: 36 });
  const plain = canvas.plainLines().join('\n');
  assert.match(plain, /VALIDATE/);
  assert.match(plain, /TRACE/);
  assert.match(plain, /ENFORCE/);
  const colors = new Set(
    canvas.model().rows.flat().map((span) => span.fg).filter(Boolean),
  );
  assert.ok(colors.has(MATRIX_COLORS.C));
  assert.ok(colors.has(MATRIX_COLORS.V));
  assert.ok(colors.has(MATRIX_COLORS.A));
});

test('all acceptance viewports preserve exact geometry and critical content', () => {
  for (const [columns, rows] of [
    [144, 40],
    [120, 36],
    [80, 24],
    [50, 16],
  ]) {
    const canvas = buildLandingCanvas({ columns, rows });
    const lines = canvas.plainLines();
    assert.equal(lines.length, rows);
    lines.forEach((line) => assert.equal([...line].length, columns));
    const plain = lines.join('\n');
    assert.match(plain, /Start New Run/);
    assert.match(plain, /Overall[: ]+READY/);
  }
});

test('minimal viewport hides art while preserving CTA and readiness', () => {
  const plain = buildLandingCanvas({ columns: 50, rows: 16 })
    .plainLines()
    .join('\n');
  assert.doesNotMatch(plain, /[\u2800-\u28ff]/u);
  assert.match(plain, /> 1\. Start New Run/);
  assert.match(plain, /Overall: READY/);
});

test('public mode names map deterministically', () => {
  assert.deepEqual(guardianRows('wide', 'auto'), guardianRows('wide', 'braille'));
  assert.deepEqual(
    guardianRows('wide', 'arcade'),
    guardianRows('wide', 'braille'),
  );
  assert.equal(guardianRows('wide', 'none').length, 0);
  assert.ok(guardianRows('wide', 'text').length > 0);
});

test('renderer emits no image-protocol or private-use glyph dependency', () => {
  const output = buildLandingCanvas({ columns: 120, rows: 36 })
    .ansiLines()
    .join('\n');
  assert.doesNotMatch(output, /\u001b_G/);
  assert.doesNotMatch(output, /\u001bPq/);
  assert.doesNotMatch(output, /[\ue000-\uf8ff]/u);
});

test('versioned fixtures match; validation never rewrites them', () => {
  for (const [columns, rows] of [
    [144, 40],
    [120, 36],
    [80, 24],
    [50, 16],
  ]) {
    const expected = fs.readFileSync(
      path.join(FIXTURES, `landing-${columns}x${rows}.txt`),
      'utf8',
    );
    const actual = `${buildLandingCanvas({ columns, rows })
      .plainLines()
      .join('\n')}\n`;
    assert.equal(actual, expected);
  }
});
