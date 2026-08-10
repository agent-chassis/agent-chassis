
import assert from "node:assert/strict";
import test from "node:test";

import Ajv from "ajv";

import {
  BASE_SCHEMA,
  OPERATOR_CODEBOOK,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract
} from "./controlled-contract-general-v030.mjs";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const EMPTY_UNIT = { read_scope: [], repo_paths: [], write_scope: [] };
const operatorCode = (valueKind, predicate) => Object.entries(OPERATOR_CODEBOOK)
  .find(([, value]) => value.value_kind === valueKind && value.predicate === predicate)?.[0];

test("v0.30 operator tokens close the predicate/value-kind cross product", () => {
  const claim = BASE_SCHEMA.$defs.claim;
  assert.equal("production" in claim.properties, false);
  assert.equal("predicate" in claim.properties, false);
  assert.equal("claim_kind" in claim.properties, true);
  assert.equal("operator" in claim.properties, true);
  assert.notEqual(operatorCode("boolean", "exists"), undefined);
  assert.equal(operatorCode("boolean", "contains"), undefined);
  assert.notEqual(operatorCode("reference", "contains"), undefined);
});

test("v0.30 compiler restores operator value kind and predicate", () => {
  const sourceText = "The solution must exist.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const candidate = {
    schema_version: "controlled-contract-general.experimental.v0.30",
    vocabulary_version: "cv.experimental.0.30",
    profile_id: "general-controlled-contract.experimental.v0.30",
    variables: [],
    collections: [],
    claims: [{
      source_spans: [{ source_segment_id: "segment-001" }],
      claim_kind: "behavior",
      operator: operatorCode("boolean", "exists"),
      modality: "MUST",
      subject_reference_id: "current_solution",
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
    }],
    relations: []
  };
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const validate = new Ajv({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 1);
});

test("v0.30 numeric and verification operators coexist in one bound grammar", () => {
  const sourceText = "The test must fail when the solution returns exactly 2 results.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const codes = new Set(bound.$defs.claim.properties.operator.enum);
  assert.equal(codes.has(operatorCode("number", "returns")), true);
  assert.equal(codes.has(operatorCode("reference", "returns")), true);
  assert.equal(bound.$defs.claim.properties.claim_kind.enum.includes("verification"), true);
});

test("v0.30 range grammar admits a single open bound", () => {
  const sourceText = "The solution must have at most 599 results.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const candidate = {
    schema_version: "controlled-contract-general.experimental.v0.30",
    vocabulary_version: "cv.experimental.0.30",
    profile_id: "general-controlled-contract.experimental.v0.30",
    variables: [],
    collections: [],
    claims: [{
      source_spans: [{ source_segment_id: "segment-001" }],
      claim_kind: "behavior",
      operator: operatorCode("range", "has_cardinality"),
      modality: "MUST",
      subject_reference_id: "current_solution",
      applicability_conditions: [],
      set_quantifiers: [],
      numeric_quantifiers: [],
      value_reference_ids: [],
      boolean_values: [],
      number_values: [],
      minimum_values: [],
      maximum_values: [599],
      verification_methods: [],
      falsifying_condition_spans: []
    }],
    relations: []
  };
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 1);
});

test("v0.30 rejects a malformed claim without erasing a valid sibling", () => {
  const sourceText = "The solution must exist. The solution must contain evidence.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const common = {
    claim_kind: "behavior",
    modality: "MUST",
    subject_reference_id: "current_solution",
    applicability_conditions: [],
    set_quantifiers: [],
    numeric_quantifiers: [],
    value_reference_ids: [],
    boolean_values: [],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  };
  const candidate = {
    schema_version: "controlled-contract-general.experimental.v0.30",
    vocabulary_version: "cv.experimental.0.30",
    profile_id: "general-controlled-contract.experimental.v0.30",
    variables: [],
    collections: [],
    claims: [
      {
        ...common,
        source_spans: [{ source_segment_id: "segment-001" }],
        operator: operatorCode("boolean", "exists"),
        boolean_values: [true]
      },
      {
        ...common,
        source_spans: [{ source_segment_id: "segment-002" }],
        operator: operatorCode("reference", "contains")
      }
    ],
    relations: []
  };
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.equal(result.evaluation.rejected_claims, 1);
  assert.equal(result.evaluation.status, "partial");
  assert.equal(result.evaluation.residue.some(({ text }) => text.includes("contain evidence")), true);
});
