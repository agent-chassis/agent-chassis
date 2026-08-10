const compareCodeUnits = (left, right) => {
  const leftString = String(left);
  const rightString = String(right);
  return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
};

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
};

const canonical = (value) => JSON.stringify(canonicalValue(value));

function normalizeApplicability(context) {
  return {
    mode: context.mode,
    operand_reference_ids: [...new Set(context.operand_reference_ids)].sort(compareCodeUnits)
  };
}

function contextKeysFor(scope) {
  const exact = canonical(normalizeApplicability(scope));
  const unconditional = canonical({ mode: "unconditional", operand_reference_ids: [] });
  return scope.mode === "unconditional" ? new Set([unconditional]) :
    new Set([unconditional, exact]);
}

function mandatoryPropositions(contract) {
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

function buildScopedEquality(contract, scope) {
  const eligibleContexts = contextKeysFor(scope);
  const parent = new Map();
  const find = (value) => {
    if (!parent.has(value)) parent.set(value, value);
    const current = parent.get(value);
    if (current !== value) parent.set(value, find(current));
    return parent.get(value);
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const [canonicalRoot, otherRoot] = [leftRoot, rightRoot].sort(compareCodeUnits);
    parent.set(otherRoot, canonicalRoot);
  };
  for (const { proposition } of mandatoryPropositions(contract)) {
    if (proposition.operator !== "reference:equals" ||
        !eligibleContexts.has(canonical(normalizeApplicability(
          proposition.applicability_context
        )))) continue;
    for (const operand of proposition.operands) {
      if (operand.kind === "reference") union(
        proposition.subject_reference_id,
        operand.reference_id
      );
    }
  }
  return { canonicalize: find, equivalent: (left, right) => find(left) === find(right) };
}

function resolveClosedPopulation(contract, populationReferenceId, scope) {
  const eligibleContexts = contextKeysFor(scope);
  const equality = buildScopedEquality(contract, scope);
  const populationClass = equality.canonicalize(populationReferenceId);
  const memberClasses = new Set();
  const membershipClaimIds = new Set();
  const countDeclarations = [];

  for (const { claim, proposition } of mandatoryPropositions(contract)) {
    if (!eligibleContexts.has(canonical(normalizeApplicability(
      proposition.applicability_context
    )))) continue;
    const subjectClass = equality.canonicalize(proposition.subject_reference_id);
    if (proposition.operator === "number:has_cardinality" &&
        subjectClass === populationClass && proposition.operands.length === 1 &&
        proposition.operands[0].kind === "number") {
      countDeclarations.push({
        claim_id: claim.claim_id,
        value: proposition.operands[0].value
      });
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
    applicability_context: normalizeApplicability(scope),
    claim_ids: [],
    remediation_code: "declare_complete_population_definition",
    remediation: "Declare the complete membership and exact cardinality, or explicitly declare cardinality zero if the intended population is empty."
  });
  if (countDeclarations.length === 0 && memberClasses.size > 0) diagnostics.push({
    code: "population_exact_cardinality_missing",
    population_reference_id: populationClass,
    applicability_context: normalizeApplicability(scope),
    claim_ids: [...membershipClaimIds].sort(compareCodeUnits)
  });
  if (distinctCounts.length > 1) diagnostics.push({
    code: "population_exact_cardinality_ambiguous",
    population_reference_id: populationClass,
    applicability_context: normalizeApplicability(scope),
    values: distinctCounts,
    claim_ids: countDeclarations.map(({ claim_id: claimId }) => claimId)
      .sort(compareCodeUnits)
  });
  const exactCardinality = distinctCounts.length === 1 ? distinctCounts[0] : null;
  if (exactCardinality !== null && (!Number.isInteger(exactCardinality) ||
      exactCardinality < 0)) diagnostics.push({
    code: "population_exact_cardinality_invalid",
    population_reference_id: populationClass,
    applicability_context: normalizeApplicability(scope),
    exact_cardinality: exactCardinality,
    claim_ids: countDeclarations.map(({ claim_id: claimId }) => claimId)
      .sort(compareCodeUnits)
  });
  if (exactCardinality !== null && Number.isInteger(exactCardinality) &&
      exactCardinality >= 0 && memberClasses.size !== exactCardinality) diagnostics.push({
    code: "population_membership_incomplete",
    population_reference_id: populationClass,
    applicability_context: normalizeApplicability(scope),
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
    applicability_context: normalizeApplicability(scope),
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

function evaluateCompletePopulationBinding({
  contract,
  population_reference_id: populationReferenceId,
  member_reference_ids: memberReferenceIds,
  applicability_context: applicabilityContext
}) {
  const populationReference = contract.references.find(
    ({ reference_id: referenceId }) => referenceId === populationReferenceId
  );
  const population = resolveClosedPopulation(
    contract,
    populationReferenceId,
    applicabilityContext
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
  diagnostics.sort((left, right) => compareCodeUnits(canonical(left), canonical(right)));
  return {
    satisfied: diagnostics.length === 0,
    normalized_member_reference_ids: normalizedMemberSet,
    exact_cardinality: population.exact_cardinality,
    diagnostics
  };
}

function evaluatePopulationRelations(contract, populationRelationByOperator) {
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
    const source = resolveClosedPopulation(
      contract,
      proposition.subject_reference_id,
      proposition.applicability_context
    );
    const sourceKey = canonical([
      source.canonical_population_reference_id,
      source.applicability_context
    ]);
    if (!closureDiagnostics.has(sourceKey)) closureDiagnostics.set(
      sourceKey,
      source.diagnostics
    );
    for (const operand of proposition.operands) {
      if (operand.kind !== "reference") continue;
      const target = resolveClosedPopulation(
        contract,
        operand.reference_id,
        proposition.applicability_context
      );
      const targetKey = canonical([
        target.canonical_population_reference_id,
        target.applicability_context
      ]);
      if (!closureDiagnostics.has(targetKey)) closureDiagnostics.set(
        targetKey,
        target.diagnostics
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
  return diagnostics.sort((left, right) => compareCodeUnits(canonical(left), canonical(right)));
}

function referencesEquivalent(contract, left, right, applicabilityContext) {
  return buildScopedEquality(contract, applicabilityContext).equivalent(left, right);
}

export {
  buildScopedEquality,
  evaluateCompletePopulationBinding,
  evaluatePopulationRelations,
  normalizeApplicability,
  referencesEquivalent,
  resolveClosedPopulation
};
