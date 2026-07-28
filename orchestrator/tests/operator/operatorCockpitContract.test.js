'use strict';

/**
 * Public operator-cockpit contract ↔ fullscreen task-first key matrix.
 * Prevents documenting legacy readline COCKPIT_ACTIONS as the current Ink shell.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  adaptShellNavigation,
  formatHelpLines,
} = require('../../modules/operator/operator-tui-landing');
const { COCKPIT_ACTIONS } = require('../../modules/operator/operator-cockpit-tui');
const { resolveShellKeypress, buildShellModel } = require('../../modules/operator/operator-tui-shell-model');

const CONTRACT_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'orchestrator',
  'operator-cockpit-contract.md',
);

/** @type {ReadonlyArray<{ key: string, id: string }>} */
const TASK_FIRST_PRIMARY = Object.freeze([
  { key: 'h', id: 'home' },
  { key: '1', id: 'launcher' },
  { key: '2', id: 'runs' },
  { key: '3', id: 'diagnostics' },
  { key: '4', id: 'config' },
  { key: '5', id: 'help' },
]);

/** @type {ReadonlyArray<{ key: string, id: string }>} */
const SELECTED_RUN_CONTEXTUAL = Object.freeze([
  { key: 'o', id: 'status' },
  { key: 'm', id: 'monitor' },
  { key: 'e', id: 'evidence' },
  { key: 'x', id: 'explain' },
]);

test('operator-cockpit-contract documents task-first matrix, not legacy as current', () => {
  const doc = fs.readFileSync(CONTRACT_PATH, 'utf8');

  assert.match(doc, /Keyboard \/ navigation matrix/i);
  assert.match(doc, /Fullscreen task-first navigation/i);
  assert.match(doc, /Selected-run contextual/i);
  assert.match(doc, /Legacy readline cockpit aliases/i);
  assert.match(doc, /rollback|compatibility-only|power-user/i);

  // Task-first digit semantics (current Ink shell)
  assert.match(doc, /`4`[\s\S]*`config`[\s\S]*Settings/);
  assert.match(doc, /`5`\s*\/\s*`\?`[\s\S]*`help`[\s\S]*Help/);
  assert.match(doc, /`3`[\s\S]*`diagnostics`[\s\S]*System Status/);
  assert.match(doc, /`h`[\s\S]*`home`/);

  // Contextual selected-run keys
  for (const { key, id } of SELECTED_RUN_CONTEXTUAL) {
    assert.match(doc, new RegExp(`\`${key}\`[\\s\\S]*\`${id}\``));
  }

  // Must not present legacy select / config=5 as the current fullscreen contract prose
  assert.doesNotMatch(doc, /Cockpit action \*\*`s` \/ select\*\*/);
  assert.doesNotMatch(doc, /Cockpit action \*\*`5` \/ config\*\*/);
  assert.match(doc, /do not document config as key `5` for the Ink shell/i);
  assert.match(doc, /\*\*no\*\* top-level `s` \/ select hotkey/i);

  // Explicit legacy divergence callouts
  assert.match(doc, /Fullscreen `3` is \*\*System Status\*\*/);
  assert.match(doc, /Fullscreen `4` is \*\*Settings\*\*/);
  assert.match(doc, /Fullscreen `5` is \*\*Help\*\*/);
});

test('adaptShellNavigation matches published task-first + contextual matrix', () => {
  const primary = adaptShellNavigation({});
  assert.deepEqual(
    primary.map((n) => ({ key: n.key, id: n.id })),
    [...TASK_FIRST_PRIMARY],
  );
  assert.ok(primary.every((n) => n.id !== 'select'));
  assert.ok(primary.every((n) => n.id !== 'attach'));

  const withRun = adaptShellNavigation({ selectedRunId: 'run-1' });
  assert.deepEqual(
    withRun.map((n) => ({ key: n.key, id: n.id })),
    [...TASK_FIRST_PRIMARY, ...SELECTED_RUN_CONTEXTUAL],
  );
});

test('formatHelpLines lists in-process topics; topic bodies keep key guidance', () => {
  const { helpTopics } = require('../../modules/operator/operator-tui-landing');
  const list = formatHelpLines().join('\n');
  assert.match(list, /Topics \(in-process/);
  assert.match(list, /1\. Navigation goals/);
  assert.match(list, /4\. Icons and display/);
  assert.match(list, /selecting does not exit/i);

  const nav = formatHelpLines({ openTopicId: 'navigation' }).join('\n');
  assert.match(nav, /New Run \(1\)/);
  assert.match(nav, /System Status \(3\)/);
  assert.match(nav, /Settings \(4\)/);
  assert.match(nav, /Help \(5 \/ \?\)/);

  const runCtx = formatHelpLines({ openTopicId: 'run_context' }).join('\n');
  assert.match(runCtx, /Overview \(o\)/);
  assert.match(runCtx, /Monitor \(m\)/);
  assert.match(runCtx, /Evidence \(e\)/);
  assert.match(runCtx, /Explain \(x\)/);

  const keys = formatHelpLines({ openTopicId: 'keys' }).join('\n');
  assert.match(keys, /AI_MINIONS_TUI_LEGACY=1/);
  assert.match(keys, /Top-level s is ignored/i);

  assert.equal(helpTopics().length, 5);
});

test('fullscreen hotkeys disagree with legacy COCKPIT_ACTIONS on 3/4/5/s', () => {
  const legacyByKey = Object.fromEntries(COCKPIT_ACTIONS.map((a) => [a.key, a.id]));
  assert.equal(legacyByKey['3'], 'status');
  assert.equal(legacyByKey['4'], 'attach');
  assert.equal(legacyByKey['5'], 'config');
  assert.equal(legacyByKey.s, 'select');

  const shellByKey = Object.fromEntries(
    adaptShellNavigation({ selectedRunId: 'r1' }).map((a) => [a.key, a.id]),
  );
  assert.equal(shellByKey['3'], 'diagnostics');
  assert.equal(shellByKey['4'], 'config');
  assert.equal(shellByKey['5'], 'help');
  assert.equal(shellByKey.s, undefined);

  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [{ run_id: 'r1', status: 'running' }] },
    selectedRunId: 'r1',
    focus: 'nav',
  });
  assert.equal(resolveShellKeypress('3', {}, model).actionId, 'diagnostics');
  assert.equal(resolveShellKeypress('4', {}, model).actionId, 'config');
  assert.equal(resolveShellKeypress('5', {}, model).actionId, 'help');
  assert.equal(resolveShellKeypress('s', {}, model).type, 'ignore');
  assert.equal(resolveShellKeypress('?', {}, model).actionId, 'help');
});
