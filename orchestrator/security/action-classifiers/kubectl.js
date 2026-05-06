"use strict";

const READ = new Set([
  "get",
  "describe",
  "logs",
  "explain",
  "top",
  "cluster-info",
  "api-resources",
  "api-versions",
  "auth",
  "config",
  "wait",
]);

/**
 * Classify kubectl CLI (argv after `kubectl`).
 */
function classify(args) {
  const sub = (args[0] || "").toLowerCase();
  if (!sub) return { action_class: "unknown", detail: "kubectl_missing_subcommand" };

  if (sub === "diff") return { action_class: "simulate", detail: "kubectl_diff" };
  if (READ.has(sub)) return { action_class: "read", detail: `kubectl_${sub}` };
  if (sub === "delete") return { action_class: "destructive", detail: "kubectl_delete" };
  if (sub === "apply" || sub === "patch" || sub === "replace" || sub === "scale" || sub === "rollout") {
    return { action_class: "external_side_effect", detail: `kubectl_${sub}` };
  }
  if (sub === "create" || sub === "run" || sub === "expose") {
    return { action_class: "external_side_effect", detail: `kubectl_${sub}` };
  }
  if (sub === "exec" || sub === "attach") return { action_class: "execute", detail: `kubectl_${sub}` };
  if (sub === "port-forward") return { action_class: "external_side_effect", detail: "kubectl_port_forward" };
  if (sub === "cp") return { action_class: "external_side_effect", detail: "kubectl_cp" };

  return { action_class: "unknown", detail: `kubectl_${sub}` };
}

module.exports = { classify };
