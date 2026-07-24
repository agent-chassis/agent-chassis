

import path from "node:path";

import {
  buildSliceReviewAcceptanceProof,
  computeSliceReviewStructuredResultDigest,
  validateExactSliceImplementationReviewTransition,
  SLICE_REVIEW_ACCEPTANCE_DECISION_CODES,
  SLICE_REVIEW_ACCEPTANCE_EVIDENCE_KEY,
  sliceReviewAcceptanceAuthorityEffects,
  validateSliceReviewAcceptanceProof
} from "../lib/work-record-slice-review-acceptance.mjs";
import { computeReviewedUnitSourceDigest } from "../lib/work-record-review-attestation.mjs";

import {
  canonicalizeWorkRecordJson,
  projectSliceReviewReceiptContracts
} from "../lib/work-record-schema.mjs";
import {
  cloneJson,
  computeNormalizedInputDigest,
  isObject,
  normalizeStringEntry
} from "../lib/work-record-admission-shared.mjs";
import {
  computeNormalizedRequestOutputHash,
  evaluateWorkRecordAdmissionDerivedEvidence
} from "../lib/work-record-admission-derived-evidence.mjs";
import {
  createPersistedWorkerAdmissionDerivedEvidence,
  createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary,
  prepareWorkRecordAdmissionDerivedEvidenceSidecar
} from "../lib/work-record-admission-derived-evidence-persist.mjs";
import {
  readPersistedWorkerAdmissionEvidenceSidecar,
  WorkerAdmissionSidecarError
} from "../lib/work-record-admission-evidence-sidecar.mjs";
import {
  computeWorkRecordPersistenceSnapshotDigest,
  digestWorkRecord,
  readWorkRecordById,
  writeValidatedWorkRecordWithAdmissionSidecars
} from "./work-records-store-io.mjs";
import {
  isWorkerAdmissionDerivedEvidenceForUnit,
  materializeWorkRecordAdmissionDerivedEvidence,
  upsertWorkerAdmissionDerivedEvidenceEntries
} from "./work-records-admission-evidence.mjs";
import { parseDispatchUnitAddress } from "./work-records-shared.mjs";

const CODES = SLICE_REVIEW_ACCEPTANCE_DECISION_CODES;

export async function persistExactSliceImplementationReviewTransition({
  dir,
  unitAddress,
  writeStatus
} = {}) {
  if (typeof writeStatus !== "function") {
    throw new TypeError("exact-slice review transition requires the canonical status writer");
  }
  const result = await writeStatus({
    dir,
    unitAddress,
    status: "review"
  });
  return Object.freeze({
    validation: validateExactSliceImplementationReviewTransition(result, unitAddress),
    result
  });
}

const FORBIDDEN_CALLER_CARRIED_FIELDS = new Set([
  "accepted_authorities",
  "attestation",
  "authority",
  "clean_review",
  "evidence",
  "evidence_digest",
  "final_result",
  "no_findings",
  "proof",
  "prompt",
  "prose",
  "review_acceptance",
  "review_acceptance_proof",
  "review_attestations",
  "review_outcome",
  "slice_review_acceptance",
  "status",
  "structured_result_digest"
]);

function refusal(decisionCode, reasons) {
  return {
    schema_version: "workspace-agent-slice-review-acceptance-result.v1",
    ok: false,
    decision_code: decisionCode,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
    proof: null,
    ...sliceReviewAcceptanceAuthorityEffects(),
    authorizes_slice_integration: false
  };
}

function collectForbiddenCallerCarriedFields(options) {
  if (!isObject(options)) return [];
  return Object.keys(options)
    .filter((key) => FORBIDDEN_CALLER_CARRIED_FIELDS.has(key))
    .sort((left, right) => left.localeCompare(right));
}

function parseSliceUnit(value) {
  const parsed = parseDispatchUnitAddress(value);
  if (!parsed.ok || parsed.unit?.kind !== "slice") return null;
  return parsed.unit;
}

function recordHasSlice(record, sliceId) {
  return Array.isArray(record?.slices) && record.slices.some((slice) => slice?.id === sliceId);
}

const HISTORICAL_SLICE_REVIEW_CONTRACT_FIELDS = Object.freeze([
  "canonical_parent_wk_contract",
  "canonical_parent_contract_digest",
  "slice_review_contract",
  "slice_review_contract_digest"
]);

function resolveHistoricalSliceReviewContract({ historicalContract, unit, currentRecord }) {
  if (!isObject(historicalContract) ||
      Object.keys(historicalContract).length !== HISTORICAL_SLICE_REVIEW_CONTRACT_FIELDS.length ||
      HISTORICAL_SLICE_REVIEW_CONTRACT_FIELDS.some((field) =>
        !Object.prototype.hasOwnProperty.call(historicalContract, field))) {
    return refusal(CODES.malformed, [
      "historical_contract must carry the exact frozen slice-review contract and digest fields"
    ]);
  }
  const parentText = historicalContract.canonical_parent_wk_contract;
  const sliceText = historicalContract.slice_review_contract;
  if (!normalizeStringEntry(parentText) || !normalizeStringEntry(sliceText) ||
      computeNormalizedInputDigest(parentText) !== historicalContract.canonical_parent_contract_digest ||
      computeNormalizedInputDigest(sliceText) !== historicalContract.slice_review_contract_digest) {
    return refusal(CODES.malformed, [
      "historical slice-review contract digest is missing or mismatched"
    ]);
  }

  let record;
  let slice;
  try {
    record = JSON.parse(parentText);
    slice = JSON.parse(sliceText);
  } catch {
    return refusal(CODES.malformed, ["historical slice-review contract is not valid JSON"]);
  }
  const parentSlice = Array.isArray(record?.slices)
    ? record.slices.find((entry) => entry?.id === unit.slice_id)
    : null;
  if (!isObject(record) || record.id !== unit.record_id ||
      record.initiative !== currentRecord?.initiative || record.status === "review" ||
      !isObject(slice) || slice.id !== unit.slice_id ||
      slice.work_kind !== "implementation" || slice.status !== "review" ||
      !isObject(parentSlice) || canonicalizeWorkRecordJson(parentSlice) !== sliceText) {
    return refusal(CODES.bindingMismatch, [
      "historical slice-review contract is not the exact pre-integration unit for the current record identity"
    ]);
  }
  const currentSlice = Array.isArray(currentRecord?.slices)
    ? currentRecord.slices.find((entry) => entry?.id === unit.slice_id)
    : null;
  const incompleteImplementationSiblings = Array.isArray(currentRecord?.slices)
    ? currentRecord.slices.filter((entry) =>
        entry?.id !== unit.slice_id && entry?.work_kind === "implementation" &&
        entry.status !== "done" && entry.status !== "cancelled")
    : [];
  const finalIntegration = currentRecord?.status === "review";
  const permittedLifecycleState = isObject(currentSlice) &&
    (finalIntegration
      ? incompleteImplementationSiblings.length === 0 &&
        (currentSlice.status === "review" || currentSlice.status === "done")
      : currentSlice.status === "done" && incompleteImplementationSiblings.length > 0);
  if (!permittedLifecycleState) {
    return refusal(CODES.targetStale, [
      "current canonical state is not an exact final or non-final integrated lifecycle transition"
    ]);
  }

  const normalizedCurrent = projectSliceReviewReceiptContracts(currentRecord, unit.slice_id).parent;
  normalizedCurrent.status = record.status;
  const normalizedSlice = normalizedCurrent.slices.find((entry) => entry?.id === unit.slice_id);
  normalizedSlice.status = slice.status;

  if (canonicalizeWorkRecordJson(normalizedCurrent) !== parentText) {
    return refusal(CODES.targetStale, [
      "current canonical state changed beyond the exact lifecycle fields frozen by the historical contract"
    ]);
  }
  const sourceDigest = computeSliceUnitSourceDigest(record, unit.slice_id);
  if (!sourceDigest) {
    return refusal(CODES.malformed, [
      "historical slice-review contract source digest could not be derived"
    ]);
  }
  return { ok: true, sourceDigest };
}

function computeSliceUnitSourceDigest(record, sliceId) {
  return normalizeStringEntry(
    computeReviewedUnitSourceDigest({ record: cloneJson(record), selected_slice_id: sliceId })
  );
}

function refreshNormalizedRequestOutputHashes(normalizedRequest) {
  if (!isObject(normalizedRequest)) return;
  const outputHash = computeNormalizedRequestOutputHash(normalizedRequest);
  if (Array.isArray(normalizedRequest.artifact_refs)) {
    for (const ref of normalizedRequest.artifact_refs) {
      if (isObject(ref) &&
          normalizeStringEntry(ref.produced_by_preparation_output_hash) &&
          ref.produced_by_preparation_output_hash !== "not_applicable") {
        ref.produced_by_preparation_output_hash = outputHash;
      }
    }
  }
  if (Array.isArray(normalizedRequest.preparation_audit_refs)) {
    for (const ref of normalizedRequest.preparation_audit_refs) {
      if (isObject(ref) && normalizeStringEntry(ref.output_hash)) {
        ref.output_hash = outputHash;
      }
    }
  }
}

function buildEvidenceOnlyMaterializationDispatchReadiness(unit) {
  return {
    schema_version: "dispatch-readiness.v1",
    record_id: unit.record_id,
    unit,
    decision_code: "slice_review_acceptance.record_time_materialization.v1",
    dispatchable: false,
    clusters: [],
    state: {
      graph_available: false,
      dirty_state: "unknown",
      staleness: "unknown",
      graph_state: {
        graph_available: false,
        edge_source: "unavailable",
        dirty_graph_mode: "unavailable",
        unavailable_paths: []
      }
    },
    reasons: [
      "slice-review acceptance evidence is integration authority only and does not assert dispatch readiness"
    ],
    accepted_escalations: [],
    blast_radius: { level: "low", reasons: [], accepted_escalation_id: null }
  };
}

function findAnyDerivedEvidenceEntryForUnit(record, unit) {
  const entries = Array.isArray(record?.derived_evidence) ? record.derived_evidence : [];
  return entries.find((entry) => isWorkerAdmissionDerivedEvidenceForUnit(entry, record.id, unit)) ?? null;
}

async function createFullEvidenceForSliceReviewAcceptance({ dir, record, unit, sourceDigest }) {
  const priorFullEvidence = await readPersistedWorkerAdmissionEvidenceSidecar({
    dir,
    record,
    selectedUnit: unit,
    sourceDigest
  });
  if (priorFullEvidence) return { ok: true, fullEvidence: priorFullEvidence };
  if (findAnyDerivedEvidenceEntryForUnit(record, unit) !== null) {
    return {
      ok: false,
      decision_code: CODES.targetStale,
      reasons: [
        "the unit's admission derived evidence was recorded against a different source digest; " +
          "minting here would overwrite it, so the canonical evidence must be refreshed and the review repeated"
      ]
    };
  }
  return {
    ok: true,
    fullEvidence: materializeWorkRecordAdmissionDerivedEvidence({
      record,
      repo: record.repo,
      dispatch_readiness: buildEvidenceOnlyMaterializationDispatchReadiness(unit)
    })
  };
}

function upsertSliceReviewAcceptanceProof(fullEvidence, proof) {
  const updated = cloneJson(fullEvidence);
  if (!isObject(updated.normalized_request)) {
    throw new Error(
      "slice-review acceptance operation could not materialize full worker-admission evidence"
    );
  }
  if (!isObject(updated.normalized_request.evidence)) {
    updated.normalized_request.evidence = {};
  }
  updated.normalized_request.evidence[SLICE_REVIEW_ACCEPTANCE_EVIDENCE_KEY] = cloneJson(proof);
  refreshNormalizedRequestOutputHashes(updated.normalized_request);
  return updated;
}

async function persistSliceReviewAcceptanceProof({
  dir,
  loaded,
  unit,
  sourceDigest,
  recordSourceDigest,
  proof,
  recordStore
}) {
  const persistenceSnapshotDigest = computeWorkRecordPersistenceSnapshotDigest(loaded.record);
  const updatedRecord = cloneJson(loaded.record);
  const envelope = await createFullEvidenceForSliceReviewAcceptance({
    dir,
    record: updatedRecord,
    unit,
    sourceDigest
  });
  if (!envelope.ok) return { refusal: envelope };
  const fullEvidenceWithProof = upsertSliceReviewAcceptanceProof(envelope.fullEvidence, proof);
  const admissionSummary = createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary(
    evaluateWorkRecordAdmissionDerivedEvidence(fullEvidenceWithProof)
  );
  const sidecarPublication = prepareWorkRecordAdmissionDerivedEvidenceSidecar(fullEvidenceWithProof);
  const compactEntry = createPersistedWorkerAdmissionDerivedEvidence(fullEvidenceWithProof, {
    sidecarPath: sidecarPublication.relativePath,
    sidecarDigest: sidecarPublication.digest,
    admissionSummary,
    retainInlineTargetResolutionBinding: true
  });
  updatedRecord.derived_evidence = upsertWorkerAdmissionDerivedEvidenceEntries(
    updatedRecord,
    compactEntry,
    sourceDigest
  );

  const writeResult = await writeValidatedWorkRecordWithAdmissionSidecars({
    dir,
    record: updatedRecord,
    expectedSourceDigest: recordSourceDigest,
    expectedPersistenceSnapshotDigest: persistenceSnapshotDigest,
    admissionSidecars: [sidecarPublication],
    recordStore
  });
  return {
    writeResult,
    sidecarRelativePath: sidecarPublication.relativePath,
    sidecarDigest: sidecarPublication.digest
  };
}

async function loadSliceUnitContext({ dir, unitAddress, recordStore }) {
  const unit = parseSliceUnit(unitAddress);
  if (!unit) {
    return {
      ok: false,
      result: refusal(CODES.malformed, [
        "unit_address must be an exact implementation-slice unit address"
      ])
    };
  }
  const targetDir = path.resolve(String(dir));
  const loaded = await readWorkRecordById({ dir: targetDir, id: unit.record_id, recordStore });
  if (!loaded?.record || !recordHasSlice(loaded.record, unit.slice_id)) {
    return {
      ok: false,
      result: refusal(CODES.missing, [
        `canonical slice ${unit.address} could not be loaded from ${targetDir}`
      ])
    };
  }
  const sourceDigest = computeSliceUnitSourceDigest(loaded.record, unit.slice_id);
  const recordSourceDigest =
    normalizeStringEntry(loaded.source_digest) ?? digestWorkRecord(loaded.record);
  if (!sourceDigest || !recordSourceDigest) {
    return {
      ok: false,
      result: refusal(CODES.malformed, ["canonical slice source_digest could not be resolved"])
    };
  }
  return { ok: true, unit, targetDir, loaded, sourceDigest, recordSourceDigest };
}

export async function mintAndPersistSliceReviewAcceptanceProof(options = {}) {
  if (!isObject(options)) {
    return refusal(CODES.malformed, ["operation input must be an object"]);
  }
  const forbidden = collectForbiddenCallerCarriedFields(options);
  if (forbidden.length > 0) {
    return refusal(CODES.untrustedProvenance, [
      `caller-carried proof/authority fields are not accepted: ${forbidden.join(", ")}`
    ]);
  }

  const {
    dir = ".",
    recordStore = null,
    unit_address: unitAddress = null,
    review_result: reviewResult = null,
    binding = null,
    reviewed_at: reviewedAt = null
  } = options;

  if (!isObject(binding)) {
    return refusal(CODES.malformed, ["binding must be the launcher-owned slice-review tuple"]);
  }

  const structuredResultDigest = computeSliceReviewStructuredResultDigest(reviewResult);
  if (!structuredResultDigest) {
    return refusal(CODES.reviewNotAccepted, [
      "no clean trusted backend review_result is available for this review run"
    ]);
  }

  const context = await loadSliceUnitContext({ dir, unitAddress, recordStore });
  if (!context.ok) return context.result;
  const { unit, targetDir, loaded, sourceDigest, recordSourceDigest } = context;

  const built = buildSliceReviewAcceptanceProof({
    unit_address: unit.address,
    initiative: normalizeStringEntry(binding.initiative),
    slice_ref: normalizeStringEntry(binding.slice_ref),
    reviewed_sha: normalizeStringEntry(binding.reviewed_sha),
    diff_base_sha: normalizeStringEntry(binding.diff_base_sha),
    ...(binding.review_admission_kind === "canonical_committed_slice"
      ? {
          review_admission_kind: normalizeStringEntry(binding.review_admission_kind),
          committed_target_digest: normalizeStringEntry(binding.committed_target_digest)
        }
      : { source_worker_run_id: normalizeStringEntry(binding.source_worker_run_id) }),
    review_run_id: normalizeStringEntry(binding.review_run_id),
    review_monitor_handle: normalizeStringEntry(binding.review_monitor_handle),
    reviewer_role: normalizeStringEntry(binding.reviewer_role),
    review_outcome: normalizeStringEntry(reviewResult.review_outcome),
    reviewed_at: normalizeStringEntry(reviewedAt) ?? new Date().toISOString(),
    canonical_review_unit_digest: sourceDigest,
    structured_result_digest: structuredResultDigest
  });
  if (!built.ok) {
    return refusal(built.decision_code, built.reasons);
  }

  let persisted;
  try {
    persisted = await persistSliceReviewAcceptanceProof({
      dir: targetDir,
      loaded,
      unit,
      sourceDigest,
      recordSourceDigest,
      proof: built.proof,
      recordStore
    });
  } catch (error) {

    if (error instanceof WorkerAdmissionSidecarError) {
      return refusal(CODES.malformed, [
        `existing admission evidence for this unit is unreadable or tampered (${error.code}); no proof was persisted`
      ]);
    }
    throw error;
  }
  if (persisted.refusal) {
    return refusal(persisted.refusal.decision_code, persisted.refusal.reasons);
  }
  if (!persisted.writeResult?.written) {

    const diagnostics = Array.isArray(persisted.writeResult?.diagnostics)
      ? persisted.writeResult.diagnostics.map((entry) => entry?.message ?? entry?.code ?? "invalid")
      : [];
    return refusal(CODES.missing, [
      "validated work-record write refused; no proof was persisted",
      ...diagnostics
    ]);
  }

  return {
    schema_version: "workspace-agent-slice-review-acceptance-result.v1",
    ok: true,
    decision_code: CODES.valid,
    reasons: [],
    record_id: unit.record_id,
    selected_unit: unit,
    canonical_review_unit_digest: sourceDigest,
    sidecar_path: persisted.sidecarRelativePath,
    sidecar_digest: persisted.sidecarDigest,
    proof: built.proof,
    ...sliceReviewAcceptanceAuthorityEffects()
  };
}

export async function resolveSliceReviewAcceptanceProof(options = {}) {
  if (!isObject(options)) {
    return refusal(CODES.malformed, ["operation input must be an object"]);
  }
  const forbidden = collectForbiddenCallerCarriedFields(options);
  if (forbidden.length > 0) {
    return refusal(CODES.untrustedProvenance, [
      `caller-carried proof/authority fields are not accepted: ${forbidden.join(", ")}`
    ]);
  }

  const {
    dir = ".",
    recordStore = null,
    unit_address: unitAddress = null,
    expectation = null
  } = options;

  if (!isObject(expectation)) {
    return refusal(CODES.bindingMismatch, [
      "expectation must be the launcher-owned slice-review binding tuple"
    ]);
  }

  if (!normalizeStringEntry(expectation.current_slice_sha)) {
    return refusal(CODES.bindingMismatch, [
      "expectation.current_slice_sha is required: the proof must be checked against the live slice tip"
    ]);
  }

  const context = await loadSliceUnitContext({ dir, unitAddress, recordStore });
  if (!context.ok) return context.result;
  const { unit, targetDir, loaded, sourceDigest } = context;

  let fullEvidence;
  try {
    fullEvidence = await readPersistedWorkerAdmissionEvidenceSidecar({
      dir: targetDir,
      record: loaded.record,
      selectedUnit: unit,
      sourceDigest
    });
  } catch (error) {
    if (error instanceof WorkerAdmissionSidecarError) {
      return refusal(CODES.malformed, [
        `persisted slice-review acceptance evidence is unreadable or tampered (${error.code})`
      ]);
    }
    throw error;
  }

  const persistedProof =
    fullEvidence?.normalized_request?.evidence?.[SLICE_REVIEW_ACCEPTANCE_EVIDENCE_KEY] ?? null;

  if (persistedProof === null && findAnyDerivedEvidenceEntryForUnit(loaded.record, unit) !== null) {
    return refusal(CODES.targetStale, [
      "the canonical review unit changed after the proof was minted; the review must be repeated against the current contract"
    ]);
  }
  const validation = validateSliceReviewAcceptanceProof(persistedProof, {
    ...expectation,
    unit_address: normalizeStringEntry(expectation.unit_address) ?? unit.address,
    canonical_review_unit_digest:
      normalizeStringEntry(expectation.canonical_review_unit_digest) ?? sourceDigest
  });
  if (!validation.valid) {
    return refusal(validation.decision_code, validation.reasons);
  }

  return {
    schema_version: "workspace-agent-slice-review-acceptance-result.v1",
    ok: true,
    decision_code: CODES.valid,
    reasons: [],
    record_id: unit.record_id,
    selected_unit: unit,
    canonical_review_unit_digest: sourceDigest,
    proof: cloneJson(persistedProof),
    ...sliceReviewAcceptanceAuthorityEffects()
  };
}

export async function resolveHistoricalSliceReviewAcceptanceProof(options = {}) {
  if (!isObject(options)) {
    return refusal(CODES.malformed, ["operation input must be an object"]);
  }
  const forbidden = collectForbiddenCallerCarriedFields(options);
  if (forbidden.length > 0) {
    return refusal(CODES.untrustedProvenance, [
      `caller-carried proof/authority fields are not accepted: ${forbidden.join(", ")}`
    ]);
  }
  const {
    dir = ".",
    recordStore = null,
    unit_address: unitAddress = null,
    expectation = null,
    historical_contract: historicalContract = null,
    review_result: reviewResult = null
  } = options;
  if (!isObject(expectation) || !normalizeStringEntry(expectation.current_slice_sha)) {
    return refusal(CODES.bindingMismatch, [
      "historical Proof A resolution requires the launcher-owned binding and current integrated target SHA"
    ]);
  }
  const structuredResultDigest = computeSliceReviewStructuredResultDigest(reviewResult);
  if (!structuredResultDigest) {
    return refusal(CODES.reviewNotAccepted, [
      "historical Proof A resolution requires the exact clean trusted structured review result"
    ]);
  }

  const context = await loadSliceUnitContext({ dir, unitAddress, recordStore });
  if (!context.ok) return context.result;
  const { unit, targetDir, loaded } = context;
  const historical = resolveHistoricalSliceReviewContract({
    historicalContract,
    unit,
    currentRecord: loaded.record
  });
  if (!historical.ok) return historical;

  let fullEvidence;
  try {
    fullEvidence = await readPersistedWorkerAdmissionEvidenceSidecar({
      dir: targetDir,
      record: loaded.record,
      selectedUnit: unit,
      sourceDigest: historical.sourceDigest
    });
  } catch (error) {
    if (error instanceof WorkerAdmissionSidecarError) {
      return refusal(CODES.malformed, [
        `persisted historical slice-review acceptance evidence is unreadable or tampered (${error.code})`
      ]);
    }
    throw error;
  }
  const persistedProof =
    fullEvidence?.normalized_request?.evidence?.[SLICE_REVIEW_ACCEPTANCE_EVIDENCE_KEY] ?? null;
  const validation = validateSliceReviewAcceptanceProof(persistedProof, {
    ...expectation,
    unit_address: unit.address,
    canonical_review_unit_digest: historical.sourceDigest,
    structured_result_digest: structuredResultDigest,
    review_outcome: reviewResult.review_outcome
  });
  if (!validation.valid) {
    return refusal(validation.decision_code, validation.reasons);
  }
  return {
    schema_version: "workspace-agent-slice-review-acceptance-result.v1",
    ok: true,
    decision_code: CODES.valid,
    reasons: [],
    record_id: unit.record_id,
    selected_unit: unit,
    canonical_review_unit_digest: historical.sourceDigest,
    proof: cloneJson(persistedProof),
    ...sliceReviewAcceptanceAuthorityEffects()
  };
}
