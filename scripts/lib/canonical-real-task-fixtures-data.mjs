/**
 * Canonical real-task fixtures for six-mode tester matrix runs.
 * Shared by verify-canonical-real-task-fixtures.mjs, verify-usage-docs, and tests.
 *
 * Fixtures are stable prompts + observable acceptance contracts — not hybrid runtime.
 * Hybrid matrix rows remain honest-skip (MATRIX_SKIP_HYBRID_UNSUPPORTED).
 */

/** @typedef {'canonical' | 'secondary'} FixtureStatus */
/** @typedef {'string_present' | 'regex' | 'no_external_network_assets'} ArtifactCheckKind */

/**
 * @typedef {Object} ArtifactCheck
 * @property {string} id
 * @property {ArtifactCheckKind} kind
 * @property {string} [needle]
 * @property {string} [pattern]
 * @property {string} label
 */

/**
 * @typedef {Object} RealTaskFixture
 * @property {string} id
 * @property {FixtureStatus} status
 * @property {string} title
 * @property {string} prompt
 * @property {string[]} expected_artifacts
 * @property {string[]} allowed_dependencies
 * @property {string[]} disallowed_behavior
 * @property {ArtifactCheck[]} functional_checks
 * @property {string[]} visual_reviewer_checklist
 * @property {string[]} evidence_checklist
 * @property {string[]} matrix_row_ids
 */

export const FIXTURE_SCHEMA_VERSION = 1;

/** Six-mode matrix row ids these fixtures support (same task contract per row). */
export const FIXTURE_MATRIX_ROW_IDS = Object.freeze([
  "sa-local_only",
  "sa-remote_ok",
  "sa-hybrid",
  "ma-local_only",
  "ma-remote_ok",
  "ma-hybrid",
]);

export const REASON_CODES = Object.freeze({
  OK: "FIXTURE_OK",
  DOC_FAIL: "FIXTURE_DOC_FAIL",
  DATA_FAIL: "FIXTURE_DATA_FAIL",
  ARTIFACT_FAIL: "FIXTURE_ARTIFACT_FAIL",
});

/** Stable Sudoku prompt — must stay identical in docs and this module. */
export const SUDOKU_PROMPT = Object.freeze(
  [
    "Build a small self-contained Sudoku HTML app as a single file named sudoku.html.",
    "Requirements:",
    "- One file only: HTML + CSS + JS inline (no external scripts, stylesheets, fonts, or images).",
    "- Playable 9x9 Sudoku board with a puzzle loaded at startup (not an empty grid).",
    "- A Check/Validate action that reports whether the current board is complete and correct.",
    "- A Reset or New puzzle / Clear action so the user can start over.",
    "- No network access at runtime: do not use fetch, XMLHttpRequest, WebSocket, or CDN URLs.",
    "- Open the file in a browser with no server required.",
    "Stop when sudoku.html exists and meets the requirements above.",
  ].join("\n"),
);

/** Secondary fixture prompt (visual demo) — optional for matrix runs. */
export const SOLAR_SYSTEM_PROMPT = Object.freeze(
  [
    "Build a small self-contained solar-system HTML demo as a single file named solar-system.html.",
    "Requirements:",
    "- One file only: HTML + CSS + JS inline (no external scripts, stylesheets, fonts, or images).",
    "- Visual planets and orbits representation with basic labels or controls.",
    "- Animation or interactive behavior (for example pause/resume or click a planet).",
    "- No network access at runtime: do not use fetch, XMLHttpRequest, WebSocket, or CDN URLs.",
    "- Open the file in a browser with no server required.",
    "Stop when solar-system.html exists and meets the requirements above.",
  ].join("\n"),
);

/** @type {RealTaskFixture[]} */
export const REAL_TASK_FIXTURES = Object.freeze([
  {
    id: "sudoku-html-app",
    status: "canonical",
    title: "Sudoku HTML app",
    prompt: SUDOKU_PROMPT,
    expected_artifacts: Object.freeze(["sudoku.html"]),
    allowed_dependencies: Object.freeze([
      "none — single self-contained HTML/CSS/JS file",
      "browser APIs that work offline (DOM, localStorage optional)",
    ]),
    disallowed_behavior: Object.freeze([
      "external network assets (http/https CDN, remote fonts, remote images)",
      "fetch / XMLHttpRequest / WebSocket to remote hosts",
      "multi-file builds that require a bundler or server",
      "pixel-perfect visual grading",
    ]),
    functional_checks: Object.freeze([
      {
        id: "has_html_document",
        kind: "string_present",
        needle: "<html",
        label: "HTML document present",
      },
      {
        id: "mentions_sudoku",
        kind: "regex",
        pattern: "sudoku",
        label: "Sudoku mentioned in markup or script",
      },
      {
        id: "has_script",
        kind: "string_present",
        needle: "<script",
        label: "Inline script present",
      },
      {
        id: "has_check_or_validate",
        kind: "regex",
        pattern: "check|validate|verify",
        label: "Check/Validate action present",
      },
      {
        id: "has_reset_or_new",
        kind: "regex",
        pattern: "reset|new\\s*puzzle|clear",
        label: "Reset/New/Clear action present",
      },
      {
        id: "has_board_cells",
        kind: "regex",
        pattern: "grid|cell|board|table|input",
        label: "Board/grid structure present",
      },
      {
        id: "no_external_network_assets",
        kind: "no_external_network_assets",
        label: "No external http(s) asset URLs",
      },
    ]),
    visual_reviewer_checklist: Object.freeze([
      "Board is readable as a 9x9 Sudoku without scrolling into illegible cells on a laptop viewport",
      "Puzzle digits vs empty cells are distinguishable",
      "Check/Validate feedback is visible to a human (message, highlight, or status text)",
      "Reset/New/Clear is discoverable without reading the source",
      "No broken layout that makes the puzzle unusable",
    ]),
    evidence_checklist: Object.freeze([
      "git rev-parse --short HEAD",
      "matrix row id + PASS|FAIL|SKIP (+ reason code for hybrid / missing deps)",
      "run_id / task_id from start/smoke output",
      "ai-minions status --run-id <run_id>",
      "ai-minions attach --run-id <run_id> (or inspect-run-evidence + collect-run-report)",
      "path to sudoku.html artifact",
      "node scripts/verify-canonical-real-task-fixtures.mjs --artifact <path> --fixture sudoku-html-app",
      "PRIVACY.md — never secret values in logs or attach bundles",
    ]),
    matrix_row_ids: FIXTURE_MATRIX_ROW_IDS,
  },
  {
    id: "solar-system-html-demo",
    status: "secondary",
    title: "Solar system HTML demo",
    prompt: SOLAR_SYSTEM_PROMPT,
    expected_artifacts: Object.freeze(["solar-system.html"]),
    allowed_dependencies: Object.freeze([
      "none — single self-contained HTML/CSS/JS file",
      "browser APIs that work offline (DOM, Canvas, requestAnimationFrame)",
    ]),
    disallowed_behavior: Object.freeze([
      "external network assets (http/https CDN, remote fonts, remote images)",
      "fetch / XMLHttpRequest / WebSocket to remote hosts",
      "multi-file builds that require a bundler or server",
      "pixel-perfect visual grading",
    ]),
    functional_checks: Object.freeze([
      {
        id: "has_html_document",
        kind: "string_present",
        needle: "<html",
        label: "HTML document present",
      },
      {
        id: "mentions_planet_or_orbit",
        kind: "regex",
        pattern: "planet|orbit|solar",
        label: "Planet/orbit/solar mentioned",
      },
      {
        id: "has_script",
        kind: "string_present",
        needle: "<script",
        label: "Inline script present",
      },
      {
        id: "has_animation_or_control",
        kind: "regex",
        pattern: "requestAnimationFrame|animate|pause|resume|click|button",
        label: "Animation or interactive control present",
      },
      {
        id: "no_external_network_assets",
        kind: "no_external_network_assets",
        label: "No external http(s) asset URLs",
      },
    ]),
    visual_reviewer_checklist: Object.freeze([
      "Planets/orbits are recognizable without reading the source",
      "Labels or controls are readable",
      "Motion or interaction is observable within a few seconds",
      "No layout that hides the demo on a laptop viewport",
    ]),
    evidence_checklist: Object.freeze([
      "git rev-parse --short HEAD",
      "matrix row id + PASS|FAIL|SKIP (+ reason code for hybrid / missing deps)",
      "run_id / task_id from start/smoke output",
      "ai-minions status --run-id <run_id>",
      "ai-minions attach --run-id <run_id> (or inspect-run-evidence + collect-run-report)",
      "path to solar-system.html artifact",
      "node scripts/verify-canonical-real-task-fixtures.mjs --artifact <path> --fixture solar-system-html-demo",
      "PRIVACY.md — never secret values in logs or attach bundles",
    ]),
    matrix_row_ids: FIXTURE_MATRIX_ROW_IDS,
  },
]);

/** Required markers in the how-to doc. */
export const FIXTURE_DOC_REQUIRED_MARKERS = Object.freeze([
  { needle: "sudoku-html-app", label: "sudoku fixture id" },
  { needle: "solar-system-html-demo", label: "solar fixture id" },
  { needle: "sudoku.html", label: "sudoku artifact name" },
  { needle: SUDOKU_PROMPT.split("\n")[0], label: "stable sudoku prompt lead" },
  { needle: "sa-local_only", label: "sa-local_only row" },
  { needle: "sa-remote_ok", label: "sa-remote_ok row" },
  { needle: "sa-hybrid", label: "sa-hybrid row" },
  { needle: "ma-local_only", label: "ma-local_only row" },
  { needle: "ma-remote_ok", label: "ma-remote_ok row" },
  { needle: "ma-hybrid", label: "ma-hybrid row" },
  { needle: "MATRIX_SKIP_HYBRID_UNSUPPORTED", label: "hybrid skip reason" },
  { needle: "any_provider", label: "credential sufficiency" },
  { needle: "at least one", label: "at-least-one token copy" },
  { needle: "no silent remote fallback", label: "local_only no-fallback" },
  { needle: "never secret values", label: "no secret values" },
  { needle: "ai-minions status", label: "status evidence" },
  { needle: "ai-minions attach", label: "attach evidence" },
  { needle: "verify-canonical-real-task-fixtures.mjs", label: "fixture verifier script" },
  { needle: "tester-six-mode-matrix", label: "six-mode matrix link" },
  { needle: "mode-comparison-report", label: "mode comparison report link" },
  { needle: "PRIVACY.md", label: "privacy prerequisite" },
  { needle: "Functional acceptance", label: "functional acceptance section" },
  { needle: "Visual/user acceptance", label: "visual acceptance section" },
  { needle: "Allowed dependencies", label: "allowed dependencies" },
  { needle: "Disallowed", label: "disallowed behavior" },
  { needle: "honest skip", label: "hybrid honest skip" },
]);

/**
 * @param {string} fixtureId
 * @returns {RealTaskFixture | undefined}
 */
export function getFixture(fixtureId) {
  return REAL_TASK_FIXTURES.find((f) => f.id === fixtureId);
}

/**
 * @param {string} fixtureId
 * @returns {string}
 */
export function getFixturePrompt(fixtureId) {
  const fixture = getFixture(fixtureId);
  if (!fixture) {
    throw new Error(`unknown fixture id: ${fixtureId}`);
  }
  return fixture.prompt;
}

/**
 * Detect external network asset / remote call patterns in HTML source.
 * Allows data: URLs. Does not execute the page.
 * @param {string} htmlText
 * @returns {string[]}
 */
export function findExternalNetworkAssetHits(htmlText) {
  const text = String(htmlText);
  /** @type {string[]} */
  const hits = [];
  const patterns = [
    { re: /\bsrc\s*=\s*["']https?:\/\//i, label: "src=http(s)" },
    { re: /\bhref\s*=\s*["']https?:\/\/(?!#$)/i, label: "href=http(s)" },
    { re: /@import\s+["']https?:\/\//i, label: "@import http(s)" },
    { re: /url\(\s*["']?https?:\/\//i, label: "css url(http(s))" },
    { re: /\bfetch\s*\(/i, label: "fetch(" },
    { re: /\bXMLHttpRequest\b/i, label: "XMLHttpRequest" },
    { re: /\bWebSocket\b/i, label: "WebSocket" },
    { re: /cdn\./i, label: "cdn. host hint" },
  ];
  for (const { re, label } of patterns) {
    if (re.test(text)) hits.push(label);
  }
  return hits;
}

/**
 * @param {RealTaskFixture} fixture
 * @param {string} htmlText
 * @returns {{ ok: boolean, errors: string[], checks: { id: string, ok: boolean, label: string }[] }}
 */
export function validateFixtureArtifact(fixture, htmlText) {
  /** @type {string[]} */
  const errors = [];
  /** @type {{ id: string, ok: boolean, label: string }[]} */
  const checks = [];
  const text = String(htmlText ?? "");
  if (!text.trim()) {
    return {
      ok: false,
      errors: ["artifact empty or missing"],
      checks: [],
    };
  }

  for (const check of fixture.functional_checks) {
    let ok = false;
    if (check.kind === "string_present") {
      ok = text.toLowerCase().includes(String(check.needle).toLowerCase());
    } else if (check.kind === "regex") {
      ok = new RegExp(String(check.pattern), "i").test(text);
    } else if (check.kind === "no_external_network_assets") {
      const hits = findExternalNetworkAssetHits(text);
      ok = hits.length === 0;
      if (!ok) {
        errors.push(
          `${check.id}: external network patterns found (${hits.join(", ")})`,
        );
      }
    } else {
      errors.push(`${check.id}: unknown check kind`);
      checks.push({ id: check.id, ok: false, label: check.label });
      continue;
    }
    if (!ok && check.kind !== "no_external_network_assets") {
      errors.push(`${check.id}: failed — ${check.label}`);
    }
    checks.push({ id: check.id, ok, label: check.label });
  }

  return { ok: errors.length === 0, errors, checks };
}

/**
 * @param {string} docText
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateFixtureDoc(docText) {
  /** @type {string[]} */
  const errors = [];
  if (!docText || !String(docText).trim()) {
    return { ok: false, errors: ["fixture doc empty or missing"] };
  }
  const text = String(docText);
  for (const { needle, label } of FIXTURE_DOC_REQUIRED_MARKERS) {
    if (!text.includes(needle)) {
      errors.push(`missing required marker: ${label} (${needle})`);
    }
  }
  for (const fixture of REAL_TASK_FIXTURES) {
    if (!text.includes(fixture.id)) {
      errors.push(`missing fixture id: ${fixture.id}`);
    }
    if (!text.includes(fixture.prompt)) {
      errors.push(`doc prompt must match module prompt exactly: ${fixture.id}`);
    }
  }
  for (const rowId of FIXTURE_MATRIX_ROW_IDS) {
    if (!text.includes(rowId)) {
      errors.push(`missing matrix row id: ${rowId}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Structural integrity of the in-repo fixture table.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateFixtureData() {
  /** @type {string[]} */
  const errors = [];
  if (REAL_TASK_FIXTURES.length < 1) {
    errors.push("at least one fixture required");
  }
  const canonical = REAL_TASK_FIXTURES.filter((f) => f.status === "canonical");
  if (canonical.length !== 1) {
    errors.push("exactly one canonical fixture required");
  }
  const ids = new Set();
  for (const fixture of REAL_TASK_FIXTURES) {
    if (ids.has(fixture.id)) errors.push(`duplicate fixture id: ${fixture.id}`);
    ids.add(fixture.id);
    if (!fixture.prompt || !fixture.prompt.trim()) {
      errors.push(`${fixture.id}: empty prompt`);
    }
    if (!fixture.expected_artifacts?.length) {
      errors.push(`${fixture.id}: expected_artifacts empty`);
    }
    if (!fixture.functional_checks?.length) {
      errors.push(`${fixture.id}: functional_checks empty`);
    }
    if (!fixture.visual_reviewer_checklist?.length) {
      errors.push(`${fixture.id}: visual_reviewer_checklist empty`);
    }
    if (!fixture.evidence_checklist?.length) {
      errors.push(`${fixture.id}: evidence_checklist empty`);
    }
    for (const rowId of FIXTURE_MATRIX_ROW_IDS) {
      if (!fixture.matrix_row_ids.includes(rowId)) {
        errors.push(`${fixture.id}: missing matrix row ${rowId}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
