

import {
  cloneJson,
  isNonEmptyString,
  isObject,
  normalizeStringEntry,
} from "./work-record-admission-shared.mjs";
import { validateReviewAttestation } from "./work-record-review-attestation.mjs";

const REMOTE_REVIEW_ATTESTATION_SCHEMA_VERSION = "worker_admission.review_attestation.v1";
const REMOTE_REVIEW_ATTESTATION_STATUS = "accepted";

export const REVIEW_ATTESTATION_REQUIRED_ROLE_CLASS = "reviewer";

export const REVIEW_ATTESTATION_ACCEPTED_ROLE_CLASSES = Object.freeze([
  "reviewer",
  "redteam",
]);
const REVIEW_THRESHOLD_REASON_CODES = new Set([
  "review_threshold_exceeded",
  "worker_admission.work_unit_atomicity.review_threshold_exceeded.v1",
]);

const PORTFOLIO_DISPOSITION_TO_REMOTE_REVIEW_OUTCOME = Object.freeze({
  accepted_no_findings: "no_findings",
  accepted_with_nonblocking_findings: "passed_no_blocking_or_medium_findings",
});

function projectRemoteUnit(unit) {
  if (!isObject(unit)) {
    return null;
  }
  const recordId = normalizeStringEntry(unit.record_id);
  const address = normalizeStringEntry(unit.address);
  if (!recordId || !address) {
    return null;
  }
  return { record_id: recordId, slice_id: normalizeStringEntry(unit.slice_id), address };
}

function projectRemoteControls(controls) {
  if (!Array.isArray(controls)) {
    return null;
  }
  const recognized = [];
  const seen = new Set();
  for (const control of controls) {
    const trimmed = normalizeStringEntry(control);
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      recognized.push(trimmed);
    }
  }
  return recognized.length > 0 ? recognized : null;
}

function isReviewThresholdReasonCode(code) {
  const normalized = normalizeStringEntry(code);
  return Boolean(normalized && REVIEW_THRESHOLD_REASON_CODES.has(normalized));
}

function isControlId(value) {
  const normalized = normalizeStringEntry(value);
  return Boolean(normalized && /^[a-z][a-z0-9_]*$/u.test(normalized));
}

export function extractReviewThresholdControlsFromRemoteAdmissionResult(remoteResult) {
  if (
    !isObject(remoteResult) ||
    remoteResult.effect !== "needs_review" ||
    remoteResult.outcome !== "pack_backed_result" ||
    remoteResult.pack_backed !== true ||
    remoteResult.node_engine_backed_success !== true ||
    !Array.isArray(remoteResult.pack_result_reasons)
  ) {
    return [];
  }

  const controls = [];
  const seen = new Set();
  for (const reason of remoteResult.pack_result_reasons) {
    if (!isObject(reason) || !isReviewThresholdReasonCode(reason.code)) {
      continue;
    }
    const field = normalizeStringEntry(reason.field);
    if (isControlId(field) && !seen.has(field)) {
      seen.add(field);
      controls.push(field);
    }
  }
  return controls;
}

export function createReviewAttestationBindingFromRemoteNeedsReview(remoteResult, { admitting_run_id } = {}) {
  const requiredControls = extractReviewThresholdControlsFromRemoteAdmissionResult(remoteResult);
  const admittingRunId = normalizeStringEntry(admitting_run_id);
  if (requiredControls.length === 0 || !admittingRunId) {
    return null;
  }
  return {
    required_role_class: REVIEW_ATTESTATION_REQUIRED_ROLE_CLASS,
    required_controls: requiredControls,
    admitting_run_id: admittingRunId,
  };
}

function isPackBackedNeedsReview(remoteResult) {
  return (
    isObject(remoteResult) &&
    remoteResult.effect === "needs_review" &&
    remoteResult.outcome === "pack_backed_result" &&
    remoteResult.pack_backed === true &&
    remoteResult.node_engine_backed_success === true
  );
}

function projectFirstPassReviewThresholdReasonsForRetry(firstResult, requiredControls) {
  if (!isPackBackedNeedsReview(firstResult) || !Array.isArray(firstResult.pack_result_reasons)) {
    return [];
  }
  const required = new Set(
    Array.isArray(requiredControls)
      ? requiredControls.map((control) => normalizeStringEntry(control)).filter(Boolean)
      : [],
  );
  if (required.size === 0) {
    return [];
  }
  return firstResult.pack_result_reasons
    .filter((reason) => {
      const field = normalizeStringEntry(reason?.field);
      return isObject(reason) && isReviewThresholdReasonCode(reason.code) && field && required.has(field);
    })
    .map((reason) => cloneJson(reason));
}

export function preserveFirstPassReviewThresholdReasonsForOpaqueRetryResult(
  retryResult,
  { firstResult, review_attestation_binding: reviewAttestationBinding } = {},
) {
  if (!isPackBackedNeedsReview(retryResult)) {
    return retryResult;
  }
  if (extractReviewThresholdControlsFromRemoteAdmissionResult(retryResult).length > 0) {
    return retryResult;
  }
  const firstPassReasons = projectFirstPassReviewThresholdReasonsForRetry(
    firstResult,
    reviewAttestationBinding?.required_controls,
  );
  if (firstPassReasons.length === 0) {
    return retryResult;
  }
  const retryReasons = Array.isArray(retryResult.pack_result_reasons)
    ? retryResult.pack_result_reasons
    : [];
  return {
    ...retryResult,
    pack_result_reasons: [...retryReasons, ...firstPassReasons],
  };
}

function projectRemoteRunRef(runRef) {
  if (!isObject(runRef)) {
    return null;
  }
  const ref = {
    run_id: normalizeStringEntry(runRef.run_id),
    role_class: normalizeStringEntry(runRef.role_class),
    terminal_status: normalizeStringEntry(runRef.terminal_status),
    subject_address: normalizeStringEntry(runRef.subject_address),
    provenance_kind: normalizeStringEntry(runRef.provenance_kind),
  };
  return Object.values(ref).every(isNonEmptyString) ? ref : null;
}

function isSeparateReviewUnitAttestation(stored) {
  return isObject(stored.review_unit);
}

function projectRemoteReviewAttestation(stored) {
  if (!isObject(stored)) {
    return null;
  }
  const attestationId = normalizeStringEntry(stored.attestation_id);
  const attestationDigest = normalizeStringEntry(stored.attestation_digest);
  const repo = normalizeStringEntry(stored.repo);
  const unit = projectRemoteUnit(stored.unit);
  const reviewedControls = projectRemoteControls(stored.reviewed_controls);
  const reviewerRoleClass = normalizeStringEntry(stored.reviewer_role_class);
  const sourceDigest = normalizeStringEntry(stored.source_digest);
  const reviewedAt = normalizeStringEntry(stored.reviewed_at);
  const expiresAt = normalizeStringEntry(stored.expires_at);
  const reviewOutcome = PORTFOLIO_DISPOSITION_TO_REMOTE_REVIEW_OUTCOME[normalizeStringEntry(stored.status)];

  if (
    !attestationId ||
    !attestationDigest ||
    !repo ||
    !unit ||
    !reviewedControls ||
    !reviewerRoleClass ||
    !sourceDigest ||
    !reviewedAt ||
    !expiresAt ||
    !reviewOutcome
  ) {
    return null;
  }

  const remote = {
    schema_version: REMOTE_REVIEW_ATTESTATION_SCHEMA_VERSION,
    attestation_id: attestationId,
    attestation_digest: attestationDigest,
    repo,
    unit,
    reviewed_controls: reviewedControls,
    status: REMOTE_REVIEW_ATTESTATION_STATUS,
    review_outcome: reviewOutcome,
    source_digest: sourceDigest,
    reviewed_at: reviewedAt,
    expires_at: expiresAt,
    reviewer_role_class: reviewerRoleClass,
  };

  if (!isSeparateReviewUnitAttestation(stored)) {
    const runRef = projectRemoteRunRef(stored.review_run_ref);
    if (runRef) {
      remote.review_run_ref = runRef;
    }
  }

  return cloneJson(remote);
}

function normalizeControlRoleRequirements(value) {
  if (!isObject(value)) {
    return {};
  }
  const requirements = {};
  for (const [control, role] of Object.entries(value)) {
    const controlId = normalizeStringEntry(control);
    const roleClass = normalizeStringEntry(role);
    if (controlId && roleClass) {
      requirements[controlId] = roleClass;
    }
  }
  return requirements;
}

function resolveAcceptedRoleClasses(requiredControls, controlRoleRequirements) {
  const controls = Array.isArray(requiredControls)
    ? requiredControls.map((control) => normalizeStringEntry(control)).filter(Boolean)
    : [];
  const requirements = normalizeControlRoleRequirements(controlRoleRequirements);
  return REVIEW_ATTESTATION_ACCEPTED_ROLE_CLASSES.filter((roleClass) =>
    controls.every((control) => !requirements[control] || requirements[control] === roleClass),
  );
}

export function carryReviewAttestations(rawAttestations, expectation = {}) {
  if (!Array.isArray(rawAttestations)) {
    return [];
  }
  const boundExpectation = isObject(expectation) ? expectation : {};
  const acceptedRoleClasses = resolveAcceptedRoleClasses(
    boundExpectation.required_controls,
    boundExpectation.control_role_requirements,
  );
  const carried = [];
  for (const stored of rawAttestations) {
    const acceptedForSomeRole = acceptedRoleClasses.some((roleClass) => {
      const verdict = validateReviewAttestation(stored, {
        ...boundExpectation,
        required_role_class: roleClass,
      });
      return Boolean(verdict && verdict.valid === true);
    });
    if (!acceptedForSomeRole) {
      continue;
    }
    const remote = projectRemoteReviewAttestation(stored);
    if (remote) {
      carried.push(remote);
    }
  }
  return carried;
}
