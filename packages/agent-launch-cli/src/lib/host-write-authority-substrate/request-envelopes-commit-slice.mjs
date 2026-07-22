

import {
  isPlainObject
} from "./protocol-constants.mjs";
import {
  isCanonicalGitObjectId,
  COMMIT_RESULT_ASSIGNED_UNIT_RE,
  CANONICAL_SLICE_OUTPUT_REF_RE
} from "./request-envelopes-primitives.mjs";

export const HOST_WRITE_AUTHORITY_SLICE_COMMITTED_RESULT_FIELDS = Object.freeze([
  "committed",
  "submitted_for_review",
  "assigned_unit",
  "commit",
  "tree",
  "base_sha",
  "ref",
  "idempotent",
  "changed_paths",
  "metrics",
  "baseline",
  "attestation",
  "expected_envelope_invariant",
  "transition"
]);

export function validateSliceCommittedCommitResult(commitResult, boundAssignedUnit) {
  if (!isPlainObject(commitResult)) {
    return { ok: false, detail: { issue: "commit_result_not_object" } };
  }
  const keys = Object.keys(commitResult);
  const exact =
    keys.length === HOST_WRITE_AUTHORITY_SLICE_COMMITTED_RESULT_FIELDS.length &&
    HOST_WRITE_AUTHORITY_SLICE_COMMITTED_RESULT_FIELDS.every(
      (field) => Object.prototype.hasOwnProperty.call(commitResult, field)
    );
  if (!exact) {
    return {
      ok: false,
      detail: { issue: "commit_result_fields_not_exact", keys: [...keys].sort() }
    };
  }

  if (commitResult.committed !== true) {
    return { ok: false, detail: { issue: "commit_result_not_committed" } };
  }
  if (commitResult.submitted_for_review !== false) {
    return { ok: false, detail: { issue: "commit_result_submitted_for_review_invalid" } };
  }

  for (const oidField of ["commit", "tree", "base_sha"]) {
    if (!isCanonicalGitObjectId(commitResult[oidField])) {
      return {
        ok: false,
        detail: { issue: "commit_result_object_id_malformed", field: oidField }
      };
    }
  }

  const unitMatch = COMMIT_RESULT_ASSIGNED_UNIT_RE.exec(commitResult.assigned_unit);
  if (!unitMatch) {
    return { ok: false, detail: { issue: "commit_result_assigned_unit_malformed" } };
  }

  const refMatch = typeof commitResult.ref === "string"
    ? CANONICAL_SLICE_OUTPUT_REF_RE.exec(commitResult.ref)
    : null;
  if (!refMatch) {
    return { ok: false, detail: { issue: "commit_result_ref_malformed" } };
  }
  if (refMatch[2] !== unitMatch[1] || refMatch[3] !== unitMatch[2]) {
    return { ok: false, detail: { issue: "commit_result_ref_unit_mismatch" } };
  }

  if (typeof commitResult.idempotent !== "boolean") {
    return { ok: false, detail: { issue: "commit_result_idempotent_not_boolean" } };
  }
  if (!Array.isArray(commitResult.changed_paths)) {
    return { ok: false, detail: { issue: "commit_result_changed_paths_not_array" } };
  }
  for (const objField of [
    "metrics",
    "baseline",
    "attestation",
    "expected_envelope_invariant",
    "transition"
  ]) {
    if (!isPlainObject(commitResult[objField])) {
      return {
        ok: false,
        detail: { issue: "commit_result_nested_object_invalid", field: objField }
      };
    }
  }

  if (commitResult.assigned_unit !== boundAssignedUnit) {
    return {
      ok: false,
      detail: {
        issue: "commit_result_unit_not_bound_to_request",
        expected: typeof boundAssignedUnit === "string" ? boundAssignedUnit : null,
        received: commitResult.assigned_unit
      }
    };
  }
  return { ok: true };
}
