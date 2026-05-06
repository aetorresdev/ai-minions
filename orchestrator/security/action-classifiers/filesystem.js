"use strict";

const path = require("path");

const READ_ONLY = new Set(["cat", "head", "tail", "less", "more", "ls", "stat", "du", "pwd", "realpath"]);
const WRITE_LOCAL = new Set(["touch", "mkdir", "mv", "cp", "chmod", "ln"]);
const DESTRUCTIVE = new Set(["rm", "rmdir"]);

function pathOutsideRepo(repoRoot, candidate) {
  if (!repoRoot || !candidate || candidate.startsWith("-")) return null;
  const absRepo = path.resolve(repoRoot);
  const absTarget = path.resolve(repoRoot, candidate);
  const rel = path.relative(absRepo, absTarget);
  return rel.startsWith("..") || path.isAbsolute(candidate);
}

/**
 * Classify common filesystem-oriented shell binaries (argv after executable).
 * `ctx.repoRoot` optional — when set, distinguishes write_local_repo vs write_external_state for paths.
 */
function classify(args, ctx = {}) {
  const exe = (ctx.executable || "").toLowerCase();
  const repoRoot = ctx.repoRoot;

  if (READ_ONLY.has(exe)) return { action_class: "read", detail: exe };

  if (WRITE_LOCAL.has(exe)) {
    const paths = args.filter((a) => !a.startsWith("-"));
    if (repoRoot && paths.some((p) => pathOutsideRepo(repoRoot, p))) {
      return { action_class: "write_external_state", detail: `${exe}_outside_repo` };
    }
    return { action_class: "write_local_repo", detail: exe };
  }

  if (DESTRUCTIVE.has(exe)) return { action_class: "destructive", detail: exe };

  if (exe === "find") return { action_class: "read", detail: "find" };

  return { action_class: "unknown", detail: exe };
}

module.exports = { classify, pathOutsideRepo };
