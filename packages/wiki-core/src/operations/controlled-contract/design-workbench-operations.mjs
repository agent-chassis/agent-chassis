import { resolveProofAuthoringReadinessInputs, bindProofAuthoringReadinessInputs,
  assertProofAuthoringReadinessCurrent } from './proof-authoring-readiness-inputs.mjs';
import {
  ControlledContractToolError,
  assertControlledContractOperationInput,
  readControlledContractCarrierFile,
  resolveCanonicalControlledContractCarrierSet
} from "../../lib/controlled-contract-tools.mjs";
import { deriveCanonicalControlledContractAuthoringState } from
  "../../lib/controlled-contract-carrier-set-tools.mjs";
import {
  deriveControlledContractDesignWorkbench
} from "../../lib/controlled-contract-design-workbench.mjs";
import {
  CONTROLLED_CONTRACT_DESIGN_RESPONSE_KINDS
} from "../../lib/controlled-contract-authoring-continuations.mjs";
import { loadWorkRecordById } from "../../lib/work-record-store.mjs";
import { validateWorkRecord } from "../../lib/work-record-schema.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import {
  CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE,
  inspectWorkRecordProofPosture,
  resolveControlledAcceptanceState
} from "../../lib/work-record-proof-posture.mjs";
import {
  CONTROLLED_CONTRACT_REQUIREMENT_INPUT_SHAPES,
  CONTROLLED_CONTRACT_REQUIREMENT_LIMITS,
  deriveControlledContractAuthoringVocabulary,
  projectControlledContractAuthoringVocabulary,
  projectControlledContractReferentSelectors
} from "./contract-requirement-vocabulary.mjs";
import {
  projectControlledContractDeclaredRuntimeTest,
  projectControlledContractRuntimeTestAuthoring
} from "./contract-requirement-runtime-proof.mjs";

const RUNTIME_TEST_SHAPE_PROBE_IDENTITY = "claim-runtime-test-shape-probe";
import {
  projectControlledContractReferenceAuthoringReadiness,
  resolveControlledContractPackReferenceRoles,
  resolveControlledContractReferenceAuthoringPlan,
  resolveControlledContractReferenceCandidatePopulation
} from "./prospective-reference-authoring.mjs";
import {
  deriveControlledContractRepairCandidate
} from "./design-workbench-repair.mjs";
import {
  classifyControlledContractDesignWorkbenchActionability,
  projectClassifiedControlledContractDesignWorkbench
} from "./design-workbench-actionability.mjs";
import {
  deriveControlledAcceptanceEvaluatedSnapshot
} from "./controlled-acceptance-evaluated-snapshot.mjs";
import { controlledContractOperation } from "./refusal.mjs";
import { coverageUnitArguments } from "./coverage-recovery-guidance.mjs";

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, { changed: false, ...details });
}

function generationIdentity(canonicalSet) {
  return typeof canonicalSet.generation === "string"
    ? canonicalSet.generation : canonicalSet.generation?.id ?? null;
}

const OPTIONAL_OWNER_CODES = Object.freeze(new Set([
  "acceptance_coverage_canonical_source_unavailable",
  "obligation_coverage_source_not_found",
  "controlled_contract_carrier_not_found",
  "controlled_contract_proof_plan_missing",

  "controlled_contract_proof_plan_stale",
  "controlled_contract_proof_plan_request_missing",
  "controlled_contract_evaluation_input_missing",
  "controlled_contract_carrier_validation_failed"
]));

async function resolveAuthoringState(input, canonicalSet) {
  try {
    return await deriveCanonicalControlledContractAuthoringState({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
      continuation: input.authoringContinuation ?? null,
      internalComposition: "design_workbench",
      request: { wk_id: input.wkId,
        ...(input.focus === undefined || input.focus === null ? {} : { focus: input.focus }),
        ...(input.authoringContinuation === undefined || input.authoringContinuation === null
          ? {} : { continuation: input.authoringContinuation }) }
    });
  } catch (error) {
    if (error?.code !== "controlled_contract_carrier_validation_failed" &&
        !OPTIONAL_OWNER_CODES.has(error?.code)) throw error;
    const members = Object.values(canonicalSet?.members_by_basename ?? {});
    const contract = members
      .find((member) => member?.carrier_kind === "contract") ?? null;
    const proofPlan = members
      .find((member) => member?.carrier_kind === "proof_plan") ?? null;
    return Object.freeze({
      schema_version: "controlled-contract-authoring-state.v1",
      stage: proofPlan === null ? "proof_authoring_required" : "complete",
      selected_resources: Object.freeze({ ...(contract === null ? {} : {
        contract: Object.freeze({ content_digest: contract.content_digest,
          filename: contract.filename ?? null })
      }), ...(proofPlan === null ? {} : {
        proof_plan: Object.freeze({ content_digest: proofPlan.content_digest,
          filename: proofPlan.filename ?? null })
      }) }),
      unresolved_decisions: Object.freeze({
        reason_code: error.code,
        diagnostics: structuredClone(error.details?.diagnostics ?? null)
      }),
      next_calls: Object.freeze([])
    });
  }
}

function exampleIdentity(identityKind, suffix) {
  const values = {
    repository: "agent-chassis",
    path: `packages/example/${suffix}.mjs`,
    symbol: `example${suffix}`,
    scip_symbol: `example ${suffix}`,
    domain: "controlled-contract-authoring-example",
    value: suffix,
    name: suffix,
    term: suffix
  };
  return Object.freeze({ kind: identityKind.kind,
    ...Object.fromEntries(identityKind.required_fields.map((field) => [field, values[field]])) });
}

function exampleReferent(vocabulary, declared, index) {
  if (declared[index]?.selector) return Object.freeze({ select: declared[index].selector });
  const identityKind = vocabulary.identity_kinds.find(({ kind }) => kind === "durable_id") ??
    vocabulary.identity_kinds[0];
  return Object.freeze({ declare: Object.freeze({ type_term: vocabulary.type_terms[0],
    identity: exampleIdentity(identityKind, `referent-${index + 1}`) }) });
}

function exampleObject(kind, referent) {
  if (kind === "reference") return Object.freeze({ referent });
  if (kind === "boolean") return Object.freeze({ boolean: true });
  if (kind === "number") return Object.freeze({ number: 1 });
  return Object.freeze({ range: Object.freeze({ minimum: 0, maximum: 1 }) });
}

function exampleStatement(vocabulary, subjectReferent) {
  const relation = vocabulary.relation_details.find(({ applicability_modes: modes }) =>
    modes.includes("unconditional")) ?? vocabulary.relation_details[0];
  const count = Math.max(1, relation.minimum_operands);
  return Object.freeze({ relation: relation.term,
    objects: Object.freeze(Array.from({ length: count }, () =>
      exampleObject(relation.operand_kind, subjectReferent))) });
}

function requirementExamples(vocabulary, declaredReferents) {
  const subject = exampleReferent(vocabulary, declaredReferents, 0);
  const verifier = exampleReferent(vocabulary, declaredReferents, 1);
  return Object.freeze([Object.freeze({
    description: declaredReferents.length > 0
      ? "Valid example using returned selectors where available."
      : "Valid example using declarations because no selector exists yet.",
    publication: "example_only_not_automatically_published",
    response: Object.freeze({ kind: "contract_requirements",
      requirements: Object.freeze([Object.freeze({
        modality: vocabulary.modalities.includes("MUST") ? "MUST" : vocabulary.modalities[0],
        subject,
        behavior: exampleStatement(vocabulary, subject),
        verification: Object.freeze({
          method: vocabulary.verification_methods.find((method) => method !== "test_execution") ??
            vocabulary.verification_methods[0],
          verifier,
          observes: exampleStatement(vocabulary, verifier),
          fails_when: exampleStatement(vocabulary, subject)
        })
      })])
    })
  })]);
}

async function proofSelectionAuthoringFacts(pkg, contract) {
  const intentCatalog = pkg.PROOF_INTENT_ARTIFACT.intents.map((intent) => Object.freeze({
    intent_id: intent.intent_id,
    meaning: intent.definition,
    capable_packs: Object.freeze(structuredClone(intent.capable_packs))
  }));
  if (contract === null) return Object.freeze({
    schema_version: "controlled-contract-proof-selection-guidance.v1",
    intent_accounting: Object.freeze({ total: intentCatalog.length, returned: intentCatalog.length,
      omitted: 0 }),
    intents: Object.freeze(intentCatalog), packs: Object.freeze([]),
    pack_accounting: Object.freeze({ total: 0, returned: 0, omitted: 0 }),
    unavailable_until: "controlled_contract_exists"
  });
  const { selectProofPacksV2 } = await import(
    "@agent-chassis/controlled-contract/proof-intents");
  const selection = selectProofPacksV2({ contract,
    requestedIntents: intentCatalog.map(({ intent_id: id }) => id) });
  const packs = selection.candidates.map((candidate) => {
    const detail = pkg.describeProofPackAuthoring({
      profileId: candidate.profile_id,
      profileVersion: candidate.profile_version,
      requestedIntents: candidate.requested_intents
    });
    return Object.freeze({
      selected_pack: Object.freeze({ profile_id: candidate.profile_id,
        profile_version: candidate.profile_version }),
      requested_intents: candidate.requested_intents,
      intent_definitions: candidate.intent_definitions,
      guarantee: candidate.guarantee,
      capability_limits: candidate.explicit_exclusions,

      required_bindings: Object.freeze({
        reference_roles: detail.evaluation_input_skeleton.reference_bindings,
        number_roles: detail.evaluation_input_skeleton.number_bindings,
        response_shapes: Object.freeze({
          role_bindings: "[{role, referents:[<returned referent selector>, ...]}]",
          value_bindings: "[{role, value:<number>}]"
        })
      }),
      detail_counts: detail.counts,
      source_digests: detail.source_digests,
      detail_retrieval: Object.freeze({
        collection: "dimensions",
        selector: Object.freeze({ id: "authoring_stage" }),
        field_path: Object.freeze(["owner_result", "contract_authoring",
          "proof_selection", "packs"]),
        selection: Object.freeze({ profile_id: candidate.profile_id,
          profile_version: candidate.profile_version })
      })
    });
  });
  return Object.freeze({
    schema_version: "controlled-contract-proof-selection-guidance.v1",
    intent_accounting: Object.freeze({ total: intentCatalog.length, returned: intentCatalog.length,
      omitted: 0 }),
    intents: Object.freeze(intentCatalog),
    selection_decision: selection.decision,
    pack_accounting: Object.freeze({ total: packs.length, returned: packs.length, omitted: 0 }),
    packs: Object.freeze(packs)
  });
}

async function resolveContractRequirementAuthoringFacts({ input, canonicalSet,
  record, hasContract, resolvedContract = null }) {

  const pkg = await loadControlledContractPackage();

  const { controlledContractRuntimeTestAuthoringVariants } =
    await import("./contract-requirement-input-schema.mjs");
  const contract = resolvedContract ?? (hasContract
    ? Object.values(canonicalSet.members_by_basename ?? {})
      .find((member) => member?.carrier_kind === "contract") ?? null
    : null);
  const vocabulary = projectControlledContractAuthoringVocabulary(
    deriveControlledContractAuthoringVocabulary(pkg.NATIVE_CONTRACT_SCHEMA_V1));
  const declaredReferents = projectControlledContractReferentSelectors(
    contract?.content ?? null);
  return Object.freeze({
    schema_version: "controlled-contract-requirement-authoring-facts.v1",
    input_shapes: CONTROLLED_CONTRACT_REQUIREMENT_INPUT_SHAPES,
    vocabulary,

    runtime_test: projectControlledContractRuntimeTestAuthoring(
      controlledContractRuntimeTestAuthoringVariants({
        verificationId: RUNTIME_TEST_SHAPE_PROBE_IDENTITY
      }).map(({ template }) => template)),

    criteria: Object.freeze((record?.acceptance?.criteria ?? [])
      .slice(0, CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.criteria_offered)
      .map((criterion, index) => Object.freeze({
        source_locator: `/acceptance/criteria/${index}`, criterion }))),
    declared_referents: declaredReferents,
    examples: requirementExamples(vocabulary, declaredReferents),
    proof_selection: await proofSelectionAuthoringFacts(pkg, contract?.content ?? null),

    declared_runtime_tests: Object.freeze((contract?.content?.test_proofs ?? [])
      .slice(0, CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.residue_per_answer)
      .map((binding) => Object.freeze({
        verification_claim_id: binding.verification_claim_id,
        declared: projectControlledContractDeclaredRuntimeTest(binding) }))),
    contract_content_digest: contract?.content_digest ?? null
  });
}

async function resolveReferenceAuthoringReadiness({ input, canonicalSet, record,
  recordSourceDigest }) {
  let population;
  try {
    population = resolveControlledContractReferenceCandidatePopulation({
      record, wkId: input.wkId, focus: input.focus ?? null, recordSourceDigest });
  } catch (error) {
    return Object.freeze({
      schema_version: "controlled-contract-reference-authoring-readiness.v1",
      status: "population_invalid", selected_pack: null,
      candidate_population_digest: null,
      required_role_count: 0, authorable_role_count: 0,
      required_roles: Object.freeze([]),
      blocking_role: null, blocking_reason_code: error?.code ?? null,
      blocking_candidate_count: null, blocking_candidate_ids: Object.freeze([])
    });
  }
  if (population.present !== true) return null;
  const contract = Object.values(canonicalSet.members_by_basename ?? {})
    .find((member) => member?.carrier_kind === "contract") ?? null;
  const evaluationInput = Object.values(canonicalSet.members_by_basename ?? {})
    .find((member) => member?.carrier_kind === "evaluation_input") ?? null;
  if (contract === null) return null;
  try {
    const roles = await resolveControlledContractPackReferenceRoles({
      contract: contract.content,
      evaluationInput: evaluationInput?.content ?? null,
      selectedPack: population.selected_pack });
    return projectControlledContractReferenceAuthoringReadiness(
      resolveControlledContractReferenceAuthoringPlan({
        wkId: input.wkId, focus: input.focus ?? null, roles, population,
        contract: contract.content }));
  } catch (error) {
    return Object.freeze({
      schema_version: "controlled-contract-reference-authoring-readiness.v1",
      status: "taxonomy_unavailable", selected_pack: population.selected_pack,
      candidate_population_digest: population.population_digest,
      required_role_count: 0, authorable_role_count: 0,
      required_roles: Object.freeze([]),
      blocking_role: null, blocking_reason_code: error?.code ?? null,
      blocking_candidate_count: null, blocking_candidate_ids: Object.freeze([])
    });
  }
}

async function resolveWorkbenchInput(input) {
  let ownerStage = "work_record";
  try {

  const ownerRequest = { repoRoot: input.repoRoot, wkId: input.wkId,
    focus: input.focus ?? null, selectedUnit: input.selectedUnit ?? null };
  const loaded = await loadWorkRecordById({ dir: input.repoRoot, id: input.wkId });
  const proofPosture = inspectWorkRecordProofPosture(loaded.record,
    { expectedRecordId: input.wkId });
  if (!proofPosture.valid) fail(
    "controlled_acceptance_proof_posture_invalid",
    proofPosture.reason
  );
  ownerStage = "canonical_set";
  const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
    repoRoot: ownerRequest.repoRoot, wkId: ownerRequest.wkId, focus: ownerRequest.focus
  });
  const hasContract = canonicalSet.members.some(member => member.carrier_kind === "contract");
  ownerStage = "saved_applications";
  const saved = hasContract ? await resolveProofAuthoringReadinessInputs(ownerRequest, canonicalSet) : null;
  const authoringState = saved?.authoringState ?? await resolveAuthoringState(ownerRequest, canonicalSet);
  const contractAssessment = saved?.contractAssessment ?? null;
  const obligationCoverage = saved?.obligationCoverage ?? null;
  const acceptanceCoverage = saved?.acceptanceCoverage ?? null;
  const referenceAuthoring = null;
  ownerStage = "contract_requirement_authoring";

  const contractAuthoring = await resolveContractRequirementAuthoringFacts({
    input, canonicalSet, record: loaded.record, hasContract,
    resolvedContract: saved?.obligationCoverage.contract ?? null });
  ownerStage = "runtime_proof_declaration";
  const runtimeProjection = saved === null ? null : { bindings: saved.testProofBindings,
    eligibility: saved.runtimeProofEligibility, source: saved.testProofSource };
  ownerStage = "owner_composition";
  const ownerInput = {
    subject: { wk_id: input.wkId, selected_unit: input.selectedUnit ?? null,
      focus: input.focus ?? null,
      generation_id: generationIdentity(canonicalSet),
      manifest_digest: canonicalSet.manifest_content_digest ?? null,
      record_source_digest: loaded.source_digest ?? null },
    proofPosture,
    authoringState: Object.freeze({ ...authoringState,
      ...(referenceAuthoring === null
        ? {} : { reference_authoring: referenceAuthoring }),
      ...(contractAuthoring === null
        ? {} : { contract_authoring: contractAuthoring }) }),
    workRecordValidation: validateWorkRecord(loaded.record),
    contractAssessment,
    obligationCoverage,
    acceptanceCoverage,
    testProofBindings: runtimeProjection?.bindings ?? null,
    runtimeProofEligibility: runtimeProjection?.eligibility ?? null,
    testProofSource: runtimeProjection?.source ?? null
  };
  if (saved !== null) bindProofAuthoringReadinessInputs(ownerInput, saved);
  return Object.freeze(ownerInput);
  } catch (error) {
    if (error && typeof error === "object") {
      error.details = { ...(error.details ?? {}), workbench_owner_stage: ownerStage };
    }
    throw error;
  }
}

export const CONTROLLED_CONTRACT_DESIGN_WORKBENCH_OWNERS = Object.freeze({
  resolveWorkbenchInput,
  deriveWorkbench: deriveControlledContractDesignWorkbench
});

function dependencies(overrides) {
  return Object.freeze({ ...CONTROLLED_CONTRACT_DESIGN_WORKBENCH_OWNERS,
    ...overrides });
}

const CURRENT_DESIGN_RESPONSE_KINDS = new Set(
  CONTROLLED_CONTRACT_DESIGN_RESPONSE_KINDS
);

function currentSemanticRemedy(dimensionId, subject) {
  const addressed = coverageUnitArguments({ wkId: subject.wk_id,
    focus: subject.focus ?? null, selectedUnit: subject.selected_unit ?? null });
  if (dimensionId === "proof_posture" || dimensionId === "contract_requirement") {
    return Object.freeze({
      capability: "controlled_acceptance_disposition_or_requirement_authoring",
      tool: "workspace_controlled_contract_obligation_coverage_query",
      arguments: { ...addressed }
    });
  }
  return Object.freeze({
    capability: "saved_obligation_meaning_or_proof_resolution",
    read_tool: "workspace_controlled_contract_obligation_coverage_query",
    write_tool: "workspace_controlled_contract_obligation_coverage_upsert",
    validation_tool: "workspace_validate_proof",
    ...addressed
  });
}

function narrowControlledContractDesignWorkbench(workbench) {
  const dimensions = workbench.dimensions.map((dimension) => {
    const remedy = currentSemanticRemedy(dimension.dimension_id, workbench.subject);
    const rows = dimension.rows.map((row) => {
      const eligibleResponseForms = (row.eligible_response_forms ?? [])
        .filter((kind) => CURRENT_DESIGN_RESPONSE_KINDS.has(kind));
      return Object.freeze({
        ...structuredClone(row),
        eligible_response_forms: Object.freeze(eligibleResponseForms),
        ...(eligibleResponseForms.length > 0 ? {} : {
          recovery_guidance: Object.freeze(structuredClone(remedy))
        })
      });
    });
    return Object.freeze({
      ...structuredClone(dimension),
      rows: Object.freeze(rows),
      recovery_guidance: Object.freeze(structuredClone(remedy))
    });
  });
  return Object.freeze({ ...structuredClone(workbench), dimensions: Object.freeze(dimensions) });
}

function projectDiagnosticAndRepairFacts(workbench, classification) {
  const descriptors = classification.descriptors;
  const rowsById = new Map();
  const dimensions = workbench.dimensions.map((dimension) => Object.freeze({
    ...structuredClone(dimension),
    rows: Object.freeze(dimension.rows.map((row) => {
      const descriptor = descriptors.get(row.row_id) ?? null;
      const projected = Object.freeze({ ...structuredClone(row),
        diagnostic_provenance: Object.freeze({
          owner: dimension.owner,
          owner_identity: structuredClone(dimension.owner_identity ?? null),
          dimension_id: dimension.dimension_id
        }),
        repair_authority: descriptor === null
          ? Object.freeze({ status: "unavailable", semantic_owner: null,
            response_kinds: Object.freeze([]) })
          : Object.freeze({ status: "authenticated",
            semantic_owner: descriptor.semantic_owner,
            response_kinds: Object.freeze([...(descriptor.response_kinds ?? [])]) })
      });
      rowsById.set(projected.row_id, projected);
      return projected;
    }))
  }));
  const projectRows = (rows) => Object.freeze(rows.map((row) =>
    rowsById.get(row.row_id) ?? row));
  return Object.freeze({ ...structuredClone(workbench), dimensions,
    actionable_rows: projectRows(workbench.actionable_rows ?? []),
    non_actionable_rows: projectRows(workbench.non_actionable_rows ?? []),
    elective_actions: projectRows(workbench.elective_actions ?? []) });
}

async function evaluateControlledAcceptance(input, deps) {
  const ownerInput = await deps.resolveWorkbenchInput(input);
  const posture = ownerInput.proofPosture ?? Object.freeze({
    present: false, valid: true, disposition: null, proof_posture: null, reason: null
  });
  const derived = deps.deriveWorkbench(ownerInput);
  let state;
  try {
    state = resolveControlledAcceptanceState({ posture, workbench: derived });
  } catch (error) {
    fail("controlled_acceptance_proof_posture_invalid", error.message, {
      source_code: error.code ?? null
    });
  }
  const stated = state === "opted_out"
    ? optedOutManifest(derived, posture)
    : Object.freeze({ ...structuredClone(derived),
      subject: Object.freeze({ ...structuredClone(derived.subject),
        controlled_acceptance_state: state }) });
  const initialClassification =
    classifyControlledContractDesignWorkbenchActionability(stated);
  const initialClassified = projectClassifiedControlledContractDesignWorkbench(
    stated, initialClassification);
  const narrowed = narrowControlledContractDesignWorkbench(initialClassified);
  const classification =
    classifyControlledContractDesignWorkbenchActionability(narrowed);
  const classified = projectDiagnosticAndRepairFacts(
    projectClassifiedControlledContractDesignWorkbench(narrowed, classification),
    classification);

  const repairCandidate = deriveControlledContractRepairCandidate(classified,
    { descriptors: classification.descriptors });
  const workbench = Object.freeze({ ...classified,
    evaluated_snapshot: deriveControlledAcceptanceEvaluatedSnapshot({
      ownerInput, workbench: classified, classification, repairCandidate
    }) });
  await assertProofAuthoringReadinessCurrent(ownerInput);
  return Object.freeze({ ownerInput, posture, workbench, classification,
    repairCandidate });
}

async function deriveManifest(input, deps) {
  return (await evaluateControlledAcceptance(input, deps)).workbench;
}

function optedOutManifest(derived, posture) {
  const dimensions = derived.dimensions.map((dimension) => ({
    ...structuredClone(dimension),
    status: "complete",
    counts: {
      complete: 0,
      missing: 0,
      stale: 0,
      conflicting: 0,
      not_applicable: dimension.rows.length,
      total: dimension.rows.length,
      returned: dimension.rows.length,
      omitted: 0
    },
    rows: dimension.rows.map((row) => ({
      ...structuredClone(row),
      state: "not_applicable",
      reason_codes: ["controlled_acceptance_opted_out_authored_unassessed"],
      evidence: {
        ...structuredClone(row.evidence ?? {}),
        proof_posture_disposition: {
          classification: posture.proof_posture.classification,
          exemption: posture.proof_posture.controlled_contract.exemption,
          classification_rationale: posture.proof_posture.classification_rationale
        }
      },
      eligible_response_forms: []
    }))
  }));
  return Object.freeze({
    ...structuredClone(derived),
    subject: Object.freeze({ ...structuredClone(derived.subject),
      controlled_acceptance_state: "opted_out",

      controlled_acceptance_provenance: CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE }),
    mechanically_complete: true,
    dimensions
  });
}

export async function inspectControlledContractDesignWorkbenchOperation(input, overrides = {}) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input,
      ["repoRoot", "wkId", "focus", "selectedUnit"]);
    return deriveManifest(input, dependencies(overrides));
  });
}
