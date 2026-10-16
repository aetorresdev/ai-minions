/**
 * Sudoku solution check for the canonical Sudoku fixture artifact.
 *
 * Source-text and load-time checks cannot tell a correct Sudoku from a wrong one. The fixture prompt
 * therefore asks the artifact to embed its startup puzzle and full solution in a JSON block:
 *
 *   <script type="application/json" id="sudoku-solution">{"puzzle": "...", "solution": "..."}</script>
 *
 * This module parses both grids and fails on: a missing, duplicated or unparsable block; a grid that is
 * not 9x9 or holds characters other than digits (puzzle: 0 or "." for empty); an incomplete solution;
 * an empty puzzle; any row, column or 3x3 box that is not exactly the digits 1-9; and any puzzle
 * given that the solution changes or leaves blank. It does not execute the page and does not solve
 * the puzzle itself.
 */

export const SUDOKU_SOLUTION_BLOCK_ID = "sudoku-solution";

/** Stable error codes, one per failure class. */
export const SUDOKU_CHECK_CODES = Object.freeze({
  BLOCK_MISSING: "solution_block_missing",
  BLOCK_DUPLICATE: "solution_block_duplicate",
  BLOCK_INVALID_JSON: "solution_block_invalid_json",
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

/**
 * Bodies of every `<script ... id="sudoku-solution" ...>` block.
 * @param {string} htmlText
 * @returns {string[]}
 */
export function extractSolutionBlocks(htmlText) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(String(htmlText))) !== null) {
    if (/\bid\s*=\s*["']?sudoku-solution["'\s>]/i.test(`${m[1]}>`)) out.push(m[2]);
  }
  return out;
}

/**
 * Normalize a grid to 81 cells, 0 meaning empty.
 * Accepts an 81-character string (whitespace ignored; "0" or "." for empty), a flat array of 81
 * cells, or 9 rows of 9 cells. Cells may be integers 0-9, single-digit strings, "." or "".
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
    else if (v === "." || v === "") n = 0;
    else return { ok: false, error: `cell ${cellName(i)} is not a digit (${JSON.stringify(v)})` };
    cells.push(n);
  }
  return { ok: true, cells };
}

/** @param {number} i */
function cellName(i) {
  return `r${Math.floor(i / 9) + 1}c${(i % 9) + 1}`;
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

/**
 * Locate the embedded solution block in an artifact and validate it.
 * @param {string} htmlText
 * @returns {{ ok: boolean, errors: { code: string, message: string }[] }}
 */
export function checkSudokuArtifactSolution(htmlText) {
  const blocks = extractSolutionBlocks(htmlText);
  if (blocks.length === 0) {
    return {
      ok: false,
      errors: [{
        code: SUDOKU_CHECK_CODES.BLOCK_MISSING,
        message: `no <script type="application/json" id="${SUDOKU_SOLUTION_BLOCK_ID}"> block`,
      }],
    };
  }
  if (blocks.length > 1) {
    return {
      ok: false,
      errors: [{ code: SUDOKU_CHECK_CODES.BLOCK_DUPLICATE, message: `${blocks.length} solution blocks; expected exactly one` }],
    };
  }
  let data;
  try {
    data = JSON.parse(blocks[0]);
  } catch (err) {
    return {
      ok: false,
      errors: [{
        code: SUDOKU_CHECK_CODES.BLOCK_INVALID_JSON,
        message: `solution block is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
      }],
    };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      errors: [{ code: SUDOKU_CHECK_CODES.MALFORMED_GRID, message: "solution block must be an object with puzzle and solution" }],
    };
  }
  return validateSudokuSolution(data.puzzle, data.solution);
}
