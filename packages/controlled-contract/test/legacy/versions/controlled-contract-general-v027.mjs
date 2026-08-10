
import {
  BASE_SCHEMA as BASE_SCHEMA_V026,
  bindGeneralSchema as bindGeneralSchemaV026,
  buildReferenceCatalog,
  evaluateGeneralContract as evaluateGeneralContractV026,
  numbersInSource,
  segmentCriterion,
  sourcePhraseTerminals,
  unresolvedIdentityMentions
} from "./controlled-contract-general-v026.mjs";

const VERSION = "0.27";

function numberedBindings(values, prefix) {
  return values.map((text, index) => ({
    id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
    text
  }));
}

function sourceBindings(sourceText) {
  return {
    segments: numberedBindings(segmentCriterion(sourceText), "segment"),
    phrases: numberedBindings(sourcePhraseTerminals(sourceText), "phrase")
  };
}

function bindingDescription(label, bindings) {
  if (bindings.length === 0) return `No ${label} terminals are available for this invocation.`;
  return [
    `Invocation-bound ${label} terminals. Select an ID only for the exact source text shown:`,
    ...bindings.map(({ id, text }) => `${id} = ${JSON.stringify(text)}`)
  ].join("\n");
}

function upgradeSchema(schema, bindings = null) {
  const upgraded = structuredClone(schema);
  upgraded.title = "controlled-contract-general.experimental.v0.27";
  upgraded.description = "NONCANONICAL EXPERIMENTAL general controlled-contract grammar. Source segments and source-derived phrases are invocation-bound controlled IDs; exact prose remains compiler input and residue evidence, not an enum token. Repository identities are invocation-bound terminals. Canonical work-record carrier fields are compiler inputs rather than claims.";
  upgraded.properties.schema_version.enum = ["controlled-contract-general.experimental.v0.27"];
  upgraded.properties.vocabulary_version.enum = ["cv.experimental.0.27"];
  upgraded.properties.profile_id.enum = ["general-controlled-contract.experimental.v0.27"];

  const segmentIds = bindings?.segments.map(({ id }) => id) ?? null;
  upgraded.$defs.source_span = {
    type: "object",
    required: ["source_segment_id"],
    additionalProperties: false,
    properties: {
      source_segment_id: segmentIds === null
        ? { type: "string", minLength: 1 }
        : {
            type: "string",
            enum: segmentIds,
            description: bindingDescription("source-segment", bindings.segments)
          }
    }
  };

  const phraseIds = bindings?.phrases.map(({ id }) => id) ?? null;
  const variable = upgraded.$defs.variable;
  variable.required = variable.required.map((name) =>
    name === "surface_text" ? "source_phrase_id" : name
  );
  delete variable.properties.surface_text;
  variable.properties.source_phrase_id = phraseIds === null
    ? { type: "string", minLength: 1 }
    : {
        type: "string",
        enum: phraseIds,
        description: bindingDescription("source-phrase", bindings.phrases)
      };
  return upgraded;
}

const BASE_SCHEMA = upgradeSchema(BASE_SCHEMA_V026);

function bindGeneralSchema(baseSchema, { sourceText, catalog }) {
  const legacyBound = bindGeneralSchemaV026(BASE_SCHEMA_V026, { sourceText, catalog });
  const bindings = sourceBindings(sourceText);
  const upgraded = upgradeSchema(legacyBound, bindings);
  if (bindings.phrases.length === 0) upgraded.properties.variables.maxItems = 0;
  return upgraded;
}

function mapSpan(span, segmentById) {
  if (typeof span?.text === "string") return span;
  return { text: segmentById.get(span?.source_segment_id) };
}

function downgradePayload(payload, sourceText) {
  const bindings = sourceBindings(sourceText);
  const segmentById = new Map(bindings.segments.map(({ id, text }) => [id, text]));
  const phraseById = new Map(bindings.phrases.map(({ id, text }) => [id, text]));
  const downgraded = structuredClone(payload);
  downgraded.schema_version = "controlled-contract-general.experimental.v0.26";
  downgraded.vocabulary_version = "cv.experimental.0.26";
  downgraded.profile_id = "general-controlled-contract.experimental.v0.26";
  downgraded.variables = (downgraded.variables ?? []).map((variable) => {
    if (typeof variable.surface_text === "string") return variable;
    const { source_phrase_id: ignoredSourcePhraseId, ...rest } = variable;
    return { ...rest, surface_text: phraseById.get(variable.source_phrase_id) };
  });
  const claimArrayNames = [
    "reference_claims", "boolean_claims", "number_claims", "range_claims",
    "verification_reference_claims", "verification_boolean_claims",
    "verification_number_claims", "verification_range_claims"
  ];
  for (const name of claimArrayNames) {
    downgraded[name] = (downgraded[name] ?? []).map((claim) => ({
      ...claim,
      source_spans: (claim.source_spans ?? []).map((span) => mapSpan(span, segmentById)),
      ...(name.startsWith("verification_") ? {
        falsifying_condition_spans: (claim.falsifying_condition_spans ?? [])
          .map((span) => mapSpan(span, segmentById))
      } : {})
    }));
  }
  downgraded.relations = (downgraded.relations ?? []).map((relation) => ({
    ...relation,
    source_spans: (relation.source_spans ?? []).map((span) => mapSpan(span, segmentById))
  }));
  return downgraded;
}

function normalizeGeneralPayload(payload, { sourceText } = {}) {
  if (sourceText === undefined) return structuredClone(payload);
  return downgradePayload(payload, sourceText);
}

function evaluateGeneralContract(payload, { sourceText, catalog }) {
  const result = evaluateGeneralContractV026(downgradePayload(payload, sourceText), {
    sourceText,
    catalog
  });
  if (result.evaluation !== null) {
    result.evaluation.grammar_version =
      "controlled-contract-general-evaluation.experimental.v0.27";
  }
  return result;
}

export {
  BASE_SCHEMA,
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
