
import {
  BASE_SCHEMA as BASE_SCHEMA_V030,
  OPERATOR_CODEBOOK,
  bindGeneralSchema as bindGeneralSchemaV030,
  buildReferenceCatalog,
  evaluateGeneralContract as evaluateGeneralContractV030,
  numbersInSource,
  segmentCriterion,
  sourceBindings,
  sourcePhraseTerminals,
  unresolvedIdentityMentions
} from "./controlled-contract-general-v030.mjs";

const VERSION = "0.31";

function splitClaimSchema(schema) {
  const split = structuredClone(schema);
  split.title = "controlled-contract-general.experimental.v0.31";
  split.description = "NONCANONICAL EXPERIMENTAL general controlled-contract grammar. Declarative and verification claims are distinct schema productions sharing one compact operator codebook; verification-only fields are unavailable to declarative claims.";
  split.properties.schema_version.enum = ["controlled-contract-general.experimental.v0.31"];
  split.properties.vocabulary_version.enum = ["cv.experimental.0.31"];
  split.properties.profile_id.enum = ["general-controlled-contract.experimental.v0.31"];

  const originalClaim = split.$defs.claim;
  const operatorCode = structuredClone(originalClaim.properties.operator);
  split.$defs.operator_code = operatorCode;

  const declarative = structuredClone(originalClaim);
  declarative.required = declarative.required.filter((name) =>
    name !== "verification_methods" && name !== "falsifying_condition_spans"
  );
  delete declarative.properties.verification_methods;
  delete declarative.properties.falsifying_condition_spans;
  declarative.properties.claim_kind.enum = declarative.properties.claim_kind.enum
    .filter((kind) => kind !== "verification");
  declarative.properties.operator = { $ref: "#/$defs/operator_code" };

  const verification = structuredClone(originalClaim);
  verification.required = verification.required.flatMap((name) => {
    if (name === "claim_kind") return [];
    if (name === "verification_methods") return ["verification_method"];
    return [name];
  });
  delete verification.properties.claim_kind;
  verification.properties.operator = { $ref: "#/$defs/operator_code" };
  verification.properties.verification_method = structuredClone(
    verification.properties.verification_methods.items
  );
  delete verification.properties.verification_methods;
  verification.properties.falsifying_condition_spans.minItems = 1;

  delete split.$defs.claim;
  split.$defs.declarative_claim = declarative;
  split.$defs.verification_claim = verification;
  split.required = split.required.flatMap((name) =>
    name === "claims" ? ["declarative_claims", "verification_claims"] : [name]
  );
  const properties = {};
  for (const [name, value] of Object.entries(split.properties)) {
    if (name !== "claims") {
      properties[name] = value;
      continue;
    }
    properties.declarative_claims = {
      type: "array",
      minItems: 0,
      items: { $ref: "#/$defs/declarative_claim" }
    };
    properties.verification_claims = {
      type: "array",
      minItems: 0,
      items: { $ref: "#/$defs/verification_claim" }
    };
  }
  split.properties = properties;
  return split;
}

const BASE_SCHEMA = splitClaimSchema(BASE_SCHEMA_V030);

function bindGeneralSchema(baseSchema, { sourceText, catalog }) {
  return splitClaimSchema(bindGeneralSchemaV030(BASE_SCHEMA_V030, { sourceText, catalog }));
}

function mergePayload(payload) {
  return {
    schema_version: "controlled-contract-general.experimental.v0.30",
    vocabulary_version: "cv.experimental.0.30",
    profile_id: "general-controlled-contract.experimental.v0.30",
    variables: payload.variables ?? [],
    collections: payload.collections ?? [],
    claims: [
      ...(payload.declarative_claims ?? []).map((claim) => ({
        ...claim,
        verification_methods: [],
        falsifying_condition_spans: []
      })),
      ...(payload.verification_claims ?? []).map((claim) => {
        const { verification_method: verificationMethod, ...rest } = claim;
        return {
          ...rest,
          claim_kind: "verification",
          verification_methods: [verificationMethod]
        };
      })
    ],
    relations: payload.relations ?? []
  };
}

function normalizeGeneralPayload(payload) {
  return mergePayload(payload);
}

function evaluateGeneralContract(payload, { sourceText, catalog }) {
  const result = evaluateGeneralContractV030(mergePayload(payload), { sourceText, catalog });
  if (result.evaluation !== null) {
    result.evaluation.grammar_version =
      "controlled-contract-general-evaluation.experimental.v0.31";
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
