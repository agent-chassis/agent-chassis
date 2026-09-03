import { createHash } from "node:crypto";

const VOCABULARY_VERSION = "controlled-contract-vocabulary.v1";

const VALUE_KINDS = [
  ["reference", "An operand that names one grounded controlled reference."],
  ["boolean", "An operand carrying exactly one true or false value."],
  ["number", "An operand carrying exactly one finite numeric value."],
  ["range", "An operand carrying one inclusive numeric interval with at least one bound."]
].map(([term, definition]) => ({ term, definition }));

const TYPE_TERMS = [
  ["cc:entity", "A controlled thing whose more specific kind is not asserted."],
  ["cc:actor", "An entity capable of initiating or being responsible for an action."],
  ["cc:process", "A controlled course of action with an identity distinct from its executions."],
  ["cc:event", "A controlled occurrence at a particular logical point in an execution or lifecycle."],
  ["cc:state", "A controlled representation of the complete state selected for one subject and applicability scope."],
  ["cc:artifact", "A durable produced or consumed object."],
  ["cc:resource", "A controlled asset that can be read, written, allocated, or governed."],
  ["cc:capability", "An ability exposed or required by an entity, process, or system."],
  ["cc:requirement", "A controlled obligation-bearing specification element."],
  ["cc:criterion", "A controlled condition used to judge satisfaction of work or behavior."],
  ["cc:invariant", "A controlled condition required to remain true throughout its applicability scope."],
  ["cc:evidence", "A controlled observation or record offered in support of a claim."],
  ["cc:evidence_occurrence", "One bounded occurrence of evidence in one observation attempt, distinct from a reusable artifact, evidence class, logical record, or byte value. Re-observing identical bytes in another attempt creates a different occurrence. The type alone entails no authentication, provenance, authorship, issuance, integrity, containment, recording, observation membership, freshness, ownership, or authorization."],
  ["cc:conflict", "A controlled identity for an incompatibility requiring resolution."],
  ["cc:escalation", "A controlled identity for a handoff of unresolved responsibility or authority."],
  ["cc:authority", "An entity empowered to make a specified decision or grant a specified permission."],
  ["cc:population", "A controlled closed extensional population whose members and exact cardinality are declared in one applicability scope."],
  ["cc:scope", "A controlled boundary over identities, visibility, mutation, or applicability."],
  ["cc:configuration", "A controlled set of parameters or selections governing behavior."],
  ["cc:test", "A controlled verification process that evaluates an implementation or artifact."],
  ["cc:command", "A controlled invocable instruction or entry point."],
  ["cc:runtime_component", "A controlled component that participates in runtime behavior."],
  ["cc:lifecycle_entity", "A controlled entity whose states or transitions are lifecycle-governed."],
  ["cc:operation", "A controlled action that may be performed by an actor, process, command, or component."]
].map(([term, definition]) => ({ term, definition }));

const APPLICABILITY_MODES = [
  ["unconditional", "The proposition applies without an additional condition reference.", 0, 0],
  ["if", "The proposition applies if every referenced condition holds.", 1, null],
  ["unless", "The proposition applies except when every referenced condition holds.", 1, null],
  ["when", "The proposition applies at the occurrence or state identified by the referenced context.", 1, null],
  ["while", "The proposition applies throughout the interval identified by the referenced context.", 1, null],
  ["where", "The proposition applies within the controlled situation identified by the referenced context.", 1, null],
  ["before", "The proposition applies before the referenced event or lifecycle point.", 1, null],
  ["after", "The proposition applies after the referenced event or lifecycle point.", 1, null],
  ["during", "The proposition applies during the referenced process, event, or interval.", 1, null],
  ["until", "The proposition applies continuously until the referenced event or lifecycle point.", 1, null],
  ["frozen_base", "The proposition applies to the repository or artifact state identified as the frozen comparison base.", 1, 1]
].map(([term, definition, minimumContextReferences, maximumContextReferences]) => ({
  term,
  definition,
  context_reference_cardinality: {
    minimum: minimumContextReferences,
    maximum: maximumContextReferences
  },
  context_reference_semantics: {
    combination: "all",
    ordering: "insignificant",
    duplicates: "ignored",
    matching: "exact_normalized_reference_set"
  },
  controlled_entailments: { kind: "none" }
}));

const WITHHELD_APPLICABILITY_TERMS = [
  {
    term: "role_route",
    reason: "The v0.33 wire enum contains the term but no normative or mechanical definition exists. Graph routing belongs in an explicit relation until a recurring applicability meaning is demonstrated."
  },
  {
    term: "counterfactual",
    reason: "Counterfactual status belongs to a verification falsifier or scenario role, not to the applicability scope of an asserted proposition. The canonical v0.32 audit explicitly declined this applicability term."
  }
];

const unrestrictedTypes = Object.freeze({ kind: "unrestricted" });
const oneOrMoreReferences = Object.freeze({ minimum: 1, maximum: null });
const exactlyOne = Object.freeze({ minimum: 1, maximum: 1 });
const evidenceOccurrence = Object.freeze({
  kind: "restricted", terms: ["cc:evidence_occurrence"]
});
const authenticationTargets = Object.freeze({
  kind: "restricted",
  terms: ["cc:artifact", "cc:configuration", "cc:entity", "cc:event", "cc:resource", "cc:state"]
});
const provenanceSources = Object.freeze({
  kind: "restricted",
  terms: ["cc:actor", "cc:entity", "cc:process", "cc:resource", "cc:runtime_component"]
});
const observationAttempts = Object.freeze({
  kind: "restricted", terms: ["cc:event", "cc:process"]
});

const referenceOperators = [
  ["accepts", "The subject treats each operand as an admissible input, result, or artifact."],
  ["adds", "The subject adds each operand to the governed result or population."],
  ["allows", "The subject permits each operand under the stated applicability scope."],
  ["approves", "The subject records approval of each operand."],
  ["authorizes", "The subject grants authority for each operand."],
  ["behaviorally_equivalent", "The subject and each operand are interchangeable for the explicitly governed observable behavior."],
  ["blocks", "The subject prevents completion, progress, or activation of each operand."],
  ["calls", "The subject invokes each operand."],
  ["classifies_as", "The subject is assigned each controlled classification operand."],
  ["complete_against", "The subject is declared complete relative to every member of each operand population."],
  ["completes", "The subject brings each operand to its declared completion state."],
  ["conflicts_with", "The subject is incompatible with each operand in the stated applicability scope."],
  ["conforms_to", "The subject satisfies the controlled structure or rules identified by each operand."],
  ["contains", "The subject contains each operand as a governed member or part."],
  ["covers", "The subject evaluates, represents, or accounts for each operand within its declared coverage boundary."],
  ["creates", "The subject brings each operand into existence."],
  ["deletes", "The subject removes each operand from existence or the governed population."],
  ["depends_on", "The subject requires each operand to exist or complete first."],
  ["emits", "The subject produces each operand as an output or event."],
  ["equals", "The subject denotes the same controlled value as each operand."],
  ["exports", "The subject exposes each operand outside its declared module or component boundary."],
  ["follows", "The subject occurs or is ordered after each operand."],
  ["forwards_to", "The subject transfers the governed request, message, or responsibility to each operand."],
  ["generates", "The subject produces each operand through a declared generation process."],
  ["has_identity", "The subject carries each operand as a declared identity; several identity forms may coexist."],
  ["has_property", "The subject carries each operand as a declared property."],
  ["has_state", "The subject has the complete controlled state represented by the operand in the stated applicability scope."],
  ["has_status", "The subject has the controlled status represented by the operand in the stated applicability scope."],
  ["has_type", "The subject carries each operand as a declared type; several types may coexist."],
  ["has_value", "The subject carries each operand as one declared value; several values may coexist unless a narrower operator is used."],
  ["imports", "The subject makes each operand available inside its declared module or component boundary."],
  ["includes", "The subject includes each operand without asserting that the listed operands are the complete population."],
  ["invalidates", "The subject makes each operand no longer valid for its declared purpose."],
  ["isolated_from", "The subject has no governed interaction path with each operand."],
  ["matches", "The subject satisfies the comparison relation identified by each operand without asserting identity."],
  ["member_of", "The subject is a member of each operand population or container."],
  ["modifies", "The subject changes each operand without asserting unrestricted mutation."],
  ["mutates", "The subject changes the state or content of each operand."],
  ["not_equals", "The subject does not denote the same controlled value as each operand."],
  ["not_member_of", "The subject is excluded from each operand population or container."],
  ["omits", "The subject excludes each operand from the governed output or population."],
  ["performs", "The subject executes each operand operation or process."],
  ["precedes", "The subject occurs or is ordered before each operand."],
  ["preserves", "The subject leaves each operand unchanged within the governed observation boundary."],
  ["replaces", "The subject supersedes each operand while retaining the declared replacement relationship."],
  ["reads", "The subject observes or consumes each operand without asserting mutation."],
  ["records", "The subject persistently represents an observation or fact about each operand."],
  ["rejects", "The subject refuses each operand as an input, result, request, or artifact."],
  ["resolves_to", "The subject deterministically resolves to the operand in the stated applicability scope."],
  ["retains", "The subject keeps each operand in the governed output or population."],
  ["returns", "The subject produces each operand as a declared return value."],
  ["authoritative_for", "The subject is the declared decision authority for each operand."],
  ["contained_in", "The subject is contained within each operand boundary or container."],
  ["ordered_as", "The subject has the complete operand ordering exactly as listed."],
  ["requests_authorization", "The subject requests authorization from each operand authority or actor."],
  ["routes_to", "The subject sends the governed request, message, or control flow to each operand destination."],
  ["same_container_as", "The subject and each operand are contained by the same controlled container."],
  ["semantically_equivalent", "The subject and each operand have the same declared meaning within the controlled interpretation boundary."],
  ["escalates_to", "The subject transfers unresolved responsibility or authority to each operand."],
  ["starts", "The subject initiates each operand event or process."],
  ["supports", "The subject provides evidence or capability supporting each operand."],
  ["subset_of", "Every equality-normalized member of the closed subject population is a member of the closed operand population in the same applicability scope."],
  ["not_subset_of", "At least one equality-normalized member of the closed subject population is absent from the closed operand population in the same applicability scope."],
  ["targets", "The subject is directed at each operand."],
  ["traces_to", "The subject has an explicit traceability relationship to each operand."],
  ["unchanged_from_frozen_base", "The subject equals each operand's value at the declared frozen base."],
  ["uses", "The subject consumes or depends operationally on each operand."],
  ["visible_in_scope", "The subject is visible within each operand scope."],
  ["within_scope", "The subject is contained by each operand scope."],
  ["writable_in_scope", "The subject may be mutated within each operand scope."],
  ["writes", "The subject mutates or produces persistent content in each operand."]
];

const equivalencePredicates = new Set([
  "behaviorally_equivalent", "equals", "same_container_as", "semantically_equivalent"
]);
const singleValuePredicates = new Set(["has_state", "has_status", "resolves_to"]);
const completeOrderPredicates = new Set(["ordered_as"]);
const constraintPredicates = new Set(["not_equals", "not_member_of"]);
const symmetricPredicates = new Set([
  "behaviorally_equivalent", "conflicts_with", "equals", "isolated_from",
  "not_equals", "same_container_as", "semantically_equivalent"
]);
const transitivePredicates = new Set([
  "behaviorally_equivalent", "contained_in", "contains", "depends_on", "equals",
  "follows", "precedes", "same_container_as", "semantically_equivalent", "subset_of"
]);
const irreflexivePredicates = new Set([
  "classifies_as", "conflicts_with", "contained_in", "contains", "depends_on", "follows",
  "forwards_to", "has_property", "has_type", "isolated_from", "member_of", "not_equals",
  "not_subset_of", "precedes", "replaces", "routes_to", "within_scope"
]);

const complementByReferencePredicate = new Map([
  ["equals", "reference:not_equals"],
  ["not_equals", "reference:equals"],
  ["member_of", "reference:not_member_of"],
  ["not_member_of", "reference:member_of"],
  ["subset_of", "reference:not_subset_of"],
  ["not_subset_of", "reference:subset_of"]
]);
const inverseByReferencePredicate = new Map([
  ["contained_in", "reference:contains"],
  ["contains", "reference:contained_in"],
  ["exports", "reference:imports"],
  ["follows", "reference:precedes"],
  ["imports", "reference:exports"],
  ["precedes", "reference:follows"]
]);
const singleOperandReferencePredicates = new Set([
  ...singleValuePredicates,
  ...complementByReferencePredicate.keys()
]);

function referenceOperator([predicate, definition]) {
  let multiplicity = "relation_set";
  if (equivalencePredicates.has(predicate)) multiplicity = "equivalence_relation";
  if (singleValuePredicates.has(predicate)) multiplicity = "single_value_per_subject_scope";
  if (completeOrderPredicates.has(predicate)) multiplicity = "complete_order";
  if (constraintPredicates.has(predicate)) multiplicity = "conjunctive_constraint";
  const populationRelation = predicate === "subset_of" || predicate === "not_subset_of";
  return {
    term: `reference:${predicate}`,
    definition,
    signature: {
      subject_types: populationRelation
        ? { kind: "restricted", terms: ["cc:population", "cc:scope"] }
        : unrestrictedTypes,
      operand_kind: "reference",
      operand_types: populationRelation
        ? { kind: "restricted", terms: ["cc:population", "cc:scope"] }
        : unrestrictedTypes,
      operand_cardinality: singleOperandReferencePredicates.has(predicate)
        ? exactlyOne
        : oneOrMoreReferences
    },
    operand_semantics: {
      ordering: predicate === "ordered_as" ? "significant" : "insignificant",
      duplicates: predicate === "ordered_as" ? "significant" : "ignored"
    },
    multiplicity,
    controlled_complement: complementByReferencePredicate.has(predicate)
      ? { kind: "operator", term: complementByReferencePredicate.get(predicate) }
      : { kind: "none" },
    inverse: inverseByReferencePredicate.has(predicate)
      ? { kind: "operator", term: inverseByReferencePredicate.get(predicate) }
      : { kind: "none" },
    controlled_entailments: { kind: "none" },
    population_semantics: populationRelation ? {
      kind: "closed_extensional_relation",
      relation: predicate === "subset_of" ? "subset" : "not_subset",
      membership_operators: ["reference:contains", "reference:member_of"],
      exact_cardinality_operator: "number:has_cardinality",
      equality_operator: "reference:equals",
      membership_identity: "mandatory_equality_class",
      closure: "exact_cardinality_equals_distinct_declared_members",
      scope_matching: "exact_scope_plus_unconditional_facts",
      empty_population: "allowed"
    } : { kind: "not_applicable" },
    algebraic_traits: {
      symmetric: symmetricPredicates.has(predicate),
      transitive: transitivePredicates.has(predicate),
      irreflexive: irreflexivePredicates.has(predicate)
    },
    mechanical_support: {
      operand_semantics: "enforced",
      multiplicity: "enforced",
      controlled_complement: "enforced",
      inverse: inverseByReferencePredicate.has(predicate)
        ? ["follows", "precedes"].includes(predicate) ? "enforced" : "declared_only"
        : "not_applicable",
      controlled_entailments: "enforced",
      population_semantics: populationRelation ? "enforced" : "not_applicable",
      algebraic_traits: {
        symmetric: symmetricPredicates.has(predicate) ? "enforced" : "not_applicable",
        transitive: transitivePredicates.has(predicate)
          ? ["equals", "follows", "precedes", "subset_of"].includes(predicate)
            ? "enforced"
            : "declared_only"
          : "not_applicable",
        irreflexive: irreflexivePredicates.has(predicate) ? "enforced" : "not_applicable"
      },
      applicability: "enforced"
    },
    applicability: predicate === "unchanged_from_frozen_base"
      ? { kind: "restricted_modes", modes: ["frozen_base"] }
      : { kind: "all_declared_modes" }
  };
}

function authenticationProvenanceOperator({
  term,
  definition,
  subjectTypes,
  operandTypes,
  operandCardinality,
  multiplicity,
  complement,
  applicabilityModes,
  applicabilityContextTypes,
  operandDuplicates = "forbidden"
}) {
  return {
    term,
    definition,
    signature: {
      subject_types: subjectTypes,
      operand_kind: "reference",
      operand_types: operandTypes,
      operand_cardinality: operandCardinality
    },
    operand_semantics: { ordering: "insignificant", duplicates: operandDuplicates },
    multiplicity,
    controlled_complement: { kind: "operator", term: complement },
    inverse: { kind: "none" },
    controlled_entailments: { kind: "none" },
    population_semantics: { kind: "not_applicable" },
    algebraic_traits: { symmetric: false, transitive: false, irreflexive: true },
    mechanical_support: {
      operand_semantics: "enforced",
      multiplicity: "enforced",
      controlled_complement: "enforced",
      inverse: "not_applicable",
      controlled_entailments: "enforced",
      population_semantics: "not_applicable",
      algebraic_traits: {
        symmetric: "not_applicable",
        transitive: "not_applicable",
        irreflexive: "enforced"
      },
      applicability: "enforced"
    },
    applicability: {
      kind: "restricted_modes",
      modes: applicabilityModes,
      context_reference_cardinality: applicabilityModes[0] === "unconditional"
        ? { minimum: 0, maximum: 0 }
        : { minimum: 1, maximum: 1 },
      context_reference_types: applicabilityContextTypes
    }
  };
}

const authenticationProvenanceOperators = [
  {
    term: "reference:authenticates",
    definition: "Within the exact applicability scope, the subject evidence occurrence establishes each exact operand referent, with the authentication witness binding that referent, the evidence content, the provenance source, and the observation attempt. It does not entail origin, source-of-record status, ownership, authorship, issuance, authorization, containment, recording, freshness, or general integrity.",
    subjectTypes: evidenceOccurrence,
    operandTypes: authenticationTargets,
    operandCardinality: oneOrMoreReferences,
    multiplicity: "relation_set",
    complement: "reference:does_not_authenticate",
    applicabilityModes: ["during"],
    applicabilityContextTypes: observationAttempts,
    operandDuplicates: "ignored"
  },
  {
    term: "reference:does_not_authenticate",
    definition: "The exact positive authenticates relation is false for the same equality-normalized evidence occurrence, target, and exact scope. Missing evidence or failure to prove authentication does not entail this controlled negative.",
    subjectTypes: evidenceOccurrence,
    operandTypes: authenticationTargets,
    operandCardinality: oneOrMoreReferences,
    multiplicity: "conjunctive_constraint",
    complement: "reference:authenticates",
    applicabilityModes: ["during"],
    applicabilityContextTypes: observationAttempts,
    operandDuplicates: "ignored"
  },
  {
    term: "reference:originates_from",
    definition: "Within the exact applicability scope, the subject evidence occurrence has the exact operand as its singular authenticated provenance-root source. It does not entail immediate authorship, issuance, ownership, source-of-record status, decision authority, containment, recording, observation, authorization, or target authentication.",
    subjectTypes: evidenceOccurrence,
    operandTypes: provenanceSources,
    operandCardinality: exactlyOne,
    multiplicity: "single_value_per_subject_scope",
    complement: "reference:does_not_originate_from",
    applicabilityModes: ["during"],
    applicabilityContextTypes: observationAttempts
  },
  {
    term: "reference:does_not_originate_from",
    definition: "The exact positive originates_from relation is false for the same equality-normalized evidence occurrence, provenance source, and exact scope. It neither identifies another source nor entails that no source exists.",
    subjectTypes: evidenceOccurrence,
    operandTypes: provenanceSources,
    operandCardinality: exactlyOne,
    multiplicity: "conjunctive_constraint",
    complement: "reference:originates_from",
    applicabilityModes: ["during"],
    applicabilityContextTypes: observationAttempts
  },
  {
    term: "reference:has_source_of_record",
    definition: "Within the exact applicability scope, the subject target has the exact operand as the unique source whose representation is authoritative for that target in that scope. It does not entail ownership, authorship, issuance, decision authority, authorization, containment, recording, observation, or immutable integrity.",
    subjectTypes: authenticationTargets,
    operandTypes: provenanceSources,
    operandCardinality: exactlyOne,
    multiplicity: "single_value_per_subject_scope",
    complement: "reference:does_not_have_source_of_record",
    applicabilityModes: ["during"],
    applicabilityContextTypes: observationAttempts
  },
  {
    term: "reference:does_not_have_source_of_record",
    definition: "The exact positive has_source_of_record relation is false for the same equality-normalized target, source, and exact scope. It neither identifies the actual source nor entails that the target has no source of record.",
    subjectTypes: authenticationTargets,
    operandTypes: provenanceSources,
    operandCardinality: exactlyOne,
    multiplicity: "conjunctive_constraint",
    complement: "reference:has_source_of_record",
    applicabilityModes: ["during"],
    applicabilityContextTypes: observationAttempts
  },
  {
    term: "reference:observed_in",
    definition: "The subject evidence occurrence belongs to exactly the operand observation attempt. Identical reusable bytes observed again create a different occurrence. The relation does not entail authentication, provenance, recording, containment, freshness, issuance, integrity, or authorization.",
    subjectTypes: evidenceOccurrence,
    operandTypes: observationAttempts,
    operandCardinality: exactlyOne,
    multiplicity: "single_value_per_subject_scope",
    complement: "reference:not_observed_in",
    applicabilityModes: ["unconditional"],
    applicabilityContextTypes: Object.freeze({ kind: "restricted", terms: [] })
  },
  {
    term: "reference:not_observed_in",
    definition: "The exact positive observed_in relation is false for the same equality-normalized evidence occurrence and observation attempt. Absence of an observation claim does not entail non-observation, and this relation does not mean that reusable bytes are stale.",
    subjectTypes: evidenceOccurrence,
    operandTypes: observationAttempts,
    operandCardinality: exactlyOne,
    multiplicity: "conjunctive_constraint",
    complement: "reference:observed_in",
    applicabilityModes: ["unconditional"],
    applicabilityContextTypes: Object.freeze({ kind: "restricted", terms: [] })
  }
].map(authenticationProvenanceOperator);

const booleanOperators = [
  ["authoritative", "Whether the subject is authoritative for its declared purpose."],
  ["deterministic", "Whether equal controlled inputs to the subject require equal controlled outputs."],
  ["exists", "Whether the subject exists in the stated applicability scope."],
  ["fails_when", "Whether the subject fails when the referenced applicability condition holds."],
  ["immutable", "Whether the subject is prohibited from changing in the stated applicability scope."]
].map(([predicate, definition]) => ({
  term: `boolean:${predicate}`,
  definition,
  signature: {
    subject_types: unrestrictedTypes,
    operand_kind: "boolean",
    operand_cardinality: exactlyOne
  },
  operand_semantics: { ordering: "insignificant", duplicates: "forbidden" },
  multiplicity: "single_value_per_subject_scope",
  controlled_complement: { kind: "operand_transform", transform: "boolean_negation" },
  inverse: { kind: "none" },
  controlled_entailments: { kind: "none" },
  population_semantics: { kind: "not_applicable" },
  algebraic_traits: { symmetric: false, transitive: false, irreflexive: false },
  mechanical_support: {
    operand_semantics: "enforced",
    multiplicity: "enforced",
    controlled_complement: "enforced",
    inverse: "not_applicable",
    controlled_entailments: "enforced",
    population_semantics: "not_applicable",
    algebraic_traits: {
      symmetric: "not_applicable",
      transitive: "not_applicable",
      irreflexive: "not_applicable"
    },
    applicability: "enforced"
  },
  applicability: { kind: "all_declared_modes" }
}));

const numberOperators = [
  ["emits", "The subject emits the stated numeric quantity."],
  ["equals", "The subject's numeric value equals the stated number."],
  ["has_cardinality", "The subject population has exactly the stated number of members."],
  ["has_value", "The subject carries the stated numeric value."],
  ["matches", "The subject's numeric measurement matches the stated number under the declared comparison."],
  ["not_equals", "The subject's numeric value does not equal the stated number."],
  ["returns", "The subject returns the stated numeric value."]
].map(([predicate, definition]) => ({
  term: `number:${predicate}`,
  definition,
  signature: {
    subject_types: unrestrictedTypes,
    operand_kind: "number",
    operand_cardinality: exactlyOne,
    operand_numeric_domain: predicate === "has_cardinality"
      ? { kind: "integer_range", minimum: 0, maximum: null }
      : { kind: "unrestricted" }
  },
  operand_semantics: { ordering: "insignificant", duplicates: "forbidden" },
  multiplicity: ["equals", "has_cardinality"].includes(predicate)
    ? "single_value_per_subject_scope"
    : predicate === "not_equals" ? "conjunctive_constraint" : "relation_set",
  controlled_complement: predicate === "equals"
    ? { kind: "operator", term: "number:not_equals" }
    : predicate === "not_equals"
      ? { kind: "operator", term: "number:equals" }
      : { kind: "none" },
  inverse: { kind: "none" },
  controlled_entailments: { kind: "none" },
  population_semantics: { kind: "not_applicable" },
  algebraic_traits: { symmetric: false, transitive: false, irreflexive: false },
  mechanical_support: {
    operand_semantics: "enforced",
    multiplicity: "enforced",
    controlled_complement: "enforced",
    inverse: "not_applicable",
    controlled_entailments: "enforced",
    population_semantics: "not_applicable",
    algebraic_traits: {
      symmetric: "not_applicable",
      transitive: "not_applicable",
      irreflexive: "not_applicable"
    },
    applicability: "enforced"
  },
  applicability: { kind: "all_declared_modes" }
}));

const rangeOperators = [
  ["has_cardinality", "The subject population cardinality is constrained to the stated inclusive numeric range."],
  ["has_range", "The subject numeric value is constrained to the stated inclusive range."]
].map(([predicate, definition]) => ({
  term: `range:${predicate}`,
  definition,
  signature: {
    subject_types: unrestrictedTypes,
    operand_kind: "range",
    operand_cardinality: exactlyOne
  },
  operand_semantics: { ordering: "insignificant", duplicates: "forbidden" },
  multiplicity: "conjunctive_constraint",
  controlled_complement: { kind: "none" },
  inverse: { kind: "none" },
  controlled_entailments: { kind: "none" },
  population_semantics: { kind: "not_applicable" },
  algebraic_traits: { symmetric: false, transitive: false, irreflexive: false },
  mechanical_support: {
    operand_semantics: "enforced",
    multiplicity: "enforced",
    controlled_complement: "enforced",
    inverse: "not_applicable",
    controlled_entailments: "enforced",
    population_semantics: "not_applicable",
    algebraic_traits: {
      symmetric: "not_applicable",
      transitive: "not_applicable",
      irreflexive: "not_applicable"
    },
    applicability: "enforced"
  },
  applicability: { kind: "all_declared_modes" }
}));

const OPERATORS = [
  ...referenceOperators.map(referenceOperator),
  ...authenticationProvenanceOperators,
  ...booleanOperators,
  ...numberOperators,
  ...rangeOperators
];

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
}

const CONTROLLED_VOCABULARY = deepFreeze({
  vocabulary_version: VOCABULARY_VERSION,
  release_status: "draft",
  vocabulary_scope: {
    included: "The proposition lexicon: value kinds, reference type terms, applicability modes, and operators.",
    excluded: "Carrier structure, identity kinds, claim modalities, verification methods, relation roles, collection kinds, and policy terms remain grammar-owned rather than proposition-vocabulary terms."
  },
  definition_policy: {
    missing_mechanical_semantics_permitted: false,
    absent_complement_means_none: false,
    authoring_views_authoritative: false
  },
  value_kinds: VALUE_KINDS,
  type_terms: TYPE_TERMS,
  applicability_modes: APPLICABILITY_MODES,
  withheld_applicability_terms: WITHHELD_APPLICABILITY_TERMS,
  operators: OPERATORS,
  cross_operator_constraints: {
    kind: "declared",
    mechanical_support: "enforced",
    constraints: [
      {
        constraint_id: "exact-cardinality-within-range",
        kind: "exact_number_within_range",
        exact_operators: ["number:equals", "number:has_cardinality"],
        range_operators: ["range:has_cardinality"]
      },
      {
        constraint_id: "exact-value-within-range",
        kind: "exact_number_within_range",
        exact_operators: [
          "number:emits",
          "number:equals",
          "number:has_value",
          "number:matches",
          "number:returns"
        ],
        range_operators: ["range:has_range"]
      },
      {
        constraint_id: "exact-cardinality-not-below-declared-membership",
        kind: "exact_number_not_below_declared_membership",
        exact_operators: ["number:has_cardinality"],
        contains_operators: ["reference:contains"],
        member_of_operators: ["reference:member_of"],
        scope_matching: "same_or_exact_unconditional"
      },
      {
        constraint_id: "reference-equality-substitution",
        kind: "reference_equivalence_substitution",
        equivalence_operators: ["reference:equals"]
      }
    ]
  }
});

function vocabularyDigests(vocabulary) {
  return {
    complete: canonicalDigest(vocabulary),
    signature: canonicalDigest({
      vocabulary_version: vocabulary.vocabulary_version,
      value_kinds: vocabulary.value_kinds.map(({ term }) => term),
      type_terms: vocabulary.type_terms.map(({ term }) => term),
      applicability_modes: vocabulary.applicability_modes.map(({
        term, context_reference_cardinality, context_reference_semantics
      }) => ({
        term,
        context_reference_cardinality,
        context_reference_semantics
      })),
      operators: vocabulary.operators.map(({ term, signature }) => ({ term, signature }))
    }),
    algebra: canonicalDigest({
      vocabulary_version: vocabulary.vocabulary_version,
      applicability_modes: vocabulary.applicability_modes,
      operators: vocabulary.operators.map(({
        term, operand_semantics: operandSemantics,
        multiplicity, controlled_complement: controlledComplement,
        inverse, controlled_entailments: controlledEntailments,
        population_semantics: populationSemantics,
        algebraic_traits: algebraicTraits, mechanical_support: mechanicalSupport,
        applicability
      }) => ({
        term,
        operand_semantics: operandSemantics,
        multiplicity,
        controlled_complement: controlledComplement,
        inverse,
        controlled_entailments: controlledEntailments,
        population_semantics: populationSemantics,
        algebraic_traits: algebraicTraits,
        mechanical_support: mechanicalSupport,
        applicability
      })),
      cross_operator_constraints: vocabulary.cross_operator_constraints
    }),
    definitions: canonicalDigest({
      vocabulary_version: vocabulary.vocabulary_version,
      value_kinds: vocabulary.value_kinds,
      type_terms: vocabulary.type_terms,
      applicability_modes: vocabulary.applicability_modes.map(
        ({ term, definition }) => ({ term, definition })
      ),
      operators: vocabulary.operators.map(({ term, definition }) => ({ term, definition }))
    })
  };
}

const VOCABULARY_DIGESTS = deepFreeze(vocabularyDigests(CONTROLLED_VOCABULARY));

export {
  APPLICABILITY_MODES,
  CONTROLLED_VOCABULARY,
  OPERATORS,
  TYPE_TERMS,
  VALUE_KINDS,
  VOCABULARY_DIGESTS,
  VOCABULARY_VERSION,
  WITHHELD_APPLICABILITY_TERMS,
  canonicalDigest,
  canonicalValue,
  vocabularyDigests
};
