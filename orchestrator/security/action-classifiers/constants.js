"use strict";

/**
 * Normalized action_class strings consumed by permission profiles and the permission evaluator.
 * Classifiers only emit values from this set (plus optional detail strings).
 */
const ACTION_CLASSES = [
  "read",
  "validate",
  "simulate",
  "generate",
  "write_draft",
  "write_local_repo",
  "write_external_state",
  "execute",
  "external_side_effect",
  "destructive",
  "credential_use",
  "credential_reveal",
  "credential_export",
  "unknown",
];

const ACTION_CLASS_SET = new Set(ACTION_CLASSES);

module.exports = {
  ACTION_CLASSES,
  ACTION_CLASS_SET,
};
