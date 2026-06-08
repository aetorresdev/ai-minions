"use strict";

const { DEFAULT_AGENT_PERMISSIONS } = require("./constants");

/**
 * @typedef {object} ActorCapabilitySnapshot
 * @property {string} actor_class
 * @property {boolean | null} direct_merge_allowed
 * @property {boolean | null} direct_push_protected_allowed
 * @property {boolean | null} tag_create_allowed
 * @property {boolean | null} release_publish_allowed
 */

/**
 * @param {boolean | undefined} flag
 * @param {boolean} hasConfig
 * @returns {boolean | null}
 */
function permissionTriState(flag, hasConfig) {
  if (!hasConfig) return null;
  return flag === true;
}

/**
 * @param {{
 *   actor_class?: string | null,
 *   explicit_config?: object | null,
 * }} input
 * @returns {ActorCapabilitySnapshot}
 */
function inspectActorCapabilities(input) {
  const hasConfig = Boolean(input.explicit_config);
  const perms = hasConfig
    ? Object.assign({}, DEFAULT_AGENT_PERMISSIONS, input.explicit_config.agent_permissions || {})
    : null;
  const actorClass =
    input.actor_class != null && String(input.actor_class).trim()
      ? String(input.actor_class).slice(0, 64)
      : "unknown";

  return {
    actor_class: actorClass,
    direct_merge_allowed: permissionTriState(perms?.allow_direct_merge, hasConfig),
    direct_push_protected_allowed: permissionTriState(perms?.allow_direct_push_protected, hasConfig),
    tag_create_allowed: permissionTriState(perms?.allow_production_tag_create, hasConfig),
    release_publish_allowed: permissionTriState(perms?.allow_release_publish, hasConfig),
  };
}

module.exports = {
  inspectActorCapabilities,
};
