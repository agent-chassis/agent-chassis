

import {
  projectTerminalWkCandidateFailure,
  TERMINAL_WK_CANDIDATE_CODES,
  TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  COMMITTED_SLICE_INTEGRATION_PUBLIC_BLOCKER_CODES,
  COMMITTED_SLICE_INTEGRATION_REFUSAL_DIAGNOSTIC_CODES,
  COMMITTED_SLICE_INTEGRATION_REFUSAL_DIAGNOSTIC_KINDS,
  COMPLETED_INTEGRATION_WRITE_SCOPE_MISMATCH,
  projectCommittedSliceIntegrationRefusal,
  projectCompletedIntegrationContinuationFailure
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";
import { captureDiagnosticEvidence } from
  "@agent-chassis/agent-launch-cli/src/lib/diagnostic-evidence.mjs";

export const CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION =
  "agent_launch.closed_lifecycle_failure.v1";

export const CLOSED_LIFECYCLE_FAILURE_NAME = "ClosedLifecycleFailure";

export const CLOSED_LIFECYCLE_FAILURE_SEAMS = Object.freeze({
  TERMINAL_CANDIDATE_PREPARATION: "terminal_candidate_preparation",
  COMMITTED_SLICE_INTEGRATION_CONTINUATION: "committed_slice_integration_continuation",
  MANAGED_WORKER_IDENTITY_RETIREMENT: "managed_worker_identity_retirement",
  LIFECYCLE_BINDING_RESOLUTION: "lifecycle_binding_resolution",
  SLICE_DELIVERY_INSPECTION: "slice_delivery_inspection",
  INTEGRATED_SLICE_RECONCILIATION: "integrated_slice_reconciliation",
  COMMITTED_SLICE_INTEGRATION: "committed_slice_integration"
});

export const CLOSED_FAILURE_CAUSE_KINDS = Object.freeze({
  UNEXPECTED_EXCEPTION: "unexpected_exception",
  LIFECYCLE_REFUSAL: "lifecycle_refusal",
  INTEGRATION_REFUSAL: "integration_refusal"
});

export const CLOSED_LIFECYCLE_REFUSAL_REASONS = Object.freeze({
  PROVISIONING_BINDING_INCOMPLETE: "provisioning_binding_incomplete",
  WORKER_SUBJECT_BINDING_MISMATCH: "worker_subject_binding_mismatch",
  WK_BINDING_MISMATCH: "wk_binding_mismatch",
  GIT_COMMAND_FAILED: "git_command_failed",
  GIT_OBJECT_UNRESOLVED: "git_object_unresolved"
});

export const CLOSED_FAILURE_CAUSE_KEYS = Object.freeze([
  "kind",
  "reason",
  "diagnostic_code",
  "diagnostic_kind",
  "public_blocker_code"
]);

const CLOSED_UNEXPECTED_EXCEPTION_CAUSE = Object.freeze({
  kind: CLOSED_FAILURE_CAUSE_KINDS.UNEXPECTED_EXCEPTION,
  reason: null,
  diagnostic_code: null,
  diagnostic_kind: null,
  public_blocker_code: null
});

const LIFECYCLE_REFUSAL_REASON_SET = new Set(Object.values(CLOSED_LIFECYCLE_REFUSAL_REASONS));
const INTEGRATION_DIAGNOSTIC_CODE_SET = new Set(COMMITTED_SLICE_INTEGRATION_REFUSAL_DIAGNOSTIC_CODES);
const INTEGRATION_DIAGNOSTIC_KIND_SET = new Set(COMMITTED_SLICE_INTEGRATION_REFUSAL_DIAGNOSTIC_KINDS);
const INTEGRATION_PUBLIC_BLOCKER_CODE_SET = new Set(COMMITTED_SLICE_INTEGRATION_PUBLIC_BLOCKER_CODES);

const lifecycleRefusalCause = (reason) => Object.freeze({
  ...CLOSED_UNEXPECTED_EXCEPTION_CAUSE,
  kind: CLOSED_FAILURE_CAUSE_KINDS.LIFECYCLE_REFUSAL,
  reason
});

function integrationRefusalCause(projection) {
  const diagnosticCode = INTEGRATION_DIAGNOSTIC_CODE_SET.has(projection?.diagnostic_code)
    ? projection.diagnostic_code
    : null;

  return Object.freeze({
    ...CLOSED_UNEXPECTED_EXCEPTION_CAUSE,
    kind: CLOSED_FAILURE_CAUSE_KINDS.INTEGRATION_REFUSAL,
    reason: typeof projection?.reason === "string" ? projection.reason : null,
    diagnostic_code: diagnosticCode,
    diagnostic_kind: INTEGRATION_DIAGNOSTIC_KIND_SET.has(projection?.diagnostic_kind)
      ? projection.diagnostic_kind
      : null,
    public_blocker_code: INTEGRATION_PUBLIC_BLOCKER_CODE_SET.has(projection?.public_blocker_code)
      ? projection.public_blocker_code
      : null
  });
}

export function closedFailureCause(value) {
  let kind;
  let reason;
  let projection;
  try {
    if (typeof value !== "object" || value === null) return null;
    kind = value.kind;
    reason = value.reason;
    projection = {
      reason: value.reason,
      diagnostic_code: value.diagnostic_code,
      diagnostic_kind: value.diagnostic_kind,
      public_blocker_code: value.public_blocker_code
    };
  } catch {
    return null;
  }
  if (kind === CLOSED_FAILURE_CAUSE_KINDS.UNEXPECTED_EXCEPTION) return CLOSED_UNEXPECTED_EXCEPTION_CAUSE;
  if (kind === CLOSED_FAILURE_CAUSE_KINDS.LIFECYCLE_REFUSAL) {
    return LIFECYCLE_REFUSAL_REASON_SET.has(reason) ? lifecycleRefusalCause(reason) : null;
  }
  if (kind === CLOSED_FAILURE_CAUSE_KINDS.INTEGRATION_REFUSAL) {
    return integrationRefusalCause(projection);
  }
  return null;
}

const ATTRIBUTED_FAILURE_CAUSES = new WeakMap();

function attribute(error, cause) {
  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    ATTRIBUTED_FAILURE_CAUSES.set(error, cause);
  }
  return error;
}

export function attributeLifecycleRefusal(error, reason) {
  if (!LIFECYCLE_REFUSAL_REASON_SET.has(reason)) {
    throw new Error("lifecycle refusal attribution requires a closed lifecycle refusal reason");
  }
  return attribute(error, lifecycleRefusalCause(reason));
}

export function attributeIntegrationRefusal(error, refusal) {
  let projection = null;
  try {
    projection = projectCommittedSliceIntegrationRefusal(refusal);
  } catch {
    projection = null;
  }
  return attribute(error, integrationRefusalCause(projection));
}

function seamFailureCauses({ lifecycleRefusalReasons = [], integrationRefusal = false }) {
  return Object.freeze({
    lifecycle_refusal_reasons: Object.freeze(new Set(lifecycleRefusalReasons)),
    integration_refusal: integrationRefusal
  });
}

function seamFailureCause(admitted, error) {
  const attributed = ATTRIBUTED_FAILURE_CAUSES.get(error);
  if (attributed?.kind === CLOSED_FAILURE_CAUSE_KINDS.LIFECYCLE_REFUSAL &&
      admitted.lifecycle_refusal_reasons.has(attributed.reason)) {
    return attributed;
  }
  if (attributed?.kind === CLOSED_FAILURE_CAUSE_KINDS.INTEGRATION_REFUSAL &&
      admitted.integration_refusal === true) {
    return attributed;
  }
  return CLOSED_UNEXPECTED_EXCEPTION_CAUSE;
}

const CLOSED_LIFECYCLE_FAILURE_SEAM_DESCRIPTORS = Object.freeze({
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.TERMINAL_CANDIDATE_PREPARATION]: Object.freeze({
    key: "TERMINAL_CANDIDATE_PREPARATION_FAILED",
    code: "agent_launch.slice_lifecycle.terminal_candidate_preparation_failed.v1",
    message: "post-worker terminal candidate preparation failed",
    carries_candidate_failure: true,
    carries_continuation_failure: false,
    failure_causes: null
  }),
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.COMMITTED_SLICE_INTEGRATION_CONTINUATION]: Object.freeze({
    key: "COMMITTED_SLICE_INTEGRATION_CONTINUATION_FAILED",
    code: "agent_launch.slice_lifecycle.committed_slice_integration_continuation_failed.v1",
    message: "post-worker committed slice integration continuation failed",
    carries_candidate_failure: false,
    carries_continuation_failure: true,
    failure_causes: null
  }),
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.MANAGED_WORKER_IDENTITY_RETIREMENT]: Object.freeze({
    key: "MANAGED_WORKER_IDENTITY_RETIREMENT_FAILED",
    code: "agent_launch.slice_lifecycle.managed_worker_identity_retirement_failed.v1",
    message: "post-worker managed worker identity retirement failed",
    carries_candidate_failure: false,
    carries_continuation_failure: false,
    failure_causes: null
  }),

  [CLOSED_LIFECYCLE_FAILURE_SEAMS.LIFECYCLE_BINDING_RESOLUTION]: Object.freeze({
    key: "LIFECYCLE_BINDING_RESOLUTION_FAILED",
    code: "agent_launch.slice_lifecycle.lifecycle_binding_resolution_failed.v1",
    message: "post-worker lifecycle binding resolution failed",
    carries_candidate_failure: false,
    carries_continuation_failure: false,
    failure_causes: seamFailureCauses({
      lifecycleRefusalReasons: [
        CLOSED_LIFECYCLE_REFUSAL_REASONS.PROVISIONING_BINDING_INCOMPLETE,
        CLOSED_LIFECYCLE_REFUSAL_REASONS.WORKER_SUBJECT_BINDING_MISMATCH,
        CLOSED_LIFECYCLE_REFUSAL_REASONS.WK_BINDING_MISMATCH
      ]
    })
  }),
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.SLICE_DELIVERY_INSPECTION]: Object.freeze({
    key: "SLICE_DELIVERY_INSPECTION_FAILED",
    code: "agent_launch.slice_lifecycle.slice_delivery_inspection_failed.v1",
    message: "post-worker slice delivery inspection failed",
    carries_candidate_failure: false,
    carries_continuation_failure: false,
    failure_causes: seamFailureCauses({
      lifecycleRefusalReasons: [
        CLOSED_LIFECYCLE_REFUSAL_REASONS.GIT_COMMAND_FAILED,
        CLOSED_LIFECYCLE_REFUSAL_REASONS.GIT_OBJECT_UNRESOLVED
      ]
    })
  }),
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.INTEGRATED_SLICE_RECONCILIATION]: Object.freeze({
    key: "INTEGRATED_SLICE_RECONCILIATION_FAILED",
    code: "agent_launch.slice_lifecycle.integrated_slice_reconciliation_failed.v1",
    message: "post-worker integrated slice reconciliation failed",
    carries_candidate_failure: false,
    carries_continuation_failure: false,
    failure_causes: seamFailureCauses({})
  }),
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.COMMITTED_SLICE_INTEGRATION]: Object.freeze({
    key: "COMMITTED_SLICE_INTEGRATION_FAILED",
    code: "agent_launch.slice_lifecycle.committed_slice_integration_failed.v1",
    message: "post-worker committed slice integration failed",
    carries_candidate_failure: false,
    carries_continuation_failure: false,
    failure_causes: seamFailureCauses({ integrationRefusal: true })
  })
});

const CLOSED_LIFECYCLE_FAILURE_SEAM_LIST = Object.freeze(
  Object.values(CLOSED_LIFECYCLE_FAILURE_SEAM_DESCRIPTORS)
);

export const CLOSED_LIFECYCLE_FAILURE_CODES = Object.freeze(Object.fromEntries(
  CLOSED_LIFECYCLE_FAILURE_SEAM_LIST.map((descriptor) => [descriptor.key, descriptor.code])
));

export const CLOSED_LIFECYCLE_FAILURE_MESSAGES = Object.freeze(Object.fromEntries(
  CLOSED_LIFECYCLE_FAILURE_SEAM_LIST.map((descriptor) => [descriptor.code, descriptor.message])
));

export const CLOSED_LIFECYCLE_FAILURE_KEYS = Object.freeze([
  "schema_version",
  "code",
  "candidate_failure",
  "continuation_failure",
  "failure_cause",
  "evidence"
]);

export const CLOSED_CONTINUATION_FAILURE_REASONS = Object.freeze({
  COMPLETED_INTEGRATION_WRITE_SCOPE_MISMATCH
});

const CLOSED_CONTINUATION_FAILURES = Object.freeze(new Map(
  Object.values(CLOSED_CONTINUATION_FAILURE_REASONS)
    .map((reason) => [reason, Object.freeze({ reason })])
));

export function closedContinuationFailure(value) {
  return typeof value?.reason === "string"
    ? CLOSED_CONTINUATION_FAILURES.get(value.reason) ?? null
    : null;
}

export const CLOSED_CANDIDATE_FAILURE_KINDS = Object.freeze({
  TYPED: "typed_candidate_error",
  UNKNOWN: "unknown_cause"
});

export const CLOSED_CANDIDATE_FAILURE_KEYS = Object.freeze([
  "kind",
  "code",
  "message",
  "detail"
]);

export const APPROVED_CANDIDATE_GIT_DETAIL_KEYS = Object.freeze([
  "git_args",
  "git_status",
  "git_stderr"
]);

const CLOSED_TYPED_CANDIDATE_FAILURE_MESSAGE =
  "terminal WK candidate: typed construction or recovery failure";

const CLOSED_UNKNOWN_CANDIDATE_FAILURE = Object.freeze({
  kind: CLOSED_CANDIDATE_FAILURE_KINDS.UNKNOWN,
  code: null,
  message: TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  detail: null
});

const APPROVED_TERMINAL_WK_CANDIDATE_CODES = Object.freeze(
  new Set(Object.values(TERMINAL_WK_CANDIDATE_CODES))
);

function closedCandidateGitDetail(detail) {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return null;
  const projected = {};
  if (Array.isArray(detail.git_args)) {
    projected.git_args = Object.freeze(detail.git_args.filter((arg) => typeof arg === "string"));
  }
  if (typeof detail.git_status === "number" || detail.git_status === null) {
    projected.git_status = detail.git_status;
  }
  if (typeof detail.git_stderr === "string") {
    projected.git_stderr = detail.git_stderr;
  }
  return Object.keys(projected).length === 0 ? null : Object.freeze(projected);
}

function closedCandidateFailure(error) {
  let projected;
  try {
    projected = projectTerminalWkCandidateFailure(error);
  } catch {

    return CLOSED_UNKNOWN_CANDIDATE_FAILURE;
  }
  if (typeof projected !== "object" || projected === null ||
      projected.kind !== CLOSED_CANDIDATE_FAILURE_KINDS.TYPED ||
      typeof projected.code !== "string" ||
      !APPROVED_TERMINAL_WK_CANDIDATE_CODES.has(projected.code)) {
    return CLOSED_UNKNOWN_CANDIDATE_FAILURE;
  }
  return Object.freeze({
    kind: CLOSED_CANDIDATE_FAILURE_KINDS.TYPED,
    code: projected.code,
    message: CLOSED_TYPED_CANDIDATE_FAILURE_MESSAGE,
    detail: closedCandidateGitDetail(projected.detail)
  });
}

const CARRIER_BRAND = new WeakSet();

const CARRIER_CONSTRUCTION_TOKEN = Symbol("closed-lifecycle-failure-construction");

function brandedContinuationFailure(error) {
  try {
    return closedContinuationFailure(projectCompletedIntegrationContinuationFailure(error));
  } catch {
    return null;
  }
}

function deepFreeze(value) {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function carrierStack(message, evidence) {
  const origin = evidence?.thrown?.value;
  const originStack = typeof origin?.stack === "string"
    ? origin.stack
    : JSON.stringify(origin ?? null);
  return `${CLOSED_LIFECYCLE_FAILURE_NAME}: ${message}\n` +
    `    [seam ${evidence?.seam ?? "unknown"}]\nCaused by: ${originStack}`;
}

class ClosedLifecycleFailure extends Error {
  constructor(token, code, candidateFailure, continuationFailure, failureCause, evidence) {
    if (token !== CARRIER_CONSTRUCTION_TOKEN) {
      throw new Error(
        "closed lifecycle failure carrier is constructible only by trusted lifecycle code"
      );
    }
    const message = CLOSED_LIFECYCLE_FAILURE_MESSAGES[code];
    if (typeof message !== "string") {
      throw new Error("closed lifecycle failure carrier requires a closed lifecycle failure code");
    }
    super(message);
    const pin = (key, value, enumerable) => {
      Object.defineProperty(this, key, {
        value,
        enumerable,
        writable: false,
        configurable: false
      });
    };

    pin("name", CLOSED_LIFECYCLE_FAILURE_NAME, false);
    pin("message", message, false);
    pin("stack", carrierStack(message, evidence), false);

    pin("detail", Object.freeze({
      code,
      candidate_failure: candidateFailure,
      continuation_failure: continuationFailure,
      failure_cause: failureCause,
      evidence
    }), false);
    pin("schema_version", CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION, true);
    pin("code", code, true);
    pin("candidate_failure", candidateFailure, true);
    pin("continuation_failure", continuationFailure, true);
    pin("failure_cause", failureCause, true);
    pin("evidence", evidence, true);
    Object.freeze(this);
  }
}

function seamDescriptor(seam) {
  if (typeof seam !== "string" ||
      !Object.hasOwn(CLOSED_LIFECYCLE_FAILURE_SEAM_DESCRIPTORS, seam)) {
    throw new Error(
      "closed lifecycle failure carrier requires a recognized post-worker lifecycle seam"
    );
  }
  return CLOSED_LIFECYCLE_FAILURE_SEAM_DESCRIPTORS[seam];
}

function brandedCarrier(descriptor, candidateFailure, continuationFailure, failureCause, evidence) {
  const carrier = new ClosedLifecycleFailure(
    CARRIER_CONSTRUCTION_TOKEN,
    descriptor.code,
    candidateFailure,
    continuationFailure,
    failureCause,
    deepFreeze(evidence)
  );
  CARRIER_BRAND.add(carrier);
  return carrier;
}

export function closeLifecycleSeamFailure(seam, error) {
  const descriptor = seamDescriptor(seam);

  const evidence = captureLifecycleFailureEvidence(error, { seam });
  return brandedCarrier(
    descriptor,
    descriptor.carries_candidate_failure ? closedCandidateFailure(error) : null,
    descriptor.carries_continuation_failure ? brandedContinuationFailure(error) : null,
    descriptor.failure_causes === null ? null : seamFailureCause(descriptor.failure_causes, error),
    evidence
  );
}

export function closeLifecycleSeamRefusal(seam, reason, detail = null) {
  const descriptor = seamDescriptor(seam);
  if (descriptor.failure_causes === null ||
      !descriptor.failure_causes.lifecycle_refusal_reasons.has(reason)) {
    throw new Error("closed lifecycle seam refusal requires a reason the seam admits");
  }
  const origin = Object.assign(
    new Error(`post-worker lifecycle refusal at ${seam}: ${reason}`),
    { code: reason, detail }
  );
  Error.captureStackTrace?.(origin, closeLifecycleSeamRefusal);
  return brandedCarrier(descriptor, null, null, lifecycleRefusalCause(reason),
    captureLifecycleFailureEvidence(origin, { seam }));
}

export const LIFECYCLE_FAILURE_EVIDENCE_SCHEMA_VERSION =
  "agent_launch.post_worker_lifecycle_failure_evidence.v1";

export function captureLifecycleFailureEvidence(error, {
  seam = null,
  operation = seam === null ? "post_worker_slice_lifecycle_invocation" : `seam:${seam}`
} = {}) {
  const evidence = {
    schema_version: LIFECYCLE_FAILURE_EVIDENCE_SCHEMA_VERSION,
    operation,
    seam
  };
  try {
    evidence.thrown = captureDiagnosticEvidence(error);
  } catch (captureError) {
    let described;
    try {
      described = captureDiagnosticEvidence(captureError);
    } catch {
      described = null;
    }
    evidence.thrown = null;
    evidence.evidence_capture_failure = described ?? { $type: "unencodable" };
  }
  return evidence;
}

export function summarizeLifecycleFailureEvidence(evidence) {
  if (typeof evidence !== "object" || evidence === null) return null;
  const value = evidence.thrown?.value;
  const text = (field) => (typeof field === "string" ? field : null);
  const isError = value?.$type === "Error";
  return Object.freeze({
    operation: text(evidence.operation),
    type: isError ? "Error" : value === null ? "null"
      : Array.isArray(value) ? "array"
        : typeof value === "object" ? text(value.$type) ?? "object" : typeof value,
    name: isError ? text(value.name) : null,
    code: isError ? text(value.properties?.code) : null,
    message: isError ? text(value.message) : typeof value === "string" ? value : null,
    capture_failure_count: (evidence.thrown?.capture_failures?.length ?? 0) +
      (evidence.evidence_capture_failure === undefined ? 0 : 1)
  });
}

export function isClosedLifecycleFailure(value) {
  return CARRIER_BRAND.has(value);
}

export function projectClosedLifecycleFailure(value) {
  if (!isClosedLifecycleFailure(value)) return null;
  return Object.freeze({
    schema_version: CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION,
    code: value.code,
    message: CLOSED_LIFECYCLE_FAILURE_MESSAGES[value.code] ?? null,
    candidate_failure: value.candidate_failure,
    continuation_failure: closedContinuationFailure(value.continuation_failure),
    failure_cause: closedFailureCause(value.failure_cause),
    evidence: value.evidence
  });
}
