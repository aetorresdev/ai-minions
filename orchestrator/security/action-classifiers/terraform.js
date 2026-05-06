"use strict";

/**
 * Classify terraform CLI (argv after `terraform`).
 */
function classify(args) {
  const sub = (args[0] || "").toLowerCase();
  if (!sub) return { action_class: "unknown", detail: "terraform_missing_subcommand" };

  if (sub === "state") {
    const op = (args[1] || "").toLowerCase();
    if (op === "rm" || op === "mv") return { action_class: "destructive", detail: `terraform state ${op}` };
    return { action_class: "read", detail: "terraform_state_read" };
  }

  if (sub === "fmt" || sub === "validate") return { action_class: "validate", detail: `terraform_${sub}` };
  if (sub === "plan") return { action_class: "simulate", detail: "terraform_plan" };
  if (sub === "show" || sub === "output" || sub === "graph") return { action_class: "read", detail: `terraform_${sub}` };
  if (sub === "destroy" || sub === "taint" || sub === "untaint") {
    return { action_class: "destructive", detail: `terraform_${sub}` };
  }
  if (sub === "apply" || sub === "refresh" || sub === "import" || sub === "console") {
    return { action_class: "external_side_effect", detail: `terraform_${sub}` };
  }
  if (sub === "workspace") {
    const op = (args[1] || "").toLowerCase();
    if (op === "list" || op === "show") return { action_class: "read", detail: "terraform_workspace_read" };
    return { action_class: "external_side_effect", detail: "terraform_workspace" };
  }

  if (sub === "init" || sub === "get" || sub === "providers") {
    return { action_class: "external_side_effect", detail: `terraform_${sub}` };
  }

  return { action_class: "unknown", detail: `terraform_${sub}` };
}

module.exports = { classify };
