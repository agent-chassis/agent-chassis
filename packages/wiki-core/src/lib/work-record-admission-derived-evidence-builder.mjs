

import {
  cloneJson,
  computeNormalizedInputDigest,
  isNonEmptyString,
  isObject,
  normalizeStringEntry
} from "./work-record-admission-shared.mjs";
import {
  computeNormalizedRequestOutputHash,
  NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER,
  resolveDerivedEvidenceGeneratedAt
} from "./work-record-admission-derived-evidence-time.mjs";
import {
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION
} from "./work-record-admission-decision-codes.mjs";
import { normalizeDispatchReadiness } from "./work-record-admission-downstream.mjs";
import { createWorkRecordAdmissionEnvelope } from "./work-record-admission-envelope.mjs";
import {
  normalizeArtifactRefs,
  normalizePreparationAuditRefs
} from "./work-record-admission-evidence.mjs";
import {
  createWorkUnitFeatureVectorFromCanonicalRecord,
  WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION,
  WORK_UNIT_FEATURE_VECTOR_VOCABULARY_VERSION
} from "./work-record-feature-vector.mjs";
import { computeReviewedUnitSourceDigest } from "./work-record-review-attestation.mjs";
import { normalizeStructuralTargetMetrics } from "./work-record-target-metrics.mjs";
import { createNodeEngineCarrierFactsFromDispatchReadiness } from "./work-record-admission-derived-evidence-carrier-facts.mjs";
import {
  createBoundTargetResolutionEvidence,
  collectSelectedUnitLargeFileDecAuthority
} from "./work-record-admission-derived-evidence-target-resolution.mjs";

function normalizeDerivedEvidenceGenerator(value) {
  const generator = isObject(value) ? value : WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR;
  return {
    name: isNonEmptyString(generator.name)
      ? String(generator.name).trim()
      : WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR.name,
    version: isNonEmptyString(generator.version)
      ? String(generator.version).trim()
      : WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR.version
  };
}

function createDerivedEvidenceProvenance(requestProvenance = {}) {
  return {
    source_kind: "canonical_work_record",
    canonicality: "canonical",
    evidence_basis: "normalized_record_projection",
    policy_backend: isNonEmptyString(requestProvenance.policy_backend)
      ? String(requestProvenance.policy_backend).trim()
      : "portfolio-local",
    policy_version: isNonEmptyString(requestProvenance.policy_version)
      ? String(requestProvenance.policy_version).trim()
      : "worker-admission-policy.v1"
  };
}

function createDerivedEvidenceMetricSummary(metrics) {
  return cloneJson(metrics);
}

export function createWorkRecordAdmissionDerivedEvidence(options = {}) {
  const record = isObject(options.record) ? options.record : null;
  if (!record) {
    throw new Error("createWorkRecordAdmissionDerivedEvidence requires record");
  }
  const requestedSliceId = normalizeStringEntry(
    options.dispatch_readiness?.unit?.slice_id ??
      options.dispatchReadiness?.unit?.slice_id ??
      options.slice_id ??
      options.sliceId
  );
  const digestRecord = cloneJson(record);
  const sourceRecordDigest = computeReviewedUnitSourceDigest(
    requestedSliceId
      ? { record: digestRecord, selected_slice_id: requestedSliceId }
      : digestRecord
  );
  if (!sourceRecordDigest) {
    throw new Error(
      "createWorkRecordAdmissionDerivedEvidence: selected-unit reviewed digest cannot be resolved"
    );
  }

  const callerSchemaVersion = normalizeStringEntry(options.schema_version ?? options.schemaVersion);
  if (callerSchemaVersion && callerSchemaVersion !== WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(
      `createWorkRecordAdmissionDerivedEvidence: unsupported schema_version "${callerSchemaVersion}"; ` +
        `local entrypoint emits only ${WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION}`
    );
  }

  const rawDispatchReadiness = options.dispatch_readiness ?? options.dispatchReadiness;
  const dispatchReadiness = normalizeDispatchReadiness(rawDispatchReadiness);

  const resolvedRepo = normalizeStringEntry(record.repo ?? options.repo ?? options.repository) ?? null;
  const featureVector = createWorkUnitFeatureVectorFromCanonicalRecord(record, {
    repo: resolvedRepo,
    recordId: normalizeStringEntry(record.id) ?? dispatchReadiness.record_id ?? dispatchReadiness.unit?.record_id,
    sliceId: normalizeStringEntry(dispatchReadiness.unit?.slice_id ?? options.slice_id ?? options.sliceId),
    selectedSliceId: normalizeStringEntry(dispatchReadiness.unit?.slice_id ?? options.slice_id ?? options.sliceId)
  });

  featureVector.schema_version = WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION;
  featureVector.vocabulary_version = WORK_UNIT_FEATURE_VECTOR_VOCABULARY_VERSION;
  const suppliedStructuralTargetMetrics =
    options.structural_target_metrics ?? options.structuralTargetMetrics ?? null;
  const selectedSlice = requestedSliceId && Array.isArray(record.slices)
    ? record.slices.find((slice) => isObject(slice) && normalizeStringEntry(slice.id) === requestedSliceId) ?? null
    : null;
  const effectiveTargetSource = selectedSlice && Array.isArray(selectedSlice.expected_edit_targets)
    ? selectedSlice
    : record;
  const derivedStructuralTargetMetrics = suppliedStructuralTargetMetrics
    ? suppliedStructuralTargetMetrics
    : normalizeStructuralTargetMetrics({
        expected_edit_targets: Array.isArray(effectiveTargetSource.expected_edit_targets)
          ? effectiveTargetSource.expected_edit_targets
          : undefined,
        target_resolution_evidence: isObject(effectiveTargetSource.target_resolution_evidence)
          ? effectiveTargetSource.target_resolution_evidence
          : undefined,
        write_scope: Array.isArray(effectiveTargetSource.write_scope) ? effectiveTargetSource.write_scope : []
      });

  const selectedUnitLargeFileDecAuthority = collectSelectedUnitLargeFileDecAuthority(
    record,
    dispatchReadiness
  );

  const envelope = createWorkRecordAdmissionEnvelope({
    ...options,
    repo: resolvedRepo,
    feature_vector: featureVector,
    structural_target_metrics: derivedStructuralTargetMetrics,
    dispatch_readiness: dispatchReadiness,
    graph_impact: options.graph_impact ?? options.graphImpact,
    ...(selectedUnitLargeFileDecAuthority.length > 0
      ? { large_file_dec_authority: selectedUnitLargeFileDecAuthority }
      : {})
  });
  const request = envelope.components.work_unit_atomicity.request;
  const normalizedRequest = cloneJson(request);

  if (isObject(normalizedRequest.subject)) {
    normalizedRequest.subject.repo = resolvedRepo;
  }
  if (isObject(normalizedRequest.evidence?.source_inputs?.subject)) {
    normalizedRequest.evidence.source_inputs.subject.repo = resolvedRepo;
  }
  const metricSummary = createDerivedEvidenceMetricSummary(envelope.metrics.work_unit_atomicity);
  const nodeEngineCarrierFacts = createNodeEngineCarrierFactsFromDispatchReadiness(
    rawDispatchReadiness,
    dispatchReadiness
  );
  const targetResolutionEvidence = createBoundTargetResolutionEvidence(metricSummary.structural_target_metrics, {
    selectedUnit: dispatchReadiness.unit,
    sourceRecordDigest
  });
  normalizedRequest.feature_vector = featureVector;
  normalizedRequest.evidence.feature_vector = featureVector;
  if (targetResolutionEvidence) {
    normalizedRequest.evidence.target_resolution_evidence = targetResolutionEvidence;
  }
  if (nodeEngineCarrierFacts) {
    normalizedRequest.evidence.node_engine_carrier_facts = nodeEngineCarrierFacts;
  }
  metricSummary.feature_vector = featureVector;
  if (nodeEngineCarrierFacts) {
    metricSummary.node_engine_carrier_facts = cloneJson(nodeEngineCarrierFacts);
  }
  if (targetResolutionEvidence) {
    metricSummary.target_resolution_evidence = cloneJson(targetResolutionEvidence);
  }
  const requestProvenance = request?.evidence?.metric_source_provenance ?? {};
  const generator = normalizeDerivedEvidenceGenerator(options.generator ?? options.generatorMetadata);

  const resolvedRecordId = isNonEmptyString(record.id)
    ? String(record.id).trim()
    : isNonEmptyString(envelope.unit?.record_id)
      ? String(envelope.unit.record_id).trim()
      : null;
  if (!resolvedRecordId) {
    throw new Error(
      "createWorkRecordAdmissionDerivedEvidence: record identity cannot be resolved; record.id and envelope.unit.record_id are both absent"
    );
  }
  const recordPath = `wiki/work-records/${resolvedRecordId}.json`;

  const generatedAt = resolveDerivedEvidenceGeneratedAt(
    options.generated_at ?? options.generatedAt ?? options.now,
    { clock: options.clock }
  );
  const generatorDigest = computeNormalizedInputDigest({
    name: generator.name,
    version: generator.version,
    module: "work-record-admission-derived-evidence.mjs"
  });

  normalizedRequest.artifact_refs = Array.isArray(options.artifact_refs)
    ? normalizeArtifactRefs(options.artifact_refs)
    : [
        {
          ref_id: "artifact-work-unit-record",
          artifact_role: "work_unit_record",
          ref_kind: "wiki_record",
          ref: recordPath,
          digest: sourceRecordDigest,
          observed_at: generatedAt,
          produced_by_preparation_audit_id: "not_applicable",
          produced_by_preparation_output_hash: "not_applicable"
        },
        {
          ref_id: "artifact-work-unit-derived-evidence",
          artifact_role: "work_unit_derived_evidence",
          ref_kind: "wiki_record",
          ref: recordPath,
          digest: "not_applicable",
          observed_at: generatedAt,
          produced_by_preparation_audit_id: "audit-portfolio-feature-vector",
          produced_by_preparation_output_hash: NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER
        }
      ];

  normalizedRequest.preparation_audit_refs = Array.isArray(options.preparation_audit_refs)
    ? normalizePreparationAuditRefs(options.preparation_audit_refs)
    : [
        {
          audit_id: "audit-portfolio-feature-vector",
          ref: "agent-chassis:packages/wiki-core/src/lib/work-record-admission-derived-evidence.mjs",
          digest: generatorDigest,
          actor_kind: "consumer-wrapper",
          output_hash: NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER,
          prepared_artifact_ref_ids: ["artifact-work-unit-derived-evidence"]
        }
      ];

  const derivedRequestOutputHash = computeNormalizedRequestOutputHash(normalizedRequest);
  for (const ref of normalizedRequest.artifact_refs) {
    if (ref.produced_by_preparation_output_hash === NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER) {
      ref.produced_by_preparation_output_hash = derivedRequestOutputHash;
    }
  }
  for (const auditRef of normalizedRequest.preparation_audit_refs) {
    if (auditRef.output_hash === NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER) {
      auditRef.output_hash = derivedRequestOutputHash;
    }
  }

  return {
    schema_version: WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION,
    record_id: resolvedRecordId,
    unit: cloneJson(envelope.unit),
    source_record_digest: sourceRecordDigest,
    generator,
    generated_at: generatedAt,
    decision_kind: WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
    normalized_request: normalizedRequest,
    metric_summary: metricSummary,
    ...(targetResolutionEvidence ? { target_resolution_evidence: targetResolutionEvidence } : {}),
    provenance: createDerivedEvidenceProvenance(requestProvenance)
  };
}
