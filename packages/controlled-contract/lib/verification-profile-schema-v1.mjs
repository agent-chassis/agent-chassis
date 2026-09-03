import { compiledValidators } from "./compiled-validator-cache.mjs";
import STABLE_EVALUATION_INPUT_SCHEMA from
  "../schema/controlled-contract-verification-profile-input.v1.schema.json" with { type: "json" };
import STABLE_PROFILE_SCHEMA from
  "../schema/controlled-contract-verification-profile.v1.schema.json" with { type: "json" };
import STABLE_RESULT_SCHEMA from
  "../schema/controlled-contract-verification-profile-result.v1.schema.json" with { type: "json" };

const PROFILE_SCHEMA_VERSION_V1 = "controlled-contract-verification-profile.v1";
const EVALUATION_INPUT_VERSION_V1 =
  "controlled-contract-verification-profile-input.v1";
const RESULT_VERSION_V1 = "controlled-contract-verification-profile-result.v1";

function buildVerificationProfileSchemaV1() {
  return structuredClone(STABLE_PROFILE_SCHEMA);
}

function buildEvaluationInputSchemaV1() {
  return structuredClone(STABLE_EVALUATION_INPUT_SCHEMA);
}

function buildResultSchemaV1() {
  return structuredClone(STABLE_RESULT_SCHEMA);
}

const VERIFICATION_PROFILE_SCHEMA_V1 = buildVerificationProfileSchemaV1();
const VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1 = buildEvaluationInputSchemaV1();
const VERIFICATION_PROFILE_RESULT_SCHEMA_V1 = buildResultSchemaV1();

const {
  validateProfileSchemaV1,
  validateEvaluationInputSchemaV1,
  validateResultSchemaV1
} = await compiledValidators("controlled-contract.verification-profile-schema.v1", {
  validators: {
    validateProfileSchemaV1: VERIFICATION_PROFILE_SCHEMA_V1,
    validateEvaluationInputSchemaV1: VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1,
    validateResultSchemaV1: VERIFICATION_PROFILE_RESULT_SCHEMA_V1
  }
});

export {
  EVALUATION_INPUT_VERSION_V1,
  PROFILE_SCHEMA_VERSION_V1,
  RESULT_VERSION_V1,
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1,
  VERIFICATION_PROFILE_RESULT_SCHEMA_V1,
  VERIFICATION_PROFILE_SCHEMA_V1,
  buildEvaluationInputSchemaV1,
  buildResultSchemaV1,
  buildVerificationProfileSchemaV1,
  validateEvaluationInputSchemaV1,
  validateProfileSchemaV1,
  validateResultSchemaV1
};
