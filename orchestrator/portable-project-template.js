"use strict";

/**
 * Portable project template export/import (read-only bundle; import dry-run by default).
 * Collects project-level ai-minions config under --cwd; does not mutate runtime defaults.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { redactSensitivePlaintext } = require("./trace-redact");
const { loadMinionsProjectConfig, extractJsonPayload } = require("./minions-config");
const { loadProjectPolicy } = require("./security/load-project-policy");
const {
  CAPABILITY_MATRIX_VERSION,
  KNOWN_ROLE_IDS,
} = require("./agents/capability-matrix");

const TEMPLATE_VERSION = "0.1";

/** @type {readonly { relative_path: string, optional: boolean }[]} */
const PROJECT_FILE_SLOTS = Object.freeze([
  { relative_path: "minions.md", optional: true },
  { relative_path: path.join(".ai-minions", "permissions.yaml"), optional: true },
  { relative_path: path.join(".ai-minions", "doc-pointers.json"), optional: true },
]);

const SENSITIVE_KEY_RE =
  /(secret|password|token|api[_-]?key|apikey|credential|private[_-]?key|auth)/i;

const UNREDACTED_SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9\-._~+/=*]{16,}\b/i,
  /\bsk-[a-zA-Z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bxox[bpa]-[0-9]{10,12}-[0-9]{10,12}-[a-zA-Z0-9]{20,}\b/i,
];

/**
 * @param {string} s
 * @returns {boolean}
 */
function containsUnredactedSecretShape(s) {
  const t = String(s);
  for (const re of UNREDACTED_SECRET_PATTERNS) {
    if (re.test(t)) return true;
  }
  return false;
}

/**
 * @param {unknown} value
 * @param {string} keyHint
 * @param {{ redactions: number }} tally
 * @returns {unknown}
 */
function scrubValueDeep(value, keyHint, tally) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    let out = redactSensitivePlaintext(value);
    if (SENSITIVE_KEY_RE.test(keyHint) && out === value && value.trim() !== "") {
      out = "[REDACTED:sensitive_key]";
      tally.redactions += 1;
    }
    if (out !== value) tally.redactions += 1;
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValueDeep(item, keyHint, tally));
  }
  if (typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = scrubValueDeep(v, k, tally);
    }
    return out;
  }
  return value;
}

/**
 * @param {string} relativePath
 * @param {string} raw
 * @returns {{ content: string, redactions: number }}
 */
function scrubProjectFileContent(relativePath, raw) {
  const tally = { redactions: 0 };
  const base = path.basename(relativePath);

  if (base.endsWith(".yaml") || base.endsWith(".yml")) {
    const parsed = yaml.load(raw);
    const scrubbed = scrubValueDeep(parsed, "", tally);
    return { content: yaml.dump(scrubbed, { lineWidth: 120, noRefs: true }), redactions: tally.redactions };
  }

  if (base.endsWith(".json") || base === "doc-pointers.json") {
    const parsed = JSON.parse(raw);
    const scrubbed = scrubValueDeep(parsed, "", tally);
    return { content: `${JSON.stringify(scrubbed, null, 2)}\n`, redactions: tally.redactions };
  }

  const payload = extractJsonPayload(raw);
  if (payload && base === "minions.md") {
    const parsed = JSON.parse(payload);
    const scrubbed = scrubValueDeep(parsed, "", tally);
    const body = JSON.stringify(scrubbed, null, 2);
    return {
      content: `# minions project contract\n\n\`\`\`json\n${body}\n\`\`\`\n`,
      redactions: tally.redactions,
    };
  }

  const out = redactSensitivePlaintext(raw);
  if (out !== raw) tally.redactions += 1;
  return { content: out, redactions: tally.redactions };
}

/**
 * @param {string} repoRoot
 * @returns {object}
 */
function loadModelsProfileNames() {
  const modelsPath = path.join(__dirname, "models.json");
  if (!fs.existsSync(modelsPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    return Object.keys(parsed.profiles || {}).sort();
  } catch {
    return [];
  }
}

/**
 * @param {string} repoRoot
 * @returns {{ harness_refs: object, doc_pointers: object[] }}
 */
function buildHarnessRefs() {
  return {
    harness_refs: {
      capability_matrix: {
        version: CAPABILITY_MATRIX_VERSION,
        harness_relative_path: "orchestrator/agents/capability-matrix.v1.json",
        role_ids: [...KNOWN_ROLE_IDS],
      },
      routing: {
        policy_doc: "docs/orchestrator/model-role-routing-policy.md",
        models_json_profile_names: loadModelsProfileNames(),
        env_override_pattern: "MODEL_OVERRIDE_<ROLE>",
      },
      built_in_permission_profiles: ["dev-local", "ci-safe", "prod-guarded"],
    },
    doc_pointers: [],
  };
}

/**
 * Validate project sources before export (invalid config must not be exported silently).
 * @param {string} repoRoot
 */
function validateProjectSourcesForExport(repoRoot) {
  const root = path.resolve(repoRoot || ".");
  const minions = loadMinionsProjectConfig(root);
  if (minions.error) {
    throw new Error(minions.error);
  }
  const policyPath = path.join(root, ".ai-minions", "permissions.yaml");
  if (fs.existsSync(policyPath)) {
    loadProjectPolicy(root);
  }
  const docPtrPath = path.join(root, ".ai-minions", "doc-pointers.json");
  if (fs.existsSync(docPtrPath)) {
    validateDocPointersFile(docPtrPath);
  }
}

/**
 * @param {string} filePath
 */
function validateDocPointersFile(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`doc-pointers.json: JSON parse error: ${msg}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("doc-pointers.json: root must be an object");
  }
  if (parsed.doc_pointers_version !== "0.1") {
    throw new Error('doc-pointers.json: doc_pointers_version must be "0.1"');
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error("doc-pointers.json: entries must be an array");
  }
  for (const entry of parsed.entries) {
    if (!entry || typeof entry !== "object") {
      throw new Error("doc-pointers.json: each entry must be an object");
    }
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      throw new Error("doc-pointers.json: entry.label must be a non-empty string");
    }
    if (typeof entry.relative_path !== "string" || !entry.relative_path.trim()) {
      throw new Error("doc-pointers.json: entry.relative_path must be a non-empty string");
    }
    if (entry.relative_path.includes("..")) {
      throw new Error("doc-pointers.json: relative_path must not contain '..'");
    }
    if (path.isAbsolute(entry.relative_path)) {
      throw new Error("doc-pointers.json: relative_path must be relative (not absolute)");
    }
  }
}

/**
 * @param {string} repoRoot
 * @returns {object}
 */
function buildExportBundle(repoRoot) {
  const root = path.resolve(repoRoot || ".");
  validateProjectSourcesForExport(root);

  const { harness_refs } = buildHarnessRefs();
  /** @type {object[]} */
  const project_files = [];
  /** @type {object[]} */
  const doc_pointers = [];
  let totalRedactions = 0;

  for (const slot of PROJECT_FILE_SLOTS) {
    const abs = path.join(root, slot.relative_path);
    if (!fs.existsSync(abs)) {
      if (!slot.optional) {
        throw new Error(`required project file missing: ${slot.relative_path}`);
      }
      continue;
    }
    const raw = fs.readFileSync(abs, "utf8");
    const { content, redactions } = scrubProjectFileContent(slot.relative_path, raw);
    totalRedactions += redactions;
    if (containsUnredactedSecretShape(content)) {
      throw new Error(
        `export blocked: unredacted secret-shaped value remains in ${slot.relative_path} after scrub`,
      );
    }
    project_files.push({
      relative_path: slot.relative_path.replace(/\\/g, "/"),
      encoding: "utf8",
      content,
    });

    if (slot.relative_path.endsWith("doc-pointers.json")) {
      const parsed = JSON.parse(content);
      for (const entry of parsed.entries || []) {
        doc_pointers.push({
          label: entry.label,
          relative_path: entry.relative_path,
          bundle_only: true,
        });
      }
    }
  }

  return {
    portable_project_template_version: TEMPLATE_VERSION,
    exported_at: new Date().toISOString(),
    source_repo_basename: path.basename(root),
    harness_refs,
    project_files,
    doc_pointers,
    scrub: {
      redactions_applied: totalRedactions,
      export_blocked_on_remaining_secrets: true,
    },
  };
}

/**
 * @param {string} repoRoot
 * @param {object} bundle
 * @returns {{ ok: boolean, actions: object[], conflicts: object[], errors: string[] }}
 */
function dryRunImport(repoRoot, bundle) {
  const root = path.resolve(repoRoot || ".");
  /** @type {string[]} */
  const errors = [];
  /** @type {object[]} */
  const actions = [];
  /** @type {object[]} */
  const conflicts = [];

  if (!bundle || typeof bundle !== "object") {
    return { ok: false, actions, conflicts, errors: ["bundle must be an object"] };
  }
  if (bundle.portable_project_template_version !== TEMPLATE_VERSION) {
    errors.push(
      `unsupported portable_project_template_version: ${JSON.stringify(bundle.portable_project_template_version)}`,
    );
  }

  const files = Array.isArray(bundle.project_files) ? bundle.project_files : [];
  for (const file of files) {
    if (!file || typeof file.relative_path !== "string" || typeof file.content !== "string") {
      errors.push("invalid project_files entry");
      continue;
    }
    if (file.relative_path.includes("..") || path.isAbsolute(file.relative_path)) {
      errors.push(`invalid relative_path: ${file.relative_path}`);
      continue;
    }
    if (containsUnredactedSecretShape(file.content)) {
      errors.push(`import blocked: secret-shaped value in bundle file ${file.relative_path}`);
      continue;
    }

    const target = path.join(root, file.relative_path);
    if (!fs.existsSync(target)) {
      actions.push({ relative_path: file.relative_path, action: "create" });
      continue;
    }
    const existing = fs.readFileSync(target, "utf8");
    if (existing === file.content) {
      actions.push({ relative_path: file.relative_path, action: "unchanged" });
      continue;
    }
    conflicts.push({
      relative_path: file.relative_path,
      action: "conflict",
      reason: "target exists with different content",
    });
  }

  const ok = errors.length === 0 && conflicts.length === 0;
  return { ok, actions, conflicts, errors };
}

/**
 * @param {object} bundle
 * @returns {string}
 */
function formatDryRunReport(bundle, result) {
  const lines = [];
  lines.push("Portable project template import dry-run");
  lines.push(`  template_version: ${bundle.portable_project_template_version || "(missing)"}`);
  lines.push(`  project_files in bundle: ${(bundle.project_files || []).length}`);
  lines.push("");
  if (result.errors.length) {
    lines.push("-- Errors --");
    for (const e of result.errors) lines.push(`  - ${e}`);
    lines.push("");
  }
  if (result.conflicts.length) {
    lines.push("-- Conflicts --");
    for (const c of result.conflicts) {
      lines.push(`  - ${c.relative_path}: ${c.reason}`);
    }
    lines.push("");
  }
  if (result.actions.length) {
    lines.push("-- Actions --");
    for (const a of result.actions) {
      lines.push(`  - ${a.relative_path}: ${a.action}`);
    }
    lines.push("");
  }
  lines.push(result.ok ? "Result: OK (no conflicts; dry-run only — no files written)" : "Result: BLOCKED");
  return lines.join("\n");
}

module.exports = {
  TEMPLATE_VERSION,
  PROJECT_FILE_SLOTS,
  containsUnredactedSecretShape,
  scrubProjectFileContent,
  buildExportBundle,
  dryRunImport,
  formatDryRunReport,
  validateProjectSourcesForExport,
};
