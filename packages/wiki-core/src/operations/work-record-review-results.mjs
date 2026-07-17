

import path from "node:path";

import {
  buildReviewResultEvidence,
  projectReviewResultEvidenceForWorkerAdmission,
  REVIEW_RESULT_EVIDENCE_AUTHORITY,
  reviewResultEvidenceAuthorityEffects,
  validateReviewResultEvidence
} from "../lib/work-record-review-results.mjs";
import { computeReviewedUnitSourceDigest } from "../lib/work-record-review-attestation.mjs";
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
  readPersistedWorkerAdmissionEvidenceSidecar
} from "../lib/work-record-admission-evidence-sidecar.mjs";
import {
  computeWorkRecordPersistenceSnapshotDigest,
  digestWorkRecord,
  readWorkRecordById,
  writeValidatedWorkRecordWithAdmissionSidecars
} from "./work-records-store-io.mjs";
import {
  materializeWorkRecordAdmissionDerivedEvidence,
  upsertWorkerAdmissionDerivedEvidenceEntries
} from "./work-records-admission-evidence.mjs";
import { parseDispatchUnitAddress } from "./work-records-shared.mjs";

export const WORKSPACE_RECORD_REVIEW_RESULT_EVIDENCE_TOOL_NAME =
  "workspace_record_review_result_evidence";
export const RECORD_REVIEW_RESULT_EVIDENCE_DECISION_CODE =
  "review_result_evidence.recorded.v1";

const FORBIDDEN_OPERATION_INPUT_FIELDS = new Set([
  "accepted_authorities",
  "authority",
  "argv",
  "claimed_identity",
  "classification",
  "dispatch_readiness",
  "env",
  "environment",
  "evidence_id",
  "final_result",
  "final_result_body",
  "final_response_text",
  "identity",
  "outcome",
  "policy",
  "prompt",
  "prose",
  "raw_final_result",
  "raw_request",
  "request",
  "request_payload",
  "review_attestations",
  "review_completion",
  "review_outcome",
  "review_result",
  "shell_output",
  "source_digest",
  "status",
  "structured_role_result_source",
  "terminal_status"
]);

function trimmed(value) {
  return normalizeStringEntry(value);
}

function todayDateString(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function refusal(decisionCode, reasons, extra = {}) {
  return {
    tool: WORKSPACE_RECORD_REVIEW_RESULT_EVIDENCE_TOOL_NAME,
    recorded: false,
    decision_code: decisionCode,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
    authority: REVIEW_RESULT_EVIDENCE_AUTHORITY,
    evidence_only: true,
    ...reviewResultEvidenceAuthorityEffects(),
    ...projectReviewResultEvidenceForWorkerAdmission(),
    ...extra
  };
}

function createInvalidResult({ recordId = null, diagnostics = [], decisionCode = "invalid_record" } = {}) {
  return {
    ...refusal(decisionCode, diagnostics.map((entry) => entry.message ?? entry.code ?? "invalid input")),
    record_id: recordId,
    valid: false,
    written: false,
    diagnostics,
    source_digest: null,
    current_source_digest: null,
    expected_source_digest: null,
    selected_unit: null,
    evidence: null
  };
}

function collectForbiddenOperationInputFields(args) {
  if (!isObject(args)) return [];
  return Object.keys(args)
    .filter((key) => FORBIDDEN_OPERATION_INPUT_FIELDS.has(key))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeExpectedSourceDigest(args) {
  if (!isObject(args)) return null;
  return args.expectedSourceDigest ?? args.expected_source_digest ?? null;
}

function parseUnitAddress(value) {
  const parsed = parseDispatchUnitAddress(value);
  return parsed.ok ? parsed.unit : null;
}

function normalizeRequestedUnit(args) {
  const unitAddress = args.unitAddress ?? args.unit_address ?? args.unit ?? args.id;
  const parsed = parseDispatchUnitAddress(unitAddress);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: [
        {
          code: parsed.error.code,
          severity: "error",
          message: parsed.error.message,
          path: parsed.error.path
        }
      ]
    };
  }
  return parsed;
}

function normalizeReviewUnit(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return parseUnitAddress(value);
  }
  if (!isObject(value)) return null;
  const address = trimmed(value.address ?? value.unit ?? value.unit_address);
  if (!address) return null;
  return parseUnitAddress(address);
}

function recordHasSlice(record, sliceId) {
  return Array.isArray(record?.slices) && record.slices.some((slice) => slice?.id === sliceId);
}

function getLoadedWorkRecordUnit(record, unit) {
  if (!isObject(record) || !isObject(unit)) return null;
  if (unit.kind === "work_item") return record;
  if (!Array.isArray(record.slices)) return null;
  return record.slices.find((slice) => slice?.id === unit.slice_id) ?? null;
}

function unitReferenceCandidates(unit) {
  if (unit.kind === "slice") {
    return new Set([unit.address, `${unit.record_id}#${unit.slice_id}`]);
  }
  return new Set([unit.address, unit.record_id]);
}

function unitRecordReferencesUnit(unitRecord, targetUnit) {
  if (!isObject(unitRecord) || !isObject(targetUnit)) return false;
  const targetRefs = unitReferenceCandidates(targetUnit);
  for (const fieldName of ["depends_on", "related", "blocks"]) {
    const values = Array.isArray(unitRecord[fieldName]) ? unitRecord[fieldName] : [];
    for (const value of values) {
      const ref = trimmed(value);
      if (ref && targetRefs.has(ref)) return true;
    }
  }
  return false;
}

function unitsHaveDurableRelationship(leftRecord, leftUnit, rightRecord, rightUnit) {
  return unitRecordReferencesUnit(leftRecord, rightUnit) ||
    unitRecordReferencesUnit(rightRecord, leftUnit);
}

function buildEvidenceOnlyMaterializationDispatchReadiness(unit) {
  return {
    schema_version: "dispatch-readiness.v1",
    record_id: unit.record_id,
    unit,
    decision_code: "review_result_evidence.record_time_materialization.v1",
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
      "non-completion review-result evidence is coordination-only and does not assert dispatch readiness"
    ],
    accepted_escalations: [],
    blast_radius: {
      level: "low",
      reasons: [],
      accepted_escalation_id: null
    }
  };
}

async function createFullEvidenceForReviewResult({ dir, record, unit, sourceDigest }) {
  const priorFullEvidence = await readPersistedWorkerAdmissionEvidenceSidecar({
    dir,
    record,
    selectedUnit: unit,
    sourceDigest
  });
  if (priorFullEvidence) return priorFullEvidence;
  return materializeWorkRecordAdmissionDerivedEvidence({
    record,
    repo: record.repo,
    dispatch_readiness: buildEvidenceOnlyMaterializationDispatchReadiness(unit)
  });
}

function refreshNormalizedRequestOutputHashes(normalizedRequest) {
  if (!isObject(normalizedRequest)) return;
  const outputHash = computeNormalizedRequestOutputHash(normalizedRequest);
  if (Array.isArray(normalizedRequest.artifact_refs)) {
    for (const ref of normalizedRequest.artifact_refs) {
      if (
        isObject(ref) &&
        trimmed(ref.produced_by_preparation_output_hash) &&
        ref.produced_by_preparation_output_hash !== "not_applicable"
      ) {
        ref.produced_by_preparation_output_hash = outputHash;
      }
    }
  }
  if (Array.isArray(normalizedRequest.preparation_audit_refs)) {
    for (const ref of normalizedRequest.preparation_audit_refs) {
      if (isObject(ref) && trimmed(ref.output_hash)) {
        ref.output_hash = outputHash;
      }
    }
  }
}

function upsertReviewResultEvidence(fullEvidence, evidence) {
  const updated = cloneJson(fullEvidence);
  if (!isObject(updated.normalized_request)) {
    throw new Error("review-result evidence operation could not materialize full worker-admission evidence");
  }
  if (!isObject(updated.normalized_request.evidence)) {
    updated.normalized_request.evidence = {};
  }
  const current = Array.isArray(updated.normalized_request.evidence.review_result_evidence)
    ? updated.normalized_request.evidence.review_result_evidence
    : [];
  updated.normalized_request.evidence.review_result_evidence = [
    ...current.filter((entry) => entry?.evidence_id !== evidence.evidence_id),
    cloneJson(evidence)
  ];
  refreshNormalizedRequestOutputHashes(updated.normalized_request);
  return updated;
}

async function persistReviewResultEvidence({
  dir,
  loaded,
  unit,
  sourceDigest,
  recordSourceDigest,
  evidence,
  recordStore
}) {
  const persistenceSnapshotDigest = computeWorkRecordPersistenceSnapshotDigest(loaded.record);
  const updatedRecord = cloneJson(loaded.record);
  const fullEvidence = await createFullEvidenceForReviewResult({
    dir,
    record: updatedRecord,
    unit,
    sourceDigest
  });
  const fullEvidenceWithReviewResult = upsertReviewResultEvidence(fullEvidence, evidence);
  const admissionSummary = createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary(
    evaluateWorkRecordAdmissionDerivedEvidence(fullEvidenceWithReviewResult)
  );
  const sidecarPublication =
    prepareWorkRecordAdmissionDerivedEvidenceSidecar(fullEvidenceWithReviewResult);
  const sidecarRelativePath = sidecarPublication.relativePath;
  const sidecarDigest = sidecarPublication.digest;
  const compactEntry = createPersistedWorkerAdmissionDerivedEvidence(fullEvidenceWithReviewResult, {
    sidecarPath: sidecarRelativePath,
    sidecarDigest,
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
    fullEvidence: fullEvidenceWithReviewResult,
    compactEntry,
    sidecarRelativePath,
    sidecarDigest
  };
}

function buildReviewResultEvidenceId({ repo, unit, reviewRun, sourceDigest }) {
  return `rr:${computeNormalizedInputDigest({
    repo,
    unit: unit.address,
    run_id: reviewRun.run_id ?? null,
    monitor_handle: reviewRun.monitor_handle ?? null,
    source_digest: sourceDigest
  }).slice("sha256:".length)}`;
}

async function validateSeparateReviewUnit({ dir, loadedTarget, targetUnit, reviewUnit, recordStore }) {
  if (!reviewUnit) return { ok: true, reviewUnit: null };
  if (reviewUnit.address === targetUnit.address) {
    return {
      ok: false,
      decision_code: "review_result_evidence.wrong_unit.v1",
      reasons: ["review_unit must be separate from the selected unit"]
    };
  }
  const loadedReview = await readWorkRecordById({
    dir,
    id: reviewUnit.record_id,
    recordStore
  });
  if (!loadedReview?.record || loadedReview.valid !== true) {
    return {
      ok: false,
      decision_code: "review_result_evidence.wrong_unit.v1",
      reasons: ["review_unit is not a valid canonical work record unit"]
    };
  }
  if (reviewUnit.kind === "slice" && !recordHasSlice(loadedReview.record, reviewUnit.slice_id)) {
    return {
      ok: false,
      decision_code: "review_result_evidence.wrong_unit.v1",
      reasons: [`slice ${reviewUnit.slice_id} is not present in ${reviewUnit.record_id}`]
    };
  }
  const reviewUnitRecord = getLoadedWorkRecordUnit(loadedReview.record, reviewUnit);
  const targetUnitRecord = getLoadedWorkRecordUnit(loadedTarget.record, targetUnit);
  if (!reviewUnitRecord || !targetUnitRecord) {
    return {
      ok: false,
      decision_code: "review_result_evidence.wrong_unit.v1",
      reasons: ["selected target or review unit could not be materialized"]
    };
  }
  const reviewUnitWorkKind = trimmed(reviewUnitRecord.work_kind);
  if (!["review", "redteam"].includes(reviewUnitWorkKind)) {
    return {
      ok: false,
      decision_code: "review_result_evidence.wrong_role.v1",
      reasons: ["review_unit must be a findings-only reviewer/redteam unit"]
    };
  }
  if (!Array.isArray(reviewUnitRecord.write_scope) || reviewUnitRecord.write_scope.length !== 0) {
    return {
      ok: false,
      decision_code: "review_result_evidence.wrong_role.v1",
      reasons: ["review_unit must have an empty write_scope"]
    };
  }
  if (!unitsHaveDurableRelationship(reviewUnitRecord, reviewUnit, targetUnitRecord, targetUnit)) {
    return {
      ok: false,
      decision_code: "review_result_evidence.wrong_unit.v1",
      reasons: ["review_unit does not have a durable relationship to the selected unit"]
    };
  }
  return { ok: true, reviewUnit };
}

export async function recordWorkRecordReviewResultEvidence(options = {}) {
  if (!isObject(options)) {
    return createInvalidResult({
      decisionCode: "review_result_evidence.malformed.v1",
      diagnostics: [
        {
          code: "invalid_input",
          severity: "error",
          message: "operation input must be an object",
          path: null
        }
      ]
    });
  }

  const {
    dir = ".",
    recordStore = null,
    now = new Date(),
    ...args
  } = options;

  const forbiddenFields = collectForbiddenOperationInputFields(args);
  if (forbiddenFields.length > 0) {
    return createInvalidResult({
      decisionCode: "review_result_evidence.forbidden_authority_input.v1",
      diagnostics: [
        {
          code: "forbidden_authority_input",
          severity: "error",
          message: `caller-supplied authority/prose fields are not accepted: ${forbiddenFields.join(", ")}`,
          path: null
        }
      ]
    });
  }

  const requestedUnit = normalizeRequestedUnit(args);
  if (!requestedUnit.ok) {
    return createInvalidResult({
      diagnostics: requestedUnit.diagnostics,
      decisionCode: "review_result_evidence.wrong_unit.v1"
    });
  }
  const unit = requestedUnit.unit;
  const targetDir = path.resolve(String(dir));
  const expectedSourceDigest = normalizeExpectedSourceDigest(args);
  const loaded = await readWorkRecordById({
    dir: targetDir,
    id: requestedUnit.recordId,
    recordStore
  });
  if (!loaded?.record) {
    return {
      ...loaded,
      ...refusal("review_result_evidence.wrong_unit.v1", [
        `could not load canonical work record ${requestedUnit.recordId}`
      ]),
      selected_unit: unit,
      written: false,
      evidence: null
    };
  }
  if (unit.kind === "slice" && !recordHasSlice(loaded.record, unit.slice_id)) {
    return {
      ...loaded,
      ...refusal("review_result_evidence.wrong_unit.v1", [
        `slice ${unit.slice_id} is not present in ${unit.record_id}`
      ]),
      selected_unit: unit,
      written: false,
      evidence: null
    };
  }

  const canonicalRecordRepo = trimmed(loaded.record.repo);
  const recordSourceDigest = trimmed(loaded.source_digest) ?? digestWorkRecord(loaded.record);
  const sourceDigest = trimmed(computeReviewedUnitSourceDigest(
    unit.kind === "slice"
      ? { record: cloneJson(loaded.record), selected_slice_id: unit.slice_id }
      : cloneJson(loaded.record)
  ));
  if (!canonicalRecordRepo || !recordSourceDigest || !sourceDigest) {
    return {
      ...loaded,
      ...refusal("review_result_evidence.malformed.v1", [
        "canonical repo or source_digest could not be resolved"
      ]),
      selected_unit: unit,
      written: false,
      evidence: null
    };
  }
  if (expectedSourceDigest !== null && expectedSourceDigest !== undefined) {
    if (typeof expectedSourceDigest !== "string" || expectedSourceDigest.trim().length === 0) {
      return {
        ...loaded,
        ...refusal("review_result_evidence.malformed.v1", [
          "expected_source_digest must be a non-empty string"
        ]),
        selected_unit: unit,
        valid: false,
        written: false,
        source_digest: sourceDigest,
        expected_source_digest: expectedSourceDigest,
        current_source_digest: null,
        evidence: null
      };
    }
    if (expectedSourceDigest !== recordSourceDigest) {
      return {
        ...loaded,
        ...refusal("review_result_evidence.stale_source_digest.v1", [
          "expected_source_digest does not match the current canonical unit source_digest"
        ]),
        selected_unit: unit,
        valid: false,
        written: false,
        source_digest: sourceDigest,
        expected_source_digest: expectedSourceDigest,
        current_source_digest: recordSourceDigest,
        evidence: null
      };
    }
  }

  const reviewRun = isObject(args.review_run) ? cloneJson(args.review_run) : null;
  if (!reviewRun) {
    return {
      ...loaded,
      ...refusal("review_result_evidence.untrusted_provenance.v1", [
        "review_run must be trusted structured run metadata"
      ]),
      selected_unit: unit,
      written: false,
      evidence: null
    };
  }
  if (!trimmed(reviewRun.provenance_kind)) {
    return {
      ...loaded,
      ...refusal("review_result_evidence.untrusted_provenance.v1", [
        "review_run provenance_kind must be supplied by trusted route metadata"
      ]),
      selected_unit: unit,
      written: false,
      evidence: null
    };
  }

  const reviewUnit = normalizeReviewUnit(args.review_unit);
  if (args.review_unit !== undefined && args.review_unit !== null && !reviewUnit) {
    return {
      ...loaded,
      ...refusal("review_result_evidence.wrong_unit.v1", [
        "review_unit must be a canonical work-record unit address"
      ]),
      selected_unit: unit,
      written: false,
      evidence: null
    };
  }
  const validatedReviewUnit = await validateSeparateReviewUnit({
    dir: targetDir,
    loadedTarget: loaded,
    targetUnit: unit,
    reviewUnit,
    recordStore
  });
  if (!validatedReviewUnit.ok) {
    return {
      ...loaded,
      ...refusal(validatedReviewUnit.decision_code, validatedReviewUnit.reasons),
      selected_unit: unit,
      written: false,
      evidence: null
    };
  }

  const evidenceId = buildReviewResultEvidenceId({
    repo: canonicalRecordRepo,
    unit,
    reviewRun,
    sourceDigest
  });
  const built = buildReviewResultEvidence({
    evidence_id: evidenceId,
    repo: canonicalRecordRepo,
    unit,
    source_digest: sourceDigest,
    recorded_at: trimmed(args.recorded_at) ?? now.toISOString(),
    review_run: reviewRun,
    ...(validatedReviewUnit.reviewUnit ? { review_unit: validatedReviewUnit.reviewUnit } : {}),
    ...(args.structured_role_result !== undefined
      ? { structured_role_result: args.structured_role_result }
      : {})
  });
  if (!built.ok) {
    return {
      ...loaded,
      ...refusal(built.decision_code, built.reasons),
      selected_unit: unit,
      source_digest: sourceDigest,
      written: false,
      evidence: null
    };
  }

  const validation = validateReviewResultEvidence(built.evidence, {
    repo: canonicalRecordRepo,
    unit_address: unit.address,
    source_digest: sourceDigest,
    required_role_class: trimmed(args.required_role_class)
  });
  if (!validation.valid) {
    return {
      ...loaded,
      ...refusal(validation.decision_code, validation.reasons),
      selected_unit: unit,
      source_digest: sourceDigest,
      written: false,
      evidence: built.evidence
    };
  }

  const persisted = await persistReviewResultEvidence({
    dir: targetDir,
    loaded,
    unit,
    sourceDigest,
    recordSourceDigest,
    evidence: built.evidence,
    recordStore
  });
  const writeResult = persisted.writeResult;
  if (!writeResult?.written) {
    return {
      ...loaded,
      ...writeResult,
      ...refusal("review_result_evidence.persist_failed.v1", [
        "validated work-record write refused"
      ]),
      selected_unit: unit,
      source_digest: sourceDigest,
      current_source_digest: writeResult?.current_source_digest ?? null,
      expected_source_digest: expectedSourceDigest ?? null,
      written: false,
      evidence: built.evidence
    };
  }

  return {
    ...loaded,
    ...writeResult,
    tool: WORKSPACE_RECORD_REVIEW_RESULT_EVIDENCE_TOOL_NAME,
    recorded: true,
    evidence_only: true,
    authority: REVIEW_RESULT_EVIDENCE_AUTHORITY,
    decision_code: RECORD_REVIEW_RESULT_EVIDENCE_DECISION_CODE,
    reasons: [],
    valid: writeResult.valid,
    written: true,
    record_id: loaded.record.id,
    repo: canonicalRecordRepo,
    selected_unit: unit,
    source_digest: sourceDigest,
    current_source_digest: writeResult.current_source_digest ?? null,
    expected_source_digest: expectedSourceDigest ?? null,
    evidence_id: built.evidence.evidence_id,
    evidence_digest: built.evidence.evidence_digest,
    evidence_class: built.evidence.evidence_class,
    reviewer_role_class: built.evidence.reviewer_role_class,
    recorded_at: built.evidence.recorded_at,
    updated: todayDateString(now),
    evidence: {
      persisted: true,
      sidecar_path: persisted.sidecarRelativePath,
      sidecar_digest: persisted.sidecarDigest
    },
    ...reviewResultEvidenceAuthorityEffects(),
    ...projectReviewResultEvidenceForWorkerAdmission()
  };
}

export const recordWorkRecordReviewResultEvidenceByUnit =
  recordWorkRecordReviewResultEvidence;
