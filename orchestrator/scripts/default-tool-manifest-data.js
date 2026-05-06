"use strict";

/**
 * Source data for security/tool-action-manifest.v1.json (regenerate: node scripts/emit-tool-manifest.cjs).
 * Manifest-first per CERBERUS: metadata + declarative rules; adapters only for terraform, kubectl, git, filesystem, aws.
 */

function tool(toolId, o) {
  return {
    id: toolId,
    type: "shell_tool",
    risk_profile: o.risk_profile,
    capabilities: o.capabilities || [],
    aliases: o.aliases,
    rules: o.rules || [],
    adapter: o.adapter,
    delegate_unmatched_to_adapter: o.delegate_unmatched_to_adapter ?? false,
  };
}

function dockerRules() {
  const readSubs = ["ps", "images", "inspect", "version", "info", "logs", "stats", "events"];
  const rules = [];
  for (const s of readSubs) {
    rules.push({
      id: `docker_${s}`,
      match: { type: "argv_prefix", argv: [s] },
      action_class: "read",
      target_class: "containers",
      detail: `docker_${s}`,
    });
  }
  rules.push({
    id: "docker_diff",
    match: { type: "argv_prefix", argv: ["diff"] },
    action_class: "simulate",
    target_class: "containers",
    detail: "docker_diff",
  });
  for (const s of ["push", "pull"]) {
    rules.push({
      id: `docker_${s}`,
      match: { type: "argv_prefix", argv: [s] },
      action_class: "external_side_effect",
      target_class: "containers",
      detail: `docker_${s}`,
    });
  }
  for (const s of ["build", "run", "create", "compose"]) {
    rules.push({
      id: `docker_${s}`,
      match: { type: "argv_prefix", argv: [s] },
      action_class: "external_side_effect",
      target_class: "containers",
      detail: `docker_${s}`,
    });
  }
  rules.push({
    id: "docker_exec",
    match: { type: "argv_prefix", argv: ["exec"] },
    action_class: "execute",
    target_class: "containers",
    detail: "docker_exec",
  });
  for (const s of ["rm", "rmi", "prune"]) {
    rules.push({
      id: `docker_${s}`,
      match: { type: "argv_prefix", argv: [s] },
      action_class: "destructive",
      target_class: "containers",
      detail: `docker_${s}`,
    });
  }
  return rules;
}

function jenkinsRules() {
  return [
    {
      id: "jenkins_read_family",
      match: { type: "argv_prefix", argv: ["help"] },
      action_class: "read",
      target_class: "ci_cd",
      detail: "jenkins_help",
    },
    {
      id: "jenkins_list_jobs",
      match: { type: "argv_prefix", argv: ["list-jobs"] },
      action_class: "read",
      target_class: "ci_cd",
      detail: "jenkins_list_jobs",
    },
    {
      id: "jenkins_get_job",
      match: { type: "argv_prefix", argv: ["get-job"] },
      action_class: "read",
      target_class: "ci_cd",
      detail: "jenkins_get_job",
    },
    {
      id: "jenkins_whoami",
      match: { type: "argv_prefix", argv: ["who-am-i"] },
      action_class: "read",
      target_class: "ci_cd",
      detail: "jenkins_who-am-i",
    },
    {
      id: "jenkins_version",
      match: { type: "argv_prefix", argv: ["version"] },
      action_class: "read",
      target_class: "ci_cd",
      detail: "jenkins_version",
    },
    {
      id: "jenkins_build",
      match: { type: "argv_prefix", argv: ["build"] },
      action_class: "external_side_effect",
      target_class: "ci_cd",
      detail: "jenkins_build",
    },
    {
      id: "jenkins_enable_job",
      match: { type: "argv_prefix", argv: ["enable-job"] },
      action_class: "external_side_effect",
      target_class: "ci_cd",
      detail: "jenkins_enable-job",
    },
    {
      id: "jenkins_disable_job",
      match: { type: "argv_prefix", argv: ["disable-job"] },
      action_class: "external_side_effect",
      target_class: "ci_cd",
      detail: "jenkins_disable-job",
    },
    {
      id: "jenkins_install_plugin",
      match: { type: "argv_prefix", argv: ["install-plugin"] },
      action_class: "external_side_effect",
      target_class: "ci_cd",
      detail: "jenkins_install-plugin",
    },
    {
      id: "jenkins_delete_job",
      match: { type: "argv_prefix", argv: ["delete-job"] },
      action_class: "destructive",
      target_class: "ci_cd",
      detail: "jenkins_delete-job",
    },
    {
      id: "jenkins_clear_queue",
      match: { type: "argv_prefix", argv: ["clear-queue"] },
      action_class: "external_side_effect",
      target_class: "ci_cd",
      detail: "jenkins_clear-queue",
    },
  ];
}

function n8nRules() {
  const rules = [];
  for (const s of ["start", "webhook", "worker"]) {
    rules.push({
      id: `n8n_${s}`,
      match: { type: "argv_prefix", argv: [s] },
      action_class: "external_side_effect",
      target_class: "automation",
      detail: `n8n_${s}`,
    });
  }
  rules.push({
    id: "n8n_execute",
    match: { type: "argv_prefix", argv: ["execute"] },
    action_class: "external_side_effect",
    target_class: "automation",
    detail: "n8n_execute",
  });
  for (const p of ["import:", "create:", "update:"]) {
    const slug = p.replace(/:/g, "");
    rules.push({
      id: `n8n_colon_${slug}`,
      match: { type: "argv0_prefix", prefix: p },
      action_class: "write_draft",
      target_class: "automation",
      detail: p,
    });
  }
  rules.push({
    id: "n8n_export_family",
    match: { type: "argv0_prefix", prefix: "export:" },
    action_class: "read",
    target_class: "automation",
    detail: "export:",
  });
  rules.push({
    id: "n8n_list_workflow",
    match: { type: "argv_prefix", argv: ["list:workflow"] },
    action_class: "read",
    target_class: "automation",
    detail: "list:workflow",
  });
  rules.push({
    id: "n8n_user_management_reset",
    match: { type: "argv_prefix", argv: ["user-management:reset"] },
    action_class: "credential_use",
    target_class: "automation",
    detail: "user-management:reset",
  });
  rules.push({
    id: "n8n_credential_family",
    match: { type: "argv0_prefix", prefix: "credential:" },
    action_class: "credential_use",
    target_class: "automation",
    detail: "credential:",
  });
  return rules;
}

function ghRules() {
  /** @type {object[]} */
  const rules = [];

  rules.push(
    {
      id: "gh_auth_login",
      match: { type: "argv_prefix", argv: ["auth", "login"] },
      action_class: "credential_use",
      target_class: "github_platform",
      detail: "gh_auth_login",
    },
    {
      id: "gh_auth_setup_git",
      match: { type: "argv_prefix", argv: ["auth", "setup-git"] },
      action_class: "credential_use",
      target_class: "github_platform",
      detail: "gh_auth_setup-git",
    },
    {
      id: "gh_auth_token",
      match: { type: "argv_prefix", argv: ["auth", "token"] },
      action_class: "credential_reveal",
      target_class: "github_platform",
      detail: "gh_auth_token",
    },
    {
      id: "gh_auth_refresh",
      match: { type: "argv_prefix", argv: ["auth", "refresh"] },
      action_class: "credential_reveal",
      target_class: "github_platform",
      detail: "gh_auth_refresh",
    },
    {
      id: "gh_auth_read",
      match: { type: "argv_prefix", argv: ["auth"] },
      action_class: "read",
      target_class: "github_platform",
      detail: "gh_auth_read",
    }
  );

  rules.push(
    {
      id: "gh_secret_set",
      match: { type: "argv_prefix", argv: ["secret", "set"] },
      action_class: "credential_export",
      target_class: "github_platform",
      detail: "gh_secret_set",
    },
    {
      id: "gh_secret_delete",
      match: { type: "argv_prefix", argv: ["secret", "delete"] },
      action_class: "credential_export",
      target_class: "github_platform",
      detail: "gh_secret_delete",
    },
    {
      id: "gh_secret_list",
      match: { type: "argv_prefix", argv: ["secret"] },
      action_class: "read",
      target_class: "github_platform",
      detail: "gh_secret_list",
    }
  );

  for (const op of ["run", "disable", "enable"]) {
    rules.push({
      id: `gh_workflow_${op}`,
      match: { type: "argv_prefix", argv: ["workflow", op] },
      action_class: "external_side_effect",
      target_class: "github_platform",
      detail: `gh_workflow_${op}`,
    });
  }
  rules.push({
    id: "gh_workflow_read",
    match: { type: "argv_prefix", argv: ["workflow"] },
    action_class: "read",
    target_class: "github_platform",
    detail: "gh_workflow",
  });

  for (const op of ["watch", "download", "rerun", "cancel"]) {
    rules.push({
      id: `gh_run_${op}`,
      match: { type: "argv_prefix", argv: ["run", op] },
      action_class: "external_side_effect",
      target_class: "github_platform",
      detail: `gh_run_${op}`,
    });
  }
  rules.push({
    id: "gh_run_read",
    match: { type: "argv_prefix", argv: ["run"] },
    action_class: "read",
    target_class: "github_platform",
    detail: "gh_run",
  });

  for (const top of ["pr", "issue"]) {
    for (const op of ["create", "merge", "close", "reopen", "comment"]) {
      rules.push({
        id: `gh_${top}_${op}`,
        match: { type: "argv_prefix", argv: [top, op] },
        action_class: "external_side_effect",
        target_class: "github_platform",
        detail: `gh_${top}_${op}`,
      });
    }
    rules.push({
      id: `gh_${top}_read`,
      match: { type: "argv_prefix", argv: [top] },
      action_class: "read",
      target_class: "github_platform",
      detail: `gh_${top}`,
    });
  }

  for (const op of ["create", "delete"]) {
    rules.push({
      id: `gh_release_${op}`,
      match: { type: "argv_prefix", argv: ["release", op] },
      action_class: "external_side_effect",
      target_class: "github_platform",
      detail: `gh_release_${op}`,
    });
  }
  rules.push({
    id: "gh_release_read",
    match: { type: "argv_prefix", argv: ["release"] },
    action_class: "read",
    target_class: "github_platform",
    detail: "gh_release",
  });

  return rules;
}

function gcloudRules() {
  const rules = [];

  rules.push(
    {
      id: "gcloud_auth_login",
      match: { type: "argv_prefix", argv: ["auth", "login"] },
      action_class: "credential_use",
      target_class: "gcp",
      detail: "gcloud_auth_login",
    },
    {
      id: "gcloud_auth_activate_sa",
      match: { type: "argv_prefix", argv: ["auth", "activate-service-account"] },
      action_class: "credential_use",
      target_class: "gcp",
      detail: "gcloud_auth_activate-service-account",
    },
    {
      id: "gcloud_auth_read",
      match: { type: "argv_prefix", argv: ["auth"] },
      action_class: "read",
      target_class: "gcp",
      detail: "gcloud_auth_read",
    }
  );

  rules.push(
    {
      id: "gcloud_secrets_access",
      match: { type: "argv_prefix", argv: ["secrets", "versions", "access"] },
      action_class: "credential_reveal",
      target_class: "gcp",
      detail: "gcloud_secrets_access",
    },
    {
      id: "gcloud_secrets_create",
      match: { type: "argv_prefix", argv: ["secrets", "create"] },
      action_class: "external_side_effect",
      target_class: "gcp",
      detail: "gcloud_secrets_create",
    },
    {
      id: "gcloud_secrets_delete",
      match: { type: "argv_prefix", argv: ["secrets", "delete"] },
      action_class: "external_side_effect",
      target_class: "gcp",
      detail: "gcloud_secrets_delete",
    },
    {
      id: "gcloud_secrets_read",
      match: { type: "argv_prefix", argv: ["secrets"] },
      action_class: "read",
      target_class: "gcp",
      detail: "gcloud_secrets",
    }
  );

  rules.push(
    {
      id: "gcloud_config_set",
      match: { type: "argv_prefix", argv: ["config", "set"] },
      action_class: "write_external_state",
      target_class: "gcp",
      detail: "gcloud_config_set",
    },
    {
      id: "gcloud_config_read",
      match: { type: "argv_prefix", argv: ["config"] },
      action_class: "read",
      target_class: "gcp",
      detail: "gcloud_config",
    }
  );

  for (const sub of ["run", "functions", "compute", "deploy", "builds", "container"]) {
    rules.push({
      id: `gcloud_${sub}`,
      match: { type: "argv_prefix", argv: [sub] },
      action_class: "external_side_effect",
      target_class: "gcp",
      detail: `gcloud_${sub}`,
    });
  }

  return rules;
}

function gsutilRules() {
  const rules = [];
  rules.push({
    id: "gsutil_rm",
    match: { type: "argv_prefix", argv: ["rm"] },
    action_class: "destructive",
    target_class: "gcp_storage",
    detail: "gsutil_rm",
  });
  for (const s of ["cp", "rsync", "mv"]) {
    rules.push({
      id: `gsutil_${s}`,
      match: { type: "argv_prefix", argv: [s] },
      action_class: "external_side_effect",
      target_class: "gcp_storage",
      detail: `gsutil_${s}`,
    });
  }
  for (const s of ["ls", "du", "stat"]) {
    rules.push({
      id: `gsutil_${s}`,
      match: { type: "argv_prefix", argv: [s] },
      action_class: "read",
      target_class: "gcp_storage",
      detail: `gsutil_${s}`,
    });
  }
  return rules;
}

function bqRules() {
  const rules = [];
  rules.push({
    id: "bq_rm",
    match: { type: "argv_prefix", argv: ["rm"] },
    action_class: "destructive",
    target_class: "gcp_bigquery",
    detail: "bq_rm",
  });
  rules.push({
    id: "bq_delete",
    match: { type: "argv_prefix", argv: ["delete"] },
    action_class: "destructive",
    target_class: "gcp_bigquery",
    detail: "bq_delete",
  });
  for (const s of ["query", "load", "mk"]) {
    rules.push({
      id: `bq_${s}`,
      match: { type: "argv_prefix", argv: [s] },
      action_class: "external_side_effect",
      target_class: "gcp_bigquery",
      detail: `bq_${s}`,
    });
  }
  for (const s of ["show", "ls", "extract"]) {
    rules.push({
      id: `bq_${s}`,
      match: { type: "argv_prefix", argv: [s] },
      action_class: "read",
      target_class: "gcp_bigquery",
      detail: `bq_${s}`,
    });
  }
  return rules;
}

function terraformRules() {
  return [
    {
      id: "terraform_plan",
      match: { type: "argv_prefix", argv: ["plan"] },
      action_class: "simulate",
      target_class: "cloud_infra",
      detail: "terraform_plan",
    },
    {
      id: "terraform_apply",
      match: { type: "argv_prefix", argv: ["apply"] },
      action_class: "external_side_effect",
      target_class: "cloud_infra",
      detail: "terraform_apply",
    },
    {
      id: "terraform_destroy",
      match: { type: "argv_prefix", argv: ["destroy"] },
      action_class: "destructive",
      target_class: "cloud_infra",
      detail: "terraform_destroy",
    },
    {
      id: "terraform_fmt",
      match: { type: "argv_prefix", argv: ["fmt"] },
      action_class: "validate",
      target_class: "cloud_infra",
      detail: "terraform_fmt",
    },
    {
      id: "terraform_validate",
      match: { type: "argv_prefix", argv: ["validate"] },
      action_class: "validate",
      target_class: "cloud_infra",
      detail: "terraform_validate",
    },
    {
      id: "terraform_show",
      match: { type: "argv_prefix", argv: ["show"] },
      action_class: "read",
      target_class: "cloud_infra",
      detail: "terraform_show",
    },
  ];
}

const tools = {
  terraform: tool("terraform", {
    risk_profile: "infrastructure",
    capabilities: ["infra.plan", "infra.validate", "infra.apply"],
    aliases: ["terraform"],
    rules: terraformRules(),
    adapter: "terraform",
    delegate_unmatched_to_adapter: true,
  }),

  kubectl: tool("kubectl", {
    risk_profile: "kubernetes",
    capabilities: ["k8s.read", "k8s.mutate"],
    aliases: ["kubectl"],
    adapter: "kubectl",
    delegate_unmatched_to_adapter: true,
  }),

  aws: tool("aws", {
    risk_profile: "cloud_api",
    capabilities: ["aws.invoke"],
    aliases: ["aws"],
    adapter: "aws",
    delegate_unmatched_to_adapter: true,
  }),

  git: tool("git", {
    risk_profile: "source_control",
    capabilities: ["git.read", "git.write"],
    aliases: ["git"],
    adapter: "git",
    delegate_unmatched_to_adapter: true,
  }),

  filesystem: tool("filesystem", {
    risk_profile: "workspace_fs",
    capabilities: ["fs.read", "fs.write"],
    aliases: [
      "cat",
      "head",
      "tail",
      "less",
      "more",
      "ls",
      "stat",
      "du",
      "pwd",
      "realpath",
      "touch",
      "mkdir",
      "mv",
      "cp",
      "chmod",
      "ln",
      "rm",
      "rmdir",
      "find",
    ],
    adapter: "filesystem",
    delegate_unmatched_to_adapter: true,
  }),

  docker: tool("docker", {
    risk_profile: "containers",
    capabilities: ["container.ops"],
    aliases: ["docker", "podman"],
    rules: dockerRules(),
    delegate_unmatched_to_adapter: false,
  }),

  n8n: tool("n8n", {
    risk_profile: "automation",
    capabilities: ["workflow.automation"],
    aliases: ["n8n"],
    rules: n8nRules(),
    delegate_unmatched_to_adapter: false,
  }),

  github_actions: tool("github_actions", {
    risk_profile: "github_platform",
    capabilities: ["github.cli"],
    aliases: ["gh"],
    rules: ghRules(),
    delegate_unmatched_to_adapter: false,
  }),

  gcloud: tool("gcloud", {
    risk_profile: "gcp",
    capabilities: ["gcloud.deploy"],
    aliases: ["gcloud"],
    rules: gcloudRules(),
    delegate_unmatched_to_adapter: false,
  }),

  gsutil: tool("gsutil", {
    risk_profile: "gcp_storage",
    capabilities: ["gsutil.transfer"],
    aliases: ["gsutil"],
    rules: gsutilRules(),
    delegate_unmatched_to_adapter: false,
  }),

  bq: tool("bq", {
    risk_profile: "gcp_bigquery",
    capabilities: ["bq.query"],
    aliases: ["bq"],
    rules: bqRules(),
    delegate_unmatched_to_adapter: false,
  }),

  jenkins: tool("jenkins", {
    risk_profile: "ci_cd",
    capabilities: ["jenkins.cli"],
    aliases: ["jenkins", "jenkins-cli"],
    rules: jenkinsRules(),
    delegate_unmatched_to_adapter: false,
  }),
};

module.exports = {
  version: "tool-action-manifest.orchestrator.v1",
  tools,
};
