"use strict";

/**
 * Classify AWS CLI (argv after `aws`). Service-first argv; heuristic keyword scan.
 */
function classify(args) {
  if (!args.length) return { action_class: "unknown", detail: "aws_missing_args" };

  const joined = args.map((a) => String(a)).join(" ").toLowerCase();

  if (
    joined.includes(" get-secret-value") ||
    joined.includes(" get-parameter") ||
    joined.includes("batch-get-secret-value")
  ) {
    return { action_class: "credential_reveal", detail: "aws_secrets_read" };
  }

  if (
    joined.match(/\b(delete-|terminate-|remove-|rb\b|purge-|destroy-|detach-volume)/) ||
    (joined.includes(" s3 ") && joined.includes(" rm")) ||
    joined.includes(" delete-stack")
  ) {
    return { action_class: "destructive", detail: "aws_destructive" };
  }

  if (
    joined.includes(" invoke") ||
    joined.includes(" cp ") ||
    joined.includes(" sync ") ||
    joined.includes(" deploy") ||
    joined.includes(" create-") ||
    joined.includes(" update-") ||
    joined.includes(" put-object") ||
    joined.includes(" start-") ||
    joined.includes(" stop-instances") ||
    joined.includes(" run-instances") ||
    joined.includes(" apply-migration")
  ) {
    return { action_class: "external_side_effect", detail: "aws_mutate" };
  }

  if (
    joined.includes("get-caller-identity") ||
    joined.includes("describe-") ||
    joined.includes(" list-") ||
    joined.includes(" list ") ||
    joined.match(/\bs3\s+ls\b/) ||
    joined.match(/\bs3api\s+list-objects\b/) ||
    joined.match(/\bget-function\b/) ||
    joined.match(/\bhead-object\b/) ||
    joined.includes("help")
  ) {
    return { action_class: "read", detail: "aws_read" };
  }

  return { action_class: "unknown", detail: "aws_unclassified" };
}

module.exports = { classify };
