import { CONTROLLED_VOCABULARY } from "../vocabulary/cv.experimental.0.34.mjs";
import { createNativeContractRuntime } from "./native-contract-runtime.mjs";

const SCHEMA_VERSION = "controlled-acceptance-contract.experimental.v0.1";
const VOCABULARY_VERSION = "cv.experimental.0.33";
const PROFILE_ID = "acceptance-contract.standard.experimental.v0.1";

const operators = CONTROLLED_VOCABULARY.operators.map(({ term }) => term).filter(
  (term) => !["reference:subset_of", "reference:not_subset_of"].includes(term)
);
const operatorsByValueKind = Object.freeze(Object.fromEntries(
  ["reference", "boolean", "number", "range"].map((valueKind) => [
    valueKind,
    operators.filter((operator) => operator.startsWith(`${valueKind}:`))
  ])
));
const typeTerms = CONTROLLED_VOCABULARY.type_terms.map(({ term }) => term).filter(
  (term) => term !== "cc:population"
);

const id = (prefix) => ({
  type: "string",
  pattern: `^${prefix}-[a-z0-9]+(?:-[a-z0-9]+)*$`
});

const referenceIdentity = {
  oneOf: [
    {
      type: "object",
      required: ["kind", "repository", "path"],
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["repository_path"] },
        repository: { type: "string", minLength: 1 },
        path: { type: "string", minLength: 1 }
      }
    },
    {
      type: "object",
      required: ["kind", "repository", "path", "symbol"],
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["code_symbol"] },
        repository: { type: "string", minLength: 1 },
        path: { type: "string", minLength: 1 },
        symbol: { type: "string", minLength: 1 },
        scip_symbol: { type: "string", minLength: 1 }
      }
    },
    {
      type: "object",
      required: ["kind", "domain", "value"],
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["durable_id"] },
        domain: { type: "string", minLength: 1 },
        value: { type: "string", minLength: 1 }
      }
    },
    {
      type: "object",
      required: ["kind", "name"],
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["runtime_parameter"] },
        name: { type: "string", minLength: 1 }
      }
    },
    {
      type: "object",
      required: ["kind", "term"],
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["profile_term"] },
        term: { type: "string", minLength: 1 }
      }
    }
  ]
};

const operandDefinitions = {
  reference_operand: {
    type: "object",
    required: ["kind", "reference_id"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["reference"] },
      reference_id: { $ref: "#/$defs/reference_id" }
    }
  },
  boolean_operand: {
    type: "object",
    required: ["kind", "value"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["boolean"] },
      value: { type: "boolean" }
    }
  },
  number_operand: {
    type: "object",
    required: ["kind", "value"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["number"] },
      value: { type: "number" }
    }
  },
  range_operand: {
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

const propositionBranches = Object.entries(operatorsByValueKind).map(
  ([valueKind, valueOperators]) => ({
    properties: {
      operator: { type: "string", enum: valueOperators },
      operands: {
        type: "array",
        minItems: 1,
        ...(valueKind === "range" ? { maxItems: 1 } : {}),
        items: { $ref: `#/$defs/${valueKind}_operand` }
      }
    }
  })
);

const NATIVE_CONTRACT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: SCHEMA_VERSION,
  description: "Experimental schema-native acceptance-contract carrier. Free text is confined to explicit operative residue and nonoperative annotations; the carrier itself is not an authorization or policy result.",
  type: "object",
  required: [
    "schema_version",
    "vocabulary_version",
    "profile_id",
    "references",
    "propositions",
    "claims",
    "relations",
    "collections",
    "residue",
    "annotations"
  ],
  additionalProperties: false,
  properties: {
    schema_version: { type: "string", enum: [SCHEMA_VERSION] },
    vocabulary_version: { type: "string", enum: [VOCABULARY_VERSION] },
    profile_id: { type: "string", enum: [PROFILE_ID] },
    references: {
      description: "Typed, grounded identities used as proposition subjects, operands, and applicability-context operands. Every operative entity named by a claim must be represented here.",
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/reference" }
    },
    propositions: {
      description: "Controlled subject-operator-operand statements. The operator prefix fixes the legal operand kind; applicability is explicit.",
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/proposition" }
    },
    claims: {
      description: "Modal behavior, evidence, and verification claims over declared propositions. Acceptance behavior belongs in behavior claims; proof obligations belong in verification claims.",
      type: "array",
      minItems: 1,
      items: { oneOf: [
        { $ref: "#/$defs/declarative_claim" },
        { $ref: "#/$defs/verification_claim" }
      ] }
    },
    relations: {
      description: "Explicit claim-to-claim semantics. verifies attaches proof to behavior; refines creates behavior cohesion; depends_on and precedes create directed behavioral order. No relationship is inferred from shared words or references.",
      type: "array",
      items: { $ref: "#/$defs/relation" }
    },
    collections: {
      description: "Closed claim populations or authored claim orderings. A closed_set declares the complete listed population; an ordered_sequence preserves member order.",
      type: "array",
      items: { $ref: "#/$defs/collection" }
    },
    residue: {
      description: "Operative contract meaning that cannot be represented faithfully with the controlled fields. Preserve it exactly enough for a human to decide whether the vocabulary or source contract must change; never omit it to obtain a clean result.",
      type: "array",
      items: { $ref: "#/$defs/residue" }
    },
    annotations: {
      description: "Nonoperative provenance, rationale, history, or notes. Annotations do not create worker obligations or satisfy controlled claims.",
      type: "array",
      items: { $ref: "#/$defs/annotation" }
    }
  },
  $defs: {
    reference_id: id("ref"),
    proposition_id: id("prop"),
    claim_id: id("claim"),
    relation_id: id("rel"),
    collection_id: id("set"),
    residue_id: id("res"),
    annotation_id: id("ann"),
    ...operandDefinitions,
    reference: {
      description: "A stable typed identity. Use a repository path or code symbol when applicable, a durable domain ID, a runtime parameter, or a controlled profile term; do not invent an identity absent from the contract.",
      type: "object",
      required: ["reference_id", "type_term", "identity"],
      additionalProperties: false,
      properties: {
        reference_id: { $ref: "#/$defs/reference_id" },
        type_term: { type: "string", enum: typeTerms },
        identity: referenceIdentity
      }
    },
    applicability_context: {
      description: "The condition or temporal/counterfactual context in which a proposition applies. Conditional modes require at least one grounded context reference.",
      oneOf: [
        {
          type: "object",
          required: ["mode", "operand_reference_ids"],
          additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["unconditional"] },
            operand_reference_ids: { type: "array", maxItems: 0 }
          }
        },
        {
          type: "object",
          required: ["mode", "operand_reference_ids"],
          additionalProperties: false,
          properties: {
            mode: {
              type: "string",
              enum: [
                "if", "unless", "when", "while", "where", "before", "after",
                "during", "until", "frozen_base", "counterfactual"
              ]
            },
            operand_reference_ids: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/reference_id" }
            }
          }
        }
      ]
    },
    proposition: {
      description: "One controlled statement with a grounded subject, readable controlled operator, explicit applicability, and one or more operands of the operator's required kind.",
      type: "object",
      required: [
        "proposition_id",
        "subject_reference_id",
        "operator",
        "applicability_context",
        "operands"
      ],
      additionalProperties: false,
      properties: {
        proposition_id: { $ref: "#/$defs/proposition_id" },
        subject_reference_id: { $ref: "#/$defs/reference_id" },
        operator: { type: "string", enum: operators },
        applicability_context: { $ref: "#/$defs/applicability_context" },
        operands: { type: "array", minItems: 1 }
      },
      anyOf: propositionBranches
    },
    declarative_claim: {
      description: "A modal behavior requirement or evidence assertion. Behavior is what the system must or must not do; evidence records a required or observed artifact/fact without turning it into behavior.",
      type: "object",
      required: ["claim_id", "kind", "modality", "proposition_id"],
      additionalProperties: false,
      properties: {
        claim_id: { $ref: "#/$defs/claim_id" },
        kind: { type: "string", enum: ["behavior", "evidence"] },
        modality: {
          type: "string",
          enum: ["MUST", "MUST_NOT", "SHOULD", "SHOULD_NOT", "MAY"]
        },
        proposition_id: { $ref: "#/$defs/proposition_id" }
      }
    },
    verification_claim: {
      description: "A modal proof obligation. It names both the proposition the verification performs and a separately declared controlled proposition describing the behavior-specific condition that must make the verification fail.",
      type: "object",
      required: [
        "claim_id",
        "kind",
        "modality",
        "proposition_id",
        "verification_method",
        "falsifying_proposition_id"
      ],
      additionalProperties: false,
      properties: {
        claim_id: { $ref: "#/$defs/claim_id" },
        kind: { type: "string", enum: ["verification"] },
        modality: {
          type: "string",
          enum: ["MUST", "MUST_NOT", "SHOULD", "SHOULD_NOT", "MAY"]
        },
        proposition_id: { $ref: "#/$defs/proposition_id" },
        verification_method: {
          type: "string",
          enum: ["inspection", "analysis", "demonstration", "test_execution", "audit", "proof"]
        },
        falsifying_proposition_id: { $ref: "#/$defs/proposition_id" }
      }
    },
    relation: {
      description: "A directed relationship between two declared claims. For verifies, source is the verification claim and target is the behavior claim. For depends_on, source depends on target. For precedes, source precedes target.",
      type: "object",
      required: ["relation_id", "role", "source_claim_id", "target_claim_id"],
      additionalProperties: false,
      properties: {
        relation_id: { $ref: "#/$defs/relation_id" },
        role: {
          type: "string",
          enum: [
            "satisfies", "verifies", "derives_from", "refines", "traces", "replaces",
            "depends_on", "precedes"
          ]
        },
        source_claim_id: { $ref: "#/$defs/claim_id" },
        target_claim_id: { $ref: "#/$defs/claim_id" }
      }
    },
    collection: {
      description: "An explicitly complete or ordered group of declared claim IDs. Collection membership measures authored population/order and does not by itself imply implementation cohesion.",
      type: "object",
      required: ["collection_id", "collection_kind", "member_claim_ids"],
      additionalProperties: false,
      properties: {
        collection_id: { $ref: "#/$defs/collection_id" },
        collection_kind: { type: "string", enum: ["closed_set", "ordered_sequence"] },
        purpose: {
          description: "An optional controlled role distinguishing collections that assert different populations or orderings over overlapping claims.",
          type: "string",
          pattern: "^[a-z][a-z0-9_]*$"
        },
        member_claim_ids: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/claim_id" }
        }
      }
    },
    residue: {
      description: "An operative meaning fragment that the controlled carrier cannot faithfully encode. The reason classifies the gap; candidate_concept may name a generalized vocabulary opportunity without creating vocabulary.",
      type: "object",
      required: ["residue_id", "reason", "text"],
      additionalProperties: false,
      properties: {
        residue_id: { $ref: "#/$defs/residue_id" },
        reason: {
          type: "string",
          enum: [
            "unsupported_concept", "unresolved_identity", "unresolved_value",
            "unresolved_context", "ambiguous_semantics", "review_only",
            "other_operational_gap"
          ]
        },
        text: { type: "string", minLength: 1 },
        candidate_concept: { type: "string", minLength: 1 }
      }
    },
    annotation: {
      description: "Nonoperative context preserved separately from worker obligations.",
      type: "object",
      required: ["annotation_id", "kind", "text"],
      additionalProperties: false,
      properties: {
        annotation_id: { $ref: "#/$defs/annotation_id" },
        kind: { type: "string", enum: ["provenance", "rationale", "historical", "note"] },
        text: { type: "string", minLength: 1 }
      }
    }
  }
};

const OPPOSING_OPERATORS = new Map([
  ["reference:equals", "reference:not_equals"],
  ["reference:not_equals", "reference:equals"],
  ["reference:member_of", "reference:not_member_of"],
  ["reference:not_member_of", "reference:member_of"],
  ["number:equals", "number:not_equals"],
  ["number:not_equals", "number:equals"]
]);

function controlledOppositeOperator(operator) {
  return OPPOSING_OPERATORS.get(operator) ?? null;
}

const FUNCTIONAL_OPERATORS = new Set([
  "reference:equals",
  "reference:has_state",
  "reference:has_status",
  "reference:ordered_as",
  "reference:resolves_to",
  "boolean:authoritative",
  "boolean:deterministic",
  "boolean:exists",
  "boolean:fails_when",
  "boolean:immutable",
  "number:equals",
  "number:has_cardinality"
]);

const complementByOperator = Object.fromEntries(operators.map((operator) => [
  operator,
  OPPOSING_OPERATORS.has(operator)
    ? { kind: "operator", term: OPPOSING_OPERATORS.get(operator) }
    : operator === "boolean:exists"
      ? { kind: "operand_transform", transform: "boolean_negation" }
      : { kind: "none" }
]));
const operandSemanticsByOperator = Object.fromEntries(operators.map((operator) => [
  operator,
  operator === "reference:ordered_as"
    ? { ordering: "significant", duplicates: "significant" }
    : { ordering: "insignificant", duplicates: "ignored" }
]));
const runtime = createNativeContractRuntime({
  carrierVersion: SCHEMA_VERSION,
  schema: NATIVE_CONTRACT_SCHEMA,
  complementByOperator,
  functionalOperators: [...FUNCTIONAL_OPERATORS],
  operandSemanticsByOperator,
  conjunctiveRangeOperators: ["range:has_range", "range:has_cardinality"]
});
const validateAndResolveNativeContract = runtime.validateAndResolve;

export {
  NATIVE_CONTRACT_SCHEMA,
  PROFILE_ID,
  SCHEMA_VERSION,
  VOCABULARY_VERSION,
  controlledOppositeOperator,
  operatorsByValueKind,
  validateAndResolveNativeContract
};
