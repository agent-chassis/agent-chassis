
import {
  BASE_SCHEMA as BASE_SCHEMA_V028,
  bindGeneralSchema as bindGeneralSchemaV028,
  buildReferenceCatalog,
  evaluateGeneralContract as evaluateGeneralContractV028,
  numbersInSource,
  segmentCriterion,
  sourceBindings,
  sourcePhraseTerminals,
  unresolvedIdentityMentions
} from "./controlled-contract-general-v028.mjs";

const VERSION = "0.29";
const PREDICATE_CODEBOOK = Object.freeze(Object.fromEntries(
  BASE_SCHEMA_V028.$defs.claim.properties.predicate.enum.map((predicate, index) => [
    `p${String(index + 1).padStart(3, "0")}`,
    predicate
  ])
));
const PREDICATE_BY_VALUE = new Map(
  Object.entries(PREDICATE_CODEBOOK).map(([code, predicate]) => [predicate, code])
);

function encodeSchema(schema) {
  const encoded = structuredClone(schema);
  encoded.title = "controlled-contract-general.experimental.v0.29";
  encoded.description = "NONCANONICAL EXPERIMENTAL general controlled-contract grammar. Predicates use stable compact wire codes to remain within Vertex structured-output complexity limits; the schema carries the complete codebook and the compiler deterministically restores vocabulary terms.";
  encoded.properties.schema_version.enum = ["controlled-contract-general.experimental.v0.29"];
  encoded.properties.vocabulary_version.enum = ["cv.experimental.0.29"];
  encoded.properties.profile_id.enum = ["general-controlled-contract.experimental.v0.29"];
  const predicate = encoded.$defs.claim.properties.predicate;
  predicate.enum = Object.keys(PREDICATE_CODEBOOK);
  predicate.description = [
    "Stable controlled predicate wire codes:",
    ...Object.entries(PREDICATE_CODEBOOK).map(([code, value]) => `${code} = ${value}`)
  ].join("\n");
  return encoded;
}

const BASE_SCHEMA = encodeSchema(BASE_SCHEMA_V028);

function bindGeneralSchema(baseSchema, { sourceText, catalog }) {
  return encodeSchema(bindGeneralSchemaV028(BASE_SCHEMA_V028, { sourceText, catalog }));
}

function decodePayload(payload) {
  const decoded = structuredClone(payload);
  decoded.schema_version = "controlled-contract-general.experimental.v0.28";
  decoded.vocabulary_version = "cv.experimental.0.28";
  decoded.profile_id = "general-controlled-contract.experimental.v0.28";
  decoded.claims = (decoded.claims ?? []).map((claim) => ({
    ...claim,
    predicate: PREDICATE_CODEBOOK[claim.predicate] ?? claim.predicate
  }));
  return decoded;
}

function normalizeGeneralPayload(payload, options = {}) {
  const decoded = decodePayload(payload);
  if (options.sourceText === undefined) return decoded;
  return decoded;
}

function evaluateGeneralContract(payload, { sourceText, catalog }) {
  const result = evaluateGeneralContractV028(decodePayload(payload), { sourceText, catalog });
  if (result.evaluation !== null) {
    result.evaluation.grammar_version =
      "controlled-contract-general-evaluation.experimental.v0.29";
  }
  return result;
}

export {
  BASE_SCHEMA,
  PREDICATE_BY_VALUE,
  PREDICATE_CODEBOOK,
  VERSION,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract,
  normalizeGeneralPayload,
  numbersInSource,
  segmentCriterion,
  sourceBindings,
  sourcePhraseTerminals,
  unresolvedIdentityMentions
};
