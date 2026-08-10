
import Ajv2020 from "ajv/dist/2020.js";

import {
  BASE_SCHEMA as BASE_SCHEMA_V031,
  OPERATOR_CODEBOOK,
  bindGeneralSchema as bindGeneralSchemaV031,
  buildReferenceCatalog,
  evaluateGeneralContract as evaluateGeneralContractV031,
  numbersInSource,
  segmentCriterion,
  sourceBindings,
  sourcePhraseTerminals,
  unresolvedIdentityMentions
} from "./controlled-contract-general-v031.mjs";

const VERSION = "0.32";
const VALUE_FIELD_NAMES = [
  "value_reference_ids", "boolean_values", "number_values",
  "minimum_values", "maximum_values"
];

const referenceToken = (id) => `r:${id}`;
const booleanToken = (value) => `b:${value}`;
const numberToken = (value) => `n:${value}`;
const minimumToken = (value) => `min:${value}`;
const maximumToken = (value) => `max:${value}`;

function operandTokens({ referenceIds = [], numbers = [] } = {}) {
  return [
    ...referenceIds.map(referenceToken),
    booleanToken(true),
    booleanToken(false),
    ...numbers.flatMap((value) => [
      numberToken(value), minimumToken(value), maximumToken(value)
    ])
  ];
}

function operatorsForValueKind(valueKind) {
  return Object.entries(OPERATOR_CODEBOOK)
    .filter(([, operator]) => operator.value_kind === valueKind)
    .map(([code]) => code);
}

function tokensForValueKind(tokens, valueKind) {
  if (tokens === null) return null;
  const prefixes = {
    reference: ["r:"],
    boolean: ["b:"],
    number: ["n:"],
    range: ["min:", "max:"]
  }[valueKind];
  return tokens.filter((token) => prefixes.some((prefix) => token.startsWith(prefix)));
}

function operandFamilyBranch(valueKind, tokens) {
  const familyTokens = tokensForValueKind(tokens, valueKind);
  if (familyTokens !== null && familyTokens.length === 0) return null;
  const itemSchema = (prefixes) => familyTokens === null
    ? { type: "string", pattern: `^(?:${prefixes.join("|")}):` }
    : {
        type: "string",
        enum: familyTokens.filter((token) => prefixes.some((prefix) => token.startsWith(`${prefix}:`)))
      };
  const operandSchema = valueKind === "range" ? {
    type: "array",
    anyOf: [
      {
        minItems: 1,
        maxItems: 1,
        items: itemSchema(["min", "max"])
      },
      {
        minItems: 2,
        maxItems: 2,
        prefixItems: [itemSchema(["min"]), itemSchema(["max"])],
        items: false
      },
      {
        minItems: 2,
        maxItems: 2,
        prefixItems: [itemSchema(["max"]), itemSchema(["min"])],
        items: false
      }
    ]
  } : {
    type: "array",
    minItems: 1,
    items: itemSchema([valueKind[0]])
  };
  return {
    properties: {
      operator: { type: "string", enum: operatorsForValueKind(valueKind) },
      operand_tokens: operandSchema
    }
  };
}

function compactClaimValues(schema, tokens = null) {
  const compact = structuredClone(schema);
  compact.title = "controlled-contract-general.experimental.v0.32";
  compact.description = "NONCANONICAL EXPERIMENTAL general controlled-contract grammar. Declarative and verification claims remain distinct. Every claim carries at least one invocation-bound controlled operand token; empty-value claims and irrelevant value fields are unavailable. The operator code fixes the expected operand kind and the deterministic compiler rejects mismatched token kinds.";
  compact.properties.schema_version.enum = ["controlled-contract-general.experimental.v0.32"];
  compact.properties.vocabulary_version.enum = ["cv.experimental.0.32"];
  compact.properties.profile_id.enum = ["general-controlled-contract.experimental.v0.32"];

  for (const definitionName of ["declarative_claim", "verification_claim"]) {
    const definition = compact.$defs[definitionName];
    definition.required = definition.required.filter((name) => !VALUE_FIELD_NAMES.includes(name));
    for (const name of VALUE_FIELD_NAMES) delete definition.properties[name];
    definition.required.push("operand_tokens");
    definition.properties.operand_tokens = tokens === null
      ? { type: "array", minItems: 1, items: { type: "string", minLength: 3 } }
      : {
          type: "array",
          minItems: 1,
          items: {
            type: "string",
            enum: tokens,
            description: "Invocation-bound controlled operands: r:<reference ID>, b:<boolean>, n:<number>, min:<lower bound>, max:<upper bound>. The selected operator fixes the legal token family."
          }
        };
    definition.anyOf = ["reference", "boolean", "number", "range"]
      .map((valueKind) => operandFamilyBranch(valueKind, tokens))
      .filter(Boolean);
  }
  return compact;
}

const BASE_SCHEMA = compactClaimValues(BASE_SCHEMA_V031);
const validateBase = new Ajv2020({ strict: true, allErrors: true }).compile(BASE_SCHEMA);

function bindGeneralSchema(baseSchema, { sourceText, catalog }) {
  const bound = bindGeneralSchemaV031(BASE_SCHEMA_V031, { sourceText, catalog });
  const referenceIds = bound.$defs.reference_id.enum;
  return compactClaimValues(bound, operandTokens({
    referenceIds,
    numbers: numbersInSource(sourceText)
  }));
}

function decodedValues(claim) {
  const expectedKind = OPERATOR_CODEBOOK[claim.operator]?.value_kind;
  const decoded = {
    value_reference_ids: [],
    boolean_values: [],
    number_values: [],
    minimum_values: [],
    maximum_values: []
  };
  for (const token of claim.operand_tokens ?? []) {
    if (expectedKind === "reference" && token.startsWith("r:")) {
      decoded.value_reference_ids.push(token.slice(2));
    } else if (expectedKind === "boolean" && token.startsWith("b:")) {
      decoded.boolean_values.push(token === "b:true");
    } else if (expectedKind === "number" && token.startsWith("n:")) {
      decoded.number_values.push(Number(token.slice(2)));
    } else if (expectedKind === "range" && token.startsWith("min:")) {
      decoded.minimum_values.push(Number(token.slice(4)));
    } else if (expectedKind === "range" && token.startsWith("max:")) {
      decoded.maximum_values.push(Number(token.slice(4)));
    }
  }
  return decoded;
}

function expandClaim(claim) {
  const { operand_tokens: ignoredOperandTokens, ...rest } = claim;
  return { ...rest, ...decodedValues(claim) };
}

function mergePayload(payload) {
  return {
    schema_version: "controlled-contract-general.experimental.v0.31",
    vocabulary_version: "cv.experimental.0.31",
    profile_id: "general-controlled-contract.experimental.v0.31",
    variables: payload.variables ?? [],
    collections: payload.collections ?? [],
    declarative_claims: (payload.declarative_claims ?? []).map(expandClaim),
    verification_claims: (payload.verification_claims ?? []).map(expandClaim),
    relations: payload.relations ?? []
  };
}

function normalizeGeneralPayload(payload) {
  return mergePayload(payload);
}

function evaluateGeneralContract(payload, { sourceText, catalog }) {
  if (!validateBase(payload)) {
    return {
      schema_valid: false,
      schema_errors: structuredClone(validateBase.errors),
      diagnostics: [],
      evaluation: null
    };
  }
  const result = evaluateGeneralContractV031(mergePayload(payload), { sourceText, catalog });
  if (result.evaluation !== null) {
    result.evaluation.grammar_version =
      "controlled-contract-general-evaluation.experimental.v0.32";
  }
  return result;
}

export {
  BASE_SCHEMA,
  OPERATOR_CODEBOOK,
  VERSION,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract,
  normalizeGeneralPayload,
  numbersInSource,
  operandTokens,
  segmentCriterion,
  sourceBindings,
  sourcePhraseTerminals,
  unresolvedIdentityMentions
};
