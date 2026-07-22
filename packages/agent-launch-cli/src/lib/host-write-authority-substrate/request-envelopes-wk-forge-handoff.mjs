

import {
  HOST_WRITE_AUTHORITY_OPS,
  HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
  isPlainObject
} from "./protocol-constants.mjs";

export const WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION = "wk-forge-handoff.v1";

export const HOST_WRITE_AUTHORITY_WK_FORGE_HANDOFF_REQUEST_FIELDS = Object.freeze([
  "assigned_unit"
]);

export const HOST_WRITE_AUTHORITY_WK_FORGE_HANDOFF_COMPLETED_RESPONSE_FIELDS =
  Object.freeze([
    "schema_version",
    "substrate_id",
    "protocol_version",
    "kind",
    "forge_handoff"
  ]);

export const WK_FORGE_HANDOFF_BROKER_CATEGORIES = Object.freeze({
  REQUEST_INVALID: "request_invalid",
  REMOTE_INVALID: "remote_invalid",
  ELIGIBILITY: "eligibility",
  PUBLICATION_DISAGREEMENT: "publication_disagreement",
  INDETERMINATE: "indeterminate",
  GIT_FAILED: "git_failed"
});

export const WK_FORGE_HANDOFF_RESULT_KINDS = Object.freeze({
  NO_CHANGES: "no_changes",
  HANDED_OFF: "handed_off",
  HUMAN_ACTION_REQUIRED: "human_action_required",
  HUMAN_RECONCILIATION_REQUIRED: "human_reconciliation_required"
});

const WK_RECORD_RE = /^WK-\d{4}$/u;
const INITIATIVE_RE = /^IN-\d{4}$/u;
const OBJECT_ID_RE = /^[0-9a-f]{40}$/u;
const FORGE_HOST_RE = /^[a-z0-9.-]+$/u;
const FORGE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/u;
const HANDOFF_REF_RE = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/u;

const RESULT_FIELDS_COMMON = ["schema_version", "kind", "assigned_unit", "initiative"];
const WK_FORGE_HANDOFF_RESULT_FIELDS_BY_KIND = Object.freeze({
  [WK_FORGE_HANDOFF_RESULT_KINDS.NO_CHANGES]: Object.freeze([
    ...RESULT_FIELDS_COMMON,
    "tree"
  ]),
  [WK_FORGE_HANDOFF_RESULT_KINDS.HANDED_OFF]: Object.freeze([
    ...RESULT_FIELDS_COMMON,
    "branch",
    "branch_state",
    "commit",
    "tree",
    "parent",
    "base_branch",
    "repository",
    "pull_request_state",
    "pull_request"
  ]),
  [WK_FORGE_HANDOFF_RESULT_KINDS.HUMAN_ACTION_REQUIRED]: Object.freeze([
    ...RESULT_FIELDS_COMMON,
    "repository",
    "landing_branch",
    "expected_landing_sha",
    "local_handoff_ref",
    "squash_sha",
    "merge_command"
  ]),
  [WK_FORGE_HANDOFF_RESULT_KINDS.HUMAN_RECONCILIATION_REQUIRED]: Object.freeze([
    ...RESULT_FIELDS_COMMON,
    "reason"
  ])
});

const REPOSITORY_FIELDS = Object.freeze(["host", "owner", "name"]);
const PULL_REQUEST_FIELDS = Object.freeze([
  "number",
  "state",
  "merged",
  "url",
  "mergeable_state"
]);
const MERGE_COMMAND_FIELDS = Object.freeze(["program", "argv"]);

function exactObjectFields(value, fields) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

export function isCompleteWkForgeHandoffRequestIdentity(request) {
  return exactObjectFields(request, HOST_WRITE_AUTHORITY_WK_FORGE_HANDOFF_REQUEST_FIELDS) &&
    typeof request.assigned_unit === "string" &&
    WK_RECORD_RE.test(request.assigned_unit);
}

export function buildHostWriteAuthorityWkForgeHandoffRequest(request) {
  if (!isPlainObject(request)) return Object.freeze({});
  const sanitized = {};
  for (const field of HOST_WRITE_AUTHORITY_WK_FORGE_HANDOFF_REQUEST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(request, field)) {
      sanitized[field] = request[field];
    }
  }
  return Object.freeze(sanitized);
}

export function buildHostWriteAuthorityWkForgeHandoffEnvelope(request) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    op: HOST_WRITE_AUTHORITY_OPS.WK_FORGE_HANDOFF,
    forge_request: buildHostWriteAuthorityWkForgeHandoffRequest(request)
  });
}

function validRepository(value) {
  return exactObjectFields(value, REPOSITORY_FIELDS) &&
    typeof value.host === "string" && FORGE_HOST_RE.test(value.host) &&
    typeof value.owner === "string" && FORGE_SEGMENT_RE.test(value.owner) &&
    typeof value.name === "string" && FORGE_SEGMENT_RE.test(value.name);
}

function validPullRequest(value) {
  if (!exactObjectFields(value, PULL_REQUEST_FIELDS)) return false;
  if (!Number.isInteger(value.number) || value.number <= 0) return false;
  if (value.state !== null && typeof value.state !== "string") return false;
  if (typeof value.merged !== "boolean") return false;
  if (value.url !== null && typeof value.url !== "string") return false;
  if (value.mergeable_state !== null && typeof value.mergeable_state !== "string") return false;
  return true;
}

function validMergeCommand(value) {
  return exactObjectFields(value, MERGE_COMMAND_FIELDS) &&
    typeof value.program === "string" && value.program.length > 0 &&
    Array.isArray(value.argv) &&
    value.argv.every((arg) => typeof arg === "string" && arg.length > 0);
}

export function validateWkForgeHandoffResult(result, request) {
  if (!isCompleteWkForgeHandoffRequestIdentity(request)) {
    return { ok: false, detail: { issue: "forge_handoff_request_identity_incomplete" } };
  }
  if (!isPlainObject(result)) {
    return { ok: false, detail: { issue: "forge_handoff_result_not_object" } };
  }
  if (result.schema_version !== WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION) {
    return {
      ok: false,
      detail: {
        issue: "forge_handoff_result_schema_version_mismatch",
        received: result.schema_version ?? null
      }
    };
  }
  const fields = WK_FORGE_HANDOFF_RESULT_FIELDS_BY_KIND[result.kind] ?? null;
  if (fields === null || !exactObjectFields(result, fields)) {
    return {
      ok: false,
      detail: {
        issue: "forge_handoff_result_shape_invalid",
        kind: typeof result.kind === "string" ? result.kind : null,
        keys: isPlainObject(result) ? Object.keys(result).sort() : null
      }
    };
  }
  if (result.assigned_unit !== request.assigned_unit ||
      !WK_RECORD_RE.test(result.assigned_unit) ||
      typeof result.initiative !== "string" || !INITIATIVE_RE.test(result.initiative)) {
    return { ok: false, detail: { issue: "forge_handoff_result_identity_unbound" } };
  }
  const { kind } = result;
  if (kind === WK_FORGE_HANDOFF_RESULT_KINDS.NO_CHANGES) {
    if (!OBJECT_ID_RE.test(result.tree)) {
      return { ok: false, detail: { issue: "forge_handoff_no_changes_tree_invalid" } };
    }
    return { ok: true };
  }
  if (kind === WK_FORGE_HANDOFF_RESULT_KINDS.HANDED_OFF) {
    const ok =
      typeof result.branch === "string" && BRANCH_RE.test(result.branch) &&
      (result.branch_state === "published" || result.branch_state === "recovered") &&
      OBJECT_ID_RE.test(result.commit) &&
      OBJECT_ID_RE.test(result.tree) &&
      OBJECT_ID_RE.test(result.parent) &&
      typeof result.base_branch === "string" && BRANCH_RE.test(result.base_branch) &&
      validRepository(result.repository) &&
      (result.pull_request_state === "created" || result.pull_request_state === "recovered") &&
      validPullRequest(result.pull_request);
    return ok
      ? { ok: true }
      : { ok: false, detail: { issue: "forge_handoff_handed_off_fields_invalid" } };
  }
  if (kind === WK_FORGE_HANDOFF_RESULT_KINDS.HUMAN_ACTION_REQUIRED) {
    const ok =
      validRepository(result.repository) &&
      typeof result.landing_branch === "string" && BRANCH_RE.test(result.landing_branch) &&
      OBJECT_ID_RE.test(result.expected_landing_sha) &&
      typeof result.local_handoff_ref === "string" && HANDOFF_REF_RE.test(result.local_handoff_ref) &&
      OBJECT_ID_RE.test(result.squash_sha) &&
      validMergeCommand(result.merge_command);
    return ok
      ? { ok: true }
      : { ok: false, detail: { issue: "forge_handoff_human_action_fields_invalid" } };
  }

  if (typeof result.reason !== "string" || result.reason.length === 0) {
    return { ok: false, detail: { issue: "forge_handoff_human_reconciliation_reason_invalid" } };
  }
  return { ok: true };
}
