import assert from "node:assert/strict";
import test from "node:test";

import { OPERATOR_CODEBOOK } from
  "../legacy/versions/controlled-contract-general-v032.mjs";
import {
  parseArgs as parseVocabularyQueryArgs,
  queryVocabulary
} from "../development/tools/query-vocabulary.mjs";
import { NATIVE_CONTRACT_SCHEMA } from "../../lib/native-contract-carrier.mjs";
import {
  CONTROLLED_VOCABULARY,
  VOCABULARY_DIGESTS,
  buildAdvisoryVocabularyView,
  deriveVocabularyIndexes,
  deriveVocabularySchemaProjection,
  describeVocabularyTerms,
  searchVocabulary,
  validateVocabulary
} from "../../lib/vocabulary-v034.mjs";

const sorted = (values) => [...values].sort();
const readableV033Operators = () => Object.values(OPERATOR_CODEBOOK).map(
  ({ value_kind: valueKind, predicate }) => `${valueKind}:${predicate}`
);
const authenticationProvenanceOperators = [
  "reference:authenticates",
  "reference:does_not_authenticate",
  "reference:does_not_have_source_of_record",
  "reference:does_not_originate_from",
  "reference:has_source_of_record",
  "reference:not_observed_in",
  "reference:observed_in",
  "reference:originates_from"
];

test("v0.34 carries complete mechanical semantics for every current operator", () => {
  const result = validateVocabulary();
  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(CONTROLLED_VOCABULARY.operators.length, 93);
  assert.deepEqual(
    CONTROLLED_VOCABULARY.value_kinds.map(({ term }) => term),
    ["reference", "boolean", "number", "range"]
  );
  assert.deepEqual(
    sorted(CONTROLLED_VOCABULARY.operators.map(({ term }) => term)),
    sorted([
      ...readableV033Operators(),
      ...authenticationProvenanceOperators,
      "reference:subset_of",
      "reference:not_subset_of"
    ])
  );
  assert.deepEqual(
    sorted(CONTROLLED_VOCABULARY.type_terms.map(({ term }) => term)),
    sorted([...new Set([
      ...NATIVE_CONTRACT_SCHEMA.$defs.reference.properties.type_term.enum,
      "cc:population",
      "cc:evidence_occurrence"
    ])])
  );
  assert.equal(Object.isFrozen(CONTROLLED_VOCABULARY), true);
  assert.equal(Object.isFrozen(CONTROLLED_VOCABULARY.operators), true);
  assert.throws(() => {
    CONTROLLED_VOCABULARY.operators[0].definition = "mutated";
  }, TypeError);
});

test("v0.34 refuses absent semantics instead of treating silence as a clean operator", () => {
  const missingMultiplicity = structuredClone(CONTROLLED_VOCABULARY);
  delete missingMultiplicity.operators[0].multiplicity;
  assert.equal(validateVocabulary(missingMultiplicity).valid, false);
  assert.equal(
    validateVocabulary(missingMultiplicity).diagnostics.some(
      ({ code }) => code === "operator_multiplicity_undeclared"
    ),
    true
  );

  const missingComplement = structuredClone(CONTROLLED_VOCABULARY);
  delete missingComplement.operators[0].controlled_complement;
  assert.equal(
    validateVocabulary(missingComplement).diagnostics.some(
      ({ code }) => code === "operator_complement_undeclared"
    ),
    true
  );

  const missingDefinition = structuredClone(CONTROLLED_VOCABULARY);
  missingDefinition.operators[0].definition = "";
  assert.equal(
    validateVocabulary(missingDefinition).diagnostics.some(
      ({ code }) => code === "vocabulary_definition_missing"
    ),
    true
  );

  const inconsistentSingleValue = structuredClone(CONTROLLED_VOCABULARY);
  const hasState = inconsistentSingleValue.operators.find(
    ({ term }) => term === "reference:has_state"
  );
  hasState.signature.operand_cardinality.maximum = null;
  assert.equal(
    validateVocabulary(inconsistentSingleValue).diagnostics.some(
      ({ code }) => code === "single_value_operator_cardinality_invalid"
    ),
    true
  );

  const missingContextSemantics = structuredClone(CONTROLLED_VOCABULARY);
  delete missingContextSemantics.applicability_modes[0].context_reference_semantics;
  assert.equal(
    validateVocabulary(missingContextSemantics).diagnostics.some(
      ({ code }) => code === "applicability_context_semantics_incomplete"
    ),
    true
  );

  const missingEntailments = structuredClone(CONTROLLED_VOCABULARY);
  delete missingEntailments.operators[0].controlled_entailments;
  assert.equal(
    validateVocabulary(missingEntailments).diagnostics.some(
      ({ code }) => code === "operator_entailments_undeclared"
    ),
    true
  );

  const missingMechanicalSupport = structuredClone(CONTROLLED_VOCABULARY);
  delete missingMechanicalSupport.operators[0].mechanical_support;
  assert.equal(
    validateVocabulary(missingMechanicalSupport).diagnostics.some(
      ({ code }) => code === "operator_mechanical_support_incomplete"
    ),
    true
  );

  const missingCrossOperatorRules = structuredClone(CONTROLLED_VOCABULARY);
  delete missingCrossOperatorRules.cross_operator_constraints;
  assert.equal(
    validateVocabulary(missingCrossOperatorRules).diagnostics.some(
      ({ code }) => code === "cross_operator_constraints_undeclared"
    ),
    true
  );

  const missingNumericDomain = structuredClone(CONTROLLED_VOCABULARY);
  delete missingNumericDomain.operators.find(
    ({ term }) => term === "number:has_cardinality"
  ).signature.operand_numeric_domain;
  assert.equal(
    validateVocabulary(missingNumericDomain).diagnostics.some(
      ({ code }) => code === "operator_numeric_domain_invalid"
    ),
    true
  );

  const inconsistentComplement = structuredClone(CONTROLLED_VOCABULARY);
  inconsistentComplement.operators.find(
    ({ term }) => term === "reference:member_of"
  ).signature.operand_cardinality = { minimum: 1, maximum: null };
  assert.equal(
    validateVocabulary(inconsistentComplement).diagnostics.some(
      ({ code }) => code === "operator_complement_signature_mismatch"
    ),
    true
  );

  const falseEquivalence = structuredClone(CONTROLLED_VOCABULARY);
  falseEquivalence.operators.find(
    ({ term }) => term === "reference:semantically_equivalent"
  ).algebraic_traits.transitive = false;
  assert.equal(
    validateVocabulary(falseEquivalence).diagnostics.some(
      ({ code }) => code === "equivalence_relation_traits_invalid"
    ),
    true
  );

  const unknownApplicability = structuredClone(CONTROLLED_VOCABULARY);
  unknownApplicability.operators[0].applicability = {
    kind: "restricted_modes",
    modes: ["missing-mode"]
  };
  assert.equal(
    validateVocabulary(unknownApplicability).diagnostics.some(
      ({ code }) => code === "operator_applicability_modes_invalid"
    ),
    true
  );
});

test("v0.34 complement declarations are explicit and symmetric", () => {
  const indexes = deriveVocabularyIndexes();
  assert.deepEqual(indexes.complement_by_operator["reference:equals"], {
    kind: "operator",
    term: "reference:not_equals"
  });
  assert.deepEqual(indexes.complement_by_operator["reference:not_equals"], {
    kind: "operator",
    term: "reference:equals"
  });
  assert.deepEqual(indexes.complement_by_operator["reference:routes_to"], {
    kind: "none"
  });
  assert.deepEqual(indexes.complement_by_operator["boolean:exists"], {
    kind: "operand_transform",
    transform: "boolean_negation"
  });
  const signatures = deriveVocabularySchemaProjection().operator_signatures;
  for (const term of [
    "reference:equals", "reference:not_equals",
    "reference:member_of", "reference:not_member_of"
  ]) assert.deepEqual(signatures[term].operand_cardinality, { minimum: 1, maximum: 1 });
});

test("v0.34 withholds unresolved applicability terms rather than copying divergent enums", () => {
  const active = CONTROLLED_VOCABULARY.applicability_modes.map(({ term }) => term);
  const withheld = CONTROLLED_VOCABULARY.withheld_applicability_terms.map(({ term }) => term);
  assert.equal(active.includes("role_route"), false);
  assert.equal(active.includes("counterfactual"), false);
  assert.equal(withheld.includes("role_route"), true);
  assert.equal(withheld.includes("counterfactual"), true);
  assert.deepEqual(CONTROLLED_VOCABULARY.operators.find(
    ({ term }) => term === "reference:unchanged_from_frozen_base"
  ).applicability, {
    kind: "restricted_modes",
    modes: ["frozen_base"]
  });
});

test("v0.34 derives every semantic consumer index from the vocabulary artifact", () => {
  const indexes = deriveVocabularyIndexes();
  assert.deepEqual(Object.keys(indexes.operators_by_value_kind), [
    "reference", "boolean", "number", "range"
  ]);
  assert.equal(indexes.operators_by_value_kind.reference.length, 79);
  assert.equal(indexes.operators_by_value_kind.boolean.length, 5);
  assert.equal(indexes.operators_by_value_kind.number.length, 7);
  assert.equal(indexes.operators_by_value_kind.range.length, 2);
  assert.equal(
    Object.keys(indexes.multiplicity_by_operator).length,
    CONTROLLED_VOCABULARY.operators.length
  );
  assert.deepEqual(Object.keys(indexes.population_relation_by_operator), [
    "reference:subset_of",
    "reference:not_subset_of"
  ]);
  assert.equal(
    Object.keys(indexes.operand_semantics_by_operator).length,
    CONTROLLED_VOCABULARY.operators.length
  );
  assert.deepEqual(indexes.inverse_by_operator, {
    "reference:follows": { kind: "operator", term: "reference:precedes" },
    "reference:precedes": { kind: "operator", term: "reference:follows" }
  });
  assert.deepEqual(indexes.functional_operators, [
    "boolean:authoritative",
    "boolean:deterministic",
    "boolean:exists",
    "boolean:fails_when",
    "boolean:immutable",
    "number:equals",
    "number:has_cardinality",
    "reference:has_source_of_record",
    "reference:has_state",
    "reference:has_status",
    "reference:observed_in",
    "reference:ordered_as",
    "reference:originates_from",
    "reference:resolves_to"
  ]);
  for (const digest of Object.values(VOCABULARY_DIGESTS)) assert.match(digest, /^[a-f0-9]{64}$/);
});

test("v0.34 projects schema enums and operator-specific cardinalities without copied lists", () => {
  const projection = deriveVocabularySchemaProjection();
  assert.deepEqual(projection.value_kind_enum, ["reference", "boolean", "number", "range"]);
  assert.deepEqual(projection.operator_enum, sorted([
    ...readableV033Operators(),
    ...authenticationProvenanceOperators,
    "reference:subset_of",
    "reference:not_subset_of"
  ]));
  assert.equal(projection.type_term_enum.length, 24);
  assert.equal(projection.applicability_mode_branches.length, 11);
  assert.deepEqual(
    projection.operator_signatures["reference:has_state"].operand_cardinality,
    { minimum: 1, maximum: 1 }
  );
  assert.deepEqual(
    projection.operator_signatures["reference:ordered_as"].operand_cardinality,
    { minimum: 1, maximum: null }
  );
  assert.deepEqual(
    projection.operator_signatures["number:has_cardinality"].operand_numeric_domain,
    { kind: "integer_range", minimum: 0, maximum: null }
  );
  assert.deepEqual(projection.applicability_mode_branches.find(
    ({ mode }) => mode === "before"
  ).context_reference_semantics, {
    combination: "all",
    ordering: "insignificant",
    duplicates: "ignored",
    matching: "exact_normalized_reference_set"
  });
  assert.equal(projection.cross_operator_constraints.kind, "declared");
  assert.equal(projection.cross_operator_constraints.mechanical_support, "enforced");
  assert.deepEqual(
    projection.cross_operator_constraints.constraints.map(({ constraint_id: id }) => id),
    [
      "exact-cardinality-within-range",
      "exact-value-within-range",
      "exact-cardinality-not-below-declared-membership",
      "reference-equality-substitution"
    ]
  );
  assert.equal(
    projection.proposition_branches.flatMap(({ operator_terms: terms }) => terms).length,
    CONTROLLED_VOCABULARY.operators.length
  );
  assert.deepEqual(projection.proposition_branches.find(({ operator_terms: terms }) =>
    terms.includes("reference:unchanged_from_frozen_base")
  ).applicability_modes, ["frozen_base"]);
});

test("v0.34 custom projections bind the supplied artifact rather than canonical digests", () => {
  const changed = structuredClone(CONTROLLED_VOCABULARY);
  changed.operators.find(({ term }) => term === "reference:equals").definition += " Changed.";
  const view = buildAdvisoryVocabularyView({ operator_terms: ["reference:equals"] }, changed);
  assert.notEqual(view.parent_vocabulary_digests.complete, VOCABULARY_DIGESTS.complete);
  assert.equal(view.parent_vocabulary_digests.signature, VOCABULARY_DIGESTS.signature);
  assert.notEqual(view.parent_vocabulary_digests.definitions, VOCABULARY_DIGESTS.definitions);
});

test("v0.34 query results expose exact definitions without becoming authority", () => {
  const described = describeVocabularyTerms([
    "reference:equals", "reference:semantically_equivalent", "missing:term"
  ]);
  assert.equal(described[0].found, true);
  assert.equal(described[0].active, true);
  assert.equal(described[0].entry.controlled_complement.term, "reference:not_equals");
  assert.equal(described[1].found, true);
  assert.deepEqual(described[1].entry.controlled_complement, { kind: "none" });
  assert.deepEqual(described[2], {
    requested_term: "missing:term",
    found: false,
    active: false,
    entry: null
  });

  const withheld = describeVocabularyTerms(["counterfactual"])[0];
  assert.equal(withheld.found, true);
  assert.equal(withheld.active, false);
  assert.equal(withheld.entry.kind, "withheld_applicability_term");
  assert.match(withheld.entry.reason, /falsifier/);

  const searched = searchVocabulary({ text: "same controlled value", kinds: ["operator"] });
  assert.equal(searched.total_count >= 1, true);
  assert.equal(searched.results.some(({ term }) => term === "reference:equals"), true);
});

test("v0.34 authoring views are advisory, digest-bound, and explicitly incomplete", () => {
  const view = buildAdvisoryVocabularyView({
    operator_terms: ["reference:equals", "reference:not_equals"],
    type_terms: ["cc:state"],
    applicability_modes: ["counterfactual", "after mistakenly?"]
  });
  assert.equal(view.authoritative, false);
  assert.equal(view.vocabulary_version, "cv.experimental.0.34");
  assert.equal(view.selected.operators.length, 2);
  assert.equal(view.selected.type_terms.length, 1);
  assert.equal(view.selected.applicability_modes.length, 0);
  assert.deepEqual(view.unknown_requested_terms, ["after mistakenly?"]);
  assert.deepEqual(view.withheld_requested_terms.map(({ term }) => term), ["counterfactual"]);
  assert.equal(view.explicit_omissions.operator_count, 91);
  assert.equal(view.explicit_omissions.type_term_count, 23);
  assert.equal(view.explicit_omissions.applicability_mode_count, 11);
  assert.deepEqual(view.parent_vocabulary_digests, VOCABULARY_DIGESTS);
});

test("the vocabulary query transport returns only requested advisory context", () => {
  const exactOptions = parseVocabularyQueryArgs([
    "--term", "reference:equals",
    "--term", "counterfactual"
  ]);
  const exact = queryVocabulary(exactOptions);
  assert.equal(exact.authority.authoritative, false);
  assert.deepEqual(exact.vocabulary_digests, VOCABULARY_DIGESTS);
  assert.deepEqual(exact.results.map(({ active }) => active), [true, false]);

  const view = queryVocabulary(parseVocabularyQueryArgs([
    "--view",
    "--operator", "reference:equals",
    "--type", "cc:state",
    "--applicability", "after"
  ]));
  assert.equal(view.selected.operators.length, 1);
  assert.equal(view.selected.type_terms.length, 1);
  assert.equal(view.selected.applicability_modes.length, 1);
  assert.equal(view.explicit_omissions.operator_count, 92);
  assert.throws(
    () => parseVocabularyQueryArgs(["--search", "state", "--kind", "not-a-kind"]),
    /unknown vocabulary kind/
  );
});
