import {
  StableSemanticError,
  buildEqualityNormalizationV1,
  canonicalizeStableValue,
  compareCodeUnits,
  normalizeStableSet,
  stableSemanticKey
} from "./equality-normalization-v1.mjs";
import { completeTraversalOccurrenceId } from "./stable-occurrence-identity.mjs";
import { POLICY_RESOURCE_LIMITS } from "./resource-policy.mjs";
import { assertCapturedExactBindingResult } from "./exact-binding-runtime-registry.mjs";
import {
  canonicalJsonBytes,
  sha256
} from "./deterministic-projection-primitives.mjs";
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_OCCURRENCE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const STABLE_OCCURRENCE_CAPTURE_VERSION =
  "controlled-contract.authoritative-ordered-occurrence-population.v1";
const VALIDATED_OCCURRENCE_CAPTURES = new WeakSet();
const STABLE_SEMANTIC_WORK_LIMIT = POLICY_RESOURCE_LIMITS.universal_occurrences.limit;

const canonicalPopulationValueV1 = (value) => JSON.stringify(
  canonicalizeStableValue(value)
);

function normalizePopulationApplicabilityV1(context) {
  return {
    mode: context.mode,
    operand_reference_ids: [...new Set(context.operand_reference_ids)]
      .sort(compareCodeUnits)
  };
}

function populationContextKeysV1(scope, equalityNormalization = null) {
  const normalize = equalityNormalization?.normalizeApplicability ??
    normalizePopulationApplicabilityV1;
  const exact = canonicalPopulationValueV1(normalize(scope));
  const unconditional = canonicalPopulationValueV1({
    mode: "unconditional", operand_reference_ids: []
  });
  return scope.mode === "unconditional"
    ? new Set([unconditional])
    : new Set([unconditional, exact]);
}

function mandatoryPopulationPropositionsV1(contract) {
  const propositionById = new Map(
    contract.propositions.map((proposition) => [proposition.proposition_id, proposition])
  );
  return contract.claims
    .filter(({ kind, modality }) =>
      ["behavior", "evidence"].includes(kind) && modality === "MUST"
    )
    .map((claim) => ({ claim, proposition: propositionById.get(claim.proposition_id) }))
    .filter(({ proposition }) => proposition);
}

function buildScopedEqualityV1(contract, scope) {
  const normalization = buildEqualityNormalizationV1(contract);
  return {
    canonicalize: (referenceId) => normalization.canonicalize(referenceId, scope),
    equivalent: (left, right) => normalization.equivalent(left, right, scope),
    normalizeApplicability: normalization.normalizeApplicability
  };
}

function resolveClosedPopulationV1(contract, populationReferenceId, scope) {
  const equality = buildScopedEqualityV1(contract, scope);
  const eligibleContexts = populationContextKeysV1(scope, equality);
  const populationClass = equality.canonicalize(populationReferenceId);
  const memberClasses = new Set();
  const membershipClaimIds = new Set();
  const countDeclarations = [];

  for (const { claim, proposition } of mandatoryPopulationPropositionsV1(contract)) {
    if (!eligibleContexts.has(canonicalPopulationValueV1(equality.normalizeApplicability(
      proposition.applicability_context
    )))) continue;
    const subjectClass = equality.canonicalize(proposition.subject_reference_id);
    if (proposition.operator === "number:has_cardinality" &&
        subjectClass === populationClass && proposition.operands.length === 1 &&
        proposition.operands[0].kind === "number") {
      countDeclarations.push({ claim_id: claim.claim_id, value: proposition.operands[0].value });
      continue;
    }
    if (proposition.operator === "reference:contains" && subjectClass === populationClass) {
      for (const operand of proposition.operands) {
        if (operand.kind === "reference") memberClasses.add(
          equality.canonicalize(operand.reference_id)
        );
      }
      membershipClaimIds.add(claim.claim_id);
      continue;
    }
    if (proposition.operator === "reference:member_of" &&
        proposition.operands.some(({ kind, reference_id: referenceId }) =>
          kind === "reference" && equality.canonicalize(referenceId) === populationClass
        )) {
      memberClasses.add(subjectClass);
      membershipClaimIds.add(claim.claim_id);
    }
  }

  const distinctCounts = [...new Set(countDeclarations.map(({ value }) => value))]
    .sort((left, right) => left - right);
  const diagnostics = [];
  if (countDeclarations.length === 0 && memberClasses.size === 0) diagnostics.push({
    code: "population_definition_missing",
    population_reference_id: populationClass,
    applicability_context: equality.normalizeApplicability(scope),
    claim_ids: [],
    remediation_code: "declare_complete_population_definition",
    remediation: "Declare the complete membership and exact cardinality, or explicitly declare cardinality zero if the intended population is empty."
  });
  if (countDeclarations.length === 0 && memberClasses.size > 0) diagnostics.push({
    code: "population_exact_cardinality_missing",
    population_reference_id: populationClass,
    applicability_context: equality.normalizeApplicability(scope),
    claim_ids: [...membershipClaimIds].sort(compareCodeUnits)
  });
  if (distinctCounts.length > 1) diagnostics.push({
    code: "population_exact_cardinality_ambiguous",
    population_reference_id: populationClass,
    applicability_context: equality.normalizeApplicability(scope),
    values: distinctCounts,
    claim_ids: countDeclarations.map(({ claim_id: claimId }) => claimId)
      .sort(compareCodeUnits)
  });
  const exactCardinality = distinctCounts.length === 1 ? distinctCounts[0] : null;
  if (exactCardinality !== null && (!Number.isInteger(exactCardinality) ||
      exactCardinality < 0)) diagnostics.push({
    code: "population_exact_cardinality_invalid",
    population_reference_id: populationClass,
    applicability_context: equality.normalizeApplicability(scope),
    exact_cardinality: exactCardinality,
    claim_ids: countDeclarations.map(({ claim_id: claimId }) => claimId)
      .sort(compareCodeUnits)
  });
  if (exactCardinality !== null && Number.isInteger(exactCardinality) &&
      exactCardinality >= 0 && memberClasses.size !== exactCardinality) diagnostics.push({
    code: "population_membership_incomplete",
    population_reference_id: populationClass,
    applicability_context: equality.normalizeApplicability(scope),
    exact_cardinality: exactCardinality,
    declared_distinct_member_count: memberClasses.size,
    declared_member_reference_ids: [...memberClasses].sort(compareCodeUnits),
    claim_ids: [...new Set([
      ...membershipClaimIds,
      ...countDeclarations.map(({ claim_id: claimId }) => claimId)
    ])].sort(compareCodeUnits)
  });

  return {
    population_reference_id: populationReferenceId,
    canonical_population_reference_id: populationClass,
    applicability_context: equality.normalizeApplicability(scope),
    exact_cardinality: exactCardinality,
    member_reference_ids: [...memberClasses].sort(compareCodeUnits),
    membership_claim_ids: [...membershipClaimIds].sort(compareCodeUnits),
    cardinality_claim_ids: countDeclarations.map(({ claim_id: claimId }) => claimId)
      .sort(compareCodeUnits),
    complete: diagnostics.length === 0,
    diagnostics,
    equality
  };
}

function evaluateCompletePopulationBindingV1({
  contract,
  population_reference_id: populationReferenceId,
  member_reference_ids: memberReferenceIds,
  applicability_context: applicabilityContext
}) {
  const populationReference = contract.references.find(
    ({ reference_id: referenceId }) => referenceId === populationReferenceId
  );
  const population = resolveClosedPopulationV1(
    contract, populationReferenceId, applicabilityContext
  );
  const normalizedMembers = memberReferenceIds.map(population.equality.canonicalize);
  const normalizedMemberSet = [...new Set(normalizedMembers)].sort(compareCodeUnits);
  const diagnostics = [...population.diagnostics];
  if (!populationReference || !["cc:population", "cc:scope"].includes(
    populationReference.type_term
  )) diagnostics.push({
    code: "population_binding_reference_type_invalid",
    population_reference_id: populationReferenceId,
    actual_type_term: populationReference?.type_term ?? null,
    allowed_type_terms: ["cc:population", "cc:scope"]
  });
  if (normalizedMemberSet.length !== memberReferenceIds.length) diagnostics.push({
    code: "population_binding_alias_or_duplicate_member",
    population_reference_id: populationReferenceId,
    bound_member_reference_ids: [...memberReferenceIds].sort(compareCodeUnits),
    normalized_member_reference_ids: normalizedMemberSet
  });
  const expected = new Set(population.member_reference_ids);
  const actual = new Set(normalizedMemberSet);
  const omitted = population.member_reference_ids.filter((member) => !actual.has(member));
  const unexpected = normalizedMemberSet.filter((member) => !expected.has(member));
  if (omitted.length > 0 || unexpected.length > 0) diagnostics.push({
    code: "population_binding_not_complete",
    population_reference_id: populationReferenceId,
    omitted_member_reference_ids: omitted,
    unexpected_member_reference_ids: unexpected
  });
  diagnostics.sort((left, right) => compareCodeUnits(
    canonicalPopulationValueV1(left), canonicalPopulationValueV1(right)
  ));
  return {
    satisfied: diagnostics.length === 0,
    normalized_member_reference_ids: normalizedMemberSet,
    exact_cardinality: population.exact_cardinality,
    consumed_claim_ids: [...new Set([
      ...population.membership_claim_ids,
      ...population.cardinality_claim_ids
    ])].sort(compareCodeUnits),
    diagnostics
  };
}

function evaluatePopulationRelationsV1(contract, populationRelationByOperator) {
  const propositionById = new Map(
    contract.propositions.map((proposition) => [proposition.proposition_id, proposition])
  );
  const diagnostics = [];
  const closureDiagnostics = new Map();
  for (const claim of contract.claims.filter(({ kind, modality }) =>
    ["behavior", "evidence"].includes(kind) && ["MUST", "MUST_NOT"].includes(modality)
  )) {
    const proposition = propositionById.get(claim.proposition_id);
    const semantics = proposition && populationRelationByOperator[proposition.operator];
    if (!semantics) continue;
    const source = resolveClosedPopulationV1(
      contract, proposition.subject_reference_id, proposition.applicability_context
    );
    const sourceKey = canonicalPopulationValueV1([
      source.canonical_population_reference_id, source.applicability_context
    ]);
    if (!closureDiagnostics.has(sourceKey)) closureDiagnostics.set(
      sourceKey, source.diagnostics
    );
    for (const operand of proposition.operands) {
      if (operand.kind !== "reference") continue;
      const target = resolveClosedPopulationV1(
        contract, operand.reference_id, proposition.applicability_context
      );
      const targetKey = canonicalPopulationValueV1([
        target.canonical_population_reference_id, target.applicability_context
      ]);
      if (!closureDiagnostics.has(targetKey)) closureDiagnostics.set(
        targetKey, target.diagnostics
      );
      if (!source.complete || !target.complete) continue;
      const targetMembers = new Set(target.member_reference_ids);
      const witnesses = source.member_reference_ids.filter((member) =>
        !targetMembers.has(member)
      );
      const subset = witnesses.length === 0;
      const propositionTruth = semantics.relation === "subset" ? subset : !subset;
      const requiredTruth = claim.modality === "MUST";
      if (propositionTruth !== requiredTruth) diagnostics.push({
        code: "population_relation_false",
        claim_id: claim.claim_id,
        proposition_id: proposition.proposition_id,
        operator: proposition.operator,
        modality: claim.modality,
        subject_population_reference_id: proposition.subject_reference_id,
        operand_population_reference_id: operand.reference_id,
        witness_member_reference_ids: witnesses
      });
    }
  }
  for (const entries of closureDiagnostics.values()) diagnostics.push(...entries);
  return diagnostics.sort((left, right) => compareCodeUnits(
    canonicalPopulationValueV1(left), canonicalPopulationValueV1(right)
  ));
}

function stablePopulationError(code, message, details = {}) {
  throw new StableSemanticError(code, message, details);
}

function requireCompleteAuthority(value) {
  if (value?.completeness !== "exact" || value?.authenticated !== true) {
    stablePopulationError(
      "stable_population_authority_required",
      "iteration requires one authenticated mechanically complete population"
    );
  }
}

function assertStableSemanticWork(workUnits, code = "stable_population_work_limit_exceeded") {
  if (!Number.isSafeInteger(workUnits) || workUnits < 0) stablePopulationError(
    "stable_population_work_measure_invalid",
    "stable semantic work must be a nonnegative safe integer"
  );
  if (workUnits > STABLE_SEMANTIC_WORK_LIMIT) stablePopulationError(
    code,
    "stable semantic work exceeds the package-owned monotone work limit",
    { observed: workUnits, limit: STABLE_SEMANTIC_WORK_LIMIT }
  );
  return true;
}

function buildCompletePopulation({
  population_id: populationId,
  completeness,
  authenticated,
  members,
  ordered = false,
  identity
}) {
  requireCompleteAuthority({ completeness, authenticated });
  if (typeof populationId !== "string" || populationId.length === 0) stablePopulationError(
    "stable_population_identity_invalid", "complete populations require a stable identity"
  );
  if (!Array.isArray(members)) stablePopulationError(
    "stable_population_invalid", "complete population members must be an array"
  );
  assertStableSemanticWork(members.length);
  const selected = normalizeStableSet(members, { identity, duplicate: "refuse" });
  const canonicalMembers = ordered
    ? members.map(canonicalizeStableValue)
    : [...selected];
  if (ordered && selected.length !== members.length) stablePopulationError(
    "stable_population_member_duplicate",
    "ordered complete populations cannot repeat an equality-normalized identity"
  );
  return Object.freeze({
    population_version: "controlled-contract.complete-population.v1",
    population_id: populationId,
    completeness: "exact",
    authenticated: true,
    ordered,
    cardinality: canonicalMembers.length,
    members: Object.freeze(canonicalMembers.map((member) => Object.freeze(member)))
  });
}

function validateStableOccurrenceCapture(capture, acquisitionArtifact) {
  if (!capture || typeof capture !== "object" || Array.isArray(capture) ||
      JSON.stringify(Object.keys(capture).sort(compareCodeUnits)) !== JSON.stringify([
        "occurrences", "schema_version", "source_grounded_identity_sha256"
      ]) || capture.schema_version !== STABLE_OCCURRENCE_CAPTURE_VERSION ||
      !SHA256.test(capture.source_grounded_identity_sha256 ?? "") ||
      !Array.isArray(capture.occurrences)) stablePopulationError(
    "stable_occurrence_source_unauthenticated",
    "stable occurrence construction requires one closed package-validated source capture"
  );
  assertStableSemanticWork(capture.occurrences.length,
    "stable_occurrence_work_limit_exceeded");
  try {
    assertCapturedExactBindingResult(acquisitionArtifact);
  } catch {
    stablePopulationError(
      "stable_occurrence_source_unauthenticated",
      "stable occurrence authority requires the acquired in-process exact-binding artifact"
    );
  }
  const populationBytes = canonicalJsonBytes(capture, { file: true });
  const populationDigest = sha256(populationBytes);
  const populationBindings = acquisitionArtifact.bindings.filter((binding) =>
    binding.content_sha256 === populationDigest &&
    binding.byte_length === populationBytes.byteLength &&
    binding.role_coverage.some(({ role, projection }) =>
      role === "authoritative_population" && projection === "artifact_subject")
  );
  const traversalRelations = acquisitionArtifact.relation_results.filter((relation) =>
    relation.operator === "deterministic_projection" &&
    relation.transformer_id === "mutation-pagination-trace.v1" &&
    relation.status === "satisfied" && populationBindings.some(({ requirement_id: id }) =>
      relation.source_requirement_ids.includes(id))
  );
  if (acquisitionArtifact.satisfaction !== "satisfied" ||
      acquisitionArtifact.provenance?.capture_verified !== true ||
      populationBindings.length !== 1 || traversalRelations.length !== 1) stablePopulationError(
    "stable_occurrence_source_unauthenticated",
    "the acquired artifact must prove this exact authoritative population through complete traversal"
  );
  const seenSourceIds = new Set();
  const normalized = capture.occurrences.map((occurrence, index) => {
    if (!occurrence || typeof occurrence !== "object" || Array.isArray(occurrence) ||
        JSON.stringify(Object.keys(occurrence).sort(compareCodeUnits)) !== JSON.stringify([
          "content_sha256", "equality_key", "source_occurrence_id"
        ])) stablePopulationError(
      "stable_occurrence_population_invalid",
      "captured occurrences have one closed authoritative shape", { index }
    );
    const sourceId = occurrence?.source_occurrence_id;
    if (typeof sourceId !== "string" || !SOURCE_OCCURRENCE_ID.test(sourceId) ||
        sourceId !== sourceId.normalize("NFC") ||
        typeof occurrence.equality_key !== "string" ||
        !SOURCE_OCCURRENCE_ID.test(occurrence.equality_key) ||
        occurrence.equality_key !== occurrence.equality_key.normalize("NFC") ||
        !SHA256.test(occurrence.content_sha256 ?? "")) stablePopulationError(
      "stable_occurrence_identity_invalid", "source occurrence identity is required", { index }
    );
    if (seenSourceIds.has(sourceId)) stablePopulationError(
      "stable_occurrence_identity_duplicate",
      "a source occurrence identity may occur only once before content comparison",
      { index, source_occurrence_id: sourceId }
    );
    seenSourceIds.add(sourceId);
    return canonicalizeStableValue(occurrence);
  });
  const validated = Object.freeze({
    schema_version: STABLE_OCCURRENCE_CAPTURE_VERSION,
    source_grounded_identity_sha256: capture.source_grounded_identity_sha256,
    occurrences: Object.freeze(normalized.map(Object.freeze))
  });
  VALIDATED_OCCURRENCE_CAPTURES.add(validated);
  return validated;
}

function buildStableOccurrencePopulation({ population_id: populationId, capture }) {
  if (!VALIDATED_OCCURRENCE_CAPTURES.has(capture)) stablePopulationError(
    "stable_occurrence_source_unauthenticated",
    "caller assertions are not stable occurrence authentication authority"
  );
  const sourceDigest = capture.source_grounded_identity_sha256;
  const normalized = capture.occurrences.map((occurrence) => ({
    ...occurrence,
    occurrence_id: completeTraversalOccurrenceId(
      sourceDigest, occurrence.source_occurrence_id
    )
  }));
  return buildCompletePopulation({
    population_id: populationId,
    completeness: "exact",
    authenticated: true,
    members: normalized,
    ordered: true,
    identity: ({ occurrence_id: occurrenceId }) => occurrenceId
  });
}

function populationIdentityIndex(population, identity = (value) => value.occurrence_id ?? value) {
  requireCompleteAuthority(population);
  const index = new Map();
  for (const member of population.members) {
    const key = stableSemanticKey(identity(member));
    if (index.has(key)) stablePopulationError(
      "stable_population_member_duplicate", "complete population identities must be unique"
    );
    index.set(key, member);
  }
  return index;
}

function compareCompletePopulations(left, right, identity) {
  const leftKeys = [...populationIdentityIndex(left, identity).keys()].sort(compareCodeUnits);
  const rightKeys = [...populationIdentityIndex(right, identity).keys()].sort(compareCodeUnits);
  return Object.freeze({
    exact: JSON.stringify(leftKeys) === JSON.stringify(rightKeys),
    left_subset_of_right: leftKeys.every((key) => rightKeys.includes(key)),
    right_subset_of_left: rightKeys.every((key) => leftKeys.includes(key)),
    left_cardinality: leftKeys.length,
    right_cardinality: rightKeys.length
  });
}

function referencesEquivalentV1(contract, left, right, applicabilityContext) {
  return buildScopedEqualityV1(contract, applicabilityContext).equivalent(left, right);
}

function normalizeReferenceV1(contract, referenceId, applicabilityContext) {
  return buildScopedEqualityV1(contract, applicabilityContext).canonicalize(referenceId);
}

export {
  STABLE_OCCURRENCE_CAPTURE_VERSION,
  STABLE_SEMANTIC_WORK_LIMIT,
  assertStableSemanticWork,
  buildCompletePopulation,
  buildStableOccurrencePopulation,
  compareCompletePopulations,
  evaluateCompletePopulationBindingV1,
  evaluatePopulationRelationsV1,
  normalizeReferenceV1,
  populationIdentityIndex,
  referencesEquivalentV1,
  resolveClosedPopulationV1,
  requireCompleteAuthority,
  validateStableOccurrenceCapture
};
