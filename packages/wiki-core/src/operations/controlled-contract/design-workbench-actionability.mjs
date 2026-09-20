

import { isPlainObject } from "../../lib/controlled-contract-tool-shared.mjs";
import { coverageAcceptanceFieldContracts, coverageObligationFieldContracts } from
  "../../lib/controlled-contract-coverage-authoring-skeleton.mjs";
import {
  CONTRACT_REQUIREMENT_OFFER_BYTES,
  contractRequirementAuthoring,
  coverageAuthoringOffer,
  currentDefinitionReauthoringOffer,
  runtimeTestReplacementAuthoring
} from "./design-workbench-row-offers.mjs";
import {
  projectControlledContractAcceptanceRowAuthoring
} from "./acceptance-coverage-row-authoring.mjs";
import { withControlledContractAnswerLimits } from
  "./design-workbench-response-input.mjs";

function obligationDescriptor(dimension, row) {
  if (dimension.dimension_id !== "obligation_coverage" ||
      typeof row.evidence?.obligation_id !== "string" ||
      row.reason_codes.includes("obligation_coverage_obligation_id_duplicate") ||
      dimension.owner_result?.sourceCurrent !== true ||
      typeof dimension.owner_result?.source?.content_digest !== "string") return null;
  const criteria = Array.isArray(dimension.owner_result.criteria)
    ? dimension.owner_result.criteria : [];
  const matches = criteria.filter(({ source_locator: locator }) =>
    locator === row.evidence.source_locator);
  if (matches.length !== 1 || typeof matches[0]?.identity !== "string" ||
      typeof dimension.owner_result.criterionIdentities?.digest !== "string" ||
      typeof row.evidence.source_locator_digest !== "string") return null;
  const criterionSelector = {
    kind: "criterion_identity",
    criterion_identity: matches[0].identity
  };
  return {
    semantic_owner: "obligation_coverage",
    response_kinds: ["obligation_wording", "mapping_selection",
      "mechanism_parameters", "explicit_gap_rationale"],
    row_authoring: coverageAuthoringOffer(
      coverageObligationFieldContracts(), "obligation_coverage"),
    owner_context: {
      selected_unit: dimension.owner_result.selectedUnit ?? null,
      expected_content_digest: dimension.owner_result.source.content_digest,
      criterion_binding: {
        criterion_identity: matches[0].identity,
        criterion_identity_set_digest: dimension.owner_result.criterionIdentities.digest,
        source_locator: row.evidence.source_locator,
        source_locator_digest: row.evidence.source_locator_digest,
        source_content_digest: dimension.owner_result.source.content_digest
      },
      row: {
        obligation_id: row.evidence.obligation_id,
        statement: row.evidence.statement,
        criterion_selector: criterionSelector,
        controlled_contract_node_ids: structuredClone(
          row.evidence.controlled_contract_node_ids),
        mechanism: structuredClone(row.evidence.mechanism),
        proof: structuredClone(row.evidence.proof)
      }
    }
  };
}

function obligationNonActionableReason(dimension, row) {
  if (dimension.dimension_id !== "obligation_coverage" ||
      typeof row.evidence?.obligation_id !== "string") return null;
  if (row.reason_codes.includes("obligation_coverage_obligation_id_duplicate")) {
    return "obligation_coverage_criterion_mapping_conflicting";
  }
  if (dimension.owner_result?.sourceCurrent !== true) {
    return "obligation_coverage_criterion_mapping_stale";
  }
  if (typeof dimension.owner_result?.source?.content_digest !== "string" ||
      typeof dimension.owner_result?.criterionIdentities?.digest !== "string" ||
      typeof row.evidence.source_locator_digest !== "string") {
    return "obligation_coverage_criterion_mapping_conflicting";
  }
  const matches = (Array.isArray(dimension.owner_result.criteria)
    ? dimension.owner_result.criteria : []).filter(({ source_locator: locator }) =>
    locator === row.evidence.source_locator);
  if (matches.length === 0) return "obligation_coverage_criterion_mapping_absent";
  if (matches.length > 1) return "obligation_coverage_criterion_mapping_ambiguous";
  if (typeof matches[0]?.identity !== "string") {
    return "obligation_coverage_criterion_mapping_conflicting";
  }
  return null;
}

function obligationPopulationDescriptor(dimension, row) {
  const owner = dimension.owner_result;
  if (dimension.dimension_id !== "obligation_coverage" ||
      row.semantic_identity?.population !== "empty" ||
      row.evidence?.carrier_absent !== true ||
      !Array.isArray(row.evidence.criteria) || row.evidence.criteria.length === 0 ||
      row.evidence.criteria.some(({ criterion_identity: identity, source_locator: locator }) =>
        typeof identity !== "string" || typeof locator !== "string") ||
      owner?.source != null || owner?.sourceCurrent !== true ||
      typeof owner?.authoringIdentity !== "string" ||
      typeof owner?.criterionIdentities?.digest !== "string") return null;
  return {
    semantic_owner: "obligation_coverage",
    response_kinds: ["obligation_coverage_population"],
    row_authoring: coverageAuthoringOffer(
      coverageObligationFieldContracts(), "obligation_coverage", true),
    owner_context: {
      selected_unit: owner.selectedUnit ?? null,
      expected_authoring_identity: owner.authoringIdentity,
      criterion_identity_set_digest: owner.criterionIdentities.digest,
      criteria: structuredClone(row.evidence.criteria)
    }
  };
}

function acceptancePopulationDescriptor(dimension, row) {
  const owner = dimension.owner_result;
  if (dimension.dimension_id !== "acceptance_coverage" ||
      row.semantic_identity?.population !== "absent" ||
      row.evidence?.carrier_absent !== true ||
      !Array.isArray(row.evidence.criteria) || row.evidence.criteria.length === 0 ||
      row.evidence.criteria.some(({ criterion_identity: identity }) =>
        typeof identity !== "string") ||
      owner?.carrier != null ||
      typeof owner?.source?.source_kind !== "string" ||
      typeof owner?.source?.content_digest !== "string" ||
      typeof owner?.selected_unit_digest !== "string") return null;
  return {
    semantic_owner: "acceptance_coverage",
    response_kinds: ["acceptance_coverage_population"],
    row_authoring: coverageAuthoringOffer(
      coverageAcceptanceFieldContracts(), "acceptance_coverage", true),
    owner_context: {
      selected_unit: owner.selectedUnit ?? null,
      carrier_identity: {
        carrier_kind: "controlled-acceptance",
        wk_id: owner.wkId,
        focus: owner.focus ?? null,
        selected_unit: owner.selectedUnit ?? null,
        content_digest: null
      },
      source_identity: {
        source_kind: owner.source.source_kind,
        content_digest: owner.source.content_digest
      },
      expected_unit_digest: owner.selected_unit_digest,
      criteria: structuredClone(row.evidence.criteria)
    }
  };
}

function acceptanceDescriptor(dimension, row) {
  const criterionIdentity = row.semantic_identity?.criterion_identity;
  const owner = dimension.owner_result;
  if (dimension.dimension_id !== "acceptance_coverage" ||
      typeof criterionIdentity !== "string" || owner?.carrier === null ||
      typeof owner?.carrier?.content_digest !== "string" ||
      !Array.isArray(owner?.changed_bindings) || owner.changed_bindings.length > 0 ||
      typeof owner?.source?.source_kind !== "string" ||
      typeof owner?.source?.content_digest !== "string" ||
      typeof owner?.authoring_identity !== "string" ||
      typeof owner?.unit_digest !== "string") return null;
  return {
    semantic_owner: "acceptance_coverage",
    response_kinds: ["acceptance_coverage"],

    row_authoring: projectControlledContractAcceptanceRowAuthoring({
      ownerResult: owner, criterionIdentity }),
    owner_context: {
      selected_unit: owner.selectedUnit ?? null,
      criterion_identity: criterionIdentity,
      carrier_identity: {
        carrier_kind: "controlled-acceptance",
        wk_id: owner.wkId,
        focus: owner.focus ?? null,
        selected_unit: owner.selectedUnit ?? null,
        content_digest: owner.carrier.content_digest
      },
      source_identity: {
        source_kind: owner.source.source_kind,
        content_digest: owner.source.content_digest
      },
      expected_unit_digest: owner.unit_digest,
      expected_authoring_identity: owner.authoring_identity,
      expected_content_digest: owner.carrier.content_digest
    }
  };
}

function assessmentGap(candidate) {
  return candidate !== null && typeof candidate === "object" &&
    typeof candidate.diagnostic_id === "string" &&
    typeof candidate.state === "string" && candidate.state !== "pass" &&
    candidate.assessment_stage === "authoring" &&
    candidate.missing_carrier === undefined;
}

function assessmentExecutionRecovery(manifest, dimension) {
  if (dimension.dimension_id !== "contract_assessment") return null;
  const stage = dimension.owner_result?.stage_assessment ?? null;
  if (stage === null) return null;
  const authoringPending = stage?.authoring_state !== "complete";
  const executionPending = stage?.execution_gap_count > 0;
  if (!authoringPending && !executionPending) return null;
  const projected = dimension.owner_result?.first_actionable_gap_count ?? 0;
  const omitted = dimension.owner_result?.omitted_actionable_gap_count ?? 0;
  const authoringGapCount = authoringPending ? projected + omitted : 0;
  const runtime = manifest.dimensions.find(({ dimension_id: id }) =>
    id === "runtime_proof_declaration");
  const invalid = (runtime?.rows ?? []).filter(({ state, evidence }) =>
    evidence?.runtime_eligible === true && state !== "complete");
  const reasons = [...new Set(invalid.flatMap(({ reason_codes: codes }) => codes))].sort();
  if (authoringPending) return {
    status: executionPending ? "authoring_and_runtime_verification_required"
      : "authoring_required",
    authoring_gap_count: authoringGapCount,
    authoring_gaps_returned: projected,
    authoring_gaps_omitted: omitted,
    runtime_verification_pending: executionPending,
    runtime_definition_invalid: reasons.length > 0,
    ...(reasons.length === 0 ? {} : { reason_codes: reasons }),
    explanation: "The complete assessment stage says authoring remains incomplete. Resolve the authoring question through the emitted workbench action or retrieve the omitted assessment details; runtime witnesses are a separate later concern.",
    supported_next_call: null
  };
  return {
    status: reasons.length > 0 ? "definition_invalid" : "runtime_verification_required",
    reason_codes: reasons,
    missing_evidence: "authenticated_test_validity_witnesses",
    explanation: "Runtime candidate, falsifier and traversal observations are never authored. " +
      "They are produced by executing the declared tests through workspace_verify_proof.",
    prerequisite: reasons.length > 0
      ? "Repair the invalid declarative test selector through the runtime-test replacement continuation, then implement the declared test and run workspace_verify_proof."
      : "Implement the declared test in the bound node_test target, then run workspace_verify_proof against the candidate.",
    supported_next_call: reasons.length > 0 ? null : {
      tool: "workspace_verify_proof", arguments: { subject: manifest.subject.wk_id }
    }
  };
}

function assessmentDescriptor(dimension, row, manifest) {
  const reauthoring = dimension.owner_result?.current_definition_reauthoring ?? null;
  const reauthoringDigest = dimension.owner_result?.source?.controlled_contract_digest;
  if (dimension.dimension_id === "contract_assessment" &&
      reauthoring?.schema_version ===
        "controlled-contract-current-definition-reauthoring.v1" &&
      typeof reauthoringDigest === "string") return {
    semantic_owner: "test_proof",
    response_kinds: ["current_definition_reauthoring"],
    row_authoring: currentDefinitionReauthoringOffer(reauthoring),
    owner_context: {
      expected_content_digest: reauthoringDigest,
      qualification: structuredClone(reauthoring)
    }
  };
  const digest = dimension.owner_result?.source?.controlled_contract_digest;

  const facts = (manifest?.dimensions ?? []).find(({ dimension_id: id }) =>
    id === "authoring_stage")?.owner_result?.contract_authoring ?? null;
  if (dimension.dimension_id !== "contract_assessment" ||
      typeof digest !== "string" || facts === null) return null;
  const gaps = (row.evidence?.first_actionable_gaps ?? []).filter(assessmentGap);
  if (gaps.length === 0) return null;
  return {
    semantic_owner: "contract_carrier",
    response_kinds: ["contract_requirements"],
    row_authoring: {
      ...contractRequirementAuthoring(facts,
        CONTRACT_REQUIREMENT_OFFER_BYTES.extension),

      unproven: Object.freeze(gaps.map(({ code, state, axis, subject_id: subject }) =>
        Object.freeze({ code, state, axis: axis ?? null, subject: subject ?? null })))
    },
    owner_context: {

      expected_content_digest: digest
    }
  };
}

function runtimeDescriptor(dimension, row, manifest) {
  if (dimension.dimension_id !== "runtime_proof_declaration" ||
      row.evidence?.runtime_eligible !== true ||
      row.evidence?.proof_repairable !== true ||
      typeof row.semantic_identity?.verification_id !== "string" ||
      row.reason_codes.includes("runtime_proof_identity_duplicate") ||
      typeof dimension.owner_result?.source_identity?.content_digest !== "string") return null;
  const definitionDefect = ["stable_test_proof_selector_invalid",
    "runtime_proof_binding_missing"].some((reason) => row.reason_codes.includes(reason));
  const unresolvedMapping = row.evidence.mapping_completeness?.classification ===
    "unresolved";
  const elective = !definitionDefect && row.state === "complete" && unresolvedMapping;
  if (!definitionDefect && !elective) return null;
  const digest = dimension.owner_result.source_identity.content_digest;

  const declared = row.evidence.declared_runtime_test ?? null;
  if (declared === null) return {
    semantic_owner: "verification_bundle",
    response_kinds: ["verification_bundle"],
    owner_context: { verification_id: row.semantic_identity.verification_id,
      expected_content_digest: digest }
  };

  const offer = (manifest?.dimensions ?? []).find(({ dimension_id: id }) =>
    id === "authoring_stage")?.owner_result?.contract_authoring?.runtime_test ?? null;
  return {
    ...(elective ? { elective: true } : {}),
    semantic_owner: "test_proof",
    response_kinds: ["runtime_test_replacement"],
    ...(offer === null ? {} : { row_authoring: {
      ...runtimeTestReplacementAuthoring(
        { runtime_test: offer }, row.semantic_identity.verification_id, declared),
      guidance: {
        unresolved_fact: {
          owner: "obligation_coverage",
          classification: "unresolved",
          reason_code: row.evidence.mapping_completeness.reason_code,
          obligation_ids: structuredClone(row.evidence.obligation_ids ?? [])
        },
        supported_correction: {
          owner: "test_proof",
          response_kind: "runtime_test_replacement",
          effect: "edit_the_selected_existing_proof_only"
        },
        mapping_correction: {
          owner: "obligation_coverage",
          response_kinds: ["mapping_selection", "explicit_gap_rationale"],
          prerequisite: "Supply a mapping only when the authored semantics establish it; retaining an honest explicit gap does not block this proof edit."
        },
        authority: "none"
      }
    } }),
    owner_context: {
      verification_claim_id: row.semantic_identity.verification_id,
      expected_content_digest: digest
    }
  };
}

function authoringDescriptor(manifest, dimension, row) {
  if (dimension.dimension_id !== "authoring_stage") return null;
  const facts = dimension.owner_result?.contract_authoring ?? null;
  if (row.evidence?.action === "add_requirements" &&
      row.evidence?.elective === true && facts !== null &&
      typeof row.evidence.current_contract_content_digest === "string") return {
    elective: true,
    semantic_owner: "contract_carrier",
    response_kinds: ["contract_requirements"],
    row_authoring: contractRequirementAuthoring(facts),
    owner_context: {
      expected_content_digest: row.evidence.current_contract_content_digest,
      action: "add_requirements"
    }
  };
  if (typeof row.evidence?.stage !== "string") return null;
  const state = row.evidence.stage;
  const action = dimension.owner_result?.next_calls?.[0] ?? null;
  const arguments_ = isPlainObject(action?.arguments) ? action.arguments : {};
  const activeContinuation = dimension.owner_result?.continuation ?? null;
  if (dimension.dimension_id === "authoring_stage" &&
      manifest.subject.controlled_acceptance_state === "absent") return {
    semantic_owner: "proof_posture",
    response_kinds: ["declare_controlled_acceptance_applies",
      "explicitly_opt_out_controlled_acceptance"],
    owner_context: {
      expected_record_source_digest:
        manifest.subject.record_source_digest ?? null
    }
  };

  if (state === "contract_required") {
    const prerequisite = row.evidence.unresolved_decisions?.failed_prerequisite;
    if (prerequisite !== "canonical_contract_absent" || facts === null) return null;
    return { semantic_owner: "contract_carrier",
      response_kinds: ["contract_requirements"],

      row_authoring: contractRequirementAuthoring(facts),
      owner_context: {

        expected_content_digest: null,
        failed_prerequisite: prerequisite,
        expected_record_source_digest:
          manifest.subject.record_source_digest ?? null
      } };
  }
  if (state === "verification_graph_required") {
    const operation = arguments_.operations?.[0];
    if (!isPlainObject(operation) || typeof operation.verification_id !== "string" ||
        typeof arguments_.expected_content_digest !== "string") return null;

    if (dimension.owner_result?.unresolved_decisions?.continuation_admissible
      === false) return null;
    if (dimension.owner_result?.unresolved_decisions
      ?.addressed_verification_id !== operation.verification_id) return null;
    return { semantic_owner: "verification_bundle",
      response_kinds: ["verification_bundle"], owner_context: {
        verification_id: operation.verification_id,
        expected_content_digest: arguments_.expected_content_digest
      } };
  }
  if (state === "stable_test_proof_required") {
    const operation = arguments_.operations?.[0];
    if (!isPlainObject(operation) || typeof operation.verification_id !== "string" ||
        typeof arguments_.expected_content_digest !== "string") return null;
    return { semantic_owner: "test_proof",
      response_kinds: ["runtime_test_replacement"],
      ...(facts === null ? {} : { row_authoring:
        runtimeTestReplacementAuthoring(facts, operation.verification_id) }),
      owner_context: { verification_claim_id: operation.verification_id,
        expected_content_digest: arguments_.expected_content_digest } };
  }

  const referenceAuthoring = dimension.owner_result?.reference_authoring ?? null;
  if (referenceAuthoring?.status === "unique" &&
      referenceAuthoring.authorable_role_count > 0) {
    return { semantic_owner: "contract_reference",
      response_kinds: ["advance_authoring"],
      owner_context: {
        selected_pack: structuredClone(referenceAuthoring.selected_pack),
        candidate_population_digest:
          referenceAuthoring.candidate_population_digest,
        required_roles: structuredClone(referenceAuthoring.required_roles),
        expected_record_source_digest:
          manifest.subject.record_source_digest ?? null
      } };
  }

  if (state === "proof_authoring_required") {
    const proofSelection = facts?.proof_selection ?? null;
    const firstPack = proofSelection?.packs?.[0] ?? null;
    return {
      semantic_owner: "proof_authoring",
      response_kinds: ["proof_authoring_selection", "reference_candidates"],

      ...(facts === null ? {} : { row_authoring: {
        schema_version: "controlled-contract-proof-selection-authoring.v1",
        response_kind: "proof_authoring_selection",
        declared_referents: structuredClone(facts.declared_referents),
        guidance: proofSelection === null ? null : Object.freeze({
          schema_version: proofSelection.schema_version,
          intent_accounting: structuredClone(proofSelection.intent_accounting),
          pack_accounting: structuredClone(proofSelection.pack_accounting),
          selection_decision: proofSelection.selection_decision,
          preview: Object.freeze({
            intents: structuredClone(proofSelection.intents.slice(0, 1)),
            packs: Object.freeze(firstPack === null ? [] : [Object.freeze({
              selected_pack: structuredClone(firstPack.selected_pack),
              requested_intents: structuredClone(firstPack.requested_intents),
              guarantee: firstPack.guarantee,
              capability_limits: structuredClone(firstPack.capability_limits),

              required_bindings: Object.freeze({
                reference_role_count: firstPack.detail_counts.reference_roles,
                number_role_count: firstPack.detail_counts.number_roles,
                response_shapes:
                  structuredClone(firstPack.required_bindings.response_shapes)
              })
            })])
          }),
          complete_detail: Object.freeze({ collection: "dimensions",
            selector: Object.freeze({ id: "authoring_stage" }),
            field_path: Object.freeze(["owner_result", "contract_authoring",
              "proof_selection"]),
            exact_same_snapshot: true })
        })
      } }),
      owner_context: {
        expected_record_source_digest:
          manifest.subject.record_source_digest ?? null
      }
    };
  }
  if (["evaluation_input_ready", "proof_plan_request_ready"].includes(state) &&
      typeof arguments_.continuation === "string") return {
    semantic_owner: "authoring_continuation", response_kinds: ["advance_authoring"],
    owner_context: { continuation: arguments_.continuation,
      expected_stage: arguments_.expected_stage ?? state }
  };
  if (state === "proof_graph_required" && typeof arguments_.continuation === "string") {
    return { semantic_owner: "proof_graph", response_kinds: ["advance_authoring"],
      owner_context: { continuation: arguments_.continuation } };
  }
  if (["proof_plan_ready", "proof_plan_rebuild_required"].includes(state)) return {
    semantic_owner: "proof_plan", response_kinds: ["advance_authoring"],
    owner_context: { expected_content_digest: arguments_.expected_content_digest ?? null,
      ...(activeContinuation === null ? {} : {
        authoring_continuation: activeContinuation
      }) }
  };
  return null;
}

export function semanticDescriptor(manifest, dimension, row) {
  return authoringDescriptor(manifest, dimension, row) ??
    obligationPopulationDescriptor(dimension, row) ??
    obligationDescriptor(dimension, row) ??
    acceptancePopulationDescriptor(dimension, row) ??
    acceptanceDescriptor(dimension, row) ??
    assessmentDescriptor(dimension, row, manifest) ??
    runtimeDescriptor(dimension, row, manifest);
}

function classifyRow(manifest, dimension, row) {
  const recovery = assessmentExecutionRecovery(manifest, dimension);
  if (recovery !== null) row = { ...row, evidence: { ...row.evidence, recovery } };
  let descriptor = semanticDescriptor(manifest, dimension, row);
  if (descriptor !== null) descriptor = { ...descriptor,
    row_authoring: withControlledContractAnswerLimits(
      descriptor.row_authoring, descriptor.response_kinds) };
  const dispositionMissing = dimension.dimension_id === "authoring_stage" &&
    manifest.subject.controlled_acceptance_state === "absent";
  const incomplete = dispositionMissing ||
    !["complete", "not_applicable"].includes(row.state);
  const elective = descriptor?.elective === true;
  if (descriptor === null || (!incomplete && !elective)) {
    return { descriptor: null, row: { ...structuredClone(row), ...(incomplete ? {
      non_actionable_reason: obligationNonActionableReason(dimension, row) ??
        "no_single_incumbent_semantic_transition"
    } : {}) } };
  }
  return { descriptor, row: { ...structuredClone(row),
    ...(dispositionMissing ? { state: "missing",
      reason_codes: ["controlled_acceptance_disposition_missing"] } : {}),

    ...(descriptor.row_authoring == null ? {} : { evidence: {
      ...structuredClone(row.evidence ?? {}),
      authoring: structuredClone(descriptor.row_authoring) } }),
    eligible_response_forms: structuredClone(descriptor.response_kinds) } };
}

function partition(dimensions, actionableRowIds, electiveRowIds = new Set()) {
  const incompleteRows = dimensions.flatMap(({ rows }) => rows.filter(
    ({ state }) => !["complete", "not_applicable"].includes(state)
  )).sort((left, right) => left.row_id.localeCompare(right.row_id));
  const actionableRows = incompleteRows.filter(({ row_id: rowId }) =>
    actionableRowIds.has(rowId));
  const nonActionableRows = incompleteRows.filter(({ row_id: rowId }) =>
    !actionableRowIds.has(rowId));
  const electiveActions = dimensions.flatMap(({ rows }) => rows).filter(
    ({ row_id: rowId }) => electiveRowIds.has(rowId));
  return Object.freeze({
    incomplete_row_count: incompleteRows.length,
    actionable_row_count: actionableRows.length, actionable_rows: actionableRows,
    non_actionable_row_count: nonActionableRows.length,
    non_actionable_rows: nonActionableRows,
    elective_action_count: electiveActions.length,
    elective_actions: electiveActions
  });
}

export function classifyControlledContractDesignWorkbenchActionability(manifest) {
  const descriptors = new Map();
  const electiveRowIds = new Set();
  const dimensions = manifest.dimensions.map((dimension) => {
    const rows = dimension.rows.map((row) => {
      const classified = classifyRow(manifest, dimension, row);
      if (classified.descriptor !== null) {
        descriptors.set(row.row_id, classified.descriptor);
        if (classified.descriptor.elective === true) electiveRowIds.add(row.row_id);
      }
      return classified.row;
    });
    return { ...structuredClone(dimension), rows };
  });
  return Object.freeze({ dimensions, descriptors, electiveRowIds,
    ...partition(dimensions, new Set([...descriptors.keys()].filter(
      (id) => !electiveRowIds.has(id))), electiveRowIds) });
}

export function projectClassifiedControlledContractDesignWorkbench(manifest,
  classification) {
  return Object.freeze({ ...structuredClone(manifest),
    dimensions: classification.dimensions,
    incomplete_row_count: classification.incomplete_row_count,
    actionable_row_count: classification.actionable_row_count,
    actionable_rows: classification.actionable_rows,
    non_actionable_row_count: classification.non_actionable_row_count,
    non_actionable_rows: classification.non_actionable_rows,
    elective_action_count: classification.elective_action_count,
    elective_actions: classification.elective_actions });
}

export function applyControlledContractDesignWorkbenchActionability(manifest) {
  return projectClassifiedControlledContractDesignWorkbench(manifest,
    classifyControlledContractDesignWorkbenchActionability(manifest));
}

export function bindControlledContractDesignWorkbenchContinuations(manifest,
  classification, continuationByRowId, unavailableByRowId = new Map()) {
  const dimensions = classification.dimensions.map((dimension) => ({
    ...structuredClone(dimension),
    rows: dimension.rows.map((row) => {
      const attempt = unavailableByRowId.get(row.row_id);
      if (attempt) return { ...row, eligible_response_forms: [],
        non_actionable_reason: attempt.status === "applied"
          ? "controlled_contract_authoring_continuation_stale"
          : "controlled_contract_authoring_continuation_outcome_unestablished",
        evidence: { ...row.evidence, retained_attempt: structuredClone(attempt) } };
      const continuation = continuationByRowId.get(row.row_id);
      return continuation === undefined
        ? row : { ...row, continuation: structuredClone(continuation) };
    })
  }));
  return Object.freeze({ ...structuredClone(manifest), dimensions,
    ...partition(dimensions, new Set([...classification.descriptors.keys()]
      .filter((id) => !classification.electiveRowIds?.has(id) &&
        !unavailableByRowId.has(id))), new Set([...classification.electiveRowIds ?? []]
      .filter((id) => !unavailableByRowId.has(id)))) });
}
