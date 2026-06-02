'use strict';

/**
 * Fail-closed validation before git worktree remove — never delete repo root, $HOME, /, or paths outside the managed worktrees root.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * @param {string} targetPath
 * @param {string} candidate
 * @returns {boolean}
 */
function isSamePath(targetPath, candidate) {
  if (!candidate || !String(candidate).trim()) return false;
  const a = path.resolve(targetPath);
  const b = path.resolve(candidate);
  if (a === b) return true;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * @param {string} targetPath resolved absolute path
 * @param {string} allowedRoot resolved absolute managed worktrees directory
 * @returns {boolean}
 */
function isUnderAllowedRoot(targetPath, allowedRoot) {
  const rel = path.relative(allowedRoot, targetPath);
  if (!rel || rel === '.') return false;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * @param {string} targetPath
 * @param {{
 *   allowedRoot: string,
 *   repoRoot?: string,
 *   primaryCwd?: string,
 * }} context
 * @returns {{ ok: true, resolved_path: string } | { ok: false, error: string, reason_code: string }}
 */
function validateCleanupTarget(targetPath, context) {
  if (targetPath == null || typeof targetPath !== 'string' || !targetPath.trim()) {
    return { ok: false, error: 'empty_cleanup_target', reason_code: 'empty_path' };
  }

  const allowedRoot = path.resolve(String(context.allowedRoot || '').trim());
  if (!allowedRoot) {
    return { ok: false, error: 'missing_allowed_root', reason_code: 'invalid_allowed_root' };
  }

  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(targetPath));
  } catch {
    resolved = path.resolve(targetPath);
  }

  if (resolved === path.parse(resolved).root) {
    return { ok: false, error: 'unsafe_cleanup_target', reason_code: 'filesystem_root' };
  }

  const home = os.homedir();
  if (isSamePath(resolved, home)) {
    return { ok: false, error: 'unsafe_cleanup_target', reason_code: 'home_directory' };
  }

  if (context.repoRoot && isSamePath(resolved, context.repoRoot)) {
    return { ok: false, error: 'unsafe_cleanup_target', reason_code: 'repo_root' };
  }

  if (context.primaryCwd && isSamePath(resolved, context.primaryCwd)) {
    return { ok: false, error: 'unsafe_cleanup_target', reason_code: 'primary_cwd' };
  }

  let allowedResolved;
  try {
    allowedResolved = fs.realpathSync(allowedRoot);
  } catch {
    allowedResolved = allowedRoot;
  }

  if (isSamePath(resolved, allowedResolved)) {
    return { ok: false, error: 'unsafe_cleanup_target', reason_code: 'worktrees_root' };
  }

  if (!isUnderAllowedRoot(resolved, allowedResolved)) {
    return { ok: false, error: 'unsafe_cleanup_target', reason_code: 'outside_allowed_root' };
  }

  if (targetPath.includes('..')) {
    const raw = path.resolve(targetPath);
    if (!isUnderAllowedRoot(raw, allowedResolved) && !isSamePath(raw, resolved)) {
      return { ok: false, error: 'unsafe_cleanup_target', reason_code: 'path_escape' };
    }
  }

  return { ok: true, resolved_path: resolved };
}

module.exports = {
  validateCleanupTarget,
  isUnderAllowedRoot,
  isSamePath,
};
