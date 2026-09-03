

import {
  projectTerminalWkCandidateFailure,
  TERMINAL_WK_CANDIDATE_CODES,
  TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

export const CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION =
  "agent_launch.closed_lifecycle_failure.v1";

export const CLOSED_LIFECYCLE_FAILURE_NAME = "ClosedLifecycleFailure";

export const CLOSED_LIFECYCLE_FAILURE_SEAMS = Object.freeze({
  TERMINAL_CANDIDATE_PREPARATION: "terminal_candidate_preparation",
  TERMINAL_CANDIDATE_VALIDATION: "terminal_candidate_validation",
  COMMITTED_SLICE_INTEGRATION_CONTINUATION: "committed_slice_integration_continuation",
  FROZEN_REVIEW_CONTEXT_BINDING: "frozen_review_context_binding",
  MANAGED_WORKER_IDENTITY_RETIREMENT: "managed_worker_identity_retirement"
});

const CLOSED_LIFECYCLE_FAILURE_SEAM_DESCRIPTORS = Object.freeze({
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.TERMINAL_CANDIDATE_PREPARATION]: Object.freeze({
    key: "TERMINAL_CANDIDATE_PREPARATION_FAILED",
    code: "agent_launch.slice_lifecycle.terminal_candidate_preparation_failed.v1",
    message: "post-worker terminal candidate preparation failed",
    carries_candidate_failure: true
  }),
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.TERMINAL_CANDIDATE_VALIDATION]: Object.freeze({
    key: "TERMINAL_CANDIDATE_VALIDATION_FAILED",
    code: "agent_launch.slice_lifecycle.terminal_candidate_validation_failed.v1",
    message: "post-worker terminal candidate validation failed",
    carries_candidate_failure: true
  }),
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.COMMITTED_SLICE_INTEGRATION_CONTINUATION]: Object.freeze({
    key: "COMMITTED_SLICE_INTEGRATION_CONTINUATION_FAILED",
    code: "agent_launch.slice_lifecycle.committed_slice_integration_continuation_failed.v1",
    message: "post-worker committed slice integration continuation failed",
    carries_candidate_failure: false
  }),
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.FROZEN_REVIEW_CONTEXT_BINDING]: Object.freeze({
    key: "FROZEN_REVIEW_CONTEXT_BINDING_FAILED",
    code: "agent_launch.slice_lifecycle.frozen_review_context_binding_failed.v1",
    message: "post-worker frozen review context binding failed",
    carries_candidate_failure: false
  }),
  [CLOSED_LIFECYCLE_FAILURE_SEAMS.MANAGED_WORKER_IDENTITY_RETIREMENT]: Object.freeze({
    key: "MANAGED_WORKER_IDENTITY_RETIREMENT_FAILED",
    code: "agent_launch.slice_lifecycle.managed_worker_identity_retirement_failed.v1",
    message: "post-worker managed worker identity retirement failed",
    carries_candidate_failure: false
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
  "candidate_failure"
]);

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
    projected.git_args = Object.freeze(
      detail.git_args
        .filter((arg) => typeof arg === "string")
        .slice(0, 32)
        .map((arg) => arg.slice(0, 256))
    );
  }
  if (typeof detail.git_status === "number" || detail.git_status === null) {
    projected.git_status = detail.git_status;
  }
  if (typeof detail.git_stderr === "string") {
    projected.git_stderr = detail.git_stderr.slice(0, 8192);
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

class ClosedLifecycleFailure extends Error {
  constructor(token, code, candidateFailure) {
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
    pin("stack", `${CLOSED_LIFECYCLE_FAILURE_NAME}: ${message}`, false);

    pin("schema_version", CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION, true);
    pin("code", code, true);
    pin("candidate_failure", candidateFailure, true);
    Object.freeze(this);
  }
}

export function closeLifecycleSeamFailure(seam, error) {
  if (typeof seam !== "string" ||
      !Object.hasOwn(CLOSED_LIFECYCLE_FAILURE_SEAM_DESCRIPTORS, seam)) {
    throw new Error(
      "closed lifecycle failure carrier requires a recognized post-worker lifecycle seam"
    );
  }
  const descriptor = CLOSED_LIFECYCLE_FAILURE_SEAM_DESCRIPTORS[seam];
  const carrier = new ClosedLifecycleFailure(
    CARRIER_CONSTRUCTION_TOKEN,
    descriptor.code,
    descriptor.carries_candidate_failure ? closedCandidateFailure(error) : null
  );
  CARRIER_BRAND.add(carrier);
  return carrier;
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
    candidate_failure: value.candidate_failure
  });
}
