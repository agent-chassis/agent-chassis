

import {
  CLOSED_CANDIDATE_FAILURE_KINDS,
  captureLifecycleFailureEvidence,
  closedCandidateGitDetail,
  closedFailureCause,
  projectClosedLifecycleFailure,
  summarizeLifecycleFailureEvidence
} from "./dispatch-lifecycle-failure-projection.mjs";
import {
  POST_WORKER_LIFECYCLE_PHASES
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import {
  DISPATCH_FAILURE_ORIGINALS,
  projectRecordedFailureDetail
} from "./dispatch-tool-helpers.mjs";
import { DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION } from
  "@agent-chassis/agent-launch-cli/src/lib/diagnostic-evidence.mjs";

const GENERIC_LIFECYCLE_FAILURE_CODE = "agent_launch.slice_lifecycle.failed.v1";
const GENERIC_LIFECYCLE_FAILURE_MESSAGE = "post-worker slice lifecycle invocation failed";

const PUBLISHABLE_CANDIDATE_FAILURE_KINDS = Object.freeze(
  new Set(Object.values(CLOSED_CANDIDATE_FAILURE_KINDS))
);

function publishableCandidateGitDetail(detail) {
  return closedCandidateGitDetail(detail);
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

    const failureCause = closedFailureCause(closed.failure_cause);
    if (failureCause !== null) failure.failure_cause = failureCause;
  }
  if (checkpoint.integration) failure.integration = checkpoint.integration;
  return Object.freeze(failure);
}

const CLOSED_ADDITIVE_FAILURE_FACTS = Object.freeze([
  ["failure_cause", closedFailureCause]
]);

export function publishableLifecycleFailure(lifecycle, {
  original = DISPATCH_FAILURE_ORIGINALS.LIFECYCLE_FAILURE_RECORD
} = {}) {
  if (lifecycle === null || typeof lifecycle !== "object") return lifecycle ?? null;
  const present = CLOSED_ADDITIVE_FAILURE_FACTS.filter(([key]) => Object.hasOwn(lifecycle, key));
  const hasEvidence = Object.hasOwn(lifecycle, "evidence");

  const members = projectCapturedMembers(lifecycle, [],
    hasEvidence ? original : DISPATCH_FAILURE_ORIGINALS.LIFECYCLE_CHECKPOINT, new Map(),
    ["evidence", ...CLOSED_ADDITIVE_FAILURE_FACTS.map(([key]) => key)]);
  if (present.length === 0 && !hasEvidence && members === lifecycle) return lifecycle;
  const bounded = { ...members };
  for (const [key, rebuild] of present) {
    const rebuilt = rebuild(lifecycle[key]);
    if (rebuilt === null) delete bounded[key];
    else bounded[key] = rebuilt;
  }
  if (hasEvidence) {
    bounded.evidence = projectRecordedFailureDetail(lifecycle.evidence,
      { original, at: "evidence", nested: true });
  }
  return Object.freeze(bounded);
}

const isCapturedEvidence = (value) => value !== null && typeof value === "object" &&
  value.schema_version === DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION;

function projectCapturedMembers(value, at, original, projected, skip = []) {
  if (value === null || typeof value !== "object") return value;
  if (projected.has(value)) return projected.get(value);
  let entries;
  let captured;
  try {
    captured = isCapturedEvidence(value);
    entries = captured ? null : [...(Array.isArray(value) ? value.entries() : Object.entries(value))];
  } catch {
    projected.set(value, value);
    return value;
  }
  if (captured) {
    const replacement = projectRecordedFailureDetail(value, { original, at: at.join("."), nested: true });
    projected.set(value, replacement);
    return replacement;
  }
  projected.set(value, value);
  let copy = null;
  for (const [key, member] of entries) {
    if (skip.includes(key)) continue;
    const next = projectCapturedMembers(member, [...at, key], original, projected);
    if (next === member) continue;
    copy ??= Array.isArray(value) ? [...value] : { ...value };
    copy[key] = next;
  }
  const result = copy === null ? value : Object.freeze(copy);
  projected.set(value, result);
  return result;
}

const RESOLUTION_DIAGNOSTIC_MEMBERS = Object.freeze([
  ["retry_assessment", "assessment_evidence"],
  ["failure_history_durability", "publication_result"],
  ["failure_history_durability", "read_result"]
]);

export function publishableLifecycleResolution(resolution) {
  if (resolution === null || typeof resolution !== "object") return resolution ?? null;
  let projected = null;
  for (const [member, field] of RESOLUTION_DIAGNOSTIC_MEMBERS) {
    const holder = resolution[member];
    if (holder === null || typeof holder !== "object" || !Object.hasOwn(holder, field) ||
        holder[field] === null || typeof holder[field] !== "object") continue;
    projected ??= { ...resolution };
    projected[member] = Object.freeze({
      ...projected[member],
      [field]: projectRecordedFailureDetail(holder[field], {
        original: DISPATCH_FAILURE_ORIGINALS.LIFECYCLE_CHECKPOINT, at: `${member}.${field}`,
        nested: true })
    });
  }
  return projected === null ? resolution : Object.freeze(projected);
}

export class RecordedLifecycleFailure extends Error {
  constructor(failure) {
    super("post-worker slice lifecycle invocation failed");
    this.name = "RecordedLifecycleFailure";
    this.failure = failure;
  }
}
