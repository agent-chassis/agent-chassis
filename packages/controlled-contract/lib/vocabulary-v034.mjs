import {
  APPLICABILITY_MODES,
  CONTROLLED_VOCABULARY,
  OPERATORS,
  TYPE_TERMS,
  VALUE_KINDS,
  VOCABULARY_DIGESTS,
  VOCABULARY_VERSION,
  vocabularyDigests
} from "../vocabulary/cv.experimental.0.34.mjs";

const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const allowedMultiplicities = new Set([
  "complete_order",
  "conjunctive_constraint",
  "equivalence_relation",
  "relation_set",
  "single_value_per_subject_scope"
]);
const allowedOperandTransforms = new Set(["boolean_negation"]);
const allowedSupportStates = new Set(["declared_only", "enforced", "not_applicable"]);

function validCardinality(cardinality, { permitUnbounded = true } = {}) {
  return cardinality !== null && typeof cardinality === "object" &&
    Number.isInteger(cardinality.minimum) && cardinality.minimum >= 0 &&
    ((permitUnbounded && cardinality.maximum === null) ||
      (Number.isInteger(cardinality.maximum) && cardinality.maximum >= cardinality.minimum));
}

function validateVocabulary(vocabulary = CONTROLLED_VOCABULARY) {
  const diagnostics = [];
  const termGroups = [
    ["value_kind", vocabulary.value_kinds],
    ["type_term", vocabulary.type_terms],
    ["applicability_mode", vocabulary.applicability_modes],
    ["operator", vocabulary.operators]
  ];

  for (const [kind, entries] of termGroups) {
    const seen = new Set();
    for (const entry of entries) {
      if (seen.has(entry.term)) diagnostics.push({
        code: "duplicate_vocabulary_term",
        kind,
        term: entry.term
      });
      seen.add(entry.term);
      if (typeof entry.definition !== "string" || entry.definition.trim() === "") diagnostics.push({
        code: "vocabulary_definition_missing",
        kind,
        term: entry.term
      });
    }
  }

  const typeTerms = new Set(vocabulary.type_terms.map(({ term }) => term));
  const applicabilityTerms = new Set(vocabulary.applicability_modes.map(({ term }) => term));
  const operatorByTerm = new Map(vocabulary.operators.map((entry) => [entry.term, entry]));

  for (const entry of vocabulary.applicability_modes) {
    const cardinality = entry.context_reference_cardinality;
    if (!validCardinality(cardinality)) {
      diagnostics.push({
        code: "applicability_cardinality_invalid",
        term: entry.term
      });
    }
    const semantics = entry.context_reference_semantics;
    if (!semantics || semantics.combination !== "all" ||
        semantics.ordering !== "insignificant" || semantics.duplicates !== "ignored" ||
        semantics.matching !== "exact_normalized_reference_set" ||
        entry.controlled_entailments?.kind !== "none") {
      diagnostics.push({
        code: "applicability_context_semantics_incomplete",
        term: entry.term
      });
    }
  }

  for (const entry of vocabulary.operators) {
    const valueKind = entry.term.slice(0, entry.term.indexOf(":"));
    if (!vocabulary.value_kinds.some(({ term }) => term === valueKind) ||
        entry.signature?.operand_kind !== valueKind) {
      diagnostics.push({
        code: "operator_value_kind_mismatch",
        term: entry.term,
        prefix_value_kind: valueKind,
        signature_value_kind: entry.signature?.operand_kind ?? null
      });
    }
    if (!entry.signature?.subject_types || !entry.signature?.operand_cardinality ||
        (valueKind === "reference" && !entry.signature?.operand_types)) {
      diagnostics.push({ code: "operator_signature_incomplete", term: entry.term });
    }
    const numericDomain = entry.signature?.operand_numeric_domain;
    if (valueKind === "number" && (!numericDomain ||
        !["integer_range", "unrestricted"].includes(numericDomain.kind) ||
        (numericDomain.kind === "integer_range" &&
          (!Number.isInteger(numericDomain.minimum) || numericDomain.minimum < 0 ||
            (numericDomain.maximum !== null &&
              (!Number.isInteger(numericDomain.maximum) ||
                numericDomain.maximum < numericDomain.minimum)))))) {
      diagnostics.push({ code: "operator_numeric_domain_invalid", term: entry.term });
    }
    if (!validCardinality(entry.signature?.operand_cardinality) ||
        entry.signature?.operand_cardinality?.minimum < 1) diagnostics.push({
      code: "operator_operand_cardinality_invalid",
      term: entry.term
    });
    if (!entry.operand_semantics ||
        !["significant", "insignificant"].includes(entry.operand_semantics.ordering) ||
        !["forbidden", "ignored", "significant"].includes(entry.operand_semantics.duplicates)) {
      diagnostics.push({ code: "operator_operand_semantics_incomplete", term: entry.term });
    }
    if (!allowedMultiplicities.has(entry.multiplicity)) diagnostics.push({
      code: "operator_multiplicity_undeclared",
      term: entry.term
    });
    const operandCardinality = entry.signature?.operand_cardinality;
    if (entry.multiplicity === "single_value_per_subject_scope" &&
        operandCardinality?.maximum !== 1) diagnostics.push({
      code: "single_value_operator_cardinality_invalid",
      term: entry.term,
      maximum: operandCardinality?.maximum ?? null
    });
    if (entry.multiplicity === "equivalence_relation" &&
        (entry.algebraic_traits?.symmetric !== true ||
          entry.algebraic_traits?.transitive !== true ||
          entry.algebraic_traits?.irreflexive !== false)) diagnostics.push({
      code: "equivalence_relation_traits_invalid",
      term: entry.term
    });
    if (entry.multiplicity === "complete_order" &&
        (entry.operand_semantics?.ordering !== "significant" ||
          entry.operand_semantics?.duplicates !== "significant")) diagnostics.push({
      code: "complete_order_operand_semantics_invalid",
      term: entry.term
    });
    if (!entry.controlled_complement || !["none", "operator", "operand_transform"].includes(
      entry.controlled_complement.kind
    )) diagnostics.push({ code: "operator_complement_undeclared", term: entry.term });
    if (entry.controlled_complement?.kind === "operand_transform" &&
        !allowedOperandTransforms.has(entry.controlled_complement.transform)) diagnostics.push({
      code: "operator_complement_transform_unknown",
      term: entry.term,
      transform: entry.controlled_complement.transform ?? null
    });
    if (!entry.inverse || !["none", "operator"].includes(entry.inverse.kind)) diagnostics.push({
      code: "operator_inverse_undeclared",
      term: entry.term
    });
    if (entry.controlled_entailments?.kind !== "none") diagnostics.push({
      code: "operator_entailments_undeclared",
      term: entry.term
    });
    if (!entry.algebraic_traits ||
        ["symmetric", "transitive", "irreflexive"].some(
          (trait) => typeof entry.algebraic_traits[trait] !== "boolean"
        )) diagnostics.push({ code: "operator_algebraic_traits_incomplete", term: entry.term });
    const support = entry.mechanical_support;
    if (!support || [
      "operand_semantics", "multiplicity", "controlled_complement", "inverse",
      "controlled_entailments", "population_semantics", "applicability"
    ].some((field) => !allowedSupportStates.has(support[field])) ||
        !support.algebraic_traits || ["symmetric", "transitive", "irreflexive"].some(
          (trait) => !allowedSupportStates.has(support.algebraic_traits[trait])
        )) diagnostics.push({ code: "operator_mechanical_support_incomplete", term: entry.term });
    for (const trait of ["symmetric", "transitive", "irreflexive"]) {
      const declared = entry.algebraic_traits?.[trait] === true;
      const state = support?.algebraic_traits?.[trait];
      if (declared && state === "not_applicable" || !declared && state !== "not_applicable") {
        diagnostics.push({
          code: "operator_trait_support_mismatch",
          term: entry.term,
          trait,
          declared,
          mechanical_support: state ?? null
        });
      }
    }
    if (!entry.applicability || !["all_declared_modes", "restricted_modes"].includes(
      entry.applicability.kind
    )) diagnostics.push({ code: "operator_applicability_undeclared", term: entry.term });
    if (entry.applicability?.kind === "restricted_modes") {
      const modes = entry.applicability.modes;
      if (!Array.isArray(modes) || modes.length === 0 || new Set(modes).size !== modes.length ||
          modes.some((mode) => !applicabilityTerms.has(mode))) diagnostics.push({
        code: "operator_applicability_modes_invalid",
        term: entry.term
      });
      const contextCardinality = entry.applicability.context_reference_cardinality;
      const contextTypes = entry.applicability.context_reference_types;
      if (contextCardinality !== undefined && !validCardinality(contextCardinality, {
        permitUnbounded: true
      })) diagnostics.push({
        code: "operator_applicability_cardinality_invalid",
        term: entry.term
      });
      if (contextTypes !== undefined &&
          (contextTypes.kind !== "restricted" || !Array.isArray(contextTypes.terms) ||
            contextTypes.terms.some((term) => !typeTerms.has(term)))) diagnostics.push({
        code: "operator_applicability_context_types_invalid",
        term: entry.term
      });
    }

    const populationSemantics = entry.population_semantics;
    if (!populationSemantics || !["not_applicable", "closed_extensional_relation"].includes(
      populationSemantics.kind
    )) diagnostics.push({ code: "operator_population_semantics_incomplete", term: entry.term });
    if (populationSemantics?.kind === "not_applicable" &&
        support?.population_semantics !== "not_applicable") diagnostics.push({
      code: "operator_population_support_mismatch",
      term: entry.term
    });
    if (populationSemantics?.kind === "closed_extensional_relation") {
      const validPopulationSemantics =
        ["subset", "not_subset"].includes(populationSemantics.relation) &&
        JSON.stringify(populationSemantics.membership_operators) ===
          JSON.stringify(["reference:contains", "reference:member_of"]) &&
        populationSemantics.exact_cardinality_operator === "number:has_cardinality" &&
        populationSemantics.equality_operator === "reference:equals" &&
        populationSemantics.membership_identity === "mandatory_equality_class" &&
        populationSemantics.closure ===
          "exact_cardinality_equals_distinct_declared_members" &&
        populationSemantics.scope_matching === "exact_scope_plus_unconditional_facts" &&
        populationSemantics.empty_population === "allowed" &&
        support?.population_semantics === "enforced";
      if (!validPopulationSemantics) diagnostics.push({
        code: "operator_population_semantics_invalid",
        term: entry.term
      });
    }

    if (entry.signature?.subject_types?.kind === "restricted") {
      for (const term of entry.signature.subject_types.terms ?? []) {
        if (!typeTerms.has(term)) diagnostics.push({
          code: "operator_subject_type_unknown",
          operator_term: entry.term,
          type_term: term
        });
      }
    }
    if (entry.signature?.operand_types?.kind === "restricted") {
      for (const term of entry.signature.operand_types.terms ?? []) {
        if (!typeTerms.has(term)) diagnostics.push({
          code: "operator_operand_type_unknown",
          operator_term: entry.term,
          type_term: term
        });
      }
    }
    if (entry.controlled_complement?.kind === "operator") {
      const complement = operatorByTerm.get(entry.controlled_complement.term);
      if (!complement) diagnostics.push({
        code: "operator_complement_unknown",
        term: entry.term,
        complement_term: entry.controlled_complement.term
      });
      else if (complement.controlled_complement?.kind !== "operator" ||
          complement.controlled_complement.term !== entry.term) diagnostics.push({
        code: "operator_complement_asymmetric",
        term: entry.term,
        complement_term: entry.controlled_complement.term
      });
      else if (entry.signature?.operand_kind !== complement.signature?.operand_kind ||
          JSON.stringify(entry.signature?.subject_types) !==
            JSON.stringify(complement.signature?.subject_types) ||
          JSON.stringify(entry.signature?.operand_types) !==
            JSON.stringify(complement.signature?.operand_types) ||
          JSON.stringify(entry.signature?.operand_cardinality) !==
            JSON.stringify(complement.signature?.operand_cardinality) ||
          JSON.stringify(entry.operand_semantics) !==
            JSON.stringify(complement.operand_semantics) ||
          JSON.stringify(entry.applicability) !== JSON.stringify(complement.applicability)) {
        diagnostics.push({
        code: "operator_complement_signature_mismatch",
        term: entry.term,
        complement_term: entry.controlled_complement.term
        });
      }
    }
    if (entry.inverse?.kind === "operator") {
      const inverse = operatorByTerm.get(entry.inverse.term);
      if (!inverse) diagnostics.push({
        code: "operator_inverse_unknown",
        term: entry.term,
        inverse_term: entry.inverse.term
      });
      else if (inverse.inverse?.kind !== "operator" || inverse.inverse.term !== entry.term) {
        diagnostics.push({
          code: "operator_inverse_asymmetric",
          term: entry.term,
          inverse_term: entry.inverse.term
        });
      }
    }
  }

  for (const withheld of vocabulary.withheld_applicability_terms ?? []) {
    if (applicabilityTerms.has(withheld.term)) diagnostics.push({
      code: "withheld_applicability_term_is_active",
      term: withheld.term
    });
    if (typeof withheld.reason !== "string" || withheld.reason.trim() === "") diagnostics.push({
      code: "withheld_applicability_reason_missing",
      term: withheld.term
    });
  }

  const crossConstraints = vocabulary.cross_operator_constraints;
  if (!crossConstraints || !["declared", "unsupported"].includes(crossConstraints.kind)) {
    diagnostics.push({ code: "cross_operator_constraints_undeclared" });
  } else if (crossConstraints.kind === "declared") {
    if (crossConstraints.mechanical_support !== "enforced" ||
        !Array.isArray(crossConstraints.constraints) ||
        crossConstraints.constraints.length === 0) diagnostics.push({
      code: "cross_operator_constraints_incomplete"
    });
    const constraintIds = new Set();
    for (const constraint of crossConstraints.constraints ?? []) {
      if (constraintIds.has(constraint.constraint_id)) diagnostics.push({
        code: "duplicate_cross_operator_constraint",
        constraint_id: constraint.constraint_id
      });
      constraintIds.add(constraint.constraint_id);
      const exactWithinRange = constraint.kind === "exact_number_within_range" &&
        Array.isArray(constraint.exact_operators) &&
        Array.isArray(constraint.range_operators) &&
        constraint.exact_operators.length > 0 && constraint.range_operators.length > 0 &&
        [...constraint.exact_operators, ...constraint.range_operators].every(
          (term) => operatorByTerm.has(term)
        );
      const exactNotBelowMembership =
        constraint.kind === "exact_number_not_below_declared_membership" &&
        Array.isArray(constraint.exact_operators) &&
        Array.isArray(constraint.contains_operators) &&
        Array.isArray(constraint.member_of_operators) &&
        constraint.exact_operators.length > 0 &&
        constraint.contains_operators.length > 0 &&
        constraint.member_of_operators.length > 0 &&
        constraint.scope_matching === "same_or_exact_unconditional" &&
        [
          ...constraint.exact_operators,
          ...constraint.contains_operators,
          ...constraint.member_of_operators
        ].every((term) => operatorByTerm.has(term));
      const referenceEquivalenceSubstitution =
        constraint.kind === "reference_equivalence_substitution" &&
        Array.isArray(constraint.equivalence_operators) &&
        constraint.equivalence_operators.length > 0 &&
        constraint.equivalence_operators.every((term) =>
          operatorByTerm.get(term)?.multiplicity === "equivalence_relation"
        );
      if (!exactWithinRange && !exactNotBelowMembership &&
          !referenceEquivalenceSubstitution) diagnostics.push({
        code: "cross_operator_constraint_invalid",
        constraint_id: constraint.constraint_id ?? null
      });
    }
  } else if (typeof crossConstraints.reason !== "string" ||
      crossConstraints.reason.trim() === "") diagnostics.push({
    code: "cross_operator_constraints_unsupported_without_reason"
  });

  return {
    vocabulary_version: vocabulary.vocabulary_version,
    valid: diagnostics.length === 0,
    diagnostics: diagnostics.sort((left, right) =>
      compareCodeUnits(JSON.stringify(left), JSON.stringify(right))
    )
  };
}

function deriveVocabularyIndexes(vocabulary = CONTROLLED_VOCABULARY) {
  const digests = vocabularyDigests(vocabulary);
  const operatorsByValueKind = Object.fromEntries(vocabulary.value_kinds.map(({ term: valueKind }) => [
    valueKind,
    vocabulary.operators
      .map(({ term }) => term)
      .filter((term) => term.startsWith(`${valueKind}:`))
      .sort(compareCodeUnits)
  ]));
  return {
    vocabulary_version: vocabulary.vocabulary_version,
    vocabulary_digests: { ...digests },
    type_terms: vocabulary.type_terms.map(({ term }) => term).sort(compareCodeUnits),
    applicability_modes: vocabulary.applicability_modes.map(({ term }) => term).sort(compareCodeUnits),
    operators_by_value_kind: operatorsByValueKind,
    complement_by_operator: Object.fromEntries(vocabulary.operators.map((entry) => [
      entry.term,
      structuredClone(entry.controlled_complement)
    ])),
    inverse_by_operator: Object.fromEntries(vocabulary.operators
      .filter(({ inverse, mechanical_support: support }) =>
        inverse.kind === "operator" && support.inverse === "enforced"
      )
      .map((entry) => [entry.term, structuredClone(entry.inverse)])),
    multiplicity_by_operator: Object.fromEntries(vocabulary.operators.map((entry) => [
      entry.term,
      entry.multiplicity
    ])),
    operand_semantics_by_operator: Object.fromEntries(vocabulary.operators.map((entry) => [
      entry.term,
      structuredClone(entry.operand_semantics)
    ])),
    applicability_by_operator: Object.fromEntries(vocabulary.operators.map((entry) => [
      entry.term,
      structuredClone(entry.applicability)
    ])),
    population_relation_by_operator: Object.fromEntries(vocabulary.operators
      .filter(({ population_semantics: semantics }) =>
        semantics?.kind === "closed_extensional_relation"
      )
      .map(({ term, population_semantics: semantics }) => [
        term,
        structuredClone(semantics)
      ])),
    symmetric_operators: vocabulary.operators
      .filter(({ algebraic_traits: traits, mechanical_support: support }) =>
        traits.symmetric && support.algebraic_traits.symmetric === "enforced"
      )
      .map(({ term }) => term)
      .sort(compareCodeUnits),
    transitive_operators: vocabulary.operators
      .filter(({ algebraic_traits: traits, mechanical_support: support }) =>
        traits.transitive && support.algebraic_traits.transitive === "enforced"
      )
      .map(({ term }) => term)
      .sort(compareCodeUnits),
    cross_operator_constraints: structuredClone(vocabulary.cross_operator_constraints),
    functional_operators: vocabulary.operators
      .filter(({ multiplicity }) => [
        "single_value_per_subject_scope", "complete_order"
      ].includes(multiplicity))
      .map(({ term }) => term)
      .sort(compareCodeUnits)
  };
}

function deriveVocabularySchemaProjection(vocabulary = CONTROLLED_VOCABULARY) {
  const digests = vocabularyDigests(vocabulary);
  const groupedBranches = new Map();
  for (const operator of vocabulary.operators) {
    const {
      operand_kind: operandKind,
      operand_cardinality: cardinality,
      operand_numeric_domain: numericDomain = null
    } = operator.signature;
    const applicabilityModes = operator.applicability.kind === "all_declared_modes"
      ? vocabulary.applicability_modes.map(({ term }) => term).sort(compareCodeUnits)
      : [...operator.applicability.modes].sort(compareCodeUnits);
    const key = JSON.stringify({
      operandKind, cardinality, numericDomain, applicabilityModes
    });
    if (!groupedBranches.has(key)) groupedBranches.set(key, {
      operand_kind: operandKind,
      operand_cardinality: structuredClone(cardinality),
      operand_numeric_domain: structuredClone(numericDomain),
      applicability_modes: applicabilityModes,
      operator_terms: []
    });
    groupedBranches.get(key).operator_terms.push(operator.term);
  }
  const propositionBranches = [...groupedBranches.values()]
    .map((branch) => ({
      ...branch,
      operator_terms: branch.operator_terms.sort(compareCodeUnits)
    }))
    .sort((left, right) => compareCodeUnits(
      `${left.operand_kind}:${left.operand_cardinality.minimum}:` +
        `${left.operand_cardinality.maximum}:${left.applicability_modes.join(",")}`,
      `${right.operand_kind}:${right.operand_cardinality.minimum}:` +
        `${right.operand_cardinality.maximum}:${right.applicability_modes.join(",")}`
    ));
  return {
    vocabulary_version: vocabulary.vocabulary_version,
    signature_digest: digests.signature,
    value_kind_enum: vocabulary.value_kinds.map(({ term }) => term),
    type_term_enum: vocabulary.type_terms.map(({ term }) => term).sort(compareCodeUnits),
    applicability_mode_branches: vocabulary.applicability_modes.map((entry) => ({
      mode: entry.term,
      context_reference_cardinality: structuredClone(entry.context_reference_cardinality),
      context_reference_semantics: structuredClone(entry.context_reference_semantics),
      controlled_entailments: structuredClone(entry.controlled_entailments)
    })),
    operator_enum: vocabulary.operators.map(({ term }) => term).sort(compareCodeUnits),
    proposition_branches: propositionBranches,
    operator_signatures: Object.fromEntries(vocabulary.operators.map(({ term, signature }) => [
      term,
      structuredClone(signature)
    ])),
    operator_applicability: Object.fromEntries(vocabulary.operators.map(({
      term, applicability
    }) => [term, structuredClone(applicability)])),
    cross_operator_constraints: structuredClone(vocabulary.cross_operator_constraints)
  };
}

function describeVocabularyTerms(terms, vocabulary = CONTROLLED_VOCABULARY) {
  const entries = new Map([
    ...vocabulary.type_terms.map((entry) => [entry.term, { kind: "type_term", ...entry }]),
    ...vocabulary.value_kinds.map((entry) => [entry.term, { kind: "value_kind", ...entry }]),
    ...vocabulary.applicability_modes.map((entry) => [entry.term, {
      kind: "applicability_mode",
      ...entry
    }]),
    ...vocabulary.operators.map((entry) => [entry.term, { kind: "operator", ...entry }])
  ]);
  const withheld = new Map((vocabulary.withheld_applicability_terms ?? []).map((entry) => [
    entry.term,
    { kind: "withheld_applicability_term", ...entry }
  ]));
  return terms.map((term) => {
    if (entries.has(term)) return {
      requested_term: term,
      found: true,
      active: true,
      entry: structuredClone(entries.get(term))
    };
    if (withheld.has(term)) return {
      requested_term: term,
      found: true,
      active: false,
      entry: structuredClone(withheld.get(term))
    };
    return { requested_term: term, found: false, active: false, entry: null };
  });
}

function searchVocabulary({
  text,
  kinds = ["operator", "type_term", "applicability_mode", "value_kind"]
},
  vocabulary = CONTROLLED_VOCABULARY) {
  const normalized = text.trim().toLowerCase();
  const candidates = [
    ...vocabulary.value_kinds.map((entry) => ({ kind: "value_kind", ...entry })),
    ...vocabulary.type_terms.map((entry) => ({ kind: "type_term", ...entry })),
    ...vocabulary.applicability_modes.map((entry) => ({ kind: "applicability_mode", ...entry })),
    ...vocabulary.operators.map((entry) => ({ kind: "operator", ...entry }))
  ].filter(({ kind }) => kinds.includes(kind));
  const results = candidates.filter(({ term, definition }) =>
    normalized === "" || `${term}\n${definition}`.toLowerCase().includes(normalized)
  ).sort((left, right) => compareCodeUnits(left.term, right.term));
  return {
    vocabulary_version: vocabulary.vocabulary_version,
    vocabulary_complete_digest: vocabularyDigests(vocabulary).complete,
    query: { text, kinds: [...kinds] },
    total_count: results.length,
    results: structuredClone(results)
  };
}

function buildAdvisoryVocabularyView({
  operator_terms: operatorTerms = [],
  type_terms: typeTerms = [],
  applicability_modes: applicabilityModes = []
}, vocabulary = CONTROLLED_VOCABULARY) {
  const digests = vocabularyDigests(vocabulary);
  const selected = {
    operators: vocabulary.operators.filter(({ term }) => operatorTerms.includes(term)),
    type_terms: vocabulary.type_terms.filter(({ term }) => typeTerms.includes(term)),
    applicability_modes: vocabulary.applicability_modes.filter(
      ({ term }) => applicabilityModes.includes(term)
    )
  };
  const requestedTerms = new Set([...operatorTerms, ...typeTerms, ...applicabilityModes]);
  const foundTerms = new Set(Object.values(selected).flat().map(({ term }) => term));
  const withheldByTerm = new Map((vocabulary.withheld_applicability_terms ?? []).map(
    (entry) => [entry.term, entry]
  ));
  const withheldRequestedTerms = [...requestedTerms]
    .filter((term) => withheldByTerm.has(term))
    .sort(compareCodeUnits)
    .map((term) => structuredClone(withheldByTerm.get(term)));
  const withheldTermNames = new Set(withheldRequestedTerms.map(({ term }) => term));
  return {
    view_version: "controlled-vocabulary-advisory-view.experimental.v0.1",
    authoritative: false,
    vocabulary_version: vocabulary.vocabulary_version,
    parent_vocabulary_digests: { ...digests },
    explicit_omissions: {
      operator_count: vocabulary.operators.length - selected.operators.length,
      type_term_count: vocabulary.type_terms.length - selected.type_terms.length,
      applicability_mode_count:
        vocabulary.applicability_modes.length - selected.applicability_modes.length
    },
    withheld_requested_terms: withheldRequestedTerms,
    unknown_requested_terms: [...requestedTerms].filter(
      (term) => !foundTerms.has(term) && !withheldTermNames.has(term)
    ).sort(compareCodeUnits),
    selected: structuredClone(selected)
  };
}

export {
  APPLICABILITY_MODES,
  CONTROLLED_VOCABULARY,
  OPERATORS,
  TYPE_TERMS,
  VALUE_KINDS,
  VOCABULARY_DIGESTS,
  VOCABULARY_VERSION,
  buildAdvisoryVocabularyView,
  deriveVocabularyIndexes,
  deriveVocabularySchemaProjection,
  describeVocabularyTerms,
  searchVocabulary,
  validateVocabulary
};
