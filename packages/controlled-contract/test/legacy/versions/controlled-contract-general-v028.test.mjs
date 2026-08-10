
import assert from "node:assert/strict";
import test from "node:test";

import Ajv from "ajv";

import {
  BASE_SCHEMA,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract
} from "./controlled-contract-general-v028.mjs";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const EMPTY_UNIT = { read_scope: [], repo_paths: [], write_scope: [] };

function payload() {
  return {
    schema_version: "controlled-contract-general.experimental.v0.28",
    vocabulary_version: "cv.experimental.0.28",
    profile_id: "general-controlled-contract.experimental.v0.28",
    variables: [],
    collections: [],
    claims: [],
    relations: []
  };
}

function claim(overrides = {}) {
  return {
    source_spans: [{ source_segment_id: "segment-001" }],
    production: "behavior_boolean",
    modality: "MUST",
    subject_reference_id: "current_solution",
    predicate: "exists",
    applicability_conditions: [],
    set_quantifiers: [],
    numeric_quantifiers: [],
    value_reference_ids: [],
    boolean_values: [true],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: [],
    ...overrides
  };
}

test("v0.28 factors claim kinds into one controlled production", () => {
  assert.equal("claims" in BASE_SCHEMA.properties, true);
  assert.equal("reference_claims" in BASE_SCHEMA.properties, false);
  assert.equal(BASE_SCHEMA.$defs.claim.properties.production.enum.length, 12);
  assert.equal(BASE_SCHEMA.$defs.reference_claim, undefined);
});

test("v0.28 admits a legal compact production", () => {
  const sourceText = "The solution must exist.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.claims.push(claim());
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const validate = new Ajv({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.equal(result.evaluation.status, "complete");
});

test("v0.28 compiler rejects a production with the wrong populated value field", () => {
  const sourceText = "The solution must exist.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.claims.push(claim({ boolean_values: [], number_values: [1] }));
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 0);
  assert.equal(result.evaluation.status, "residue_only");
  assert.equal(result.diagnostics.some(({ code }) => code === "value_field_shape"), true);
  assert.equal(result.evaluation.residue.some(({ diagnostic_reasons: reasons }) =>
    reasons.includes("invalid_controlled_claim")
  ), true);
});

test("v0.28 deduplicates rejected spans and preserves their enumerated operands", () => {
  const sourceText = "The solution records slices, review cycles, and contract rewrites.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.claims.push({
    ...claim({
      source_spans: [{ source_segment_id: "segment-001" }],
      production: "behavior_reference",
      predicate: "records",
      boolean_values: []
    }),
    value_reference_ids: []
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  const wholeSpan = result.evaluation.residue.filter(({ text }) => text === sourceText);
  assert.equal(wholeSpan.length, 1);
  assert.deepEqual(
    new Set(wholeSpan[0].diagnostic_reasons),
    new Set(["unsupported_by_controlled_grammar", "invalid_controlled_claim"])
  );
  assert.equal(result.evaluation.residue.some(({ text, diagnostic_reasons: reasons }) =>
    text === "review cycles" && reasons.includes("unrepresented_enumerated_operand")
  ), true);
});

test("v0.28 bound schema exposes numeric and verification productions together", () => {
  const sourceText = "The test must fail when the solution returns exactly 2 results.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const productions = new Set(bound.$defs.claim.properties.production.enum);
  assert.equal(productions.has("behavior_number"), true);
  assert.equal(productions.has("verification_reference"), true);
  assert.deepEqual(bound.$defs.claim.properties.number_values.items.enum, [2]);
});
