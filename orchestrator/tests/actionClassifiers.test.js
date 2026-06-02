"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { classifyAction } = require("../security/action-classifiers/classify-action");
const terraform = require("../security/action-classifiers/terraform");
const kubectl = require("../security/action-classifiers/kubectl");
const awsCli = require("../security/action-classifiers/aws-cli");
const git = require("../security/action-classifiers/git");
const filesystem = require("../security/action-classifiers/filesystem");
const {
  manifestFromObject,
  resetToolActionManifestCache,
  loadToolActionManifest,
} = require("../security/load-tool-action-manifest");
const { ADAPTER_IDS } = require("../security/action-classifiers/adapter-registry");
const R = require("../security/classification-reasons");

describe("action classifiers — adapter modules (exceptions)", () => {
  it("terraform maps argv examples", () => {
    assert.equal(terraform.classify(["fmt"]).action_class, "validate");
    assert.equal(terraform.classify(["workspace", "list"]).action_class, "read");
  });

  it("kubectl maps argv examples", () => {
    assert.equal(kubectl.classify(["get", "pods"]).action_class, "read");
    assert.equal(kubectl.classify(["apply", "-f", "x"]).action_class, "external_side_effect");
  });

  it("aws-cli heuristic", () => {
    assert.equal(awsCli.classify(["sts", "get-caller-identity"]).action_class, "read");
    assert.equal(awsCli.classify(["lambda", "invoke", "fn", "out"]).action_class, "external_side_effect");
  });

  it("git maps groomed examples", () => {
    assert.equal(git.classify(["status"]).action_class, "read");
    assert.equal(git.classify(["show-ref", "--verify"]).action_class, "read");
    assert.equal(git.classify(["push"]).action_class, "external_side_effect");
  });

  it("filesystem respects repo root for writes", () => {
    assert.equal(filesystem.classify(["f"], { executable: "cat", repoRoot: "/repo" }).action_class, "read");
    const outside = filesystem.classify(["/etc/passwd"], { executable: "cp", repoRoot: "/repo" });
    assert.equal(outside.action_class, "write_external_state");
  });
});

describe("action classifiers — classifyAction (manifest-first)", () => {
  beforeEach(() => {
    resetToolActionManifestCache();
    loadToolActionManifest();
  });

  it("terraform plan uses manifest rule + target_class (not adapter guess)", () => {
    const r = classifyAction({ executable: "terraform", args: ["plan"] });
    assert.equal(r.action_class, "simulate");
    assert.equal(r.target_class, "cloud_infra");
    assert.equal(r.reason_code, R.CLASSIFIED_BY_MANIFEST);
    assert.equal(r.manifest_action_id, "terraform_plan");
  });

  it("terraform workspace list still delegated to adapter", () => {
    const r = classifyAction({ executable: "terraform", args: ["workspace", "list"] });
    assert.equal(r.action_class, "read");
    assert.equal(r.reason_code, R.CLASSIFIED_BY_ADAPTER);
    assert.equal(r.tool_id, "terraform");
  });

  it("routes docker / gh / gcloud via manifest rules only", () => {
    assert.equal(classifyAction({ executable: "docker-compose", args: ["up"] }).action_class, "external_side_effect");
    assert.equal(classifyAction({ executable: "gh", args: ["issue", "list"] }).action_class, "read");
    assert.equal(classifyAction({ executable: "aws", args: ["s3", "ls"] }).action_class, "read");
    assert.equal(classifyAction({ executable: "gcloud", args: ["config", "list"] }).action_class, "read");
    assert.equal(classifyAction({ executable: "git", args: ["diff"] }).action_class, "read");
    assert.equal(classifyAction({ executable: "cat", args: ["x"] }).action_class, "read");
  });

  it("unknown tool — observable reason", () => {
    const r = classifyAction({ executable: "/bin/obscure-tool-xyz", args: ["a"] });
    assert.equal(r.action_class, "unknown");
    assert.equal(r.reason_code, R.UNKNOWN_TOOL);
  });

  it("jenkins-cli.jar maps to jenkins manifest rules", () => {
    const r = classifyAction({ executable: "/opt/jenkins-cli.jar", args: ["list-jobs"] });
    assert.equal(r.action_class, "read");
    assert.equal(r.reason_code, R.CLASSIFIED_BY_MANIFEST);
  });

  it("docker unknown subcommand — unknown_action_class", () => {
    const r = classifyAction({ executable: "docker", args: ["nonexistent_sub"] });
    assert.equal(r.action_class, "unknown");
    assert.equal(r.reason_code, R.UNKNOWN_ACTION_CLASS);
    assert.equal(r.tool_id, "docker");
  });

  it("n8n credential:export manifest rule (credential_export)", () => {
    const r = classifyAction({ executable: "n8n", args: ["credential:export"] });
    assert.equal(r.action_class, "credential_export");
    assert.equal(r.reason_code, R.CLASSIFIED_BY_MANIFEST);
    assert.equal(r.manifest_action_id, "n8n_credential_export");
  });
});

describe("action classifiers — manifest AC (test overrides)", () => {
  it("manifest-only tool", () => {
    const st = manifestFromObject({
      version: "tool-action-manifest.orchestrator.v1",
      tools: {
        mini: {
          id: "mini",
          type: "shell_tool",
          risk_profile: "test",
          capabilities: ["test.ping"],
          aliases: ["mini-cli"],
          rules: [
            {
              id: "ping",
              match: { type: "argv_prefix", argv: ["ping"] },
              action_class: "read",
              target_class: "test_target",
              detail: "mini_ping",
            },
          ],
          delegate_unmatched_to_adapter: false,
        },
      },
    });
    assert.equal(st.valid, true);
    const ok = classifyAction({
      executable: "mini-cli",
      args: ["ping"],
      __testToolManifest: st,
    });
    assert.equal(ok.action_class, "read");
    assert.equal(ok.reason_code, R.CLASSIFIED_BY_MANIFEST);
    assert.equal(ok.target_class, "test_target");

    const miss = classifyAction({
      executable: "mini-cli",
      args: ["pong"],
      __testToolManifest: st,
    });
    assert.equal(miss.action_class, "unknown");
    assert.equal(miss.reason_code, R.UNKNOWN_ACTION_CLASS);
  });

  it("manifest rule wins over adapter when both apply", () => {
    const st = manifestFromObject(
      {
        version: "tool-action-manifest.orchestrator.v1",
        tools: {
          terraform: {
            id: "terraform",
            type: "shell_tool",
            risk_profile: "infrastructure",
            capabilities: ["infra.plan"],
            aliases: ["terraform"],
            rules: [
              {
                id: "plan_override",
                match: { type: "argv_prefix", argv: ["plan"] },
                action_class: "read",
                target_class: "override",
                detail: "manifest_overrides_plan",
              },
            ],
            adapter: "terraform",
            delegate_unmatched_to_adapter: true,
          },
        },
      },
      ADAPTER_IDS
    );
    assert.equal(st.valid, true);
    const overridden = classifyAction({
      executable: "terraform",
      args: ["plan"],
      __testToolManifest: st,
    });
    assert.equal(overridden.action_class, "read");
    assert.equal(overridden.manifest_action_id, "plan_override");

    const fallback = classifyAction({
      executable: "terraform",
      args: ["apply"],
      __testToolManifest: st,
    });
    assert.equal(fallback.action_class, "external_side_effect");
    assert.equal(fallback.reason_code, R.CLASSIFIED_BY_ADAPTER);
  });

  it("malformed manifest — fail-safe", () => {
    const bad = manifestFromObject({ version: "", tools: {} });
    assert.equal(bad.valid, false);
    const r = classifyAction({
      executable: "terraform",
      args: ["plan"],
      __testToolManifest: bad,
    });
    assert.equal(r.action_class, "unknown");
    assert.equal(r.reason_code, R.MANIFEST_INVALID);
  });

  it("duplicate alias invalidates manifest", () => {
    const dup = manifestFromObject(
      {
        version: "tool-action-manifest.orchestrator.v1",
        tools: {
          a: {
            id: "a",
            type: "shell_tool",
            risk_profile: "x",
            capabilities: [],
            aliases: ["x"],
            adapter: "terraform",
            delegate_unmatched_to_adapter: true,
          },
          b: {
            id: "b",
            type: "shell_tool",
            risk_profile: "x",
            capabilities: [],
            aliases: ["x"],
            adapter: "kubectl",
            delegate_unmatched_to_adapter: true,
          },
        },
      },
      ADAPTER_IDS
    );
    assert.equal(dup.valid, false);
  });
});
