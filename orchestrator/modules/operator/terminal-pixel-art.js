"use strict";

const matrixLock = require("./assets/semantic-guardians-matrix.json");

const TOKENS = {
  frame: "#334765",
  text: "#DDE4F0",
  dim: "#8997AD",
  cyan: "#2CDAF4",
  blue: "#3057E1",
  violet: "#B35CFF",
  magenta: "#FF4BBA",
  amber: "#FFB230",
  green: "#43D17E",
  yellow: "#F1D85A",
  red: "#FF5A68",
};

const MATRIX_COLORS = Object.fromEntries(
  Object.entries(matrixLock.encoding.palette).map(([token, value]) => [
    token,
    value.hex,
  ]),
);

const BRAILLE_DOTS = [
  [0, 0, 0],
  [0, 1, 1],
  [0, 2, 2],
  [0, 3, 6],
  [1, 0, 3],
  [1, 1, 4],
  [1, 2, 5],
  [1, 3, 7],
];

const WORDMARK_3X5 = {
  A: ["010", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  "-": ["000", "000", "111", "000", "000"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  N: ["1001", "1101", "1011", "1011", "1001"],
  O: ["111", "101", "101", "101", "111"],
  S: ["111", "100", "111", "001", "111"],
};

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function dominantToken(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    if (token === ".") continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function brailleRows(variantName) {
  const variant = matrixLock.variants[variantName];
  if (!variant) throw new Error(`Unknown guardian variant: ${variantName}`);
  const rows = [];

  for (let cellY = 0; cellY < variant.terminal_rows; cellY += 1) {
    const cells = [];
    for (let cellX = 0; cellX < variant.terminal_columns; cellX += 1) {
      let bits = 0;
      const activeTokens = [];
      for (const [dotX, dotY, bit] of BRAILLE_DOTS) {
        const token = variant.rows[cellY * 4 + dotY][cellX * 2 + dotX];
        if (token === ".") continue;
        bits |= 1 << bit;
        activeTokens.push(token);
      }
      const token = dominantToken(activeTokens);
      cells.push({
        char: bits ? String.fromCodePoint(0x2800 + bits) : " ",
        fg: token ? MATRIX_COLORS[token] : null,
        bg: null,
      });
    }
    rows.push(cells);
  }
  return rows;
}

function blockRows(variantName) {
  const variant = matrixLock.variants[variantName];
  if (!variant) throw new Error(`Unknown guardian variant: ${variantName}`);
  const rows = [];

  for (let cellY = 0; cellY < variant.terminal_rows; cellY += 1) {
    const cells = [];
    for (let cellX = 0; cellX < variant.terminal_columns; cellX += 1) {
      const topTokens = [];
      const bottomTokens = [];
      for (let dotY = 0; dotY < 4; dotY += 1) {
        for (let dotX = 0; dotX < 2; dotX += 1) {
          const token = variant.rows[cellY * 4 + dotY][cellX * 2 + dotX];
          (dotY < 2 ? topTokens : bottomTokens).push(token);
        }
      }
      const top = dominantToken(topTokens);
      const bottom = dominantToken(bottomTokens);
      if (!top && !bottom) {
        cells.push({ char: " ", fg: null, bg: null });
      } else if (top && !bottom) {
        cells.push({ char: "▀", fg: MATRIX_COLORS[top], bg: null });
      } else if (!top && bottom) {
        cells.push({ char: "▄", fg: MATRIX_COLORS[bottom], bg: null });
      } else if (top === bottom) {
        cells.push({ char: "█", fg: MATRIX_COLORS[top], bg: null });
      } else {
        cells.push({
          char: "▀",
          fg: MATRIX_COLORS[top],
          bg: MATRIX_COLORS[bottom],
        });
      }
    }
    rows.push(cells);
  }
  return rows;
}

function guardianRows(variantName, mode = "braille") {
  if (mode === "braille" || mode === "arcade" || mode === "auto") {
    return brailleRows(variantName);
  }
  if (mode === "blocks") return blockRows(variantName);
  if (mode === "text") {
    const width = matrixLock.variants[variantName]?.terminal_columns || 42;
    const lines = [
      "       /\\           /\\_/\\           /\\",
      "  ____/  \\___      /  o o  \\      ___/  \\____",
      " /  guardian  \\____/   ---   \\____/  guardian  \\",
      " \\____________/    \\_________/    \\____________/",
    ].map((line) => line.slice(0, width).padEnd(width));
    return lines.map((line) =>
      [...line].map((char) => ({ char, fg: TOKENS.dim, bg: null })),
    );
  }
  if (mode === "none") return [];
  throw new Error(`Unknown guardian mode: ${mode}`);
}

function encodeDotIcon(pattern, color) {
  const height = pattern.length;
  const width = Math.max(...pattern.map((row) => row.length));
  const paddedHeight = Math.ceil(height / 4) * 4;
  const paddedWidth = Math.ceil(width / 2) * 2;
  const dotRows = Array.from({ length: paddedHeight }, (_, y) =>
    (pattern[y] || "").padEnd(paddedWidth, "."),
  );
  const rows = [];
  for (let cellY = 0; cellY < paddedHeight / 4; cellY += 1) {
    const cells = [];
    for (let cellX = 0; cellX < paddedWidth / 2; cellX += 1) {
      let bits = 0;
      for (const [dotX, dotY, bit] of BRAILLE_DOTS) {
        if (dotRows[cellY * 4 + dotY][cellX * 2 + dotX] !== ".") {
          bits |= 1 << bit;
        }
      }
      cells.push({
        char: bits ? String.fromCodePoint(0x2800 + bits) : " ",
        fg: color,
        bg: null,
      });
    }
    rows.push(cells);
  }
  return rows;
}

const ICONS = {
  quickStart: encodeDotIcon(
    [
      "..XX....",
      "..XXX...",
      "..XXXX..",
      "..XXXXX.",
      "..XXXXX.",
      "..XXXX..",
      "..XXX...",
      "..XX....",
    ],
    TOKENS.cyan,
  ),
  readiness: encodeDotIcon(
    [
      ".X..X.",
      "XXXXXX",
      "X....X",
      "X.XX.X",
      "X.XX.X",
      "X....X",
      "XXXXXX",
      ".X..X.",
    ],
    TOKENS.violet,
  ),
  recentRuns: encodeDotIcon(
    [
      "..XX..",
      ".X..X.",
      "X.X..X",
      "X.X..X",
      "X..X.X",
      "X....X",
      ".X..X.",
      "..XX..",
    ],
    TOKENS.violet,
  ),
};

class CellCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({
        char: " ",
        fg: null,
        bg: null,
        bold: false,
      })),
    );
  }

  set(x, y, char, style = {}) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[y][x] = {
      char,
      fg: style.fg ?? null,
      bg: style.bg ?? null,
      bold: Boolean(style.bold),
    };
  }

  text(x, y, value, style = {}) {
    [...value].forEach((char, offset) => this.set(x + offset, y, char, style));
  }

  putRows(x, y, rows) {
    rows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        this.set(x + columnIndex, y + rowIndex, cell.char, cell);
      });
    });
  }

  hline(x1, x2, y, char = "─", style = {}) {
    for (let x = x1; x <= x2; x += 1) this.set(x, y, char, style);
  }

  vline(x, y1, y2, char = "│", style = {}) {
    for (let y = y1; y <= y2; y += 1) this.set(x, y, char, style);
  }

  frame() {
    const style = { fg: TOKENS.frame };
    this.hline(1, this.width - 2, 0, "─", style);
    this.hline(1, this.width - 2, this.height - 1, "─", style);
    this.vline(0, 1, this.height - 2, "│", style);
    this.vline(this.width - 1, 1, this.height - 2, "│", style);
    this.set(0, 0, "┌", style);
    this.set(this.width - 1, 0, "┐", style);
    this.set(0, this.height - 1, "└", style);
    this.set(this.width - 1, this.height - 1, "┘", style);
  }

  divider(y, junctions = []) {
    const style = { fg: TOKENS.frame };
    this.hline(1, this.width - 2, y, "─", style);
    this.set(0, y, "├", style);
    this.set(this.width - 1, y, "┤", style);
    for (const x of junctions) this.set(x, y, "┼", style);
  }

  plainLines() {
    return this.cells.map((row) => row.map((cell) => cell.char).join(""));
  }

  model() {
    return {
      width: this.width,
      height: this.height,
      rows: this.cells.map((row) => {
        const spans = [];
        for (const cell of row) {
          const previous = spans.at(-1);
          if (
            previous &&
            previous.fg === cell.fg &&
            previous.bg === cell.bg &&
            previous.bold === cell.bold
          ) {
            previous.text += cell.char;
          } else {
            spans.push({
              text: cell.char,
              fg: cell.fg,
              bg: cell.bg,
              bold: cell.bold,
            });
          }
        }
        return spans;
      }),
    };
  }

  ansiLines({ color = true } = {}) {
    if (!color) return this.plainLines();
    return this.cells.map((row) => {
      let active = "";
      let output = "";
      for (const cell of row) {
        const codes = [];
        if (cell.bold) codes.push("1");
        if (cell.fg) {
          const [red, green, blue] = hexToRgb(cell.fg);
          codes.push(`38;2;${red};${green};${blue}`);
        }
        if (cell.bg) {
          const [red, green, blue] = hexToRgb(cell.bg);
          codes.push(`48;2;${red};${green};${blue}`);
        }
        const next = codes.join(";");
        if (next !== active) {
          output += next ? `\u001b[0;${next}m` : "\u001b[0m";
          active = next;
        }
        output += cell.char;
      }
      return `${output}\u001b[0m`;
    });
  }
}

function drawWordmark(canvas, x, y, color = TOKENS.cyan) {
  let cursor = x;
  for (const char of "AI-MINIONS") {
    const glyph = WORDMARK_3X5[char];
    if (!glyph) continue;
    for (let row = 0; row < glyph.length; row += 1) {
      [...glyph[row]].forEach((pixel, column) => {
        if (pixel === "1") {
          canvas.set(cursor + column, y + row, "█", {
            fg: color,
            bold: true,
          });
        }
      });
    }
    cursor += glyph[0].length + 1;
  }
}

function drawHeader(canvas, version) {
  canvas.text(2, 1, "[>] ai-minions", { fg: TOKENS.cyan, bold: true });
  canvas.text(canvas.width - version.length - 2, 1, version, {
    fg: TOKENS.text,
  });
}

function drawGuardianLabels(canvas, artX, y, variantName) {
  const positions =
    variantName === "showcase"
      ? [
          ["VALIDATE", 5, TOKENS.cyan],
          ["TRACE", 32, TOKENS.violet],
          ["ENFORCE", 55, TOKENS.amber],
        ]
      : variantName === "wide"
        ? [
            ["VALIDATE", 4, TOKENS.cyan],
            ["TRACE", 27, TOKENS.violet],
            ["ENFORCE", 47, TOKENS.amber],
          ]
        : [
            ["VALIDATE", 1, TOKENS.cyan],
            ["TRACE", 20, TOKENS.violet],
            ["ENFORCE", 33, TOKENS.amber],
          ];
  for (const [label, offset, fg] of positions) {
    canvas.text(artX + offset, y, label, { fg, bold: true });
  }
}

function drawPanelIcon(canvas, x, y, icon) {
  canvas.putRows(x, y, icon);
}

function drawWideLanding({ width, height, version, artMode, variantName }) {
  const canvas = new CellCanvas(width, height);
  canvas.frame();
  drawHeader(canvas, version);

  const heroBottom = height === 40 ? 18 : 16;
  const panelsBottom = height === 40 ? 30 : 26;
  const recentBottom = height === 40 ? 35 : 30;
  const promptBottom = height === 40 ? 37 : 33;
  canvas.divider(2);
  canvas.divider(heroBottom);

  const artX = 2;
  const artY = 3;
  const art = guardianRows(variantName, artMode);
  canvas.putRows(artX, artY, art);
  if (artMode !== "none") {
    drawGuardianLabels(canvas, artX, artY + art.length, variantName);
  }

  const wordmarkX = variantName === "showcase" ? 86 : 72;
  drawWordmark(canvas, wordmarkX, 4);
  const tagline = "Contract-First Multi-Agent Orchestration Harness";
  canvas.text(width - tagline.length - 3, 10, tagline, {
    fg: TOKENS.text,
  });
  const ctaX = variantName === "showcase" ? 88 : 73;
  const ctaWidth = 32;
  canvas.text(ctaX, 12, `┌${"─".repeat(ctaWidth - 2)}┐`, {
    fg: TOKENS.cyan,
  });
  canvas.text(ctaX, 13, `│ > 1. Start New Run${" ".repeat(11)}│`, {
    fg: TOKENS.cyan,
    bold: true,
  });
  canvas.text(ctaX, 14, `└${"─".repeat(ctaWidth - 2)}┘`, {
    fg: TOKENS.cyan,
  });

  const split = Math.floor(width * 0.43);
  canvas.divider(panelsBottom, [split]);
  canvas.vline(split, heroBottom + 1, panelsBottom - 1, "│", {
    fg: TOKENS.frame,
  });
  canvas.set(split, heroBottom, "┬", { fg: TOKENS.frame });

  const panelY = heroBottom + 1;
  drawPanelIcon(canvas, 2, panelY + 1, ICONS.quickStart);
  canvas.text(8, panelY + 1, "Quick Start", {
    fg: TOKENS.cyan,
    bold: true,
  });
  canvas.text(8, panelY + 2, "keyboard — not clickable", { fg: TOKENS.dim });
  const actions = [
    "1. Start New Run",
    "2. Browse Runs",
    "3. System Status",
    "4. Settings",
    "5. Help",
  ];
  actions.forEach((action, index) => {
    canvas.text(3, panelY + 3 + index, `${index === 0 ? ">" : " "} ${action}`, {
      fg: index === 0 ? TOKENS.cyan : TOKENS.text,
      bold: index === 0,
    });
  });

  drawPanelIcon(canvas, split + 2, panelY + 1, ICONS.readiness);
  canvas.text(split + 8, panelY + 1, "System Readiness", {
    fg: TOKENS.violet,
    bold: true,
  });
  const readiness = [
    ["Overall:", "READY", TOKENS.green],
    ["Model Policy:", "local_only", TOKENS.text],
    ["Credentials:", "not_required", TOKENS.text],
    ["Environment:", "OK", TOKENS.green],
    ["ai-minions Path:", "ready", TOKENS.green],
  ];
  const valueX = width - 28;
  readiness.forEach(([label, value, fg], index) => {
    const row = panelY + 3 + index;
    canvas.text(split + 3, row, label, { fg: TOKENS.text });
    canvas.text(valueX, row, value, {
      fg,
      bold: index === 0,
    });
  });

  canvas.divider(recentBottom);
  const recentY = panelsBottom + 1;
  drawPanelIcon(canvas, 2, recentY, ICONS.recentRuns);
  canvas.text(8, recentY + 1, "Recent Runs", {
    fg: TOKENS.violet,
    bold: true,
  });
  canvas.text(
    8,
    recentY + 2,
    "No runs yet: Start a run to create the first trace.",
    { fg: TOKENS.dim },
  );

  canvas.divider(promptBottom);
  canvas.text(2, recentBottom + 1, "> _", {
    fg: TOKENS.cyan,
    bold: true,
  });
  canvas.text(
    2,
    promptBottom + 1,
    "↑/↓ Navigate  ·  Enter Select  ·  Esc Home  ·  q Quit  ·  ? Help  ·  / slash",
    { fg: TOKENS.text },
  );
  return canvas;
}

function drawCompactLanding({ version, artMode }) {
  const width = 80;
  const height = 24;
  const canvas = new CellCanvas(width, height);
  canvas.frame();
  drawHeader(canvas, version);
  canvas.divider(2);
  canvas.putRows(1, 3, guardianRows("compact", artMode));
  drawGuardianLabels(canvas, 1, 11, "compact");
  canvas.text(48, 4, "AI-MINIONS", { fg: TOKENS.cyan, bold: true });
  canvas.text(48, 6, "Contract-First Orchestration", { fg: TOKENS.text });
  canvas.text(48, 8, "> 1. Start New Run", {
    fg: TOKENS.cyan,
    bold: true,
  });
  canvas.divider(12);

  const split = 39;
  canvas.vline(split, 13, 19, "│", { fg: TOKENS.frame });
  canvas.set(split, 12, "┬", { fg: TOKENS.frame });
  canvas.text(2, 13, "Quick Start", { fg: TOKENS.cyan, bold: true });
  ["1. Start New Run", "2. Browse Runs", "3. System Status", "4. Settings", "5. Help"]
    .forEach((action, index) => {
      canvas.text(2, 14 + index, `${index === 0 ? ">" : " "} ${action}`, {
        fg: index === 0 ? TOKENS.cyan : TOKENS.text,
        bold: index === 0,
      });
    });
  canvas.text(42, 13, "System Readiness", {
    fg: TOKENS.violet,
    bold: true,
  });
  [
    ["Overall", "READY", TOKENS.green],
    ["Policy", "local_only", TOKENS.text],
    ["Credentials", "not_required", TOKENS.text],
    ["Environment", "OK", TOKENS.green],
    ["Path", "ready", TOKENS.green],
  ].forEach(([label, value, fg], index) => {
    canvas.text(42, 14 + index, label, { fg: TOKENS.text });
    canvas.text(66, 14 + index, value, { fg, bold: index === 0 });
  });
  canvas.divider(20, [split]);
  canvas.text(2, 21, "> _", { fg: TOKENS.cyan, bold: true });
  canvas.text(2, 22, "↑↓ Navigate · Enter Select · q Quit · ? Help", {
    fg: TOKENS.text,
  });
  return canvas;
}

function drawMinimalLanding({ version }) {
  const width = 50;
  const height = 16;
  const canvas = new CellCanvas(width, height);
  canvas.frame();
  drawHeader(canvas, version);
  canvas.divider(2);
  canvas.text(2, 3, "AI-MINIONS", { fg: TOKENS.cyan, bold: true });
  canvas.text(2, 4, "Contract-First Orchestration", { fg: TOKENS.text });
  canvas.text(2, 6, "> 1. Start New Run", {
    fg: TOKENS.cyan,
    bold: true,
  });
  canvas.text(4, 7, "2. Browse Runs", { fg: TOKENS.text });
  canvas.text(4, 8, "3. System Status", { fg: TOKENS.text });
  canvas.text(4, 9, "4. Settings", { fg: TOKENS.text });
  canvas.text(4, 10, "5. Help", { fg: TOKENS.text });
  canvas.text(29, 6, "Overall: READY", {
    fg: TOKENS.green,
    bold: true,
  });
  canvas.divider(11);
  canvas.text(2, 12, "> _", { fg: TOKENS.cyan, bold: true });
  canvas.divider(13);
  canvas.text(2, 14, "↑↓ Navigate · Enter Select · q Quit · ? Help", {
    fg: TOKENS.text,
  });
  return canvas;
}

function buildLandingCanvas({
  columns = 120,
  rows = 36,
  version = "v0.26.0-beta.1",
  artMode = "braille",
} = {}) {
  if (columns >= 140 && rows >= 40) {
    return drawWideLanding({
      width: columns,
      height: rows,
      version,
      artMode,
      variantName: "showcase",
    });
  }
  if (columns >= 120 && rows >= 36) {
    return drawWideLanding({
      width: columns,
      height: rows,
      version,
      artMode,
      variantName: "wide",
    });
  }
  if (columns >= 80 && rows >= 24) {
    return drawCompactLanding({ version, artMode });
  }
  return drawMinimalLanding({ version });
}

module.exports = {
  ICONS,
  MATRIX_COLORS,
  TOKENS,
  WORDMARK_3X5,
  blockRows,
  brailleRows,
  buildLandingCanvas,
  drawWordmark,
  guardianRows,
};
