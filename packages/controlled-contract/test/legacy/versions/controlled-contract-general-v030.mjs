
import {
  BASE_SCHEMA as BASE_SCHEMA_V027
} from "./controlled-contract-general-v027.mjs";
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

const VERSION = "0.30";
const VALUE_KINDS = ["reference", "boolean", "number", "range"];
const OPERATOR_ENTRIES = VALUE_KINDS.flatMap((valueKind) =>
  BASE_SCHEMA_V027.$defs[`${valueKind}_claim`].properties.predicate.enum.map((predicate) => ({
    value_kind: valueKind,
    predicate
  }))
);
const OPERATOR_CODEBOOK = Object.freeze(Object.fromEntries(
  OPERATOR_ENTRIES.map((operator, index) => [
    `o${String(index + 1).padStart(3, "0")}`,
    Object.freeze(operator)
  ])
));

function encodeSchema(schema) {
  const encoded = structuredClone(schema);
  encoded.title = "controlled-contract-general.experimental.v0.30";
  encoded.description = "NONCANONICAL EXPERIMENTAL general controlled-contract grammar. A compact operator code fixes both value kind and predicate, making mismatched predicate/value productions unavailable. The compiler deterministically restores the vocabulary terms.";
  encoded.properties.schema_version.enum = ["controlled-contract-general.experimental.v0.30"];
  encoded.properties.vocabulary_version.enum = ["cv.experimental.0.30"];
  encoded.properties.profile_id.enum = ["general-controlled-contract.experimental.v0.30"];

  const claim = encoded.$defs.claim;
  const availableProductions = new Set(claim.properties.production.enum);
  const availableKinds = [...new Set([...availableProductions].map((production) =>
    production.slice(0, production.indexOf("_"))
  ))];
  const availableValueKinds = new Set([...availableProductions].map((production) =>
    production.slice(production.indexOf("_") + 1)
  ));
  claim.required = claim.required.flatMap((name) => {
    if (name === "production") return ["claim_kind", "operator"];
    if (name === "predicate") return [];
    return [name];
  });
  const properties = {};
  for (const [name, value] of Object.entries(claim.properties)) {
    if (name === "production") {
      properties.claim_kind = {
        type: "string",
        enum: availableKinds,
        description: "behavior and evidence are declarative claims; verification requires a method and falsifying condition"
      };
      properties.operator = {
        type: "string",
        enum: Object.entries(OPERATOR_CODEBOOK)
          .filter(([, operator]) => availableValueKinds.has(operator.value_kind))
          .map(([code]) => code),
        description: [
          "Stable controlled operator codes fixing value kind and predicate:",
          ...Object.entries(OPERATOR_CODEBOOK)
            .filter(([, operator]) => availableValueKinds.has(operator.value_kind))
            .map(([code, operator]) => `${code} = ${operator.value_kind}:${operator.predicate}`)
        ].join("\n")
      };
      continue;
    }
    if (name === "predicate") continue;
    properties[name] = value;
  }
  claim.properties = properties;
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
  decoded.claims = (decoded.claims ?? []).map((claim) => {
    const operator = OPERATOR_CODEBOOK[claim.operator] ?? { value_kind: "unknown", predicate: claim.operator };
    const { claim_kind: claimKind, operator: ignoredOperator, ...rest } = claim;
    return {
      ...rest,
      production: `${claimKind}_${operator.value_kind}`,
      predicate: operator.predicate
    };
  });
  return decoded;
}

function normalizeGeneralPayload(payload) {
  return decodePayload(payload);
}

function evaluateGeneralContract(payload, { sourceText, catalog }) {
  const result = evaluateGeneralContractV028(decodePayload(payload), { sourceText, catalog });
  if (result.evaluation !== null) {
    result.evaluation.grammar_version =
      "controlled-contract-general-evaluation.experimental.v0.30";
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
  segmentCriterion,
  sourceBindings,
  sourcePhraseTerminals,
  unresolvedIdentityMentions
};
