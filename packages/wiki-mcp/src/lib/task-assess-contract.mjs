

import { assertControlledContractOperationInput, ControlledContractToolError } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import { captureProofAssessmentOperation } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/proof-validation-operations.mjs";
import { obligationCoverageQueryOperation } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/obligation-coverage-query.mjs";
import { parseProofSourceUnitAddress } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/saved-proof-source.mjs";

import { ASSESSMENT_CONSUMER, resolveObligationCoverageQueryContext } from
  "./controlled-contract-query-context.mjs";

const SELECTION_KEYS = Object.freeze(["unit", "focus", "obligation_id"]);

function parseSelection(selection) {
  assertControlledContractOperationInput(selection, SELECTION_KEYS);
  const { unit, focus = null, obligation_id: obligationId = null } = selection;
  if (obligationId !== null && (typeof obligationId !== "string" || obligationId.length === 0)) {
    throw new ControlledContractToolError("obligation_coverage_request_invalid",
      "obligation_id selects one saved obligation by its identity", {
        changed: false, phase: "request", rejected_arguments: ["obligation_id"] });
  }
  return { unit, focus, obligationId, ...parseProofSourceUnitAddress(unit) };
}

async function requiredPolicyMember(assessRequiredPolicy, input) {
  try {
    return await assessRequiredPolicy(input);
  } catch (error) {
    return { experimental: true, status: "failed",
      uncertainty: "the required policy population was not assessed; nothing about it is established",
      failure: { code: error?.code ?? null, message: error?.message ?? String(error),
        details: error?.details ?? null } };
  }
}

export function resolveContractAssessmentContext({ workspace, sessionEnv = process.env, sourceDeps = {} },
  parseRequest = () => null) {
  return obligationCoverageQueryOperation(async () => {
    const request = parseRequest();
    return { request, context: await resolveObligationCoverageQueryContext({
      env: sessionEnv, workspace, deps: sourceDeps, consumer: ASSESSMENT_CONSUMER }) };
  });
}

export async function assessCurrentContractWithContext({ workspace, selection },
  { sessionEnv = process.env, sourceDeps = {}, assessmentDeps = {},
    experimentalRequiredPolicyAssessment = null } = {}) {
  const { context, request: selected } = await resolveContractAssessmentContext({ workspace, sessionEnv, sourceDeps },
    () => parseSelection(selection));
  const { assessment, diagnosis_inventory: diagnosisInventory } = await captureProofAssessmentOperation({
    repoRoot: context.sourceRoot, wkId: selected.wkId, selectedUnit: selected.selectedUnit,
    focus: selected.focus,
    ...(selected.obligationId === null ? {} : { obligationId: selected.obligationId })
  }, { ...assessmentDeps,

    presentation: Object.freeze({ orchestrator: context.role === "orchestrator" }) });
  const selectionFacts = selected.obligationId === null
    ? { scope: "whole_unit", obligation_id: null, whole_unit_assessed: true }
    : { scope: "selected_obligation", obligation_id: selected.obligationId, whole_unit_assessed: false };
  return { context, carrier: {
    repository: workspace.repo,
    unit: selected.unit,
    focus: selected.focus,
    selection: selectionFacts,
    ...(experimentalRequiredPolicyAssessment === null ? {} : {
      experimental_required_policy: await requiredPolicyMember(experimentalRequiredPolicyAssessment, {
        repoRoot: context.sourceRoot, unit: selected.unit, wkId: selected.wkId,
        selectedUnit: selected.selectedUnit, focus: selected.focus, selection: selectionFacts,

        expectedRevision: diagnosisInventory.content_digest }) }),
    source_authority: { role: context.role, source_kind: context.identity.source.kind,
      population_kind: context.identity.population.kind },
    assessment,
    diagnosis_inventory: diagnosisInventory
  } };
}

export async function assessCurrentContract(input, options) {
  return (await assessCurrentContractWithContext(input, options)).carrier;
}
