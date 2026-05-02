"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  loadPermissionConfig,
  resolveProfile,
  VALID_PROFILES,
} = require("../security/load-permission-config");

describe("permission config — load-permission-config", () => {
  let config;

  it("loads all three files without error", () => {
    config = loadPermissionConfig();
    assert.ok(config.matrix, "matrix missing");
    assert.ok(config.profiles, "profiles missing");
    assert.ok(config.catalog, "catalog missing");
  });

  // matrix
  it("matrix has valid version string", () => {
    const { matrix } = loadPermissionConfig();
    assert.match(matrix.version, /^cap\.orchestrator\.v\d+$/);
  });

  it("matrix domains array is non-empty and contains only strings", () => {
    const { matrix } = loadPermissionConfig();
    assert.ok(matrix.domains.length > 0);
    for (const d of matrix.domains) {
      assert.equal(typeof d, "string", `domain must be string, got: ${typeof d}`);
    }
  });

  it("matrix has roles object", () => {
    const { matrix } = loadPermissionConfig();
    assert.equal(typeof matrix.roles, "object");
    assert.ok(Object.keys(matrix.roles).length > 0);
  });

  // profiles
  it("profiles has valid version string", () => {
    const { profiles } = loadPermissionConfig();
    assert.match(profiles.version, /^profiles\.orchestrator\.v\d+$/);
  });

  it("all three built-in profiles are present", () => {
    const { profiles } = loadPermissionConfig();
    for (const name of VALID_PROFILES) {
      assert.ok(profiles.profiles[name], `missing profile: ${name}`);
    }
  });

  it("every profile domain key references a known domain", () => {
    const { matrix, profiles } = loadPermissionConfig();
    for (const [name, profile] of Object.entries(profiles.profiles)) {
      for (const key of Object.keys(profile.domains)) {
        assert.ok(
          matrix.domains.includes(key),
          `profile ${name} references unknown domain: ${key}`
        );
      }
    }
  });

  it("all profiles deny credential_reveal and credential_export", () => {
    const { profiles } = loadPermissionConfig();
    for (const [name, profile] of Object.entries(profiles.profiles)) {
      assert.equal(profile.credential_reveal, "deny", `${name}: credential_reveal must be deny`);
      assert.equal(profile.credential_export, "deny", `${name}: credential_export must be deny`);
    }
  });

  it("dev-local allows write_local_repo and write_draft", () => {
    const { profiles } = loadPermissionConfig();
    const fs = profiles.profiles["dev-local"].domains.filesystem;
    assert.equal(fs.write_classes.write_local_repo, "allow");
    assert.equal(fs.write_classes.write_draft, "allow");
  });

  it("ci-safe denies write_external_state and external_side_effect", () => {
    const { profiles } = loadPermissionConfig();
    const fs = profiles.profiles["ci-safe"].domains.filesystem;
    assert.equal(fs.write_classes.write_external_state, "deny");
    assert.equal(fs.write_classes.external_side_effect, "deny");
  });

  it("prod-guarded defaults filesystem to read_only", () => {
    const { profiles } = loadPermissionConfig();
    assert.equal(profiles.profiles["prod-guarded"].domains.filesystem.default, "read_only");
  });

  it("MCP unknown trust level is deny in all profiles", () => {
    const { profiles } = loadPermissionConfig();
    for (const [name, profile] of Object.entries(profiles.profiles)) {
      assert.equal(
        profile.domains.mcp.trust_policy.unknown,
        "deny",
        `${name}: mcp.trust_policy.unknown must be deny`
      );
    }
  });

  // catalog
  it("catalog has valid version string", () => {
    const { catalog } = loadPermissionConfig();
    assert.match(catalog.version, /^catalog\.orchestrator\.v\d+$/);
  });

  it("catalog has extends reference (does not redefine domains)", () => {
    const { catalog } = loadPermissionConfig();
    assert.ok(catalog.extends, "catalog missing extends");
    assert.equal(catalog.domains, undefined, "catalog must not redefine domains");
  });

  it("catalog doc_categories is a non-empty array", () => {
    const { catalog } = loadPermissionConfig();
    assert.ok(Array.isArray(catalog.doc_categories.categories));
    assert.ok(catalog.doc_categories.categories.length > 0);
  });

  it("catalog capability_classes filesystem entries reference filesystem domain", () => {
    const { catalog } = loadPermissionConfig();
    const fsClasses = catalog.capability_classes.filesystem;
    for (const [, cls] of Object.entries(fsClasses)) {
      assert.equal(cls.domain, "filesystem");
    }
  });

  it("catalog ambiguous_write default_policy is requires_approval", () => {
    const { catalog } = loadPermissionConfig();
    assert.equal(
      catalog.capability_classes.filesystem.ambiguous_write.default_policy,
      "requires_approval"
    );
  });

  it("catalog credential classes default to deny", () => {
    const { catalog } = loadPermissionConfig();
    assert.equal(catalog.credential_classes.credential_reveal.default_policy, "deny");
    assert.equal(catalog.credential_classes.credential_export.default_policy, "deny");
  });

  // cross-file consistency
  it("matrix + profiles + catalog load together with no domain conflicts", () => {
    // If loadPermissionConfig() succeeds, cross-validation passed
    assert.doesNotThrow(() => loadPermissionConfig());
  });

  // resolveProfile
  it("resolveProfile returns correct profile for known name", () => {
    const { profiles } = loadPermissionConfig();
    const p = resolveProfile("dev-local", profiles);
    assert.ok(p.domains, "resolved profile missing domains");
  });

  it("resolveProfile throws for unknown profile name", () => {
    const { profiles } = loadPermissionConfig();
    assert.throws(
      () => resolveProfile("fantasy-profile", profiles),
      /Unknown permission profile/
    );
  });
});
