import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_NODE_MAJOR,
  NODE_VERSION_UNSUPPORTED,
  parseNodeMajor,
  assessNodeRuntime,
} from "../scripts/lib/node-runtime-policy.cjs";

describe("node-runtime-policy", () => {
  it("pins minimum major at 22", () => {
    assert.equal(MIN_NODE_MAJOR, 22);
    assert.equal(NODE_VERSION_UNSUPPORTED, "NODE_VERSION_UNSUPPORTED");
  });

  it("parses majors including v-prefix and prerelease suffixes", () => {
    assert.equal(parseNodeMajor("22.11.0"), 22);
    assert.equal(parseNodeMajor("v22.0.0"), 22);
    assert.equal(parseNodeMajor("22.0.0-rc.1"), 22);
    assert.equal(parseNodeMajor("24.1.0"), 24);
    assert.equal(parseNodeMajor("v18.20.0"), 18);
    assert.equal(parseNodeMajor(""), null);
    assert.equal(parseNodeMajor("invalid"), null);
    assert.equal(parseNodeMajor(null), null);
  });

  it("rejects malformed 22-prefixed and incomplete version shapes", () => {
    for (const version of [
      "22garbage",
      "v22garbage",
      "22.11.0garbage",
      "22",
      "22.11",
      "22.",
      "v22",
      "22.x.0",
      "not-a-version",
    ]) {
      assert.equal(parseNodeMajor(version), null, version);
      const result = assessNodeRuntime(version);
      assert.equal(result.ok, false, version);
      assert.equal(result.reason_code, NODE_VERSION_UNSUPPORTED, version);
    }
  });

  it("rejects Node 18 and 20 with NODE_VERSION_UNSUPPORTED", () => {
    for (const version of ["18.20.0", "v20.11.1", "20.0.0-pre"]) {
      const result = assessNodeRuntime(version);
      assert.equal(result.ok, false);
      assert.equal(result.reason_code, NODE_VERSION_UNSUPPORTED);
      assert.equal(result.required_minimum, 22);
      assert.match(result.message, />= 22/);
      assert.match(result.remediation, /Node\.js 22\+/);
    }
  });

  it("accepts Node 22 and 24", () => {
    for (const version of ["22.0.0", "v22.11.1", "24.0.0"]) {
      const result = assessNodeRuntime(version);
      assert.equal(result.ok, true);
      assert.equal(result.reason_code, null);
      assert.ok(result.major >= 22);
    }
  });
});
