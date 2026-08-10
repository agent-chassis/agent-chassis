
import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_SCHEMA,
  OPERATOR_CODEBOOK,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract
} from "./controlled-contract-general-v031.mjs";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const EMPTY_UNIT = { read_scope: [], repo_paths: [], write_scope: [] };
const operatorCode = (valueKind, predicate) => Object.entries(OPERATOR_CODEBOOK)
  .find(([, value]) => value.value_kind === valueKind && value.predicate === predicate)?.[0];

test("v0.31 makes verification fields unavailable to declarative claims", () => {
  assert.equal("claims" in BASE_SCHEMA.properties, false);
  assert.equal("declarative_claims" in BASE_SCHEMA.properties, true);
  assert.equal("verification_claims" in BASE_SCHEMA.properties, true);
  assert.equal("verification_method" in BASE_SCHEMA.$defs.declarative_claim.properties, false);
  assert.equal("falsifying_condition_spans" in BASE_SCHEMA.$defs.declarative_claim.properties, false);
  assert.equal("claim_kind" in BASE_SCHEMA.$defs.verification_claim.properties, false);
  assert.equal(BASE_SCHEMA.$defs.verification_claim.properties.falsifying_condition_spans.minItems, 1);
});

test("v0.31 compiler merges legal declarative and verification productions", () => {
  const sourceText = "The solution must exist. The test must fail when the solution is reverted.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const common = {
    modality: "MUST",
    subject_reference_id: "current_solution",
    applicability_conditions: [],
    set_quantifiers: [],
    numeric_quantifiers: [],
    value_reference_ids: [],
    boolean_values: [true],
    number_values: [],
    minimum_values: [],
    maximum_values: []
  };
  const candidate = {
    schema_version: "controlled-contract-general.experimental.v0.31",
    vocabulary_version: "cv.experimental.0.31",
    profile_id: "general-controlled-contract.experimental.v0.31",
    variables: [],
    collections: [],
    declarative_claims: [{
      ...common,
      source_spans: [{ source_segment_id: "segment-001" }],
      claim_kind: "behavior",
      operator: operatorCode("boolean", "exists")
    }],
    verification_claims: [{
      ...common,
      source_spans: [{ source_segment_id: "segment-002" }],
      operator: operatorCode("boolean", "fails_when"),
      verification_method: "test_execution",
      falsifying_condition_spans: [{ source_segment_id: "segment-002" }]
    }],
    relations: []
  };
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  assert.equal(bound.$defs.operator_code.enum.includes(operatorCode("number", "returns")), false);
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 2);
});
