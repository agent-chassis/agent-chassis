

import {
  buildReviewAttestation,
  computeReviewedUnitSourceDigest
} from "@agent-chassis/wiki-core/src/lib/work-record-review-attestation.mjs";
import { SLICE_ID_PATTERN } from
  "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { computeNormalizedInputDigest } from
  "@agent-chassis/wiki-core/src/lib/work-record-admission-shared.mjs";
import {
  computeNormalizedRequestOutputHash,
  evaluateWorkRecordAdmissionDerivedEvidence
} from "@agent-chassis/wiki-core/src/lib/work-record-admission-derived-evidence.mjs";
import {
  createPersistedWorkerAdmissionDerivedEvidence,
  createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary,
  prepareWorkRecordAdmissionDerivedEvidenceSidecar
} from "@agent-chassis/wiki-core/src/lib/work-record-admission-derived-evidence-persist.mjs";
import { readPersistedWorkerAdmissionEvidenceSidecar } from
  "@agent-chassis/wiki-core/src/lib/work-record-admission-evidence-sidecar.mjs";
import {
  materializeWorkRecordAdmissionDerivedEvidence,
  readWorkRecordById
} from "@agent-chassis/wiki-core";
import {
  computeWorkRecordPersistenceSnapshotDigest,
  writeValidatedWorkRecordWithAdmissionSidecars
} from "@agent-chassis/wiki-core/src/operations/work-records-store-io.mjs";
import { upsertWorkerAdmissionDerivedEvidenceEntries } from
  "@agent-chassis/wiki-core/src/operations/work-records-admission-evidence.mjs";

const SETTLEMENT_OWNER = "workspace_agent_dispatch.formal_attestation_settlement";

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseUnit(subject) {
  const value = nonEmpty(subject);
  if (!value) return null;
  const pieces = value.split("#");
  if (pieces.length > 2 || !/^WK-[0-9]{4}$/u.test(pieces[0])) return null;
  if (pieces.length === 1) {
    return Object.freeze({
      kind: "work_item", address: pieces[0], record_id: pieces[0], slice_id: null
    });
  }
  if (!SLICE_ID_PATTERN.test(pieces[1])) return null;
  return Object.freeze({
    kind: "slice", address: value, record_id: pieces[0], slice_id: pieces[1]
  });
}

function selectedUnit(record, unit) {
  if (unit.kind === "work_item") return record;
  return Array.isArray(record?.slices)
    ? record.slices.find((entry) => entry?.id === unit.slice_id) ?? null
    : null;
}

function refreshOutputHashes(normalizedRequest) {
  if (!isObject(normalizedRequest)) return;
  const outputHash = computeNormalizedRequestOutputHash(normalizedRequest);
  for (const ref of normalizedRequest.artifact_refs ?? []) {
    if (isObject(ref) && nonEmpty(ref.produced_by_preparation_output_hash) &&
        ref.produced_by_preparation_output_hash !== "not_applicable") {
      ref.produced_by_preparation_output_hash = outputHash;
    }
  }
  for (const ref of normalizedRequest.preparation_audit_refs ?? []) {
    if (isObject(ref) && nonEmpty(ref.output_hash)) ref.output_hash = outputHash;
  }
}

function addAttestation(fullEvidence, attestation) {
  const updated = cloneJson(fullEvidence);
  if (!isObject(updated?.normalized_request)) {
    throw new Error("formal attestation evidence materialization is unavailable");
  }
  if (!isObject(updated.normalized_request.evidence)) {
    updated.normalized_request.evidence = {};
  }
  const current = Array.isArray(updated.normalized_request.evidence.review_attestations)
    ? updated.normalized_request.evidence.review_attestations
    : [];
  updated.normalized_request.evidence.review_attestations = [
    ...current.filter((entry) => entry?.attestation_id !== attestation.attestation_id),
    cloneJson(attestation)
  ];
  refreshOutputHashes(updated.normalized_request);
  return updated;
}

async function materializeEvidence({ workspace, record, unit, sourceDigest }) {
  const persisted = await readPersistedWorkerAdmissionEvidenceSidecar({
    dir: workspace.dir,
    record,
    selectedUnit: unit,
    sourceDigest
  });
  if (persisted) return persisted;
  return materializeWorkRecordAdmissionDerivedEvidence({
    record,
    repo: record.repo,
    dispatch_readiness: {
      record_id: unit.record_id,
      unit,
      dispatchable: true,
      decision_code: "formal_attestation.same_run_materialization.v1",
      reasons: []
    }
  });
}

async function persist({ workspace, loaded, unit, sourceDigest, attestation }) {
  const persistenceSnapshotDigest =
    computeWorkRecordPersistenceSnapshotDigest(loaded.record);
  const updatedRecord = cloneJson(loaded.record);
  const currentEvidence = await materializeEvidence({
    workspace,
    record: updatedRecord,
    unit,
    sourceDigest
  });
  const updatedEvidence = addAttestation(currentEvidence, attestation);
  const admissionSummary = createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary(
    evaluateWorkRecordAdmissionDerivedEvidence(updatedEvidence)
  );
  const sidecar = prepareWorkRecordAdmissionDerivedEvidenceSidecar(updatedEvidence);
  const compact = createPersistedWorkerAdmissionDerivedEvidence(updatedEvidence, {
    sidecarPath: sidecar.relativePath,
    sidecarDigest: sidecar.digest,
    admissionSummary,
    retainInlineTargetResolutionBinding: true
  });
  updatedRecord.derived_evidence = upsertWorkerAdmissionDerivedEvidenceEntries(
    updatedRecord,
    compact,
    sourceDigest
  );
  const written = await writeValidatedWorkRecordWithAdmissionSidecars({
    dir: workspace.dir,
    record: updatedRecord,
    expectedSourceDigest: loaded.source_digest,
    expectedPersistenceSnapshotDigest: persistenceSnapshotDigest,
    admissionSidecars: [sidecar]
  });
  if (written?.written !== true) {
    const error = new Error("formal attestation publication failed");
    error.code = written?.diagnostics?.[0]?.code ?? "work_record_write_failed";
    throw error;
  }
  return Object.freeze({
    sidecar_path: sidecar.relativePath,
    sidecar_digest: sidecar.digest
  });
}

function reviewedControls(formalResult) {
  if (!Array.isArray(formalResult?.reviewed_controls)) return [];
  return formalResult.reviewed_controls
    .filter((entry) => entry?.result === "pass" && nonEmpty(entry.control_id))
    .map((entry) => entry.control_id.trim());
}

export async function publishOriginalReviewAttestation({
  workspace,
  subject,
  role,
  runId,
  reviewedAt,
  expiresAt,
  formalResult
}) {
  const unit = parseUnit(subject);
  if (!unit || !["reviewer", "redteam"].includes(role)) {
    return Object.freeze({ recorded: false, reason: "canonical_attestation_identity_invalid" });
  }
  const controls = reviewedControls(formalResult);
  if (controls.length === 0) {
    return Object.freeze({ recorded: false, reason: "trusted_reviewed_controls_unavailable" });
  }
  const loaded = await readWorkRecordById({ dir: workspace.dir, id: unit.record_id });
  if (loaded?.valid !== true || !loaded.record) {
    return Object.freeze({ recorded: false, reason: "canonical_attestation_subject_unavailable" });
  }
  const selected = selectedUnit(loaded.record, unit);
  if (!selected) {
    return Object.freeze({ recorded: false, reason: "canonical_attestation_subject_unavailable" });
  }
  const sourceDigest = computeReviewedUnitSourceDigest(
    unit.kind === "slice"
      ? { record: cloneJson(loaded.record), selected_slice_id: unit.slice_id }
      : cloneJson(loaded.record)
  );
  const repo = nonEmpty(loaded.record.repo);
  if (!repo || !nonEmpty(sourceDigest) || !nonEmpty(runId) ||
      !nonEmpty(reviewedAt) || !nonEmpty(expiresAt)) {
    return Object.freeze({ recorded: false, reason: "canonical_attestation_facts_unavailable" });
  }
  const counts = formalResult?.finding_counts;
  const attestationId = `ra:${computeNormalizedInputDigest({
    repo,
    subject: unit.address,
    run_id: runId,
    source_digest: sourceDigest
  }).slice("sha256:".length)}`;
  const built = buildReviewAttestation({
    attestation_id: attestationId,
    repo,
    unit,
    reviewed_controls: controls,
    reviewer_role_class: role,
    review_outcome: formalResult.reported_outcome,
    blocking_finding_count: counts?.blocking,
    medium_finding_count: counts?.medium,
    source_digest: sourceDigest,
    reviewed_at: reviewedAt,
    expires_at: expiresAt,
    review_run: {
      run_id: runId,
      role_class: role,
      terminal_status: "succeeded",
      subject_address: unit.address,
      provenance_kind: "structured_dispatch_run"
    }
  });
  if (built.ok !== true) {
    return Object.freeze({
      recorded: false,
      reason: built.decision_code ?? "formal_attestation_derivation_failed",
      diagnostics: Object.freeze([...(built.reasons ?? [])].slice(0, 20))
    });
  }
  const publication = await persist({
    workspace,
    loaded,
    unit,
    sourceDigest,
    attestation: built.attestation
  });
  return Object.freeze({
    owner: SETTLEMENT_OWNER,
    recorded: true,
    attestation: Object.freeze({
      attestation_id: built.attestation.attestation_id,
      attestation_digest: built.attestation.attestation_digest,
      reviewed_controls: Object.freeze([...built.attestation.reviewed_controls]),
      reviewer_role_class: built.attestation.reviewer_role_class,
      review_outcome: formalResult.reported_outcome,
      reviewed_at: built.attestation.reviewed_at,
      expires_at: built.attestation.expires_at,
      ...publication
    })
  });
}
