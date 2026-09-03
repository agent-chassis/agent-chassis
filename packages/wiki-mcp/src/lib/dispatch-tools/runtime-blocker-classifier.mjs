

import {
  DISPATCH_MECHANICAL_BLOCKER_CODES,
  RETIRED_DISPATCH_BLOCKER_CODE_IDENTITIES
} from "../dispatch-tool-constants.mjs";
import {
  getRuntimeBlockerEntry,
  isRuntimeBlockerCode
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES
} from "@agent-chassis/wiki-core/src/lib/node-engine-worker-admission-recovery.mjs";

export const RUNTIME_BLOCKER_CLASSIFICATION_SCHEMA_VERSION = "runtime-blocker-classification.v1";

export const MECHANICAL_FAILURE_AUTHORITY_LIMB = "mechanical_failure";
export const EXACT_RETURNED_POLICY_AUTHORITY_LIMB = "exact_returned_policy";

const C = DISPATCH_MECHANICAL_BLOCKER_CODES;
const RECOVERY_VALIDATION_ISSUES = new Set(
  Object.values(WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES)
);

export const RUNTIME_BLOCKER_CLASSIFIER_STATE_TABLE = Object.freeze({

  authored_readiness: Object.freeze({
    named_contract_defect: C.WORK_RECORD_READINESS_FAILURE
  }),
  graph: Object.freeze({
    unavailable: C.GRAPH_IMPACT_UNAVAILABLE,
    query_error: C.GRAPH_IMPACT_QUERY_ERROR,
    artifact_missing: C.GRAPH_IMPACT_ARTIFACT_MISSING,
    rebuild_required: C.GRAPH_IMPACT_REBUILD_REQUIRED,
    unknown_state: C.GRAPH_IMPACT_UNKNOWN_STATE,
    persistence_unavailable: C.GRAPH_IMPACT_PERSISTENCE_UNAVAILABLE
  }),
  carrier: Object.freeze({
    integrity_failure: C.WORKER_ADMISSION_CARRIER_INVALID,
    revalidation_failed: C.WORKER_ADMISSION_CARRIER_INVALID,
    source_digest_changed: C.WORKER_ADMISSION_CARRIER_INVALID,
    private_handoff_invalid: C.WORKER_ADMISSION_CARRIER_INVALID,
    evidence_malformed: C.WORKER_ADMISSION_CARRIER_INVALID
  }),
  evidence: Object.freeze({
    nonrecoverable: C.VALIDATION_FAILURE,
    refresh_failed: C.VALIDATION_FAILURE,
    refresh_not_written: C.VALIDATION_FAILURE,
    post_refresh_not_fresh: C.VALIDATION_FAILURE
  }),
  review_target: Object.freeze({
    slice_tip_unreconciled: C.MANAGED_SLICE_TIP_RECONCILE_REQUIRED,
    committed_target_unresolved: "review_target_unresolved",
    committed_target_binding_mismatch: "review_target_binding_mismatch",
    frozen_worktree_unavailable: "frozen_worktree_unavailable",
    ref_unresolved: "review_target_ref_unresolved"
  }),
  backend: Object.freeze({
    service_unavailable: C.BACKEND_UNAVAILABLE,
    absent_response: C.BACKEND_UNAVAILABLE,
    transport_failure: C.BACKEND_UNAVAILABLE
  }),
  validation: Object.freeze({
    route_input_invalid: C.VALIDATION_FAILURE,
    launch_refused: C.VALIDATION_FAILURE
  }),
  role_policy: Object.freeze({
    findings_only_write_scope_nonempty: C.ROLE_POLICY_VIOLATION
  }),

  operator_recovery: Object.freeze({
    launcher_declaration_missing: "launcher_declaration_missing",
    authority_binding_unratified: "authority_binding_unratified",
    decision_envelope_malformed: "decision_envelope_malformed",
    decision_envelope_unknown: "decision_envelope_unknown",
    decision_envelope_contradictory: "decision_envelope_contradictory",
    decision_envelope_unauthenticated: "decision_envelope_unauthenticated",
    runtime_materialization_failed: "runtime_materialization_failed"
  }),
  recovery_contract: Object.freeze({
    ...Object.fromEntries(
      [...RECOVERY_VALIDATION_ISSUES].map((issue) => [issue, issue])
    ),
    no_supported_route: "worker_admission_recovery_route_unavailable"
  }),
  mcp_response: Object.freeze({
    handler_exception: "mcp_response.handler_exception.v1",
    platform_failure: "mcp_response.platform_failure.v1",
    workspace_repo_resolution_invalid: "workspace_repo_resolution_invalid"
  }),
  unexpected_external: Object.freeze({
    authenticated_condition: C.OPERATOR_RECOVERY_NEEDED
  })
});

const NAMED_DEFECT_PRODUCER = "authored_readiness";
const NAMED_DEFECT_CONDITION = "named_contract_defect";
const NAMED_DEFECT_FIELDS = Object.freeze(["check", "status", "path"]);

const POLICY_RESULT_SHAPED_KEYS = Object.freeze([
  "effect",
  "decision",
  "decision_id",
  "verdict",
  "outcome",
  "admissibility",
  "pack_result",
  "pack_result_reasons",
  "response_provenance",
  "pack_backed",
  "policy",
  "policy_decision",
  "node_engine_binding_status",
  "node_engine_binding_ratified",
  "recovery_projection_state",
  "authority_limb",
  "threshold"
]);

const POLICY_VERDICT_TOKENS = Object.freeze([
  "admit",
  "needs_review",
  "reject",
  "deny",
  "denied",
  "threshold",
  "review_threshold"
]);

const ALLOWED_INPUT_KEYS = Object.freeze(["producer", "condition", "named_defect", "detail"]);

const DETAIL_MAX_KEYS = 12;
const DETAIL_MAX_STRING_LENGTH = 256;
const DETAIL_MAX_ARRAY_LENGTH = 8;
const NAMED_DEFECT_FIELD_MAX_LENGTH = 512;

export class RuntimeBlockerClassifierError extends Error {
  constructor(message, { code, detail = null } = {}) {
    super(message);
    this.name = "RuntimeBlockerClassifierError";
    this.code = code;
    this.detail = detail;
  }
}

function refuse(code, message, detail = null) {
  throw new RuntimeBlockerClassifierError(message, { code, detail });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isDetailScalar(value) {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.length <= DETAIL_MAX_STRING_LENGTH;
}

function containsPolicyVerdictToken(token) {
  return POLICY_VERDICT_TOKENS.some((verdict) => token.includes(verdict));
}

function assertNotPolicyShaped(facts) {
  const present = POLICY_RESULT_SHAPED_KEYS.filter((key) => Object.hasOwn(facts, key));
  if (present.length > 0) {
    refuse(
      "policy_result_shaped_input",
      "the mechanical classifier refuses a CCE policy-result-shaped input; carry an authenticated decision through the exact_returned_policy limb verbatim",
      { policy_result_fields: present }
    );
  }
}

function assertClosedInputShape(facts) {
  if (!isPlainObject(facts)) {
    refuse("facts_not_an_object", "mechanical producer facts must be an object");
  }
  assertNotPolicyShaped(facts);
  const unknownKeys = Object.keys(facts).filter((key) => !ALLOWED_INPUT_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    refuse("unknown_fact_field", "mechanical producer facts declare an unknown field", {
      unknown_fields: unknownKeys
    });
  }
}

function assertBoundedDetail(detail) {
  if (detail === undefined || detail === null) return null;
  if (!isPlainObject(detail)) {
    refuse("detail_not_an_object", "mechanical producer detail must be an object when supplied");
  }
  const keys = Object.keys(detail);
  if (keys.length > DETAIL_MAX_KEYS) {
    refuse("detail_unbounded", "mechanical producer detail exceeds the bounded key budget", {
      observed_keys: keys.length,
      max_keys: DETAIL_MAX_KEYS
    });
  }
  const bounded = {};
  for (const key of keys) {
    const value = detail[key];
    if (Array.isArray(value)) {
      if (value.length > DETAIL_MAX_ARRAY_LENGTH || !value.every(isDetailScalar)) {
        refuse("detail_value_unbounded", `mechanical producer detail field ${key} is not a bounded scalar array`);
      }
      bounded[key] = Object.freeze([...value]);
      continue;
    }
    if (!isDetailScalar(value)) {
      refuse("detail_value_unbounded", `mechanical producer detail field ${key} is not a bounded scalar`);
    }
    bounded[key] = value;
  }
  return Object.freeze(bounded);
}

function assertNamedDefect(producer, condition, namedDefect) {
  const requiresNamedDefect = producer === NAMED_DEFECT_PRODUCER && condition === NAMED_DEFECT_CONDITION;
  if (!requiresNamedDefect) {

    if (namedDefect !== undefined && namedDefect !== null) {
      refuse(
        "contradictory_named_defect",
        `${producer}.${condition} is not an authored-contract defect, so it must not carry a named_defect`
      );
    }
    return null;
  }
  if (!isPlainObject(namedDefect)) {
    refuse(
      "named_defect_required",
      "work_record_readiness_failure requires a named_defect identifying the exact check, status, and path"
    );
  }
  const unknownFields = Object.keys(namedDefect).filter((key) => !NAMED_DEFECT_FIELDS.includes(key));
  if (unknownFields.length > 0) {
    refuse("named_defect_unknown_field", "named_defect declares an unknown field", {
      unknown_fields: unknownFields
    });
  }
  const missing = NAMED_DEFECT_FIELDS.filter(
    (field) => !isBoundedString(namedDefect[field], NAMED_DEFECT_FIELD_MAX_LENGTH)
  );
  if (missing.length > 0) {
    refuse(
      "named_defect_incomplete",
      "named_defect must name a non-empty check, status, and path",
      { missing_or_invalid: missing }
    );
  }
  return Object.freeze({
    check: namedDefect.check,
    status: namedDefect.status,
    path: namedDefect.path
  });
}

function assertUnexpectedExternalCondition(producer, condition, detail) {
  if (producer !== "unexpected_external" || condition !== "authenticated_condition") return;
  if (
    !isPlainObject(detail) ||
    detail.authenticated !== true ||
    !isBoundedString(detail.external_condition, DETAIL_MAX_STRING_LENGTH)
  ) {
    refuse(
      "authenticated_external_condition_required",
      "operator_recovery_needed requires an authenticated exact external condition"
    );
  }
}

function resolveCode(producer, condition) {
  if (!isBoundedString(producer, 64) || !isBoundedString(condition, 64)) {
    refuse("producer_or_condition_missing", "mechanical producer facts must name a producer and a condition");
  }
  if (containsPolicyVerdictToken(producer) || containsPolicyVerdictToken(condition)) {
    refuse(
      "policy_verdict_condition",
      `${producer}.${condition} names a policy verdict; the mechanical classifier cannot express one`
    );
  }
  const family = RUNTIME_BLOCKER_CLASSIFIER_STATE_TABLE[producer];
  if (family === undefined) {
    refuse("unknown_producer", `unknown mechanical producer family: ${producer}`);
  }
  const code = family[condition];
  if (code === undefined) {
    refuse(
      "unknown_condition",
      `unknown mechanical condition ${condition} for producer ${producer}`,
      { supported_conditions: Object.keys(family) }
    );
  }
  return code;
}

const PRODUCER_OWNING_BOUNDARIES = Object.freeze({
  authored_readiness: "wiki-core.work-record-dispatch-readiness",
  graph: "wiki-core.graph-impact",
  carrier: "wiki-core.worker-admission-carrier",
  evidence: "wiki-core.dispatch-evidence",
  review_target: "agent-launch.review-target",
  backend: "agent-launch.runtime-backend",
  validation: "wiki-mcp.registered-route-validation",
  role_policy: "wiki-mcp.role-policy",
  operator_recovery: "agent-launch.launcher-contract",
  recovery_contract: "cce.worker-admission-recovery-producer",
  mcp_response: "wiki-mcp.mcp-response",
  unexpected_external: "external.authenticated-condition"
});

const NO_ROUTE_PRODUCERS = new Set([
  "backend",
  "operator_recovery",
  "recovery_contract",
  "mcp_response",
  "unexpected_external"
]);

function normalizeModeledCause(producer, condition, detail) {
  const recoveryIssue = detail?.exact_policy_payload_issue;
  if (
    producer === "operator_recovery" &&
    condition === "decision_envelope_malformed" &&
    RECOVERY_VALIDATION_ISSUES.has(recoveryIssue)
  ) {
    return Object.freeze({
      producer: "recovery_contract",
      condition: recoveryIssue
    });
  }
  return Object.freeze({ producer, condition });
}

export function classifyMechanicalRuntimeBlocker(facts) {
  assertClosedInputShape(facts);
  const detail = assertBoundedDetail(facts.detail);
  const { producer, condition } = normalizeModeledCause(
    facts.producer,
    facts.condition,
    detail
  );
  const code = resolveCode(producer, condition);
  const namedDefect = assertNamedDefect(producer, condition, facts.named_defect);
  assertUnexpectedExternalCondition(producer, condition, detail);

  if (!isRuntimeBlockerCode(code) || RETIRED_DISPATCH_BLOCKER_CODE_IDENTITIES.includes(code)) {
    refuse("unregistered_code", `classifier resolved a code outside the active taxonomy: ${String(code)}`);
  }

  const entry = getRuntimeBlockerEntry(code);
  const owningBoundary = PRODUCER_OWNING_BOUNDARIES[producer];
  const publicDetail = Object.freeze({
    ...(detail ?? {}),
    owning_boundary: owningBoundary,
    ...(NO_ROUTE_PRODUCERS.has(producer)
      ? { no_supported_route: true, next_calls: Object.freeze([]) }
      : {})
  });
  return Object.freeze({
    schema_version: RUNTIME_BLOCKER_CLASSIFICATION_SCHEMA_VERSION,
    authority_limb: MECHANICAL_FAILURE_AUTHORITY_LIMB,
    code,
    cause: `${producer}.${condition}`,
    owning_boundary: owningBoundary,
    actor_recovery: entry.actor_recovery,
    ...(namedDefect ? { named_defect: namedDefect } : {}),
    detail: publicDetail
  });
}

export function isMechanicalRuntimeBlockerClassification(value) {
  return (
    isPlainObject(value) &&
    value.schema_version === RUNTIME_BLOCKER_CLASSIFICATION_SCHEMA_VERSION &&
    value.authority_limb === MECHANICAL_FAILURE_AUTHORITY_LIMB &&
    isRuntimeBlockerCode(value.code)
  );
}

for (const [producer, family] of Object.entries(RUNTIME_BLOCKER_CLASSIFIER_STATE_TABLE)) {
  for (const [condition, code] of Object.entries(family)) {
    if (!isRuntimeBlockerCode(code)) {
      throw new Error(
        `runtime blocker classifier maps ${producer}.${condition} to an unregistered code: ${String(code)}`
      );
    }
    if (RETIRED_DISPATCH_BLOCKER_CODE_IDENTITIES.includes(code)) {
      throw new Error(
        `runtime blocker classifier maps ${producer}.${condition} to retired identity ${code}`
      );
    }
    if (
      code === C.WORK_RECORD_READINESS_FAILURE &&
      !(producer === NAMED_DEFECT_PRODUCER && condition === NAMED_DEFECT_CONDITION)
    ) {
      throw new Error(
        `runtime blocker classifier may not map ${producer}.${condition} to work_record_readiness_failure`
      );
    }
  }
}
