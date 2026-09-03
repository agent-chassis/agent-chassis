import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EVALUATION_INPUT_VERSION_V1,
  PROFILE_SCHEMA_VERSION_V1,
  RESULT_VERSION_V1,
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1,
  VERIFICATION_PROFILE_RESULT_SCHEMA_V1,
  VERIFICATION_PROFILE_SCHEMA_V1,
  buildEvaluationInputSchemaV1,
  buildResultSchemaV1,
  buildVerificationProfileSchemaV1
} from "../../lib/verification-profile-schema-v1.mjs";
import { SCHEMA_VERSION_V1, VOCABULARY_VERSION_V1 } from
  "../../lib/native-contract-carrier-v1.mjs";

const tracked = async (name) => JSON.parse(await readFile(new URL(
  `../../schema/${name}`, import.meta.url
)));

test("stable profile, input, and result schemas carry exact independent identities", async () => {
  assert.equal(VERIFICATION_PROFILE_SCHEMA_V1.title, PROFILE_SCHEMA_VERSION_V1);
  assert.equal(VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1.title,
    EVALUATION_INPUT_VERSION_V1);
  assert.equal(VERIFICATION_PROFILE_RESULT_SCHEMA_V1.title, RESULT_VERSION_V1);
  assert.deepEqual(buildVerificationProfileSchemaV1(), VERIFICATION_PROFILE_SCHEMA_V1);
  assert.deepEqual(buildEvaluationInputSchemaV1(),
    VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1);
  assert.deepEqual(buildResultSchemaV1(), VERIFICATION_PROFILE_RESULT_SCHEMA_V1);
  assert.deepEqual(await tracked("controlled-contract-verification-profile.v1.schema.json"),
    VERIFICATION_PROFILE_SCHEMA_V1);
  assert.deepEqual(await tracked(
    "controlled-contract-verification-profile-input.v1.schema.json"
  ), VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1);
  assert.deepEqual(await tracked(
    "controlled-contract-verification-profile-result.v1.schema.json"
  ), VERIFICATION_PROFILE_RESULT_SCHEMA_V1);
});

test("stable profile schema closes every family identity", () => {
  assert.deepEqual(VERIFICATION_PROFILE_SCHEMA_V1.properties.schema_version.enum,
    [PROFILE_SCHEMA_VERSION_V1]);
  assert.deepEqual(VERIFICATION_PROFILE_SCHEMA_V1.properties.contract_schema_version.enum,
    [SCHEMA_VERSION_V1]);
  assert.deepEqual(VERIFICATION_PROFILE_SCHEMA_V1.properties.vocabulary_version.enum,
    [VOCABULARY_VERSION_V1]);
  assert.deepEqual(
    VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1.properties.input_version.enum,
    [EVALUATION_INPUT_VERSION_V1]
  );
  assert.deepEqual(VERIFICATION_PROFILE_RESULT_SCHEMA_V1.properties.result_version.enum,
    [RESULT_VERSION_V1]);
});

test("stable schemas natively expose semantic and provider-bound test-validity surfaces", () => {
  assert.deepEqual(
    VERIFICATION_PROFILE_SCHEMA_V1.properties.stable_capabilities.properties
      .semantic_mechanisms.items.enum,
    ["association", "partition", "relation_match", "inverse", "transitive",
      "irreflexive", "adjacency", "acyclic"]
  );
  assert.equal(
    VERIFICATION_PROFILE_SCHEMA_V1.properties.stable_capabilities.properties
      .test_validity.const,
    "provider_bound_test_validity.v1"
  );
  assert.ok(VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1.required.includes(
    "stable_evaluation"
  ));
  assert.equal(
    VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1.$defs.stable_evaluation.properties
      .test_validity.type,
    "array"
  );
  assert.equal(
    VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1.properties.stable_evaluation.$ref,
    "#/$defs/stable_evaluation"
  );
  assert.ok(VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1.$defs.test_validity);
  assert.ok(VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1.$defs.provider);
  assert.deepEqual(
    VERIFICATION_PROFILE_RESULT_SCHEMA_V1.properties.stable_evaluation.required,
    ["semantic_request_count", "test_validity_evaluated", "diagnostic_count",
      "satisfaction"]
  );
  for (const field of [
    "diagnostics", "total_count", "returned_count", "omitted_count", "truncated"
  ]) assert.ok(VERIFICATION_PROFILE_RESULT_SCHEMA_V1.required.includes(field), field);
  assert.equal(JSON.stringify({ profile: VERIFICATION_PROFILE_SCHEMA_V1,
    input: VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1,
    result: VERIFICATION_PROFILE_RESULT_SCHEMA_V1 }).includes("experimental"), false);
});
