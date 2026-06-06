"use strict";

const path = require("path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  REGISTRY_VERSION,
  loadSkillRegistry,
  validateSkillRegistry,
  evaluateSkillRegistryAccess,
  listSkillsMissingFromRegistry,
  listRegisteredSkillIds,
} = require("../security/skill-registry");

const REPO_ROOT = path.join(__dirname, "..", "..");

describe("skill-registry", () => {
  it("loads and validates default registry against repo skills", () => {
    const st = loadSkillRegistry(undefined, REPO_ROOT);
    assert.equal(st.valid, true, st.errors?.join("; "));
    assert.equal(st.registry.version, REGISTRY_VERSION);
    assert.ok(listRegisteredSkillIds(st.registry).length >= 19);
    const missing = listSkillsMissingFromRegistry(st.registry, REPO_ROOT);
    assert.deepEqual(missing, [], `unregistered repo skills: ${missing.join(", ")}`);
  });

  it("orchestrator-token-report is conformant and allowed for ORCHESTRATOR", () => {
    const { registry } = loadSkillRegistry(undefined, REPO_ROOT);
    const entry = registry.skills["orchestrator-token-report"];
    assert.equal(entry.conformant, true);
    const r = evaluateSkillRegistryAccess({
      skillId: "orchestrator-token-report",
      role: "ORCHESTRATOR",
      registry,
    });
    assert.equal(r.output.decision, "allow");
    assert.equal(r.tracePayload.event, "skill_registry_check");
    assert.equal(r.tracePayload.conformant, true);
  });

  it("denies unregistered skill", () => {
    const { registry } = loadSkillRegistry(undefined, REPO_ROOT);
    const r = evaluateSkillRegistryAccess({
      skillId: "evil-skill-pack",
      role: "DEV",
      registry,
    });
    assert.equal(r.output.decision, "deny");
    assert.equal(r.output.reason_code, "skill_not_registered");
  });

  it("denies registered skill for disallowed role", () => {
    const { registry } = loadSkillRegistry(undefined, REPO_ROOT);
    const r = evaluateSkillRegistryAccess({
      skillId: "reviewing-terraform",
      role: "OWNER",
      registry,
    });
    assert.equal(r.output.decision, "deny");
    assert.equal(r.output.reason_code, "role_not_allowed_for_skill");
  });

  it("validation fails when skill path is missing", () => {
    const { registry } = loadSkillRegistry(undefined, REPO_ROOT);
    const broken = {
      ...registry,
      skills: {
        ...registry.skills,
        "ghost-skill": {
          id: "ghost-skill",
          path: "skills/ghost-skill/SKILL.md",
          allowed_roles: ["DEV"],
          disclosure: "index",
        },
      },
    };
    const v = validateSkillRegistry(broken, REPO_ROOT);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => e.includes("path not found")));
  });
});
