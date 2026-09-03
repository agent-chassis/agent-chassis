import { compiledValidators } from "./compiled-validator-cache.mjs";
import {
  NATIVE_CONTRACT_SCHEMA,
  controlledOppositeOperator,
  operatorsByValueKind,
  validateAndResolveNativeContract
} from "./native-contract-carrier.mjs";
import {
  evaluateVerificationProfileWithRuntime as evaluateFamilyNeutralVerificationProfile
} from "./verification-profile-runtime.mjs";
import {
  validateProfileSemantics as validateFamilyNeutralProfileSemantics
} from "./verification-profile-semantics.mjs";

const PROFILE_SCHEMA_VERSION =
  "controlled-contract-verification-profile.experimental.v0.1";
const EVALUATION_INPUT_VERSION =
  "controlled-contract-verification-profile-input.experimental.v0.1";
const RESULT_VERSION =
  "controlled-contract-verification-profile-result.experimental.v0.1";
const EVALUATION_STAGES = Object.freeze(["pre_dispatch", "post_delivery"]);
const STAGE_RANK = Object.freeze({ pre_dispatch: 0, post_delivery: 1 });
const typeTerms = NATIVE_CONTRACT_SCHEMA.$defs.reference.properties.type_term.enum;
const verificationMethods =
  NATIVE_CONTRACT_SCHEMA.$defs.verification_claim.properties.verification_method.enum;
const relationRoles = NATIVE_CONTRACT_SCHEMA.$defs.relation.properties.role.enum;
const collectionKinds =
  NATIVE_CONTRACT_SCHEMA.$defs.collection.properties.collection_kind.enum;

const roleSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]*$"
};
const patternIdSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"
};
const claimIdSchema = NATIVE_CONTRACT_SCHEMA.$defs.claim_id;
const referenceIdSchema = NATIVE_CONTRACT_SCHEMA.$defs.reference_id;

const templateOperandDefinitions = {
  template_reference_operand: {
    type: "object",
    required: ["kind", "role"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["reference"] },
      role: roleSchema
    }
  },
  template_boolean_operand: {
    type: "object",
    required: ["kind", "value"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["boolean"] },
      value: { type: "boolean" }
    }
  },
  template_number_operand: {
    oneOf: [
      {
        type: "object",
        required: ["kind", "value"],
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["number"] },
          value: { type: "number" }
        }
      },
      {
        type: "object",
        required: ["kind", "value_role"],
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["number"] },
          value_role: roleSchema
        }
      }
    ]
  },
  template_range_operand: {
    type: "object",
    required: ["kind"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["range"] },
      minimum: { type: "number" },
      maximum: { type: "number" }
    },
    anyOf: [
      { required: ["minimum"], properties: { minimum: { type: "number" } } },
      { required: ["maximum"], properties: { maximum: { type: "number" } } }
    ]
  }
};

const templateBranches = Object.entries(operatorsByValueKind).map(
  ([valueKind, operators]) => ({
    properties: {
      operator: { type: "string", enum: operators },
      operands: {
        type: "array",
        minItems: 1,
        ...(valueKind === "range" ? { maxItems: 1 } : {}),
        items: { $ref: `#/$defs/template_${valueKind}_operand` }
      }
    }
  })
);

const propositionTemplateSchema = {
  type: "object",
  required: ["subject_role", "operator", "applicability_context", "operands"],
  additionalProperties: false,
  properties: {
    subject_role: roleSchema,
    operator: {
      type: "string",
      enum: Object.values(operatorsByValueKind).flat()
    },
    applicability_context: {
      type: "object",
      required: ["mode", "operand_roles"],
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: [
            "unconditional", "if", "unless", "when", "while", "where",
            "before", "after", "during", "until", "frozen_base",
            "counterfactual"
          ]
        },
        operand_roles: { type: "array", items: roleSchema }
      }
    },
    operands: { type: "array", minItems: 1 }
  },
  anyOf: templateBranches
};

const claimPatternSchema = {
  type: "object",
  required: [
    "pattern_id", "required_by_stage", "claim_kind", "allowed_modalities",
    "proposition_template"
  ],
  additionalProperties: false,
  properties: {
    pattern_id: patternIdSchema,
    required_by_stage: { type: "string", enum: EVALUATION_STAGES },
    claim_kind: { type: "string", enum: ["behavior", "evidence", "verification"] },
    allowed_modalities: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: {
        type: "string",
        enum: ["MUST", "MUST_NOT", "SHOULD", "SHOULD_NOT", "MAY"]
      }
    },
    proposition_template: propositionTemplateSchema,
    verification_methods: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: verificationMethods }
    },
    falsifying_proposition_template: propositionTemplateSchema
  },
  allOf: [
    {
      if: {
        required: ["claim_kind"],
        properties: { claim_kind: { const: "verification" } }
      },
      then: {
        required: ["verification_methods", "falsifying_proposition_template"],
        properties: {
          verification_methods: true,
          falsifying_proposition_template: true
        }
      },
      else: {
        not: {
          anyOf: [
            {
              required: ["verification_methods"],
              properties: { verification_methods: true }
            },
            {
              required: ["falsifying_proposition_template"],
              properties: { falsifying_proposition_template: true }
            }
          ]
        }
      }
    }
  ]
};

const relationPatternSchema = {
  type: "object",
  required: [
    "pattern_id", "required_by_stage", "role", "source_claim_pattern_id",
    "target_claim_pattern_id"
  ],
  additionalProperties: false,
  properties: {
    pattern_id: patternIdSchema,
    required_by_stage: { type: "string", enum: EVALUATION_STAGES },
    role: { type: "string", enum: relationRoles },
    source_claim_pattern_id: patternIdSchema,
    target_claim_pattern_id: patternIdSchema
  }
};

const collectionPatternSchema = {
  type: "object",
  required: [
    "pattern_id", "required_by_stage", "collection_kind",
    "member_claim_pattern_ids"
  ],
  additionalProperties: false,
  properties: {
    pattern_id: patternIdSchema,
    required_by_stage: { type: "string", enum: EVALUATION_STAGES },
    collection_kind: { type: "string", enum: collectionKinds },
    match_mode: {
      type: "string",
      enum: ["exact", "subsequence", "contiguous_subsequence"]
    },
    candidate_quantifier: {
      type: "string",
      enum: ["any", "all_covering"]
    },
    collection_purpose: {
      type: "string",
      pattern: "^[a-z][a-z0-9_]*$"
    },
    member_claim_pattern_ids: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: patternIdSchema
    }
  }
};

const resolverFactPatternSchema = {
  type: "object",
  required: [
    "pattern_id", "required_by_stage", "resolver_kind", "fact_key",
    "argument_roles"
  ],
  additionalProperties: false,
  properties: {
    pattern_id: patternIdSchema,
    required_by_stage: { type: "string", enum: EVALUATION_STAGES },
    resolver_kind: patternIdSchema,
    fact_key: patternIdSchema,
    argument_roles: { type: "array", items: roleSchema }
  }
};

const evidencePatternSchema = {
  type: "object",
  required: [
    "pattern_id", "required_by_stage", "evidence_kind",
    "verification_claim_pattern_id"
  ],
  additionalProperties: false,
  properties: {
    pattern_id: patternIdSchema,
    required_by_stage: { type: "string", enum: ["post_delivery"] },
    evidence_kind: patternIdSchema,
    verification_claim_pattern_id: patternIdSchema
  }
};

const referenceBindingPatternSchema = {
  type: "object",
  required: ["pattern_id", "required_by_stage", "comparison", "roles"],
  additionalProperties: false,
  properties: {
    pattern_id: patternIdSchema,
    required_by_stage: { type: "string", enum: EVALUATION_STAGES },
    comparison: { type: "string", enum: ["same_reference", "distinct_references"] },
    roles: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      uniqueItems: true,
      items: roleSchema
    }
  }
};

const VERIFICATION_PROFILE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: PROFILE_SCHEMA_VERSION,
  description: "Free-tier, non-authoritative schema for versioned deterministic proof-pack patterns over a native controlled contract. Profiles are data and cannot contain executable code or prose predicates.",
  type: "object",
  required: [
    "schema_version", "profile_id", "profile_version", "evaluation_stages",
    "reference_roles", "claim_patterns", "relation_patterns",
    "collection_patterns", "resolver_fact_patterns", "evidence_patterns",
    "satisfaction_expression"
  ],
  additionalProperties: false,
  properties: {
    schema_version: { type: "string", enum: [PROFILE_SCHEMA_VERSION] },
    profile_id: { type: "string", pattern: "^[a-z][a-z0-9.-]+$" },
    profile_version: {
      type: "string",
      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$"
    },
    verification_falsifier_policy: {
      type: "string",
      enum: ["controlled_complement_per_target"]
    },
    evaluation_stages: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: EVALUATION_STAGES }
    },
    reference_roles: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "allowed_type_terms", "cardinality"],
        additionalProperties: false,
        properties: {
          role: roleSchema,
          allowed_type_terms: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", enum: typeTerms }
          },
          cardinality: {
            type: "string",
            enum: ["exactly_one", "one_or_more", "zero_or_one"]
          }
        }
      }
    },
    number_roles: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "cardinality"],
        additionalProperties: false,
        properties: {
          role: roleSchema,
          cardinality: {
            type: "string",
            enum: ["exactly_one", "zero_or_one"]
          },
          number_type: { type: "string", enum: ["number", "integer"] },
          minimum: { type: "number" },
          maximum: { type: "number" }
        }
      }
    },
    distinct_reference_role_sets: {
      type: "array",
      items: {
        type: "object",
        required: ["roles"],
        additionalProperties: false,
        properties: {
          roles: {
            type: "array",
            minItems: 2,
            uniqueItems: true,
            items: roleSchema
          }
        }
      }
    },
    reference_binding_patterns: {
      type: "array",
      items: referenceBindingPatternSchema
    },
    claim_patterns: { type: "array", items: claimPatternSchema },
    relation_patterns: { type: "array", items: relationPatternSchema },
    collection_patterns: { type: "array", items: collectionPatternSchema },
    resolver_fact_patterns: { type: "array", items: resolverFactPatternSchema },
    evidence_patterns: { type: "array", items: evidencePatternSchema },
    satisfaction_expression: { $ref: "#/$defs/satisfaction_expression" }
  },
  $defs: {
    ...templateOperandDefinitions,
    satisfaction_expression: {
      oneOf: [
        {
          type: "object",
          required: ["pattern"],
          additionalProperties: false,
          properties: { pattern: patternIdSchema }
        },
        {
          type: "object",
          required: ["all_of"],
          additionalProperties: false,
          properties: {
            all_of: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/satisfaction_expression" }
            }
          }
        },
        {
          type: "object",
          required: ["any_of"],
          additionalProperties: false,
          properties: {
            any_of: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/satisfaction_expression" }
            }
          }
        }
      ]
    }
  }
};

const VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: EVALUATION_INPUT_VERSION,
  type: "object",
  required: [
    "input_version", "evaluation_stage", "reference_bindings",
    "claim_pattern_bindings", "resolver_facts", "delivered_evidence"
  ],
  additionalProperties: false,
  properties: {
    input_version: { type: "string", enum: [EVALUATION_INPUT_VERSION] },
    evaluation_stage: { type: "string", enum: EVALUATION_STAGES },
    reference_bindings: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "reference_ids"],
        additionalProperties: false,
        properties: {
          role: roleSchema,
          reference_ids: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: referenceIdSchema
          }
        }
      }
    },
    number_bindings: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "value"],
        additionalProperties: false,
        properties: {
          role: roleSchema,
          value: { type: "number" }
        }
      }
    },
    claim_pattern_bindings: {
      type: "array",
      items: {
        type: "object",
        required: ["pattern_id", "claim_id"],
        additionalProperties: false,
        properties: {
          pattern_id: patternIdSchema,
          claim_id: claimIdSchema
        }
      }
    },
    resolver_facts: {
      type: "array",
      items: {
        type: "object",
        required: [
          "resolver_kind", "fact_key", "argument_reference_ids", "satisfied"
        ],
        additionalProperties: false,
        properties: {
          resolver_kind: patternIdSchema,
          fact_key: patternIdSchema,
          argument_reference_ids: {
            type: "array",
            items: referenceIdSchema
          },
          satisfied: { type: "boolean" }
        }
      }
    },
    delivered_evidence: {
      type: "array",
      items: {
        type: "object",
        required: ["evidence_kind", "verification_claim_id", "satisfied"],
        additionalProperties: false,
        properties: {
          evidence_kind: patternIdSchema,
          verification_claim_id: claimIdSchema,
          satisfied: { type: "boolean" }
        }
      }
    }
  }
};

const VERIFICATION_PROFILE_RESULT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: RESULT_VERSION,
  type: "object",
  required: [
    "result_version", "authority", "profile", "evaluation_stage",
    "profile_valid", "input_valid", "contract_valid", "satisfaction",
    "satisfaction_trace", "pattern_results", "binding_analysis",
    "ambiguity_analysis", "diagnostics"
  ],
  additionalProperties: false,
  properties: {
    result_version: { type: "string", enum: [RESULT_VERSION] },
    authority: {
      type: "object",
      required: ["kind", "authoritative"],
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["free_tier_local"] },
        authoritative: { type: "boolean", enum: [false] }
      }
    },
    profile: {
      type: "object",
      required: ["profile_id", "profile_version"],
      additionalProperties: false,
      properties: {
        profile_id: { type: ["string", "null"] },
        profile_version: { type: ["string", "null"] }
      }
    },
    evaluation_stage: { type: ["string", "null"] },
    profile_valid: { type: "boolean" },
    input_valid: { type: "boolean" },
    contract_valid: { type: "boolean" },
    satisfaction: {
      type: "string",
      enum: ["satisfied", "unsatisfied", "indeterminate", "invalid"]
    },
    satisfaction_trace: {
      oneOf: [
        { type: "null" },
        { $ref: "#/$defs/satisfaction_trace" }
      ]
    },
    pattern_results: {
      type: "array",
      items: {
        type: "object",
        required: ["pattern_id", "pattern_kind", "status", "matched_ids"],
        additionalProperties: false,
        properties: {
          pattern_id: patternIdSchema,
          pattern_kind: {
            type: "string",
            enum: [
              "reference_binding", "claim", "relation", "collection",
              "resolver_fact", "evidence"
            ]
          },
          status: {
            type: "string",
            enum: ["satisfied", "unsatisfied", "indeterminate", "inactive"]
          },
          matched_ids: { type: "array", items: { type: "string" } }
        }
      }
    },
    binding_analysis: {
      type: "object",
      required: [
        "unbound_reference_roles", "unbound_number_roles",
        "reference_roles_without_eligible_candidates",
        "directly_blocked_pattern_ids", "direct_binding_blockers",
        "reference_binding_blockers",
        "downstream_blocked_pattern_ids"
      ],
      additionalProperties: false,
      properties: {
        unbound_reference_roles: { type: "array", items: roleSchema },
        unbound_number_roles: { type: "array", items: roleSchema },
        reference_roles_without_eligible_candidates: {
          type: "array",
          items: roleSchema
        },
        directly_blocked_pattern_ids: { type: "array", items: patternIdSchema },
        direct_binding_blockers: {
          type: "array",
          items: {
            type: "object",
            required: [
              "pattern_id", "proposition_reference_roles",
              "proposition_number_roles", "falsifier_reference_roles",
              "falsifier_number_roles"
            ],
            additionalProperties: false,
            properties: {
              pattern_id: patternIdSchema,
              proposition_reference_roles: { type: "array", items: roleSchema },
              proposition_number_roles: { type: "array", items: roleSchema },
              falsifier_reference_roles: { type: "array", items: roleSchema },
              falsifier_number_roles: { type: "array", items: roleSchema }
            }
          }
        },
        reference_binding_blockers: {
          type: "array",
          items: {
            type: "object",
            required: ["pattern_id", "reference_roles"],
            additionalProperties: false,
            properties: {
              pattern_id: patternIdSchema,
              reference_roles: { type: "array", items: roleSchema }
            }
          }
        },
        downstream_blocked_pattern_ids: { type: "array", items: patternIdSchema }
      }
    },
    ambiguity_analysis: {
      type: "object",
      required: [
        "directly_ambiguous_pattern_ids",
        "downstream_ambiguous_pattern_ids"
      ],
      additionalProperties: false,
      properties: {
        directly_ambiguous_pattern_ids: {
          type: "array",
          items: patternIdSchema
        },
        downstream_ambiguous_pattern_ids: {
          type: "array",
          items: patternIdSchema
        }
      }
    },
    diagnostics: {
      type: "array",
      items: {
        type: "object",
        required: ["code"],
        properties: { code: { type: "string" } },
        additionalProperties: true
      }
    }
  },
  $defs: {
    satisfaction_trace: {
      oneOf: [
        {
          type: "object",
          required: ["kind", "status", "pattern_id", "pattern_status"],
          additionalProperties: false,
          properties: {
            kind: { const: "pattern" },
            status: {
              type: "string",
              enum: ["satisfied", "unsatisfied", "indeterminate"]
            },
            pattern_id: patternIdSchema,
            pattern_status: {
              type: "string",
              enum: ["satisfied", "unsatisfied", "indeterminate", "inactive"]
            }
          }
        },
        {
          type: "object",
          required: ["kind", "status", "children"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["all_of", "any_of"] },
            status: {
              type: "string",
              enum: ["satisfied", "unsatisfied", "indeterminate"]
            },
            children: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/satisfaction_trace" }
            }
          }
        }
      ]
    }
  }
};

const {
  validateProfileSchema,
  validateEvaluationInputSchema,
  validateResultSchema
} = await compiledValidators("controlled-contract.verification-profile.v001", {
  validators: {
    validateProfileSchema: VERIFICATION_PROFILE_SCHEMA,
    validateEvaluationInputSchema: VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA,
    validateResultSchema: VERIFICATION_PROFILE_RESULT_SCHEMA
  }
});


function evaluateVerificationProfile(payload) {
  return evaluateVerificationProfileWithRuntime(payload);
}

function validateProfileSemantics(profile, options = {}) {
  return validateFamilyNeutralProfileSemantics(profile, {
    controlledOppositeOperatorForRuntime: controlledOppositeOperator,
    ...options
  });
}

function evaluateVerificationProfileWithRuntime(payload, options = {}) {
  return evaluateFamilyNeutralVerificationProfile(payload, {
    resultVersion: RESULT_VERSION,
    validateProfile: validateProfileSchema,
    validateProfileSemanticsForRuntime: validateProfileSemantics,
    validateEvaluationInput: validateEvaluationInputSchema,
    validateContract: validateAndResolveNativeContract,
    validateRuntimeResult: validateResultSchema,
    ...options
  });
}

export {
  EVALUATION_INPUT_VERSION,
  EVALUATION_STAGES,
  PROFILE_SCHEMA_VERSION,
  RESULT_VERSION,
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA,
  VERIFICATION_PROFILE_RESULT_SCHEMA,
  VERIFICATION_PROFILE_SCHEMA,
  evaluateVerificationProfile,
  evaluateVerificationProfileWithRuntime,
  validateProfileSemantics
};
