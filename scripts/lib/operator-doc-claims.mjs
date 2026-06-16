/**
 * Shared deterministic rules for operator-facing documentation claim audits.
 */

/** @typedef {{ re: RegExp, label: string }} ForbiddenClaimRule */

/** @type {ForbiddenClaimRule[]} */
export const FORBIDDEN_CLAIMS = [
  { re: /production[- ]ready/i, label: "production-ready claim" },
  { re: /autonomous\s+(engineering\s+)?team/i, label: "autonomous team claim" },
  { re: /24\s*\/\s*7\s+dev\s+team/i, label: "24/7 dev team claim" },
  { re: /fully\s+secure/i, label: "fully secure claim" },
  { re: /inherited\s+credentials?/i, label: "inherited credentials claim" },
  { re: /credenciales\s+heredadas/i, label: "credenciales heredadas claim" },
  { re: /multi[- ]tenant\s+isolation\s+implemented/i, label: "multi-tenant implemented claim" },
  { re: /\bglobal\s+installer\b/i, label: "global installer claim" },
  { re: /npm\s+install\s+-g\s+ai-minions/i, label: "npm global package claim" },
  { re: /\bbrew\s+install\s+ai-minions/i, label: "brew installer claim" },
  { re: /turnkey\s+marketplace/i, label: "turnkey marketplace claim" },
  { re: /hosted\s+control\s+plane\s+included/i, label: "hosted control plane claim" },
];

/** @type {ForbiddenClaimRule[]} */
export const SECRET_PATTERNS = [
  { re: /\bsk-ant-[a-zA-Z0-9_-]{10,}\b/, label: "Anthropic API key-shaped value" },
  { re: /\bsk-proj-[a-zA-Z0-9_-]{10,}\b/, label: "OpenAI project key-shaped value" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key id-shaped value" },
  { re: /\bghp_[a-zA-Z0-9]{20,}\b/, label: "GitHub PAT-shaped value" },
  { re: /\bBearer\s+[a-zA-Z0-9._-]{20,}\b/, label: "Bearer token value" },
  { re: /(?:password|api[_-]?key|secret)\s*[:=]\s*['"]?[a-zA-Z0-9+/=_-]{12,}/i, label: "inline secret assignment" },
];

/** Operator docs scanned by audit-product-claims.mjs (relative to repo root). */
export const CLAIM_AUDIT_PATHS = [
  "README.md",
  "docs/how-to/usage-smoke-guide.md",
  "docs/how-to/bootstrap-preflight.md",
  "docs/how-to/primary-smoke.md",
  "docs/how-to/harness-health-checkpoints.md",
  "docs/how-to/operator-slash-commands.md",
  "docs/how-to/fresh-clone-evidence.md",
  "docs/how-to/operator-guided-run.md",
  "docs/how-to/operator-preflight-bridge.md",
  "docs/how-to/inspect-run-evidence.md",
  "docs/how-to/collect-run-report.md",
  "docs/how-to/beta-known-limitations.md",
  "docs/how-to/operator-feedback-issue.md",
];

/** Required README anchors for v0.11 claim hygiene. */
export const README_REQUIRED_MARKERS = [
  { needle: "## Known limitations", label: "known limitations section" },
  { needle: "## What this is NOT", label: "what this is NOT section" },
  { needle: "not claimed", label: "not claimed maturity wording" },
  { needle: "usage-smoke-guide.md", label: "canonical smoke guide link" },
];

/**
 * @param {string} text
 * @returns {string}
 */
export function stripCodeSpans(text) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "");
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripProhibitedWordingSection(text) {
  const marker = "## Prohibited wording";
  const idx = text.indexOf(marker);
  if (idx === -1) return text;
  return text.slice(0, idx);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function lineNegatesClaim(line) {
  return /\b(not|never|without|do\s+not|don't|no)\b/i.test(line);
}

/**
 * @param {string} text
 * @param {string} fileRel
 * @param {(msg: string) => void} onFailure
 */
export function checkForbiddenClaims(text, fileRel, onFailure) {
  const scrubbed = stripCodeSpans(stripProhibitedWordingSection(text));
  for (const line of scrubbed.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const negated = lineNegatesClaim(trimmed);
    for (const { re, label } of FORBIDDEN_CLAIMS) {
      if (re.test(trimmed) && !negated) {
        onFailure(`${fileRel}: forbidden content — ${label} (line: ${trimmed.slice(0, 120)}…)`);
      }
    }
  }
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(text)) {
      onFailure(`${fileRel}: forbidden content — ${label} (matched ${re})`);
    }
  }
}

/**
 * @param {string} text
 * @param {string} fileRel
 * @param {(msg: string) => void} onFailure
 */
export function mustNotHaveBacklogCaseIds(text, fileRel, onFailure) {
  const hits = text.match(/\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+-\d+\b/g);
  if (hits?.length) {
    const unique = [...new Set(hits)];
    onFailure(`${fileRel}: backlog-style case IDs not allowed in operator docs: ${unique.join(", ")}`);
  }
}
