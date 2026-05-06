"use strict";

const READ = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "remote",
  "rev-parse",
  "describe",
  "ls-files",
  "grep",
]);

/**
 * Classify git CLI (argv after `git`).
 */
function classify(args) {
  const sub = (args[0] || "").toLowerCase();
  if (!sub) return { action_class: "unknown", detail: "git_missing_subcommand" };

  if (READ.has(sub)) return { action_class: "read", detail: `git_${sub}` };

  if (sub === "add" || sub === "commit" || sub === "stash") {
    return { action_class: "write_local_repo", detail: `git_${sub}` };
  }

  if (sub === "push" || sub === "fetch" || sub === "pull") {
    return { action_class: "external_side_effect", detail: `git_${sub}` };
  }

  if (sub === "reset" || sub === "clean") return { action_class: "destructive", detail: `git_${sub}` };

  if (sub === "clone" || sub === "merge" || sub === "rebase" || sub === "cherry-pick") {
    return { action_class: "external_side_effect", detail: `git_${sub}` };
  }

  return { action_class: "unknown", detail: `git_${sub}` };
}

module.exports = { classify };
