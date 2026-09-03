import STABLE_CONTRACT_SCHEMA from
  "../schema/controlled-acceptance-contract.v1.schema.json" with { type: "json" };
import {
  CONTROLLED_VOCABULARY,
  VOCABULARY_DIGESTS
} from "../vocabulary/controlled-contract-vocabulary.v1.mjs";
import { selectCausalSchemaDiagnostics } from "./bounded-diagnostic-projection.mjs";
import { compiledValidators } from "./compiled-validator-cache.mjs";
import { buildEqualityNormalizationV1 } from "./equality-normalization-v1.mjs";
import { createNativeContractRuntime } from "./native-contract-runtime.mjs";
import { evaluatePopulationRelationsV1 } from "./population-semantics-v1.mjs";
import {
  deriveVocabularyIndexes,
  deriveVocabularySchemaProjection,
  validateVocabulary
} from "./vocabulary-v1.mjs";

const SCHEMA_VERSION_V1 = "controlled-acceptance-contract.v1";
const PROFILE_ID_V1 = "acceptance-contract.standard.v1";
const VOCABULARY_VERSION_V1 = "controlled-contract-vocabulary.v1";
const TEST_PROOF_VERSION_V1 = "controlled-contract-test-proof.v1";

function buildNativeContractSchemaV1() {
  return structuredClone(STABLE_CONTRACT_SCHEMA);
}

const NATIVE_CONTRACT_SCHEMA_V1 = buildNativeContractSchemaV1();
const { validateSchema } = await compiledValidators(
  "controlled-contract.native-contract-carrier-v1",
  { validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 } }
);
const { validateSchema: validateNativeContractSchemaV1 } = await compiledValidators(
  "controlled-contract.native-contract-semantic-runtime.v1",
  { validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 } }
);

const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const vocabularyValidation = validateVocabulary();
if (!vocabularyValidation.valid) throw new Error(
  `Cannot build ${SCHEMA_VERSION_V1} from an invalid vocabulary: ` +
  JSON.stringify(vocabularyValidation.diagnostics)
);
const vocabularyProjection = deriveVocabularySchemaProjection();
const vocabularyIndexes = deriveVocabularyIndexes();

const pointerSegment = (segment) =>
  String(segment).replaceAll("~", "~0").replaceAll("/", "~1");

function resolveSchemaPointer(reference) {
  if (typeof reference !== "string" || !reference.startsWith("#/")) return null;
  let node = NATIVE_CONTRACT_SCHEMA_V1;
  for (const segment of reference.slice(2).split("/")) {
    if (!node || typeof node !== "object") return null;
    node = node[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return node && typeof node === "object" && !Array.isArray(node) ? node : null;
}

function schemaBranchFamilies(contract) {
  const declared = new Map();
  const visited = new Map();
  const visit = (node, value, pointer) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const pointers = visited.get(node) ?? new Set();
    if (pointers.has(pointer)) return;
    pointers.add(pointer);
    visited.set(node, pointers);
    visit(resolveSchemaPointer(node.$ref), value, pointer);
    for (const keyword of ["oneOf", "anyOf"]) {
      if (!Array.isArray(node[keyword])) continue;
      const key = `${keyword}${pointer}`;
      const family = declared.get(key) ?? { pointer, keyword, counts: new Map() };
      family.counts.set(node, node[keyword].length);
      declared.set(key, family);
      for (const branch of node[keyword]) visit(branch, value, pointer);
    }
    if (Array.isArray(node.allOf)) for (const branch of node.allOf) {
      visit(branch, value, pointer);
    }
    for (const keyword of ["if", "then", "else", "contains"]) {
      visit(node[keyword], value, pointer);
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, sub] of Object.entries(node.properties ?? {})) {
        if (Object.hasOwn(value, key)) {
          visit(sub, value[key], `${pointer}/${pointerSegment(key)}`);
        }
      }
    }
    if (Array.isArray(value)) for (const [index, entry] of value.entries()) {
      visit(node.items, entry, `${pointer}/${index}`);
    }
  };
  visit(NATIVE_CONTRACT_SCHEMA_V1, contract, "");
  const families = [];
  for (const { pointer, keyword, counts } of declared.values()) {
    for (const branchCount of counts.values()) {
      families.push({ pointer, keyword, branch_count: branchCount });
    }
  }
  return families;
}

function schemaDiagnostics(contract) {
  return selectCausalSchemaDiagnostics({
    errors: validateSchema.errors ?? [],
    branch_families: schemaBranchFamilies(contract)
  }).map((error) => ({
    code: "stable_contract_schema_invalid",
    pointer: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "stable contract schema validation failed",
    expected_identity: error.params?.allowedValue ?? null,
    actual_identity: null
  }));
}

function testProofPopulationDiagnostics(contract) {
  const diagnostics = [];
  const testClaims = contract.claims.filter(({ kind, verification_method: method }) =>
    kind === "verification" && method === "test_execution"
  ).map(({ claim_id: claimId }) => claimId).sort(compareCodeUnits);
  const nonTestClaims = new Set(contract.claims.filter(
    ({ kind, verification_method: method }) => kind === "verification" &&
      method !== "test_execution"
  ).map(({ claim_id: claimId }) => claimId));
  const proofIds = new Set();
  const proofClaims = new Map();
  for (const [index, proof] of contract.test_proofs.entries()) {
    if (proofIds.has(proof.test_proof_id)) diagnostics.push({
      code: "stable_test_proof_identity_duplicate",
      pointer: `/test_proofs/${index}/test_proof_id`,
      keyword: "uniqueIdentity",
      actual_identity: proof.test_proof_id
    });
    proofIds.add(proof.test_proof_id);
    const rows = proofClaims.get(proof.verification_claim_id) ?? [];
    rows.push(index);
    proofClaims.set(proof.verification_claim_id, rows);
    if (nonTestClaims.has(proof.verification_claim_id)) diagnostics.push({
      code: "stable_test_proof_for_non_test_claim",
      pointer: `/test_proofs/${index}/verification_claim_id`,
      keyword: "testExecutionOnly",
      actual_identity: proof.verification_claim_id
    });
  }
  for (const claimId of testClaims) {
    const count = proofClaims.get(claimId)?.length ?? 0;
    if (count !== 1) diagnostics.push({
      code: count === 0
        ? "stable_test_proof_missing"
        : "stable_test_proof_claim_duplicate",
      pointer: "/test_proofs",
      keyword: "completePopulation",
      expected_identity: claimId,
      actual_identity: count
    });
  }
  for (const [claimId, indexes] of proofClaims) if (!testClaims.includes(claimId) &&
      !nonTestClaims.has(claimId)) diagnostics.push({
    code: "stable_test_proof_claim_unknown",
    pointer: `/test_proofs/${indexes[0]}/verification_claim_id`,
    keyword: "sameCarrierReference",
    actual_identity: claimId
  });
  if (contract.test_proofs.map(({ verification_claim_id: claimId }) => claimId)
    .some((claimId, index, values) => index > 0 &&
      compareCodeUnits(values[index - 1], claimId) >= 0)) diagnostics.push({
    code: "stable_test_proof_population_noncanonical",
    pointer: "/test_proofs",
    keyword: "canonicalOrder"
  });
  return diagnostics;
}

function typeAllowed(typeConstraint, typeTerm) {
  return typeConstraint.kind === "unrestricted" || typeConstraint.terms.includes(typeTerm);
}

function validatePropositionSemanticsV1({ proposition, referenceById }) {
  const signature = vocabularyProjection.operator_signatures[proposition.operator];
  const applicability = vocabularyProjection.operator_applicability[proposition.operator];
  const diagnostics = [];
  const subject = referenceById.get(proposition.subject_reference_id);
  if (subject && !typeAllowed(signature.subject_types, subject.type_term)) diagnostics.push({
    code: "operator_subject_type_invalid",
    proposition_id: proposition.proposition_id,
    operator: proposition.operator,
    reference_id: subject.reference_id,
    actual_type_term: subject.type_term,
    allowed_type_terms: [...signature.subject_types.terms]
  });
  if (signature.operand_kind === "reference" && signature.operand_types.kind === "restricted") {
    for (const operand of proposition.operands) {
      const reference = referenceById.get(operand.reference_id);
      if (reference && !typeAllowed(signature.operand_types, reference.type_term)) {
        diagnostics.push({
          code: "operator_operand_type_invalid",
          proposition_id: proposition.proposition_id,
          operator: proposition.operator,
          reference_id: reference.reference_id,
          actual_type_term: reference.type_term,
          allowed_type_terms: [...signature.operand_types.terms]
        });
      }
    }
  }
  if (applicability?.context_reference_cardinality) {
    const count = new Set(proposition.applicability_context.operand_reference_ids).size;
    const { minimum, maximum } = applicability.context_reference_cardinality;
    if (count < minimum || maximum !== null && count > maximum) diagnostics.push({
      code: "operator_applicability_cardinality_invalid",
      proposition_id: proposition.proposition_id,
      operator: proposition.operator,
      actual_count: count,
      minimum,
      maximum
    });
  }
  if (applicability?.context_reference_types?.kind === "restricted") {
    for (const referenceId of proposition.applicability_context.operand_reference_ids) {
      const reference = referenceById.get(referenceId);
      if (reference && !applicability.context_reference_types.terms.includes(
        reference.type_term
      )) diagnostics.push({
        code: "operator_applicability_context_type_invalid",
        proposition_id: proposition.proposition_id,
        operator: proposition.operator,
        reference_id: referenceId,
        actual_type_term: reference.type_term,
        allowed_type_terms: [...applicability.context_reference_types.terms]
      });
    }
  }
  return diagnostics;
}

const nativeSemanticRuntimeV1 = createNativeContractRuntime({
  carrierVersion: SCHEMA_VERSION_V1,
  validateSchema: validateNativeContractSchemaV1,
  complementByOperator: vocabularyIndexes.complement_by_operator,
  inverseByOperator: vocabularyIndexes.inverse_by_operator,
  functionalOperators: vocabularyIndexes.functional_operators,
  symmetricOperators: vocabularyIndexes.symmetric_operators,
  transitiveOperators: vocabularyIndexes.transitive_operators.filter(
    (operator) => !vocabularyIndexes.population_relation_by_operator[operator]
  ),
  pointwiseRelationOperators: Object.entries(vocabularyIndexes.multiplicity_by_operator)
    .filter(([, multiplicity]) => multiplicity === "relation_set")
    .map(([operator]) => operator),
  complementContradictionModalities: ["MUST", "MUST_NOT"],
  unconditionalEquivalenceIsGlobal: true,
  operandSemanticsByOperator: vocabularyIndexes.operand_semantics_by_operator,
  crossOperatorConstraints: vocabularyIndexes.cross_operator_constraints,
  buildEqualityNormalization: buildEqualityNormalizationV1,
  equalityNormalizedOperators: new Set([
    "reference:authenticates",
    "reference:does_not_authenticate",
    "reference:originates_from",
    "reference:does_not_originate_from",
    "reference:has_source_of_record",
    "reference:does_not_have_source_of_record",
    "reference:observed_in",
    "reference:not_observed_in"
  ]),
  conjunctiveRangeOperators: CONTROLLED_VOCABULARY.operators
    .filter(({ signature, multiplicity }) =>
      signature.operand_kind === "range" && multiplicity === "conjunctive_constraint"
    )
    .map(({ term }) => term),
  irreflexiveOperators: CONTROLLED_VOCABULARY.operators
    .filter(({ algebraic_traits: algebraicTraits }) => algebraicTraits.irreflexive)
    .map(({ term }) => term),
  validatePropositionSemantics: validatePropositionSemanticsV1,
  validatePopulationRelations: (contract) => evaluatePopulationRelationsV1(
    contract, vocabularyIndexes.population_relation_by_operator
  )
});

function validateAndResolveNativeContractV1(contract) {
  const schemaValid = validateSchema(contract);
  const nativeResult = schemaValid ? nativeSemanticRuntimeV1.validateAndResolve(contract) : null;
  const diagnostics = schemaValid ? [
    ...nativeResult.diagnostics,
    ...testProofPopulationDiagnostics(contract)
  ].sort((left, right) =>
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(JSON.stringify(left), JSON.stringify(right))
  ) : [];
  return Object.freeze({
    schema_valid: schemaValid,
    schema_errors: schemaValid ? [] : schemaDiagnostics(contract),
    diagnostics: Object.freeze(diagnostics),
    valid: schemaValid && diagnostics.length === 0,
    family: schemaValid ? "stable_v1" : "invalid",
    facts: Object.freeze({
      test_proof_count: schemaValid ? contract.test_proofs.length : 0,
      operative_residue_count: schemaValid ? contract.residue.length : 0,
      vocabulary_digests: VOCABULARY_DIGESTS
    })
  });
}

export {
  NATIVE_CONTRACT_SCHEMA_V1,
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  TEST_PROOF_VERSION_V1,
  VOCABULARY_VERSION_V1,
  buildNativeContractSchemaV1,
  validateAndResolveNativeContractV1
};
