
import assert from "node:assert/strict";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  BASE_SCHEMA,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract
} from "./controlled-contract-general-v033.mjs";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const EMPTY_UNIT = { read_scope: [], repo_paths: [], write_scope: [] };

test("v0.33 exposes readable operators only", () => {
  const operators = BASE_SCHEMA.$defs.operator_code.enum;
  assert.equal(operators.includes("reference:replaces"), true);
  assert.equal(operators.includes("boolean:exists"), true);
  assert.equal(operators.some((operator) => /^o[0-9]+$/.test(operator)), false);
  assert.equal(BASE_SCHEMA.description.includes("o###"), false);
});

test("v0.33 validates and compiles a readable boolean claim", () => {
  const sourceText = "The solution must exist.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const candidate = {
    schema_version: "controlled-contract-general.experimental.v0.33",
    vocabulary_version: "cv.experimental.0.33",
    profile_id: "general-controlled-contract.experimental.v0.33",
    variables: [],
    collections: [],
    declarative_claims: [{
      source_spans: [{ source_segment_id: "segment-001" }],
      claim_kind: "behavior",
      operator: "boolean:exists",
      modality: "MUST",
      subject_reference_id: "current_solution",
      applicability_conditions: [],
      set_quantifiers: [],
      numeric_quantifiers: [],
      operand_tokens: ["b:true"]
    }],
    verification_claims: [],
    relations: []
  };
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.equal(
    result.evaluation.grammar_version,
    "controlled-contract-general-evaluation.experimental.v0.33"
  );
});
