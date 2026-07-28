'use strict';

/**
 * Pure SelectInput-style controller for native Ink workflows.
 * Presentation-only cursor/option state — no operator execution logic.
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   disabled?: boolean,
 *   note?: string | null,
 *   reason_code?: string | null,
 * }} SelectOption
 *
 * @typedef {{
 *   options: SelectOption[],
 *   cursorIndex: number,
 *   allowCancel: boolean,
 * }} SelectState
 */

/**
 * @param {SelectOption[]} options
 * @param {{ cursorIndex?: number, allowCancel?: boolean }} [opts]
 * @returns {SelectState}
 */
function createSelectState(options, opts = {}) {
  const list = Array.isArray(options) ? options.map((o) => ({
    id: String(o.id),
    label: String(o.label ?? o.id),
    disabled: o.disabled === true,
    note: o.note == null ? null : String(o.note),
    reason_code: o.reason_code == null ? null : String(o.reason_code),
  })) : [];
  const max = Math.max(list.length - 1, 0);
  const cursorIndex = Number.isInteger(opts.cursorIndex) && opts.cursorIndex >= 0
    ? Math.min(opts.cursorIndex, max)
    : 0;
  return {
    options: list,
    cursorIndex: list.length ? cursorIndex : 0,
    allowCancel: opts.allowCancel !== false,
  };
}

/**
 * @param {SelectState} state
 * @param {'next'|'prev'} direction
 * @returns {SelectState}
 */
function moveSelectCursor(state, direction) {
  const options = state.options ?? [];
  if (!options.length) return state;
  const len = options.length;
  const idx = Number.isInteger(state.cursorIndex) ? state.cursorIndex : 0;
  const next = direction === 'prev'
    ? (idx <= 0 ? len - 1 : idx - 1)
    : (idx + 1) % len;
  return { ...state, cursorIndex: next };
}

/**
 * @param {SelectState} state
 * @returns {SelectOption | null}
 */
function currentSelectOption(state) {
  const options = state.options ?? [];
  if (!options.length) return null;
  const idx = Math.min(Math.max(state.cursorIndex ?? 0, 0), options.length - 1);
  return options[idx] ?? null;
}

/**
 * Resolve ↑/↓ / j/k / Enter / Esc against a select list.
 * @param {string} input
 * @param {{
 *   return?: boolean,
 *   escape?: boolean,
 *   upArrow?: boolean,
 *   downArrow?: boolean,
 *   ctrl?: boolean,
 *   meta?: boolean,
 * }} key
 * @param {SelectState} state
 * @returns {{
 *   type: 'move'|'confirm'|'cancel'|'disabled'|'ignore',
 *   direction?: 'next'|'prev',
 *   option?: SelectOption | null,
 *   state?: SelectState,
 * }}
 */
function resolveSelectKeypress(input, key = {}, state) {
  const keyObj = key && typeof key === 'object' ? key : {};
  const isReturn = Boolean(keyObj.return) || input === '\r' || input === '\n';

  if (keyObj.escape || input === '\u001b') {
    return { type: 'cancel' };
  }

  if (keyObj.upArrow || input === 'k') {
    const next = moveSelectCursor(state, 'prev');
    return { type: 'move', direction: 'prev', state: next };
  }
  if (keyObj.downArrow || input === 'j') {
    const next = moveSelectCursor(state, 'next');
    return { type: 'move', direction: 'next', state: next };
  }

  if (isReturn) {
    const option = currentSelectOption(state);
    if (!option) return { type: 'ignore' };
    if (option.disabled) {
      return { type: 'disabled', option, state };
    }
    return { type: 'confirm', option, state };
  }

  // Typed accelerator: first char of option id or 1-based index.
  if (input && !keyObj.ctrl && !keyObj.meta && input.length === 1) {
    const token = String(input).toLowerCase();
    if (state.allowCancel && (token === 'c' || token === 'q')) {
      return { type: 'cancel' };
    }
    if (/^\d$/.test(token)) {
      const index = Number(token) - 1;
      if (index >= 0 && index < state.options.length) {
        const option = state.options[index];
        if (option.disabled) return { type: 'disabled', option, state };
        return {
          type: 'confirm',
          option,
          state: { ...state, cursorIndex: index },
        };
      }
    }
  }

  return { type: 'ignore' };
}

/**
 * Render lines for a select list (Ink content / tests).
 * @param {SelectState} state
 * @param {{ title?: string, hint?: string }} [opts]
 * @returns {string[]}
 */
function formatSelectLines(state, opts = {}) {
  const lines = [];
  if (opts.title) lines.push(String(opts.title));
  const options = state.options ?? [];
  if (!options.length) {
    lines.push('(no choices)');
  } else {
    options.forEach((opt, index) => {
      const marker = index === state.cursorIndex ? '>' : ' ';
      const disabled = opt.disabled ? ' (disabled)' : '';
      lines.push(`${marker} ${index + 1}. ${opt.label}${disabled}`);
      if (opt.note) lines.push(`       ${opt.note}`);
      if (opt.disabled && opt.reason_code) {
        lines.push(`       reason_code: ${opt.reason_code}`);
      }
    });
  }
  lines.push(opts.hint ?? '↑/↓ move · Enter confirm · Esc cancel');
  return lines;
}

module.exports = {
  createSelectState,
  moveSelectCursor,
  currentSelectOption,
  resolveSelectKeypress,
  formatSelectLines,
};
