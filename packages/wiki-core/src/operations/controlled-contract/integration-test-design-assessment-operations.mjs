import {
  CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AUTHORITY_KEYS,
  CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_PUBLIC_REQUEST_KEYS,
  ControlledContractToolError,
  assertControlledContractOperationInput,
  controlledContractContentDigest
} from "../../lib/controlled-contract-tools.mjs";
import {
  resolveAcceptanceCoverageFacts,
  resolveObligationCoverageFacts
} from "./acceptance-coverage-operations.mjs";
import {
  collectIntegrationTestDesignCensuses
} from "./integration-test-design-census-providers.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import {
  CONTROLLED_CONTRACT_ASSESSMENT_NON_AUTHORITY,
  projectControlledContractIntegrationAssessmentSummary
} from "./assessment-semantic-projection.mjs";
import { controlledContractOperation } from "./refusal.mjs";

const INTEGRATION_ASSESSMENT_SNAPSHOTS = new WeakMap();

export function consumeControlledContractIntegrationAssessmentSnapshot(result) {
  const snapshot = result && typeof result === "object"
    ? INTEGRATION_ASSESSMENT_SNAPSHOTS.get(result) ?? null : null;
  if (snapshot !== null) INTEGRATION_ASSESSMENT_SNAPSHOTS.delete(result);
  return snapshot;
}

export const INTEGRATION_TEST_DESIGN_ASSESSMENT_NON_AUTHORITY =
  CONTROLLED_CONTRACT_ASSESSMENT_NON_AUTHORITY;

const OPERATION = "workspace_controlled_contract_integration_test_design_assess";
const INTERNAL_INPUT_KEYS = Object.freeze([
  "repoRoot", "wkId", "focus", "selectedUnit", "axisApplicability",
  "declaredIntegrationTests", "integrationScenarios", "interactionRequirements",
  "reviewQuestions", "summaryByteAllowance"
]);

function resolutionInput(input) {
  return {
    repoRoot: input.repoRoot,
    wkId: input.wkId,
    focus: input.focus ?? null,
    selectedUnit: input.selectedUnit ?? null
  };
}

function generationId(canonicalSet) {
  const generation = canonicalSet.generation;
  return typeof generation === "string" ? generation : generation.id;
}

function assertCanonicalAssessmentSubstrate(obligation) {
  if (obligation.plan === null) throw new ControlledContractToolError(
    "integration_test_design_assessment_proof_plan_unavailable",
    "canonical proof plan is absent; integration-test design comparison cannot be completed",
    { changed: false, phase: "canonical_resolution" }
  );
  if (typeof obligation.canonicalSet.manifest_content_digest !== "string") {
    throw new ControlledContractToolError(
      "integration_test_design_assessment_generation_unavailable",
      "manifest-selected controlled-contract generation identity is unavailable",
      { changed: false, phase: "canonical_resolution" }
    );
  }
}

function equalStringPopulation(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function acceptanceCoverageCurrentness(acceptance, obligation) {
  const reasons = [];
  if (acceptance.carrier === null) {
    reasons.push("carrier_absent");
    return Object.freeze({ current: false, reasons: Object.freeze(reasons) });
  }
  const bound = acceptance.carrier.content.source_bindings ?? {};
  for (const [key, value] of Object.entries(acceptance.bindings)) {
    if (bound[key] !== value) reasons.push(`source_binding:${key}`);
  }
  if (acceptance.carrier.content.source_identity?.content_digest !==
      obligation.source?.content_digest) reasons.push("obligation_source_digest");

  const canonicalIdentities = obligation.criteria.map(({ identity }) => identity);
  const carriedIdentities = (acceptance.carrier.content.criterion_identities?.identities ?? [])
    .map(({ identity }) => identity);
  const mappedIdentities = (acceptance.carrier.content.rows ?? [])
    .map(({ criterion_identity: identity }) => identity);
  if (!equalStringPopulation(canonicalIdentities, carriedIdentities)) {
    reasons.push("criterion_identity_population");
  }
  if (!equalStringPopulation(canonicalIdentities, mappedIdentities) ||
      new Set(mappedIdentities).size !== mappedIdentities.length) {
    reasons.push("mapping_population");
  }
  return Object.freeze({
    current: reasons.length === 0,
    reasons: Object.freeze(reasons.sort())
  });
}

function censusForEvaluator(census) {
  return {
    census_id: census.census_id,
    axis: census.axis,
    source_kind: census.source_kind,
    provider_id: census.provider_id,
    owner_id: census.owner_id,
    generation_id: census.generation_id,
    content_digest: census.content_digest,
    member_count: census.member_count,
    completeness: census.completeness,
    omissions: structuredClone(census.omissions),
    currentness: census.currentness,
    members: census.members.map((member) => ({
      member_id: member.member_id,
      ...(member.source_test_proof_id === undefined
        ? {} : { source_test_proof_id: member.source_test_proof_id }),
      ...(member.required_before === undefined
        ? {} : { required_before: member.required_before })
    }))
  };
}

function populationMembersByObligation(censuses) {
  const result = new Map();
  for (const census of censuses) {
    for (const member of census.members) {
      for (const obligationId of member.obligation_ids) {
        const current = result.get(obligationId) ?? [];
        current.push({ census_id: census.census_id, member_id: member.member_id });
        result.set(obligationId, current);
      }
    }
  }
  return result;
}

function resolvedEvaluatorInput({ input, obligation, acceptance, censuses, pkg }) {
  const acceptanceCurrentness = acceptanceCoverageCurrentness(acceptance, obligation);
  const membersByObligation = populationMembersByObligation(censuses);
  const criterionByLocator = new Map(obligation.criteria.map((criterion) => [
    criterion.source_locator, criterion
  ]));
  const censusByAxis = new Map(censuses.map((census) => [census.axis, census]));
  const generation = generationId(obligation.canonicalSet);
  const declaredAxisPopulation = new Set(input.axisApplicability.map(({ axis }) => axis));
  return {
    schema_version: pkg.INTEGRATION_TEST_DESIGN_ASSESSMENT_INPUT_SCHEMA_VERSION,
    subject: {
      repository_id: obligation.record.repo,
      wk_id: obligation.wkId,
      selected_unit_address: obligation.selectedUnit === null
        ? obligation.wkId : `${obligation.wkId}#${obligation.selectedUnit}`,
      work_record_digest: controlledContractContentDigest(obligation.record),
      contract_generation_id: generation,
      contract_manifest_digest: obligation.canonicalSet.manifest_content_digest,
      contract_digest: obligation.contract.content_digest,
      proof_plan_generation_id: generation,
      proof_plan_digest: obligation.plan.content_digest,
      selected_pack_digest: obligation.bindings.selectedPackDigest,
      obligation_source_digest: obligation.source.content_digest,
      obligation_source_current: obligation.sourceCurrent,
      acceptance_coverage_digest: acceptance.carrier.content_digest,
      acceptance_coverage_current: acceptanceCurrentness.current
    },
    declaration_completeness: {
      requirement_obligation_bindings: obligation.rows.length > 0
        ? "complete" : "unavailable",
      integration_scenario_bindings: "complete",
      axis_applicability: declaredAxisPopulation.size ===
        pkg.INTEGRATION_TEST_DESIGN_ASSESSMENT_AXES.length ? "complete" : "partial"
    },
    axis_applicability: input.axisApplicability.map((item) => ({
      ...structuredClone(item),
      ...(censusByAxis.has(item.axis)
        ? { census_id: censusByAxis.get(item.axis).census_id } : {})
    })),
    requirements: obligation.criteria.map((criterion) => ({
      requirement_id: criterion.identity,
      source_pointer: criterion.source_locator,
      text_digest: controlledContractContentDigest(criterion.criterion),
      text: criterion.criterion
    })),
    obligations: obligation.rows.map((row) => {
      const criterion = criterionByLocator.get(row.source_locator);
      return {
        obligation_id: row.obligation_id,
        source_requirement_ids: criterion === undefined ? [] : [criterion.identity],
        verification_claim_ids: structuredClone(row.controlled_contract_node_ids),
        proof_rigor: "standard",
        integration_required: row.proof.kind === "pack_mapping",
        required_population_members: structuredClone(
          membersByObligation.get(row.obligation_id) ?? []
        )
      };
    }),
    population_censuses: censuses.map(censusForEvaluator),
    declared_integration_tests: structuredClone(input.declaredIntegrationTests),
    integration_scenarios: structuredClone(input.integrationScenarios),
    interaction_requirements: structuredClone(input.interactionRequirements),
    review_questions: structuredClone(input.reviewQuestions)
  };
}

function integrationAssessmentSourceIdentity({ evaluatorInput, obligation, acceptance, censuses }) {
  const acceptanceCurrentness = acceptanceCoverageCurrentness(acceptance, obligation);
  return Object.freeze({
    repository_id: evaluatorInput.subject.repository_id,
    selected_unit_address: evaluatorInput.subject.selected_unit_address,
    work_record_identity: obligation.record.id,
    work_record_digest: evaluatorInput.subject.work_record_digest,
    controlled_contract_generation_id: evaluatorInput.subject.contract_generation_id,
    controlled_contract_manifest_digest: evaluatorInput.subject.contract_manifest_digest,
    controlled_contract_digest: evaluatorInput.subject.contract_digest,
    proof_plan_generation_id: evaluatorInput.subject.proof_plan_generation_id,
    proof_plan_digest: evaluatorInput.subject.proof_plan_digest,
    selected_pack_digest: evaluatorInput.subject.selected_pack_digest,
    obligation_source: Object.freeze({
      digest: evaluatorInput.subject.obligation_source_digest,
      row_count: obligation.rows.length,
      criterion_count: obligation.criteria.length,
      current: obligation.sourceCurrent,
      stale_reasons: structuredClone(obligation.staleReasons)
    }),
    acceptance_coverage: Object.freeze({
      digest: evaluatorInput.subject.acceptance_coverage_digest,
      mapping_count: acceptance.rows.length,
      criterion_count: obligation.criteria.length,
      current: acceptanceCurrentness.current,
      stale_reasons: acceptanceCurrentness.reasons
    }),
    census_providers: Object.freeze(censuses.map((census) => Object.freeze({
      axis: census.axis,
      census_id: census.census_id,
      provider_id: census.provider_id,
      generation_id: census.generation_id,
      content_digest: census.content_digest,
      member_count: census.member_count,
      completeness: census.completeness,
      omissions: structuredClone(census.omissions),
      currentness: census.currentness
    })))
  });
}

async function integrationTestDesignOperation(callback) {
  return controlledContractOperation(async () => {
    try {
      return await callback();
    } catch (error) {
      if (error !== null && (typeof error === "object" || typeof error === "function")) {
        const details = error.details !== null && typeof error.details === "object" &&
          !Array.isArray(error.details) ? error.details : {};
        error.details = {
          ...structuredClone(details),
          authority: INTEGRATION_TEST_DESIGN_ASSESSMENT_NON_AUTHORITY
        };
      }
      throw error;
    }
  });
}

export async function refuseMalformedControlledContractIntegrationTestDesignRequest({
  issueCount,
  issues,
  rejectedKeys = []
}) {
  return integrationTestDesignOperation(async () => {
    throw new ControlledContractToolError(
      "integration_test_design_assessment_request_invalid",
      "integration-test design assessment request failed its closed public schema",
      {
        changed: false,
        phase: "request",
        operation: OPERATION,
        issue_count: issueCount,
        issues: structuredClone(issues).slice(0, 32),
        rejected_authority_keys: [...new Set(rejectedKeys)].sort()
      }
    );
  });
}

export async function assessControlledContractIntegrationTestDesignOperation(input, {
  resolveAcceptance = resolveAcceptanceCoverageFacts,
  resolveObligations = resolveObligationCoverageFacts,
  collectCensuses = collectIntegrationTestDesignCensuses,
  loadPackage = loadControlledContractPackage
} = {}) {
  return integrationTestDesignOperation(async () => {
    assertControlledContractOperationInput(input, INTERNAL_INPUT_KEYS);
    const resolvedInput = resolutionInput(input);
    const obligation = await resolveObligations(resolvedInput, { requireSource: true });
    const acceptance = await resolveAcceptance(resolvedInput, { requireCarrier: true });
    assertCanonicalAssessmentSubstrate(obligation);
    const censuses = await collectCensuses({
      repoRoot: obligation.repoRoot,
      resolvedFacts: obligation,
      axisApplicability: input.axisApplicability
    });
    const pkg = await loadPackage();
    const evaluatorInput = resolvedEvaluatorInput({
      input, obligation, acceptance, censuses, pkg
    });
    let assessment;
    try {
      assessment = pkg.assessIntegrationTestDesign(evaluatorInput);
    } catch (error) {
      if (error?.code !== "CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_INPUT_INVALID") {
        throw error;
      }
      throw new ControlledContractToolError(
        "integration_test_design_assessment_composition_invalid",
        "server-resolved integration-test design assessment input is invalid",
        {
          changed: false,
          phase: "canonical_composition",
          issue_count: error.issue_count,
          issues: structuredClone(error.issues ?? []).slice(0, 32)
        }
      );
    }
    const sourceIdentity = integrationAssessmentSourceIdentity({
      evaluatorInput, obligation, acceptance, censuses
    });
    const projected = projectControlledContractIntegrationAssessmentSummary(
      assessment,
      sourceIdentity,
      input.summaryByteAllowance
    );
    INTEGRATION_ASSESSMENT_SNAPSHOTS.set(projected, Object.freeze({
      family: "integration_test_design",
      assessment,
      source_identity: sourceIdentity,
      resolve_current_source_identity: async () => {
        const currentObligation = await resolveObligations(resolvedInput, { requireSource: true });
        const currentAcceptance = await resolveAcceptance(resolvedInput, { requireCarrier: true });
        assertCanonicalAssessmentSubstrate(currentObligation);
        const currentCensuses = await collectCensuses({
          repoRoot: currentObligation.repoRoot,
          resolvedFacts: currentObligation,
          axisApplicability: input.axisApplicability
        });
        const currentEvaluatorInput = resolvedEvaluatorInput({
          input,
          obligation: currentObligation,
          acceptance: currentAcceptance,
          censuses: currentCensuses,
          pkg
        });
        return integrationAssessmentSourceIdentity({
          evaluatorInput: currentEvaluatorInput,
          obligation: currentObligation,
          acceptance: currentAcceptance,
          censuses: currentCensuses
        });
      },
      request_key_census: Object.freeze({
        accepted: CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_PUBLIC_REQUEST_KEYS,
        refused_authority_bearing: CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AUTHORITY_KEYS,
        accepted_count: CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_PUBLIC_REQUEST_KEYS.length,
        refused_count: CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AUTHORITY_KEYS.length
      })
    }));
    return projected;
  });
}
