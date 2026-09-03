

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

export function readCurrentCceTypedRecovery(remote, expectedEffect) {
  if (
    !isObject(remote) ||
    remote.exact_policy_payload_authenticated !== true ||
    remote.effect !== expectedEffect
  ) {
    return null;
  }
  const provenance = remote.response_provenance;
  const provenanceFields = ["schema_version", "pack", "operation"];
  if (
    !isObject(provenance) ||
    Object.keys(provenance).length !== provenanceFields.length ||
    !provenanceFields.every((field) => isNonEmptyString(provenance[field]))
  ) {
    return null;
  }
  if (!hasOwn(remote, "recovery_validation")) {
    return Object.freeze({ response_provenance: provenance, recovery_validation: null });
  }
  const validation = remote.recovery_validation;
  if (validation?.state !== "valid" || !isObject(validation.recovery)) return null;
  return Object.freeze({
    response_provenance: provenance,
    recovery_validation: validation
  });
}

export function extractPreconditionReason(decision) {
  if (!isObject(decision)) return null;
  const candidates = [];
  if (isObject(decision.reason)) candidates.push(decision.reason);
  if (Array.isArray(decision.reasons)) {
    candidates.push(...decision.reasons.filter((reason) => isObject(reason)));
  }
  for (const reason of candidates) {
    const code = isNonEmptyString(reason.code) ? reason.code.trim() : null;
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
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isNonEmptyString(entry)).map((entry) => entry.trim());
}
