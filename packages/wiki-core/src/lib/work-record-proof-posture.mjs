import {
  classifyControlledContractTerminalGaps
} from "../operations/controlled-contract/terminal-gap-classification.mjs";
import {
  controlledAcceptanceSelectedUnit, coverageUnitAddress
} from "./controlled-contract-unit-address.mjs";

export const WORK_RECORD_PROOF_POSTURE_SCHEMA_VERSION =
  "work-record-proof-posture.v1";
export const CONTROLLED_ACCEPTANCE_STATE_SCHEMA_VERSION =
  "controlled-acceptance-state.v1";
export const CONTROLLED_ACCEPTANCE_STATES = Object.freeze([
  "absent", "incomplete", "complete", "opted_out"
]);
export const CONTROLLED_ACCEPTANCE_OPT_OUT_RATIONALE_MAX_BYTES = 8 * 1024;

const POSTURE_KEYS = new Set([
  "schema_version", "record_id", "classification", "classification_rationale",
  "controlled_contract"
]);
const CONTRACT_KEYS = new Set([
  "required", "exemption", "focus", "content_digest"
]);
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const FOCUS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function closedKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function exactKeys(value, required, allowed = required) {
  const allowedSet = allowed instanceof Set ? allowed : new Set(allowed);
  return required.every((key) => Object.hasOwn(value, key)) &&
    closedKeys(value, allowedSet);
}

function normalizedRationale(value, { required = false } = {}) {
  if (value === null && !required) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if ((required && trimmed.length === 0) || trimmed !== value ||
      Buffer.byteLength(trimmed, "utf8") >
        CONTROLLED_ACCEPTANCE_OPT_OUT_RATIONALE_MAX_BYTES) return null;
  return trimmed;
}

export function controlledAcceptancePrepareDesignCall(wkId, selectedUnit = null) {
  return Object.freeze({
    tool: "workspace_controlled_contract_obligation_coverage_query",
    arguments: Object.freeze({ unit: coverageUnitAddress({ wkId, selectedUnit }) }),
    follow_up_tool: "workspace_controlled_contract_obligation_coverage_upsert",
    recommended: true
  });
}

export function normalizeControlledAcceptanceOptOutRationale(value) {
  return normalizedRationale(value, { required: true });
}

export const CONTROLLED_ACCEPTANCE_OPT_OUT_RATIONALE_PROVENANCE = "caller_authored_unassessed";
export const CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE = Object.freeze({
  schema_version: "controlled-acceptance-opt-out-provenance.v1",
  disposition: "opted_out",
  rationale: "caller_authored",
  rationale_assessment: "not_performed",
  assessed_by: null,
  means: "The exemption and its rationale were saved as the caller wrote them. Their truth was " +
    "not assessed, so an exempted dimension is a recorded caller disposition, not a finding that " +
    "the obligation does not apply and not evidence that any proof succeeded."
});

export function controlledAcceptanceOptOutProvenance(state) {
  return state === "opted_out" ? CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE : null;
}

export function inspectWorkRecordProofPosture(record, { expectedRecordId = null } = {}) {
  if (!plainObject(record) || !Object.hasOwn(record, "proof_posture")) {
    return Object.freeze({ present: false, valid: true, disposition: null,
      proof_posture: null, reason: null });
  }
  const posture = record.proof_posture;
  let reason = null;
  if (!plainObject(posture) || !exactKeys(posture, [...POSTURE_KEYS])) {
    reason = "proof_posture must be one closed work-record-proof-posture.v1 object";
  } else if (posture.schema_version !== WORK_RECORD_PROOF_POSTURE_SCHEMA_VERSION) {
    reason = "proof_posture schema_version is not work-record-proof-posture.v1";
  } else if (typeof posture.record_id !== "string" ||
      posture.record_id !== (expectedRecordId ?? record.id)) {
    reason = "proof_posture.record_id must match the canonical work record";
  } else if (!plainObject(posture.controlled_contract) ||
      !exactKeys(posture.controlled_contract,
        ["required", "exemption", "focus"], CONTRACT_KEYS)) {
    reason = "proof_posture.controlled_contract has an invalid closed shape";
  }
  if (reason !== null) return Object.freeze({ present: true, valid: false,
    disposition: null, proof_posture: null, reason });

  const contract = posture.controlled_contract;
  const focusValid = contract.focus === null ||
    (typeof contract.focus === "string" && FOCUS.test(contract.focus));
  const digestValid = !Object.hasOwn(contract, "content_digest") ||
    contract.content_digest === null || SHA256.test(contract.content_digest);
  const optionalRationale = normalizedRationale(posture.classification_rationale);
  if (!focusValid || !digestValid || optionalRationale !== posture.classification_rationale) {
    reason = "proof_posture controlled-contract identity or rationale is malformed";
  } else if (contract.required === true) {
    if (posture.classification !== "standard" || contract.exemption !== null) {
      reason = "required controlled acceptance must use standard classification with no exemption";
    }
  } else if (contract.required === false) {
    const rationale = normalizedRationale(posture.classification_rationale,
      { required: true });
    const documentation = posture.classification === "documentation_only" &&
      contract.exemption === "documentation_only";
    const explicitOptOut = posture.classification === "standard" &&
      contract.exemption === "no_controlled_contract";
    if ((!documentation && !explicitOptOut) || rationale === null ||
        contract.focus !== null || contract.content_digest != null) {
      reason = "non-required controlled acceptance needs its canonical exemption and a nonempty rationale";
    }
  } else {
    reason = "proof_posture.controlled_contract.required must be boolean";
  }
  if (reason !== null) return Object.freeze({ present: true, valid: false,
    disposition: null, proof_posture: null, reason });
  const disposition = contract.required
    ? "required" : "opted_out";
  return Object.freeze({ present: true, valid: true, disposition,
    proof_posture: Object.freeze(structuredClone(posture)), reason: null });
}

export function buildControlledAcceptanceProofPosture({ wkId, disposition, rationale = null }) {
  if (disposition === "required") return Object.freeze({
    schema_version: WORK_RECORD_PROOF_POSTURE_SCHEMA_VERSION,
    record_id: wkId,
    classification: "standard",
    classification_rationale: null,
    controlled_contract: Object.freeze({ required: true, exemption: null, focus: null })
  });
  if (disposition !== "opted_out") {
    throw new TypeError("controlled-acceptance disposition must be required or opted_out");
  }
  const normalized = normalizeControlledAcceptanceOptOutRationale(rationale);
  if (normalized === null) {
    const error = new TypeError(
      "controlled-acceptance opt-out rationale must be trimmed, nonempty, and at most 8192 UTF-8 bytes"
    );
    error.code = "controlled_acceptance_opt_out_rationale_invalid";
    throw error;
  }
  return Object.freeze({
    schema_version: WORK_RECORD_PROOF_POSTURE_SCHEMA_VERSION,
    record_id: wkId,
    classification: "standard",
    classification_rationale: normalized,
    controlled_contract: Object.freeze({
      required: false, exemption: "no_controlled_contract", focus: null
    })
  });
}

export function validateWorkRecordProofPostureInto(diagnostics, record, addDiagnostic) {
  const inspected = inspectWorkRecordProofPosture(record);
  if (!inspected.present || inspected.valid) return;
  addDiagnostic(diagnostics, "invalid_record", inspected.reason, { path: "proof_posture" });
}

function populationProjection(workbench) {
  if (!workbench) return null;
  return Object.freeze({
    dimension_count: workbench.dimension_count,
    incomplete_row_count: workbench.incomplete_row_count,
    actionable_row_count: workbench.actionable_row_count,
    non_actionable_row_count: workbench.non_actionable_row_count
  });
}

function gapProjection(workbench) {
  if (!Array.isArray(workbench?.actionable_rows) ||
      !Array.isArray(workbench?.non_actionable_rows)) {
    return Object.freeze({ total: workbench?.incomplete_row_count ?? 0,
      counts: null, classes_present: null });
  }
  const gaps = classifyControlledContractTerminalGaps({ workbench });
  return Object.freeze({ total: gaps.total_gap_count,
    observation_count: gaps.observation_count,
    counts: gaps.gap_class_counts, classes_present: gaps.gap_classes_present,
    primary_gap_class: gaps.primary_gap_class,
    group_count: gaps.gap_group_count,
    logical_cause_count: gaps.logical_cause_count,
    recovery_status_counts: gaps.recovery_status_counts,
    groups_omitted: gaps.gap_groups_omitted,
    groups: gaps.gap_groups,
    affected_obligation_count: gaps.affected_obligation_count,
    affected_obligation_ids: gaps.affected_obligation_ids,
    affected_obligation_ids_omitted: gaps.affected_obligation_ids_omitted,
    detail_call: gaps.detail_call });
}

const ABSENT_REPAIR_QUALIFICATION = Object.freeze({
  qualification: "not_available",
  reason_code: "controlled_acceptance_evaluated_snapshot_absent",
  gap_class: null, responsible_owner: null,
  candidate_row_count: 0, affected_role_count: 0,
  candidate_row_id: null, candidate_digest: null
});
const ORDINARY_COMPLETE_REPAIR_QUALIFICATION = Object.freeze({
  qualification: "not_required",
  reason_code: "controlled_contract_repair_not_required",
  gap_class: null,
  responsible_owner: null,
  candidate_row_count: 0,
  affected_role_count: 0,
  candidate_row_id: null,
  candidate_digest: null
});

const ACCEPTANCE_COVERAGE_OWNER = "assessAcceptanceCriterionCoverage";
const ACCEPTANCE_CRITERIA_UNCOVERED = "acceptance_criteria_uncovered";
const ACCEPTANCE_CRITERIA_UNCOVERED_CODE = "controlled_acceptance_criteria_uncovered";
const READINESS_OWNER = "ordinaryAuthoringReadiness";
const OBLIGATION_DEFINITIONS_INCOMPLETE = "obligation_definitions_incomplete";

function correctionSentence({ read_tool: read, write_tool: write, arguments: args }) {
  return `${read}(${JSON.stringify(args)}), then ${write} on the same unit with that ` +
    "response's fresh content_digest as expected_content_digest.";
}

function causeNarrative(causes) {
  const [first, ...rest] = causes;
  return [first.explanation, ...rest.map(({ summary }) => summary)].join(" ");
}

function acceptanceCoverageCause(coverage) {
  const listed = coverage.uncovered_criteria.map(({ identity }) => identity);
  const more = coverage.uncovered_criteria_omitted > 0
    ? ` and ${coverage.uncovered_criteria_omitted} more` : "";
  const { correction } = coverage;
  const instruction = "Supply the missing verification meaning and associate an appropriate " +
    "obligation with each uncovered criterion";
  return Object.freeze({
    cause: ACCEPTANCE_CRITERIA_UNCOVERED,
    code: ACCEPTANCE_CRITERIA_UNCOVERED_CODE,
    owner: ACCEPTANCE_COVERAGE_OWNER,
    selected_unit: coverage.selected_unit,
    criterion_count: coverage.criterion_count,
    covered_count: coverage.covered_count,
    uncovered_count: coverage.uncovered_count,
    uncovered_criteria: Object.freeze(structuredClone(coverage.uncovered_criteria)),
    uncovered_criteria_omitted: coverage.uncovered_criteria_omitted,
    stale_association_count: coverage.stale_association_count,
    correction: Object.freeze(structuredClone(correction)),
    summary: `${coverage.uncovered_count} of ${coverage.criterion_count} acceptance criteria ` +
      `are uncovered (${listed.join(", ")}${more}). ${instruction}.`,
    explanation: `${coverage.uncovered_count} of ${coverage.criterion_count} acceptance ` +
      `criteria on ${coverage.selected_unit} have no associated valid obligation ` +
      `(${coverage.covered_count} covered; uncovered: ${listed.join(", ")}${more}). ` +
      `${instruction}: ${correctionSentence(correction)}`
  });
}

function authoredInputField(rows, obligationId, code) {
  for (const row of rows) {
    if ((row.evidence?.obligation_id ?? row.semantic_identity?.obligation_id) !== obligationId) {
      continue;
    }
    const found = (row.evidence?.diagnostics ?? []).find((diagnostic) =>
      diagnostic?.code === code && typeof diagnostic.problem?.cause?.field === "string");
    if (found) return found.problem.cause.field;
  }
  return null;
}

function obligationDefinitionsCause(definitions, rows) {
  const { correction } = definitions;
  const unit = correction.arguments.unit;
  const obligations = definitions.unresolved_obligations.map(({ obligation_id: id,
    authored_input_diagnostic_codes: codes }) => Object.freeze({ obligation_id: id,
    diagnostics: Object.freeze(codes.map((code) => Object.freeze({ code,
      field: authoredInputField(rows, id, code) }))) }));

  const [{ obligation_id: first, diagnostics }] = obligations;
  const fields = [...new Set(diagnostics.map(({ field }) => field).filter(Boolean))];
  const others = definitions.unresolved_obligation_count - 1;
  const summary = `On ${unit}, existing obligation ${first} ` +
    `${fields.length > 0 ? `is missing its authored ${fields.join(" and ")}`
      : "has an incomplete authored input"} ` +
    `(${diagnostics.map(({ code }) => code).join(", ")}), at the authored_inputs stage` +
    `${others > 0 ? `, and ${others} more existing obligation${others === 1 ? " is" : "s are"} ` +
      "incomplete" : ""}. Amend ${others > 0 ? "each one" : "that obligation"} in place with ` +
    `its missing authored input, keeping ${others > 0 ? "their" : "its"} identity, ` +
    "criterion associations and case links.";
  return Object.freeze({
    cause: OBLIGATION_DEFINITIONS_INCOMPLETE,
    owner: READINESS_OWNER,
    selected_unit: unit,
    stage: "authored_inputs",
    unresolved_obligation_count: definitions.unresolved_obligation_count,
    unresolved_obligations: Object.freeze(obligations),
    unresolved_obligations_omitted: definitions.unresolved_obligations_omitted,
    summary,
    explanation: `${summary} Amend through ${correctionSentence(correction)}`
  });
}

function readinessDecidingCauses(readiness, rows) {
  const conditions = Array.isArray(readiness?.incomplete_conditions)
    ? readiness.incomplete_conditions : [];
  const definitions = readiness?.definition_readiness;
  return conditions.map((condition) =>
    condition === ACCEPTANCE_CRITERIA_UNCOVERED &&
      readiness.acceptance_coverage?.correction
      ? acceptanceCoverageCause(readiness.acceptance_coverage)
      : condition === OBLIGATION_DEFINITIONS_INCOMPLETE && definitions?.correction &&
          definitions.unresolved_obligations?.length > 0
        ? obligationDefinitionsCause(definitions, rows)
        : Object.freeze({ cause: condition, owner: READINESS_OWNER }));
}

function subsetReadiness(readiness) {
  if (readiness === null || typeof readiness !== "object") return readiness ?? null;
  const { definition_readiness: _presentation, ...subset } = readiness;
  return Object.freeze(subset);
}

function definitionReadinessProjection(workbench) {
  const readiness =
    workbench?.evaluated_snapshot?.ordinary_authoring_readiness ?? null;
  const definitions = readiness?.definition_readiness ?? null;
  if (definitions === null) return null;
  const gaps = Array.isArray(workbench?.actionable_rows) &&
    Array.isArray(workbench?.non_actionable_rows)
    ? classifyControlledContractTerminalGaps({ workbench }) : null;
  return Object.freeze({ ...definitions,

    terminal_gaps: gaps === null ? null : Object.freeze({
      total: gaps.total_gap_count,
      observation_count: gaps.observation_count,
      primary_gap_class: gaps.primary_gap_class,
      affected_obligation_count: gaps.affected_obligation_count,
      affected_obligation_ids: gaps.affected_obligation_ids,
      affected_obligation_ids_omitted: gaps.affected_obligation_ids_omitted,
      group_count: gaps.gap_group_count,
      logical_cause_count: gaps.logical_cause_count,
      recovery_status_counts: gaps.recovery_status_counts,
      groups_omitted: gaps.gap_groups_omitted,
      groups: gaps.gap_groups
    }) });
}

function semanticSubset({ wkId, selectedUnit, state, posture, workbench, generation }) {
  const snapshot = workbench?.evaluated_snapshot ?? null;
  const ordinaryReadiness = snapshot?.ordinary_authoring_readiness ?? null;
  const readinessRecovery = ordinaryReadiness?.recovery ?? null;
  const ordinaryComplete =
    snapshot?.ordinary_authoring_readiness?.status === "complete";
  const dimensions = (workbench?.dimensions ?? []).map(
    ({ dimension_id: id, status, counts }) => Object.freeze({
      dimension_id: id, status,
      total: counts?.total ?? 0, complete: counts?.complete ?? 0,
      missing: counts?.missing ?? 0, stale: counts?.stale ?? 0,
      conflicting: counts?.conflicting ?? 0,
      not_applicable: counts?.not_applicable ?? 0 }));

  const currentness = snapshot?.currentness?.state ?? "unbound";

  const stale = state !== "opted_out" && currentness === "stale";

  const blocked = stale || ["absent", "incomplete"].includes(state);
  const terminalGaps = gapProjection(workbench);
  const definitionCorrection =
    snapshot?.ordinary_authoring_readiness?.definition_readiness?.correction ?? null;
  const internalFailure = (terminalGaps?.counts?.tooling_or_internal_invariant ?? 0) > 0;
  const authoredCorrection = definitionCorrection ??
    (state === "absent"
      ? controlledAcceptancePrepareDesignCall(wkId, selectedUnit) : null);
  const authoredCorrectionAvailable = !internalFailure && authoredCorrection !== null;
  const supportedAuthoredCall = state === "absent" ? authoredCorrection : readinessRecovery;
  const recoveryCapability = !blocked ? Object.freeze({ status: "not_required",
    actor_recovery: "none", inspection_call: null, correction: null })
    : stale ? Object.freeze({ status: "source_refresh_required",
      actor_recovery: "agent", inspection_call: terminalGaps?.detail_call ?? null,
      correction: null })
      : internalFailure ? Object.freeze({ status: "system_owner_failure",
        actor_recovery: "system_owner", inspection_call: terminalGaps?.detail_call ?? null,
        correction: null })
        : authoredCorrectionAvailable ? Object.freeze({
          status: "authored_correction_available", actor_recovery: "agent",
          inspection_call: terminalGaps?.detail_call ?? null,
          correction: Object.freeze(structuredClone(authoredCorrection))
        }) : Object.freeze({ status: "inspection_only", actor_recovery: "none",
          inspection_call: terminalGaps?.detail_call ?? null, correction: null });
  const causeRows = [...(workbench?.actionable_rows ?? []),
    ...(workbench?.non_actionable_rows ?? [])];
  const diagnosticOwners = [...new Set(causeRows
    .map((row) => row.diagnostic_provenance?.owner).filter(Boolean))].sort();
  const nonblockingCodes = new Set((snapshot?.proof_authoring_diagnostics?.groups ?? [])
    .filter((group) => group.route_effect === "nonblocking")
    .map((group) => group.code));
  for (const declaration of snapshot?.ordinary_authoring_readiness?.declarations ?? []) {
    if (declaration.status !== "complete") continue;
    for (const code of [...(declaration.blocking_diagnostic_codes ?? []),
      ...(declaration.nonblocking_diagnostic_codes ?? []),
      ...(declaration.unresolved_diagnostic_codes ?? []),
      ...(declaration.reported_execution_diagnostic_codes ?? [])]) {
      nonblockingCodes.add(code);
    }
  }
  const ownerCodes = [...new Set(causeRows
    .flatMap((row) => row.reason_codes ?? []))]
    .filter((code) => !nonblockingCodes.has(code)).sort();

  const readinessCauses = !blocked || stale || internalFailure || state !== "incomplete"
    ? [] : readinessDecidingCauses(ordinaryReadiness, causeRows);
  const coverageCause = readinessCauses.find(
    (cause) => cause.cause === ACCEPTANCE_CRITERIA_UNCOVERED) ?? null;
  const decidingCauses = coverageCause !== null && workbench?.mechanically_complete === true
    ? [coverageCause] : readinessCauses;

  const coverageAlone = coverageCause !== null && generation !== null &&
    decidingCauses.length === 1;
  const withCoverage = (values, value) => coverageCause === null
    ? values : [...new Set([...values, value])].sort();
  const decidingOwners = coverageAlone ? [ACCEPTANCE_COVERAGE_OWNER]
    : withCoverage(diagnosticOwners, ACCEPTANCE_COVERAGE_OWNER);
  const decidingCodes = coverageAlone ? [ACCEPTANCE_CRITERIA_UNCOVERED_CODE]
    : withCoverage(ownerCodes, ACCEPTANCE_CRITERIA_UNCOVERED_CODE);
  const independentObservations = !coverageAlone ? null : Object.freeze({
    authority: "not_deciding_this_refusal",
    population: "controlled_contract_design_workbench_rows",
    incomplete_row_count: workbench?.incomplete_row_count ?? 0,
    diagnostic_owners: Object.freeze(diagnosticOwners),
    owner_codes: Object.freeze(ownerCodes),
    affected_obligation_count: terminalGaps?.affected_obligation_count ?? 0,
    detail_call: terminalGaps?.detail_call ?? null
  });

  const ownerNarrated = decidingCauses.length > 0 &&
    decidingCauses.every((cause) => typeof cause.explanation === "string") &&
    (coverageAlone || decidingCauses.some((cause) =>
      cause.cause === OBLIGATION_DEFINITIONS_INCOMPLETE));
  const genericExplanation =
    recoveryCapability.status === "system_owner_failure"
      ? "An internal semantic owner or classifier failed; authored proof changes are not an established repair."
      : recoveryCapability.status === "authored_correction_available"
        ? "The deciding authored-input causes are retrievable and the authoring owner exposes a revision-bound correction route."
        : recoveryCapability.status === "inspection_only"
          ? "The deciding semantic causes are retrievable, but no authenticated authored correction was established."
          : readinessRecovery?.explanation ?? null;
  return Object.freeze({
    schema_version: "controlled-acceptance-semantic-subset.v1",
    wk_id: wkId,

    selected_unit: controlledAcceptanceSelectedUnit(wkId, selectedUnit),
    state,
    source_current: !stale,

    source_currentness: Object.freeze({
      state: state === "opted_out" ? "current" : currentness,
      reason_codes: Object.freeze([
        ...(state === "opted_out" ? [] : snapshot?.currentness?.reason_codes ?? [])])
    }),
    posture_valid: true,
    posture_disposition: posture.present ? posture.disposition : null,
    generation: state === "opted_out" ? null : generation,
    manifest_content_digest: state === "opted_out"
      ? null : workbench?.subject?.manifest_digest ?? null,
    record_source_digest: workbench?.subject?.record_source_digest ?? null,
    mechanically_complete: ["complete", "opted_out"].includes(state),
    dimension_count: dimensions.length,
    dimensions: Object.freeze(dimensions),
    incomplete_row_count: workbench?.incomplete_row_count ?? 0,
    actionable_row_count: workbench?.actionable_row_count ?? 0,
    non_actionable_row_count: workbench?.non_actionable_row_count ?? 0,
    terminal_gaps: terminalGaps,

    repair: Object.freeze({ ...(ordinaryComplete
      ? ORDINARY_COMPLETE_REPAIR_QUALIFICATION
      : snapshot?.repair ?? ABSENT_REPAIR_QUALIFICATION) }),

    execution_evidence_owner: "workspace_verify_proof",
    saved_applications: snapshot?.obligation_design ?? null,

    ordinary_authoring_readiness:
      subsetReadiness(snapshot?.ordinary_authoring_readiness ?? null),
    proof_authoring_diagnostics: state === "opted_out"
      ? null : snapshot?.proof_authoring_diagnostics ?? null,
    assessment: Object.freeze({
      stage_assessment: snapshot?.assessment?.stage_assessment ?? null,
      identity: workbench?.final_assessment?.assessment_identity ?? null,
      state: snapshot?.assessment?.state ??
        workbench?.final_assessment?.assessment_state ?? null,
      source: Object.freeze({ ...(snapshot?.population?.assessment_source ?? {
        work_record_id: null, selected_unit: null, focus: null, generation_id: null,
        manifest_digest: null, controlled_contract_digest: null,
        proof_plan_digest: null }) }) }),
    admission: Object.freeze({
      admits: !blocked,
      blocked_reason_code: !blocked ? null
        : stale ? "controlled_acceptance_source_not_current"
          : state === "absent" ? "controlled_acceptance_disposition_missing"
            : "controlled_acceptance_incomplete",
      blocked_stage: !blocked || stale || state === "absent" ? null
        : readinessRecovery?.stage ??
          (ordinaryReadiness?.stage_counts?.authored_inputs?.incomplete > 0 ||
            ordinaryReadiness?.acceptance_coverage?.status !== "complete" &&
            ordinaryReadiness?.acceptance_coverage?.status !== "not_applicable"
            ? "authored_inputs" : "canonical_sources"),
      responsible_owner: !blocked ? null
        : decidingOwners.length === 1 ? decidingOwners[0]
          : decidingOwners.length > 1 ? "multiple_diagnostic_owners"
            : readinessRecovery?.responsible_owner ?? null,
      diagnostic_owners: Object.freeze(!blocked ? [] : decidingOwners),

      affected_obligation_count: !blocked || coverageAlone ? 0
        : terminalGaps?.affected_obligation_count ??
          readinessRecovery?.affected_obligation_count ?? 0,
      affected_obligation_ids: Object.freeze(!blocked || coverageAlone ? []
        : structuredClone(terminalGaps?.affected_obligation_ids ?? [])),
      affected_obligation_ids_omitted: !blocked || coverageAlone ? 0
        : terminalGaps?.affected_obligation_ids_omitted ?? 0,
      owner_codes: Object.freeze(!blocked
        ? [] : decidingCodes.length > 0 ? decidingCodes
          : structuredClone(readinessRecovery?.owner_codes ?? [])),
      deciding_causes: Object.freeze(decidingCauses),
      independent_observations: independentObservations,
      unavailable_operations: Object.freeze(!blocked
        ? [] : structuredClone(readinessRecovery?.unavailable_operations ?? [])),
      recovery_explanation: !blocked ? null
        : ownerNarrated ? causeNarrative(decidingCauses)
          : coverageCause !== null && genericExplanation !== null
            ? `${genericExplanation} ${coverageCause.explanation}`
            : genericExplanation,
      operator_action: !blocked ? null
        : readinessRecovery?.operator_action ?? null,
      supported_next_call: !blocked ? null
        : recoveryCapability.status === "authored_correction_available" &&
            typeof supportedAuthoredCall?.tool === "string" ? supportedAuthoredCall
          : recoveryCapability.inspection_call,
      recovery_capability: recoveryCapability,
      cause_detail_call: !blocked ? null : terminalGaps?.detail_call ?? null })
  });
}

export function projectControlledAcceptanceSemanticSubset(projection) {
  return projection?.semantic ?? null;
}

export function resolveControlledAcceptanceState({ posture, workbench }) {
  if (!posture?.valid) {
    const error = new TypeError(posture?.reason ??
      "canonical proof_posture is structurally invalid");
    error.code = "controlled_acceptance_proof_posture_invalid";
    throw error;
  }
  if (!posture.present) return "absent";
  if (posture.disposition === "opted_out") return "opted_out";
  const ordinaryReadiness = workbench?.evaluated_snapshot?.ordinary_authoring_readiness;
  const ordinaryAuthoringComplete = ordinaryReadiness?.status === "complete";

  const criteriaCovered = ["complete", "not_applicable"].includes(
    ordinaryReadiness?.acceptance_coverage?.status);
  return (workbench?.mechanically_complete === true || ordinaryAuthoringComplete) &&
    criteriaCovered && (workbench?.subject?.generation_id ?? null) !== null
    ? "complete" : "incomplete";
}

export function deriveControlledAcceptanceStateProjection({ wkId,
  selectedUnit = null, posture, workbench }) {
  const state = resolveControlledAcceptanceState({ posture, workbench });
  const generation = workbench?.subject?.generation_id ?? null;
  const required = posture.present && posture.disposition === "required";
  const semantic = semanticSubset({ wkId, selectedUnit, state, posture, workbench,
    generation });
  const sourceRefresh = semantic.admission.recovery_capability.status ===
    "source_refresh_required" ? semantic.admission.recovery_capability : null;
  const projection = Object.freeze({
    schema_version: CONTROLLED_ACCEPTANCE_STATE_SCHEMA_VERSION,
    wk_id: wkId,
    selected_unit: controlledAcceptanceSelectedUnit(wkId, selectedUnit),
    state,
    generation: state === "opted_out" ? null : generation,
    mechanically_complete: ["complete", "opted_out"].includes(state),
    disposition: state === "opted_out" ? Object.freeze({
      required: false,
      exemption: posture.proof_posture.controlled_contract.exemption,
      classification: posture.proof_posture.classification,
      classification_rationale: posture.proof_posture.classification_rationale,

      rationale_provenance: CONTROLLED_ACCEPTANCE_OPT_OUT_RATIONALE_PROVENANCE
    }) : required ? Object.freeze({ required: true, exemption: null,
      classification: posture.proof_posture.classification,
      classification_rationale: posture.proof_posture.classification_rationale,
      rationale_provenance: null }) : null,
    population: required ? populationProjection(workbench) : null,
    definition_readiness: required ? definitionReadinessProjection(workbench) : null,
    recovery: sourceRefresh ?? (["absent", "incomplete"].includes(state)
      ? workbench?.evaluated_snapshot?.obligation_design?.recovery ??
        controlledAcceptancePrepareDesignCall(wkId, selectedUnit) : null),
    semantic
  });
  return assertControlledAcceptanceStateProjection(projection, wkId, selectedUnit);
}

export function assertControlledAcceptanceStateProjection(value, expectedWkId,
  expectedSelectedUnit = null) {
  const keys = ["schema_version", "wk_id", "selected_unit", "state", "generation",
    "mechanically_complete", "disposition", "population", "definition_readiness",
    "recovery", "semantic"];
  const dispositionKeys = ["required", "exemption", "classification",
    "classification_rationale", "rationale_provenance"];
  const populationKeys = ["dimension_count", "incomplete_row_count",
    "actionable_row_count", "non_actionable_row_count"];
  const requiredState = ["incomplete", "complete"].includes(value?.state);
  const dispositionValid = value?.state === "absent"
    ? value?.disposition === null
    : plainObject(value?.disposition) && exactKeys(value.disposition, dispositionKeys) &&
      value.disposition.rationale_provenance === (value.state === "opted_out"
        ? CONTROLLED_ACCEPTANCE_OPT_OUT_RATIONALE_PROVENANCE : null) &&
      (value.state === "opted_out"
        ? value.disposition.required === false &&
          ((value.disposition.classification === "standard" &&
            value.disposition.exemption === "no_controlled_contract") ||
           (value.disposition.classification === "documentation_only" &&
            value.disposition.exemption === "documentation_only")) &&
          normalizeControlledAcceptanceOptOutRationale(
            value.disposition.classification_rationale) !== null
        : value.disposition.required === true && value.disposition.exemption === null &&
          value.disposition.classification === "standard" &&
          value.disposition.classification_rationale === null);
  const populationValid = requiredState
    ? plainObject(value?.population) && exactKeys(value.population, populationKeys) &&
      populationKeys.every((key) => Number.isSafeInteger(value.population[key]) &&
        value.population[key] >= 0)
    : value?.population === null;
  const expectedRecovery = value?.semantic?.saved_applications?.recovery ??
    controlledAcceptancePrepareDesignCall(expectedWkId, expectedSelectedUnit);

  const expectedUnit = controlledAcceptanceSelectedUnit(expectedWkId,
    expectedSelectedUnit);
  const selectedUnitValid = plainObject(value?.selected_unit) &&
    JSON.stringify(value.selected_unit) === JSON.stringify(expectedUnit);
  const expectedSourceRefresh = value?.semantic?.admission?.blocked_reason_code ===
    "controlled_acceptance_source_not_current"
    ? value.semantic.admission.recovery_capability : null;
  const recoveryValid = expectedSourceRefresh !== null
    ? plainObject(value?.recovery) &&
      JSON.stringify(value.recovery) === JSON.stringify(expectedSourceRefresh)
    : ["absent", "incomplete"].includes(value?.state)
      ? plainObject(value?.recovery) &&
        JSON.stringify(value.recovery) === JSON.stringify(expectedRecovery)
      : value?.recovery === null;
  if (!plainObject(value) || !exactKeys(value, keys) ||
      value.schema_version !== CONTROLLED_ACCEPTANCE_STATE_SCHEMA_VERSION ||
      value.wk_id !== expectedWkId || !CONTROLLED_ACCEPTANCE_STATES.includes(value.state) ||
      value.mechanically_complete !== ["complete", "opted_out"].includes(value.state) ||
      (value.state === "complete" && typeof value.generation !== "string") ||
      (value.state === "opted_out" && value.generation !== null) ||
      (!["complete", "opted_out"].includes(value.state) &&
        value.generation !== null && typeof value.generation !== "string") ||
      !selectedUnitValid ||
      !dispositionValid || !populationValid || !recoveryValid) {
    const error = new TypeError("controlled-acceptance state projection is malformed");
    error.code = "controlled_acceptance_state_projection_invalid";
    throw error;
  }
  return value;
}
