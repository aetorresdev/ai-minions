'use strict';

/**
 * TUI slash-command vocabulary — parse + dispatch adapters only.
 * Business logic stays in existing operator modules (status/explain/runs/attach/launcher/doctor).
 * Reserved names are honest stubs until a product contract exists.
 */

const IMPLEMENTED_COMMANDS = Object.freeze([
  Object.freeze({
    name: 'help',
    description: 'List implemented slash commands',
    requires_run: false,
    action_id: null,
  }),
  Object.freeze({
    name: 'runs',
    description: 'List recent runs (same as ai-minions runs)',
    requires_run: false,
    action_id: 'runs',
  }),
  Object.freeze({
    name: 'status',
    description: 'Selected-run phase/outcome + compact loop status',
    requires_run: true,
    action_id: 'status',
  }),
  Object.freeze({
    name: 'explain',
    description: 'Reason codes, blocker, stop reason, next safe action',
    requires_run: true,
    action_id: 'explain',
  }),
  Object.freeze({
    name: 'attach',
    description: 'Build attach/evidence bundle for selected run',
    requires_run: true,
    action_id: 'attach',
  }),
  Object.freeze({
    name: 'doctor',
    description: 'Config / credentials readiness pane (doctor)',
    requires_run: false,
    action_id: 'config',
  }),
  Object.freeze({
    name: 'new',
    description: 'Guided execution launcher (reproducible preview)',
    requires_run: false,
    action_id: 'launcher',
  }),
  Object.freeze({
    name: 'quit',
    description: 'Leave the TUI (terminal restore; no run mutation)',
    requires_run: false,
    action_id: 'quit',
  }),
]);

/** Reserved until a backing product contract exists — do not advertise in /help. */
const RESERVED_COMMANDS = Object.freeze([
  Object.freeze({
    name: 'goal',
    note: 'No governed in-TUI goal mutation contract yet. Use /new for guided launch.',
  }),
  Object.freeze({
    name: 'limits',
    note: 'Budget/limit mutation is not exposed as a slash command.',
  }),
  Object.freeze({
    name: 'loop',
    note: 'Loop Contract is not implemented as a slash command. Inspect with /status or /explain.',
  }),
  Object.freeze({
    name: 'schedule',
    note: 'Scheduling is not implemented. No silent mapping to other commands.',
  }),
  Object.freeze({
    name: 'resume',
    note: 'Durable resume is not implemented. Use status/explain/attach for inspection.',
  }),
  Object.freeze({
    name: 'rerun',
    note: 'Rerun is not implemented. Use /new for a new guided launch.',
  }),
]);

const IMPLEMENTED_BY_NAME = Object.freeze(
  Object.fromEntries(IMPLEMENTED_COMMANDS.map((c) => [c.name, c])),
);
const RESERVED_BY_NAME = Object.freeze(
  Object.fromEntries(RESERVED_COMMANDS.map((c) => [c.name, c])),
);

/**
 * @param {string} raw
 * @returns {{
 *   kind: 'not_slash' | 'empty' | 'implemented' | 'reserved' | 'unknown',
 *   name: string | null,
 *   args: string[],
 *   command: object | null,
 *   raw: string,
 * }}
 */
function parseSlashCommand(raw) {
  const text = String(raw ?? '').trim();
  if (!text.startsWith('/')) {
    return {
      kind: 'not_slash',
      name: null,
      args: [],
      command: null,
      raw: text,
    };
  }
  const body = text.slice(1).trim();
  if (!body) {
    return {
      kind: 'empty',
      name: null,
      args: [],
      command: null,
      raw: text,
    };
  }
  const parts = body.split(/\s+/).filter(Boolean);
  const name = String(parts[0] ?? '').toLowerCase();
  const args = parts.slice(1);
  if (IMPLEMENTED_BY_NAME[name]) {
    return {
      kind: 'implemented',
      name,
      args,
      command: IMPLEMENTED_BY_NAME[name],
      raw: text,
    };
  }
  if (RESERVED_BY_NAME[name]) {
    return {
      kind: 'reserved',
      name,
      args,
      command: RESERVED_BY_NAME[name],
      raw: text,
    };
  }
  return {
    kind: 'unknown',
    name,
    args,
    command: null,
    raw: text,
  };
}

/**
 * @returns {string}
 */
function formatSlashHelpText() {
  const lines = [
    'ai-minions slash commands (TUI)',
    'Implemented only — reserved names are not listed here.',
    '',
  ];
  for (const cmd of IMPLEMENTED_COMMANDS) {
    const runHint = cmd.requires_run ? ' (needs selected run or /cmd <run-id>)' : '';
    lines.push(`  /${cmd.name.padEnd(10)} ${cmd.description}${runHint}`);
  }
  lines.push('');
  lines.push('Select a run: content focus ↑/↓ then Enter, nav "select", or pass --run-id style arg:');
  lines.push('  /status <run-id>   /explain <run-id>   /attach <run-id>');
  lines.push('Unknown or reserved commands do not mutate state.');
  return lines.join('\n');
}

/**
 * @param {string} name
 * @returns {string}
 */
function formatReservedSlashText(name) {
  const entry = RESERVED_BY_NAME[String(name).toLowerCase()];
  const note = entry?.note
    ?? 'Reserved until a product contract exists. Not implemented.';
  return [
    `ai-minions /${name}`,
    `  status:       reserved (not implemented)`,
    `  reason_code:  TUI_SLASH_RESERVED`,
    `  note:         ${note}`,
    '  next_safe_action: /help',
  ].join('\n');
}

/**
 * @param {string} name
 * @returns {string}
 */
function formatUnknownSlashText(name) {
  const shown = name ? `/${name}` : '/';
  return [
    `ai-minions ${shown}`,
    '  status:       unknown command',
    '  reason_code:  TUI_SLASH_UNKNOWN',
    '  note:         Not mapped to another command. State unchanged.',
    '  next_safe_action: /help',
  ].join('\n');
}

/**
 * @param {string} name
 * @returns {string}
 */
function formatSlashRunRequiredText(name) {
  return [
    `ai-minions /${name}`,
    '  status:       selected run required',
    '  reason_code:  TUI_SLASH_RUN_ID_REQUIRED',
    '  note:         Select a run (content ↑/↓ + Enter, or nav select), or pass /' + name + ' <run-id>.',
    '  next_safe_action: /runs then /' + name + ' <run-id>',
  ].join('\n');
}

/**
 * @returns {string}
 */
function formatEmptySlashText() {
  return [
    'ai-minions /',
    '  status:       empty command',
    '  reason_code:  TUI_SLASH_EMPTY',
    '  next_safe_action: /help',
  ].join('\n');
}

/**
 * Resolve an implemented slash command into a shell action dispatch plan.
 * Does not execute operator modules — adapters only.
 *
 * @param {{
 *   kind: string,
 *   name: string | null,
 *   args: string[],
 *   command: object | null,
 * }} parsed
 * @param {{ selectedRunId?: string | null }} [ctx]
 * @returns {{
 *   disposition: 'help' | 'message' | 'dispatch' | 'ignore',
 *   action_id?: string,
 *   run_id?: string | null,
 *   skip_run_prompt?: boolean,
 *   text?: string,
 *   reason_code?: string,
 *   ok?: boolean,
 *   exitCode?: number,
 *   next_safe_action?: string,
 * }}
 */
function resolveSlashDispatch(parsed, ctx = {}) {
  if (!parsed || parsed.kind === 'not_slash') {
    return { disposition: 'ignore' };
  }
  if (parsed.kind === 'empty') {
    return {
      disposition: 'message',
      text: formatEmptySlashText(),
      reason_code: 'TUI_SLASH_EMPTY',
      ok: false,
      exitCode: 1,
      next_safe_action: '/help',
    };
  }
  if (parsed.kind === 'reserved') {
    return {
      disposition: 'message',
      text: formatReservedSlashText(parsed.name),
      reason_code: 'TUI_SLASH_RESERVED',
      ok: false,
      exitCode: 1,
      next_safe_action: '/help',
    };
  }
  if (parsed.kind === 'unknown') {
    return {
      disposition: 'message',
      text: formatUnknownSlashText(parsed.name),
      reason_code: 'TUI_SLASH_UNKNOWN',
      ok: false,
      exitCode: 1,
      next_safe_action: '/help',
    };
  }

  const cmd = parsed.command;
  if (!cmd) {
    return {
      disposition: 'message',
      text: formatUnknownSlashText(parsed.name),
      reason_code: 'TUI_SLASH_UNKNOWN',
      ok: false,
      exitCode: 1,
      next_safe_action: '/help',
    };
  }

  if (cmd.name === 'help' || cmd.action_id == null) {
    return {
      disposition: 'help',
      text: formatSlashHelpText(),
      reason_code: 'TUI_SLASH_HELP',
      ok: true,
      exitCode: 0,
      next_safe_action: null,
    };
  }

  const argRunId = parsed.args[0] ? String(parsed.args[0]).trim() : '';
  const selected = ctx.selectedRunId == null || ctx.selectedRunId === ''
    ? null
    : String(ctx.selectedRunId);
  const runId = argRunId || selected;

  if (cmd.requires_run && !runId) {
    return {
      disposition: 'message',
      text: formatSlashRunRequiredText(cmd.name),
      reason_code: 'TUI_SLASH_RUN_ID_REQUIRED',
      ok: false,
      exitCode: 1,
      next_safe_action: `/runs then /${cmd.name} <run-id>`,
    };
  }

  return {
    disposition: 'dispatch',
    action_id: cmd.action_id,
    run_id: cmd.requires_run ? runId : selected,
    skip_run_prompt: cmd.requires_run === true,
  };
}

module.exports = {
  IMPLEMENTED_COMMANDS,
  RESERVED_COMMANDS,
  parseSlashCommand,
  resolveSlashDispatch,
  formatSlashHelpText,
  formatReservedSlashText,
  formatUnknownSlashText,
  formatSlashRunRequiredText,
  formatEmptySlashText,
};
