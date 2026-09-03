import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  TEST_PROOF_VERSION_V1,
  VOCABULARY_VERSION_V1,
  validateAndResolveNativeContractV1
} from "./native-contract-carrier-v1.mjs";

function validateProjectedContractWithStableCore(contract) {
  const candidate = {
    ...structuredClone(contract),
    schema_version: SCHEMA_VERSION_V1,
    profile_id: PROFILE_ID_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    test_proof_version: TEST_PROOF_VERSION_V1,
    test_proofs: []
  };
  const result = validateAndResolveNativeContractV1(candidate);
  return {
    schema_valid: result.schema_valid,
    schema_errors: result.schema_errors,
    diagnostics: result.diagnostics.filter(
      ({ code }) => code !== "stable_test_proof_missing"
    )
  };
}

export { validateProjectedContractWithStableCore };
