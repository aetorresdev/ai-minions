/**
 * Shared constants for v0.17 modular closeout dry-run evidence.
 */

/** Versioned closeout docs that must state honest partial layout. */
export const CLOSEOUT_DOC_PATHS = [
  "docs/orchestrator/architecture-coherence-audit.md",
  "docs/orchestrator/root-file-inventory.md",
  "docs/orchestrator/module-boundaries.md",
];

/** Each closeout doc must include at least one honesty marker. */
export const CLOSEOUT_HONESTY_MARKERS = [
  /not architecture complete/i,
  /not.*architecture complete/i,
  /partial/i,
  /compat shim/i,
];

/** Affirmative overclaims forbidden in closeout docs (unnegated scan). */
export const FORBIDDEN_CLOSEOUT_CLAIMS = [
  { re: /\barchitecture refactor complete\b/i, id: "architecture_refactor_complete" },
  { re: /\bfull modular monolith enforced\b/i, id: "full_modular_monolith" },
  { re: /\bmodular monolith refactor complete\b/i, id: "modular_monolith_complete" },
];

/** Orchestrator contract tests run by closeout evidence (parity + guards). */
export const CLOSEOUT_PARITY_TESTS = [
  "orchestrator/tests/modulesPhysicalLayout.test.js",
  "orchestrator/tests/orchestrator-export-parity.test.js",
  "orchestrator/tests/agentsPublicApi.test.js",
  "orchestrator/tests/rootImportGuard.test.js",
  "orchestrator/tests/architectureCoherenceAuditContract.test.js",
];
