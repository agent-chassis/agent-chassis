import Ajv2020 from "ajv/dist/2020.js";

import {
  NATIVE_CONTRACT_SCHEMA,
  controlledOppositeOperator,
  operatorsByValueKind,
  validateAndResolveNativeContract
} from "./native-contract-carrier.mjs";

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

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateProfileSchema = ajv.compile(VERIFICATION_PROFILE_SCHEMA);
const validateEvaluationInputSchema = ajv.compile(
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA
);
const validateResultSchema = ajv.compile(VERIFICATION_PROFILE_RESULT_SCHEMA);

function compareIds(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  if (leftString < rightString) return -1;
  if (leftString > rightString) return 1;
  return 0;
}

function duplicates(values) {
  const seen = new Set();
  const duplicateSet = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicateSet.add(value);
    seen.add(value);
  }
  return [...duplicateSet].sort(compareIds);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonical(value) {
  return JSON.stringify(canonicalValue(value));
}

function compareDiagnostics(left, right) {
  return compareIds(left.code, right.code) || compareIds(canonical(left), canonical(right));
}

function allProfilePatterns(profile) {
  return [
    ...(profile.reference_binding_patterns ?? []).map((pattern) => ({
      ...pattern,
      pattern_kind: "reference_binding"
    })),
    ...profile.claim_patterns.map((pattern) => ({ ...pattern, pattern_kind: "claim" })),
    ...profile.relation_patterns.map((pattern) => ({ ...pattern, pattern_kind: "relation" })),
    ...profile.collection_patterns.map((pattern) => ({ ...pattern, pattern_kind: "collection" })),
    ...profile.resolver_fact_patterns.map((pattern) => ({
      ...pattern,
      pattern_kind: "resolver_fact"
    })),
    ...profile.evidence_patterns.map((pattern) => ({ ...pattern, pattern_kind: "evidence" }))
  ];
}

function expressionPatternIds(expression) {
  if (expression.pattern) return [expression.pattern];
  const children = expression.all_of ?? expression.any_of ?? [];
  return children.flatMap(expressionPatternIds);
}

function templateRoles(template) {
  return [
    template.subject_role,
    ...template.applicability_context.operand_roles,
    ...template.operands
      .filter(({ kind }) => kind === "reference")
      .map(({ role }) => role)
  ];
}

function templateNumberRoles(template) {
  return template.operands
    .filter(({ kind, value_role: valueRole }) => kind === "number" && valueRole)
    .map(({ value_role: valueRole }) => valueRole);
}

function validateProfileSemantics(profile) {
  const diagnostics = [];
  const roleIds = profile.reference_roles.map(({ role }) => role);
  for (const role of duplicates(roleIds)) diagnostics.push({
    code: "duplicate_profile_role",
    role
  });
  const roleSet = new Set(roleIds);
  const roleById = new Map(profile.reference_roles.map((role) => [role.role, role]));
  const numberRoleIds = (profile.number_roles ?? []).map(({ role }) => role);
  for (const role of duplicates(numberRoleIds)) diagnostics.push({
    code: "duplicate_profile_number_role",
    role
  });
  const numberRoleSet = new Set(numberRoleIds);
  for (const role of roleIds.filter((value) => numberRoleSet.has(value))) diagnostics.push({
    code: "profile_role_kind_collision",
    role
  });
  const distinctRoleSets = profile.distinct_reference_role_sets ?? [];
  const distinctRoleSetKeys = distinctRoleSets.map(({ roles }) =>
    [...roles].sort(compareIds).join("\0")
  );
  for (const key of duplicates(distinctRoleSetKeys)) diagnostics.push({
    code: "duplicate_distinct_reference_role_set",
    roles: key.split("\0")
  });
  for (const { roles } of distinctRoleSets) {
    for (const role of roles.filter((value) => !roleSet.has(value))) diagnostics.push({
      code: "profile_distinct_reference_role_undefined",
      role
    });
    for (const role of roles) {
      const definition = roleById.get(role);
      if (definition && definition.cardinality !== "exactly_one") diagnostics.push({
        code: "profile_distinct_reference_role_cardinality_invalid",
        role,
        actual_cardinality: definition.cardinality
      });
    }
  }
  for (const pattern of profile.reference_binding_patterns ?? []) {
    for (const role of pattern.applicability_context?.operand_roles ?? []) {
      if (!roleById.has(role)) diagnostics.push({
        code: "profile_pattern_role_undefined",
        pattern_id: pattern.pattern_id,
        role
      });
    }
    for (const [roleIndex, role] of pattern.roles.entries()) {
      const definition = roleById.get(role);
      if (!definition) diagnostics.push({
        code: "profile_pattern_role_undefined",
        pattern_id: pattern.pattern_id,
        role
      });
      else if (pattern.comparison === "complete_population"
        ? (roleIndex === 0
          ? definition.cardinality !== "exactly_one"
          : !["one_or_more", "zero_or_more"].includes(definition.cardinality))
        : definition.cardinality !== "exactly_one") diagnostics.push({
        code: "profile_reference_binding_role_cardinality_invalid",
        pattern_id: pattern.pattern_id,
        role,
        actual_cardinality: definition.cardinality
      });
      if (pattern.comparison === "complete_population" && roleIndex === 0 &&
          definition && definition.allowed_type_terms.some((typeTerm) =>
            !["cc:population", "cc:scope"].includes(typeTerm)
          )) diagnostics.push({
        code: "profile_population_binding_role_type_invalid",
        pattern_id: pattern.pattern_id,
        role,
        allowed_type_terms: [...definition.allowed_type_terms].sort(compareIds)
      });
    }
    if (pattern.comparison === "complete_population" && pattern.roles[0] === pattern.roles[1]) {
      diagnostics.push({
        code: "profile_population_binding_roles_collapsed",
        pattern_id: pattern.pattern_id,
        role: pattern.roles[0]
      });
    }
  }
  const referenceRoleCountBindings = profile.reference_role_count_bindings ?? [];
  const referenceRoleCountBindingKeys = referenceRoleCountBindings.map(
    ({ reference_role: referenceRole, number_role: numberRole }) =>
      `${referenceRole}\0${numberRole}`
  );
  for (const key of duplicates(referenceRoleCountBindingKeys)) {
    const [referenceRole, numberRole] = key.split("\0");
    diagnostics.push({
      code: "duplicate_reference_role_count_binding",
      reference_role: referenceRole,
      number_role: numberRole
    });
  }
  for (const {
    reference_role: referenceRole,
    number_role: numberRole
  } of referenceRoleCountBindings) {
    const referenceDefinition = roleById.get(referenceRole);
    const numberDefinition = (profile.number_roles ?? []).find(
      ({ role }) => role === numberRole
    );
    if (!referenceDefinition) diagnostics.push({
      code: "profile_reference_role_count_binding_reference_role_undefined",
      reference_role: referenceRole,
      number_role: numberRole
    });
    else if (referenceDefinition.cardinality === "zero_or_one") diagnostics.push({
      code: "profile_reference_role_count_binding_cardinality_invalid",
      role_kind: "reference",
      role: referenceRole,
      actual_cardinality: referenceDefinition.cardinality
    });
    if (!numberDefinition) diagnostics.push({
      code: "profile_reference_role_count_binding_number_role_undefined",
      reference_role: referenceRole,
      number_role: numberRole
    });
    else {
      if (numberDefinition.cardinality !== "exactly_one") diagnostics.push({
        code: "profile_reference_role_count_binding_cardinality_invalid",
        role_kind: "number",
        role: numberRole,
        actual_cardinality: numberDefinition.cardinality
      });
      if (numberDefinition.number_type !== "integer") diagnostics.push({
        code: "profile_reference_role_count_binding_number_type_invalid",
        role: numberRole,
        actual_number_type: numberDefinition.number_type ?? "number"
      });
    }
  }
  const patterns = allProfilePatterns(profile);
  const patternIds = patterns.map(({ pattern_id }) => pattern_id);
  for (const patternId of duplicates(patternIds)) diagnostics.push({
    code: "duplicate_profile_pattern_id",
    pattern_id: patternId
  });
  const patternById = new Map(patterns.map((pattern) => [pattern.pattern_id, pattern]));
  const claimPatternById = new Map(
    profile.claim_patterns.map((pattern) => [pattern.pattern_id, pattern])
  );

  for (const pattern of patterns) {
    if (!profile.evaluation_stages.includes(pattern.required_by_stage)) diagnostics.push({
      code: "profile_pattern_stage_unreachable",
      pattern_id: pattern.pattern_id,
      required_by_stage: pattern.required_by_stage
    });
  }

  for (const pattern of profile.claim_patterns) {
    const iteration = pattern.for_each;
    const localMemberRole = iteration?.member_role;
    if (iteration) {
      const populationRole = roleById.get(iteration.population_role);
      if (!populationRole) diagnostics.push({
        code: "profile_for_each_population_role_undefined",
        pattern_id: pattern.pattern_id,
        role: iteration.population_role
      });
      else if (populationRole.cardinality !== "one_or_more") diagnostics.push({
        code: "profile_for_each_population_role_cardinality_invalid",
        pattern_id: pattern.pattern_id,
        role: iteration.population_role,
        actual_cardinality: populationRole.cardinality
      });
      if (roleSet.has(localMemberRole) || numberRoleSet.has(localMemberRole)) diagnostics.push({
        code: "profile_for_each_member_role_not_local",
        pattern_id: pattern.pattern_id,
        role: localMemberRole
      });
      const templateRoleSet = new Set([
        ...templateRoles(pattern.proposition_template),
        ...(pattern.falsifying_proposition_template
          ? templateRoles(pattern.falsifying_proposition_template)
          : [])
      ]);
      if (!templateRoleSet.has(localMemberRole)) diagnostics.push({
        code: "profile_for_each_member_role_unused",
        pattern_id: pattern.pattern_id,
        role: localMemberRole
      });
    }
    const roles = [
      ...templateRoles(pattern.proposition_template),
      ...(pattern.falsifying_proposition_template
        ? templateRoles(pattern.falsifying_proposition_template)
        : [])
    ];
    for (const role of [...new Set(roles)].filter((value) =>
      !roleSet.has(value) && value !== localMemberRole
    )) {
      diagnostics.push({
        code: "profile_pattern_role_undefined",
        pattern_id: pattern.pattern_id,
        role
      });
    }
    const numberRoles = [
      ...templateNumberRoles(pattern.proposition_template),
      ...(pattern.falsifying_proposition_template
        ? templateNumberRoles(pattern.falsifying_proposition_template)
        : [])
    ];
    for (const role of [...new Set(numberRoles)].filter(
      (value) => !numberRoleSet.has(value)
    )) diagnostics.push({
      code: "profile_pattern_number_role_undefined",
      pattern_id: pattern.pattern_id,
      role
    });
    for (const template of [
      pattern.proposition_template,
      pattern.falsifying_proposition_template
    ].filter(Boolean)) {
      const subjectRole = template.subject_role === localMemberRole
        ? { cardinality: "exactly_one" }
        : roleById.get(template.subject_role);
      if (subjectRole && subjectRole.cardinality !== "exactly_one") diagnostics.push({
        code: "profile_subject_role_cardinality_invalid",
        pattern_id: pattern.pattern_id,
        role: template.subject_role,
        actual_cardinality: subjectRole.cardinality
      });
    }
  }
  for (const pattern of profile.relation_patterns) {
    for (const [field, endpoint] of [
      ["source_claim_pattern_id", pattern.source_claim_pattern_id],
      ["target_claim_pattern_id", pattern.target_claim_pattern_id]
    ]) {
      if (!claimPatternById.has(endpoint)) diagnostics.push({
        code: "profile_relation_endpoint_undefined",
        pattern_id: pattern.pattern_id,
        field,
        claim_pattern_id: endpoint
      });
      else if (claimPatternById.get(endpoint).for_each) diagnostics.push({
        code: "profile_relation_endpoint_iterated_claim_invalid",
        pattern_id: pattern.pattern_id,
        field,
        claim_pattern_id: endpoint
      });
    }
  }
  if (profile.verification_falsifier_policy ===
      "controlled_complement_per_target") {
    const verifiesPatterns = profile.relation_patterns.filter(
      ({ role }) => role === "verifies"
    );
    const targetedBehaviorPatternIds = new Set();
    const targetingVerificationPatternIds = new Set();
    for (const relation of verifiesPatterns) {
      const source = claimPatternById.get(relation.source_claim_pattern_id);
      const target = claimPatternById.get(relation.target_claim_pattern_id);
      if (!source || !target) continue;
      targetingVerificationPatternIds.add(source.pattern_id);
      targetedBehaviorPatternIds.add(target.pattern_id);
      const falsifier = source.falsifying_proposition_template;
      const targetTemplate = target.proposition_template;
      const reasons = [];
      if (source.claim_kind !== "verification") reasons.push(
        "source_is_not_verification"
      );
      if (target.claim_kind !== "behavior") reasons.push("target_is_not_behavior");
      if (!falsifier) reasons.push("source_has_no_falsifier");
      if (falsifier && controlledOppositeOperator(targetTemplate.operator) !==
          falsifier.operator) reasons.push("operator_is_not_controlled_complement");
      if (falsifier && falsifier.subject_role !== targetTemplate.subject_role) {
        reasons.push("subject_role_differs");
      }
      if (falsifier && canonical(falsifier.operands) !==
          canonical(targetTemplate.operands)) reasons.push("operands_differ");
      if (reasons.length > 0) diagnostics.push({
        code: "profile_verification_falsifier_not_complementary",
        pattern_id: relation.pattern_id,
        source_claim_pattern_id: relation.source_claim_pattern_id,
        target_claim_pattern_id: relation.target_claim_pattern_id,
        reasons
      });
    }
    for (const pattern of profile.claim_patterns) {
      if (pattern.claim_kind === "verification" &&
          !targetingVerificationPatternIds.has(pattern.pattern_id)) diagnostics.push({
        code: "profile_verification_pattern_without_target",
        pattern_id: pattern.pattern_id
      });
      if (pattern.claim_kind === "behavior" &&
          !targetedBehaviorPatternIds.has(pattern.pattern_id)) diagnostics.push({
        code: "profile_behavior_pattern_without_verification",
        pattern_id: pattern.pattern_id
      });
    }
  }
  for (const pattern of profile.collection_patterns) {
    if (pattern.collection_kind === "closed_set" &&
        pattern.match_mode && pattern.match_mode !== "exact") diagnostics.push({
      code: "profile_collection_match_mode_invalid",
      pattern_id: pattern.pattern_id,
      collection_kind: pattern.collection_kind,
      match_mode: pattern.match_mode
    });
    for (const member of pattern.member_claim_pattern_ids) {
      if (!claimPatternById.has(member)) diagnostics.push({
        code: "profile_collection_member_undefined",
        pattern_id: pattern.pattern_id,
        claim_pattern_id: member
      });
      else if (claimPatternById.get(member).for_each) diagnostics.push({
        code: "profile_collection_member_iterated_claim_invalid",
        pattern_id: pattern.pattern_id,
        claim_pattern_id: member
      });
    }
  }
  for (const role of profile.number_roles ?? []) {
    if (role.minimum !== undefined && role.maximum !== undefined &&
        role.minimum > role.maximum) diagnostics.push({
      code: "profile_number_role_range_invalid",
      role: role.role,
      minimum: role.minimum,
      maximum: role.maximum
    });
  }
  for (const pattern of profile.resolver_fact_patterns) {
    for (const role of pattern.argument_roles.filter((value) => !roleSet.has(value))) {
      diagnostics.push({
        code: "profile_pattern_role_undefined",
        pattern_id: pattern.pattern_id,
        role
      });
    }
  }
  for (const pattern of profile.evidence_patterns) {
    const target = claimPatternById.get(pattern.verification_claim_pattern_id);
    if (!target || target.claim_kind !== "verification") diagnostics.push({
      code: "profile_evidence_verification_pattern_invalid",
      pattern_id: pattern.pattern_id,
      claim_pattern_id: pattern.verification_claim_pattern_id
    });
    else if (target.for_each) diagnostics.push({
      code: "profile_evidence_iterated_claim_invalid",
      pattern_id: pattern.pattern_id,
      claim_pattern_id: pattern.verification_claim_pattern_id
    });
  }

  const expressionIds = expressionPatternIds(profile.satisfaction_expression);
  for (const patternId of expressionIds.filter((id) => !patternById.has(id))) {
    diagnostics.push({
      code: "satisfaction_pattern_undefined",
      pattern_id: patternId
    });
  }
  const expressionIdSet = new Set(expressionIds);
  for (const patternId of patternIds.filter((id) => !expressionIdSet.has(id))) {
    diagnostics.push({
      code: "profile_pattern_not_in_satisfaction_expression",
      pattern_id: patternId
    });
  }
  return diagnostics.sort(compareDiagnostics);
}

function invalidResult(profile, input, diagnostics, flags = {}) {
  const result = {
    result_version: RESULT_VERSION,
    authority: { kind: "free_tier_local", authoritative: false },
    profile: {
      profile_id: typeof profile?.profile_id === "string" ? profile.profile_id : null,
      profile_version: typeof profile?.profile_version === "string"
        ? profile.profile_version
        : null
    },
    evaluation_stage: EVALUATION_STAGES.includes(input?.evaluation_stage)
      ? input.evaluation_stage
      : null,
    profile_valid: flags.profile_valid ?? false,
    input_valid: flags.input_valid ?? false,
    contract_valid: flags.contract_valid ?? false,
    satisfaction: "invalid",
    satisfaction_trace: null,
    pattern_results: [],
    binding_analysis: {
      unbound_reference_roles: [],
      unbound_number_roles: [],
      reference_roles_without_eligible_candidates: [],
      directly_blocked_pattern_ids: [],
      direct_binding_blockers: [],
      reference_binding_blockers: [],
      downstream_blocked_pattern_ids: []
    },
    ambiguity_analysis: {
      directly_ambiguous_pattern_ids: [],
      downstream_ambiguous_pattern_ids: []
    },
    diagnostics
  };
  if (!validateResultSchema(result)) throw new Error(
    `verification profile evaluator emitted an invalid result: ${JSON.stringify(validateResultSchema.errors)}`
  );
  return result;
}

function buildReferenceBindings(profile, contract, input) {
  const diagnostics = [];
  const roleById = new Map(profile.reference_roles.map((entry) => [entry.role, entry]));
  const referenceById = new Map(
    contract.references.map((reference) => [reference.reference_id, reference])
  );
  const bindingByRole = new Map();
  for (const role of duplicates(input.reference_bindings.map(({ role }) => role))) {
    diagnostics.push({ code: "duplicate_reference_role_binding", role });
  }
  for (const binding of input.reference_bindings) {
    const role = roleById.get(binding.role);
    if (!role) {
      diagnostics.push({ code: "unknown_reference_role_binding", role: binding.role });
      continue;
    }
    const ids = [...binding.reference_ids].sort(compareIds);
    bindingByRole.set(binding.role, ids);
    if (role.cardinality === "exactly_one" && ids.length !== 1) diagnostics.push({
      code: "reference_role_cardinality_invalid",
      role: binding.role,
      expected: role.cardinality,
      actual: ids.length
    });
    if (role.cardinality === "one_or_more" && ids.length < 1) diagnostics.push({
      code: "reference_role_cardinality_invalid",
      role: binding.role,
      expected: role.cardinality,
      actual: ids.length
    });
    if (role.cardinality === "zero_or_one" && ids.length > 1) diagnostics.push({
      code: "reference_role_cardinality_invalid",
      role: binding.role,
      expected: role.cardinality,
      actual: ids.length
    });
    for (const referenceId of ids) {
      const reference = referenceById.get(referenceId);
      if (!reference) diagnostics.push({
        code: "reference_role_binding_dangling",
        role: binding.role,
        reference_id: referenceId
      });
      else {
        if (!role.allowed_type_terms.includes(reference.type_term)) diagnostics.push({
          code: "reference_role_binding_type_mismatch",
          role: binding.role,
          reference_id: referenceId,
          actual_type_term: reference.type_term,
          allowed_type_terms: [...role.allowed_type_terms]
        });
        if (role.allowed_identity_kinds &&
            !role.allowed_identity_kinds.includes(reference.identity.kind)) {
          diagnostics.push({
            code: "reference_role_binding_identity_kind_mismatch",
            role: binding.role,
            reference_id: referenceId,
            actual_identity_kind: reference.identity.kind,
            allowed_identity_kinds: [...role.allowed_identity_kinds]
          });
        }
      }
    }
  }
  const unboundRoles = profile.reference_roles
    .filter(({ role }) => !bindingByRole.has(role))
    .map(({ role }) => role)
    .sort(compareIds);
  const missingRoles = profile.reference_roles
    .filter(({ role, cardinality }) =>
      cardinality !== "zero_or_one" && !bindingByRole.has(role)
    )
    .map(({ role }) => role)
    .sort(compareIds);
  const rolesWithoutEligibleCandidates = profile.reference_roles
    .filter(({
      role,
      allowed_type_terms: allowedTypeTerms,
      allowed_identity_kinds: allowedIdentityKinds
    }) => {
      if (bindingByRole.has(role)) return false;
      const unavailableReferenceIds = new Set(
        (profile.distinct_reference_role_sets ?? [])
          .filter(({ roles }) => roles.includes(role))
          .flatMap(({ roles }) => roles
            .filter((peerRole) => peerRole !== role)
            .flatMap((peerRole) => bindingByRole.get(peerRole) ?? [])
          )
      );
      return !contract.references.some(({
        reference_id: referenceId,
        type_term: typeTerm,
        identity
      }) =>
        allowedTypeTerms.includes(typeTerm) &&
        (!allowedIdentityKinds || allowedIdentityKinds.includes(identity.kind)) &&
        !unavailableReferenceIds.has(referenceId)
      );
    })
    .map(({ role }) => role)
    .sort(compareIds);
  return {
    bindingByRole,
    diagnostics,
    missingRoles,
    unboundRoles,
    rolesWithoutEligibleCandidates
  };
}

function validateDistinctReferenceBindings(
  profile,
  bindingByRole,
  contract = null,
  referencesEquivalent = null
) {
  const diagnostics = [];
  for (const { roles } of profile.distinct_reference_role_sets ?? []) {
    const referenceIds = roles.map((role) => bindingByRole.get(role)?.[0]);
    if (referenceIds.some((referenceId) => !referenceId)) continue;
    const unconditional = { mode: "unconditional", operand_reference_ids: [] };
    const contextsByKey = new Map([[canonical(unconditional), unconditional]]);
    if (referencesEquivalent) {
      const completePopulationRoles = new Set(
        (profile.reference_binding_patterns ?? [])
          .filter(({ comparison }) => comparison === "complete_population")
          .map(({ roles: patternRoles }) => patternRoles[0])
      );
      if (roles.every((role) => completePopulationRoles.has(role))) {
        const addResolvedContext = ({ mode, operand_roles: operandRoles }) => {
          const operandReferenceIds = operandRoles.flatMap(
            (role) => bindingByRole.get(role) ?? []
          );
          const context = {
            mode,
            operand_reference_ids: [...new Set(operandReferenceIds)].sort(compareIds)
          };
          contextsByKey.set(canonical(context), context);
        };
        for (const pattern of profile.reference_binding_patterns ?? []) {
          if (pattern.comparison === "complete_population" &&
              roles.includes(pattern.roles[0])) {
            addResolvedContext(pattern.applicability_context);
          }
        }
        for (const pattern of profile.claim_patterns ?? []) {
          for (const template of [
            pattern.proposition_template,
            pattern.falsifying_proposition_template
          ].filter(Boolean)) {
            if (!["reference:subset_of", "reference:not_subset_of"].includes(
              template.operator
            )) continue;
            const populationRoles = [
              template.subject_role,
              ...template.operands
                .filter(({ kind }) => kind === "reference")
                .map(({ role }) => role)
            ];
            if (roles.every((role) => populationRoles.includes(role))) {
              addResolvedContext(template.applicability_context);
            }
          }
        }
      }
    }
    const collapsedContext = [...contextsByKey.entries()]
      .sort(([left], [right]) => compareIds(left, right))
      .map(([, context]) => context)
      .find((context) => referenceIds.some((referenceId, index) =>
        referenceIds.slice(0, index).some((prior) =>
          referencesEquivalent
            ? referencesEquivalent(contract, prior, referenceId, context)
            : prior === referenceId
        )
      ));
    if (collapsedContext) diagnostics.push({
      code: "distinct_reference_roles_collapsed",
      roles: [...roles].sort(compareIds),
      reference_ids: [...new Set(referenceIds)].sort(compareIds),
      equality_normalized: Boolean(referencesEquivalent),
      ...(canonical(collapsedContext) === canonical(unconditional)
        ? {}
        : { applicability_context: collapsedContext })
    });
  }
  return diagnostics;
}

function buildNumberBindings(profile, input) {
  const diagnostics = [];
  const roles = profile.number_roles ?? [];
  const bindings = input.number_bindings ?? [];
  const roleById = new Map(roles.map((entry) => [entry.role, entry]));
  const bindingByRole = new Map();
  for (const role of duplicates(bindings.map(({ role: roleId }) => roleId))) {
    diagnostics.push({ code: "duplicate_number_role_binding", role });
  }
  for (const binding of bindings) {
    const role = roleById.get(binding.role);
    if (!role) {
      diagnostics.push({ code: "unknown_number_role_binding", role: binding.role });
      continue;
    }
    bindingByRole.set(binding.role, binding.value);
    const reasons = [];
    if (role.number_type === "integer" && !Number.isInteger(binding.value)) {
      reasons.push("not_integer");
    }
    if (role.minimum !== undefined && binding.value < role.minimum) {
      reasons.push("below_minimum");
    }
    if (role.maximum !== undefined && binding.value > role.maximum) {
      reasons.push("above_maximum");
    }
    if (reasons.length > 0) diagnostics.push({
      code: "number_role_binding_value_invalid",
      role: binding.role,
      value: binding.value,
      reasons,
      ...(role.number_type ? { number_type: role.number_type } : {}),
      ...(role.minimum !== undefined ? { minimum: role.minimum } : {}),
      ...(role.maximum !== undefined ? { maximum: role.maximum } : {})
    });
  }
  const unboundRoles = roles
    .filter(({ role }) => !bindingByRole.has(role))
    .map(({ role }) => role)
    .sort(compareIds);
  const missingRoles = roles
    .filter(({ role, cardinality }) =>
      cardinality === "exactly_one" && !bindingByRole.has(role)
    )
    .map(({ role }) => role)
    .sort(compareIds);
  return { bindingByRole, diagnostics, missingRoles, unboundRoles };
}

function validateReferenceRoleCountBindings(
  profile,
  referenceBindingByRole,
  numberBindingByRole
) {
  const diagnostics = [];
  for (const {
    reference_role: referenceRole,
    number_role: numberRole
  } of profile.reference_role_count_bindings ?? []) {
    const referenceIds = referenceBindingByRole.get(referenceRole);
    const expectedCount = numberBindingByRole.get(numberRole);
    if (!referenceIds || expectedCount === undefined) continue;
    if (referenceIds.length !== expectedCount) diagnostics.push({
      code: "reference_role_count_binding_mismatch",
      reference_role: referenceRole,
      number_role: numberRole,
      reference_count: referenceIds.length,
      bound_number: expectedCount
    });
  }
  return diagnostics;
}

function resolveTemplate(template, bindingByRole, numberBindingByRole = new Map()) {
  const missingReferenceRoles = new Set();
  const missingNumberRoles = new Set();
  const roleValues = (role) => {
    const values = bindingByRole.get(role);
    if (!values || values.length === 0) missingReferenceRoles.add(role);
    return values ?? [];
  };
  const subjects = roleValues(template.subject_role);
  const proposition = {
    subject_reference_id: subjects.length === 1 ? subjects[0] : null,
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles
        .flatMap(roleValues)
    },
    operands: template.operands.flatMap((operand) => {
      if (operand.kind === "reference") return roleValues(operand.role).map(
        (referenceId) => ({ kind: "reference", reference_id: referenceId })
      );
      if (operand.kind === "number" && operand.value_role) {
        if (!numberBindingByRole.has(operand.value_role)) {
          missingNumberRoles.add(operand.value_role);
          return [];
        }
        return [{ kind: "number", value: numberBindingByRole.get(operand.value_role) }];
      }
      return [structuredClone(operand)];
    })
  };
  return {
    proposition,
    missing_reference_roles: [...missingReferenceRoles].sort(compareIds),
    missing_number_roles: [...missingNumberRoles].sort(compareIds)
  };
}

function propositionMatches(proposition, template) {
  const normalizeApplicability = (context) => ({
    mode: context.mode,
    operand_reference_ids: [...new Set(context.operand_reference_ids)].sort(compareIds)
  });
  const normalizeOperands = (operator, operands) => {
    if (operator === "reference:ordered_as") return operands;
    const byCanonicalValue = new Map();
    for (const operand of operands) byCanonicalValue.set(canonical(operand), operand);
    return [...byCanonicalValue]
      .sort(([left], [right]) => compareIds(left, right))
      .map(([, operand]) => operand);
  };
  return proposition?.subject_reference_id === template.subject_reference_id &&
    proposition.operator === template.operator &&
    canonical(normalizeApplicability(proposition.applicability_context)) ===
      canonical(normalizeApplicability(template.applicability_context)) &&
    canonical(normalizeOperands(proposition.operator, proposition.operands)) ===
      canonical(normalizeOperands(template.operator, template.operands));
}

function candidateClaimIds(contract, pattern, resolved, resolvedFalsifier, propositionById) {
  return contract.claims.filter((claim) => {
    if (claim.kind !== pattern.claim_kind) return false;
    if (!pattern.allowed_modalities.includes(claim.modality)) return false;
    if (!propositionMatches(
      propositionById.get(claim.proposition_id),
      resolved.proposition
    )) return false;
    if (pattern.claim_kind !== "verification") return true;
    return pattern.verification_methods.includes(claim.verification_method) &&
      propositionMatches(
        propositionById.get(claim.falsifying_proposition_id),
        resolvedFalsifier.proposition
      );
  }).map(({ claim_id: claimId }) => claimId).sort(compareIds);
}

function patternResult(pattern, status, matchedIds = []) {
  return {
    pattern_id: pattern.pattern_id,
    pattern_kind: pattern.pattern_kind,
    status,
    matched_ids: [...matchedIds].sort(compareIds)
  };
}

function activeAt(pattern, evaluationStage) {
  return STAGE_RANK[pattern.required_by_stage] <= STAGE_RANK[evaluationStage];
}

function unresolvedDependencyStatus(patternIds, resultsByPattern) {
  const statuses = patternIds.map((patternId) =>
    resultsByPattern.get(patternId)?.status ?? "indeterminate"
  );
  return statuses.includes("unsatisfied") ? "unsatisfied" : "indeterminate";
}

function isOrderedSubsequence(requiredMembers, actualMembers) {
  let requiredIndex = 0;
  for (const member of actualMembers) {
    if (member === requiredMembers[requiredIndex]) requiredIndex += 1;
    if (requiredIndex === requiredMembers.length) return true;
  }
  return requiredMembers.length === 0;
}

function isContiguousSubsequence(requiredMembers, actualMembers) {
  if (requiredMembers.length === 0) return true;
  if (requiredMembers.length > actualMembers.length) return false;
  return actualMembers.some((_, start) => canonical(
    actualMembers.slice(start, start + requiredMembers.length)
  ) === canonical(requiredMembers));
}

function evaluateExpressionTrace(expression, statusByPattern) {
  if (expression.pattern) {
    const patternStatus = statusByPattern.get(expression.pattern) ?? "indeterminate";
    const status = patternStatus === "inactive" ? "satisfied" : patternStatus;
    return {
      kind: "pattern",
      status,
      pattern_id: expression.pattern,
      pattern_status: patternStatus
    };
  }
  const key = expression.all_of ? "all_of" : "any_of";
  const children = expression[key].map((child) =>
    evaluateExpressionTrace(child, statusByPattern)
  );
  const results = children.map(({ status }) => status);
  let status;
  if (key === "all_of") {
    if (results.includes("unsatisfied")) status = "unsatisfied";
    else if (results.includes("indeterminate")) status = "indeterminate";
    else status = "satisfied";
  } else if (results.includes("satisfied")) {
    status = "satisfied";
  } else if (results.includes("indeterminate")) {
    status = "indeterminate";
  } else {
    status = "unsatisfied";
  }
  return { kind: key, status, children };
}

function evaluateVerificationProfileWithRuntime(
  { contract, profile, evaluation_input: input },
  {
    validateProfile = validateProfileSchema,
    validateProfileSemanticsForRuntime = validateProfileSemantics,
    validateEvaluationInput = validateEvaluationInputSchema,
    validateContract = validateAndResolveNativeContract,
    purposeMatchedCollectionsAreCandidates = false,
    completePopulationBindingEvaluator = null,
    referencesEquivalent = null
  } = {}
) {
  if (!validateProfile(profile)) return invalidResult(profile, input, [{
    code: "verification_profile_schema_invalid",
    errors: structuredClone(validateProfile.errors)
  }]);
  const profileDiagnostics = validateProfileSemanticsForRuntime(profile);
  if (profileDiagnostics.length > 0) return invalidResult(
    profile,
    input,
    profileDiagnostics,
    { profile_valid: false }
  );
  if (!validateEvaluationInput(input)) return invalidResult(profile, input, [{
    code: "verification_profile_input_schema_invalid",
    errors: structuredClone(validateEvaluationInput.errors)
  }], { profile_valid: true });
  if (!profile.evaluation_stages.includes(input.evaluation_stage)) return invalidResult(
    profile,
    input,
    [{ code: "profile_stage_not_supported", evaluation_stage: input.evaluation_stage }],
    { profile_valid: true, input_valid: true }
  );
  const contractEvaluation = validateContract(contract);
  if (!contractEvaluation.schema_valid || contractEvaluation.diagnostics.length > 0) {
    return invalidResult(profile, input, [{
      code: "controlled_contract_invalid",
      schema_errors: contractEvaluation.schema_errors,
      diagnostics: contractEvaluation.diagnostics
    }], { profile_valid: true, input_valid: true });
  }

  const claimPatternIds = new Set(
    profile.claim_patterns.map(({ pattern_id }) => pattern_id)
  );
  const iteratedClaimPatternIds = new Set(
    profile.claim_patterns.filter(({ for_each: forEach }) => forEach)
      .map(({ pattern_id: patternId }) => patternId)
  );
  const inputSemanticDiagnostics = [];
  for (const patternId of duplicates(
    input.claim_pattern_bindings.map(({ pattern_id }) => pattern_id)
  )) inputSemanticDiagnostics.push({
    code: "duplicate_claim_pattern_binding",
    pattern_id: patternId
  });
  for (const bindingEntry of input.claim_pattern_bindings) {
    if (!claimPatternIds.has(bindingEntry.pattern_id)) inputSemanticDiagnostics.push({
      code: "unknown_claim_pattern_binding",
      pattern_id: bindingEntry.pattern_id
    });
    else if (iteratedClaimPatternIds.has(bindingEntry.pattern_id)) {
      inputSemanticDiagnostics.push({
        code: "claim_pattern_binding_iterated_pattern_invalid",
        pattern_id: bindingEntry.pattern_id,
        claim_id: bindingEntry.claim_id
      });
    }
  }
  if (inputSemanticDiagnostics.length > 0) return invalidResult(
    profile,
    input,
    inputSemanticDiagnostics,
    { profile_valid: true, input_valid: false, contract_valid: true }
  );

  const binding = buildReferenceBindings(profile, contract, input);
  if (binding.diagnostics.length > 0) return invalidResult(
    profile,
    input,
    binding.diagnostics,
    { profile_valid: true, input_valid: true, contract_valid: true }
  );
  const distinctBindingDiagnostics = validateDistinctReferenceBindings(
    profile,
    binding.bindingByRole,
    contract,
    referencesEquivalent
  );
  if (distinctBindingDiagnostics.length > 0) return invalidResult(
    profile,
    input,
    distinctBindingDiagnostics,
    { profile_valid: true, input_valid: true, contract_valid: true }
  );
  const numberBinding = buildNumberBindings(profile, input);
  if (numberBinding.diagnostics.length > 0) return invalidResult(
    profile,
    input,
    numberBinding.diagnostics,
    { profile_valid: true, input_valid: true, contract_valid: true }
  );
  const referenceRoleCountDiagnostics = validateReferenceRoleCountBindings(
    profile,
    binding.bindingByRole,
    numberBinding.bindingByRole
  );
  if (referenceRoleCountDiagnostics.length > 0) return invalidResult(
    profile,
    input,
    referenceRoleCountDiagnostics,
    { profile_valid: true, input_valid: true, contract_valid: true }
  );

  const diagnostics = binding.missingRoles.map((role) => ({
    code: "required_reference_role_unbound",
    role
  }));
  diagnostics.push(...numberBinding.missingRoles.map((role) => ({
    code: "required_number_role_unbound",
    role
  })));
  const claimById = new Map(contract.claims.map((claim) => [claim.claim_id, claim]));
  const propositionById = new Map(
    contract.propositions.map((proposition) => [proposition.proposition_id, proposition])
  );
  const explicitBindings = new Map();
  for (const bindingEntry of input.claim_pattern_bindings) {
    explicitBindings.set(bindingEntry.pattern_id, bindingEntry.claim_id);
  }

  const resultsByPattern = new Map();
  const selectedClaimByPattern = new Map();
  const selectedIterationClaims = [];
  const directlyBlockedPatternIds = new Set();
  const directBindingBlockers = [];
  const referenceBindingBlockers = [];
  const downstreamBlockedPatternIds = new Set();
  const directlyAmbiguousPatternIds = new Set();
  const downstreamAmbiguousPatternIds = new Set();
  for (const originalPattern of profile.reference_binding_patterns ?? []) {
    const pattern = { ...originalPattern, pattern_kind: "reference_binding" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    const contextualRoles = pattern.applicability_context?.operand_roles ?? [];
    const missingRoles = [...new Set([...pattern.roles, ...contextualRoles])].filter((role) =>
      !binding.bindingByRole.has(role)
    );
    if (missingRoles.length > 0) {
      directlyBlockedPatternIds.add(pattern.pattern_id);
      referenceBindingBlockers.push({
        pattern_id: pattern.pattern_id,
        reference_roles: [...missingRoles].sort(compareIds)
      });
      const deterministicallyAbsent = missingRoles.some((role) =>
        binding.rolesWithoutEligibleCandidates.includes(role)
      );
      resultsByPattern.set(
        pattern.pattern_id,
        patternResult(pattern, deterministicallyAbsent ? "unsatisfied" : "indeterminate")
      );
      continue;
    }
    if (pattern.comparison === "complete_population") {
      const [populationRole, memberRole] = pattern.roles;
      const populationReferenceId = binding.bindingByRole.get(populationRole)[0];
      const memberReferenceIds = binding.bindingByRole.get(memberRole);
      const populationReference = contract.references.find(
        ({ reference_id: referenceId }) => referenceId === populationReferenceId
      );
      if (!populationReference || !["cc:population", "cc:scope"].includes(
        populationReference.type_term
      )) {
        directlyBlockedPatternIds.add(pattern.pattern_id);
        diagnostics.push({
          code: "population_binding_reference_type_invalid",
          pattern_id: pattern.pattern_id,
          population_reference_id: populationReferenceId,
          actual_type_term: populationReference?.type_term ?? null,
          allowed_type_terms: ["cc:population", "cc:scope"]
        });
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "unsatisfied"));
        continue;
      }
      if (!completePopulationBindingEvaluator) {
        directlyBlockedPatternIds.add(pattern.pattern_id);
        diagnostics.push({
          code: "complete_population_binding_evaluator_unavailable",
          pattern_id: pattern.pattern_id
        });
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate"));
        continue;
      }
      const populationEvaluation = completePopulationBindingEvaluator({
        contract,
        population_reference_id: populationReferenceId,
        member_reference_ids: memberReferenceIds,
        applicability_context: {
          mode: pattern.applicability_context.mode,
          operand_reference_ids: pattern.applicability_context.operand_roles.flatMap(
            (role) => binding.bindingByRole.get(role)
          )
        }
      });
      diagnostics.push(...populationEvaluation.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        pattern_id: pattern.pattern_id
      })));
      resultsByPattern.set(pattern.pattern_id, patternResult(
        pattern,
        populationEvaluation.satisfied ? "satisfied" : "unsatisfied",
        [populationReferenceId, ...populationEvaluation.normalized_member_reference_ids]
      ));
      continue;
    }
    const referenceIds = pattern.roles.map((role) =>
      binding.bindingByRole.get(role)[0]
    );
    const collapsed = referenceIds.some((referenceId, index) =>
      referenceIds.slice(0, index).some((prior) =>
        referencesEquivalent
          ? referencesEquivalent(
            contract,
            prior,
            referenceId,
            { mode: "unconditional", operand_reference_ids: [] }
          )
          : prior === referenceId
      )
    );
    const satisfied = pattern.comparison === "same_reference"
      ? collapsed
      : !collapsed;
    resultsByPattern.set(
      pattern.pattern_id,
      patternResult(
        pattern,
        satisfied ? "satisfied" : "unsatisfied",
        [...new Set(referenceIds)].sort(compareIds)
      )
    );
  }
  for (const originalPattern of profile.claim_patterns) {
    const pattern = { ...originalPattern, pattern_kind: "claim" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    if (pattern.for_each) {
      const populationMembers = binding.bindingByRole.get(
        pattern.for_each.population_role
      ) ?? [];
      if (populationMembers.length === 0) {
        directlyBlockedPatternIds.add(pattern.pattern_id);
        diagnostics.push({
          code: "for_each_population_empty_or_unbound",
          pattern_id: pattern.pattern_id,
          population_role: pattern.for_each.population_role
        });
        resultsByPattern.set(pattern.pattern_id, patternResult(
          pattern,
          binding.bindingByRole.has(pattern.for_each.population_role)
            ? "unsatisfied"
            : "indeterminate"
        ));
        continue;
      }
      const instanceResults = [];
      for (const memberReferenceId of [...populationMembers].sort(compareIds)) {
        const iterationBindings = new Map(binding.bindingByRole);
        iterationBindings.set(pattern.for_each.member_role, [memberReferenceId]);
        const resolved = resolveTemplate(
          pattern.proposition_template,
          iterationBindings,
          numberBinding.bindingByRole
        );
        const resolvedFalsifier = pattern.falsifying_proposition_template
          ? resolveTemplate(
            pattern.falsifying_proposition_template,
            iterationBindings,
            numberBinding.bindingByRole
          )
          : null;
        const missingReferenceRoles = [...new Set([
          ...resolved.missing_reference_roles,
          ...(resolvedFalsifier?.missing_reference_roles ?? [])
        ])].sort(compareIds);
        const missingNumberRoles = [...new Set([
          ...resolved.missing_number_roles,
          ...(resolvedFalsifier?.missing_number_roles ?? [])
        ])].sort(compareIds);
        if (missingReferenceRoles.length > 0 || missingNumberRoles.length > 0) {
          instanceResults.push({ member_reference_id: memberReferenceId, status: "indeterminate" });
          diagnostics.push({
            code: "for_each_instance_binding_incomplete",
            pattern_id: pattern.pattern_id,
            member_reference_id: memberReferenceId,
            missing_reference_roles: missingReferenceRoles,
            missing_number_roles: missingNumberRoles
          });
          continue;
        }
        const candidates = candidateClaimIds(
          contract,
          pattern,
          resolved,
          resolvedFalsifier,
          propositionById
        );
        if (candidates.length === 0) {
          instanceResults.push({ member_reference_id: memberReferenceId, status: "unsatisfied" });
          diagnostics.push({
            code: "for_each_instance_claim_missing",
            pattern_id: pattern.pattern_id,
            member_reference_id: memberReferenceId
          });
        } else if (candidates.length > 1) {
          instanceResults.push({ member_reference_id: memberReferenceId, status: "indeterminate" });
          directlyAmbiguousPatternIds.add(pattern.pattern_id);
          diagnostics.push({
            code: "for_each_instance_claim_ambiguous",
            pattern_id: pattern.pattern_id,
            member_reference_id: memberReferenceId,
            claim_ids: candidates
          });
        } else {
          instanceResults.push({
            member_reference_id: memberReferenceId,
            status: "satisfied",
            claim_id: candidates[0]
          });
          selectedIterationClaims.push({
            pattern_id: pattern.pattern_id,
            member_reference_id: memberReferenceId,
            claim_id: candidates[0]
          });
        }
      }
      const instanceStatuses = instanceResults.map(({ status }) => status);
      const status = instanceStatuses.includes("unsatisfied")
        ? "unsatisfied"
        : instanceStatuses.includes("indeterminate") ? "indeterminate" : "satisfied";
      resultsByPattern.set(pattern.pattern_id, patternResult(
        pattern,
        status,
        instanceResults.flatMap(({ claim_id: claimId }) => claimId ? [claimId] : [])
      ));
      diagnostics.push({
        code: "for_each_evaluation",
        pattern_id: pattern.pattern_id,
        population_role: pattern.for_each.population_role,
        member_role: pattern.for_each.member_role,
        instance_results: instanceResults
      });
      continue;
    }
    const resolved = resolveTemplate(
      pattern.proposition_template,
      binding.bindingByRole,
      numberBinding.bindingByRole
    );
    const resolvedFalsifier = pattern.falsifying_proposition_template
      ? resolveTemplate(
        pattern.falsifying_proposition_template,
        binding.bindingByRole,
        numberBinding.bindingByRole
      )
      : null;
    const missingReferenceRoles = [...new Set([
      ...resolved.missing_reference_roles,
      ...(resolvedFalsifier?.missing_reference_roles ?? [])
    ])].sort(compareIds);
    const missingNumberRoles = [...new Set([
      ...resolved.missing_number_roles,
      ...(resolvedFalsifier?.missing_number_roles ?? [])
    ])].sort(compareIds);
    if (missingReferenceRoles.length > 0 || missingNumberRoles.length > 0) {
      directlyBlockedPatternIds.add(pattern.pattern_id);
      directBindingBlockers.push({
        pattern_id: pattern.pattern_id,
        proposition_reference_roles: resolved.missing_reference_roles,
        proposition_number_roles: resolved.missing_number_roles,
        falsifier_reference_roles: resolvedFalsifier?.missing_reference_roles ?? [],
        falsifier_number_roles: resolvedFalsifier?.missing_number_roles ?? []
      });
      const deterministicallyAbsent = missingReferenceRoles.some((role) =>
        binding.rolesWithoutEligibleCandidates.includes(role)
      );
      resultsByPattern.set(
        pattern.pattern_id,
        patternResult(pattern, deterministicallyAbsent ? "unsatisfied" : "indeterminate")
      );
      continue;
    }
    const candidates = candidateClaimIds(
      contract,
      pattern,
      resolved,
      resolvedFalsifier,
      propositionById
    );

    const explicitlyBoundClaim = explicitBindings.get(pattern.pattern_id);
    let selected = null;
    if (explicitlyBoundClaim) {
      if (!claimById.has(explicitlyBoundClaim)) {
        directlyBlockedPatternIds.add(pattern.pattern_id);
        diagnostics.push({
          code: "claim_pattern_binding_dangling",
          pattern_id: pattern.pattern_id,
          claim_id: explicitlyBoundClaim
        });
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate"));
        continue;
      }
      if (!candidates.includes(explicitlyBoundClaim)) {
        diagnostics.push({
          code: "claim_pattern_binding_mismatch",
          pattern_id: pattern.pattern_id,
          claim_id: explicitlyBoundClaim
        });
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "unsatisfied"));
        continue;
      }
      selected = explicitlyBoundClaim;
    } else if (candidates.length === 1) {
      [selected] = candidates;
    } else if (candidates.length === 0) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "unsatisfied"));
      continue;
    } else {
      directlyAmbiguousPatternIds.add(pattern.pattern_id);
      diagnostics.push({
        code: "claim_pattern_match_ambiguous",
        pattern_id: pattern.pattern_id,
        claim_ids: candidates
      });
      resultsByPattern.set(
        pattern.pattern_id,
        patternResult(pattern, "indeterminate", candidates)
      );
      continue;
    }
    selectedClaimByPattern.set(pattern.pattern_id, selected);
    resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "satisfied", [selected]));
  }

  const patternsBySelectedClaim = new Map();
  for (const [patternId, claimId] of selectedClaimByPattern) {
    const patternIds = patternsBySelectedClaim.get(claimId) ?? [];
    patternIds.push(patternId);
    patternsBySelectedClaim.set(claimId, patternIds);
  }
  for (const { pattern_id: patternId, member_reference_id: memberReferenceId, claim_id: claimId }
    of selectedIterationClaims) {
    const patternIds = patternsBySelectedClaim.get(claimId) ?? [];
    patternIds.push(`${patternId}[${memberReferenceId}]`);
    patternsBySelectedClaim.set(claimId, patternIds);
  }
  for (const [claimId, patternIds] of patternsBySelectedClaim) {
    if (patternIds.length < 2) continue;
    diagnostics.push({
      code: "claim_selected_by_multiple_patterns",
      claim_id: claimId,
      pattern_ids: patternIds.sort(compareIds)
    });
    for (const instancePatternId of patternIds) {
      const patternId = instancePatternId.includes("[")
        ? instancePatternId.slice(0, instancePatternId.indexOf("["))
        : instancePatternId;
      directlyAmbiguousPatternIds.add(patternId);
      const current = resultsByPattern.get(patternId);
      resultsByPattern.set(patternId, { ...current, status: "indeterminate" });
      selectedClaimByPattern.delete(patternId);
    }
  }

  for (const originalPattern of profile.relation_patterns) {
    const pattern = { ...originalPattern, pattern_kind: "relation" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    const source = selectedClaimByPattern.get(pattern.source_claim_pattern_id);
    const target = selectedClaimByPattern.get(pattern.target_claim_pattern_id);
    if (!source || !target) {
      const endpointPatternIds = [
        pattern.source_claim_pattern_id,
        pattern.target_claim_pattern_id
      ];
      const status = unresolvedDependencyStatus(endpointPatternIds, resultsByPattern);
      if (status === "indeterminate" && endpointPatternIds.some((patternId) =>
        directlyBlockedPatternIds.has(patternId) ||
        downstreamBlockedPatternIds.has(patternId)
      )) {
        downstreamBlockedPatternIds.add(pattern.pattern_id);
      }
      if (status === "indeterminate" && endpointPatternIds.some((patternId) =>
        directlyAmbiguousPatternIds.has(patternId) ||
        downstreamAmbiguousPatternIds.has(patternId)
      )) downstreamAmbiguousPatternIds.add(pattern.pattern_id);
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, status));
      continue;
    }
    const matches = contract.relations.filter((relation) =>
      relation.role === pattern.role && relation.source_claim_id === source &&
      relation.target_claim_id === target
    ).map(({ relation_id }) => relation_id).sort(compareIds);
    resultsByPattern.set(
      pattern.pattern_id,
      patternResult(pattern, matches.length > 0 ? "satisfied" : "unsatisfied", matches)
    );
  }

  for (const originalPattern of profile.collection_patterns) {
    const pattern = { ...originalPattern, pattern_kind: "collection" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    const members = pattern.member_claim_pattern_ids.map((patternId) =>
      selectedClaimByPattern.get(patternId)
    );
    if (members.some((id) => !id)) {
      const status = unresolvedDependencyStatus(
        pattern.member_claim_pattern_ids,
        resultsByPattern
      );
      if (status === "indeterminate" && pattern.member_claim_pattern_ids.some((patternId) =>
        directlyBlockedPatternIds.has(patternId) ||
        downstreamBlockedPatternIds.has(patternId)
      )) downstreamBlockedPatternIds.add(pattern.pattern_id);
      if (status === "indeterminate" && pattern.member_claim_pattern_ids.some((patternId) =>
        directlyAmbiguousPatternIds.has(patternId) ||
        downstreamAmbiguousPatternIds.has(patternId)
      )) downstreamAmbiguousPatternIds.add(pattern.pattern_id);
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, status));
      continue;
    }
    const expected = pattern.collection_kind === "closed_set"
      ? [...members].sort(compareIds)
      : members;
    const matchesPurpose = (collection) =>
      pattern.collection_purpose === undefined ||
      collection.purpose === pattern.collection_purpose;
    const matchingCollections = contract.collections.filter((collection) => {
      if (collection.collection_kind !== pattern.collection_kind) return false;
      if (!matchesPurpose(collection)) return false;
      if (pattern.collection_kind === "ordered_sequence") {
        const matchMode = pattern.match_mode ?? "subsequence";
        if (matchMode === "exact") return canonical(collection.member_claim_ids) ===
          canonical(expected);
        if (matchMode === "contiguous_subsequence") return isContiguousSubsequence(
          expected,
          collection.member_claim_ids
        );
        return isOrderedSubsequence(expected, collection.member_claim_ids);
      }
      return canonical([...collection.member_claim_ids].sort(compareIds)) ===
        canonical(expected);
    });
    const candidateCollections = pattern.candidate_quantifier === "all_covering"
      ? contract.collections.filter((collection) => {
        if (collection.collection_kind !== pattern.collection_kind ||
            !matchesPurpose(collection)) return false;
        const covers = expected.every((claimId) =>
          collection.member_claim_ids.includes(claimId)
        );
        return covers || purposeMatchedCollectionsAreCandidates &&
          pattern.collection_purpose !== undefined;
      })
      : matchingCollections;
    if (pattern.candidate_quantifier === "all_covering" &&
        pattern.collection_purpose !== undefined) {
      const excludedCoveringCollections = contract.collections.filter((collection) =>
        collection.collection_kind === pattern.collection_kind &&
        !matchesPurpose(collection) &&
        expected.every((claimId) => collection.member_claim_ids.includes(claimId))
      );
      if (excludedCoveringCollections.length > 0) diagnostics.push({
        code: "collection_covering_purpose_mismatch",
        pattern_id: pattern.pattern_id,
        expected_collection_purpose: pattern.collection_purpose,
        excluded_collections: excludedCoveringCollections
          .map(({ collection_id: collectionId, purpose = null }) => ({
            collection_id: collectionId,
            actual_collection_purpose: purpose
          }))
          .sort((left, right) => compareIds(left.collection_id, right.collection_id))
      });
    }
    if (pattern.candidate_quantifier === "all_covering") {
      const expectedSet = new Set(expected);
      const overlappingNoncoveringCollections = contract.collections
        .filter((collection) =>
          collection.collection_kind === pattern.collection_kind &&
          collection.member_claim_ids.some((claimId) => expectedSet.has(claimId)) &&
          !expected.every((claimId) => collection.member_claim_ids.includes(claimId))
        )
        .map(({ collection_id: collectionId, purpose = null, member_claim_ids: memberIds }) => ({
          collection_id: collectionId,
          actual_collection_purpose: purpose,
          shared_member_claim_ids: expected.filter((claimId) => memberIds.includes(claimId)),
          missing_expected_member_claim_ids: expected.filter(
            (claimId) => !memberIds.includes(claimId)
          ),
          extra_member_claim_ids: memberIds.filter((claimId) => !expectedSet.has(claimId))
            .sort(compareIds)
        }))
        .sort((left, right) => compareIds(left.collection_id, right.collection_id));
      if (overlappingNoncoveringCollections.length > 0) diagnostics.push({
        code: "collection_noncovering_population_overlap",
        pattern_id: pattern.pattern_id,
        collections: overlappingNoncoveringCollections
      });
    }
    if (pattern.candidate_quantifier === "all_covering" &&
        pattern.collection_purpose !== undefined) {
      const disjointPurposeMatches = contract.collections
        .filter((collection) =>
          collection.collection_kind === pattern.collection_kind &&
          matchesPurpose(collection) &&
          !collection.member_claim_ids.some((claimId) => expected.includes(claimId))
        )
        .map(({ collection_id: collectionId }) => collectionId)
        .sort(compareIds);
      if (disjointPurposeMatches.length > 0) diagnostics.push({
        code: "collection_disjoint_purpose_match",
        pattern_id: pattern.pattern_id,
        collection_ids: disjointPurposeMatches
      });
    }
    const matches = matchingCollections.map(({ collection_id }) => collection_id)
      .sort(compareIds);
    const allCandidatesMatch = candidateCollections.length > 0 &&
      matchingCollections.length === candidateCollections.length;
    if (pattern.candidate_quantifier === "all_covering" &&
        candidateCollections.length > 0 && !allCandidatesMatch) {
      diagnostics.push({
        code: pattern.collection_kind === "ordered_sequence"
          ? "collection_covering_sequences_disagree"
          : "collection_covering_sets_disagree",
        pattern_id: pattern.pattern_id,
        candidate_collection_ids: candidateCollections
          .map(({ collection_id }) => collection_id).sort(compareIds),
        nonmatching_collection_ids: candidateCollections
          .filter((candidate) => !matchingCollections.includes(candidate))
          .map(({ collection_id }) => collection_id).sort(compareIds)
      });
    }
    if (pattern.candidate_quantifier === "all_covering" &&
        candidateCollections.length === 0) {
      diagnostics.push({
        code: "collection_pattern_no_candidate",
        pattern_id: pattern.pattern_id,
        collection_kind: pattern.collection_kind,
        collection_purpose: pattern.collection_purpose ?? null
      });
    }
    resultsByPattern.set(
      pattern.pattern_id,
      patternResult(
        pattern,
        pattern.candidate_quantifier === "all_covering"
          ? (allCandidatesMatch ? "satisfied" : "unsatisfied")
          : (matches.length > 0 ? "satisfied" : "unsatisfied"),
        matches
      )
    );
  }

  for (const originalPattern of profile.resolver_fact_patterns) {
    const pattern = { ...originalPattern, pattern_kind: "resolver_fact" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    const argumentReferenceIds = pattern.argument_roles.flatMap((role) =>
      binding.bindingByRole.get(role) ?? []
    );
    if (argumentReferenceIds.length === 0 && pattern.argument_roles.length > 0) {
      if (pattern.argument_roles.some((role) => binding.unboundRoles.includes(role))) {
        directlyBlockedPatternIds.add(pattern.pattern_id);
      }
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate"));
      continue;
    }
    const matches = input.resolver_facts.filter((fact) =>
      fact.resolver_kind === pattern.resolver_kind && fact.fact_key === pattern.fact_key &&
      canonical(fact.argument_reference_ids) === canonical(argumentReferenceIds)
    );
    const id = `${pattern.resolver_kind}:${pattern.fact_key}`;
    if (matches.length === 0) {
      directlyBlockedPatternIds.add(pattern.pattern_id);
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate"));
    } else if (matches.length > 1) {
      directlyAmbiguousPatternIds.add(pattern.pattern_id);
      diagnostics.push({
        code: "resolver_fact_match_ambiguous",
        pattern_id: pattern.pattern_id
      });
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate", [id]));
    } else {
      resultsByPattern.set(
        pattern.pattern_id,
        patternResult(pattern, matches[0].satisfied ? "satisfied" : "unsatisfied", [id])
      );
    }
  }

  for (const originalPattern of profile.evidence_patterns) {
    const pattern = { ...originalPattern, pattern_kind: "evidence" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    const verificationClaimId = selectedClaimByPattern.get(
      pattern.verification_claim_pattern_id
    );
    if (!verificationClaimId) {
      if (directlyBlockedPatternIds.has(pattern.verification_claim_pattern_id) ||
          downstreamBlockedPatternIds.has(pattern.verification_claim_pattern_id)) {
        downstreamBlockedPatternIds.add(pattern.pattern_id);
      }
      if (directlyAmbiguousPatternIds.has(pattern.verification_claim_pattern_id) ||
          downstreamAmbiguousPatternIds.has(pattern.verification_claim_pattern_id)) {
        downstreamAmbiguousPatternIds.add(pattern.pattern_id);
      }
      resultsByPattern.set(pattern.pattern_id, patternResult(
        pattern,
        unresolvedDependencyStatus(
          [pattern.verification_claim_pattern_id],
          resultsByPattern
        )
      ));
      continue;
    }
    const matches = input.delivered_evidence.filter((evidence) =>
      evidence.evidence_kind === pattern.evidence_kind &&
      evidence.verification_claim_id === verificationClaimId
    );
    const id = `${pattern.evidence_kind}:${verificationClaimId}`;
    if (matches.length === 0) {
      directlyBlockedPatternIds.add(pattern.pattern_id);
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate"));
    } else if (matches.length > 1) {
      directlyAmbiguousPatternIds.add(pattern.pattern_id);
      diagnostics.push({
        code: "delivered_evidence_match_ambiguous",
        pattern_id: pattern.pattern_id
      });
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate", [id]));
    } else {
      resultsByPattern.set(
        pattern.pattern_id,
        patternResult(pattern, matches[0].satisfied ? "satisfied" : "unsatisfied", [id])
      );
    }
  }

  const statusByPattern = new Map(
    [...resultsByPattern].map(([patternId, result]) => [patternId, result.status])
  );
  const satisfactionTrace = evaluateExpressionTrace(
    profile.satisfaction_expression,
    statusByPattern
  );
  const satisfaction = satisfactionTrace.status;
  if (satisfaction === "indeterminate") diagnostics.push({
    code: "profile_satisfaction_indeterminate",
    unbound_reference_roles: binding.unboundRoles,
    unbound_number_roles: numberBinding.unboundRoles,
    directly_blocked_pattern_ids: [...directlyBlockedPatternIds].sort(compareIds),
    directly_ambiguous_pattern_ids: [...directlyAmbiguousPatternIds].sort(compareIds),
    downstream_blocked_pattern_ids: [...downstreamBlockedPatternIds].sort(compareIds),
    downstream_ambiguous_pattern_ids: [...downstreamAmbiguousPatternIds].sort(compareIds)
  });
  const result = {
    result_version: RESULT_VERSION,
    authority: { kind: "free_tier_local", authoritative: false },
    profile: {
      profile_id: profile.profile_id,
      profile_version: profile.profile_version
    },
    evaluation_stage: input.evaluation_stage,
    profile_valid: true,
    input_valid: true,
    contract_valid: true,
    satisfaction,
    satisfaction_trace: satisfactionTrace,
    pattern_results: [...resultsByPattern.values()].sort((left, right) =>
      compareIds(left.pattern_id, right.pattern_id)
    ),
    binding_analysis: {
      unbound_reference_roles: binding.unboundRoles,
      unbound_number_roles: numberBinding.unboundRoles,
      reference_roles_without_eligible_candidates:
        binding.rolesWithoutEligibleCandidates,
      directly_blocked_pattern_ids: [...directlyBlockedPatternIds].sort(compareIds),
      direct_binding_blockers: directBindingBlockers.sort((left, right) =>
        compareIds(left.pattern_id, right.pattern_id)
      ),
      reference_binding_blockers: referenceBindingBlockers.sort((left, right) =>
        compareIds(left.pattern_id, right.pattern_id)
      ),
      downstream_blocked_pattern_ids: [...downstreamBlockedPatternIds].sort(compareIds)
    },
    ambiguity_analysis: {
      directly_ambiguous_pattern_ids: [...directlyAmbiguousPatternIds].sort(compareIds),
      downstream_ambiguous_pattern_ids: [...downstreamAmbiguousPatternIds].sort(compareIds)
    },
    diagnostics: diagnostics.sort(compareDiagnostics)
  };
  if (!validateResultSchema(result)) throw new Error(
    `verification profile evaluator emitted an invalid result: ${JSON.stringify(validateResultSchema.errors)}`
  );
  return result;
}

function evaluateVerificationProfile(payload) {
  return evaluateVerificationProfileWithRuntime(payload);
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
