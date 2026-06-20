import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = path.join(
  REPO_ROOT,
  "docs/orchestrator/beta-limitations-onboarding-contract.md",
);
const LIMITATIONS = path.join(REPO_ROOT, "docs/how-to/beta-known-limitations.md");
const TESTER_GUIDE = path.join(REPO_ROOT, "docs/how-to/beta-tester-guide.md");

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

describe("beta-limitations-onboarding", () => {
  it("contract exists with onboarding chain and redaction policy", () => {
    const text = readUtf8(CONTRACT);
    assert.match(text, /Onboarding chain/);
    assert.match(text, /Redaction policy/);
    assert.match(text, /beta-known-limitations/);
    assert.match(text, /beta-tester-guide/);
    assert.match(text, /trace-privacy-contract/);
    assert.match(text, /privacy-sanitize-gate-contract/);
    assert.match(text, /disqualifies_beta_success/);
  });

  it("limitations doc links contract and v0.15 trust gates", () => {
    const text = readUtf8(LIMITATIONS);
    assert.match(text, /beta-limitations-onboarding-contract/);
    assert.match(text, /v0\.15 trust gates/);
    assert.match(text, /Redaction policy \(before upload\)/);
    assert.match(text, /PRIVACY_\*/);
  });

  it("tester guide references degraded bundle fields and privacy gate", () => {
    const text = readUtf8(TESTER_GUIDE);
    assert.match(text, /disqualifies_beta_success/);
    assert.match(text, /privacy-sanitize-gate-contract/);
    assert.match(text, /beta-limitations-onboarding-contract/);
  });
});
