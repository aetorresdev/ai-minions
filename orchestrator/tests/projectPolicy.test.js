"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const {
  loadProjectPolicy,
  mergeProjectPolicy,
  validatePolicy,
  GUARDED_ACTIONS,
  ALWAYS_DENY_CLASSES,
} = require("../security/load-project-policy");

// Helper: create a temp dir with optional .ai-minions/permissions.yaml content
function withTempRepo(yamlContent, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-test-"));
  try {
    if (yamlContent !== null) {
      fs.mkdirSync(path.join(dir, ".ai-minions"));
      fs.writeFileSync(path.join(dir, ".ai-minions", "permissions.yaml"), yamlContent, "utf8");
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const MINIMAL_VALID_JSON = JSON.stringify({
  permission_policy_version: 1,
  extends: ["dev-local"],
  project_capabilities: ["n8n_workflow_authoring"],
  runtime: { allow_public_docs_lookup: true },
  credentials: { reveal: "deny", export: "deny" },
});

describe("loadProjectPolicy", () => {
  it("returns null when .ai-minions/permissions.yaml is absent", () => {
    withTempRepo(null, (dir) => {
      const result = loadProjectPolicy(dir);
      assert.equal(result, null);
    });
  });

  it("loads and returns valid project policy", () => {
    withTempRepo(MINIMAL_VALID_JSON, (dir) => {
      const result = loadProjectPolicy(dir);
      assert.ok(result);
      assert.equal(result.permission_policy_version, 1);
      assert.deepEqual(result.extends, ["dev-local"]);
    });
  });

  it("throws on malformed policy (bad version)", () => {
    const bad = JSON.stringify({ permission_policy_version: 99, extends: ["dev-local"] });
    withTempRepo(bad, (dir) => {
      assert.throws(
        () => loadProjectPolicy(dir),
        /Unsupported permission_policy_version/
      );
    });
  });

  it("throws on missing extends", () => {
    const bad = JSON.stringify({ permission_policy_version: 1 });
    withTempRepo(bad, (dir) => {
      assert.throws(
        () => loadProjectPolicy(dir),
        /must declare 'extends'/
      );
    });
  });

  it("throws on unknown profile in extends", () => {
    const bad = JSON.stringify({ permission_policy_version: 1, extends: ["super-admin"] });
    withTempRepo(bad, (dir) => {
      assert.throws(
        () => loadProjectPolicy(dir),
        /extends unknown profile/
      );
    });
  });
});

describe("validatePolicy — dangerous_actions", () => {
  it("rejects wildcard allow ('*')", () => {
    assert.throws(
      () =>
        validatePolicy({
          permission_policy_version: 1,
          extends: ["dev-local"],
          dangerous_actions: { allow: ["*"] },
        }),
      /Wildcard allow/
    );
  });

  it("rejects scoped allow missing required fields", () => {
    assert.throws(
      () =>
        validatePolicy({
          permission_policy_version: 1,
          extends: ["dev-local"],
          dangerous_actions: { allow: [{ id: "terraform_apply" }] },
        }),
      /must include 'id', 'tool', and 'target_class'/
    );
  });

  it("accepts valid scoped allow", () => {
    assert.doesNotThrow(() =>
      validatePolicy({
        permission_policy_version: 1,
        extends: ["dev-local"],
        dangerous_actions: {
          allow: [{ id: "terraform_apply", tool: "terraform", target_class: "local_dev_cloud_account" }],
        },
      })
    );
  });

  it("rejects credential reveal override", () => {
    assert.throws(
      () =>
        validatePolicy({
          permission_policy_version: 1,
          extends: ["dev-local"],
          credentials: { reveal: "allow" },
        }),
      /cannot allow credential reveal/
    );
  });

  it("rejects credential export override", () => {
    assert.throws(
      () =>
        validatePolicy({
          permission_policy_version: 1,
          extends: ["dev-local"],
          credentials: { export: "allow" },
        }),
      /cannot allow credential export/
    );
  });
});

describe("mergeProjectPolicy", () => {
  const fakeProfile = { domains: { filesystem: { default: "allow" } } };

  it("returns built_in_profile source when no project policy", () => {
    const merged = mergeProjectPolicy(fakeProfile, null, "dev-local");
    assert.equal(merged.policy_source, "built_in_profile");
    assert.equal(merged.profile_name, "dev-local");
    assert.deepEqual(merged.credentials, { reveal: "deny", export: "deny" });
  });

  it("returns project_policy source when policy present", () => {
    const policy = JSON.parse(MINIMAL_VALID_JSON);
    const merged = mergeProjectPolicy(fakeProfile, policy, "dev-local");
    assert.equal(merged.policy_source, "project_policy");
    assert.deepEqual(merged.project_capabilities, ["n8n_workflow_authoring"]);
  });

  it("credentials always deny regardless of project policy content", () => {
    const policy = { permission_policy_version: 1, extends: ["dev-local"], credentials: { reveal: "deny", export: "deny" } };
    const merged = mergeProjectPolicy(fakeProfile, policy, "dev-local");
    assert.equal(merged.credentials.reveal, "deny");
    assert.equal(merged.credentials.export, "deny");
  });

  it("ALWAYS_DENY_CLASSES entries are filtered from explicit allows", () => {
    const policy = {
      permission_policy_version: 1,
      extends: ["dev-local"],
      dangerous_actions: {
        allow: [
          { id: "credential_reveal", tool: "bash", target_class: "any" },
          { id: "terraform_apply", tool: "terraform", target_class: "local_dev_cloud_account" },
        ],
      },
    };
    const merged = mergeProjectPolicy(fakeProfile, policy, "dev-local");
    const ids = merged.dangerous_actions.allow.map((e) => e.id);
    assert.ok(!ids.includes("credential_reveal"), "credential_reveal must be filtered");
    assert.ok(ids.includes("terraform_apply"), "terraform_apply must be kept");
  });

  it("require_explicit_allow carried through from project policy", () => {
    const policy = {
      permission_policy_version: 1,
      extends: ["ci-safe"],
      dangerous_actions: { require_explicit_allow: ["terraform_apply", "kubectl_delete"] },
    };
    const merged = mergeProjectPolicy(fakeProfile, policy, "ci-safe");
    assert.deepEqual(merged.dangerous_actions.require_explicit_allow, ["terraform_apply", "kubectl_delete"]);
  });
});

describe("constants", () => {
  it("ALWAYS_DENY_CLASSES includes credential_reveal and credential_export", () => {
    assert.ok(ALWAYS_DENY_CLASSES.includes("credential_reveal"));
    assert.ok(ALWAYS_DENY_CLASSES.includes("credential_export"));
  });

  it("GUARDED_ACTIONS is non-empty array of strings", () => {
    assert.ok(Array.isArray(GUARDED_ACTIONS));
    assert.ok(GUARDED_ACTIONS.length > 0);
    for (const a of GUARDED_ACTIONS) assert.equal(typeof a, "string");
  });
});
