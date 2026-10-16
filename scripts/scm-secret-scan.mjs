#!/usr/bin/env node
// SCM secret-scanning gate: scans Git history (not just the checked-out tree) for
// committed credentials and emits normalized, scanner-neutral evidence.
// Contract: docs/orchestrator/scm-secret-scan-contract.md
//
// Usage:
//   node scripts/scm-secret-scan.mjs --scope pr --base <rev> --head <rev> [--out <file>]
//   node scripts/scm-secret-scan.mjs --scope release --ref <rev> [--ref <rev> ...] [--out <file>]
//   node scripts/scm-secret-scan.mjs --validate <evidence.json>
//
// Last stdout line is always `status=<PASS|FAIL|BLOCKED|SKIPPED>`.
// Exit codes: PASS 0, FAIL 1, BLOCKED 2, SKIPPED 0 (same as release-trivy-gate.sh).
//
// Env:
//   GITLEAKS_BIN                  scanner binary (default "gitleaks")
//   SCM_SECRET_SCAN_CONFIG        scanner config (default <repo>/.gitleaks.toml)
//   SCM_SECRET_SCAN_BASELINE      suppression baseline (default <repo>/.scm-secret-scan-baseline.json)
//   SCM_SECRET_SCAN_SKIP_REASON   operator opt-out, honored only when the scanner is missing
//   SCM_SECRET_SCAN_NOW           ISO date used for suppression expiry (default: today, UTC)
//
// Secret values are never read into evidence or logs: the scanner runs with full
// redaction and only rule id, commit, file, line and the scanner fingerprint are kept.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CONTRACT_VERSION = 1;
export const BASELINE_VERSION = 1;
export const ADAPTER = Object.freeze({ name: "gitleaks", adapter_version: 1, supported_major: 8 });
export const STATUSES = Object.freeze(["PASS", "FAIL", "BLOCKED", "SKIPPED"]);
export const SCOPES = Object.freeze(["pr", "release"]);
const EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2, SKIPPED: 0 };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class GateStop extends Error {
  constructor(status, reasonCode, detail) {
    super(detail || reasonCode);
    this.status = status;
    this.reasonCode = reasonCode;
  }
}

const blocked = (reasonCode, detail) => new GateStop("BLOCKED", reasonCode, detail);

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { rc: res.error ? null : res.status, stdout: res.stdout || "", stderr: res.stderr || "", error: res.error };
}

function git(repo, args) {
  return run("git", ["-C", repo, ...args]);
}

export function parseArgs(argv) {
  const out = { refs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    const needValue = () => {
      if (value === undefined || value.startsWith("--")) throw blocked("invalid_arguments", `${flag} needs a value`);
      i += 1;
      return value;
    };
    if (flag === "--scope") out.scope = needValue();
    else if (flag === "--base") out.base = needValue();
    else if (flag === "--head") out.head = needValue();
    else if (flag === "--ref") out.refs.push(needValue());
    else if (flag === "--out") out.out = needValue();
    else if (flag === "--repo") out.repo = needValue();
    else if (flag === "--validate") out.validate = needValue();
    else throw blocked("invalid_arguments", `unknown argument ${flag}`);
  }
  if (out.validate) return out;
  if (!SCOPES.includes(out.scope)) throw blocked("invalid_arguments", "--scope must be pr or release");
  if (out.scope === "pr" && (!out.base || !out.head || out.refs.length)) {
    throw blocked("invalid_arguments", "pr scope needs --base and --head only");
  }
  if (out.scope === "release" && (!out.refs.length || out.base || out.head)) {
    throw blocked("invalid_arguments", "release scope needs one or more --ref");
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FINGERPRINT_RE = /^([0-9a-f]{40}):(.+):([a-z0-9][a-z0-9-]*):(\d+)$/;
const SUPPRESSION_KEYS = ["rule_id", "finding_fingerprint", "justification", "owner", "created_at", "expires_at", "scope"];

function validDate(value) {
  return typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Validate a suppression baseline; returns a list of problems (empty when valid). */
export function validateBaseline(baseline) {
  const errors = [];
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) return ["baseline must be an object"];
  const extra = Object.keys(baseline).filter((key) => !["scm_secret_scan_baseline_version", "suppressions"].includes(key));
  if (extra.length) errors.push(`unknown baseline keys: ${extra.join(", ")}`);
  if (baseline.scm_secret_scan_baseline_version !== BASELINE_VERSION) errors.push("unsupported baseline version");
  if (!Array.isArray(baseline.suppressions)) return [...errors, "suppressions must be an array"];
  const seen = new Set();
  baseline.suppressions.forEach((entry, index) => {
    const at = `suppressions[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    // Unknown keys are rejected so a raw value cannot ride along in the baseline.
    const unknown = Object.keys(entry).filter((key) => !SUPPRESSION_KEYS.includes(key));
    if (unknown.length) errors.push(`${at} unknown keys: ${unknown.join(", ")}`);
    const match = typeof entry.finding_fingerprint === "string" ? FINGERPRINT_RE.exec(entry.finding_fingerprint) : null;
    if (!match) errors.push(`${at}.finding_fingerprint must be <40-hex commit>:<file>:<rule>:<line>`);
    if (typeof entry.rule_id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(entry.rule_id)) errors.push(`${at}.rule_id invalid`);
    else if (match && match[3] !== entry.rule_id) errors.push(`${at}.rule_id does not match the fingerprint`);
    if (match && /[*?[\]]/.test(match[2])) errors.push(`${at}.finding_fingerprint must not contain wildcards`);
    if (typeof entry.justification !== "string" || entry.justification.trim().length < 10) errors.push(`${at}.justification must be at least 10 characters`);
    if (typeof entry.owner !== "string" || entry.owner.trim() === "") errors.push(`${at}.owner required`);
    if (!validDate(entry.created_at)) errors.push(`${at}.created_at must be YYYY-MM-DD`);
    if (entry.expires_at !== null && entry.expires_at !== undefined && !validDate(entry.expires_at)) errors.push(`${at}.expires_at must be YYYY-MM-DD or null`);
    if (!Array.isArray(entry.scope) || entry.scope.length === 0 || entry.scope.some((scope) => !SCOPES.includes(scope))) {
      errors.push(`${at}.scope must be a non-empty subset of ${SCOPES.join(", ")}`);
    }
    if (typeof entry.finding_fingerprint === "string") {
      if (seen.has(entry.finding_fingerprint)) errors.push(`${at} duplicates an earlier fingerprint`);
      seen.add(entry.finding_fingerprint);
    }
  });
  return errors;
}

/** Apply suppressions; expired entries never suppress and fail evaluation until reviewed. */
export function applyBaseline(findings, baseline, scope, today) {
  const expired = baseline.suppressions.filter((entry) => entry.expires_at && entry.expires_at < today);
  const active = new Map(
    baseline.suppressions
      .filter((entry) => !(entry.expires_at && entry.expires_at < today) && entry.scope.includes(scope))
      .map((entry) => [entry.finding_fingerprint, entry]),
  );
  const open = [];
  let suppressed = 0;
  for (const finding of findings) {
    const entry = active.get(finding.fingerprint);
    if (entry && entry.rule_id === finding.rule_id) suppressed += 1;
    else open.push(finding);
  }
  return { open, suppressed, expired: expired.map((entry) => entry.finding_fingerprint) };
}

function resolveScanner(bin) {
  const version = run(bin, ["version"]);
  if (version.error && version.error.code === "ENOENT") return { missing: true };
  const help = run(bin, ["--help"]);
  const versionLine = version.stdout.trim().split("\n")[0] || "";
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(versionLine);
  if (version.rc !== 0 || !match) throw blocked("scanner_invalid", "scanner did not report a version");
  if (help.rc !== 0 || !/gitleaks/i.test(help.stdout + help.stderr)) throw blocked("scanner_invalid", "scanner --help does not identify gitleaks");
  if (Number(match[1]) !== ADAPTER.supported_major) throw blocked("scanner_unsupported_version", `gitleaks ${versionLine} is not major ${ADAPTER.supported_major}`);
  return { missing: false, version: versionLine.replace(/^v/, "") };
}

function resolveCommit(repo, ref) {
  const res = git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (res.rc !== 0) throw blocked("ref_unresolvable", `cannot resolve ${ref}`);
  return res.stdout.trim();
}

function repoIdentity(repo) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const remote = git(repo, ["config", "--get", "remote.origin.url"]).stdout.trim();
  if (!remote) return path.basename(repo);
  try {
    const url = new URL(remote);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return remote.replace(/^[^@/]+@/, "");
  }
}

function normalizeFindings(raw) {
  if (!Array.isArray(raw)) throw blocked("scanner_output_invalid", "scanner report is not a list");
  return raw.map((item) => {
    if (!item || typeof item.RuleID !== "string" || typeof item.Fingerprint !== "string") {
      throw blocked("scanner_output_invalid", "scanner finding lacks rule or fingerprint");
    }
    // Only location fields are kept; Secret, Match, Line and author data are dropped.
    return {
      rule_id: item.RuleID,
      commit: item.Commit,
      file: item.File,
      line: item.StartLine,
      fingerprint: item.Fingerprint,
    };
  });
}

function countByRule(findings) {
  const counts = {};
  for (const finding of findings) counts[finding.rule_id] = (counts[finding.rule_id] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function today() {
  const override = process.env.SCM_SECRET_SCAN_NOW;
  if (override) {
    if (!validDate(override)) throw blocked("invalid_arguments", "SCM_SECRET_SCAN_NOW must be YYYY-MM-DD");
    return override;
  }
  return new Date().toISOString().slice(0, 10);
}

function trimmed(value) {
  return (value || "").trim();
}

/** Run the gate; never throws. Returns the evidence object. */
export function scan(args) {
  const repo = path.resolve(args.repo || process.cwd());
  const evidence = {
    scm_secret_scan_version: CONTRACT_VERSION,
    scope: args.scope,
    scanner: { name: ADAPTER.name, adapter_version: ADAPTER.adapter_version, version: null, config_path: null, config_sha256: null },
    source: { repo: null, base_ref: args.base || null, head_ref: args.head || null, refs: [], commit_hash: null, log_range: null, commits_scanned: null },
    baseline: { path: null, sha256: null, entries: null, expired: [] },
    result: { status: "BLOCKED", reason_code: null, findings_total: 0, rules_triggered: {}, suppressed_total: 0, skip_reason: null },
    findings: [],
    scanner_report_sha256: null,
    generated_at: new Date().toISOString(),
  };
  let workDir = null;
  try {
    if (git(repo, ["rev-parse", "--git-dir"]).rc !== 0) throw blocked("not_a_git_repository");
    evidence.source.repo = repoIdentity(repo);
    if (git(repo, ["rev-parse", "--is-shallow-repository"]).stdout.trim() !== "false") {
      throw blocked("shallow_history", "history is truncated; fetch full history before scanning");
    }

    let logOpts;
    if (args.scope === "pr") {
      const base = resolveCommit(repo, args.base);
      const head = resolveCommit(repo, args.head);
      evidence.source.refs = [{ ref: args.base, commit: base }, { ref: args.head, commit: head }];
      evidence.source.commit_hash = head;
      logOpts = `${base}..${head}`;
    } else {
      evidence.source.refs = args.refs.map((ref) => ({ ref, commit: resolveCommit(repo, ref) }));
      evidence.source.head_ref = args.refs[0];
      evidence.source.commit_hash = evidence.source.refs[0].commit;
      logOpts = evidence.source.refs.map((entry) => entry.commit).join(" ");
    }
    evidence.source.log_range = logOpts;
    const count = git(repo, ["rev-list", "--count", ...logOpts.split(" ")]);
    if (count.rc !== 0) throw blocked("ref_unresolvable", "cannot enumerate commits in scope");
    evidence.source.commits_scanned = Number(count.stdout.trim());
    if (evidence.source.commits_scanned === 0) throw blocked("empty_scope", "no commits in scope");

    const bin = process.env.GITLEAKS_BIN || "gitleaks";
    const scanner = resolveScanner(bin);
    if (scanner.missing) {
      const reason = trimmed(process.env.SCM_SECRET_SCAN_SKIP_REASON);
      if (reason) {
        evidence.result.skip_reason = reason;
        throw new GateStop("SKIPPED", "operator_skip", "scanner missing; operator skip reason recorded");
      }
      throw blocked("scanner_missing", `${bin} not found`);
    }
    evidence.scanner.version = scanner.version;

    const configPath = path.resolve(process.env.SCM_SECRET_SCAN_CONFIG || path.join(REPO_ROOT, ".gitleaks.toml"));
    if (!fs.existsSync(configPath)) throw blocked("config_missing", "scanner config not found");
    evidence.scanner.config_path = path.relative(REPO_ROOT, configPath) || configPath;
    evidence.scanner.config_sha256 = sha256(fs.readFileSync(configPath));

    const baselinePath = path.resolve(process.env.SCM_SECRET_SCAN_BASELINE || path.join(REPO_ROOT, ".scm-secret-scan-baseline.json"));
    if (!fs.existsSync(baselinePath)) throw blocked("baseline_missing", "suppression baseline not found");
    const baselineText = fs.readFileSync(baselinePath, "utf8");
    let baseline;
    try {
      baseline = JSON.parse(baselineText);
    } catch {
      throw blocked("baseline_invalid", "baseline is not valid JSON");
    }
    const baselineErrors = validateBaseline(baseline);
    if (baselineErrors.length) throw blocked("baseline_invalid", baselineErrors.join("; "));
    evidence.baseline.path = path.relative(REPO_ROOT, baselinePath) || baselinePath;
    evidence.baseline.sha256 = sha256(baselineText);
    evidence.baseline.entries = baseline.suppressions.length;

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scm-secret-scan-"));
    const reportPath = path.join(workDir, "report.json");
    const ignoreDir = path.join(workDir, "no-ignore");
    fs.mkdirSync(ignoreDir);
    // Inline `gitleaks:allow` comments and .gitleaksignore files are disabled: the
    // versioned baseline is the only suppression path.
    const res = run(bin, [
      "git", "--no-banner", "--no-color", "--log-level", "error", "--redact",
      "--ignore-gitleaks-allow", "--gitleaks-ignore-path", ignoreDir,
      "--config", configPath, "--report-format", "json", "--report-path", reportPath,
      "--exit-code", "1", `--log-opts=${logOpts}`, repo,
    ]);
    if (res.rc !== 0 && res.rc !== 1) throw blocked("scanner_error", `scanner exited ${res.rc}`);
    if (!fs.existsSync(reportPath)) throw blocked("scanner_output_invalid", "scanner wrote no report");
    const reportText = fs.readFileSync(reportPath, "utf8");
    evidence.scanner_report_sha256 = sha256(reportText);
    let raw;
    try {
      raw = JSON.parse(reportText);
    } catch {
      throw blocked("scanner_output_invalid", "scanner report is not JSON");
    }
    const findings = normalizeFindings(raw);
    if ((res.rc === 1) !== (findings.length > 0)) throw blocked("scanner_output_invalid", "scanner exit code disagrees with its report");

    const { open, suppressed, expired } = applyBaseline(findings, baseline, args.scope, today());
    evidence.findings = open;
    evidence.baseline.expired = expired;
    evidence.result.findings_total = open.length;
    evidence.result.rules_triggered = countByRule(open);
    evidence.result.suppressed_total = suppressed;
    if (open.length) throw new GateStop("FAIL", "secrets_detected");
    if (expired.length) throw new GateStop("FAIL", "expired_suppression");
    evidence.result.status = "PASS";
    evidence.result.reason_code = suppressed ? "clean_with_suppressions" : "clean";
  } catch (error) {
    if (!(error instanceof GateStop)) {
      evidence.result.status = "BLOCKED";
      evidence.result.reason_code = "internal_error";
      evidence.result.detail = "unexpected gate error";
    } else {
      evidence.result.status = error.status;
      evidence.result.reason_code = error.reasonCode;
      if (error.message !== error.reasonCode) evidence.result.detail = error.message;
    }
  } finally {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
  return seal(evidence);
}

function seal(evidence) {
  const { evidence_hash: _ignored, ...body } = evidence;
  return { ...body, evidence_hash: sha256(JSON.stringify(body)) };
}

/** Validate an evidence document against the contract; returns problems (empty when valid). */
export function validateEvidence(doc) {
  const errors = [];
  const need = (cond, message) => { if (!cond) errors.push(message); };
  need(doc && typeof doc === "object", "evidence must be an object");
  if (errors.length) return errors;
  need(doc.scm_secret_scan_version === CONTRACT_VERSION, "scm_secret_scan_version must be 1");
  need(SCOPES.includes(doc.scope), "scope must be pr or release");
  need(doc.scanner && doc.scanner.name === ADAPTER.name, "scanner.name must be gitleaks");
  need(doc.source && typeof doc.source === "object", "source required");
  need(doc.result && STATUSES.includes(doc.result.status), "result.status must be PASS|FAIL|BLOCKED|SKIPPED");
  need(doc.result && typeof doc.result.reason_code === "string" && doc.result.reason_code !== "", "result.reason_code required");
  need(Array.isArray(doc.findings), "findings must be a list");
  need(typeof doc.evidence_hash === "string", "evidence_hash required");
  if (errors.length) return errors;
  const { status } = doc.result;
  if (status === "PASS" || status === "FAIL") {
    need(typeof doc.scanner.version === "string", "scanner.version required for PASS/FAIL");
    need(/^[0-9a-f]{40}$/.test(doc.source.commit_hash || ""), "source.commit_hash required for PASS/FAIL");
    need(Number.isInteger(doc.source.commits_scanned) && doc.source.commits_scanned > 0, "commits_scanned must be > 0 for PASS/FAIL");
    need(/^[0-9a-f]{64}$/.test(doc.scanner.config_sha256 || ""), "scanner.config_sha256 required for PASS/FAIL");
    need(/^[0-9a-f]{64}$/.test(doc.scanner_report_sha256 || ""), "scanner_report_sha256 required for PASS/FAIL");
  }
  if (status === "PASS") need(doc.result.findings_total === 0 && doc.findings.length === 0, "PASS cannot carry findings");
  if (status === "FAIL") need(doc.result.findings_total > 0 || doc.baseline.expired.length > 0, "FAIL needs findings or expired suppressions");
  if (status === "SKIPPED") need(typeof doc.result.skip_reason === "string" && doc.result.skip_reason.trim() !== "", "SKIPPED needs skip_reason");
  need(doc.result.findings_total === doc.findings.length, "findings_total must equal findings length");
  for (const finding of doc.findings) {
    const keys = Object.keys(finding).sort().join(",");
    need(keys === "commit,file,fingerprint,line,rule_id", `finding has unexpected fields: ${keys}`);
  }
  const { evidence_hash: hash, ...body } = doc;
  need(hash === sha256(JSON.stringify(body)), "evidence_hash does not match content");
  return errors;
}

function summarize(evidence) {
  const { result, source, scanner } = evidence;
  const lines = [
    `scm-secret-scan: scope=${evidence.scope} status=${result.status} reason=${result.reason_code}`,
    `scm-secret-scan: scanner=${scanner.name}@${scanner.version || "unavailable"} commit=${source.commit_hash || "n/a"} commits_scanned=${source.commits_scanned ?? "n/a"}`,
    `scm-secret-scan: findings=${result.findings_total} suppressed=${result.suppressed_total} rules=${JSON.stringify(result.rules_triggered)}`,
  ];
  if (result.detail) lines.push(`scm-secret-scan: detail=${result.detail}`);
  if (result.skip_reason) lines.push(`scm-secret-scan: SKIPPED by operator; reason=${result.skip_reason}; this run has NO history scan evidence`);
  for (const finding of evidence.findings) {
    lines.push(`scm-secret-scan: finding rule=${finding.rule_id} commit=${finding.commit} file=${finding.file} line=${finding.line}`);
  }
  for (const fingerprint of evidence.baseline.expired) lines.push(`scm-secret-scan: expired suppression needs review: ${fingerprint}`);
  return lines.join("\n");
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`scm-secret-scan: BLOCKED — ${error.message}\n`);
    process.stdout.write("status=BLOCKED\n");
    return EXIT.BLOCKED;
  }
  if (args.validate) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(args.validate, "utf8"));
    } catch {
      process.stderr.write("scm-secret-scan: cannot read evidence JSON\n");
      return EXIT.BLOCKED;
    }
    const errors = validateEvidence(doc);
    for (const error of errors) process.stderr.write(`scm-secret-scan: invalid evidence: ${error}\n`);
    process.stdout.write(errors.length ? "evidence=INVALID\n" : "evidence=VALID\n");
    return errors.length ? EXIT.BLOCKED : 0;
  }
  const evidence = scan(args);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  process.stderr.write(`${summarize(evidence)}\n`);
  process.stdout.write(`status=${evidence.result.status}\n`);
  return EXIT[evidence.result.status];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
