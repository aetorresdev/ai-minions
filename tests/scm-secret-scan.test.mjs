// Contract tests for scripts/scm-secret-scan.mjs.
// Fixture secrets are synthetic: generated at runtime from a fixed-seed PRNG and
// assembled from fragments, so this file itself carries no secret-shaped literal.
// Scanner-backed tests need a real gitleaks (GITLEAKS_BIN or PATH). With
// SCM_SECRET_SCAN_REQUIRE_SCANNER=1 (set in CI) a missing scanner fails the suite
// instead of skipping.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import crypto from "node:crypto";
import {
  validateBaseline, validateEvidence, applyBaseline, validateScannerConfig, SCANNER_CONFIG_SHA256,
} from "../scripts/scm-secret-scan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const GATE = path.join(REPO_ROOT, "scripts", "scm-secret-scan.mjs");
const GITLEAKS = process.env.GITLEAKS_BIN || "gitleaks";
const HAVE_SCANNER = spawnSync(GITLEAKS, ["version"], { encoding: "utf8" }).status === 0;
const REQUIRE_SCANNER = process.env.SCM_SECRET_SCAN_REQUIRE_SCANNER === "1";
const needsScanner = HAVE_SCANNER || REQUIRE_SCANNER ? {} : { skip: "gitleaks not installed (set GITLEAKS_BIN)" };
// Per-test skip so a missing scanner shows up in the runner's skipped count.
const sit = (name, fn) => it(name, needsScanner, fn);

function tokens(seed) {
  let state = seed >>> 0;
  const rnd = () => (state = (state * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const pick = (alphabet, n) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
  const UP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const AN = UP + UP.toLowerCase() + "0123456789";
  const URLSAFE = AN + "-_";
  const PEM = "PRIVATE " + "KEY-----";
  return {
    aws: "AK" + "IA" + pick(UP + "234567", 16),
    github: "gh" + "p_" + pick(AN, 36),
    openai: "sk-" + "proj-" + pick(URLSAFE, 74) + "T3Blbk" + "FJ" + pick(URLSAFE, 74),
    anthropic: "sk-" + "ant-api03-" + pick(URLSAFE, 93) + "AA",
    bearer: pick(AN, 40),
    pem: `-----BEGIN RSA ${PEM}\n${Array.from({ length: 6 }, () => pick(AN + "+/", 64)).join("\n")}\n-----END RSA ${PEM}`,
    dotenv: pick(AN, 32),
  };
}

// One file per supported class, with the rule id the adapter is expected to report.
function fixtureFiles(t) {
  return {
    "config/aws.ini": { body: `aws_access_key_id = ${t.aws}\n`, rule: "aws-access-token", secret: t.aws },
    "scripts/gh.yml": { body: `token: ${t.github}\n`, rule: "github-pat", secret: t.github },
    "openai.txt": { body: `OPENAI_API_KEY=${t.openai}\n`, rule: "openai-api-key", secret: t.openai },
    "anthropic.txt": { body: `key=${t.anthropic}\n`, rule: "anthropic-api-key", secret: t.anthropic },
    "call.sh": { body: `curl -H "Authorization: Bearer ${t.bearer}" https://api.invalid\n`, rule: "curl-auth-header", secret: t.bearer },
    "keys/id.pem": { body: `${t.pem}\n`, rule: "private-key", secret: t.pem.split("\n")[1] },
    ".env": { body: `DB_PASSWORD=${t.dotenv}\n`, rule: "dotenv-secret-assignment", secret: t.dotenv },
  };
}

function sh(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scm-secret-scan-repo-"));
  sh(dir, ["init", "-q", "-b", "main"]);
  sh(dir, ["config", "user.email", "fixture@example.invalid"]);
  sh(dir, ["config", "user.name", "fixture"]);
  commit(dir, { "README.md": "fixture repo\n" }, "init");
  return dir;
}

function commit(dir, files, message, deletes = []) {
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  }
  for (const file of deletes) fs.rmSync(path.join(dir, file));
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-q", "-m", message]);
  return sh(dir, ["rev-parse", "HEAD"]);
}

function runGate(args, env = {}, gate = GATE) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scm-secret-scan-out-")), "evidence.json");
  const res = spawnSync(process.execPath, [gate, ...args, "--out", out], {
    encoding: "utf8",
    env: { ...process.env, GITLEAKS_BIN: GITLEAKS, SCM_SECRET_SCAN_SKIP_REASON: "", ...env },
  });
  const evidenceText = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  return {
    rc: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    status: res.stdout.trim().split("\n").pop(),
    evidenceText,
    evidence: evidenceText ? JSON.parse(evidenceText) : null,
  };
}

function assertNoSecrets(run, secrets) {
  for (const secret of secrets) {
    for (const [name, text] of [["stdout", run.stdout], ["stderr", run.stderr], ["evidence", run.evidenceText]]) {
      assert.ok(!text.includes(secret), `${name} leaked a fixture secret`);
    }
  }
}

function fakeScanner(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scm-secret-scan-fake-"));
  const bin = path.join(dir, "gitleaks");
  fs.writeFileSync(bin, `#!/usr/bin/env bash\n${script}\n`, { mode: 0o755 });
  return bin;
}

describe("PR scope", () => {
  sit("FAILs on a secret added and then deleted inside the PR range", () => {
    const repo = makeRepo();
    const base = sh(repo, ["rev-parse", "HEAD"]);
    const t = tokens(11);
    const added = commit(repo, { "app/settings.yml": `token: ${t.github}\n` }, "add setting");
    const head = commit(repo, {}, "remove setting", ["app/settings.yml"]);
    assert.equal(sh(repo, ["ls-files", "app/settings.yml"]), "", "final tree must not contain the file");

    const run = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo]);
    assert.equal(run.status, "status=FAIL");
    assert.equal(run.rc, 1);
    assert.equal(run.evidence.result.reason_code, "secrets_detected");
    assert.deepEqual(run.evidence.result.rules_triggered, { "github-pat": 1 });
    assert.equal(run.evidence.findings[0].commit, added);
    assert.equal(run.evidence.findings[0].file, "app/settings.yml");
    assert.deepEqual(validateEvidence(run.evidence), []);
    assertNoSecrets(run, [t.github]);
  });

  sit("does not report history outside the PR range", () => {
    const repo = makeRepo();
    const t = tokens(12);
    commit(repo, { "old.yml": `token: ${t.github}\n` }, "old leak");
    const base = commit(repo, {}, "cleanup", ["old.yml"]);
    const head = commit(repo, { "src/a.js": "module.exports = 1;\n" }, "feature");
    const run = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo]);
    assert.equal(run.status, "status=PASS");
    assert.equal(run.evidence.source.commits_scanned, 1);
  });
});

describe("release scope", () => {
  sit("FAILs on a secret absent from the final tree but reachable in history", () => {
    const repo = makeRepo();
    const t = tokens(21);
    commit(repo, { "deploy/.env": `DB_PASSWORD=${t.dotenv}\n`, "deploy/aws.ini": `aws_access_key_id = ${t.aws}\n` }, "deploy config");
    const head = commit(repo, { "deploy/README.md": "use the vault\n" }, "remove secrets", ["deploy/.env", "deploy/aws.ini"]);

    // The checked-out tree alone is clean: a tree-only scan would report PASS.
    const tree = spawnSync(GITLEAKS, ["dir", "--no-banner", "--redact", "--exit-code", "1", repo], { encoding: "utf8" });
    assert.equal(tree.status, 0, "tree-only scan should be clean; the history scan below must still fail");

    const run = runGate(["--scope", "release", "--ref", head, "--repo", repo]);
    assert.equal(run.status, "status=FAIL");
    assert.equal(run.rc, 1);
    assert.equal(run.evidence.result.rules_triggered["aws-access-token"], 1);
    assert.equal(run.evidence.result.rules_triggered["dotenv-secret-assignment"], 1);
    assert.ok(run.evidence.findings.every((f) => f.file.startsWith("deploy/")));
    assert.equal(run.evidence.source.commit_hash, head);
    assert.deepEqual(validateEvidence(run.evidence), []);
    assertNoSecrets(run, [t.dotenv, t.aws]);
  });

  sit("scans every listed ref", () => {
    const repo = makeRepo();
    const main = sh(repo, ["rev-parse", "HEAD"]);
    sh(repo, ["checkout", "-q", "-b", "side"]);
    const t = tokens(22);
    const side = commit(repo, { "side.txt": `key=${t.anthropic}\n` }, "side leak");
    sh(repo, ["checkout", "-q", "main"]);
    assert.equal(runGate(["--scope", "release", "--ref", main, "--repo", repo]).status, "status=PASS");
    const both = runGate(["--scope", "release", "--ref", main, "--ref", side, "--repo", repo]);
    assert.equal(both.status, "status=FAIL");
    assert.deepEqual(both.evidence.result.rules_triggered, { "anthropic-api-key": 1 });
  });

  sit("PASSes a clean history with scanner, version, ref and hash evidence", () => {
    const repo = makeRepo();
    const head = commit(repo, { "src/index.js": "console.log('ok');\n" }, "code");
    const run = runGate(["--scope", "release", "--ref", "main", "--repo", repo]);
    assert.equal(run.status, "status=PASS");
    assert.equal(run.rc, 0);
    const ev = run.evidence;
    assert.equal(ev.result.reason_code, "clean");
    assert.equal(ev.scanner.name, "gitleaks");
    assert.match(ev.scanner.version, /^8\.\d+\.\d+$/);
    assert.match(ev.scanner.config_sha256, /^[0-9a-f]{64}$/);
    assert.match(ev.scanner_report_sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(ev.source.refs, [{ ref: "main", commit: head }]);
    assert.equal(ev.source.commits_scanned, 2);
    assert.match(ev.evidence_hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(validateEvidence(ev), []);
  });

  sit("refuses a shallow clone instead of scanning truncated history", () => {
    const repo = makeRepo();
    commit(repo, { "a.txt": "a\n" }, "a");
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), "scm-secret-scan-shallow-"));
    sh(clone, ["clone", "-q", "--depth", "1", `file://${repo}`, "."]);
    const run = runGate(["--scope", "release", "--ref", "HEAD", "--repo", clone]);
    assert.equal(run.status, "status=BLOCKED");
    assert.equal(run.evidence.result.reason_code, "shallow_history");
  });
});

describe("synthetic fixture coverage", () => {
  sit("detects every supported secret class with the expected rule", () => {
    const repo = makeRepo();
    const base = sh(repo, ["rev-parse", "HEAD"]);
    const files = fixtureFiles(tokens(31));
    const head = commit(repo, Object.fromEntries(Object.entries(files).map(([file, f]) => [file, f.body])), "fixtures");
    const run = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo]);
    assert.equal(run.status, "status=FAIL");
    const hits = new Set(run.evidence.findings.map((f) => `${f.file}|${f.rule_id}`));
    for (const [file, f] of Object.entries(files)) assert.ok(hits.has(`${file}|${f.rule}`), `${file} should hit ${f.rule}`);
    assertNoSecrets(run, Object.values(files).map((f) => f.secret));
  });
});

describe("baseline suppressions", () => {
  function leakyRepo() {
    const repo = makeRepo();
    const base = sh(repo, ["rev-parse", "HEAD"]);
    const t = tokens(41);
    const head = commit(repo, { "fixtures/token.yml": `token: ${t.github}\n` }, "fixture");
    return { repo, base, head };
  }
  function baselineFile(suppressions) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scm-secret-scan-baseline-")), "baseline.json");
    fs.writeFileSync(file, JSON.stringify({ scm_secret_scan_baseline_version: 1, suppressions }));
    return file;
  }
  const entry = (fingerprint, extra = {}) => ({
    rule_id: "github-pat",
    finding_fingerprint: fingerprint,
    justification: "synthetic fixture token, never valid",
    owner: "security",
    created_at: "2026-01-01",
    expires_at: null,
    scope: ["pr", "release"],
    ...extra,
  });

  sit("suppresses an exact fingerprint and records the count", () => {
    const { repo, base, head } = leakyRepo();
    const first = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo]);
    const fingerprint = first.evidence.findings[0].fingerprint;
    const run = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo], {
      SCM_SECRET_SCAN_BASELINE: baselineFile([entry(fingerprint)]),
    });
    assert.equal(run.status, "status=PASS");
    assert.equal(run.evidence.result.reason_code, "clean_with_suppressions");
    assert.equal(run.evidence.result.suppressed_total, 1);
  });

  sit("does not let an old suppression cover the same file in a new commit", () => {
    const { repo, base, head } = leakyRepo();
    const old = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo]).evidence.findings[0].fingerprint;
    const t = tokens(42);
    const next = commit(repo, { "fixtures/token.yml": `token: ${t.github}\n` }, "new fixture");
    const run = runGate(["--scope", "pr", "--base", head, "--head", next, "--repo", repo], {
      SCM_SECRET_SCAN_BASELINE: baselineFile([entry(old)]),
    });
    assert.equal(run.status, "status=FAIL");
    assert.equal(run.evidence.result.suppressed_total, 0);
  });

  sit("does not apply a suppression outside its scope", () => {
    const { repo, base, head } = leakyRepo();
    const fingerprint = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo]).evidence.findings[0].fingerprint;
    const run = runGate(["--scope", "release", "--ref", head, "--repo", repo], {
      SCM_SECRET_SCAN_BASELINE: baselineFile([entry(fingerprint, { scope: ["pr"] })]),
    });
    assert.equal(run.status, "status=FAIL");
  });

  sit("FAILs while an expired suppression is unreviewed, even if it matches", () => {
    const { repo, base, head } = leakyRepo();
    const fingerprint = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo]).evidence.findings[0].fingerprint;
    const run = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo], {
      SCM_SECRET_SCAN_BASELINE: baselineFile([entry(fingerprint, { expires_at: "2026-02-01" })]),
      SCM_SECRET_SCAN_NOW: "2026-03-01",
    });
    assert.equal(run.status, "status=FAIL");
    assert.equal(run.evidence.result.findings_total, 1);
  });

  sit("FAILs on an expired entry even when every finding is otherwise clean", () => {
    const repo = makeRepo();
    const run = runGate(["--scope", "release", "--ref", "main", "--repo", repo], {
      SCM_SECRET_SCAN_BASELINE: baselineFile([entry(`${"a".repeat(40)}:x.yml:github-pat:1`, { expires_at: "2026-02-01" })]),
      SCM_SECRET_SCAN_NOW: "2026-03-01",
    });
    assert.equal(run.status, "status=FAIL");
    assert.equal(run.evidence.result.reason_code, "expired_suppression");
    assert.deepEqual(validateEvidence(run.evidence), []);
  });

  sit("BLOCKs a broad or malformed baseline", () => {
    const repo = makeRepo();
    for (const bad of [
      [entry("*")],
      [entry(`${"a".repeat(40)}:fixtures/*:github-pat:1`)],
      [entry(`${"a".repeat(40)}:x.yml:github-pat:1`, { secret: "raw-value" })],
      [entry(`${"a".repeat(40)}:x.yml:github-pat:1`, { justification: "" })],
    ]) {
      const run = runGate(["--scope", "release", "--ref", "main", "--repo", repo], { SCM_SECRET_SCAN_BASELINE: baselineFile(bad) });
      assert.equal(run.status, "status=BLOCKED");
      assert.equal(run.evidence.result.reason_code, "baseline_invalid");
    }
  });
});

// Merge fixtures: the token exists only in a merge commit's own changes and is
// deleted afterwards, so neither parent nor the final tree carries it.
function mergeRepo(kind, seed) {
  const repo = makeRepo();
  const base = sh(repo, ["rev-parse", "HEAD"]);
  const t = tokens(seed);
  const token = `token: ${t.github}\n`;
  if (kind === "conflict") {
    sh(repo, ["checkout", "-q", "-b", "a"]);
    commit(repo, { "f.txt": "A\n" }, "a");
    sh(repo, ["checkout", "-q", "-b", "b", base]);
    commit(repo, { "f.txt": "B\n" }, "b");
    sh(repo, ["checkout", "-q", "a"]);
    spawnSync("git", ["merge", "-q", "b"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "f.txt"), token);
    sh(repo, ["add", "-A"]);
    sh(repo, ["commit", "-q", "-m", "resolve"]);
    const merge = sh(repo, ["rev-parse", "HEAD"]);
    const head = commit(repo, { "f.txt": "resolved\n" }, "cleanup");
    return { repo, base, merge, head, secret: t.github, file: "f.txt" };
  }
  const branches = kind === "octopus" ? ["a", "b", "c"] : ["a", "b"];
  for (const name of branches) {
    sh(repo, ["checkout", "-q", "-b", name, base]);
    commit(repo, { [`${name}.txt`]: `${name}\n` }, name);
  }
  sh(repo, ["checkout", "-q", "a"]);
  sh(repo, ["merge", "-q", "--no-ff", "--no-commit", ...branches.slice(1)]);
  fs.writeFileSync(path.join(repo, "evil.yml"), token);
  sh(repo, ["add", "-A"]);
  sh(repo, ["commit", "-q", "-m", "merge"]);
  const merge = sh(repo, ["rev-parse", "HEAD"]);
  const head = commit(repo, {}, "cleanup", ["evil.yml"]);
  return { repo, base, merge, head, secret: t.github, file: "evil.yml" };
}

describe("merge commits", () => {
  for (const [label, kind, seed] of [["clean merge", "two", 51], ["conflict resolution", "conflict", 52], ["octopus merge", "octopus", 53]]) {
    sit(`FAILs on a secret introduced by a ${label} and then deleted (pr scope)`, () => {
      const m = mergeRepo(kind, seed);
      const finalTree = sh(m.repo, ["ls-files", "-z"]).split("\0").filter(Boolean);
      assert.ok(finalTree.every((file) => !fs.readFileSync(path.join(m.repo, file), "utf8").includes(m.secret)), "final tree must be clean");
      // Counterexample: a plain range scan does not look at merge diffs.
      const plain = spawnSync(GITLEAKS, ["git", "--no-banner", "--redact", "--exit-code", "1", `--log-opts=${m.base}..${m.head}`, m.repo], { encoding: "utf8" });
      assert.equal(plain.status, 0, "plain range scan misses the merge-only secret");
      const run = runGate(["--scope", "pr", "--base", m.base, "--head", m.head, "--repo", m.repo]);
      assert.equal(run.status, "status=FAIL");
      assert.deepEqual(run.evidence.findings.map((f) => [f.rule_id, f.commit, f.file]), [["github-pat", m.merge, m.file]]);
      assert.equal(run.evidence.scanner.merge_diffs, "each-parent");
      assert.deepEqual(validateEvidence(run.evidence), []);
      assertNoSecrets(run, [m.secret]);
    });
    sit(`FAILs on a secret introduced by a ${label} and then deleted (release scope)`, () => {
      const m = mergeRepo(kind, seed + 10);
      const run = runGate(["--scope", "release", "--ref", m.head, "--repo", m.repo]);
      assert.equal(run.status, "status=FAIL");
      assert.deepEqual(run.evidence.findings.map((f) => f.commit), [m.merge]);
      assertNoSecrets(run, [m.secret]);
    });
  }

  sit("reports a branch secret at its own commit, not again at the merge that brings it in", () => {
    const repo = makeRepo();
    sh(repo, ["checkout", "-q", "-b", "feature"]);
    const t = tokens(71);
    const side = commit(repo, { "s.yml": `token: ${t.github}\n` }, "side");
    sh(repo, ["checkout", "-q", "main"]);
    commit(repo, { "x.txt": "x\n" }, "main work");
    sh(repo, ["merge", "-q", "--no-ff", "-m", "merge feature", "feature"]);
    const run = runGate(["--scope", "release", "--ref", "main", "--repo", repo]);
    assert.equal(run.status, "status=FAIL");
    assert.deepEqual(run.evidence.findings.map((f) => f.commit), [side]);
    assert.equal(run.evidence.result.merge_inherited_dropped, 1);
    assert.deepEqual(validateEvidence(run.evidence), []);
  });

  sit("does not charge a PR for history it merges in from its base", () => {
    const repo = makeRepo();
    const t = tokens(72);
    commit(repo, { "old.yml": `token: ${t.github}\n` }, "historical leak on main");
    sh(repo, ["checkout", "-q", "-b", "pr", "main~1"]);
    const base = sh(repo, ["rev-parse", "main"]);
    commit(repo, { "feature.js": "module.exports = 1;\n" }, "feature");
    sh(repo, ["merge", "-q", "--no-ff", "-m", "update branch", "main"]);
    const run = runGate(["--scope", "pr", "--base", base, "--head", "HEAD", "--repo", repo]);
    assert.equal(run.status, "status=PASS");
    assert.equal(run.evidence.result.merge_inherited_dropped, 1);
    assert.equal(runGate(["--scope", "release", "--ref", "HEAD", "--repo", repo]).status, "status=FAIL", "release scope still sees it");
  });

  // Parents hold only an example key header; the merge adds a full key block and a
  // later commit removes it. A matching first line must not count as inherited.
  function headerOnlyMergeRepo(seed) {
    const repo = makeRepo();
    const t = tokens(seed);
    const header = t.pem.split("\n")[0];
    const docs = `Example format:\n\n${header}\n...\n`;
    const base = commit(repo, { "docs/keys.md": docs }, "document key format");
    for (const name of ["a", "b"]) {
      sh(repo, ["checkout", "-q", "-b", name, base]);
      commit(repo, { [`${name}.txt`]: `${name}\n` }, name);
    }
    sh(repo, ["checkout", "-q", "a"]);
    sh(repo, ["merge", "-q", "--no-ff", "--no-commit", "b"]);
    fs.writeFileSync(path.join(repo, "docs/keys.md"), `${docs}\n${t.pem}\n`);
    sh(repo, ["add", "-A"]);
    sh(repo, ["commit", "-q", "-m", "merge"]);
    const merge = sh(repo, ["rev-parse", "HEAD"]);
    const head = commit(repo, { "docs/keys.md": docs }, "remove key");
    return { repo, base, merge, head, secret: t.pem.split("\n")[1] };
  }

  sit("keeps a multi-line secret added by a merge when parents only share its first line (pr scope)", () => {
    const m = headerOnlyMergeRepo(73);
    const run = runGate(["--scope", "pr", "--base", m.base, "--head", m.head, "--repo", m.repo]);
    assert.equal(run.status, "status=FAIL");
    assert.deepEqual(run.evidence.findings.map((f) => [f.rule_id, f.commit]), [["private-key", m.merge]]);
    assert.equal(run.evidence.result.merge_inherited_dropped, 0);
    assertNoSecrets(run, [m.secret]);
  });

  sit("keeps a multi-line secret added by a merge when parents only share its first line (release scope)", () => {
    const m = headerOnlyMergeRepo(74);
    const run = runGate(["--scope", "release", "--ref", m.head, "--repo", m.repo]);
    assert.equal(run.status, "status=FAIL");
    assert.deepEqual(run.evidence.findings.map((f) => [f.rule_id, f.commit]), [["private-key", m.merge]]);
    assert.equal(run.evidence.result.merge_inherited_dropped, 0);
  });

  sit("still treats a multi-line secret merged in unchanged from a branch as inherited", () => {
    const repo = makeRepo();
    sh(repo, ["checkout", "-q", "-b", "feature"]);
    const side = commit(repo, { "id.pem": `${tokens(75).pem}\n` }, "side key");
    sh(repo, ["checkout", "-q", "main"]);
    commit(repo, { "x.txt": "x\n" }, "main work");
    sh(repo, ["merge", "-q", "--no-ff", "-m", "merge feature", "feature"]);
    const run = runGate(["--scope", "release", "--ref", "main", "--repo", repo]);
    assert.deepEqual(run.evidence.findings.map((f) => [f.rule_id, f.commit]), [["private-key", side]]);
    assert.equal(run.evidence.result.merge_inherited_dropped, 1);
  });

  sit("PASSes merges that add no secret", () => {
    const repo = makeRepo();
    const base = sh(repo, ["rev-parse", "HEAD"]);
    for (const name of ["a", "b"]) {
      sh(repo, ["checkout", "-q", "-b", name, base]);
      commit(repo, { [`${name}.txt`]: `${name}\n` }, name);
    }
    sh(repo, ["checkout", "-q", "a"]);
    sh(repo, ["merge", "-q", "--no-ff", "-m", "merge", "b"]);
    const run = runGate(["--scope", "pr", "--base", base, "--head", "HEAD", "--repo", repo]);
    assert.equal(run.status, "status=PASS");
  });
});

describe("scanner config", () => {
  const shipped = fs.readFileSync(path.join(REPO_ROOT, ".gitleaks.toml"), "utf8");
  const TQ = "'".repeat(3);

  it("ships the pinned config with no location allowlists or extend", () => {
    assert.equal(crypto.createHash("sha256").update(shipped).digest("hex"), SCANNER_CONFIG_SHA256);
    assert.deepEqual(validateScannerConfig(shipped), []);
    assert.equal((shipped.match(/^\[\[rules\]\]$/gm) || []).length, 223);
  });

  it("rejects allowlists by path or commit, and [extend]", () => {
    for (const bad of [
      "[extend]\nuseDefault = true\n",
      `[allowlist]\npaths = [${TQ}.*${TQ}]\n`,
      "[[allowlists]]\ncommits = [\"abc\"]\n",
      `[[rules]]\nid = "x"\n[[rules.allowlists]]\n"paths" = [${TQ}fixtures/${TQ}]\n`,
      `rules.allowlist.paths = [${TQ}.*${TQ}]\n`,
    ]) {
      assert.ok(validateScannerConfig(bad).length > 0, `should reject: ${bad}`);
    }
  });

  sit("BLOCKs a config that differs from the pinned one, such as an added path allowlist", () => {
    const layout = fs.mkdtempSync(path.join(os.tmpdir(), "scm-secret-scan-layout-"));
    fs.mkdirSync(path.join(layout, "scripts"));
    fs.copyFileSync(GATE, path.join(layout, "scripts", "scm-secret-scan.mjs"));
    fs.copyFileSync(path.join(REPO_ROOT, ".scm-secret-scan-baseline.json"), path.join(layout, ".scm-secret-scan-baseline.json"));
    fs.writeFileSync(path.join(layout, ".gitleaks.toml"), `${shipped}\n[[allowlists]]\npaths = [${TQ}.*${TQ}]\n`);
    const repo = makeRepo();
    const base = sh(repo, ["rev-parse", "HEAD"]);
    const head = commit(repo, { "app.yml": `token: ${tokens(61).github}\n` }, "leak");
    const run = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo], {}, path.join(layout, "scripts", "scm-secret-scan.mjs"));
    assert.equal(run.status, "status=BLOCKED");
    assert.equal(run.evidence.result.reason_code, "config_unpinned");
  });

  sit("reports secrets in paths the upstream defaults would skip", () => {
    const repo = makeRepo();
    const base = sh(repo, ["rev-parse", "HEAD"]);
    const t = tokens(62);
    const files = {
      "node_modules/pkg/index.js": `const t = "${t.github}";\n`,
      "orchestrator/package-lock.json": `{"token": "${t.github}"}\n`,
      "docs/gitleaks.toml": `token = "${t.github}"\n`,
    };
    const head = commit(repo, files, "vendored");
    const run = runGate(["--scope", "pr", "--base", base, "--head", head, "--repo", repo]);
    assert.equal(run.status, "status=FAIL");
    assert.deepEqual(run.evidence.findings.map((f) => f.file).sort(), Object.keys(files).sort());
  });
});

describe("evidence validator rejects incomplete or contradictory evidence", () => {
  const rehash = (doc) => {
    const { evidence_hash: _drop, ...body } = doc;
    return { ...body, evidence_hash: crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex") };
  };
  const without = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
  const fp = `${"c".repeat(40)}:a.yml:github-pat:1`;

  sit("rejects rehashed documents with missing or contradictory fields", () => {
    const repo = makeRepo();
    const pass = runGate(["--scope", "release", "--ref", "main", "--repo", repo]).evidence;
    assert.deepEqual(validateEvidence(rehash(pass)), [], "the genuine document stays valid after rehash");
    const forged = {
      "baseline missing": without(pass, "baseline"),
      "refs missing": { ...pass, source: without(pass.source, "refs") },
      "log range missing": { ...pass, source: { ...pass.source, log_range: null } },
      "empty scanner version": { ...pass, scanner: { ...pass.scanner, version: "" } },
      "PASS with expired suppression": { ...pass, baseline: { ...pass.baseline, expired: [fp] } },
      "PASS with findings": {
        ...pass,
        findings: [{ rule_id: "github-pat", commit: "c".repeat(40), file: "a.yml", line: 1, fingerprint: fp }],
        result: { ...pass.result, findings_total: 1, rules_triggered: { "github-pat": 1 } },
      },
      "unpinned config hash": { ...pass, scanner: { ...pass.scanner, config_sha256: "d".repeat(64) } },
      "range not matching refs": { ...pass, source: { ...pass.source, log_range: "e".repeat(40) } },
      "merge diffs off": { ...pass, scanner: { ...pass.scanner, merge_diffs: "none" } },
      "rules_triggered mismatch": { ...pass, result: { ...pass.result, rules_triggered: { "github-pat": 1 } } },
      "unknown top-level field": { ...pass, extra: "x" },
      "BLOCKED with unknown reason": { ...pass, result: { ...pass.result, status: "BLOCKED", reason_code: "whatever" } },
    };
    for (const [name, doc] of Object.entries(forged)) {
      assert.ok(validateEvidence(rehash(doc)).length > 0, `${name} must be invalid`);
    }
  });

  sit("rejects malformed entries and unsupported scanner majors without throwing", () => {
    const repo = makeRepo();
    const pass = runGate(["--scope", "release", "--ref", "main", "--repo", repo]).evidence;
    const forged = {
      "null finding": { ...pass, findings: [null], result: { ...pass.result, findings_total: 1 } },
      "null ref": { ...pass, source: { ...pass.source, refs: [null] } },
      "scanner major 9": { ...pass, scanner: { ...pass.scanner, version: "9.0.0" } },
      "numeric scanner version": { ...pass, scanner: { ...pass.scanner, version: 8 } },
      "null source": { ...pass, source: null },
    };
    for (const [name, doc] of Object.entries(forged)) {
      let errors;
      assert.doesNotThrow(() => { errors = validateEvidence(rehash(doc)); }, `${name} must not throw`);
      assert.ok(errors.length > 0, `${name} must be invalid`);
    }
    for (const doc of [forged["null finding"], forged["null ref"], forged["scanner major 9"]]) {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scm-secret-scan-forged-")), "evidence.json");
      fs.writeFileSync(file, JSON.stringify(rehash(doc)));
      const res = spawnSync(process.execPath, [GATE, "--validate", file], { encoding: "utf8" });
      assert.equal(res.stdout.trim(), "evidence=INVALID");
      assert.equal(res.status, 2);
      assert.ok(!/TypeError|at .*\.mjs/.test(res.stderr), "no stack trace");
    }
  });
});

describe("fail-closed prerequisites", () => {
  it("BLOCKs when the scanner is missing", () => {
    const repo = makeRepo();
    const run = runGate(["--scope", "release", "--ref", "main", "--repo", repo], { GITLEAKS_BIN: "/nonexistent/gitleaks" });
    assert.equal(run.status, "status=BLOCKED");
    assert.equal(run.rc, 2);
    assert.equal(run.evidence.result.reason_code, "scanner_missing");
    assert.deepEqual(validateEvidence(run.evidence), []);
  });

  it("SKIPs only with a non-empty operator reason, and says so", () => {
    const repo = makeRepo();
    const blank = runGate(["--scope", "release", "--ref", "main", "--repo", repo], { GITLEAKS_BIN: "/nonexistent/gitleaks", SCM_SECRET_SCAN_SKIP_REASON: "   " });
    assert.equal(blank.status, "status=BLOCKED");
    const run = runGate(["--scope", "release", "--ref", "main", "--repo", repo], { GITLEAKS_BIN: "/nonexistent/gitleaks", SCM_SECRET_SCAN_SKIP_REASON: "offline laptop" });
    assert.equal(run.status, "status=SKIPPED");
    assert.equal(run.rc, 0);
    assert.equal(run.evidence.result.skip_reason, "offline laptop");
    assert.match(run.stderr, /SKIPPED by operator; reason=offline laptop/);
    assert.deepEqual(validateEvidence(run.evidence), []);
  });

  it("BLOCKs an executable that is not gitleaks", () => {
    const repo = makeRepo();
    for (const bin of ["/bin/true", fakeScanner('[[ "$1" == version ]] && echo 8.30.1; exit 0')]) {
      const run = runGate(["--scope", "release", "--ref", "main", "--repo", repo], { GITLEAKS_BIN: bin });
      assert.equal(run.status, "status=BLOCKED");
      assert.equal(run.evidence.result.reason_code, "scanner_invalid");
    }
  });

  it("BLOCKs an unsupported scanner major version", () => {
    const repo = makeRepo();
    const bin = fakeScanner('case "$1" in version) echo 9.0.0;; --help) echo gitleaks;; esac; exit 0');
    const run = runGate(["--scope", "release", "--ref", "main", "--repo", repo], { GITLEAKS_BIN: bin });
    assert.equal(run.evidence.result.reason_code, "scanner_unsupported_version");
  });

  it("BLOCKs a scanner error or a report that disagrees with the exit code", () => {
    const repo = makeRepo();
    const crash = fakeScanner('case "$1" in version) echo 8.30.1;; --help) echo gitleaks;; *) exit 3;; esac');
    assert.equal(runGate(["--scope", "release", "--ref", "main", "--repo", repo], { GITLEAKS_BIN: crash }).evidence.result.reason_code, "scanner_error");
    const silent = fakeScanner('case "$1" in version) echo 8.30.1; exit 0;; --help) echo gitleaks; exit 0;; esac; exit 0');
    assert.equal(runGate(["--scope", "release", "--ref", "main", "--repo", repo], { GITLEAKS_BIN: silent }).evidence.result.reason_code, "scanner_output_invalid");
    const liar = fakeScanner(
      'case "$1" in version) echo 8.30.1; exit 0;; --help) echo gitleaks; exit 0;; esac\n' +
      'while [[ $# -gt 0 ]]; do [[ "$1" == --report-path ]] && echo "[]" > "$2"; shift; done; exit 1',
    );
    assert.equal(runGate(["--scope", "release", "--ref", "main", "--repo", repo], { GITLEAKS_BIN: liar }).evidence.result.reason_code, "scanner_output_invalid");
  });

  it("BLOCKs unresolvable refs, empty ranges, non-repos and bad arguments", () => {
    const repo = makeRepo();
    assert.equal(runGate(["--scope", "release", "--ref", "no-such-ref", "--repo", repo]).evidence.result.reason_code, "ref_unresolvable");
    assert.equal(runGate(["--scope", "pr", "--base", "main", "--head", "main", "--repo", repo]).evidence.result.reason_code, "empty_scope");
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "scm-secret-scan-plain-"));
    assert.equal(runGate(["--scope", "release", "--ref", "HEAD", "--repo", plain]).evidence.result.reason_code, "not_a_git_repository");
    const bad = runGate(["--scope", "everything"]);
    assert.equal(bad.status, "status=BLOCKED");
    assert.equal(bad.rc, 2);
  });
});

describe("contract validators", () => {
  it("rejects evidence that claims PASS without scan identity or with findings", () => {
    const repo = makeRepo();
    const blockedRun = runGate(["--scope", "release", "--ref", "main", "--repo", repo], { GITLEAKS_BIN: "/nonexistent/gitleaks" });
    const forged = { ...blockedRun.evidence, result: { ...blockedRun.evidence.result, status: "PASS", reason_code: "clean" } };
    assert.ok(validateEvidence(forged).length > 0, "PASS without scanner version/commit/hashes must be invalid");
    const tampered = { ...blockedRun.evidence, scope: "pr" };
    assert.ok(validateEvidence(tampered).some((e) => e.includes("evidence_hash")));
  });

  it("validates the shipped baseline", () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".scm-secret-scan-baseline.json"), "utf8"));
    assert.deepEqual(validateBaseline(shipped), []);
  });

  it("applies suppressions by exact fingerprint and rule only", () => {
    const fp = `${"b".repeat(40)}:a.yml:github-pat:3`;
    const finding = { rule_id: "github-pat", commit: "b".repeat(40), file: "a.yml", line: 3, fingerprint: fp };
    const base = { scm_secret_scan_baseline_version: 1, suppressions: [{ rule_id: "aws-access-token", finding_fingerprint: fp, justification: "mismatched rule id", owner: "x", created_at: "2026-01-01", expires_at: null, scope: ["pr"] }] };
    assert.equal(applyBaseline([finding], base, "pr", "2026-06-01").open.length, 1);
  });
});
