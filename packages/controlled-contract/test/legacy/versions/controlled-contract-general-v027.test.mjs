
import assert from "node:assert/strict";
import test from "node:test";

import Ajv from "ajv";

import {
  BASE_SCHEMA,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract,
  sourceBindings
} from "./controlled-contract-general-v027.mjs";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const EMPTY_UNIT = { read_scope: [], repo_paths: [], write_scope: [] };

function emptyPayload() {
  return {
    schema_version: "controlled-contract-general.experimental.v0.27",
    vocabulary_version: "cv.experimental.0.27",
    profile_id: "general-controlled-contract.experimental.v0.27",
    variables: [],
    collections: [],
    reference_claims: [],
    boolean_claims: [],
    number_claims: [],
    range_claims: [],
    verification_reference_claims: [],
    verification_boolean_claims: [],
    verification_number_claims: [],
    verification_range_claims: [],
    relations: []
  };
}

test("v0.27 binds source prose through short controlled IDs", () => {
  const sourceText = "The deployment candidate must preserve exactly 12 independently observable invariants.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const segmentTerminal = bound.$defs.source_span.properties.source_segment_id;
  const phraseTerminal = bound.$defs.variable.properties.source_phrase_id;
  assert.deepEqual(segmentTerminal.enum, ["segment-001"]);
  assert.equal(segmentTerminal.enum.includes(sourceText), false);
  assert.equal(segmentTerminal.description.includes(sourceText), true);
  assert.equal(phraseTerminal.enum.every((value) => /^phrase-[0-9]{3}$/.test(value)), true);
  assert.equal(phraseTerminal.enum.some((value) => sourceText.includes(value)), false);
});

test("v0.27 resolves source IDs back to exact compiler evidence", () => {
  const sourceText = "The solution must exist.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const candidate = emptyPayload();
  candidate.boolean_claims.push({
    source_spans: [{ source_segment_id: "segment-001" }],
    modality: "MUST",
    subject_reference_id: "current_solution",
    applicability_conditions: [],
    set_quantifiers: [],
    numeric_quantifiers: [],
    claim_kind: "behavior",
    predicate: "exists",
    boolean_values: [true]
  });
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const validate = new Ajv({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.deepEqual(result.evaluation.residue, []);
  assert.equal(result.evaluation.status, "complete");
  assert.equal(result.evaluation.grammar_version.endsWith("v0.27"), true);
});

test("v0.27 rejects invocation IDs that are not bound to the source", () => {
  const sourceText = "The solution must exist.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: EMPTY_UNIT,
    repoRoot: REPO_ROOT
  });
  const candidate = emptyPayload();
  candidate.boolean_claims.push({
    source_spans: [{ source_segment_id: "segment-999" }],
    modality: "MUST",
    subject_reference_id: "current_solution",
    applicability_conditions: [],
    set_quantifiers: [],
    numeric_quantifiers: [],
    claim_kind: "behavior",
    predicate: "exists",
    boolean_values: [true]
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, false);
});

test("v0.27 source binding is deterministic", () => {
  const sourceText = "Authorization must precede delivery, and delivery must precede integration.";
  assert.deepEqual(sourceBindings(sourceText), sourceBindings(sourceText));
  assert.deepEqual(sourceBindings(sourceText).segments.map(({ id }) => id), [
    "segment-001",
    "segment-002"
  ]);
});
