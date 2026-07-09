"use strict";

const fs = require("fs");
const path = require("path");

const GATE_ID = "PRIVACY_SANITIZE_GATE";

const REASON_CODES = Object.freeze({
  OK: "PRIVACY_SCAN_OK",
  PII_REDACTED: "PRIVACY_PII_REDACTED",
  SECRET_REDACTED: "PRIVACY_SECRET_REDACTED",
  UNAVAILABLE: "PRIVACY_SCAN_UNAVAILABLE",
  FAILED_BLOCKED: "PRIVACY_SCAN_FAILED_BLOCKED",
});

const SECRET_PLACEHOLDERS = Object.freeze([
  "[REDACTED:bearer]",
  "[REDACTED:api_token]",
  "[REDACTED:aws_access_key]",
  "[REDACTED:github_pat]",
  "[REDACTED:slack_token]",
  "[REDACTED:url-creds]",
  "[REDACTED:env_secret]",
]);

const PII_PLACEHOLDERS = Object.freeze(["[REDACTED:email]", "[REDACTED:phone]"]);

/** Mirrors local-model-policy env gate — inlined to avoid permissions→model-runtime import. */
function isLocalOnlyModeEnabled() {
  const mode = String(process.env.ORCH_MODEL_MODE ?? "").trim().toLowerCase();
  if (mode === "local_only") return true;
  const v = String(process.env.ORCH_ALLOW_REMOTE_MODELS ?? "").trim().toLowerCase();
  return v === "0" || v === "false" || v === "no";
}

/**
 * @param {string} original
 * @param {string} redacted
 * @param {string[]} placeholders
 * @returns {number}
 */
function countNewPlaceholders(original, redacted, placeholders) {
  let total = 0;
  for (const ph of placeholders) {
    const re = new RegExp(ph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const origCount = (original.match(re) || []).length;
    const redCount = (redacted.match(re) || []).length;
    total += Math.max(0, redCount - origCount);
  }
  return total;
}

/**
 * Privacy-owned secret redaction — always enforced; ignores ORCH_TRACE_SKIP_SECRET_REDACT.
 * @param {string} s
 * @returns {string}
 */
function redactSecretsForPrivacy(s) {
  let t = String(s);
  t = t.replace(/\bBearer\s+[A-Za-z0-9\-._~+/=*]{16,}\b/gi, "[REDACTED:bearer]");
  t = t.replace(/\bsk-[a-zA-Z0-9]{20,}\b/g, "[REDACTED:api_token]");
  t = t.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED:aws_access_key]");
  t = t.replace(/\bghp_[A-Za-z0-9]{30,}\b/g, "[REDACTED:github_pat]");
  t = t.replace(/\bxox[bpa]-[0-9]{10,12}-[0-9]{10,12}-[a-zA-Z0-9]{20,}\b/gi, "[REDACTED:slack_token]");
  t = t.replace(/\/\/(?:[^\s/@]+):(?:[^\s/@]+)@/g, "//[REDACTED:url-creds]@");
  t = t.replace(
    /(^|\n)([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\s*=\s*(\S+)/gm,
    "$1$2=[REDACTED:env_secret]",
  );
  return t;
}

/**
 * @param {string} s
 * @returns {string}
 */
function redactPiiPlaintext(s) {
  let t = String(s);
  t = t.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED:email]");
  t = t.replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[REDACTED:phone]");
  return t;
}

/**
 * Deterministic privacy redaction — no trace-debug opt-out.
 * @param {string} text
 * @returns {string}
 */
function applyDeterministicRedaction(text) {
  return redactPiiPlaintext(redactSecretsForPrivacy(text));
}

/**
 * Optional Presidio adapter — not required for v0.15; regex fallback always runs.
 * @param {string} _text
 * @returns {{ available: boolean, text?: string, error?: string }}
 */
function tryPresidioScan(_text) {
  if (process.env.PRIVACY_USE_PRESIDIO !== "1") {
    return { available: false };
  }
  return { available: false, error: "presidio_not_installed" };
}

/**
 * @param {string} original
 * @param {string} redacted
 * @param {{ presidio_available: boolean, scan_failed?: boolean }} meta
 */
function buildScanResult(original, redacted, meta) {
  const secret = countNewPlaceholders(original, redacted, SECRET_PLACEHOLDERS);
  const pii = countNewPlaceholders(original, redacted, PII_PLACEHOLDERS);

  if (meta.scan_failed) {
    return {
      privacy_scan_status: "unavailable",
      reason_code: REASON_CODES.UNAVAILABLE,
      redaction_counts: { pii, secret },
      presidio_available: meta.presidio_available,
      redacted_artifact_path: null,
    };
  }

  let reason_code = REASON_CODES.OK;
  let privacy_scan_status = "ok";
  if (secret > 0) {
    reason_code = REASON_CODES.SECRET_REDACTED;
    privacy_scan_status = "redacted";
  } else if (pii > 0) {
    reason_code = REASON_CODES.PII_REDACTED;
    privacy_scan_status = "redacted";
  } else if (!meta.presidio_available && process.env.PRIVACY_USE_PRESIDIO === "1") {
    reason_code = REASON_CODES.UNAVAILABLE;
    privacy_scan_status = "ok";
  }

  return {
    privacy_scan_status,
    reason_code,
    redaction_counts: { pii, secret },
    presidio_available: meta.presidio_available,
    redacted_artifact_path: null,
  };
}

/**
 * @param {string} text
 * @param {{ remote?: boolean }} [options]
 * @returns {{ privacy_scan_status: string, reason_code: string, redaction_counts: { pii: number, secret: number }, presidio_available: boolean }}
 */
function scanSensitiveData(text, options = {}) {
  const { text: redacted, scanMeta } = redactOutboundTextInternal(text, options);
  return buildScanResult(String(text), redacted, scanMeta);
}

/**
 * @param {string} text
 * @param {{ remote?: boolean }} [options]
 * @returns {{ text: string, scanMeta: { presidio_available: boolean, scan_failed?: boolean } }}
 */
function redactOutboundTextInternal(text, options = {}) {
  const original = String(text);

  if (process.env.PRIVACY_SCAN_FORCE_FAIL === "1") {
    if (options.remote !== false) {
      throw new Error("privacy scan forced failure");
    }
    const redacted = applyDeterministicRedaction(original);
    return {
      text: redacted,
      scanMeta: { presidio_available: false, scan_failed: true },
    };
  }

  let redacted = applyDeterministicRedaction(original);

  const presidio = tryPresidioScan(redacted);
  if (presidio.available && presidio.text) {
    redacted = presidio.text;
  }

  return {
    text: redacted,
    scanMeta: { presidio_available: presidio.available },
  };
}

/**
 * @param {string} text
 * @param {{ remote?: boolean }} [options]
 * @returns {{ text: string, scanResult: ReturnType<typeof buildScanResult> }}
 */
function redactOutboundText(text, options = {}) {
  const remote = options.remote !== false;
  try {
    const { text: redacted, scanMeta } = redactOutboundTextInternal(text, { ...options, remote });
    const scanResult = buildScanResult(String(text), redacted, scanMeta);
    return { text: redacted, scanResult };
  } catch (err) {
    if (!remote || isLocalOnlyModeEnabled()) {
      console.warn(
        `[privacy-sanitize] scan unavailable (${err instanceof Error ? err.message : String(err)}) — local path continues with warn`,
      );
      const fallback = applyDeterministicRedaction(String(text));
      const scanResult = buildScanResult(String(text), fallback, {
        presidio_available: false,
        scan_failed: true,
      });
      return { text: fallback, scanResult };
    }
    throw createPrivacyPolicyError(
      `[privacy-sanitize] Outbound privacy scan failed — remote provider blocked. ${err instanceof Error ? err.message : String(err)}`,
      { reason_code: REASON_CODES.FAILED_BLOCKED },
    );
  }
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
function createPrivacyPolicyError(message, extra = {}) {
  const err = new Error(message);
  err.gate_id = GATE_ID;
  err.code = "PRIVACY_SANITIZE_BLOCKED";
  Object.assign(err, extra);
  return err;
}

/**
 * @param {ReturnType<typeof buildScanResult>} scanResult
 * @param {{ remote?: boolean }} [options]
 */
function evaluatePrivacyGate(scanResult, options = {}) {
  const remote = options.remote !== false;
  if (scanResult.reason_code === REASON_CODES.FAILED_BLOCKED) {
    return { allowed: false, action: remote ? "block" : "warn" };
  }
  if (scanResult.reason_code === REASON_CODES.UNAVAILABLE && remote) {
    return { allowed: true, action: "warn" };
  }
  return { allowed: true, action: "allow" };
}

/**
 * Redact and enforce privacy gate for remote Claude prompts.
 * @param {string} text
 * @param {{ remote?: boolean, agentId?: string }} [ctx]
 * @returns {string}
 */
function prepareOutboundRemoteText(text, ctx = {}) {
  const remote = ctx.remote !== false;
  const { text: redacted, scanResult } = redactOutboundText(text, { remote });
  const verdict = evaluatePrivacyGate(scanResult, { remote });
  if (!verdict.allowed) {
    throw createPrivacyPolicyError(
      `[privacy-sanitize] Remote outbound blocked for agent "${ctx.agentId || "unknown"}".`,
      { reason_code: scanResult.reason_code, agentId: ctx.agentId },
    );
  }
  if (verdict.action === "warn" && scanResult.reason_code !== REASON_CODES.OK) {
    console.warn(
      `[privacy-sanitize] ${scanResult.reason_code} pii=${scanResult.redaction_counts.pii} secret=${scanResult.redaction_counts.secret}`,
    );
  }
  return redacted;
}

/**
 * @param {string} bundleDir
 * @param {string} taskId
 * @param {{ summary: object, shareable_files: string[] }} privacyResult
 */
function writeShareableManifest(bundleDir, taskId, privacyResult) {
  const relFiles = privacyResult.shareable_files
    .filter((f) => f !== "privacy-scan.json" && f.startsWith("shareable/"))
    .map((f) => f.slice("shareable/".length));
  const manifest = {
    bundle_version: "1",
    upload_scope: "shareable",
    task_id: taskId,
    files: relFiles,
    privacy_scan: privacyResult.summary,
  };
  const shareableManifestPath = path.join(bundleDir, "shareable", "manifest.json");
  fs.mkdirSync(path.dirname(shareableManifestPath), { recursive: true });
  fs.writeFileSync(shareableManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return path.relative(bundleDir, shareableManifestPath);
}

/**
 * @param {string} bundleDir
 * @returns {{ summary: object, shareable_files: string[], privacy_scan_path: string, upload_files: string[] }}
 */
function applyPrivacySanitizeToBundle(bundleDir) {
  const shareableRoot = path.join(bundleDir, "shareable");
  fs.mkdirSync(shareableRoot, { recursive: true });

  /** @type {string[]} */
  const shareable_files = [];
  let totalPii = 0;
  let totalSecret = 0;
  let worstReason = REASON_CODES.OK;
  let worstStatus = "ok";

  const skipNames = new Set(["shareable", "privacy-scan.json", "manifest.json", "ATTACH.md", "redaction-report.json"]);

  /**
   * @param {string} rel
   * @param {string} abs
   */
  function processTextFile(rel, abs) {
    const raw = fs.readFileSync(abs, "utf8");
    const redacted = applyDeterministicRedaction(raw);
    const scanResult = buildScanResult(raw, redacted, { presidio_available: false });
    totalPii += scanResult.redaction_counts.pii;
    totalSecret += scanResult.redaction_counts.secret;
    if (scanResult.reason_code === REASON_CODES.SECRET_REDACTED) worstReason = REASON_CODES.SECRET_REDACTED;
    else if (scanResult.reason_code === REASON_CODES.PII_REDACTED && worstReason === REASON_CODES.OK) {
      worstReason = REASON_CODES.PII_REDACTED;
    }
    if (scanResult.privacy_scan_status === "redacted") worstStatus = "redacted";

    const destRel = rel;
    const destAbs = path.join(shareableRoot, destRel);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.writeFileSync(destAbs, redacted, "utf8");
    shareable_files.push(path.join("shareable", destRel));
  }

  /**
   * @param {string} dir
   * @param {string} prefix
   */
  function walk(dir, prefix = "") {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipNames.has(ent.name)) continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "shareable") continue;
        walk(abs, rel);
        continue;
      }
      if (!/\.(jsonl?|md|txt)$/i.test(ent.name)) continue;
      processTextFile(rel, abs);
    }
  }

  walk(bundleDir);

  const summary = {
    privacy_scan_status: worstStatus,
    reason_code: worstReason,
    redaction_counts: { pii: totalPii, secret: totalSecret },
    shareable_root: "shareable",
  };

  const privacyScanPath = path.join(bundleDir, "privacy-scan.json");
  fs.writeFileSync(privacyScanPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const manifestPath = path.join(bundleDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.privacy_scan = summary;
    manifest.shareable_files = ["privacy-scan.json", ...shareable_files];
    manifest.upload_files = ["privacy-scan.json", ...shareable_files];
    manifest.local_only_files = (manifest.files || []).filter(
      (f) => !manifest.upload_files.includes(f) && f !== "ATTACH.md",
    );
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  const upload_files = ["privacy-scan.json", ...shareable_files];

  return {
    summary,
    shareable_files: upload_files,
    upload_files,
    privacy_scan_path: privacyScanPath,
  };
}

module.exports = {
  GATE_ID,
  REASON_CODES,
  scanSensitiveData,
  redactOutboundText,
  evaluatePrivacyGate,
  prepareOutboundRemoteText,
  createPrivacyPolicyError,
  applyPrivacySanitizeToBundle,
  applyDeterministicRedaction,
  redactSecretsForPrivacy,
  redactPiiPlaintext,
  writeShareableManifest,
};
