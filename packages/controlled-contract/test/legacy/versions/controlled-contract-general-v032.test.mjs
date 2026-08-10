
import assert from "node:assert/strict";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  BASE_SCHEMA,
  OPERATOR_CODEBOOK,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract
} from "./controlled-contract-general-v032.mjs";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const EMPTY_UNIT = { read_scope: [], repo_paths: [], write_scope: [] };
const operatorCode = (valueKind, predicate) => Object.entries(OPERATOR_CODEBOOK)
  .find(([, value]) => value.value_kind === valueKind && value.predicate === predicate)?.[0];

function payload() {
  return {
    schema_version: "controlled-contract-general.experimental.v0.32",
    vocabulary_version: "cv.experimental.0.32",
    profile_id: "general-controlled-contract.experimental.v0.32",
    variables: [],
    collections: [],
    declarative_claims: [],
    verification_claims: [],
    relations: []
  };
}

function commonClaim() {
  return {
    source_spans: [{ source_segment_id: "segment-001" }],
    modality: "MUST",
    subject_reference_id: "current_solution",
    applicability_conditions: [],
    set_quantifiers: [],
    numeric_quantifiers: []
  };
}

test("v0.32 exposes one required controlled operand array", () => {
  const declarative = BASE_SCHEMA.$defs.declarative_claim;
  assert.equal(declarative.properties.operand_tokens.minItems, 1);
  for (const name of [
    "value_reference_ids", "boolean_values", "number_values", "minimum_values", "maximum_values"
  ]) assert.equal(name in declarative.properties, false);
});

test("v0.32 wire schema rejects multiple ranges in one claim", () => {
  const sourceText = "The check compares 7.76-10.52 seconds with 0.58-0.61 seconds.";
  const catalog = buildReferenceCatalog({ sourceText, unitId: "WK-1000", unit: EMPTY_UNIT, repoRoot: REPO_ROOT });
  const candidate = payload();
  candidate.verification_claims.push({
    ...commonClaim(),
    operator: operatorCode("range", "has_range"),
    operand_tokens: ["min:7.76", "max:10.52", "min:0.58", "max:0.61"],
    verification_method: "analysis",
    falsifying_condition_spans: [{ source_segment_id: "segment-001" }]
  });
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(candidate), false);
  assert.equal(evaluateGeneralContract(candidate, { sourceText, catalog }).schema_valid, false);
});

test("v0.32 wire schema rejects duplicate lower range bounds", () => {
  const sourceText = "The range begins at either 0.58 or 7.76 seconds.";
  const catalog = buildReferenceCatalog({ sourceText, unitId: "WK-1000", unit: EMPTY_UNIT, repoRoot: REPO_ROOT });
  const candidate = payload();
  candidate.declarative_claims.push({
    ...commonClaim(),
    claim_kind: "behavior",
    operator: operatorCode("range", "has_range"),
    operand_tokens: ["min:0.58", "min:7.76"]
  });
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(candidate), false);
  assert.equal(evaluateGeneralContract(candidate, { sourceText, catalog }).schema_valid, false);
});

test("v0.32 schema rejects an empty claim before compilation", () => {
  const sourceText = "The solution must contain evidence.";
  const catalog = buildReferenceCatalog({ sourceText, unitId: "WK-1000", unit: EMPTY_UNIT, repoRoot: REPO_ROOT });
  const candidate = payload();
  candidate.declarative_claims.push({
    ...commonClaim(),
    claim_kind: "behavior",
    operator: operatorCode("reference", "contains"),
    operand_tokens: []
  });
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(candidate), false);
  assert.equal(evaluateGeneralContract(candidate, { sourceText, catalog }).schema_valid, false);
});

test("v0.32 admits a controlled boolean operand", () => {
  const sourceText = "The solution must exist.";
  const catalog = buildReferenceCatalog({ sourceText, unitId: "WK-1000", unit: EMPTY_UNIT, repoRoot: REPO_ROOT });
  const candidate = payload();
  candidate.declarative_claims.push({
    ...commonClaim(),
    claim_kind: "behavior",
    operator: operatorCode("boolean", "exists"),
    operand_tokens: ["b:true"]
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 1);
});

test("v0.32 wire schema rejects an operator/operand kind mismatch", () => {
  const sourceText = "The solution must exist.";
  const catalog = buildReferenceCatalog({ sourceText, unitId: "WK-1000", unit: EMPTY_UNIT, repoRoot: REPO_ROOT });
  const candidate = payload();
  candidate.declarative_claims.push({
    ...commonClaim(),
    claim_kind: "behavior",
    operator: operatorCode("boolean", "exists"),
    operand_tokens: ["r:current_solution"]
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, false);
  assert.equal(result.evaluation, null);
});

test("v0.32 rejects a verification claim without a discriminating falsifier", () => {
  const sourceText = "The analysis records a counterfactual question.";
  const catalog = buildReferenceCatalog({ sourceText, unitId: "WK-1000", unit: EMPTY_UNIT, repoRoot: REPO_ROOT });
  const candidate = payload();
  candidate.verification_claims.push({
    ...commonClaim(),
    operator: operatorCode("boolean", "exists"),
    operand_tokens: ["b:true"],
    verification_method: "analysis",
    falsifying_condition_spans: [{ source_segment_id: "segment-001" }]
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 0);
  assert.equal(result.diagnostics.some(({ code }) => code === "falsifier_not_discriminating"), true);
});

test("v0.32 retains a one-sentence discriminating falsifier", () => {
  const sourceText = "The test must fail when the solution is reverted.";
  const catalog = buildReferenceCatalog({ sourceText, unitId: "WK-1000", unit: EMPTY_UNIT, repoRoot: REPO_ROOT });
  const candidate = payload();
  candidate.verification_claims.push({
    ...commonClaim(),
    operator: operatorCode("boolean", "fails_when"),
    operand_tokens: ["b:true"],
    verification_method: "test_execution",
    falsifying_condition_spans: [{ source_segment_id: "segment-001" }]
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.equal(result.diagnostics.some(({ code }) => code === "falsifier_not_discriminating"), false);
});
