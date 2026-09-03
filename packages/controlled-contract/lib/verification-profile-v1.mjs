import { canonicalJsonBytes } from "./deterministic-projection-primitives.mjs";
import { MAX_ARTIFACT_BYTES } from "./exact-binding-runtime-registry.mjs";
import { profileDigest } from "./profile-digest.mjs";
import { POLICY_RESOURCE_LIMITS } from "./resource-policy.mjs";
import {
  evaluateVerificationProfileWithRuntime
} from "./verification-profile-runtime.mjs";
import { createExpandedProfileSemanticValidator } from
  "./verification-profile-expanded-semantics.mjs";
import {
  evaluateCompletePopulationBindingV1,
  normalizeReferenceV1,
  referencesEquivalentV1
} from "./population-semantics-v1.mjs";
import {
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1,
  validateAndResolveNativeContractV1
} from "./native-contract-carrier-v1.mjs";
import { CONTROLLED_VOCABULARY, VOCABULARY_DIGESTS } from
  "../vocabulary/controlled-contract-vocabulary.v1.mjs";
import { deriveVocabularySchemaProjection } from "./vocabulary-v1.mjs";
import {
  RESULT_VERSION_V1,
  validateEvaluationInputSchemaV1,
  validateProfileSchemaV1,
  validateResultSchemaV1
} from "./verification-profile-schema-v1.mjs";
import { validateStableV1Family } from "./stable-v1-family-validation.mjs";
import { buildCompletePopulation } from "./population-semantics-v1.mjs";
import {
  buildStableOccurrencePopulation,
  validateStableOccurrenceCapture
} from "./population-semantics-v1.mjs";
import { buildExactAssociationGraph } from "./stable-association-semantics.mjs";
import { evaluateExactPartition } from "./stable-partition-semantics.mjs";
import {
  assertAcyclicRelation,
  assertExactAdjacency,
  assertInverseRelation,
  assertTransitiveRelation,
  buildCompleteRelationPopulation,
  matchRelationPopulation
} from "./stable-relation-semantics.mjs";
import { projectBoundedDiagnostics } from "./bounded-diagnostic-projection.mjs";
import {
  resolveTestProofProviderCompatibility
} from "./test-proof-provider-registry.mjs";
import { projectStableTestProofCurrentPopulation } from
  "./test-proof-contract-v1.mjs";

const validateProfileSemanticsV1 = createExpandedProfileSemanticValidator({
  controlledVocabulary: CONTROLLED_VOCABULARY,
  vocabularyProjection: deriveVocabularySchemaProjection()
});
const VERIFICATION_PROFILE_RESULTS = new WeakSet();

class StableVerificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StableVerificationError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const STABLE_RESOURCE_LIMITS = Object.freeze({
  individual_source_bytes: MAX_ARTIFACT_BYTES,
  aggregate_source_bytes: POLICY_RESOURCE_LIMITS.verified_input_bytes.limit,
  projection_result_bytes: POLICY_RESOURCE_LIMITS.successful_output_bytes.limit,
  work_units: POLICY_RESOURCE_LIMITS.universal_occurrences.limit
});

function refuse(code, message, details = {}) {
  throw new StableVerificationError(code, message, details);
}

function assertVerificationProfileV1Result(result) {
  if (!VERIFICATION_PROFILE_RESULTS.has(result) || !Object.isFrozen(result)) refuse(
    "stable_verification_profile_result_unrecognized",
    "verification-profile consumers require the exact package-minted result"
  );
  return result;
}

function deepFreezeComplete(value) {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreezeComplete(child);
  return Object.freeze(value);
}

function assertNonnegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) refuse(
    "stable_resource_measure_invalid", "resource measures are nonnegative safe integers",
    { field, actual: value }
  );
}

function sameDescriptor(left, right) {
  return ["type", "dev", "ino", "size"].every((field) => left?.[field] === right?.[field]);
}

function assertStableResourceUsage({
  individual_source_bytes: individualSourceBytes = 0,
  aggregate_source_bytes: aggregateSourceBytes = 0,
  projection_result_bytes: projectionResultBytes = 0,
  work_units: workUnits = 0,
  descriptor_before: descriptorBefore = null,
  descriptor_after: descriptorAfter = null,
  read_length: readLength = null
}) {
  for (const [field, value] of Object.entries({ individual_source_bytes: individualSourceBytes,
    aggregate_source_bytes: aggregateSourceBytes,
    projection_result_bytes: projectionResultBytes, work_units: workUnits })) {
    assertNonnegativeInteger(value, field);
    if (value > STABLE_RESOURCE_LIMITS[field]) refuse(
      `stable_${field}_limit_exceeded`, "stable evaluation refuses N+1 without truncation",
      { field, observed: value, limit: STABLE_RESOURCE_LIMITS[field] }
    );
  }
  if ((descriptorBefore === null) !== (descriptorAfter === null) ||
      descriptorBefore !== null && (!sameDescriptor(descriptorBefore, descriptorAfter) ||
        descriptorBefore.type !== "regular_file" ||
        descriptorBefore.size !== readLength || descriptorAfter.size !== readLength)) refuse(
    "stable_source_descriptor_changed",
    "regular-file type, device, inode, size, and read length must remain exact",
    { descriptor_before: descriptorBefore, descriptor_after: descriptorAfter,
      read_length: readLength }
  );
  return true;
}

const diagnostic = (code, pointer, details = {}) => ({ code, pointer, ...details });
const unique = (values) => new Set(values).size === values.length;

function providerEvidenceDiagnostics(authored, evidence, capability, pointer, _missingCode,
  compatibility = {}) {
  const authoredResult = resolveTestProofProviderCompatibility({
    provider: authored, capability, pointer: `${pointer}/authored`
  });
  if (!authoredResult.valid) return [authoredResult.diagnostic];
  const evidenceResult = resolveTestProofProviderCompatibility({
    provider: evidence,
    capability,
    pointer,
    expected_provider_id: authored.provider_id,
    require_snapshot: true,
    ...compatibility
  });
  const diagnostics = [];
  if (evidence?.path !== undefined) diagnostics.push(diagnostic(
    "test_validity_caller_executor_forbidden", `${pointer}/path`
  ));
  if (!evidenceResult.valid) diagnostics.push(evidenceResult.diagnostic);
  return diagnostics;
}

function observationDiagnostics(observation, pointer, mechanism) {
  if (!observation) return [diagnostic(
    "test_validity_launcher_observation_missing", pointer
  )];
  const diagnostics = [];
  if (observation.mechanism !== mechanism) diagnostics.push(diagnostic(
    "test_validity_launcher_observation_mechanism_mismatch", `${pointer}/mechanism`
  ));
  if (observation.test_controlled_output_used === true) diagnostics.push(diagnostic(
    "test_validity_test_controlled_output_forbidden",
    `${pointer}/test_controlled_output_used`
  ));
  const digest = observation.artifact_digest;
  const expectedId = typeof digest === "string" && /^sha256:[a-f0-9]{64}$/u.test(digest)
    ? `artifact-${digest.slice(7)}` : null;
  if (observation.artifact_owner !== "launcher" || observation.artifact_id !== expectedId) {
    diagnostics.push(diagnostic("test_validity_launcher_artifact_forged",
      `${pointer}/artifact_id`));
  }
  return diagnostics;
}

function inventoryDiagnostics(binding, input) {
  if (!input.test_inventory) return [diagnostic(
    "test_validity_inventory_missing", "/stable_evaluation/test_validity/test_inventory"
  )];
  const diagnostics = [];
  const declared = input.test_inventory.declared_test_ids;
  const observed = input.test_inventory.observed_tests;
  const observedIds = observed.map(({ test_id: testId }) => testId);
  const baseline = input.test_inventory.baseline_executed_test_ids;
  const coverage = binding.coverage_disposition;
  const authoredBaselineIds = coverage.items.map(({ test_id: testId }) => testId);
  const authoredCurrentIds = projectStableTestProofCurrentPopulation(binding);
  const samePopulation = (left, right) => left.length === right.length &&
    new Set(left).size === left.length && new Set(right).size === right.length &&
    left.every((value) => right.includes(value));
  if (!unique(declared)) diagnostics.push(diagnostic(
    "test_validity_declared_test_duplicate", "/stable_evaluation/test_validity/test_inventory"
  ));
  if (!unique(observedIds)) diagnostics.push(diagnostic(
    "test_validity_observed_test_duplicate", "/stable_evaluation/test_validity/test_inventory"
  ));
  if (!samePopulation(declared, authoredCurrentIds)) diagnostics.push(diagnostic(
    "test_validity_authored_inventory_incomplete",
    "/stable_evaluation/test_validity/test_inventory/declared_test_ids"
  ));
  if (!samePopulation(observedIds, authoredCurrentIds)) diagnostics.push(diagnostic(
    "test_validity_authored_coverage_unobserved",
    "/stable_evaluation/test_validity/test_inventory/observed_tests"
  ));
  const expectedBaseline = coverage.baseline_state === "complete_executed_inventory"
    ? authoredBaselineIds : [];
  if (!samePopulation(baseline, expectedBaseline)) diagnostics.push(diagnostic(
    "test_validity_authored_baseline_incomplete",
    "/stable_evaluation/test_validity/test_inventory/baseline_executed_test_ids"
  ));
  for (const testId of declared) if (!observedIds.includes(testId)) diagnostics.push(diagnostic(
    "test_validity_declared_test_removed", "/stable_evaluation/test_validity/test_inventory"
  ));
  for (const testId of observedIds) if (!declared.includes(testId)) diagnostics.push(diagnostic(
    "test_validity_undeclared_test_observed", "/stable_evaluation/test_validity/test_inventory"
  ));
  for (const item of observed) {
    if (item.status === "skipped" && baseline.includes(item.test_id)) diagnostics.push(diagnostic(
      "test_validity_newly_skipped_test", "/stable_evaluation/test_validity/test_inventory"
    ));
    if (item.status === "failed") diagnostics.push(diagnostic(
      "test_validity_observed_test_failed", "/stable_evaluation/test_validity/test_inventory"
    ));
  }
  if (coverage.baseline_state === "complete_executed_inventory") {
    const dispositionIds = coverage.items.map(({ test_id: testId }) => testId);
    for (const testId of baseline) if (!dispositionIds.includes(testId)) diagnostics.push(
      diagnostic("test_validity_coverage_undispositioned",
        "/stable_evaluation/test_validity/test_inventory")
    );
  } else if (baseline.length > 0) diagnostics.push(diagnostic(
    "test_validity_coverage_baseline_conflict", "/stable_evaluation/test_validity/test_inventory"
  ));
  return diagnostics;
}

function falsifierDiagnostics(binding, input) {
  const diagnostics = [];
  const executions = input.falsifier_executions ?? [];
  if (executions.length !== binding.falsifiers.length) diagnostics.push(diagnostic(
    "test_validity_falsifier_provider_population_incomplete",
    "/stable_evaluation/test_validity/falsifier_executions"
  ));
  const ids = executions.map(({ falsifier_id: falsifierId }) => falsifierId);
  if (!unique(ids)) diagnostics.push(diagnostic(
    "test_validity_falsifier_execution_duplicate",
    "/stable_evaluation/test_validity/falsifier_executions"
  ));
  for (const falsifier of binding.falsifiers) {
    const execution = executions.find(({ falsifier_id: id }) => id === falsifier.falsifier_id);
    const pointer = `/stable_evaluation/test_validity/falsifier_executions/${falsifier.falsifier_id}`;
    if (!execution) {
      diagnostics.push(diagnostic("test_validity_falsifier_missing", pointer));
      continue;
    }
    diagnostics.push(...providerEvidenceDiagnostics(falsifier.execution_provider,
      execution.provider, "falsifier_execution", `${pointer}/provider`,
      "test_validity_falsifier_provider_missing", {
        observation_mechanism: execution.observation?.mechanism,
        strategy: execution.provider?.strategy,
        boundary_kind: falsifier.mutation?.target_kind
      }));
    diagnostics.push(...observationDiagnostics(execution.observation,
      `${pointer}/observation`, "node_test_structured_events"));
    if (execution.skipped) diagnostics.push(diagnostic(
      "test_validity_falsifier_skipped", `${pointer}/skipped`
    ));
    if (!execution.isolated) diagnostics.push(diagnostic(
      "test_validity_falsifier_not_isolated", `${pointer}/isolated`
    ));
    if (!execution.target_verification_failed) diagnostics.push(diagnostic(
      "test_validity_falsifier_inert", `${pointer}/target_verification_failed`
    ));
    if (execution.mutation?.applied !== true) diagnostics.push(diagnostic(
      "test_validity_falsifier_mutation_unobserved", `${pointer}/mutation/applied`
    ));
    if (execution.mutation?.mutation_id !== falsifier.mutation?.mutation_id ||
        execution.mutation?.strategy !== falsifier.strategy) diagnostics.push(diagnostic(
      "test_validity_falsifier_mutation_mismatch", `${pointer}/mutation`
    ));
    if (execution.mutation?.target_verification_id !== binding.verification_claim_id) {
      diagnostics.push(diagnostic(
        "test_validity_falsifier_wrong_verification", `${pointer}/mutation`
      ));
    }
    if (execution.failure_reason_source !== "launcher_structured_event") diagnostics.push(
      diagnostic("test_validity_falsifier_reason_unauthenticated",
        `${pointer}/failure_reason_source`)
    );
    if (execution.failure_reason_code !== `test_proof_fault.${falsifier.strategy}.v1`) {
      diagnostics.push(diagnostic(
        "test_validity_falsifier_reason_mismatch", `${pointer}/failure_reason_code`
      ));
    }
    if (execution.failure_proposition_id !== falsifier.proposition_id) diagnostics.push(
      diagnostic("test_validity_falsifier_wrong_target", `${pointer}/failure_proposition_id`)
    );
  }
  for (const id of ids) if (!binding.falsifiers.some(
    ({ falsifier_id: expected }) => expected === id
  )) diagnostics.push(diagnostic(
    "test_validity_falsifier_undeclared", `/stable_evaluation/test_validity/${id}`
  ));
  return diagnostics;
}

function traversalDiagnostics(binding, input) {
  const traversal = input.boundary_traversal;
  const authored = binding.traversal_provider;
  const pointer = "/stable_evaluation/test_validity/boundary_traversal";
  if (authored?.mode === "registry_unsupported") {
    const registryResult = resolveTestProofProviderCompatibility({
      provider: traversal?.provider,
      capability: "traversal_unsupported",
      pointer: `${pointer}/provider`
    });
    return traversal?.provider_support === "unsupported" &&
      traversal?.result === "review_only" && traversal?.authenticated === true &&
      registryResult.valid ? [] : [registryResult.diagnostic ?? diagnostic(
        "test_validity_unsupported_traversal_overclaimed", pointer
      )];
  }
  if (!traversal) return [diagnostic("test_validity_traversal_evidence_missing", pointer)];
  if (traversal.provider_support !== "supported") return [diagnostic(
    "test_validity_unsupported_traversal_overclaimed", pointer
  )];
  const diagnostics = providerEvidenceDiagnostics(authored, traversal.provider,
    "boundary_traversal", `${pointer}/provider`, "test_validity_traversal_provider_missing", {
      observation_mechanism: traversal.observation?.mechanism,
      observation_seam: traversal.observation_seam,
      boundary_kind: traversal.provider?.boundary_kind
    });
  diagnostics.push(...observationDiagnostics(traversal.observation,
    `${pointer}/observation`, "node_test_v8_coverage"));
  if (traversal.instrumented !== true) diagnostics.push(diagnostic(
    "test_validity_traversal_instrumentation_missing", pointer
  ));
  if (traversal.observation_seam !== authored?.observation_seam) diagnostics.push(diagnostic(
    "test_validity_traversal_observation_seam_mismatch", pointer
  ));
  if (traversal.result !== "proven") diagnostics.push(diagnostic(
    "test_validity_supported_traversal_not_proven", pointer
  ));
  if (!traversal.authenticated) diagnostics.push(diagnostic(
    "test_validity_traversal_unauthenticated", pointer
  ));
  if (traversal.boundary_id !== binding.system_under_test_boundary.boundary_id) {
    diagnostics.push(diagnostic("test_validity_traversal_wrong_boundary", pointer));
  }
  if (traversal.observable_id !== binding.observable_result.observable_id) {
    diagnostics.push(diagnostic("test_validity_traversal_wrong_observable", pointer));
  }
  return diagnostics;
}

function evaluateNativeTestValidity(contract, input) {
  const diagnostics = [];
  const candidates = contract.test_proofs.filter(
    ({ verification_claim_id: claimId }) => claimId === input.verification_id
  );
  if (candidates.length !== 1) return [diagnostic(
    candidates.length === 0 ? "test_validity_binding_missing" :
      "test_validity_binding_ambiguous", "/stable_evaluation/test_validity"
  )];
  const binding = candidates[0];
  if (input.test_proof_id !== binding.test_proof_id) diagnostics.push(diagnostic(
    "test_validity_test_proof_identity_mismatch", "/stable_evaluation/test_validity"
  ));
  if (!input.candidate_execution?.passed) diagnostics.push(diagnostic(
    "test_validity_candidate_failed", "/stable_evaluation/test_validity/candidate_execution"
  ));
  diagnostics.push(...providerEvidenceDiagnostics(binding.candidate_execution_provider,
    input.candidate_execution?.provider, "candidate_execution",
    "/stable_evaluation/test_validity/candidate_execution/provider",
    "test_validity_candidate_provider_missing", {
      observation_mechanism: input.candidate_execution?.observation?.mechanism
    }));
  diagnostics.push(...observationDiagnostics(input.candidate_execution?.observation,
    "/stable_evaluation/test_validity/candidate_execution/observation",
    "node_test_structured_events"));
  if (input.candidate_execution?.observed_boundary_id !==
      binding.system_under_test_boundary.boundary_id) diagnostics.push(diagnostic(
    "test_validity_sut_boundary_mismatch", "/stable_evaluation/test_validity"
  ));
  if (input.candidate_execution?.observed_observable_id !==
      binding.observable_result.observable_id) diagnostics.push(diagnostic(
    "test_validity_observable_mismatch", "/stable_evaluation/test_validity"
  ));
  if (input.candidate_execution?.source_text_inspection_used === true) diagnostics.push(
    diagnostic("test_validity_prohibited_source_text_inspection",
      "/stable_evaluation/test_validity")
  );
  diagnostics.push(...falsifierDiagnostics(binding, input));
  diagnostics.push(...inventoryDiagnostics(binding, input));
  diagnostics.push(...traversalDiagnostics(binding, input));
  return diagnostics;
}

function completePopulation(input) {
  const occurrenceDependent = input.occurrence_capture !== undefined ||
    input.acquisition_artifact !== undefined || input.members.some((member) =>
      member && typeof member === "object" && !Array.isArray(member) &&
      (Object.hasOwn(member, "occurrence_id") || Object.hasOwn(member, "source_occurrence_id"))
    );
  if (!occurrenceDependent) return buildCompletePopulation(input);
  if (input.occurrence_capture === undefined || input.acquisition_artifact === undefined) {
    refuse("stable_occurrence_source_unauthenticated",
      "occurrence-dependent evaluation requires the acquired complete-traversal artifact");
  }
  const capture = validateStableOccurrenceCapture(
    input.occurrence_capture, input.acquisition_artifact
  );
  const authoritative = buildStableOccurrencePopulation({
    population_id: input.population_id, capture
  });
  if (input.completeness !== "exact" || input.authenticated !== true ||
      input.ordered !== true || canonicalJsonBytes(input.members).compare(
        canonicalJsonBytes(authoritative.members)) !== 0) refuse(
    "stable_occurrence_population_substitution",
    "raw occurrence members must equal the acquired authoritative population exactly"
  );
  return authoritative;
}

function applicabilityDiagnostics(profile, contract, input) {
  const capabilities = profile.stable_capabilities;
  if (!capabilities) return [];
  const diagnostics = [];
  const semanticRequests = {
    association: (input.associations ?? []).length > 0,
    partition: (input.partitions ?? []).length > 0,
    relation_match: (input.relations ?? []).some(({ assertions }) =>
      assertions.some(({ kind }) => kind === "match")),
    inverse: (input.relations ?? []).some(({ assertions }) =>
      assertions.some(({ kind }) => kind === "inverse")),
    transitive: (input.relations ?? []).some(({ assertions }) =>
      assertions.some(({ kind }) => kind === "transitive")),
    irreflexive: (input.relations ?? []).some(({ irreflexive }) => irreflexive === true),
    adjacency: (input.relations ?? []).some(({ assertions }) =>
      assertions.some(({ kind }) => kind === "adjacency")),
    acyclic: (input.relations ?? []).some(({ assertions }) =>
      assertions.some(({ kind }) => kind === "acyclic"))
  };
  for (const mechanism of capabilities.semantic_mechanisms) {
    if (!semanticRequests[mechanism]) diagnostics.push(diagnostic(
      "stable_semantic_evidence_required", "/stable_evaluation",
      { expected_identity: mechanism }
    ));
  }
  const inputs = input.test_validity ?? [];
  const proofIds = contract.test_proofs.map(({ test_proof_id: id }) => id);
  const inputIds = inputs.map(({ test_proof_id: id }) => id);
  if (inputs.length !== contract.test_proofs.length || !unique(inputIds) ||
      proofIds.some((id) => !inputIds.includes(id)) ||
      inputIds.some((id) => !proofIds.includes(id))) diagnostics.push(diagnostic(
    "test_validity_witness_population_incomplete", "/stable_evaluation/test_validity",
    { expected_identity: proofIds, actual_identity: inputIds }
  ));
  return diagnostics;
}

function evaluateNativeStableSemantics(input) {
  if (!input) return { diagnostics: [], requestCount: 0 };
  const diagnostics = [];
  let requestCount = 0;
  const attempt = (pointer, operation) => {
    requestCount += 1;
    try {
      operation();
    } catch (error) {
      diagnostics.push(diagnostic(error.code ?? "stable_semantic_refused", pointer,
        { message: error.message }));
    }
  };
  for (const [index, request] of (input.associations ?? []).entries()) attempt(
    `/stable_evaluation/associations/${index}`, () => buildExactAssociationGraph({
      graph_id: request.graph_id,
      role_populations: Object.fromEntries(Object.entries(request.role_populations).map(
        ([role, population]) => [role, completePopulation(population)]
      )),
      associations: request.associations
    })
  );
  for (const [index, request] of (input.partitions ?? []).entries()) attempt(
    `/stable_evaluation/partitions/${index}`, () => evaluateExactPartition({
      source_population: completePopulation(request.source_population), parts: request.parts
    })
  );
  for (const [index, request] of (input.relations ?? []).entries()) {
    const pointer = `/stable_evaluation/relations/${index}`;
    attempt(pointer, () => {
      const memberPopulation = completePopulation(request.member_population);
      const relation = buildCompleteRelationPopulation({
        population_id: request.population_id, member_population: memberPopulation,
        edges: request.edges, irreflexive: request.irreflexive ?? false
      });
      for (const assertion of request.assertions) {
        if (assertion.kind === "match") {
          const matched = matchRelationPopulation({ captured: relation,
            expected_edges: assertion.expected_edges, mode: assertion.mode,
            minimum: assertion.minimum ?? null });
          if (!matched.satisfied) throw new StableVerificationError(
            "stable_relation_match_unsatisfied", "stable relation match refused"
          );
        } else if (assertion.kind === "inverse") {
          const inverse = buildCompleteRelationPopulation({
            population_id: `${request.population_id}-inverse`, member_population: memberPopulation,
            edges: assertion.inverse_edges
          });
          assertInverseRelation(relation, inverse);
        } else if (assertion.kind === "transitive") assertTransitiveRelation(relation);
        else if (assertion.kind === "adjacency") assertExactAdjacency(
          relation, assertion.ordered_occurrence_ids
        );
        else if (assertion.kind === "acyclic") assertAcyclicRelation(relation);
      }
    });
  }
  return { diagnostics, requestCount };
}

function nativeStableWorkUnits(input) {
  if (!input) return 0;
  let work = 0;
  const add = (value) => {
    work += value;
    if (!Number.isSafeInteger(work)) refuse(
      "stable_work_units_measure_invalid", "stable work must remain a safe integer"
    );
  };
  for (const request of input.associations ?? []) {
    add(request.associations.length * Object.keys(request.role_populations).length);
  }
  for (const request of input.partitions ?? []) {
    add(request.parts.length);
    for (const part of request.parts) add(part.members.length);
  }
  for (const request of input.relations ?? []) add(request.edges.length);
  for (const witness of input.test_validity ?? []) {
    add(witness.falsifier_executions?.length ?? 0);
    if (witness.test_inventory) {
      add(witness.test_inventory.declared_test_ids?.length ?? 0);
      add(witness.test_inventory.observed_tests?.length ?? 0);
    }
  }
  return work;
}

function enrichResult(result, profile, nativeEvaluation) {
  const nativeDiagnostics = nativeEvaluation.diagnostics;
  const projected = projectBoundedDiagnostics([...result.diagnostics, ...nativeDiagnostics]);
  const enriched = {
    ...result,
    satisfaction: nativeDiagnostics.length > 0 ? "unsatisfied" : result.satisfaction,
    satisfaction_trace: nativeDiagnostics.length > 0 ? null : result.satisfaction_trace,
    diagnostics: projected.diagnostics,
    total_count: projected.total_count,
    returned_count: projected.returned_count,
    omitted_count: projected.omitted_count,
    truncated: projected.truncated,
    result_version: RESULT_VERSION_V1,
    contract: { schema_version: SCHEMA_VERSION_V1 },
    vocabulary: {
      version: VOCABULARY_VERSION_V1,
      signature_digest: VOCABULARY_DIGESTS.signature,
      algebra_digest: VOCABULARY_DIGESTS.algebra,
      definitions_digest: VOCABULARY_DIGESTS.definitions,
      complete_digest: VOCABULARY_DIGESTS.complete
    },
    admission: {
      kind: "unadmitted_direct",
      profile_digest: profileDigest(profile),
      adequacy_attested: false
    },
    stable_evaluation: {
      semantic_request_count: nativeEvaluation.semanticRequestCount,
      test_validity_evaluated: nativeEvaluation.testValidityEvaluated,
      diagnostic_count: projected.total_count,
      satisfaction: nativeDiagnostics.length === 0 ? "satisfied" : "unsatisfied"
    }
  };
  if (!validateResultSchemaV1(enriched)) refuse(
    "stable_evaluator_result_invalid", "stable evaluator emitted an invalid stable result",
    { diagnostics: validateResultSchemaV1.errors ?? [] }
  );
  return deepFreezeComplete(enriched);
}

function evaluateVerificationProfileV1(payload, { graphSelectionSink = null } = {}) {
  const family = validateStableV1Family({
    contract: payload?.contract,
    profile: payload?.profile,
    input: payload?.evaluation_input
  });
  if (!family.valid) refuse(
    "stable_family_refused", "stable evaluation refuses non-stable or incomplete families",
    { stage: family.stage, diagnostics: family.diagnostics }
  );
  const inputBytes = canonicalJsonBytes(payload).byteLength;
  const workUnits = payload.contract.references.length + payload.contract.propositions.length +
    payload.contract.claims.length + payload.contract.relations.length +
    payload.contract.collections.length + payload.contract.test_proofs.length;
  const semanticWorkUnits = nativeStableWorkUnits(payload.evaluation_input.stable_evaluation);
  assertStableResourceUsage({ aggregate_source_bytes: inputBytes,
    work_units: workUnits + semanticWorkUnits });
  const semanticEvaluation = evaluateNativeStableSemantics(
    payload.evaluation_input.stable_evaluation
  );
  const testValidityInputs = payload.evaluation_input.stable_evaluation.test_validity ?? [];
  const nativeEvaluation = {
    diagnostics: [
      ...applicabilityDiagnostics(payload.profile, payload.contract,
        payload.evaluation_input.stable_evaluation),
      ...semanticEvaluation.diagnostics,
      ...testValidityInputs.flatMap((input) =>
        evaluateNativeTestValidity(payload.contract, input))
    ],
    semanticRequestCount: semanticEvaluation.requestCount,
    testValidityEvaluated: testValidityInputs.length > 0
  };
  const result = evaluateVerificationProfileWithRuntime(payload, {
    graphSelectionSink,
    resultVersion: RESULT_VERSION_V1,
    validateProfile: validateProfileSchemaV1,
    validateProfileSemanticsForRuntime: validateProfileSemanticsV1,
    validateEvaluationInput: validateEvaluationInputSchemaV1,
    validateContract: validateAndResolveNativeContractV1,
    purposeMatchedCollectionsAreCandidates: true,
    completePopulationBindingEvaluator: evaluateCompletePopulationBindingV1,
    referencesEquivalent: referencesEquivalentV1,
    normalizeReference: normalizeReferenceV1,
    allowIteratedRelations: true,
    allowIteratedCollections: true,
    allowBindingPresenceConstraints: true,
    allowExplicitEmptyReferenceBindings: true,
    globalRequiredBindingsAffectSatisfaction: true,
    validateRuntimeResult: () => true
  });
  const enriched = enrichResult(result, payload.profile, nativeEvaluation);
  assertStableResourceUsage({
    projection_result_bytes: canonicalJsonBytes(enriched).byteLength,
    work_units: workUnits
  });
  VERIFICATION_PROFILE_RESULTS.add(enriched);
  return enriched;
}

export {
  STABLE_RESOURCE_LIMITS,
  StableVerificationError,
  assertStableResourceUsage,
  assertVerificationProfileV1Result,
  evaluateVerificationProfileV1,
  profileDigest,
  validateProfileSemanticsV1
};
