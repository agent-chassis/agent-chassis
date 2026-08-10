import { CONTROLLED_VOCABULARY, VOCABULARY_DIGESTS } from
  "../vocabulary/cv.experimental.0.34.mjs";
import { NATIVE_CONTRACT_SCHEMA as V033_NATIVE_CONTRACT_SCHEMA } from
  "./native-contract-carrier.mjs";
import { createNativeContractRuntime } from "./native-contract-runtime.mjs";
import { evaluatePopulationRelations } from "./population-semantics-v034.mjs";
import {
  deriveVocabularyIndexes,
  deriveVocabularySchemaProjection,
  validateVocabulary
} from "./vocabulary-v034.mjs";

const SCHEMA_VERSION_V034 = "controlled-acceptance-contract.experimental.v0.2";
const PROFILE_ID_V034 = "acceptance-contract.standard.experimental.v0.2";
const VOCABULARY_VERSION_V034 = CONTROLLED_VOCABULARY.vocabulary_version;

const vocabularyValidation = validateVocabulary();
if (!vocabularyValidation.valid) throw new Error(
  `Cannot build ${SCHEMA_VERSION_V034} from an invalid vocabulary: ` +
  JSON.stringify(vocabularyValidation.diagnostics)
);

const projection = deriveVocabularySchemaProjection();
const indexes = deriveVocabularyIndexes();

function arrayCardinalitySchema(cardinality) {
  return {
    minItems: cardinality.minimum,
    ...(cardinality.maximum === null ? {} : { maxItems: cardinality.maximum })
  };
}

function buildNativeContractSchemaV034() {
  const schema = structuredClone(V033_NATIVE_CONTRACT_SCHEMA);
  schema.title = SCHEMA_VERSION_V034;
  schema.description =
    "Experimental schema-native acceptance-contract carrier derived from the intrinsic " +
    "cv.experimental.0.34 proposition vocabulary. Free text remains confined to residue " +
    "and annotations; the carrier is not an authorization or policy result.";
  schema.properties.schema_version.enum = [SCHEMA_VERSION_V034];
  schema.properties.vocabulary_version.enum = [VOCABULARY_VERSION_V034];
  schema.properties.profile_id.enum = [PROFILE_ID_V034];
  schema.$defs.reference.properties.type_term.enum = [...projection.type_term_enum];
  schema.$defs.applicability_context = {
    description: "A vocabulary-derived condition or temporal context. Context references are conjunctive, unordered, duplicate-insensitive, and matched as an exact normalized set.",
    oneOf: projection.applicability_mode_branches.map((branch) => ({
      type: "object",
      required: ["mode", "operand_reference_ids"],
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: [branch.mode] },
        operand_reference_ids: {
          type: "array",
          ...arrayCardinalitySchema(branch.context_reference_cardinality),
          items: { $ref: "#/$defs/reference_id" }
        }
      }
    }))
  };
  schema.$defs.proposition.properties.operator.enum = [...projection.operator_enum];
  schema.$defs.proposition.anyOf = projection.proposition_branches.map((branch) => ({
    properties: {
      operator: { type: "string", enum: [...branch.operator_terms] },
      applicability_context: {
        type: "object",
        properties: {
          mode: { type: "string", enum: [...branch.applicability_modes] }
        }
      },
      operands: {
        type: "array",
        ...arrayCardinalitySchema(branch.operand_cardinality),
        items: branch.operand_numeric_domain?.kind === "integer_range"
          ? {
              allOf: [{ $ref: `#/$defs/${branch.operand_kind}_operand` }, {
                type: "object",
                properties: {
                  value: {
                    type: "integer",
                    minimum: branch.operand_numeric_domain.minimum,
                    ...(branch.operand_numeric_domain.maximum === null
                      ? {}
                      : { maximum: branch.operand_numeric_domain.maximum })
                  }
                }
              }]
            }
          : { $ref: `#/$defs/${branch.operand_kind}_operand` }
      }
    }
  }));
  return schema;
}

const NATIVE_CONTRACT_SCHEMA_V034 = buildNativeContractSchemaV034();

function typeAllowed(typeConstraint, typeTerm) {
  return typeConstraint.kind === "unrestricted" || typeConstraint.terms.includes(typeTerm);
}

function validatePropositionSemantics({ proposition, referenceById }) {
  const signature = projection.operator_signatures[proposition.operator];
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
      if (reference && !typeAllowed(signature.operand_types, reference.type_term)) diagnostics.push({
        code: "operator_operand_type_invalid",
        proposition_id: proposition.proposition_id,
        operator: proposition.operator,
        reference_id: reference.reference_id,
        actual_type_term: reference.type_term,
        allowed_type_terms: [...signature.operand_types.terms]
      });
    }
  }
  return diagnostics;
}

const runtime = createNativeContractRuntime({
  carrierVersion: SCHEMA_VERSION_V034,
  schema: NATIVE_CONTRACT_SCHEMA_V034,
  complementByOperator: indexes.complement_by_operator,
  inverseByOperator: indexes.inverse_by_operator,
  functionalOperators: indexes.functional_operators,
  symmetricOperators: indexes.symmetric_operators,
  transitiveOperators: indexes.transitive_operators.filter(
    (operator) => !indexes.population_relation_by_operator[operator]
  ),
  pointwiseRelationOperators: Object.entries(indexes.multiplicity_by_operator)
    .filter(([, multiplicity]) => multiplicity === "relation_set")
    .map(([operator]) => operator),
  complementContradictionModalities: ["MUST", "MUST_NOT"],
  unconditionalEquivalenceIsGlobal: true,
  operandSemanticsByOperator: indexes.operand_semantics_by_operator,
  crossOperatorConstraints: indexes.cross_operator_constraints,
  conjunctiveRangeOperators: CONTROLLED_VOCABULARY.operators
    .filter(({ signature, multiplicity }) =>
      signature.operand_kind === "range" && multiplicity === "conjunctive_constraint"
    )
    .map(({ term }) => term),
  irreflexiveOperators: CONTROLLED_VOCABULARY.operators
    .filter(({ algebraic_traits: algebraicTraits }) => algebraicTraits.irreflexive)
    .map(({ term }) => term),
  validatePropositionSemantics,
  validatePopulationRelations: (contract) => evaluatePopulationRelations(
    contract,
    indexes.population_relation_by_operator
  )
});

function controlledComplementV034(operator) {
  return runtime.controlledComplement(operator);
}

const validateAndResolveNativeContractV034 = runtime.validateAndResolve;

export {
  NATIVE_CONTRACT_SCHEMA_V034,
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_DIGESTS,
  VOCABULARY_VERSION_V034,
  buildNativeContractSchemaV034,
  controlledComplementV034,
  validateAndResolveNativeContractV034
};
