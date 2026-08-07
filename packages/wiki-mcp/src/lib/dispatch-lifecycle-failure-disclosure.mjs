

import {
  FULL_INDEX_CONFIG_KEYS,
  FULL_INDEX_CONFIG_SCOPES,
  HISTORICAL_DELIVERY_INDEX_RECOVERY,
  projectAuthenticatedSliceReviewMaterializationFailure,
  SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND,
  SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION,
  SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE,
  SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES,
  SLICE_REVIEW_POSTCHECK_STATE_BUDGET
} from "@agent-chassis/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import {
  CLOSED_CANDIDATE_FAILURE_KINDS,
  projectClosedLifecycleFailure
} from "./dispatch-lifecycle-failure-projection.mjs";
import {
  POST_WORKER_LIFECYCLE_PHASES
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import {
  projectSafePostcheckMismatchField,
  SAFE_POSTCHECK_MISMATCH_FIELDS
} from "./dispatch-tool-helpers.mjs";

const GENERIC_LIFECYCLE_FAILURE_CODE = "agent_launch.slice_lifecycle.failed.v1";
const GENERIC_LIFECYCLE_FAILURE_MESSAGE = "post-worker slice lifecycle invocation failed";

const PUBLISHABLE_CANDIDATE_FAILURE_KINDS = Object.freeze(
  new Set(Object.values(CLOSED_CANDIDATE_FAILURE_KINDS))
);

function publishableCandidateGitDetail(detail) {
  if (typeof detail !== "object" || detail === null) return null;
  const projected = {};
  if (Array.isArray(detail.git_args)) {
    projected.git_args = Object.freeze(detail.git_args.filter((arg) => typeof arg === "string"));
  }
  if (typeof detail.git_status === "number") projected.git_status = detail.git_status;
  if (typeof detail.git_stderr === "string") projected.git_stderr = detail.git_stderr;
  return Object.keys(projected).length === 0 ? null : Object.freeze(projected);
}

function publishableCandidateFailure(candidateFailure) {
  if (typeof candidateFailure !== "object" || candidateFailure === null) return null;
  if (!PUBLISHABLE_CANDIDATE_FAILURE_KINDS.has(candidateFailure.kind)) return null;
  return Object.freeze({
    kind: candidateFailure.kind,
    code: typeof candidateFailure.code === "string" ? candidateFailure.code : null,
    message: typeof candidateFailure.message === "string" ? candidateFailure.message : null,
    detail: publishableCandidateGitDetail(candidateFailure.detail)
  });
}

const APPROVED_MATERIALIZATION_CODES = Object.freeze(
  new Set(Object.values(SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES))
);
const APPROVED_MATERIALIZATION_PREDICATES = Object.freeze(
  new Set(SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES)
);
const MATERIALIZATION_REFUSED_PSEUDOREFS =
  SLICE_REVIEW_POSTCHECK_STATE_BUDGET.refused_pseudorefs;
const MATERIALIZATION_CONFIG_KEYS = FULL_INDEX_CONFIG_KEYS;
const MATERIALIZATION_CONFIG_SCOPES = FULL_INDEX_CONFIG_SCOPES;
const MATERIALIZATION_MAX_SUFFIX_DEPTH =
  HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits;

function publishableMaterializationDetail(detail) {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return null;
  const predicate = typeof detail.predicate === "string" &&
    APPROVED_MATERIALIZATION_PREDICATES.has(detail.predicate)
    ? detail.predicate
    : null;
  const enumField = (key, allowed) =>
    (typeof detail[key] === "string" && allowed.includes(detail[key]) ? detail[key] : null);
  const integerField = (key, minimum, maximum) =>
    (Number.isInteger(detail[key]) && detail[key] >= minimum && detail[key] <= maximum
      ? detail[key]
      : null);
  return Object.freeze({
    predicate,
    field: enumField("field", SAFE_POSTCHECK_MISMATCH_FIELDS),
    pseudoref: enumField("pseudoref", MATERIALIZATION_REFUSED_PSEUDOREFS),
    config_key: enumField("config_key", MATERIALIZATION_CONFIG_KEYS),
    config_scope: enumField("config_scope", MATERIALIZATION_CONFIG_SCOPES),
    suffix_depth: integerField("suffix_depth", 0, MATERIALIZATION_MAX_SUFFIX_DEPTH),
    traversal_bound: integerField("traversal_bound", 0, MATERIALIZATION_MAX_SUFFIX_DEPTH),
    git_exit_status: integerField("git_exit_status", 0, 255)
  });
}

function publishableMaterializationProjection(projected) {
  if (typeof projected !== "object" || projected === null || Array.isArray(projected)) {
    return null;
  }
  if (projected.schema_version !== SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION ||
      projected.kind !== SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND ||
      projected.message !== SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE ||
      typeof projected.code !== "string" ||
      !APPROVED_MATERIALIZATION_CODES.has(projected.code)) {
    return null;
  }
  const detail = publishableMaterializationDetail(projected.detail);
  if (detail === null) return null;
  return Object.freeze({
    schema_version: SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION,
    kind: SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND,
    code: projected.code,
    message: SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE,
    detail
  });
}

function publishableMaterializationFailure(error) {
  let projected;
  try {
    projected = projectAuthenticatedSliceReviewMaterializationFailure(error);
  } catch {
    return null;
  }
  return projected === null ? null : publishableMaterializationProjection(projected);
}

function safePostcheckMismatchField(error) {
  try {
    return projectSafePostcheckMismatchField(error);
  } catch {
    return null;
  }
}

export function buildLifecycleFailure(checkpoint, error) {
  const closed = projectClosedLifecycleFailure(error);
  const failure = {
    invoked: true,
    phase: checkpoint.phase,
    integrated: checkpoint.phase !== POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
    error_code: closed === null ? GENERIC_LIFECYCLE_FAILURE_CODE : closed.code,

    error_message: closed?.message ?? GENERIC_LIFECYCLE_FAILURE_MESSAGE,
    error_message_truncated: false
  };
  if (closed === null) {

    const mismatchField = safePostcheckMismatchField(error);
    if (mismatchField !== null) failure.postcheck_mismatch_field = mismatchField;

    const materializationFailure = publishableMaterializationFailure(error);
    if (materializationFailure !== null) {
      failure.materialization_failure = materializationFailure;
    }
  } else {
    const candidateFailure = publishableCandidateFailure(closed.candidate_failure);
    if (candidateFailure !== null) failure.candidate_failure = candidateFailure;
  }
  if (checkpoint.integration) failure.integration = checkpoint.integration;
  return Object.freeze(failure);
}

export function publishableLifecycleFailure(lifecycle) {
  if (lifecycle === null || typeof lifecycle !== "object") return lifecycle ?? null;
  const strip = [];
  const rebuild = new Map();
  if (Object.hasOwn(lifecycle, "postcheck_mismatch_field")) {
    const value = lifecycle.postcheck_mismatch_field;
    if (typeof value !== "string" || !SAFE_POSTCHECK_MISMATCH_FIELDS.includes(value)) {
      strip.push("postcheck_mismatch_field");
    }
  }
  if (Object.hasOwn(lifecycle, "materialization_failure")) {
    const rebuilt = publishableMaterializationProjection(lifecycle.materialization_failure);
    if (rebuilt === null) strip.push("materialization_failure");
    else rebuild.set("materialization_failure", rebuilt);
  }
  if (strip.length === 0 && rebuild.size === 0) return lifecycle;
  const bounded = { ...lifecycle };
  for (const key of strip) delete bounded[key];
  for (const [key, value] of rebuild) bounded[key] = value;
  return Object.freeze(bounded);
}

export class RecordedLifecycleFailure extends Error {
  constructor(failure) {
    super("post-worker slice lifecycle invocation failed");
    this.name = "RecordedLifecycleFailure";
    this.failure = failure;
  }
}
