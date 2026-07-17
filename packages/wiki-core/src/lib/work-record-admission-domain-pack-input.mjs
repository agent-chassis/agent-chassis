

import {
  cloneJson,
  isNonEmptyString,
  isObject,
  normalizeStringEntry
} from "./work-record-admission-shared.mjs";
import {
  computeNormalizedRequestOutputHash,
  systemUtcClock
} from "./work-record-admission-derived-evidence-time.mjs";
import {
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
  WORK_RECORD_ADMISSION_LOCAL_AUTHORITY
} from "./work-record-admission-decision-codes.mjs";
import { carryReviewAttestations } from "./review-attestation-pack-carry.mjs";
import { createWorkRecordAdmissionDerivedEvidence } from "./work-record-admission-derived-evidence-builder.mjs";
import { createWorkRecordAdmissionRecordLocalInputs } from "./work-record-admission-record-inputs.mjs";
import { computeReviewedUnitSourceDigest } from "./work-record-review-attestation.mjs";
import { loadOrgPolicyProfile } from "./org-policy-profile-loader.mjs";
import {
  attachPersistedReviewAttestations,
  readPersistedWorkerAdmissionEvidenceSidecar
} from "./work-record-admission-evidence-sidecar.mjs";

export const WORKER_ADMISSION_DOMAIN_PACK_INPUT_SCHEMA_VERSION =
  "worker-admission-domain-pack-input.v1";

export const WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS = Object.freeze({
  pack_id: "worker_admission_v1",
  operation_id: "evaluate_work_unit_dispatch",
  operation_version: "v1",
  decision_kind: "work_unit_atomicity",
  route_family: "validate"
});

export const NODE_ENGINE_UNRATIFIED_PLACEHOLDER = "node_engine_unratified_placeholder";

const BOUNDED_EXTRACTION_REFACTOR_INTENT_SCHEMA_VERSION =
  "bounded-large-file-extraction-refactor-intent.v1";
const BOUNDED_EXTRACTION_REFACTOR_CHANGED_LINE_BUDGET_MAX = 200;

function normalizeBoundedExtractionIntentCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeBoundedLargeFileExtractionRefactorIntent(value) {
  if (!isObject(value)) {
    return null;
  }

  const schemaVersion = normalizeStringEntry(value.schema_version ?? value.schemaVersion);
  const intentKind = normalizeStringEntry(value.intent_kind ?? value.intentKind);
  const evidenceBasis = normalizeStringEntry(value.evidence_basis ?? value.evidenceBasis);
  const expectedChangedLineBudget = normalizeBoundedExtractionIntentCount(
    value.expected_changed_line_budget ?? value.expectedChangedLineBudget
  );
  const operationCounts = isObject(value.operation_counts ?? value.operationCounts)
    ? value.operation_counts ?? value.operationCounts
    : null;
  const source = isObject(value.source) ? value.source : null;
  const destinations = isObject(value.destinations) ? value.destinations : null;
  const validationCoverage = isObject(value.validation_coverage ?? value.validationCoverage)
    ? value.validation_coverage ?? value.validationCoverage
    : null;
  const createCount = normalizeBoundedExtractionIntentCount(operationCounts?.create);
  const modifyCount = normalizeBoundedExtractionIntentCount(operationCounts?.modify);
  const deleteCount = normalizeBoundedExtractionIntentCount(operationCounts?.delete);
  const inspectCount = normalizeBoundedExtractionIntentCount(operationCounts?.inspect);
  const sourceTargetCount = normalizeBoundedExtractionIntentCount(
    source?.existing_oversized_threshold_counted_target_count ??
      source?.existingOversizedThresholdCountedTargetCount
  );
  const destinationTargetCount = normalizeBoundedExtractionIntentCount(
    destinations?.verifiable_new_target_count ?? destinations?.verifiableNewTargetCount
  );
  const sourceOperation = normalizeStringEntry(source?.operation);
  const destinationOperation = normalizeStringEntry(destinations?.operation);

  if (
    schemaVersion !== BOUNDED_EXTRACTION_REFACTOR_INTENT_SCHEMA_VERSION ||
    intentKind !== "bounded_large_file_extraction_refactor" ||
    evidenceBasis !== "structured_work_record_facts" ||
    expectedChangedLineBudget === null ||
    expectedChangedLineBudget > BOUNDED_EXTRACTION_REFACTOR_CHANGED_LINE_BUDGET_MAX ||
    createCount === null ||
    createCount < 1 ||
    modifyCount !== 1 ||
    deleteCount !== 0 ||
    inspectCount !== 0 ||
    sourceTargetCount !== 1 ||
    destinationTargetCount === null ||
    destinationTargetCount < 1 ||
    sourceOperation !== "modify" ||
    destinationOperation !== "create" ||
    validationCoverage?.source_target_covered !== true ||
    validationCoverage?.destination_targets_covered !== true
  ) {
    return null;
  }

  return {
    schema_version: schemaVersion,
    intent_kind: intentKind,
    evidence_basis: evidenceBasis,
    expected_changed_line_budget: expectedChangedLineBudget,
    operation_counts: {
      create: createCount,
      modify: modifyCount,
      delete: deleteCount,
      inspect: inspectCount
    },
    source: {
      existing_oversized_threshold_counted_target_count: sourceTargetCount,
      operation: sourceOperation
    },
    destinations: {
      verifiable_new_target_count: destinationTargetCount,
      operation: destinationOperation
    },
    validation_coverage: {
      source_target_covered: true,
      destination_targets_covered: true
    }
  };
}

export function createWorkerAdmissionDomainPackInput(options = {}) {
  const suppliedEvidence = options.derived_evidence ?? options.derivedEvidence;
  const suppliedNormalizedRequest = options.normalized_request ?? options.normalizedRequest;
  let derivedEvidence;
  if (isObject(suppliedEvidence)) {
    derivedEvidence = suppliedEvidence;
  } else if (isObject(suppliedNormalizedRequest)) {
    derivedEvidence = {
      record_id: normalizeStringEntry(options.record_id ?? options.recordId) ?? null,
      unit: cloneJson(options.unit ?? null),
      source_record_digest: normalizeStringEntry(options.source_record_digest ?? options.sourceRecordDigest) ?? null,
      generated_at: options.generated_at ?? options.generatedAt ?? null,
      normalized_request: cloneJson(suppliedNormalizedRequest)
    };
  } else {
    derivedEvidence = createWorkRecordAdmissionDerivedEvidence(options);
  }
  const normalizedRequest = derivedEvidence.normalized_request;
  if (!isObject(normalizedRequest)) {
    throw new Error(
      "createWorkerAdmissionDomainPackInput requires derived evidence carrying a normalized_request (full inline shape)"
    );
  }

  const featureVector = cloneJson(normalizedRequest.feature_vector ?? null);
  const derivedMetrics = cloneJson(featureVector?.derived_metrics ?? null);
  const degradations = cloneJson(featureVector?.degradations ?? []);
  const artifactRefs = cloneJson(normalizedRequest.artifact_refs ?? []);
  const preparationAuditRefs = cloneJson(normalizedRequest.preparation_audit_refs ?? []);

  const reviewAttestationBinding = isObject(options.review_attestation_binding)
    ? options.review_attestation_binding
    : {};
  const reviewAttestations = carryReviewAttestations(normalizedRequest?.evidence?.review_attestations, {
    repo: normalizedRequest?.subject?.repo,
    unit_address: normalizedRequest?.subject?.unit?.address,
    source_digest: derivedEvidence.source_record_digest,
    now: options.now ?? reviewAttestationBinding.now,
    required_role_class: reviewAttestationBinding.required_role_class,
    required_controls: reviewAttestationBinding.required_controls,

    control_role_requirements: reviewAttestationBinding.control_role_requirements,
    admitting_run_id: reviewAttestationBinding.admitting_run_id
  });

  const orgPolicyProfile =
    options.org_policy_profile ??
    (isObject(options.options) ? options.options.org_policy_profile : undefined) ??
    null;
  const boundedLargeFileExtractionRefactorIntent = normalizeBoundedLargeFileExtractionRefactorIntent(
    options.bounded_large_file_extraction_refactor_intent ??
      options.boundedLargeFileExtractionRefactorIntent ??
      normalizedRequest.evidence?.bounded_large_file_extraction_refactor_intent ??
      normalizedRequest.evidence?.boundedLargeFileExtractionRefactorIntent ??
      normalizedRequest.bounded_large_file_extraction_refactor_intent ??
      normalizedRequest.boundedLargeFileExtractionRefactorIntent
  );
  const normalizedPortfolioFacts = {
    schema_version: normalizedRequest.schema_version ?? null,
    decision_kind:
      normalizedRequest.decision_kind ?? WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
    subject: cloneJson(normalizedRequest.subject ?? null),
    context: cloneJson(normalizedRequest.context ?? null),
    policy_profile: cloneJson(normalizedRequest.policy_profile ?? null),
    org_policy_profile: orgPolicyProfile,
    work_unit_metrics: cloneJson(normalizedRequest.work_unit_metrics ?? null),
    file_stats: cloneJson(normalizedRequest.file_stats ?? []),
    structural_target_metrics: cloneJson(normalizedRequest.structural_target_metrics ?? null),
    metric_source_provenance: cloneJson(normalizedRequest.evidence?.metric_source_provenance ?? null),
    contradictions: cloneJson(normalizedRequest.evidence?.contradictions ?? []),
    ...(boundedLargeFileExtractionRefactorIntent
      ? { bounded_large_file_extraction_refactor_intent: boundedLargeFileExtractionRefactorIntent }
      : {})
  };

  const nodeEngineBinding = {
    ...WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS,
    binding_kind: "design_contract_planning_identifier",
    binding_source_records: ["node-engine:WK-0354", "node-engine:WK-0359"],
    http_route: NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
    pack_input_wire_schema: NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
    compatibility_claim: false,
    readiness_claim: false
  };

  const packInputRequest = {
    schema_version: WORKER_ADMISSION_DOMAIN_PACK_INPUT_SCHEMA_VERSION,
    authority: WORK_RECORD_ADMISSION_LOCAL_AUTHORITY,
    classification: "domain_pack_input_assembly",
    record_id: derivedEvidence.record_id ?? null,
    unit: cloneJson(derivedEvidence.unit ?? null),
    source_record_digest: derivedEvidence.source_record_digest ?? null,
    generated_at: derivedEvidence.generated_at ?? null,
    decision_kind: WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS.decision_kind,
    node_engine_binding: nodeEngineBinding,
    normalized_portfolio_facts: normalizedPortfolioFacts,
    feature_vector: featureVector,
    derived_metrics: derivedMetrics,
    degradations,
    artifact_refs: artifactRefs,
    preparation_audit_refs: preparationAuditRefs,

    pack_input: {
      node_engine_binding_status: NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
      decision_kind: WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS.decision_kind,
      operation_id: WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS.operation_id,
      operation_version: WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS.operation_version,
      bound_fact_keys: [
        "normalized_portfolio_facts",
        "feature_vector",
        "derived_metrics",
        "degradations",
        "artifact_refs",
        "preparation_audit_refs"
      ]
    },
    transformation_classifications: [
      {
        field: "normalized_portfolio_facts",
        classification: "local_normalization",
        reason: "projection of canonical normalized worker-admission request facts"
      },
      {
        field: "feature_vector",
        classification: "local_reference_only",
        reason: "portfolio work-unit-feature-vector.v1 projection; not Node Engine authority"
      },
      {
        field: "derived_metrics",
        classification: "local_reference_only",
        reason: "feature-vector derived metrics projection"
      },
      {
        field: "degradations",
        classification: "local_reference_only",
        reason: "feature-vector degradation evidence projection"
      },
      {
        field: "artifact_refs",
        classification: "local_reference_only",
        reason: "deterministic artifact refs carried unchanged for digest replay"
      },
      {
        field: "preparation_audit_refs",
        classification: "local_reference_only",
        reason: "deterministic preparation-audit refs carried unchanged for digest replay"
      },
      {
        field: "pack_input",
        classification: "domain_pack_input_assembly",
        reason: "Node Engine-owned input envelope; wire schema is node_engine_unratified_placeholder"
      },
      {
        field: "node_engine_binding.http_route",
        classification: "domain_pack_input_assembly",
        reason: "concrete route stays node_engine_unratified_placeholder until rebound from current Node Engine authority"
      }
    ]
  };

  if (reviewAttestations.length > 0) {
    packInputRequest.review_attestations = reviewAttestations;
    packInputRequest.normalized_portfolio_facts.source_digest =
      derivedEvidence.source_record_digest ?? null;
    packInputRequest.pack_input.bound_fact_keys.push("review_attestations");
    packInputRequest.transformation_classifications.push({
      field: "review_attestations",
      classification: "local_normalization",
      reason: "bounded selected-unit review-attestation evidence for remote pack_input projection"
    });
  }

  packInputRequest.pack_input_digest = computeNormalizedRequestOutputHash(packInputRequest);
  Object.defineProperty(packInputRequest, "normalizedPortfolioFacts", {
    value: normalizedPortfolioFacts,
    enumerable: false,
    configurable: true
  });
  return packInputRequest;
}

export async function createSelectedUnitWorkerAdmissionDomainPackInput({
  dir = ".",
  record,
  unit,
  review_attestation_binding = null,
  now = null
} = {}) {
  if (!isObject(record)) {
    throw new Error("createSelectedUnitWorkerAdmissionDomainPackInput requires record");
  }
  const recordId = isNonEmptyString(record.id) ? String(record.id).trim() : null;
  if (!recordId) {
    throw new Error("createSelectedUnitWorkerAdmissionDomainPackInput requires record.id");
  }

  const isSlice = isObject(unit) && unit.kind === "slice" && isNonEmptyString(unit.slice_id);
  let materializationSubject = record;
  let selectedUnit = {
    kind: "work_item",
    address: recordId,
    record_id: recordId,
    slice_id: null
  };
  if (isSlice) {
    const sliceId = String(unit.slice_id).trim();
    const slices = Array.isArray(record.slices) ? record.slices : [];
    const selectedSlice = slices.find((entry) => isObject(entry) && entry.id === sliceId) || null;
    if (!selectedSlice) {
      throw new Error(`selected slice ${sliceId} does not exist on ${recordId}`);
    }

    materializationSubject = {
      ...cloneJson(selectedSlice),
      id: recordId,
      kind: "slice",
      slice_id: selectedSlice.id
    };
    selectedUnit = {
      kind: "slice",
      address: `${recordId}#${sliceId}`,
      record_id: recordId,
      slice_id: sliceId
    };
  }

  const reviewedUnitSourceDigest = computeReviewedUnitSourceDigest(
    isSlice
      ? { record: cloneJson(record), selected_slice_id: selectedUnit.slice_id }
      : cloneJson(record)
  );
  if (!reviewedUnitSourceDigest) {
    throw new Error(
      `selected-unit reviewed digest cannot be resolved for ${selectedUnit.address}`
    );
  }
  const recordLocalInputs = await createWorkRecordAdmissionRecordLocalInputs({
    dir,
    record: materializationSubject,
    sourceRecordDigestOverride: reviewedUnitSourceDigest
  });

  const dispatchReadiness = {
    schema_version: "dispatch-readiness.v1",
    record_id: recordId,
    unit: selectedUnit,
    decision_code: "dispatchable",
    dispatchable: true,
    state: {
      graph_available: false,
      dirty_state: "clean",
      staleness: "fresh",
      graph_state: {
        graph_available: false,
        edge_source: "unavailable",
        dirty_graph_mode: "unavailable",
        unavailable_paths: []
      }
    },
    reasons: [],
    accepted_escalations: [],
    clusters: [
      {
        cluster_id: "selected_unit",
        input_paths: [],
        affected_surfaces: [],
        likely_tests: [],
        docs_contracts: [],
        canonical_refs: [],
        derived_evidence: [],
        confidence: "high",
        split_recommendation: {
          required: false,
          reason: "selected unit materializes as a single cluster"
        }
      }
    ],
    blast_radius: {
      level: "low",
      reasons: [],
      accepted_escalation_id: null
    }
  };

  const derivedEvidence = createWorkRecordAdmissionDerivedEvidence({
    record,
    repo: record.repo,
    work_unit_metrics: recordLocalInputs.work_unit_metrics,
    file_stats: recordLocalInputs.file_stats,
    validation_command_metadata: recordLocalInputs.validation_command_metadata,
    runtime_mode_metadata: recordLocalInputs.runtime_mode_metadata,
    artifact_kind_metadata: recordLocalInputs.artifact_kind_metadata,
    structural_target_metrics: recordLocalInputs.structural_target_metrics,
    metric_source_provenance: recordLocalInputs.metric_source_provenance,
    dispatch_readiness: dispatchReadiness,

    generated_at: now ?? undefined,
    clock: systemUtcClock
  });
  const persistedEvidence = await readPersistedWorkerAdmissionEvidenceSidecar({
    dir,
    record,
    selectedUnit,
    sourceDigest: derivedEvidence.source_record_digest
  });
  const derivedEvidenceWithPersistedAttestations = attachPersistedReviewAttestations(
    derivedEvidence,
    persistedEvidence
  );
  const reviewAttestationBinding = isObject(review_attestation_binding)
    ? {
        ...review_attestation_binding,
        unit: selectedUnit,
        source_digest: derivedEvidence.source_record_digest
      }
    : {};
  const orgPolicyProfile = await loadOrgPolicyProfile({ dir });

  return createWorkerAdmissionDomainPackInput({
    derived_evidence: derivedEvidenceWithPersistedAttestations,
    org_policy_profile: orgPolicyProfile,
    bounded_large_file_extraction_refactor_intent:
      recordLocalInputs.bounded_large_file_extraction_refactor_intent,
    now,
    review_attestation_binding: reviewAttestationBinding
  });
}
