"use strict";

/**
 * Observable reason codes for permission traces and the permission evaluator.
 * Evaluator maps these to deny | requires_approval | allow per profile.
 */
module.exports = {
  MANIFEST_INVALID: "manifest_invalid",
  MISSING_EXECUTABLE: "missing_executable",
  UNKNOWN_TOOL: "unknown_tool",
  UNKNOWN_ACTION_CLASS: "unknown_action_class",
  MANIFEST_TOOL_MISSING: "manifest_tool_missing",
  MISSING_ADAPTER: "missing_adapter",
  CLASSIFIER_INVALID_OUTPUT: "classifier_invalid_output",
  CLASSIFIED_BY_MANIFEST: "classified_by_manifest",
  CLASSIFIED_BY_ADAPTER: "classified_by_adapter",
};
