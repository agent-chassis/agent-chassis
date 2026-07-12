

import {
  AGENT_ROLE_RESULT_REVIEWED_CONTROLS
} from "@agent-chassis/agent-launch-core/src/lib/agent-role-result.mjs";

export const WORKER_ADMISSION_REVIEW_THRESHOLD_TAXONOMY_CODE =
  "worker_admission_review_threshold_exceeded";

export const WORKER_ADMISSION_REJECT_THRESHOLD_TAXONOMY_CODE =
  "worker_admission_reject_threshold_exceeded";

export const REJECT_THRESHOLD_REASON_CODES = Object.freeze(["reject_threshold_exceeded"]);

export const PRECONDITION_REASON_CODES = Object.freeze([
  "precondition_graph_malformed",
  "unit_superseded",
  "dependency_cycle",
  "lifecycle_not_dispatchable",
  "unsatisfied_dependencies",
  "no_precondition_constraints"
]);

export const PRECONDITION_REJECT_REASON_CODES = Object.freeze([
  "precondition_graph_malformed",
  "unit_superseded",
  "dependency_cycle",
  "lifecycle_not_dispatchable",
  "unsatisfied_dependencies"
]);

export const WORK_RECORD_STATUS_TO_PRECONDITION_LIFECYCLE_STATE = Object.freeze({
  inbox: "inbox",
  todo: "todo",
  active: "active",
  review: "review",
  done: "done",
  blocked: "blocked",
  parked: "parked",
  cancelled: "cancelled"
});

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function hasOnlyAllowedFields(object, allowedFields) {
  return Object.keys(object).every((key) => allowedFields.has(key));
}

const ALLOWED_REASON_CODES = new Set([
  "review_threshold_exceeded",
  "reject_threshold_exceeded",
  "worker_admission.work_unit_atomicity.review_threshold_exceeded.v1",
  ...PRECONDITION_REASON_CODES
]);

const ALLOWED_CONTROL_IDS = new Set(AGENT_ROLE_RESULT_REVIEWED_CONTROLS);

export function allowlistReasonCode(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return ALLOWED_REASON_CODES.has(trimmed) ? trimmed : null;
}

export function allowlistControlId(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return ALLOWED_CONTROL_IDS.has(trimmed) ? trimmed : null;
}

export function normalizeObservedScalar(value) {
  if (value === null || typeof value === "boolean") {
    return { present: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { present: true, value } : { present: false };
  }
  return { present: false };
}

export function extractPreconditionReason(decision) {
  if (!isObject(decision)) {
    return null;
  }
  const candidates = [];
  if (isObject(decision.reason)) {
    candidates.push(decision.reason);
  }
  if (Array.isArray(decision.reasons)) {
    candidates.push(...decision.reasons.filter((reason) => isObject(reason)));
  }
  if (Array.isArray(decision.pack_result_reasons)) {
    candidates.push(...decision.pack_result_reasons.filter((reason) => isObject(reason)));
  }
  for (const reason of candidates) {
    const code = allowlistReasonCode(reason.code);
    if (code && PRECONDITION_REASON_CODES.includes(code)) {
      return {
        code,
        evidence: isObject(reason.evidence) ? reason.evidence : Object.freeze({})
      };
    }
  }
  return null;
}

export function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => isNonEmptyString(entry)).map((entry) => entry.trim());
}
