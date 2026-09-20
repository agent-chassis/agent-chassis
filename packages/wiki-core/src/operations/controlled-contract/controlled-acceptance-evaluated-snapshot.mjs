

import {
  deriveControlledContractRepairCandidate
} from "./design-workbench-repair.mjs";
import {
  projectBoundProofAuthoringDiagnostics,
  projectBoundProofAuthoringOrdinaryReadiness
} from
  "./proof-authoring-readiness-inputs.mjs";

export const CONTROLLED_ACCEPTANCE_EVALUATED_SNAPSHOT_SCHEMA_VERSION =
  "controlled-acceptance-evaluated-snapshot.v1";

export const CONTROLLED_ACCEPTANCE_CURRENTNESS_STATES = Object.freeze([
  "current", "stale", "unbound"
]);

export const CONTROLLED_ACCEPTANCE_REPAIR_QUALIFICATIONS = Object.freeze([

  "not_required",

  "uniquely_determined",

  "competing_candidates",

  "substantive_input_required",

  "capability_unavailable",

  "source_unauthenticated",

  "not_available"
]);

const QUALIFICATION_BY_REASON = Object.freeze({
  controlled_contract_repair_not_required: "not_required",
  controlled_contract_repair_role_contended: "competing_candidates",
  controlled_contract_repair_owner_unregistered: "capability_unavailable",
  controlled_contract_repair_participant_missing: "capability_unavailable",
  controlled_contract_repair_role_unbound: "capability_unavailable",
  controlled_contract_repair_source_unauthenticated: "source_unauthenticated"
});

function frozen(value) {
  return Object.freeze(value);
}

function compactProofAuthoringDiagnostics(projection) {
  if (projection === null || projection === undefined) return null;
  return frozen({
    schema_version: projection.schema_version,
    result_identity: projection.result_identity,
    counts: structuredClone(projection.counts),
    categories: frozen((projection.categories ?? []).map(category => frozen({
      category: category.category,
      groups: category.group_count,
      occurrences: category.occurrence_count,
      affected_obligations: category.affected_obligation_count,
      global_occurrences: category.global_occurrence_count,
      effects: frozen({
        blocking: frozen({ groups: category.blocking_group_count,
          occurrences: category.blocking_occurrence_count }),
        nonblocking: frozen({ groups: category.nonblocking_group_count,
          occurrences: category.nonblocking_occurrence_count }),
        unresolved: frozen({ groups: category.unresolved_group_count,
          occurrences: category.unresolved_occurrence_count })
      })
    }))),
    groups: frozen((projection.groups ?? []).map(group => frozen({
      category: group.category,
      code: group.code,
      route_effect: group.route_effect,
      ...(group.category === 'system_capability'
        ? { route_reason: group.route_assessment?.reason ?? null } : {}),
      occurrence_count: group.occurrence_count,
      affected_obligation_count: group.affected_obligation_count,
      responsible_owner: group.route_assessment?.responsible_owner ?? group.owner,
      ...(group.route_assessment?.unavailable_operation == null ? {} : {
        unavailable_operation: structuredClone(
          group.route_assessment.unavailable_operation) }),
      ...(group.route_assessment?.recovery == null ? {} : {
        recovery_status: group.route_assessment.recovery.status }),
      detail_call: structuredClone(group.detail_call)
    })))
  });
}

function binding(owner, current, reasonCodes = [], { claims = true } = {}) {
  return frozen({
    owner,
    current,
    claims,
    reason_codes: frozen([...new Set(reasonCodes.filter(
      (code) => typeof code === "string" && code.length > 0))].sort())
  });
}

function assessmentBinding(assessment) {
  if (assessment === null || assessment === undefined) {
    return binding("contract_assessment", null);
  }
  const current = assessment.source_current === true;
  return binding("contract_assessment", current,
    current ? [] : ["assessment_source_stale"]);
}

function obligationBinding(coverage) {

  if (coverage === null || coverage === undefined) {
    return binding("obligation_coverage", null);
  }
  if (coverage.source === null || coverage.source === undefined) {
    return binding("obligation_coverage", null);
  }
  const current = coverage.sourceCurrent === true;
  return binding("obligation_coverage", current,
    current ? [] : [...(coverage.staleReasons ?? []),
      "obligation_coverage_not_current"]);
}

function acceptanceBinding(coverage) {

  if (coverage === null || coverage === undefined ||
      coverage.carrier === null || coverage.carrier === undefined) {
    return binding("acceptance_coverage", null);
  }
  const changed = Array.isArray(coverage.changed_bindings)
    ? coverage.changed_bindings : null;
  if (changed === null) return binding("acceptance_coverage", null);
  return binding("acceptance_coverage", changed.length === 0,
    changed.length === 0 ? [] : ["acceptance_coverage_source_bindings_changed"]);
}

function currentness(bindings) {
  const stale = bindings.filter(({ current }) => current === false);
  const claimed = bindings.filter(({ current, claims }) =>
    claims && current !== null);
  const state = stale.length > 0 ? "stale" : claimed.length === 0
    ? "unbound" : "current";
  return frozen({
    state,
    reason_codes: frozen([...new Set(stale.flatMap(
      ({ reason_codes: codes }) => codes))].sort()),
    bindings: frozen(bindings),

    owner_count: bindings.length,
    claimed_count: claimed.length,
    stale_count: stale.length
  });
}

function repairQualification(candidate) {
  const qualification = candidate.unique === true ? "uniquely_determined"
    : QUALIFICATION_BY_REASON[candidate.reason_code] ??
      (candidate.reason_code === "controlled_contract_repair_no_mechanical_candidate"
        ? candidate.gap_class === "unresolved_semantic_choice"
          ? "substantive_input_required" : "not_available"
        : "not_available");
  const rows = Array.isArray(candidate.rows) ? candidate.rows : [];
  return frozen({
    qualification,
    reason_code: candidate.reason_code ?? null,
    gap_class: candidate.gap_class ?? null,
    responsible_owner: candidate.responsible_owner ?? null,

    candidate_row_count: rows.length,
    affected_role_count: Array.isArray(candidate.affected_roles)
      ? candidate.affected_roles.length : 0,
    candidate_row_id: candidate.candidate_row_id ?? null,
    candidate_digest: candidate.candidate_digest ?? null
  });
}

export function deriveControlledAcceptanceEvaluatedSnapshot({
  ownerInput, workbench, classification = null, repairCandidate = null,
  qualifyRepair = deriveControlledContractRepairCandidate
}) {
  const subject = workbench.subject ?? {};
  const source = frozen({
    wk_id: subject.wk_id ?? null,

    selected_unit: subject.selected_unit ?? null,
    focus: subject.focus ?? null,
    generation_id: subject.generation_id ?? null,
    manifest_digest: subject.manifest_digest ?? null,
    record_source_digest: subject.record_source_digest ?? null
  });
  const assessment = ownerInput?.contractAssessment ?? null;
  const obligation = ownerInput?.obligationCoverage ?? null;
  const acceptance = ownerInput?.acceptanceCoverage ?? null;
  const ordinaryAuthoringReadiness =
    projectBoundProofAuthoringOrdinaryReadiness(ownerInput);
  const candidate = repairCandidate ?? qualifyRepair(workbench, {
    ...(classification === null ? {} : { descriptors: classification.descriptors })
  });
  return frozen({
    schema_version: CONTROLLED_ACCEPTANCE_EVALUATED_SNAPSHOT_SCHEMA_VERSION,
    source,

    population: frozen({
      contract_content_digest:
        ownerInput?.authoringState?.selected_resources?.contract?.content_digest ?? null,
      proof_plan_content_digest:
        ownerInput?.authoringState?.selected_resources?.proof_plan?.content_digest ?? null,
      assessment_source: frozen(compactAssessmentSource(assessment)),
      obligation_source_digest: obligation?.source?.content_digest ?? null,
      acceptance_carrier_digest: acceptance?.carrier?.content_digest ?? null,
      selected_pack_count: obligation?.resolution?.definition_identities?.length ?? (Array.isArray(obligation?.selectedPacks)
        ? obligation.selectedPacks.length
        : Array.isArray(acceptance?.selectedPacks)
          ? acceptance.selectedPacks.length : 0),
      test_proof_binding_count: Array.isArray(ownerInput?.testProofBindings)
        ? ownerInput.testProofBindings.length : 0
    }),
    currentness: currentness([
      assessmentBinding(assessment),
      obligationBinding(obligation),
      acceptanceBinding(acceptance)
    ]),
    obligation_design: frozen({ status: obligation?.resolution?.status ?? "unresolved",
      counts: obligation?.resolution?.counts ?? null,
      definition_identities: obligation?.resolution?.definition_identities ?? [],
      source_digest: obligation?.source?.content_digest ?? null,
      context_digest: obligation?.resolution?.context_digest ?? null,
      source_present: obligation?.source != null,
      reason_codes: [...new Set([...(obligation?.resolution?.diagnostics ?? []),
        ...(obligation?.resolution?.rows ?? []).flatMap(row => row.diagnostics)].map(row => row.code))],
      declarations: workbench.dimensions.find(row => row.dimension_id === 'runtime_proof_declaration')?.owner_result?.counts ?? null,
      recovery: ordinaryAuthoringReadiness?.recovery ??
        (ownerInput?.authoringState?.saved_applications === undefined ? null
          : ownerInput.authoringState.next_calls[0]) }),
    ordinary_authoring_readiness: ordinaryAuthoringReadiness,
    proof_authoring_diagnostics:
      compactProofAuthoringDiagnostics(
        projectBoundProofAuthoringDiagnostics(ownerInput)),
    assessment: frozen({
      stage_assessment: assessment?.stage_assessment ?? null,
      state: assessment?.state ?? null,
      family: assessment?.family ?? null,
      source_current: assessment === null ? null : assessment.source_current === true,
      cross_carrier_integrity_state:
        assessment?.cross_carrier_integrity?.state ?? null,
      total_count: assessment?.total_count ?? 0,
      omitted_count: assessment?.omitted_count ?? 0
    }),
    repair: repairQualification(candidate)
  });
}

function compactAssessmentSource(assessment) {
  const source = assessment?.source ?? null;
  if (source === null || typeof source !== "object") {
    return { work_record_id: null, selected_unit: null, focus: null,
      generation_id: null, manifest_digest: null,
      controlled_contract_digest: null, proof_plan_digest: null };
  }
  return {
    work_record_id: source.work_record_id ?? null,
    selected_unit: source.selected_unit ?? null,
    focus: source.focus ?? null,
    generation_id: source.generation_id ?? null,
    manifest_digest: source.manifest_digest ?? null,
    controlled_contract_digest: source.controlled_contract_digest ?? null,
    proof_plan_digest: source.proof_plan_digest ?? null
  };
}

export function bindControlledAcceptanceEvaluatedSnapshot(snapshot, {
  expectedRecordSourceDigest = null
} = {}) {
  if (snapshot === null || typeof snapshot !== "object") return snapshot;
  if (typeof expectedRecordSourceDigest !== "string" ||
      expectedRecordSourceDigest.length === 0) return snapshot;
  const evaluated = snapshot.source?.record_source_digest ?? null;
  const consumerBinding = binding("consumer_record_source",
    evaluated === null ? null : evaluated === expectedRecordSourceDigest,
    evaluated === null || evaluated === expectedRecordSourceDigest
      ? [] : ["controlled_acceptance_record_source_moved"],
    { claims: false });
  return frozen({
    ...snapshot,
    source: frozen({ ...snapshot.source,
      expected_record_source_digest: expectedRecordSourceDigest }),
    currentness: currentness([
      ...(snapshot.currentness?.bindings ?? []), consumerBinding
    ])
  });
}

export function projectControlledAcceptanceEvaluatedSnapshot(snapshot) {
  if (snapshot === null || snapshot === undefined) return null;
  return frozen({
    schema_version: snapshot.schema_version,
    currentness: frozen({
      state: snapshot.currentness.state,
      reason_codes: structuredClone(snapshot.currentness.reason_codes)
    }),

    repair: frozen({
      qualification: snapshot.repair.qualification,
      reason_code: snapshot.repair.reason_code,
      gap_class: snapshot.repair.gap_class,
      candidate_row_count: snapshot.repair.candidate_row_count,
      affected_role_count: snapshot.repair.affected_role_count
    }),
    proof_authoring_diagnostics: snapshot.proof_authoring_diagnostics ?? null,
    ordinary_authoring_readiness:
      snapshot.ordinary_authoring_readiness ?? null,
  });
}
