/**
 * Sudoku solution check for the canonical Sudoku fixture artifact.
 *
 * Source-text and load-time checks cannot tell a correct Sudoku from a wrong one. Sudoku apps usually
 * ship their puzzles and solutions as literals in the inline script, so this module reads them
 * statically (nothing is executed) and validates every pair:
 *
 * - Grid literals are quoted strings of about 81 digits ("0" or "." for empty) and array literals of
 *   9 rows of 9 cells or 81 flat cells, including an array of such grids.
 * - Each grid is a puzzle or a solution, taken from the nearest preceding name (`puzzle:`,
 *   `const SOLUTIONS =`, ...). A grid with no name of its own inherits the role of the grid before it
 *   (the next element of the same array). Unknown names fall back to content: blanks mean puzzle.
 * - Puzzles and solutions are paired by order, so both `[{ puzzle, solution }, ...]` and parallel
 *   `PUZZLES` / `SOLUTIONS` arrays work.
 *
 * Each pair fails on a malformed or incomplete grid, an empty puzzle, any row, column or 3x3 box that
 * is not exactly the digits 1-9, and any puzzle given that the solution changes or leaves blank.
 * Artifacts with no puzzle/solution literals, or counts that cannot be paired, fail with
 * `puzzle_data_unparseable`. Apps that only generate puzzles at runtime therefore fail closed.
 */

import { extractInlineScripts } from "./fixture-script-execution.mjs";

/** Stable error codes, one per failure class. */
export const SUDOKU_CHECK_CODES = Object.freeze({
  PUZZLE_DATA_UNPARSEABLE: "puzzle_data_unparseable",
  MALFORMED_GRID: "malformed_grid",
  INCOMPLETE_GRID: "incomplete_grid",
  EMPTY_PUZZLE: "empty_puzzle",
  ROW_INVALID: "row_invalid",
  COLUMN_INVALID: "column_invalid",
  BOX_INVALID: "box_invalid",
  GIVEN_CHANGED: "given_changed",
  GIVEN_MISSING: "given_missing",
});

const CELLS = 81;
/** Literals this far from 81 cells are not treated as grids at all. */
const MIN_CANDIDATE_CELLS = 64;
const MAX_CANDIDATE_CELLS = 100;
const SOLUTION_NAME = /solut|solved|answer|complete/i;
const PUZZLE_NAME = /puzz|given|clue|start|initial|board|grid|problem|cells/i;

/** @param {number} i */
function cellName(i) {
  return `r${Math.floor(i / 9) + 1}c${(i % 9) + 1}`;
}

/**
 * Normalize a grid to 81 cells, 0 meaning empty.
 * Accepts an 81-character string (whitespace ignored; "0" or "." for empty), a flat array of 81
 * cells, or 9 rows of 9 cells. Cells may be integers 0-9, single-digit strings, ".", "" or null.
 * @param {unknown} raw
 * @returns {{ ok: true, cells: number[] } | { ok: false, error: string }}
 */
export function normalizeGrid(raw) {
  /** @type {unknown[]} */
  let flat;
  if (typeof raw === "string") {
    flat = raw.replace(/\s+/g, "").split("");
  } else if (Array.isArray(raw)) {
    if (raw.length === 9 && raw.every((row) => Array.isArray(row))) {
      if (!raw.every((row) => row.length === 9)) return { ok: false, error: "rows must each have 9 cells" };
      flat = raw.flat();
    } else {
      flat = raw;
    }
  } else {
    return { ok: false, error: `expected a string or array, got ${raw === null ? "null" : typeof raw}` };
  }
  if (flat.length !== CELLS) return { ok: false, error: `expected ${CELLS} cells, got ${flat.length}` };
  /** @type {number[]} */
  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const v = flat[i];
    let n;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 9) n = v;
    else if (typeof v === "string" && /^[0-9]$/.test(v)) n = Number(v);
    else if (v === "." || v === "" || v === null) n = 0;
    else return { ok: false, error: `cell ${cellName(i)} is not a digit (${JSON.stringify(v)})` };
    cells.push(n);
  }
  return { ok: true, cells };
}

/** @param {number[]} values */
function isExactlyOneToNine(values) {
  return values.length === 9 && [...values].sort((a, b) => a - b).join("") === "123456789";
}

/**
 * @param {unknown} puzzleRaw
 * @param {unknown} solutionRaw
 * @returns {{ ok: boolean, errors: { code: string, message: string }[] }}
 */
export function validateSudokuSolution(puzzleRaw, solutionRaw) {
  /** @type {{ code: string, message: string }[]} */
  const errors = [];
  const add = (code, message) => errors.push({ code, message });

  const isEmptyRaw = (r) => (typeof r === "string" && r.trim() === "") || (Array.isArray(r) && r.length === 0);
  if (isEmptyRaw(puzzleRaw) || isEmptyRaw(solutionRaw)) {
    if (isEmptyRaw(puzzleRaw)) add(SUDOKU_CHECK_CODES.EMPTY_PUZZLE, "puzzle is empty");
    else if (!normalizeGrid(puzzleRaw).ok) add(SUDOKU_CHECK_CODES.MALFORMED_GRID, `puzzle: ${normalizeGrid(puzzleRaw).error}`);
    if (isEmptyRaw(solutionRaw)) add(SUDOKU_CHECK_CODES.INCOMPLETE_GRID, "solution is empty");
    else if (!normalizeGrid(solutionRaw).ok) add(SUDOKU_CHECK_CODES.MALFORMED_GRID, `solution: ${normalizeGrid(solutionRaw).error}`);
    return { ok: false, errors };
  }

  const puzzle = normalizeGrid(puzzleRaw);
  const solution = normalizeGrid(solutionRaw);
  if (!puzzle.ok) add(SUDOKU_CHECK_CODES.MALFORMED_GRID, `puzzle: ${puzzle.error}`);
  if (!solution.ok) add(SUDOKU_CHECK_CODES.MALFORMED_GRID, `solution: ${solution.error}`);
  if (!puzzle.ok || !solution.ok) return { ok: false, errors };

  const p = puzzle.cells;
  const s = solution.cells;
  if (p.every((v) => v === 0)) add(SUDOKU_CHECK_CODES.EMPTY_PUZZLE, "puzzle has no givens");

  const blanks = s.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  if (blanks.length) {
    add(
      SUDOKU_CHECK_CODES.INCOMPLETE_GRID,
      `solution has ${blanks.length} empty cell(s), first ${cellName(blanks[0])}`,
    );
  }

  for (let i = 0; i < CELLS; i++) {
    if (p[i] === 0) continue;
    if (s[i] === 0) add(SUDOKU_CHECK_CODES.GIVEN_MISSING, `given ${p[i]} at ${cellName(i)} is blank in the solution`);
    else if (s[i] !== p[i]) {
      add(SUDOKU_CHECK_CODES.GIVEN_CHANGED, `given ${p[i]} at ${cellName(i)} changed to ${s[i]}`);
    }
  }

  // An incomplete solution already fails; group checks would only repeat that finding.
  if (blanks.length) return { ok: false, errors };

  for (let r = 0; r < 9; r++) {
    const row = s.slice(r * 9, r * 9 + 9);
    if (!isExactlyOneToNine(row)) add(SUDOKU_CHECK_CODES.ROW_INVALID, `row ${r + 1} is not exactly 1-9 (${row.join("")})`);
  }
  for (let c = 0; c < 9; c++) {
    const col = [];
    for (let r = 0; r < 9; r++) col.push(s[r * 9 + c]);
    if (!isExactlyOneToNine(col)) add(SUDOKU_CHECK_CODES.COLUMN_INVALID, `column ${c + 1} is not exactly 1-9 (${col.join("")})`);
  }
  for (let b = 0; b < 9; b++) {
    const box = [];
    const r0 = Math.floor(b / 3) * 3;
    const c0 = (b % 3) * 3;
    for (let r = r0; r < r0 + 3; r++) for (let c = c0; c < c0 + 3; c++) box.push(s[r * 9 + c]);
    if (!isExactlyOneToNine(box)) add(SUDOKU_CHECK_CODES.BOX_INVALID, `box ${b + 1} is not exactly 1-9 (${box.join("")})`);
  }

  return { ok: errors.length === 0, errors };
}

/** @param {string} s */
function isGridString(s) {
  const t = s.replace(/\s+/g, "");
  if (t.length < MIN_CANDIDATE_CELLS || t.length > MAX_CANDIDATE_CELLS) return false;
  const digits = (t.match(/[0-9.]/g) ?? []).length;
  // Tolerate a few stray characters so a near-grid is reported as malformed rather than ignored.
  return digits >= t.length - 3 && /[1-9]/.test(t);
}

/** @param {unknown} v */
function isCell(v) {
  return typeof v === "number" || typeof v === "string" || v === null;
}

/** @param {unknown} v */
function isGridArray(v) {
  if (!Array.isArray(v)) return false;
  let count = 0;
  if (v.every(isCell)) count = v.length;
  else if (v.length >= 8 && v.length <= 10 && v.every((row) => Array.isArray(row) && row.every(isCell))) {
    count = v.reduce((n, row) => n + row.length, 0);
  } else return false;
  return count >= MIN_CANDIDATE_CELLS && count <= MAX_CANDIDATE_CELLS;
}

/**
 * Names that mark a literal as puzzle/solution data. A non-empty literal assigned to such a
 * name, or listed inside an array assigned to one, is always validated, whatever its shape:
 * a wrong length or an all-blank grid fails instead of being skipped.
 */
const DATA_NAME = /^(?:[a-z]*_)?(?:puzzles?|solutions?|solved|givens?|clues?|answers?)(?:_?(?:grids?|strings?|str|data|digits|cells|list))?$/i;

/**
 * Replace JavaScript comments with spaces (newlines kept), leaving strings intact, so offsets
 * are preserved and a comment between a name and its value cannot hide the assignment.
 * @param {string} code
 */
export function maskComments(code) {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === "\\" ? 2 : 1;
      out += code.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i);
      const end = nl < 0 ? code.length : nl;
      out += " ".repeat(end - i);
      i = end;
    } else if (c === "/" && code[i + 1] === "*") {
      const close = code.indexOf("*/", i + 2);
      const end = close < 0 ? code.length : close + 2;
      out += code.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out.slice(0, code.length);
}

/**
 * Name directly assigned the literal at `start` (`name: <lit>`, `"name": <lit>`,
 * `name = <lit>`), or null. `runtimeState` is true only for a standalone `let`/`var`
 * declaration or a bare reassignment statement, never for an object property or `const`.
 * Expects comment-masked code.
 * @param {string} code
 * @param {number} start
 * @returns {{ name: string, runtimeState: boolean } | null}
 */
function assignedName(code, start) {
  const before = code.slice(Math.max(0, start - 200), start);
  // A key is a bare identifier or one wrapped in matching quotes ("puzzle": ...).
  const m = /(?:(["'])([A-Za-z_$][\w$]*)\1|([A-Za-z_$][\w$]*))\s*(:|=)\s*$/.exec(before);
  if (!m) return null;
  const name = m[2] ?? m[3];
  const lead = before.slice(0, m.index);
  if (m[4] === ":") {
    // Only an object property; a ternary branch (`cond ? x : ""`) is not an assignment.
    return /(?:^|[{,])\s*$/.test(lead) ? { name, runtimeState: false } : null;
  }
  const prev = before[m.index + m[0].lastIndexOf("=") - 1];
  if (prev && /[=!<>+\-*/%&|^?]/.test(prev)) return null;
  const runtimeState = /(?:^|[;{}\n])\s*(?:(?:let|var)\s+)?$/.test(lead) && !/\bconst\s+$/.test(lead);
  return { name, runtimeState };
}

/**
 * End index (exclusive) of the bracketed literal starting at `start`, skipping strings and
 * comments; -1 when unbalanced.
 * @param {string} code
 * @param {number} start
 */
function arrayEnd(code, start) {
  let depth = 0;
  for (let j = start; j < code.length; j++) {
    const c = code[j];
    if (c === '"' || c === "'" || c === "`") {
      j++;
      while (j < code.length && code[j] !== c) j += code[j] === "\\" ? 2 : 1;
    } else if (c === "/" && code[j + 1] === "/") {
      const nl = code.indexOf("\n", j);
      j = nl < 0 ? code.length : nl;
    } else if (c === "/" && code[j + 1] === "*") {
      const close = code.indexOf("*/", j + 2);
      j = close < 0 ? code.length : close + 1;
    } else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/** @param {string} text */
function parseArrayText(text) {
  try {
    return { ok: true, value: JSON.parse(text.replace(/'/g, '"').replace(/,\s*\]/g, "]")) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/** Plural data names (PUZZLES, solutions, givenList, ...) may hold a list of grids. */
const LIST_NAME = /(?:puzzles|solutions|answers|clues|givens|list)/i;

/**
 * Split the value of a named data array into grids. A singular name (`puzzle`, `solution`)
 * always holds one grid. A plural name holds one grid (flat cells or 9 rows) or a list of
 * grids (strings or arrays). Anything else is returned as one malformed grid so it fails
 * validation instead of disappearing.
 * @param {string} name
 * @param {unknown[]} value
 * @returns {unknown[]}
 */
function namedArrayGrids(name, value) {
  const isShortCell = (v) => isCell(v) && (typeof v !== "string" || v.length <= 1);
  if (!LIST_NAME.test(name) || value.every(isShortCell)) return [value];
  if (value.every((v) => typeof v === "string")) return value;
  if (value.every((v) => Array.isArray(v))) {
    const looksLikeRows = value.length === 9 && value.every((row) => row.every(isShortCell) && row.length < MIN_CANDIDATE_CELLS);
    return looksLikeRows ? [value] : value;
  }
  return [value];
}

/** @param {string} name */
function roleForName(name) {
  return SOLUTION_NAME.test(name) ? "solution" : "puzzle";
}

/**
 * Grid literals in one script, in source order. Comments are skipped. Literals assigned to a
 * puzzle/solution name (or listed in an array assigned to one) carry `role` and are always
 * returned; other literals are returned only when they look like grids.
 * @param {string} code
 * @returns {{ start: number, end: number, value: unknown, role: 'puzzle' | 'solution' | null }[]}
 */
export function scanGridLiterals(source) {
  const code = maskComments(source);
  /** @type {{ start: number, end: number, value: unknown, role: 'puzzle' | 'solution' | null }[]} */
  const out = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i);
      i = nl < 0 ? code.length : nl + 1;
    } else if (c === "/" && code[i + 1] === "*") {
      const close = code.indexOf("*/", i + 2);
      i = close < 0 ? code.length : close + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === "\\" ? 2 : 1;
      const body = code.slice(i + 1, j);
      const assigned = assignedName(code, i);
      const name = assigned?.name;
      if (name && DATA_NAME.test(name) && (body.trim() !== "" || !assigned.runtimeState)) {
        out.push({ start: i, end: j + 1, value: body, role: roleForName(name) });
      } else if (isGridString(body)) {
        out.push({ start: i, end: j + 1, value: body, role: null });
      }
      i = j + 1;
    } else if (c === "[") {
      const end = arrayEnd(code, i);
      if (end < 0) {
        i++;
        continue;
      }
      const text = code.slice(i, end);
      const parsed = parseArrayText(text);
      const assigned = assignedName(code, i);
      const name = assigned?.name;
      if (name && DATA_NAME.test(name)) {
        const role = roleForName(name);
        if (parsed.ok && Array.isArray(parsed.value)) {
          if (parsed.value.length > 0) {
            for (const g of namedArrayGrids(name, parsed.value)) out.push({ start: i, end, value: g, role });
          } else if (!assigned.runtimeState) {
            // `puzzle: []` inside a data entry is an empty grid, not runtime state.
            out.push({ start: i, end, value: [], role });
          }
          i = end;
        } else if (text.includes("{")) {
          // An array of objects: the named fields inside decide.
          i++;
        } else {
          out.push({ start: i, end, value: text, role });
          i = end;
        }
      } else if (parsed.ok && isGridArray(parsed.value)) {
        out.push({ start: i, end, value: parsed.value, role: null });
        i = end;
      } else if (parsed.ok && Array.isArray(parsed.value) && parsed.value.length > 0 && parsed.value.every(isGridArray)) {
        for (const g of parsed.value) out.push({ start: i, end, value: g, role: null });
        i = end;
      } else i++;
    } else i++;
  }
  return out;
}

/** @param {unknown} value */
function hasBlanks(value) {
  const g = normalizeGrid(value);
  return g.ok ? g.cells.includes(0) : true;
}

/**
 * Embedded puzzles and solutions across all inline scripts, in source order.
 * @param {string} htmlText
 * @returns {{ puzzles: unknown[], solutions: unknown[] }}
 */
export function extractEmbeddedPuzzles(htmlText) {
  /** @type {unknown[]} */
  const puzzles = [];
  /** @type {unknown[]} */
  const solutions = [];
  for (const script of extractInlineScripts(htmlText)) {
    const code = maskComments(script);
    /** @type {'puzzle' | 'solution' | null} */
    let role = null;
    let prevEnd = 0;
    for (const lit of scanGridLiterals(code)) {
      if (lit.role !== null) {
        role = lit.role;
        (role === "puzzle" ? puzzles : solutions).push(lit.value);
        prevEnd = lit.end;
        continue;
      }
      const gap = code
        .slice(prevEnd, lit.start)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      const names = [...gap.matchAll(/([A-Za-z_$][\w$]*)["']?\s*[:=](?!=)/g)];
      const name = names.length ? names[names.length - 1][1] : null;
      if (name !== null) {
        if (SOLUTION_NAME.test(name)) role = "solution";
        else if (PUZZLE_NAME.test(name)) role = "puzzle";
        else role = hasBlanks(lit.value) ? "puzzle" : "solution";
      } else if (role === null) {
        role = hasBlanks(lit.value) ? "puzzle" : "solution";
      }
      (role === "puzzle" ? puzzles : solutions).push(lit.value);
      prevEnd = lit.end;
    }
  }
  return { puzzles, solutions };
}

/**
 * Validate every embedded puzzle/solution pair in an artifact.
 * @param {string} htmlText
 * @returns {{
 *   ok: boolean,
 *   errors: { code: string, message: string, puzzle_index: number | null }[],
 *   puzzles: { index: number, ok: boolean, codes: string[] }[],
 * }}
 */
export function checkSudokuArtifactSolution(htmlText) {
  const { puzzles, solutions } = extractEmbeddedPuzzles(htmlText);
  const unparseable = (message) => ({
    ok: false,
    errors: [{ code: SUDOKU_CHECK_CODES.PUZZLE_DATA_UNPARSEABLE, message, puzzle_index: null }],
    puzzles: [],
  });
  if (puzzles.length === 0 && solutions.length === 0) {
    return unparseable("no embedded puzzle/solution grids found in inline scripts");
  }
  if (puzzles.length === 0 || solutions.length === 0 || puzzles.length !== solutions.length) {
    return unparseable(
      `found ${puzzles.length} puzzle(s) and ${solutions.length} solution(s); cannot pair them`,
    );
  }
  /** @type {{ code: string, message: string, puzzle_index: number | null }[]} */
  const errors = [];
  /** @type {{ index: number, ok: boolean, codes: string[] }[]} */
  const results = [];
  puzzles.forEach((puzzle, index) => {
    const r = validateSudokuSolution(puzzle, solutions[index]);
    for (const e of r.errors) errors.push({ ...e, puzzle_index: index });
    results.push({ index, ok: r.ok, codes: [...new Set(r.errors.map((e) => e.code))] });
  });
  return { ok: errors.length === 0, errors, puzzles: results };
}
