
import Ajv2020 from "ajv/dist/2020.js";

import {
  BASE_SCHEMA as BASE_SCHEMA_V032,
  OPERATOR_CODEBOOK,
  bindGeneralSchema as bindGeneralSchemaV032,
  buildReferenceCatalog,
  evaluateGeneralContract as evaluateGeneralContractV032,
  numbersInSource,
  operandTokens,
  segmentCriterion,
  sourceBindings,
  sourcePhraseTerminals,
  unresolvedIdentityMentions
} from "./controlled-contract-general-v032.mjs";

const VERSION = "0.33";
const READABLE_OPERATOR_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(OPERATOR_CODEBOOK).map(([code, operator]) => [
    code,
    `${operator.value_kind}:${operator.predicate}`
  ])
));
const CODE_BY_READABLE_OPERATOR = Object.freeze(Object.fromEntries(
  Object.entries(READABLE_OPERATOR_BY_CODE).map(([code, readable]) => [readable, code])
));

function exposeReadableOperators(schema) {
  const readable = structuredClone(schema);
  readable.title = "controlled-contract-general.experimental.v0.33";
  readable.description = "NONCANONICAL EXPERIMENTAL general controlled-contract grammar. The model selects readable value-kind:predicate operators. Declarative and verification claims remain distinct, every claim carries at least one invocation-bound controlled operand, and the deterministic compiler enforces operator signatures and source coverage.";
  readable.properties.schema_version.enum = ["controlled-contract-general.experimental.v0.33"];
  readable.properties.vocabulary_version.enum = ["cv.experimental.0.33"];
  readable.properties.profile_id.enum = ["general-controlled-contract.experimental.v0.33"];
  const operator = readable.$defs.operator_code;
  operator.enum = operator.enum.map((code) => READABLE_OPERATOR_BY_CODE[code]);
  operator.description = "Controlled value-kind:predicate operator. The prefix fixes the required operand family. Examples: reference:replaces, boolean:exists, range:has_cardinality.";
  for (const definitionName of ["declarative_claim", "verification_claim"]) {
    for (const branch of readable.$defs[definitionName].anyOf ?? []) {
      branch.properties.operator.enum = branch.properties.operator.enum
        .map((code) => READABLE_OPERATOR_BY_CODE[code]);
    }
  }
  return readable;
}

const BASE_SCHEMA = exposeReadableOperators(BASE_SCHEMA_V032);
const validateBase = new Ajv2020({ strict: true, allErrors: true }).compile(BASE_SCHEMA);

function bindGeneralSchema(baseSchema, { sourceText, catalog }) {
  return exposeReadableOperators(bindGeneralSchemaV032(BASE_SCHEMA_V032, { sourceText, catalog }));
}

function decodePayload(payload) {
  const decoded = structuredClone(payload);
  decoded.schema_version = "controlled-contract-general.experimental.v0.32";
  decoded.vocabulary_version = "cv.experimental.0.32";
  decoded.profile_id = "general-controlled-contract.experimental.v0.32";
  for (const family of ["declarative_claims", "verification_claims"]) {
    decoded[family] = (decoded[family] ?? []).map((claim) => ({
      ...claim,
      operator: CODE_BY_READABLE_OPERATOR[claim.operator] ?? claim.operator
    }));
  }
  return decoded;
}

function normalizeGeneralPayload(payload) {
  return decodePayload(payload);
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
  const result = evaluateGeneralContractV032(decodePayload(payload), { sourceText, catalog });
  if (result.evaluation !== null) {
    result.evaluation.grammar_version =
      "controlled-contract-general-evaluation.experimental.v0.33";
  }
  return result;
}

export {
  BASE_SCHEMA,
  CODE_BY_READABLE_OPERATOR,
  READABLE_OPERATOR_BY_CODE,
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
