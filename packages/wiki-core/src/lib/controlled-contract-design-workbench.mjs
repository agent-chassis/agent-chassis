import { resolveControlledContractDeclarationPopulation } from './controlled-contract-runtime-proof-eligibility.mjs';
import { createHash } from "node:crypto";

import {
  isAcceptanceCoverageComplete,
  projectStableTestProofSelector
} from "@agent-chassis/controlled-contract";
import {
  CONTROLLED_CONTRACT_AUTHORING_STAGES,
  CONTROLLED_CONTRACT_AUTHORING_TERMINAL_STAGE
} from "./controlled-contract-authoring-state.mjs";
import { projectControlledContractClaimSelectors } from
  "../operations/controlled-contract/contract-requirement-vocabulary.mjs";
import { projectControlledContractDeclaredRuntimeTest } from
  "../operations/controlled-contract/contract-requirement-runtime-proof.mjs";

import { coverageAdmittedComponentChoices } from
  "./controlled-contract-coverage-authoring-skeleton.mjs";

export const CONTROLLED_CONTRACT_DESIGN_WORKBENCH_VERSION =
  "controlled-contract-design-workbench.v1";

export const CONTROLLED_CONTRACT_DESIGN_WORKBENCH_OWNERS = Object.freeze({
  authoring_stage: "deriveControlledContractAuthoringState",
  work_record_validation: "validateWorkRecord",
  contract_assessment: "projectControlledContractProofAssessmentSummary",
  obligation_coverage: "resolveObligationCoverageFacts",
  acceptance_coverage: "deriveControlledContractAcceptanceCoverage",
  runtime_proof_declaration: "projectStableTestProofSelector",
  omitted_obligations: "deriveControlledContractDesignWorkbench",
  cross_owner_consistency: "deriveControlledContractDesignWorkbench"
});

const DIMENSION_ORDER = Object.freeze(Object.keys(
  CONTROLLED_CONTRACT_DESIGN_WORKBENCH_OWNERS
));
const COUNT_STATES = Object.freeze([
  "complete", "missing", "stale", "conflicting", "not_applicable"
]);

const COMPLETE_ASSESSMENT_CODE = /^structure_proven__profile_proven$/u;

export class ControlledContractDesignWorkbenchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ControlledContractDesignWorkbenchError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new ControlledContractDesignWorkbenchError(code, message, details);
}

function compare(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compare).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(
    JSON.stringify(canonicalValue(value))
  ).digest("hex")}`;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function object(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("controlled_contract_design_workbench_input_invalid", `${name} must be an object`, {
      field: name
    });
  }
  return value;
}

function text(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    fail("controlled_contract_design_workbench_input_invalid",
      `${name} must be a non-empty string`, { field: name });
  }
  return value;
}

function coverageCriterionProjection(criteria) {
  return (criteria ?? []).map((entry) => ({
    criterion_identity: entry.identity ?? entry.criterion_identity ?? null,
    source_locator: entry.source_locator ?? null,
    position: entry.position ?? null,
    criterion: entry.criterion ?? entry.text ?? null
  }));
}

function joinedObligationProjection(contract, obligation) {
  const nodeIds = new Set(obligation?.controlled_contract_node_ids ?? []);
  const claims = projectControlledContractClaimSelectors(contract ?? null);
  const byId = new Map(claims.map((claim) => [claim.selector, claim]));
  const requirements = claims.filter((claim) => claim.nature === "behavior" &&
    nodeIds.has(claim.selector));
  return Object.freeze({
    schema_version: "controlled-contract-obligation-join.v1",
    requirement_count: requirements.length,
    rows: Object.freeze(requirements.map((requirement) => Object.freeze({
      requirement: structuredClone(requirement),
      verification: Object.freeze(requirement.verified_by.map((verification) =>
        structuredClone(byId.get(verification) ?? verification))),
      obligation: Object.freeze({
        obligation_id: obligation.obligation_id,
        criterion_selector: structuredClone(obligation.criterion_selector),
        statement: obligation.statement,
        controlled_contract_node_ids: Object.freeze([...nodeIds])
      })
    })))
  });
}

function row(dimensionId, semanticIdentity, state, reasonCodes, evidence,
  { dependencies = [], responseForms = [] } = {}) {
  if (!COUNT_STATES.includes(state)) fail(
    "controlled_contract_design_workbench_state_invalid",
    "workbench row state is outside the closed accounting vocabulary",
    { dimension_id: dimensionId, state }
  );
  const identity = structuredClone(semanticIdentity);
  return deepFreeze({
    row_id: `${dimensionId}:${digest(identity).slice(7)}`,
    semantic_identity: identity,
    state,
    reason_codes: [...new Set(reasonCodes.filter(Boolean))].sort(compare),
    evidence: structuredClone(evidence ?? {}),
    dependencies: structuredClone(dependencies),
    eligible_response_forms: structuredClone(responseForms)
  });
}

function accountingFacts(value, path = "", result = []) {
  if (value === null || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    value.forEach((item, index) => accountingFacts(item, `${path}/${index}`, result));
    return result;
  }
  const denominatorMap = /\/(?:counts|totals|denominators)$/u.test(path);
  const denominators = Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    Number.isSafeInteger(item) && item >= 0 && (denominatorMap ||
      key.includes("count") || key.includes("total") ||
      key.includes("returned") || key.includes("omitted"))
  ));
  const continuation = Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    (key.includes("continuation") || key.includes("next_call") ||
      key === "lossless_report") && item !== null && item !== undefined
  ).map(([key, item]) => [key, structuredClone(item)]));
  if (Object.keys(denominators).length > 0 || Object.keys(continuation).length > 0) {
    result.push(deepFreeze({ path: path || "/", denominators, continuation }));
  }
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && typeof item === "object") {
      accountingFacts(item, `${path}/${key}`, result);
    }
  }
  return result;
}

function hasLosslessContinuation(result) {
  return accountingFacts(result).some(({ continuation }) =>
    Object.keys(continuation).length > 0);
}

function dimension(dimensionId, ownerIdentity, ownerResult, rows, accounting = {}) {
  const sortedRows = [...rows].sort((left, right) => compare(left.row_id, right.row_id));
  if (new Set(sortedRows.map(({ row_id: id }) => id)).size !== sortedRows.length) fail(
    "controlled_contract_design_workbench_row_identity_duplicate",
    "a workbench dimension contains duplicate stable row identities",
    { dimension_id: dimensionId }
  );
  const total = accounting.total ?? sortedRows.length;
  const returned = accounting.returned ?? sortedRows.length;
  const omitted = accounting.omitted ?? total - returned;
  if (![total, returned, omitted].every((value) =>
    Number.isSafeInteger(value) && value >= 0) || returned + omitted !== total) fail(
    "controlled_contract_design_workbench_owner_accounting_invalid",
    "owner population accounting must be exact and non-negative",
    { dimension_id: dimensionId, total, returned, omitted }
  );
  let aggregateState = accounting.aggregateState ?? null;
  if (omitted > 0 && !hasLosslessContinuation(ownerResult)) {
    aggregateState = "conflicting";
  }
  const counts = Object.fromEntries(COUNT_STATES.map((state) => [state,
    aggregateState === null
      ? sortedRows.filter((candidate) => candidate.state === state).length
      : state === aggregateState ? total : 0
  ]));
  const reconciliation = accounting.reconciliation ?? null;
  const incomplete = counts.missing + counts.stale + counts.conflicting;
  return deepFreeze({
    dimension_id: dimensionId,
    owner: CONTROLLED_CONTRACT_DESIGN_WORKBENCH_OWNERS[dimensionId],
    owner_identity: structuredClone(ownerIdentity),
    status: incomplete === 0 && reconciliation?.status !== "conflicting"
      ? "complete" : "incomplete",
    counts: { ...counts, total, returned, omitted },
    rows: sortedRows,
    owner_result: structuredClone(ownerResult),
    owner_accounting: accountingFacts(ownerResult),
    ...(reconciliation === null ? {} : {
      reconciliation: structuredClone(reconciliation)
    })
  });
}

function absentDimension(dimensionId, subject) {
  return dimension(dimensionId, subject, null, [row(
    dimensionId, { subject, state: "absent" }, "missing",
    [`${dimensionId}_absent`], { available: false }
  )]);
}

function authoringDimension(subject, result) {
  if (result === null) return absentDimension("authoring_stage", subject);
  object(result, "authoringState");
  if (!CONTROLLED_CONTRACT_AUTHORING_STAGES.includes(result.stage)) fail(
    "controlled_contract_design_workbench_owner_projection_invalid",
    "authoring state used an unknown incumbent stage", { stage: result.stage }
  );
  const state = result.stage === CONTROLLED_CONTRACT_AUTHORING_TERMINAL_STAGE
    ? "complete" : result.stage === "proof_plan_rebuild_required" ? "stale" : "missing";

  const reasonCode = typeof result.unresolved_decisions?.reason_code === "string"
    ? result.unresolved_decisions.reason_code : null;
  const rows = [row(
    "authoring_stage", { stage: result.stage }, state,
    state === "complete" ? []
      : reasonCode === null ? [result.stage] : [reasonCode, result.stage],
    { stage: result.stage, unresolved_decisions: result.unresolved_decisions ?? null },
    { dependencies: Object.values(result.selected_resources ?? {}) }
  )];
  const contract = result.selected_resources?.contract;
  if (typeof contract?.content_digest === "string") rows.push(row(
    "authoring_stage", { action: "add_requirements",
      contract_content_digest: contract.content_digest }, "not_applicable", [], {
      action: "add_requirements",
      elective: true,
      current_contract_content_digest: contract.content_digest
    }, { dependencies: [contract] }
  ));
  return dimension("authoring_stage", result.selected_resources ?? subject, result, rows);
}

function workRecordDimension(subject, result) {
  if (result === null) return absentDimension("work_record_validation", subject);
  if (!Array.isArray(result)) fail(
    "controlled_contract_design_workbench_owner_projection_invalid",
    "work-record validation must be the incumbent diagnostic population"
  );
  const diagnostics = result;
  const rows = diagnostics.length === 0 ? [row(
    "work_record_validation", { subject, validation: "clean" }, "complete", [],
    { diagnostic_count: 0 }
  )] : diagnostics.map((diagnostic, index) => row(
    "work_record_validation",
    { code: diagnostic?.code ?? "invalid_record", path: diagnostic?.path ?? null, index },
    "conflicting", [diagnostic?.code ?? "invalid_record"], diagnostic
  ));
  return dimension("work_record_validation", subject, result, rows);
}

function savedResolutionDimension(id, subject, result, resolution, source) {
  const rows = (resolution?.rows ?? []).map(entry => row(id,
    { obligation_id: entry.obligation_id }, result.source_current === false || result.sourceCurrent === false
      ? 'stale' : entry.status === 'valid' ? 'complete' : 'missing',
    entry.diagnostics.map(diagnostic => diagnostic.code), {
      obligation_id: entry.obligation_id, disposition: entry.disposition,
      input_status: entry.input_status, construction_status: entry.construction_status,
      diagnostics: structuredClone(entry.diagnostics),
      mapping_status: resolution.mapping === null ? 'unresolved' : 'complete'
    }));
  if (rows.length === 0) rows.push(row(id, { subject, population: source == null ? 'absent' : 'empty' },
    'missing', [source == null ? 'obligation_coverage_source_not_found' : 'obligation_coverage_population_empty'],
    { source_present: source != null, authored_count: 0 }));
  return dimension(id, source ?? subject, result, rows);
}

function assessmentDimension(subject, result) {
  if (result === null) return absentDimension("contract_assessment", subject);
  object(result, "contractAssessment");
  if (Object.hasOwn(result, 'saved_application_resolution')) return savedResolutionDimension(
    'contract_assessment', subject, result, result.saved_application_resolution,
    result.saved_applications?.source_digest ?? null);
  const sourceCurrent = result.source_current === true;
  const overallCode = result.state;
  const proven = typeof overallCode === "string" &&
    COMPLETE_ASSESSMENT_CODE.test(overallCode);
  const integrityState = result.cross_carrier_integrity?.state;
  const integrityClean = integrityState === "pass";
  const actionableGaps = result.first_actionable_gaps ?? [];
  if (!Array.isArray(actionableGaps)) fail(
    "controlled_contract_design_workbench_owner_projection_invalid",
    "contract-assessment actionable gaps must be an array"
  );
  const gapsClean = actionableGaps.length === 0;
  if (!Number.isSafeInteger(result.total_count) || result.total_count < 0 ||
      !Number.isSafeInteger(result.omitted_count) || result.omitted_count < 0 ||
      result.omitted_count > result.total_count) fail(
    "controlled_contract_design_workbench_owner_accounting_invalid",
    "contract-assessment population accounting must be exact and non-negative"
  );
  const populationEmpty = result.total_count === 0;
  const ownerPopulationRetrievable = result.omitted_count === 0 ||
    hasLosslessContinuation(result);

  const runtimeVerificationPending = !populationEmpty && sourceCurrent &&
    integrityClean && ownerPopulationRetrievable &&
    result.stage_assessment?.authoring_state === "complete" &&
    Number.isSafeInteger(result.stage_assessment?.execution_gap_count) &&
    result.stage_assessment.execution_gap_count > 0;
  const projectedGaps = actionableGaps.map((gap, index) => {
    if (gap === null || typeof gap !== "object" || Array.isArray(gap)) return gap;
    const { diagnostic_details: _details, diagnostics, ...rest } = gap;
    if (!diagnostics || typeof diagnostics !== "object") return structuredClone(rest);
    return {
      ...structuredClone(rest),
      diagnostics: {
        diagnostic_projection_version: diagnostics.diagnostic_projection_version,
        total_count: diagnostics.total_count,
        returned_count: diagnostics.returned_count,
        omitted_count: diagnostics.omitted_count,
        truncated: diagnostics.truncated,
        diagnostics: structuredClone((diagnostics.diagnostics ?? []).slice(0, 1)),
        complete_detail: {
          collection: "dimensions",
          selector: { id: "contract_assessment" },
          field_path: ["owner_result", "first_actionable_gaps", index,
            "diagnostic_details"],
          exact_same_snapshot: true
        }
      }
    };
  });
  const state = !sourceCurrent ? "stale" : populationEmpty ? "missing"
    : (proven && integrityClean && gapsClean && ownerPopulationRetrievable) ||
      runtimeVerificationPending
    ? "complete" : ["unevaluable", "assessment_unavailable"].includes(overallCode)
      ? "missing" : "conflicting";

  return dimension("contract_assessment", result.source ?? subject, result, [row(
    "contract_assessment", result.source ?? { subject, family: result.family ?? null }, state,
    state === "complete" ? [] : [populationEmpty && "contract_assessment_population_empty",
      !sourceCurrent && "assessment_source_stale", !proven && overallCode,
      !integrityClean && "cross_carrier_integrity_not_clean",
      !gapsClean && "assessment_actionable_gaps_present",
      !ownerPopulationRetrievable && "assessment_population_retrieval_missing"],
    { overall_code: overallCode, source_current: sourceCurrent,
      stage_assessment: result.stage_assessment,
      runtime_verification_pending: runtimeVerificationPending,
      runtime_verification_owner: "workspace_verify_proof",
      owner_population_retrievable: !populationEmpty && ownerPopulationRetrievable,
      cross_carrier_integrity: result.cross_carrier_integrity ?? null,
      first_actionable_gaps: projectedGaps }
  )]);
}

function obligationDimension(subject, result, testProofBindings, runtimeEligibility = null) {
  if (result === null) return absentDimension("obligation_coverage", subject);
  object(result, "obligationCoverage");
  if (Object.hasOwn(result, 'resolution')) return savedResolutionDimension(
    'obligation_coverage', subject, result, result.resolution, result.source);
  if (!Array.isArray(result.rows) || !Array.isArray(result.criteria)) fail(
    "controlled_contract_design_workbench_owner_projection_invalid",
    "obligation coverage must expose its complete row and criterion populations"
  );
  const currentIds = new Set((result.authoringApplicability?.criterion_relationships ?? [])
    .map(({ obligation_id: id }) => id));
  const duplicateIds = new Set(result.rows.map(({ obligation_id: id }) => id)
    .filter((id, index, values) => values.indexOf(id) !== index));
  const occurrences = new Map();
  const rows = result.rows.map((obligation, index) => {
    const current = result.sourceCurrent === true && currentIds.has(obligation?.obligation_id);
    const duplicated = duplicateIds.has(obligation?.obligation_id);
    const proofKind = obligation?.proof?.kind;
    const obligationNodeIds = new Set(obligation?.controlled_contract_node_ids ?? []);
    const eligibility = runtimeEligibility?.find(({ obligation_id: id }) =>
      id === obligation?.obligation_id) ?? null;
    const applicableProofIds = eligibility?.classification === "runtime" &&
      typeof eligibility.verification_id === "string"
      ? (testProofBindings ?? []).filter(({ verification_claim_id: id }) =>
        id === eligibility.verification_id).map(({ verification_claim_id: id }) => id)
      : eligibility === null && proofKind === "pack_mapping"
        ? (testProofBindings ?? []).filter(({ verification_claim_id: id }) =>
          obligationNodeIds.has(id)).map(({ verification_claim_id: id }) => id)
        : [];
    const runtimeApplicable = eligibility === null
      ? proofKind === "pack_mapping" : eligibility.classification === "runtime";
    const eligibilityConflict = eligibility?.classification === "conflicting";
    const proofJoinInvalid = proofKind === "pack_mapping"
      ? runtimeApplicable ? applicableProofIds.length !== 1 : eligibilityConflict
      : proofKind === "explicit_gap"
        ? eligibilityConflict : true;
    const unresolvedRuntimeMapping = proofKind === "explicit_gap" && runtimeApplicable;
    const state = duplicated || proofJoinInvalid ? "conflicting" : !current ? "stale"
      : unresolvedRuntimeMapping ? "missing"
        : proofKind === "explicit_gap" ? "not_applicable" : "complete";
    const occurrence = occurrences.get(obligation?.obligation_id) ?? 0;
    occurrences.set(obligation?.obligation_id, occurrence + 1);
    const semanticIdentity = {
      obligation_id: obligation?.obligation_id ?? `invalid-${index}`,
      ...(occurrence > 0 ? { duplicate_ordinal: occurrence } : {})
    };
    return row("obligation_coverage", semanticIdentity, state,
      [duplicated && "obligation_coverage_obligation_id_duplicate",
        !current && (result.staleReasons?.[0] ?? "obligation_coverage_not_current"),
        !["pack_mapping", "explicit_gap"].includes(proofKind) &&
          "obligation_evidence_disposition_invalid",
        eligibilityConflict && eligibility.reason_code,
        proofKind === "pack_mapping" && runtimeApplicable &&
          applicableProofIds.length === 0 &&
          "obligation_runtime_proof_binding_missing",
        proofKind === "pack_mapping" && runtimeApplicable &&
          applicableProofIds.length > 1 &&
          "obligation_runtime_proof_binding_ambiguous",
        unresolvedRuntimeMapping && "explicit_gap"],
      { ...obligation,
        joined_requirement_verification_obligation: joinedObligationProjection(
          result.contract?.content ?? null, obligation),
        runtime_eligibility: eligibility,
        mapping_completeness: {
          classification: eligibility?.mapping_classification ??
            (proofKind === "explicit_gap" ? "unresolved" : "mapped"),
          reason_code: eligibility?.mapping_reason_code ??
            (proofKind === "explicit_gap" ? `obligation_${obligation.proof.gap_kind}` : null)
        },
        applicable_runtime_proof_ids: applicableProofIds },
      { dependencies: obligation?.controlled_contract_node_ids ?? [] }
    );
  });
  if (rows.length === 0 || result.criteria.length === 0) rows.push(row(
    "obligation_coverage", { subject, population: "empty" }, "missing",
    [rows.length === 0 && "obligation_coverage_population_empty",
      result.criteria.length === 0 && "obligation_criterion_population_empty"],

    { row_count: result.rows.length, criterion_count: result.criteria.length,
      carrier_absent: result.source === null,
      criteria: coverageCriterionProjection(result.criteria),

      contract_claims: projectControlledContractClaimSelectors(
        result.contract?.content ?? null),

      admitted_pack_components: admittedPackComponentProjection(
        result.selectedPacks) }
  ));
  return dimension("obligation_coverage",
    result.prospectiveIdentity ?? result.sourceLocator ?? subject, result, rows);
}

function admittedPackComponentProjection(selectedPacks, limit = 32) {
  const components = coverageAdmittedComponentChoices(selectedPacks);
  return Object.freeze({
    total: components.length,
    returned: Math.min(components.length, limit),
    omitted: Math.max(0, components.length - limit),
    items: Object.freeze(components.slice(0, limit)),
    ...(components.length > limit ? { retrieval: { collection: "dimensions",
      selector: { id: "obligation_coverage" },
      field_path: ["owner_result", "coverage_authoring", "admitted_pack_components"] } } : {})
  });
}

function acceptanceDimension(subject, result) {
  if (result?.obligationResolution?.mapping === null) return savedResolutionDimension(
    'acceptance_coverage', subject, result, result.obligationResolution, result.source);
  if (result === null) return absentDimension("acceptance_coverage", subject);
  object(result, "acceptanceCoverage");
  const evaluation = result.evaluation;
  if (!evaluation || !Array.isArray(evaluation.states)) fail(
    "controlled_contract_design_workbench_owner_projection_invalid",
    "acceptance coverage must expose the incumbent evaluator result"
  );
  if (!Array.isArray(result.criterion_axes) ||
      result.criterion_axes.length !== evaluation.states.length) fail(
    "controlled_contract_design_workbench_owner_projection_invalid",
    "acceptance criterion axes must positionally match the evaluator population"
  );
  const rows = evaluation.states.map((entry, index) => {
    const facts = result.criterion_axes[index];
    if (facts.criterionIdentity !== entry.criterion_identity || entry.position !== index) fail(
      "controlled_contract_design_workbench_owner_projection_invalid",
      "acceptance criterion axes and evaluator identities are positionally inconsistent",
      { index, criterion_identity: entry.criterion_identity }
    );
    const states = [entry.state, facts.structuralVerification,
      facts.implementationOwnership, facts.verificationOwnership,
      facts.scopeFeasibility].filter(Boolean);
    const state = states.includes("stale") ? "stale"
      : states.includes("uncovered") ? "missing"
        : states.every((value) => value === "covered") ? "complete" : "conflicting";
    return row("acceptance_coverage",
      { criterion_identity: entry.criterion_identity ?? `invalid-${index}`,
        position: entry.position ?? index }, state,
      states.filter((value) => value !== "covered"),
      { evaluation: entry, criterion_axes: facts }
    );
  });
  rows.push(...(evaluation.unmapped_mandatory_node_ids ?? []).map((nodeId) => row(
    "acceptance_coverage", { unmapped_mandatory_node_id: nodeId }, "missing",
    ["unmapped_mandatory_node"], { node_id: nodeId }
  )));
  rows.push(...(evaluation.unknown_mappings ?? []).map((mapping, index) => row(
    "acceptance_coverage", { unknown_mapping: mapping.index ?? index }, "conflicting",
    ["unknown_mapping"], mapping
  )));
  if (rows.length === 0) rows.push(row(
    "acceptance_coverage", { subject, population: "empty" }, "missing",
    ["acceptance_coverage_population_empty"],
    { criterion_count: 0, owner_complete: isAcceptanceCoverageComplete(evaluation) }
  ));

  if (result.carrier === null && (result.criteria_with_locators ?? []).length > 0) {
    rows.push(row("acceptance_coverage", { subject, population: "absent" }, "missing",
      ["acceptance_coverage_carrier_absent"],
      { criterion_count: result.criteria_with_locators.length, carrier_absent: true,
        criteria: coverageCriterionProjection(result.criteria_with_locators),
        contract_claims: projectControlledContractClaimSelectors(
          result.contract?.content ?? null) }));
  }
  return dimension("acceptance_coverage",
    result.authoring_identity ?? subject, result, rows);
}

function declareRuntimeProof(binding) {
  try {
    if (binding === null || binding === undefined) throw Object.assign(new Error(
      "runtime-eligible obligation has no stable test-proof binding"), {
      code: "runtime_proof_binding_missing"
    });
    const selector = projectStableTestProofSelector(binding);
    return { status: "declared", reason: "declarative_selector",
      selector: { name: selector.name, nesting: selector.nesting } };
  } catch (error) {
    return { status: "invalid", reason: error?.code ?? "stable_test_proof_selector_invalid",
      selector: null,
      error: { code: error?.code ?? null, message: error?.message ?? String(error) } };
  }
}

function runtimeDeclarationDimension(subject, bindings, obligationCoverage, sourceIdentity,
  eligibility = null) {
  if (bindings === null) return absentDimension("runtime_proof_declaration", subject);
  if (!Array.isArray(bindings)) fail(
    "controlled_contract_design_workbench_owner_projection_invalid",
    "runtime proof declaration requires the complete stable proof-binding population"
  );
  const duplicateIds = new Set(bindings.map(({ verification_claim_id: id }) => id)
    .filter((id, index, values) => values.indexOf(id) !== index));
  const bindingByVerification = new Map(bindings.map((binding) =>
    [binding.verification_claim_id, binding]));
  const { applicability, population } = resolveControlledContractDeclarationPopulation(
    bindings, obligationCoverage, eligibility);
  const rows = population.map((eligibilityRow, index) => {
    const binding = eligibilityRow.binding ?? bindingByVerification.get(eligibilityRow.verification_id) ?? null;
    if (eligibilityRow.classification !== "runtime") {
      const conflicting = eligibilityRow.classification === "conflicting";
      const unresolved = eligibilityRow.classification === "unresolved";
      return row("runtime_proof_declaration", {
        ...(eligibilityRow.obligation_id == null ? {} : { obligation_id: eligibilityRow.obligation_id }),
        test_proof_id: eligibilityRow.test_proof_id ?? null, index,
        ...(eligibilityRow.verification_id === null ? {} : {
          verification_id: eligibilityRow.verification_id })
      }, conflicting ? "conflicting" : unresolved ? "missing" : "not_applicable",
      [eligibilityRow.reason_code], { ...structuredClone(Object.fromEntries(
          Object.entries(eligibilityRow).filter(([key]) => key !== 'binding'))),
        declaration: binding == null ? null : declareRuntimeProof(binding),
        runtime_eligible: false, execution_evidence: "owned_by_workspace_verify_proof",
        admissibility_effect: "none" });
    }
    const declaration = declareRuntimeProof(binding);
    const duplicated = duplicateIds.has(binding?.verification_claim_id);
    const bindingIndex = binding === null ? -1 : bindings.indexOf(binding);
    const duplicateOrdinal = bindingIndex < 0 ? 0 : bindings.slice(0, bindingIndex)
      .filter(({ verification_claim_id: id }) => id === binding.verification_claim_id).length;
    const matchingObligations = typeof eligibilityRow.obligation_id === "string"
      ? (obligationCoverage?.rows ?? []).filter(
        ({ obligation_id: id }) => id === eligibilityRow.obligation_id)
      : (obligationCoverage?.rows ?? []).filter((obligation) =>
        obligation?.selection != null && obligation.design_status === "valid" &&
        obligation.controlled_contract_node_ids?.includes(
          eligibilityRow.verification_id));
    const duplicatedRelationship = typeof eligibilityRow.obligation_id === "string" &&
      matchingObligations.length > 1;
    const relationshipDuplicateOrdinal = population.slice(0, index).filter(entry =>
      entry.binding === binding && entry.verification_id === eligibilityRow.verification_id &&
      entry.obligation_id === eligibilityRow.obligation_id).length;
    const state = duplicated || duplicatedRelationship || declaration.status !== "declared"
      ? "conflicting" : "complete";
    return row("runtime_proof_declaration",
      { verification_id: eligibilityRow.verification_id ?? `invalid-${index}`,
        ...(eligibilityRow.obligation_id == null ? {} : {
          obligation_id: eligibilityRow.obligation_id }),
        ...(duplicateOrdinal > 0 ? { duplicate_ordinal: duplicateOrdinal } : {}),
        ...(relationshipDuplicateOrdinal > 0 ? {
          relationship_duplicate_ordinal: relationshipDuplicateOrdinal } : {}) }, state,
      state === "complete" ? [] : [duplicated && "runtime_proof_identity_duplicate",
        matchingObligations.length === 0 && "runtime_proof_obligation_missing",
        duplicatedRelationship && "obligation_coverage_obligation_id_duplicate",
        declaration.status !== "declared" && declaration.reason],
      { ...declaration, runtime_eligible: true,
        mapping_completeness: {
          classification: eligibilityRow.mapping_classification ?? "mapped",
          reason_code: eligibilityRow.mapping_reason_code ?? null
        },
        execution_evidence: "owned_by_workspace_verify_proof",

        proof_repairable: binding !== null,

        declared_runtime_test: projectControlledContractDeclaredRuntimeTest(binding),
        obligation_ids: matchingObligations.map(({ obligation_id: id }) => id),
        obligation_proof_kinds: [...new Set(matchingObligations.map(
          ({ proof }) => proof?.kind ?? null))].sort() });
  });
  if (rows.length === 0) rows.push(row("runtime_proof_declaration",
    { subject, population: "empty" }, "missing",
    ["runtime_proof_population_empty"], { binding_count: 0 }));
  return dimension("runtime_proof_declaration", sourceIdentity ?? { subject,
    verification_ids: bindings.map(({ verification_claim_id: id }) => id ?? null) },
  { bindings: structuredClone(bindings), ...(sourceIdentity === null ? {} : {
    source_identity: structuredClone(sourceIdentity)
  }), eligibility: structuredClone(applicability), counts: {
    declarations: bindings.length,
    relationships: applicability.length,
    joined_rows: population.length,
    eligibility_population: applicability.length,
    unresolved: population.filter(entry => entry.classification === "unresolved").length,
    runtime_eligible: population.filter(({ classification }) =>
      classification === "runtime").length,
    non_runtime: population.filter(({ classification }) =>
      classification === "non_runtime").length,
    conflicting: population.filter(({ classification }) =>
      classification === "conflicting").length
  } }, rows);
}

function omittedObligationDimension(subject, obligationCoverage, acceptanceCoverage) {
  if (obligationCoverage === null) return absentDimension("omitted_obligations", subject);
  if (Object.hasOwn(obligationCoverage, 'resolution'))
    return savedResolutionDimension('omitted_obligations', subject, obligationCoverage,
      obligationCoverage.resolution, obligationCoverage.source);
  const obligationsByLocator = new Map();
  for (const obligation of obligationCoverage.rows) {
    const values = obligationsByLocator.get(obligation.source_locator) ?? [];
    values.push(obligation.obligation_id);
    obligationsByLocator.set(obligation.source_locator, values);
  }
  const acceptanceCriteria = acceptanceCoverage?.criteria_with_locators;
  const criteria = Array.isArray(acceptanceCriteria)
    ? acceptanceCriteria
    : obligationCoverage.criteria;
  const rows = criteria.map((criterion, index) => {
    const locator = criterion.source_locator;
    if (typeof locator !== "string" || locator.length === 0) fail(
      "controlled_contract_design_workbench_owner_projection_invalid",
      "omitted-obligation detection requires owner-produced acceptance locators",
      { index }
    );
    const obligationIds = obligationsByLocator.get(locator) ?? [];
    return row("omitted_obligations", { source_locator: locator },
      obligationIds.length === 0 ? "missing" : "complete",
      obligationIds.length === 0 ? ["controlled_contract_obligation_omitted"] : [],
      { criterion_identity: criterion.identity ?? null, obligation_ids: obligationIds }
    );
  });
  if (rows.length === 0) rows.push(row("omitted_obligations",
    { subject, population: "empty" }, "missing",
    ["acceptance_criterion_population_empty"], { criterion_count: 0 }));
  const unmappedMandatory = acceptanceCoverage?.evaluation?.unmapped_mandatory_node_ids ?? [];
  return dimension("omitted_obligations",
    acceptanceCoverage?.criterion_identities ?? obligationCoverage.criterionIdentities ?? subject,
    { criteria: structuredClone(criteria),
      obligation_rows: obligationCoverage.rows.length }, rows, {
      reconciliation: unmappedMandatory.length === 0 ? null : {
        status: "conflicting",
        reason_codes: ["controlled_contract_cross_owner_mandatory_claim_unmapped"],
        unmapped_mandatory_count: unmappedMandatory.length
      }
    });
}

function criterionIdentityPopulation(identitySet) {
  const identities = identitySet?.identities;
  if (!Array.isArray(identities)) return undefined;
  return identities.map(({ identity }) => identity).join("\u0000");
}

function relationshipCriterionDigests(ownerResult) {
  return ownerResult?.authoringApplicability?.criterion_relationships?.map(
    ({ criterion_identity_digest: value }) => value) ?? [];
}

function crossOwnerDimension(subject, inputs) {
  const identityPopulations = {
    wk_id: [subject.wk_id, inputs.contractAssessment?.source?.work_record_id,
      inputs.obligationCoverage?.wkId],

    selected_unit: [subject.selected_unit ?? null,
      inputs.contractAssessment?.source?.selected_unit ?? null,
      inputs.obligationCoverage?.selectedUnit ?? null],
    controlled_focus: [subject.focus,
      inputs.contractAssessment?.source?.focus,
      inputs.obligationCoverage?.focus],
    generation_id: [subject.generation_id,
      inputs.contractAssessment?.source?.generation_id,
      inputs.obligationCoverage?.canonicalSet?.generation],
    manifest_digest: [subject.manifest_digest,
      inputs.contractAssessment?.source?.manifest_digest,
      inputs.obligationCoverage?.canonicalSet?.manifest_content_digest],
    contract_digest: [inputs.authoringState?.selected_resources?.contract?.content_digest,
      inputs.contractAssessment?.source?.controlled_contract_digest,
      inputs.obligationCoverage?.bindings?.contractDigest],

    acceptance_criterion_identity_digest: [
      inputs.acceptanceCoverage?.criterion_identities?.digest,
      ...relationshipCriterionDigests(inputs.acceptanceCoverage)],
    obligation_criterion_identity_digest: [
      inputs.obligationCoverage?.criterionIdentities?.digest,
      ...relationshipCriterionDigests(inputs.obligationCoverage)],
    criterion_identity_population: [
      criterionIdentityPopulation(inputs.acceptanceCoverage?.criterion_identities),
      criterionIdentityPopulation(inputs.obligationCoverage?.criterionIdentities)]
  };
  const rows = Object.entries(identityPopulations).map(([identityKind, population]) => {
    const missingCount = population.filter((value) => value === undefined).length;
    const values = [...new Set(population.filter((value) => value !== undefined))]
      .sort(compare);
    return row("cross_owner_consistency", { identity_kind: identityKind },
      values.length > 1 ? "conflicting"
        : missingCount > 0 || values.length === 0 ? "missing" : "complete",
      [(missingCount > 0 || values.length === 0) &&
          "controlled_contract_cross_owner_identity_missing",
        values.length > 1 && "controlled_contract_cross_owner_identity_conflict"],
      { values, observed_count: values.length, missing_count: missingCount }
    );
  });
  const unmappedMandatory = inputs.acceptanceCoverage?.evaluation
    ?.unmapped_mandatory_node_ids ?? [];
  if (unmappedMandatory.length > 0) rows.push(row(
    "cross_owner_consistency", { identity_kind: "coverage_mapping_consistency" },
    "conflicting", ["controlled_contract_cross_owner_mandatory_claim_unmapped"],
    { unmapped_mandatory_node_ids: structuredClone(unmappedMandatory),
      obligation_coverage_owner_result_preserved: true }
  ));
  for (const conflict of inputs.runtimeProofEligibility?.filter(
    ({ classification }) => classification === "conflicting") ?? []) rows.push(row(
    "cross_owner_consistency", { identity_kind: "verification_method",
      obligation_id: conflict.obligation_id }, "conflicting",
    [conflict.reason_code], structuredClone(conflict)
  ));
  return dimension("cross_owner_consistency", subject, identityPopulations, rows);
}

export function deriveControlledContractDesignWorkbench(input) {
  object(input, "input");
  const subject = object(input.subject, "subject");
  text(subject.wk_id, "subject.wk_id");
  const normalizedSubject = deepFreeze(structuredClone(subject));
  const values = {
    authoringState: input.authoringState ?? null,
    workRecordValidation: input.workRecordValidation ?? null,
    contractAssessment: input.contractAssessment ?? null,
    obligationCoverage: input.obligationCoverage ?? null,
    acceptanceCoverage: input.acceptanceCoverage ?? null,
    testProofBindings: input.testProofBindings ?? null,
    runtimeProofEligibility: input.runtimeProofEligibility ?? null,
    testProofSource: input.testProofSource ?? null
  };
  const unmappedMandatory = values.acceptanceCoverage?.evaluation
    ?.unmapped_mandatory_node_ids ?? [];
  const obligation = obligationDimension(normalizedSubject, values.obligationCoverage,
    values.testProofBindings, values.runtimeProofEligibility);
  const reconciledObligation = unmappedMandatory.length === 0 ? obligation : deepFreeze({
    ...structuredClone(obligation),
    status: "incomplete",
    reconciliation: {
      status: "conflicting",
      reason_codes: ["controlled_contract_cross_owner_mandatory_claim_unmapped"],
      unmapped_mandatory_count: unmappedMandatory.length
    }
  });
  const dimensions = [
    authoringDimension(normalizedSubject, values.authoringState),
    workRecordDimension(normalizedSubject, values.workRecordValidation),
    assessmentDimension(normalizedSubject, values.contractAssessment),
    reconciledObligation,
    acceptanceDimension(normalizedSubject, values.acceptanceCoverage),
    runtimeDeclarationDimension(normalizedSubject, values.testProofBindings,
      values.obligationCoverage, values.testProofSource,
      values.runtimeProofEligibility),
    omittedObligationDimension(normalizedSubject, values.obligationCoverage,
      values.acceptanceCoverage),
    crossOwnerDimension(normalizedSubject, values)
  ];
  const ordered = dimensions.sort((left, right) =>
    DIMENSION_ORDER.indexOf(left.dimension_id) - DIMENSION_ORDER.indexOf(right.dimension_id));
  const incompleteRows = ordered.flatMap(({ rows }) => rows.filter(
    ({ state }) => !["complete", "not_applicable"].includes(state)
  )).sort((left, right) => compare(left.row_id, right.row_id));
  const nonActionableRows = incompleteRows.map((candidate) => deepFreeze({
    ...structuredClone(candidate),
    non_actionable_reason: "semantic_continuation_not_resolved"
  }));
  return deepFreeze({
    schema_version: CONTROLLED_CONTRACT_DESIGN_WORKBENCH_VERSION,
    subject: normalizedSubject,

    mechanically_complete: ordered.every(({ status }) => status === "complete"),
    authority: {
      semantic_quality: false, review_sufficiency: false, lifecycle_readiness: false,
      dispatch: false, admissibility: false, completion: false, cce_exclusive: true
    },
    dimension_count: ordered.length,
    dimensions: ordered,
    incomplete_row_count: incompleteRows.length,
    actionable_row_count: 0,
    actionable_rows: [],
    non_actionable_row_count: nonActionableRows.length,
    non_actionable_rows: nonActionableRows
  });
}
