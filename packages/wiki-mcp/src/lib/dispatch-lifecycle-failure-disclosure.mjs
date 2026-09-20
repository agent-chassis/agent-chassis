

import {
  CLOSED_CANDIDATE_FAILURE_KINDS,
  closedContinuationFailure,
  captureLifecycleFailureEvidence,
  closedFailureCause,
  projectClosedLifecycleFailure,
  summarizeLifecycleFailureEvidence
} from "./dispatch-lifecycle-failure-projection.mjs";
import {
  POST_WORKER_LIFECYCLE_PHASES
} from "./dispatch-post-worker-lifecycle-bindings.mjs";

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
  const evidence = closed?.evidence ?? captureLifecycleFailureEvidence(error);
  failure.evidence_summary = summarizeLifecycleFailureEvidence(evidence);
  failure.evidence = evidence;
  if (closed !== null) {
    const candidateFailure = publishableCandidateFailure(closed.candidate_failure);
    if (candidateFailure !== null) failure.candidate_failure = candidateFailure;

    const continuationFailure = closedContinuationFailure(closed.continuation_failure);
    if (continuationFailure !== null) failure.continuation_failure = continuationFailure;

    const failureCause = closedFailureCause(closed.failure_cause);
    if (failureCause !== null) failure.failure_cause = failureCause;
  }
  if (checkpoint.integration) failure.integration = checkpoint.integration;
  return Object.freeze(failure);
}

const CLOSED_ADDITIVE_FAILURE_FACTS = Object.freeze([
  ["continuation_failure", closedContinuationFailure],
  ["failure_cause", closedFailureCause]
]);

export function publishableLifecycleFailure(lifecycle) {
  if (lifecycle === null || typeof lifecycle !== "object") return lifecycle ?? null;
  const present = CLOSED_ADDITIVE_FAILURE_FACTS.filter(([key]) => Object.hasOwn(lifecycle, key));
  if (present.length === 0) return lifecycle;
  const bounded = { ...lifecycle };
  for (const [key, rebuild] of present) {
    const rebuilt = rebuild(lifecycle[key]);
    if (rebuilt === null) delete bounded[key];
    else bounded[key] = rebuilt;
  }
  return Object.freeze(bounded);
}

export class RecordedLifecycleFailure extends Error {
  constructor(failure) {
    super("post-worker slice lifecycle invocation failed");
    this.name = "RecordedLifecycleFailure";
    this.failure = failure;
  }
}
