

import {
  ControlledContractToolError,
  assertControlledContractAuthorableCarrierKind,
  assertControlledContractOperationInput,
  deriveCanonicalControlledContractAuthoringState,
  patchControlledContractTestProofBindings,
  readControlledContractCarrierFile,
  resolveControlledContractAuthoringContinuationMutation,
  writeControlledContractCarrierFile
} from "../../lib/controlled-contract-tools.mjs";
import { describeControlledContractAuthoring } from
  "../../lib/controlled-contract-authoring-projections.mjs";
import { CONTROLLED_CONTRACT_AUTHORING_TOOLS } from
  "../../lib/controlled-contract-authoring-state.mjs";
import {
  loadControlledContractPackage,
  loadEvaluationInputSchemaValue,
  loadProofPlanRequestSchema
} from "./package-runtime.mjs";
import { validateAuthorableCarrier } from "./authorable-carrier-validation.mjs";
import { throwAuthoringRefusal } from "./authoring-refusals.mjs";
import { controlledContractOperation } from "./refusal.mjs";
import { createControlledContractCarrierOperation } from "./carrier-operations.mjs";
import { patchControlledContractCarrierOperation } from "./carrier-operations.mjs";
import { patchControlledContractVerificationBundleOperation } from
  "./carrier-operations.mjs";
import { createControlledContractAcceptanceCoverageOperation,
  upsertControlledContractAcceptanceCoverageOperation,
  } from
  "./acceptance-coverage-operations.mjs";
import { buildProofAuthoringSkeletonOperation } from
  "./proof-authoring-skeleton-operations.mjs";
import { continueControlledContractProofGraphOperation } from
  "./proof-graph-operations.mjs";
import { buildProofPlanOperation } from "./proof-pack-operations.mjs";
import { persistControlledAcceptanceProofPostureOperation } from
  "./proof-posture-operations.mjs";
import {
  compileControlledContractRequirements,
  controlledContractRequirementPatchOperations,
  controlledContractRequirementVerificationBundles
} from "./contract-requirement-authoring.mjs";
import {
  buildControlledContractRuntimeTestTemplate,
  composeControlledContractRuntimeTestReplacement,
  sameControlledContractRuntimeTestProof
} from "./contract-requirement-runtime-proof.mjs";
import { deriveControlledContractAuthoringVocabulary } from
  "./contract-requirement-vocabulary.mjs";
import { persistControlledContractReferenceCandidatePopulation } from
  "./prospective-reference-authoring.mjs";
import { loadWorkRecordById } from "../../lib/work-record-store.mjs";
import { writeValidatedWorkRecord } from "../work-records-store-io.mjs";
import { runControlledContractRepairTransaction } from "./repair-transaction.mjs";
import { reauthorControlledContractCurrentDefinitions } from
  "./current-definition-reauthoring.mjs";

async function compileRequirementAnswer({ repoRoot, wkId, focus, response,
  expectedContentDigest, readCarrier }) {
  const pkg = await loadControlledContractPackage();
  let contract = null;
  if (expectedContentDigest !== null) {
    const carrier = await readCarrier({ repoRoot, wkId, focus,
      carrierKind: "contract" });
    if (carrier.content_digest !== expectedContentDigest) {
      throw new ControlledContractToolError(
        "controlled_contract_stale_content_digest",
        "the controlled contract changed after the wrapper issued the continuation",
        { changed: false, expected_content_digest: expectedContentDigest,
          actual_content_digest: carrier.content_digest });
    }
    contract = carrier.content;
  }
  return compileControlledContractRequirements({
    wkId, focus, answer: response, contract,
    vocabulary: deriveControlledContractAuthoringVocabulary(
      pkg.NATIVE_CONTRACT_SCHEMA_V1),

    buildTestProofTemplate: pkg.buildStableTestProofBindingTemplate,
    schemaIdentity: {
      schema_version: pkg.SCHEMA_VERSION_V1,
      vocabulary_version: pkg.VOCABULARY_VERSION_V1,
      profile_id: pkg.PROFILE_ID_V1,
      test_proof_version: pkg.TEST_PROOF_VERSION_V1
    }
  });
}

function coveragePopulationRows(context, authored, compose, {
  multiplePerCriterion = false
} = {}) {
  const offered = context.criteria ?? [];
  const offeredByIdentity = new Map(offered.map((criterion) =>
    [criterion.criterion_identity, criterion]));
  if (multiplePerCriterion) {
    const identities = new Set();
    const authoredByCriterion = new Map(offered.map((criterion) =>
      [criterion.criterion_identity, []]));
    for (const entry of authored) {
      if (!offeredByIdentity.has(entry.criterion_identity)) {
        throw new ControlledContractToolError(
          "controlled_contract_authoring_continuation_tampered",
          "the obligation population names a criterion the server did not declare",
          { changed: false, criterion_identity: entry.criterion_identity,
            failed_constraint: "criterion_identity_current_and_server_declared",
            safe_correction: "Refresh the workbench and use a criterion_identity from its current obligation authoring offer." });
      }
      if (entry.obligation_id !== undefined) {
        if (identities.has(entry.obligation_id)) throw new ControlledContractToolError(
          "controlled_contract_authoring_continuation_invalid",
          "the obligation population repeats an obligation identity",
          { changed: false, obligation_id: entry.obligation_id,
            failed_constraint: "obligation_id_unique_within_population",
            safe_correction: "Use a distinct uppercase hyphenated obligation_id for each atomic obligation." });
        identities.add(entry.obligation_id);
      }
      authoredByCriterion.get(entry.criterion_identity).push(entry);
    }
    const missing = offered.filter(({ criterion_identity: identity }) =>
      authoredByCriterion.get(identity).length === 0);
    if (missing.length > 0) throw new ControlledContractToolError(
      "controlled_contract_authoring_continuation_invalid",
      "the obligation population leaves server-declared criteria without an atomic obligation",
      { changed: false,
        missing_criterion_identities: missing.map(({ criterion_identity: id }) => id),
        failed_constraint: "at_least_one_atomic_obligation_per_criterion",
        safe_correction: "Add at least one complete atomic obligation for every listed criterion, preserving any additional obligations for the same criterion." });
    const serverOrdered = offered.flatMap(({ criterion_identity: identity }) =>
      authoredByCriterion.get(identity));
    const rows = serverOrdered.map((entry, index) => compose(entry, index,
      offeredByIdentity.get(entry.criterion_identity)));
    const resolvedIdentities = new Set();
    for (const row of rows) {
      if (resolvedIdentities.has(row.obligation_id)) throw new ControlledContractToolError(
        "controlled_contract_authoring_continuation_invalid",
        "the obligation population resolves two entries to the same obligation identity",
        { changed: false, obligation_id: row.obligation_id,
          failed_constraint: "resolved_obligation_id_unique_within_population",
          safe_correction: "Give every obligation an explicit distinct uppercase hyphenated obligation_id when explicit and server-default identities would overlap." });
      resolvedIdentities.add(row.obligation_id);
    }
    return rows;
  }
  const byIdentity = new Map();
  for (const entry of authored) {
    if (byIdentity.has(entry.criterion_identity)) {
      throw new ControlledContractToolError(
        "controlled_contract_authoring_continuation_invalid",
        "one criterion carries more than one disposition in this population",
        { changed: false, criterion_identity: entry.criterion_identity });
    }
    byIdentity.set(entry.criterion_identity, entry);
  }
  const rows = offered.map((criterion, index) => {
    const entry = byIdentity.get(criterion.criterion_identity);
    if (entry === undefined) {
      throw new ControlledContractToolError(
        "controlled_contract_authoring_continuation_invalid",
        "the coverage population leaves a server-declared criterion undispositioned",
        { changed: false, criterion_identity: criterion.criterion_identity,
          source_locator: criterion.source_locator ?? null });
    }
    byIdentity.delete(criterion.criterion_identity);
    return compose(entry, index, criterion);
  });
  if (byIdentity.size > 0) {
    throw new ControlledContractToolError(
      "controlled_contract_authoring_continuation_tampered",
      "the coverage population dispositions a criterion the server did not declare",
      { changed: false, criterion_identities: [...byIdentity.keys()].sort() });
  }
  return rows;
}

function composeProofPackRoleBindings(response) {
  return {
    reference_bindings: (response.role_bindings ?? []).map(
      ({ role, referents }) => ({ role, reference_ids: [...referents] })),
    number_bindings: (response.value_bindings ?? []).map(
      ({ role, value }) => ({ role, value })),
    claim_pattern_bindings: []
  };
}

async function composeRuntimeTestReplacement({ repoRoot, wkId, focus, response,
  verificationClaimId, expectedContentDigest, readCarrier }) {
  const pkg = await loadControlledContractPackage();
  const carrier = await readCarrier({ repoRoot, wkId, focus,
    carrierKind: "contract" });
  if (carrier.content_digest !== expectedContentDigest) {
    throw new ControlledContractToolError(
      "controlled_contract_stale_content_digest",
      "the controlled contract changed after the wrapper issued the continuation",
      { changed: false, expected_content_digest: expectedContentDigest,
        actual_content_digest: carrier.content_digest });
  }
  const binding = composeControlledContractRuntimeTestReplacement({
    template: buildControlledContractRuntimeTestTemplate(pkg.buildStableTestProofBindingTemplate, { contract: null,
      verificationId: verificationClaimId, strategy: response.runtime_test?.falsifier?.strategy },
    "runtime_test"),
    runtimeTest: response.runtime_test,
    falsifierSelection: response.runtime_test?.falsifier,
    contract: carrier.content,
    verificationClaimId, field: "runtime_test"
  });
  const stored = (carrier.content?.test_proofs ?? []).find(
    ({ verification_claim_id: id }) => id === verificationClaimId) ?? null;
  if (stored !== null && sameControlledContractRuntimeTestProof(stored, binding)) {
    throw new ControlledContractToolError(
      "controlled_contract_requirement_runtime_replacement_unchanged",
      "the replacement states the meaning this proof already declares",
      { changed: false, verification_claim_id: verificationClaimId });
  }

  try {
    pkg.replaceStableTestProofBindings({ contract: carrier.content,
      replacements: [{ op: "replace", verification_id: verificationClaimId, binding }] });
  } catch (error) {
    if (!(error instanceof pkg.StableTestProofContractError)) throw error;
    throw new ControlledContractToolError(error.code, error.message,
      { ...error.details, changed: false });
  }
  return binding;
}

function assertProofAuthoringSelectionProgressed(skeleton) {
  const unbound = (skeleton?.unresolved_required_roles ?? []).filter(
    ({ kind }) => kind === "reference");
  if (unbound.length === 0 || skeleton?.continuation != null) return skeleton;
  throw new ControlledContractToolError(
    "controlled_contract_reference_authoritative_facts_missing",
    "the selected proof pack requires reference roles this contract cannot satisfy",
    { changed: false,
      unresolved_reference_roles: unbound.map(({ role, status }) =>
        ({ role, status: status ?? null })),
      answerable_response_kind: "reference_candidates" }
  );
}

export async function applyControlledContractDesignSemanticResponse({
  repoRoot, wkId, focus = null, continuationRecord, response, referenceRepairCandidate
}, {
  createCarrier = createControlledContractCarrierOperation,
  patchCarrier = patchControlledContractCarrierOperation,
  readCarrier = readControlledContractCarrierFile,
  patchTestProof = patchControlledContractTestProofBindings,
  patchVerificationBundle = patchControlledContractVerificationBundleOperation,
  buildSkeleton = buildProofAuthoringSkeletonOperation,
  continueAuthoring = continueControlledContractAuthoringOperation,
  continueProofGraph = continueControlledContractProofGraphOperation,
  buildProofPlan = buildProofPlanOperation,
  runReferenceRepair = runControlledContractRepairTransaction,
  createAcceptance = createControlledContractAcceptanceCoverageOperation,
  upsertAcceptance = upsertControlledContractAcceptanceCoverageOperation,
  persistControlledAcceptanceProofPosture = persistControlledAcceptanceProofPostureOperation,
  persistReferenceCandidates = (request) =>
    persistControlledContractReferenceCandidatePopulation(request,
      { loadRecord: loadWorkRecordById, writeRecord: writeValidatedWorkRecord }),
  reauthorCurrentDefinitions = reauthorControlledContractCurrentDefinitions
} = {}) {
  const context = continuationRecord.workbench.owner_context;
  switch (continuationRecord.workbench.semantic_owner) {
  case "contract_reference": {

    if (referenceRepairCandidate?.unique !== true ||
        !referenceRepairCandidate.rows.some((row) =>
          row.row_id === continuationRecord.workbench.row_id &&
          row.semantic_owner === "contract_reference")) {
      throw new ControlledContractToolError(
        "controlled_contract_reference_authoring_unavailable",
        "The incumbent repair owner did not qualify this reference-authoring row.",
        { changed: false, reason_code: referenceRepairCandidate?.reason_code ?? null,
          supported_next_step: null });
    }
    try {
      return await runReferenceRepair({ input: { repoRoot, wkId, focus },
        candidate: referenceRepairCandidate, referenceAttempt: continuationRecord.identity });
    } catch (error) {
      if (!(error instanceof ControlledContractToolError)) throw error;
      throw new ControlledContractToolError(error.code, error.message, {
        ...error.details, explanation: error.message,
        ...(error.details?.recovery === undefined && error.details?.next_calls === undefined
          ? { supported_next_step: null } : {}) });
    }
  }
  case "proof_posture":
    return persistControlledAcceptanceProofPosture({ repoRoot, wkId, focus,
      disposition: response.kind === "declare_controlled_acceptance_applies"
        ? "required" : "opted_out",
      rationale: response.rationale ?? null,
      expectedSourceDigest: context.expected_record_source_digest });
  case "contract_carrier": {

    const compiled = await compileRequirementAnswer({ repoRoot, wkId, focus,
      response, expectedContentDigest: context.expected_content_digest,
      readCarrier });
    if (context.expected_content_digest === null) {

      return createCarrier({ repoRoot, wkId, focus, carrierKind: "contract",
        content: compiled.content, expectedContentDigest: null });
    }

    if (compiled.replaced.test_proofs.length > 0) {
      if (compiled.added.test_proofs.length > 0) throw new ControlledContractToolError(
        "controlled_contract_requirement_runtime_replacement_not_isolated",
        "an answer that changes an existing stable test proof publishes through the replacement owner alone",
        { changed: false,
          replaced_verification_ids: [...compiled.replaced.test_proofs],
          failed_constraint: "existing_runtime_test_replacement_isolated_from_new_runtime_tests",
          safe_correction: "Submit the changed existing runtime-test requirement alone, then submit new runtime-test requirements in a separate answer.",
          next_answer: "restate the changed runtime-test requirement as its own answer" });
      return patchTestProof({ repoRoot, wkId, focus,
        expectedContentDigest: context.expected_content_digest,
        operations: compiled.replaced.test_proofs.map((verificationId) => ({
          op: "replace", verification_id: verificationId,
          binding: compiled.content.test_proofs.find(
            ({ verification_claim_id: id }) => id === verificationId) })) });
    }
    if (compiled.added.test_proofs.length > 0) {
      return patchVerificationBundle({ repoRoot, wkId, focus,
        expectedContentDigest: context.expected_content_digest,
        operations: controlledContractRequirementVerificationBundles({ compiled }) });
    }
    return patchCarrier({ repoRoot, wkId, focus, carrierKind: "contract",
      expectedContentDigest: context.expected_content_digest,
      operations: controlledContractRequirementPatchOperations({ compiled }) });
  }
  case "test_proof": {
    if (response.kind === "current_definition_reauthoring") {
      return reauthorCurrentDefinitions({ repoRoot, wkId, focus,
        expectedContentDigest: context.expected_content_digest,
        qualification: context.qualification,
        definitions: response.definitions });
    }

    const binding = await composeRuntimeTestReplacement({ repoRoot, wkId, focus,
      response, verificationClaimId: context.verification_claim_id,
      expectedContentDigest: context.expected_content_digest, readCarrier });
    return patchTestProof({ repoRoot, wkId, focus,
      expectedContentDigest: context.expected_content_digest,
      operations: [{ op: "replace", verification_id: context.verification_claim_id,
        binding }] });
  }
  case "verification_bundle":
    if (response.bundle?.verification_id !== context.verification_id) {
      throw new ControlledContractToolError(
        "controlled_contract_authoring_continuation_tampered",
        "semantic response changed the server-selected verification identity"
      );
    }
    return patchVerificationBundle({ repoRoot, wkId, focus,
      expectedContentDigest: context.expected_content_digest,
      operations: [{ op: "upsert", verification_id: context.verification_id,
        bundle: response.bundle }] });
  case "proof_authoring":

    if (response.kind === "reference_candidates") {
      return persistReferenceCandidates({ repoRoot, wkId, focus,
        selectedPack: structuredClone(response.selected_pack),
        candidates: structuredClone(response.candidates),
        expectedSourceDigest: context.expected_record_source_digest });
    }
    return assertProofAuthoringSelectionProgressed(await buildSkeleton({
      repoRoot, wkId, focus,
      selectedPack: response.selected_pack,
      requestedIntents: response.requested_intents,

      bindings: composeProofPackRoleBindings(response),

      proposalDraft: { carrier_operations: [] } }));
  case "authoring_continuation":
    return continueAuthoring({ repoRoot, wkId, focus,
      continuation: context.continuation, expectedStage: context.expected_stage });
  case "proof_graph":
    return continueProofGraph({ repoRoot, wkId, focus,
      continuation: context.continuation });
  case "proof_plan":
    return buildProofPlan({ repoRoot, wkId, focus,
      expectedContentDigest: context.expected_content_digest });
  case "acceptance_coverage":
    if (response.kind === "acceptance_coverage_population") {
      return createAcceptance({ repoRoot, wkId, focus,
        selectedUnit: context.selected_unit ?? null,
        carrierIdentity: structuredClone(context.carrier_identity),
        sourceIdentity: structuredClone(context.source_identity),
        expectedUnitDigest: context.expected_unit_digest,
        expectedContentDigest: null,
        rows: coveragePopulationRows(context, response.criteria,
          (entry) => ({ criterion_identity: entry.criterion_identity,
            node_ids: structuredClone(entry.node_ids),
            axes: structuredClone(entry.axes) })) });
    }
    return upsertAcceptance({ repoRoot, wkId, focus,
      selectedUnit: context.selected_unit ?? null,
      carrierIdentity: structuredClone(context.carrier_identity),
      sourceIdentity: structuredClone(context.source_identity),
      expectedContentDigest: context.expected_content_digest,
      criterionSelector: { kind: "criterion_identity",
        criterion_identity: context.criterion_identity },
      row: { criterion_identity: context.criterion_identity,
        node_ids: structuredClone(response.node_ids),
        axes: structuredClone(response.axes) } });
  case "obligation_coverage":
    throw new ControlledContractToolError(
      "obligation_coverage_request_invalid",
      "Obligation authoring uses selected read and one current upsert; old continuation payloads are retired",
      { changed: false, phase: "request", limb: "mechanical_failure",
        next_calls: [{ tool: "workspace_controlled_contract_obligation_coverage_query",
          arguments: { unit: context.selected_unit ? `${wkId}#${context.selected_unit}` : wkId,
            ...(focus === null ? {} : { focus }) } }] });
  default:
    throw new ControlledContractToolError(
      "controlled_contract_authoring_continuation_invalid",
      "workbench continuation names no supported semantic owner"
    );
  }
}

export async function describeControlledContractAuthoringOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["carrierKind", "target"]);
    assertControlledContractAuthorableCarrierKind(input.carrierKind);
    const pkg = await loadControlledContractPackage();
    return describeControlledContractAuthoring({ carrierKind: input.carrierKind,
      target: input.target ?? null, schemas: { contract: pkg.NATIVE_CONTRACT_SCHEMA_V1,
        evaluation_input: await loadEvaluationInputSchemaValue(),
        proof_plan_request: await loadProofPlanRequestSchema() } });
  });
}

export async function controlledContractAuthoringStateOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "continuation"
    ]);
    return deriveCanonicalControlledContractAuthoringState({
      ...input,
      focus: input.focus ?? null,
      continuation: input.continuation ?? null,
      request: {
        wk_id: input.wkId,
        ...(input.focus === undefined || input.focus === null ? {} : { focus: input.focus }),
        ...(input.continuation === undefined ? {} : { continuation: input.continuation })
      }
    });
  });
}

export async function continueControlledContractAuthoringOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "continuation", "expectedStage"
    ]);
    const mutation = await resolveControlledContractAuthoringContinuationMutation({
      ...input,
      focus: input.focus ?? null
    });
    if (mutation.refused) throwAuthoringRefusal(mutation.refused);

    const actualStage = mutation.carrierKind === "evaluation_input"
      ? "evaluation_input_ready"
      : mutation.carrierKind === "proof_plan_request"
        ? "proof_plan_request_ready" : null;
    const writableCarrierKind = actualStage === null
      ? null : mutation.carrierKind ?? null;
    if (input.expectedStage !== undefined && input.expectedStage !== actualStage) {
      throw new ControlledContractToolError(
        "controlled_contract_authoring_continuation_stale",
        "authoring continuation stage changed before mutation",
        { expected_stage: input.expectedStage, actual_stage: actualStage,
          replacement_call: { tool: CONTROLLED_CONTRACT_AUTHORING_TOOLS.state,
            arguments: { unit: input.wkId,
              ...(input.focus === undefined || input.focus === null
                ? {} : { focus: input.focus }) } } }
      );
    }
    if (writableCarrierKind !== null) {
      const carrierInput = {
        repoRoot: input.repoRoot,
        wkId: input.wkId,
        focus: input.focus ?? null,
        carrierKind: writableCarrierKind,
        content: mutation.content,
        expectedContentDigest: mutation.expectedContentDigest
      };
      if (writableCarrierKind === "evaluation_input") {
        const selectedPack = mutation.continuationRecord.skeleton.selected_pack;
        carrierInput.profileId = selectedPack.profile_id;
        carrierInput.profileVersion = selectedPack.profile_version;
      }
      carrierInput.canonicalSet = mutation.canonicalSet;
      await validateAuthorableCarrier(
        carrierInput, mutation.content, mutation.canonicalSet);
      await writeControlledContractCarrierFile(carrierInput);
    }
    return deriveCanonicalControlledContractAuthoringState({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      continuation: input.continuation,
      request: {
        wk_id: input.wkId,
        ...(input.focus === undefined || input.focus === null ? {} : { focus: input.focus }),
        continuation: input.continuation
      }
    });
  });
}
