import { compiledValidators } from "./compiled-validator-cache.mjs";
import {
  CONTROLLED_VOCABULARY,
  VOCABULARY_DIGESTS
} from "../vocabulary/cv.experimental.0.34.mjs";
import {
  NATIVE_CONTRACT_SCHEMA_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034,
  validateAndResolveNativeContractV034
} from "./native-contract-carrier-v034.mjs";
import {
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA,
  VERIFICATION_PROFILE_RESULT_SCHEMA,
  VERIFICATION_PROFILE_SCHEMA,
  evaluateVerificationProfileWithRuntime
} from "./verification-profile.mjs";
import { createExpandedProfileSemanticValidator } from
  "./verification-profile-expanded-semantics.mjs";
import {
  deriveVocabularySchemaProjection
} from "./vocabulary-v034.mjs";
import {
  buildScopedEquality,
  evaluateCompletePopulationBinding,
  referencesEquivalent
} from "./population-semantics-v034.mjs";
import { profileDigest } from "./profile-digest.mjs";

const PROFILE_SCHEMA_VERSION_V034 =
  "controlled-contract-verification-profile.experimental.v0.2";
const EVALUATION_INPUT_VERSION_V034 =
  "controlled-contract-verification-profile-input.experimental.v0.2";
const RESULT_VERSION_V034 =
  "controlled-contract-verification-profile-result.experimental.v0.2";

const projection = deriveVocabularySchemaProjection();
const validateProfileSemanticsV034 = createExpandedProfileSemanticValidator({
  controlledVocabulary: CONTROLLED_VOCABULARY,
  vocabularyProjection: projection
});
const identityKinds = NATIVE_CONTRACT_SCHEMA_V034.$defs.reference.properties.identity.oneOf
  .flatMap((branch) => branch.properties.kind.enum);
function compareCodeUnits(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
}

function arrayCardinalitySchema(cardinality) {
  return {
    minItems: cardinality.minimum,
    ...(cardinality.maximum === null ? {} : { maxItems: cardinality.maximum })
  };
}

function buildTemplateApplicabilitySchema() {
  return {
    oneOf: projection.applicability_mode_branches.map((branch) => ({
      type: "object",
      required: ["mode", "operand_roles"],
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: [branch.mode] },
        operand_roles: {
          type: "array",
          ...arrayCardinalitySchema(branch.context_reference_cardinality),
          items: { type: "string", pattern: "^[a-z][a-z0-9_]*$" }
        }
      }
    }))
  };
}

function buildPropositionTemplateSchema(baseTemplateSchema) {
  const schema = structuredClone(baseTemplateSchema);
  schema.properties.operator.enum = [...projection.operator_enum];
  schema.properties.applicability_context = buildTemplateApplicabilitySchema();
  schema.anyOf = projection.proposition_branches.map((branch) => ({
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
        items: { $ref: `#/$defs/template_${branch.operand_kind}_operand` }
      }
    }
  }));
  return schema;
}

function buildVerificationProfileSchemaV034() {
  const schema = structuredClone(VERIFICATION_PROFILE_SCHEMA);
  schema.title = PROFILE_SCHEMA_VERSION_V034;
  schema.description =
    "Free-tier, non-authoritative proof-profile schema derived from the intrinsic " +
    "cv.experimental.0.34 vocabulary. A falsifying proposition template is " +
    "counterfactual because of its verification role; counterfactual is not an " +
    "applicability mode.";
  schema.required.push(
    "contract_schema_version",
    "vocabulary_version",
    "vocabulary_signature_digest",
    "vocabulary_algebra_digest",
    "vocabulary_definitions_digest",
    "vocabulary_complete_digest",
    "falsifier_condition_bindings"
  );
  schema.properties.binding_constraint_patterns = {
    type: "array",
    items: {
      type: "object",
      required: ["pattern_id", "required_by_stage", "role_kind", "role"],
      additionalProperties: false,
      properties: {
        pattern_id: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
        required_by_stage: { type: "string", enum: ["pre_dispatch", "post_delivery"] },
        role_kind: { type: "string", enum: ["reference", "number"] },
        role: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },
        minimum: { type: "integer", minimum: 0 },
        maximum: { type: "integer", minimum: 0 },
        binding_presence: { type: "string", enum: ["required", "forbidden"] }
      },
      anyOf: [
        { required: ["minimum"], properties: { minimum: true } },
        { required: ["maximum"], properties: { maximum: true } },
        { required: ["binding_presence"], properties: { binding_presence: true } }
      ]
    }
  };
  schema.properties.schema_version.enum = [PROFILE_SCHEMA_VERSION_V034];
  schema.properties.contract_schema_version = {
    type: "string",
    enum: [SCHEMA_VERSION_V034]
  };
  schema.properties.vocabulary_version = {
    type: "string",
    enum: [VOCABULARY_VERSION_V034]
  };
  schema.properties.vocabulary_signature_digest = {
    type: "string",
    enum: [VOCABULARY_DIGESTS.signature]
  };
  schema.properties.vocabulary_algebra_digest = {
    type: "string",
    enum: [VOCABULARY_DIGESTS.algebra]
  };
  schema.properties.vocabulary_definitions_digest = {
    type: "string",
    enum: [VOCABULARY_DIGESTS.definitions]
  };
  schema.properties.vocabulary_complete_digest = {
    type: "string",
    enum: [VOCABULARY_DIGESTS.complete]
  };
  schema.properties.falsifier_condition_bindings = {
    type: "array",
    minItems: 1,
    items: {
      type: "object",
      required: ["relation_pattern_id", "applicability_context"],
      additionalProperties: false,
      properties: {
        relation_pattern_id: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
        applicability_context: buildTemplateApplicabilitySchema()
      }
    }
  };
  const referenceJoinPositions = [
    "subject", "reference_operand", "applicability_operand"
  ];
  schema.properties.falsifier_occurrence_bindings = {
    type: "array",
    items: {
      type: "object",
      required: [
        "relation_pattern_id", "reference_role_joins", "number_role_joins",
        "applicability_join"
      ],
      additionalProperties: false,
      properties: {
        relation_pattern_id: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
        reference_role_joins: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: [
              "role", "target_positions", "verification_positions",
              "falsifier_positions"
            ],
            additionalProperties: false,
            properties: {
              role: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },
              target_positions: {
                type: "array", uniqueItems: true,
                items: { type: "string", enum: referenceJoinPositions }
              },
              verification_positions: {
                type: "array", minItems: 1, uniqueItems: true,
                items: { type: "string", enum: referenceJoinPositions }
              },
              falsifier_positions: {
                type: "array", uniqueItems: true,
                items: { type: "string", enum: referenceJoinPositions }
              }
            }
          }
        },
        number_role_joins: {
          type: "array",
          items: {
            type: "object",
            required: ["role"],
            additionalProperties: false,
            properties: {
              role: { type: "string", pattern: "^[a-z][a-z0-9_]*$" }
            }
          }
        },
        applicability_join: {
          type: "string",
          enum: ["exact_scope", "shared_operands"]
        }
      }
    }
  };
  schema.properties.reference_role_count_bindings = {
    description:
      "Binds a reference-role cardinality to an integer number role. The number role may " +
      "be exactly_one or zero_or_one; when optional, branch-local binding constraints " +
      "select whether it is required or forbidden.",
    type: "array",
    uniqueItems: true,
    items: {
      type: "object",
      required: ["reference_role", "number_role"],
      additionalProperties: false,
      properties: {
        reference_role: {
          type: "string",
          pattern: "^[a-z][a-z0-9_]*$"
        },
        number_role: {
          type: "string",
          pattern: "^[a-z][a-z0-9_]*$"
        }
      }
    }
  };
  schema.properties.reference_roles.items.properties.cardinality.enum.push("zero_or_more");
  const referenceBindingPattern = schema.properties.reference_binding_patterns.items;
  referenceBindingPattern.properties.comparison.enum.push("complete_population");
  referenceBindingPattern.properties.applicability_context = buildTemplateApplicabilitySchema();
  referenceBindingPattern.allOf = [{
    if: {
      required: ["comparison"],
      properties: { comparison: { const: "complete_population" } }
    },
    then: {
      required: ["applicability_context"],
      properties: { applicability_context: true }
    },
    else: { properties: { applicability_context: false } }
  }];
  schema.properties.reference_roles.items.properties.allowed_type_terms.items.enum =
    [...projection.type_term_enum];
  schema.properties.reference_roles.items.properties.allowed_identity_kinds = {
    description:
      "Optional closed identity-kind constraint for roles whose proof meaning requires " +
      "a repository, symbol, durable-domain, runtime, or abstract profile identity.",
    type: "array",
    minItems: 1,
    uniqueItems: true,
    items: { type: "string", enum: [...identityKinds] }
  };
  schema.properties.distinct_reference_role_sets.items.properties.applicability_contexts = {
    description:
      "Optional exact applicability scopes in which equality-normalized role " +
      "distinctness is required in addition to unconditional distinctness.",
    type: "array",
    minItems: 1,
    uniqueItems: true,
    items: buildTemplateApplicabilitySchema()
  };
  const claimPattern = schema.properties.claim_patterns.items;
  claimPattern.properties.for_each = {
    type: "object",
    required: ["population_role", "member_role"],
    additionalProperties: false,
    properties: {
      population_role: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },
      member_role: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },
      complete_population_pattern_id: {
        type: "string", pattern: "^[a-z][a-z0-9-]*$"
      },
      quantifier: { type: "string", enum: ["universal"] },
      empty_behavior: { type: "string", enum: ["vacuously_satisfied"] },
      association_bindings: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: [
            "associated_role", "operator", "member_position",
            "associated_position", "applicability_context",
            "complete_population_pattern_id"
          ],
          additionalProperties: false,
          properties: {
            associated_role: {
              type: "string", pattern: "^[a-z][a-z0-9_]*$"
            },
            operator: {
              type: "string",
              enum: projection.proposition_branches
                .filter(({ operand_kind: operandKind }) =>
                  operandKind === "reference"
                )
                .flatMap(({ operator_terms: operatorTerms }) => operatorTerms)
            },
            member_position: {
              type: "string", enum: ["subject", "reference_operand"]
            },
            associated_position: {
              type: "string", enum: ["subject", "reference_operand"]
            },
            applicability_context: buildTemplateApplicabilitySchema(),
            complete_population_pattern_id: {
              type: "string", pattern: "^[a-z][a-z0-9-]*$"
            },
            associated_cardinality: {
              type: "string", enum: ["exactly_one", "one_or_more"]
            }
          },
          oneOf: [
            {
              properties: {
                member_position: { const: "subject" },
                associated_position: { const: "reference_operand" }
              }
            },
            {
              properties: {
                member_position: { const: "reference_operand" },
                associated_position: { const: "subject" }
              }
            }
          ]
        }
      }
    },
    allOf: [{
      if: {
        anyOf: [
          {
            required: ["complete_population_pattern_id"],
            properties: { complete_population_pattern_id: true }
          },
          { required: ["quantifier"], properties: { quantifier: true } },
          {
            required: ["empty_behavior"],
            properties: { empty_behavior: true }
          }
        ]
      },
      then: {
        required: [
          "quantifier", "empty_behavior"
        ],
        properties: {
          complete_population_pattern_id: true,
          quantifier: true,
          empty_behavior: true
        }
      }
    }, {
      if: {
        required: ["association_bindings"],
        properties: { association_bindings: true }
      },
      then: {
        required: [
          "quantifier", "empty_behavior"
        ],
        properties: {
          quantifier: { const: "universal" },
          empty_behavior: { const: "vacuously_satisfied" }
        }
      }
    }]
  };
  claimPattern.properties.proposition_template = buildPropositionTemplateSchema(
    claimPattern.properties.proposition_template
  );
  claimPattern.properties.falsifying_proposition_template =
    buildPropositionTemplateSchema(
      claimPattern.properties.falsifying_proposition_template
    );
  const expression = schema.$defs.satisfaction_expression;
  const anyOfBranch = expression.oneOf.find((branch) => branch.properties?.any_of);
  anyOfBranch.properties.branch_cardinality = {
    type: "string",
    enum: ["exactly_one"]
  };
  return schema;
}

function buildEvaluationInputSchemaV034() {
  const schema = structuredClone(VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA);
  schema.title = EVALUATION_INPUT_VERSION_V034;
  schema.properties.input_version.enum = [EVALUATION_INPUT_VERSION_V034];
  schema.properties.reference_bindings.items.properties.reference_ids.items =
    structuredClone(NATIVE_CONTRACT_SCHEMA_V034.$defs.reference_id);
  schema.properties.reference_bindings.items.properties.reference_ids.minItems = 0;
  schema.properties.claim_pattern_bindings.items.properties.claim_id =
    structuredClone(NATIVE_CONTRACT_SCHEMA_V034.$defs.claim_id);
  schema.properties.resolver_facts.items.properties.argument_reference_ids.items =
    structuredClone(NATIVE_CONTRACT_SCHEMA_V034.$defs.reference_id);
  schema.properties.delivered_evidence.items.properties.verification_claim_id =
    structuredClone(NATIVE_CONTRACT_SCHEMA_V034.$defs.claim_id);
  return schema;
}

function buildResultSchemaV034() {
  const schema = structuredClone(VERIFICATION_PROFILE_RESULT_SCHEMA);
  schema.title = RESULT_VERSION_V034;
  schema.required.push("contract", "vocabulary", "admission");
  schema.properties.result_version.enum = [RESULT_VERSION_V034];
  schema.properties.contract = {
    type: "object",
    required: ["schema_version"],
    additionalProperties: false,
    properties: {
      schema_version: { type: "string", enum: [SCHEMA_VERSION_V034] }
    }
  };
  schema.properties.vocabulary = {
    type: "object",
    required: [
      "version", "signature_digest", "algebra_digest", "definitions_digest",
      "complete_digest"
    ],
    additionalProperties: false,
    properties: {
      version: { type: "string", enum: [VOCABULARY_VERSION_V034] },
      signature_digest: { type: "string", enum: [VOCABULARY_DIGESTS.signature] },
      algebra_digest: { type: "string", enum: [VOCABULARY_DIGESTS.algebra] },
      definitions_digest: { type: "string", enum: [VOCABULARY_DIGESTS.definitions] },
      complete_digest: { type: "string", enum: [VOCABULARY_DIGESTS.complete] }
    }
  };
  schema.properties.admission = {
    type: "object",
    required: ["kind", "profile_digest", "adequacy_attested"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["unadmitted_direct"] },
      profile_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      adequacy_attested: { type: "boolean", enum: [false] }
    }
  };
  schema.properties.pattern_results.items.properties.pattern_kind.enum.push(
    "binding_constraint"
  );
  return schema;
}

const VERIFICATION_PROFILE_SCHEMA_V034 = buildVerificationProfileSchemaV034();
const VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034 =
  buildEvaluationInputSchemaV034();
const VERIFICATION_PROFILE_RESULT_SCHEMA_V034 = buildResultSchemaV034();

const {
  validateProfileSchemaV034,
  validateEvaluationInputSchemaV034,
  validateResultSchemaV034
} = await compiledValidators("controlled-contract.verification-profile.v034", {
  validators: {
    validateProfileSchemaV034: VERIFICATION_PROFILE_SCHEMA_V034,
    validateEvaluationInputSchemaV034: VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034,
    validateResultSchemaV034: VERIFICATION_PROFILE_RESULT_SCHEMA_V034
  }
});


function profileDigestV034(profile) {
  return profileDigest(profile);
}

function enrichResultV034(result, profile) {
  const enriched = {
    ...result,
    result_version: RESULT_VERSION_V034,
    contract: { schema_version: SCHEMA_VERSION_V034 },
    admission: {
      kind: "unadmitted_direct",
      profile_digest: profileDigestV034(profile),
      adequacy_attested: false
    },
    vocabulary: {
      version: VOCABULARY_VERSION_V034,
      signature_digest: VOCABULARY_DIGESTS.signature,
      algebra_digest: VOCABULARY_DIGESTS.algebra,
      definitions_digest: VOCABULARY_DIGESTS.definitions,
      complete_digest: VOCABULARY_DIGESTS.complete
    }
  };
  if (!validateResultSchemaV034(enriched)) throw new Error(
    `v0.34 verification profile evaluator emitted an invalid result: ${JSON.stringify(validateResultSchemaV034.errors)}`
  );
  return enriched;
}

function evaluateVerificationProfileV034(payload, { graphSelectionSink = null } = {}) {
  const result = evaluateVerificationProfileWithRuntime(payload, {
    graphSelectionSink,
    validateProfile: validateProfileSchemaV034,
    validateProfileSemanticsForRuntime: validateProfileSemanticsV034,
    validateEvaluationInput: validateEvaluationInputSchemaV034,
    validateContract: validateAndResolveNativeContractV034,
    purposeMatchedCollectionsAreCandidates: true,
    completePopulationBindingEvaluator: evaluateCompletePopulationBinding,
    referencesEquivalent: (contract, left, right, applicabilityContext) =>
      referencesEquivalent(contract, left, right, applicabilityContext),
    normalizeReference: (contract, referenceId, applicabilityContext) =>
      buildScopedEquality(contract, applicabilityContext).canonicalize(referenceId),
    allowIteratedRelations: true,
    allowIteratedCollections: true,
    allowBindingPresenceConstraints: true,
    globalRequiredBindingsAffectSatisfaction: true,
    validateRuntimeResult: () => true
  });
  return enrichResultV034(result, payload.profile);
}

export {
  EVALUATION_INPUT_VERSION_V034,
  PROFILE_SCHEMA_VERSION_V034,
  RESULT_VERSION_V034,
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034,
  VERIFICATION_PROFILE_RESULT_SCHEMA_V034,
  VERIFICATION_PROFILE_SCHEMA_V034,
  buildEvaluationInputSchemaV034,
  buildResultSchemaV034,
  buildVerificationProfileSchemaV034,
  evaluateVerificationProfileV034,
  profileDigestV034,
  validateProfileSchemaV034,
  validateProfileSemanticsV034
};
