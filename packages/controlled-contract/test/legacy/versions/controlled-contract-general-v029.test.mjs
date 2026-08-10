
import assert from "node:assert/strict";
import test from "node:test";

import Ajv from "ajv";

import {
  BASE_SCHEMA,
  PREDICATE_BY_VALUE,
  PREDICATE_CODEBOOK,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract
} from "./controlled-contract-general-v029.mjs";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const EMPTY_UNIT = { read_scope: [], repo_paths: [], write_scope: [] };

function payload() {
  return {
    schema_version: "controlled-contract-general.experimental.v0.29",
    vocabulary_version: "cv.experimental.0.29",
    profile_id: "general-controlled-contract.experimental.v0.29",
    variables: [],
    collections: [],
    claims: [],
    relations: []
  };
}

test("v0.29 predicate wire codes are stable, unique, and fully mapped", () => {
  const codes = Object.keys(PREDICATE_CODEBOOK);
  const values = Object.values(PREDICATE_CODEBOOK);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(new Set(values).size, values.length);
  assert.equal(codes.every((code) => /^p[0-9]{3}$/.test(code)), true);
  assert.equal(BASE_SCHEMA.$defs.claim.properties.predicate.enum.length, values.length);
  assert.equal(PREDICATE_BY_VALUE.get("exists") !== undefined, true);
});

test("v0.29 schema publishes the wire-code meaning without long enum terminals", () => {
  const predicate = BASE_SCHEMA.$defs.claim.properties.predicate;
  assert.equal(predicate.enum.includes("semantically_equivalent"), false);
  assert.equal(predicate.description.includes("semantically_equivalent"), true);
});

test("v0.29 compiler decodes a predicate before semantic evaluation", () => {
  const sourceText = "The solution must exist.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.claims.push({
    source_spans: [{ source_segment_id: "segment-001" }],
    production: "behavior_boolean",
    modality: "MUST",
    subject_reference_id: "current_solution",
    predicate: PREDICATE_BY_VALUE.get("exists"),
    applicability_conditions: [],
    set_quantifiers: [],
    numeric_quantifiers: [],
    value_reference_ids: [],
    boolean_values: [true],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  });
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const validate = new Ajv({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.equal(result.evaluation.status, "complete");
});
