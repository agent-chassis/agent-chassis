
import {
  BASE_SCHEMA as BASE_SCHEMA_V027,
  bindGeneralSchema as bindGeneralSchemaV027,
  buildReferenceCatalog,
  numbersInSource,
  segmentCriterion,
  sourceBindings,
  sourcePhraseTerminals,
  unresolvedIdentityMentions
} from "./controlled-contract-general-v027.mjs";
import {
  coordinatedFragments,
  evaluateGeneralContract as evaluateGeneralContractV026
} from "./controlled-contract-general-v026.mjs";

const VERSION = "0.28";
const VALUE_KINDS = ["reference", "boolean", "number", "range"];
const PREDICATES_BY_VALUE_KIND = Object.freeze(Object.fromEntries(VALUE_KINDS.map((valueKind) => [
  valueKind,
  new Set(BASE_SCHEMA_V027.$defs[`${valueKind}_claim`].properties.predicate.enum)
])));
const PRODUCTIONS = [
  ...["behavior", "evidence"].flatMap((kind) =>
    VALUE_KINDS.map((valueKind) => `${kind}_${valueKind}`)
  ),
  ...VALUE_KINDS.map((valueKind) => `verification_${valueKind}`)
];

function array(items, minItems = 0, maxItems = undefined) {
  return {
    type: "array",
    minItems,
    ...(maxItems === undefined ? {} : { maxItems }),
    items
  };
}

function unionPredicates(schema) {
  return [...new Set([
    ...schema.$defs.reference_claim.properties.predicate.enum,
    ...schema.$defs.boolean_claim.properties.predicate.enum,
    ...schema.$defs.number_claim.properties.predicate.enum,
    ...schema.$defs.range_claim.properties.predicate.enum
  ])];
}

function claimDefinition(schema, productions) {
  const numericEnum = schema.$defs.number_claim.properties.number_values.items.enum;
  const amountSchema = structuredClone(schema.$defs.numeric_quantifier.properties.amount);
  const numberItem = numericEnum === undefined
    ? { type: "number" }
    : { type: "number", enum: numericEnum };
  return {
    type: "object",
    required: [
      "source_spans", "production", "modality", "subject_reference_id", "predicate",
      "applicability_conditions", "set_quantifiers", "numeric_quantifiers",
      "value_reference_ids", "boolean_values", "number_values",
      "minimum_values", "maximum_values", "verification_methods",
      "falsifying_condition_spans"
    ],
    additionalProperties: false,
    properties: {
      source_spans: array({ $ref: "#/$defs/source_span" }, 1),
      production: {
        type: "string",
        enum: productions,
        description: "Controlled production. The suffix selects the only populated value field: reference -> value_reference_ids, boolean -> boolean_values, number -> number_values, range -> minimum_values and maximum_values. Verification productions alone populate verification_methods and falsifying_condition_spans. The compiler rejects every inconsistent combination."
      },
      modality: { type: "string", enum: ["MUST", "MUST_NOT", "SHOULD", "SHOULD_NOT", "MAY"] },
      subject_reference_id: { $ref: "#/$defs/reference_id" },
      predicate: { type: "string", enum: unionPredicates(schema) },
      applicability_conditions: array({ $ref: "#/$defs/condition" }, 0, 1),
      set_quantifiers: array({ $ref: "#/$defs/set_quantifier" }),
      numeric_quantifiers: {
        ...array({ $ref: "#/$defs/numeric_quantifier" }),
        ...(schema.$defs.reference_claim.properties.numeric_quantifiers.maxItems === 0
          ? { maxItems: 0 }
          : {})
      },
      value_reference_ids: array({ $ref: "#/$defs/reference_id" }),
      boolean_values: array({ type: "boolean" }),
      number_values: array(numberItem),
      minimum_values: array(numberItem, 0, 1),
      maximum_values: array(numberItem, 0, 1),
      verification_methods: array({
        type: "string",
        enum: ["inspection", "analysis", "demonstration", "test_execution", "audit", "proof"]
      }, 0, 1),
      falsifying_condition_spans: array({ $ref: "#/$defs/source_span" })
    }
  };
}

function compactSchema(schema) {
  const compact = structuredClone(schema);
  compact.title = "controlled-contract-general.experimental.v0.28";
  compact.description = "NONCANONICAL EXPERIMENTAL general controlled-contract grammar. One controlled production enum selects claim kind and value kind; the deterministic compiler enforces the production's legal field combination. Source segments and phrases remain invocation-bound IDs and exact prose remains compiler evidence and residue.";
  compact.properties.schema_version.enum = ["controlled-contract-general.experimental.v0.28"];
  compact.properties.vocabulary_version.enum = ["cv.experimental.0.28"];
  compact.properties.profile_id.enum = ["general-controlled-contract.experimental.v0.28"];

  const numericAvailable = schema.properties.number_claims.maxItems !== 0;
  const verificationAvailable = schema.properties.verification_reference_claims.maxItems !== 0;
  const productions = PRODUCTIONS.filter((production) => {
    if (!numericAvailable && (production.endsWith("_number") || production.endsWith("_range"))) return false;
    if (!verificationAvailable && production.startsWith("verification_")) return false;
    return true;
  });
  const removedClaimProperties = [
    "reference_claims", "boolean_claims", "number_claims", "range_claims",
    "verification_reference_claims", "verification_boolean_claims",
    "verification_number_claims", "verification_range_claims"
  ];
  compact.required = compact.required.filter((name) => !removedClaimProperties.includes(name));
  compact.required.splice(compact.required.indexOf("relations"), 0, "claims");
  for (const name of removedClaimProperties) delete compact.properties[name];
  compact.properties.claims = array({ $ref: "#/$defs/claim" });
  compact.$defs.claim = claimDefinition(schema, productions);
  compact.$defs.numeric_quantifier.properties.amount =
    schema.$defs.numeric_quantifier.properties.amount;
  for (const name of [
    "reference_claim", "boolean_claim", "number_claim", "range_claim",
    "verification_reference_claim", "verification_boolean_claim",
    "verification_number_claim", "verification_range_claim"
  ]) delete compact.$defs[name];
  return compact;
}

const BASE_SCHEMA = compactSchema(BASE_SCHEMA_V027);

function bindGeneralSchema(baseSchema, { sourceText, catalog }) {
  return compactSchema(bindGeneralSchemaV027(BASE_SCHEMA_V027, { sourceText, catalog }));
}

function mapSpan(span, segmentById) {
  if (typeof span?.text === "string") return span;
  return { text: segmentById.get(span?.source_segment_id) };
}

function downgradePayload(payload, sourceText) {
  const bindings = sourceBindings(sourceText);
  const segmentById = new Map(bindings.segments.map(({ id, text }) => [id, text]));
  const phraseById = new Map(bindings.phrases.map(({ id, text }) => [id, text]));
  const claims = (payload.claims ?? []).map((claim) => {
    const separator = claim.production.indexOf("_");
    const claimKind = claim.production.slice(0, separator);
    const valueKind = claim.production.slice(separator + 1);
    return {
      source_spans: claim.source_spans.map((span) => mapSpan(span, segmentById)),
      claim_kind: claimKind,
      modality: claim.modality,
      subject_reference_id: claim.subject_reference_id,
      predicate: claim.predicate,
      applicability_context: claim.applicability_conditions.length === 0
        ? { mode: "unconditional", operand_reference_ids: [] }
        : claim.applicability_conditions[0],
      quantifiers: [
        ...claim.set_quantifiers.map((quantifier) => ({ ...quantifier, amounts: [] })),
        ...claim.numeric_quantifiers.map((quantifier) => ({
          kind: quantifier.kind,
          variable_reference_ids: quantifier.variable_reference_ids,
          amounts: [quantifier.amount]
        }))
      ],
      value_kind: valueKind,
      value_reference_ids: claim.value_reference_ids,
      boolean_values: claim.boolean_values,
      number_values: claim.number_values,
      minimum_values: claim.minimum_values,
      maximum_values: claim.maximum_values,
      verification_methods: claim.verification_methods,
      falsifying_condition_spans: claim.falsifying_condition_spans
        .map((span) => mapSpan(span, segmentById))
    };
  });
  return {
    schema_version: "controlled-contract-general.experimental.v0.26",
    vocabulary_version: "cv.experimental.0.26",
    profile_id: "general-controlled-contract.experimental.v0.26",
    variables: (payload.variables ?? []).map((variable) => {
      if (typeof variable.surface_text === "string") return variable;
      const { source_phrase_id: ignoredSourcePhraseId, ...rest } = variable;
      return { ...rest, surface_text: phraseById.get(variable.source_phrase_id) };
    }),
    collections: payload.collections ?? [],
    claims,
    relations: (payload.relations ?? []).map((relation) => ({
      ...relation,
      source_spans: relation.source_spans.map((span) => mapSpan(span, segmentById))
    }))
  };
}

function normalizeGeneralPayload(payload, { sourceText } = {}) {
  if (sourceText === undefined) return structuredClone(payload);
  return downgradePayload(payload, sourceText);
}

function compactClaimErrors(claim, index) {
  const owner = `claim-${index + 1}`;
  const errors = [];
  const separator = claim.production.indexOf("_");
  const claimKind = claim.production.slice(0, separator);
  const valueKind = claim.production.slice(separator + 1);
  if (!PREDICATES_BY_VALUE_KIND[valueKind]?.has(claim.predicate)) {
    errors.push({
      code: "predicate_value_kind_mismatch",
      owner,
      predicate: claim.predicate,
      value_kind: valueKind
    });
  }
  const populated = {
    reference: claim.value_reference_ids.length > 0,
    boolean: claim.boolean_values.length > 0,
    number: claim.number_values.length > 0,
    range: claim.minimum_values.length > 0 || claim.maximum_values.length > 0
  };
  for (const [candidateKind, isPopulated] of Object.entries(populated)) {
    if (isPopulated !== (candidateKind === valueKind)) {
      errors.push({ code: "value_field_shape", owner, value_kind: valueKind });
      break;
    }
  }
  const verificationShape = claim.verification_methods.length === 1 &&
    claim.falsifying_condition_spans.length > 0;
  const declarativeShape = claim.verification_methods.length === 0 &&
    claim.falsifying_condition_spans.length === 0;
  if (claimKind === "verification" ? !verificationShape : !declarativeShape) {
    errors.push({ code: "verification_shape", owner, claim_kind: claimKind });
  }
  return errors;
}

function evaluateGeneralContract(payload, { sourceText, catalog }) {
  const compactDiagnostics = (payload.claims ?? []).flatMap(compactClaimErrors);
  const rejectedOwners = new Set(compactDiagnostics.map(({ owner }) => owner));
  const compilablePayload = {
    ...payload,
    claims: (payload.claims ?? []).filter((ignoredClaim, index) =>
      !rejectedOwners.has(`claim-${index + 1}`)
    )
  };
  const result = evaluateGeneralContractV026(downgradePayload(compilablePayload, sourceText), {
    sourceText,
    catalog
  });
  if (!result.schema_valid || result.evaluation === null) return result;
  result.diagnostics = [...compactDiagnostics, ...result.diagnostics];
  if (compactDiagnostics.length > 0) {
    const segmentById = new Map(sourceBindings(sourceText).segments.map(({ id, text }) => [id, text]));
    const invalidTexts = new Set();
    for (const index of (payload.claims ?? []).keys()) {
      if (!rejectedOwners.has(`claim-${index + 1}`)) continue;
      for (const span of payload.claims[index].source_spans) {
        const text = segmentById.get(span.source_segment_id);
        if (text !== undefined) invalidTexts.add(text);
      }
    }
    const existing = new Map(result.evaluation.residue.map((entry) => [entry.text, entry]));
    const addResidue = (text, reason) => {
      const prior = existing.get(text);
      if (prior !== undefined) {
        prior.diagnostic_reasons ??= [prior.reason];
        if (!prior.diagnostic_reasons.includes(reason)) prior.diagnostic_reasons.push(reason);
        return;
      }
      const entry = {
        residue_id: `derived-residue-${String(result.evaluation.residue.length + 1).padStart(4, "0")}`,
        text,
        reason,
        diagnostic_reasons: [reason],
        origin: "compiler"
      };
      result.evaluation.residue.push(entry);
      existing.set(text, entry);
    };
    for (const text of invalidTexts) {
      addResidue(text, "invalid_controlled_claim");
      for (const fragment of coordinatedFragments(text)) {
        addResidue(fragment, "unrepresented_enumerated_operand");
      }
    }
    result.evaluation.rejected_claims += rejectedOwners.size;
    result.evaluation.residue_entries =
      result.evaluation.residue.length + result.evaluation.carrier_overlap.length;
    result.evaluation.compiler_clean = false;
    result.evaluation.status =
      result.evaluation.admitted_claims + result.evaluation.admitted_relations === 0
        ? "residue_only"
        : "partial";
  }
  if (result.evaluation !== null) {
    result.evaluation.grammar_version =
      "controlled-contract-general-evaluation.experimental.v0.28";
  }
  return result;
}

export {
  BASE_SCHEMA,
  PRODUCTIONS,
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
