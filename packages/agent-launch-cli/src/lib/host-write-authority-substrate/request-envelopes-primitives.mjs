

import {
  isPlainObject
} from "./protocol-constants.mjs";

const CANONICAL_GIT_OBJECT_ID_RE = /^[0-9a-f]{40}$/u;
export function isCanonicalGitObjectId(value) {
  return typeof value === "string" && CANONICAL_GIT_OBJECT_ID_RE.test(value);
}

export const COMMIT_RESULT_ASSIGNED_UNIT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
export const CANONICAL_SLICE_OUTPUT_REF_RE =
  /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;

export function isCompleteCommitSliceRequestIdentity(identity) {
  return isPlainObject(identity) &&
    typeof identity.assigned_unit === "string" &&
    COMMIT_RESULT_ASSIGNED_UNIT_RE.test(identity.assigned_unit) &&
    typeof identity.launch_ref === "string" && identity.launch_ref.length > 0 &&
    typeof identity.run_id === "string" && identity.run_id.length > 0 &&
    Number.isInteger(identity.retry_id) && identity.retry_id >= 0;
}

const INTEGRATION_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
export function isIntegrationOid(value) {
  return typeof value === "string" && INTEGRATION_OID_RE.test(value) && !/^0+$/u.test(value);
}
export const INTEGRATION_ASSIGNED_UNIT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
export const INTEGRATION_WK_REF_RE = /^refs\/heads\/wk\/(IN-\d{4})\/(WK-\d{4})$/u;
export const INTEGRATION_SLICE_REF_RE = /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;
export const INTEGRATION_REVIEW_UNIT_ADDRESS_RE = /^(IN-\d{4})\/(WK-\d{4})$/u;

export function isCompleteIntegrateSliceRequestIdentity(identity) {
  return isPlainObject(identity) &&
    typeof identity.assigned_unit === "string" &&
    INTEGRATION_ASSIGNED_UNIT_RE.test(identity.assigned_unit) &&
    typeof identity.launch_ref === "string" && identity.launch_ref.length > 0 &&
    typeof identity.run_id === "string" && identity.run_id.length > 0 &&
    Number.isInteger(identity.retry_id) && identity.retry_id >= 0;
}
