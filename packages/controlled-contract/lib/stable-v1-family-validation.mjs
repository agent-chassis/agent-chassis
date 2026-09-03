import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1,
  validateAndResolveNativeContractV1
} from "./native-contract-carrier-v1.mjs";
import {
  EVALUATION_INPUT_VERSION_V1,
  PROFILE_SCHEMA_VERSION_V1,
  RESULT_VERSION_V1,
  validateEvaluationInputSchemaV1,
  validateProfileSchemaV1,
  validateResultSchemaV1
} from "./verification-profile-schema-v1.mjs";
import { projectBoundedDiagnostics } from "./bounded-diagnostic-projection.mjs";

const STABLE_IDENTITIES = Object.freeze({
  contract_schema_version: SCHEMA_VERSION_V1,
  contract_profile_id: PROFILE_ID_V1,
  vocabulary_version: VOCABULARY_VERSION_V1,
  profile_schema_version: PROFILE_SCHEMA_VERSION_V1,
  input_version: EVALUATION_INPUT_VERSION_V1,
  result_version: RESULT_VERSION_V1
});

const knownExperimental = (value) => typeof value === "string" &&
  (value.includes(".experimental.") || value === "cv.experimental.0.34");

const contractIdentityRows = (contract) => [
  ["/schema_version", SCHEMA_VERSION_V1, contract?.schema_version],
  ["/vocabulary_version", VOCABULARY_VERSION_V1, contract?.vocabulary_version],
  ["/profile_id", PROFILE_ID_V1, contract?.profile_id],
  ["/test_proof_version", "controlled-contract-test-proof.v1",
    contract?.test_proof_version]
];

function identityDiagnostic(pointer, expected, actual) {
  return {
    code: knownExperimental(actual)
      ? "stable_family_experimental_substitution"
      : "stable_family_identity_unknown",
    pointer,
    keyword: "const",
    reason_code: "stable_family_refused",
    expected_identity: expected,
    actual_identity: actual,
    message: "stable runtime accepts only the exact stable-v1 family"
  };
}

function schemaErrors(validator) {
  return (validator.errors ?? []).map((error) => ({
    code: "stable_family_schema_invalid", pointer: error.instancePath || "/",
    keyword: error.keyword, reason_code: "stable_family_refused",
    expected_identity: error.params?.allowedValue ?? null, actual_identity: null,
    message: error.message ?? "stable family schema validation failed"
  }));
}

function validateStableV1ContractFamily(contract) {
  const rows = contractIdentityRows(contract);
  const missing = rows.filter(([, , actual]) => actual === undefined);
  if (!contract || typeof contract !== "object" || Array.isArray(contract) ||
      missing.length > 0) return Object.freeze({
    valid: false,
    stage: "identity",
    family: "partial",
    diagnostics: projectBoundedDiagnostics((missing.length > 0 ? missing : [["/", null,
      contract]]).map(([pointer, expected, actual]) => ({
      code: "stable_family_partial_state",
      pointer,
      keyword: "required",
      reason_code: "stable_family_refused",
      expected_identity: expected,
      actual_identity: actual ?? null,
      message: "stable family identity is incomplete"
    })))
  });
  const mismatches = rows.filter(([, expected, actual]) => actual !== expected);
  if (mismatches.length > 0) {
    const experimentalIdentities = new Set(mismatches.filter(([, , actual]) =>
      knownExperimental(actual)).map(([, , actual]) => String(actual).match(
      /(?:experimental\.v0\.[0-9]+|cv\.experimental\.0\.[0-9]+)/u
    )?.[0] ?? String(actual)));
    const hasExperimental = experimentalIdentities.size > 0;
    const hasUnknown = mismatches.some(([, , actual]) => !knownExperimental(actual));
    const mixed = experimentalIdentities.size > 1 || hasExperimental && hasUnknown;
    const code = mixed ? "stable_family_mixed_state" : hasExperimental
      ? "stable_family_experimental_substitution" : "stable_family_identity_unknown";
    return Object.freeze({
      valid: false,
      stage: "identity",
      family: mixed ? "mixed" : hasExperimental ? "experimental" : "unknown",
      diagnostics: projectBoundedDiagnostics(mismatches.map(
        ([pointer, expected, actual]) => ({
          ...identityDiagnostic(pointer, expected, actual),
          code
        })
      ))
    });
  }
  const validation = validateAndResolveNativeContractV1(contract);
  const diagnostics = [...validation.schema_errors, ...validation.diagnostics];
  return Object.freeze({
    valid: validation.valid,
    stage: validation.valid ? "complete" : "schema_and_semantics",
    family: "stable_v1",
    diagnostics: projectBoundedDiagnostics(diagnostics),
    facts: validation.facts
  });
}

function validateStableV1Family({ contract, profile, input, result = null }) {
  const diagnostics = [];
  for (const [pointer, expected, actual] of [
    ["/contract/schema_version", SCHEMA_VERSION_V1, contract?.schema_version],
    ["/contract/vocabulary_version", VOCABULARY_VERSION_V1,
      contract?.vocabulary_version],
    ["/contract/profile_id", PROFILE_ID_V1, contract?.profile_id],
    ["/profile/schema_version", PROFILE_SCHEMA_VERSION_V1, profile?.schema_version],
    ["/profile/contract_schema_version", SCHEMA_VERSION_V1,
      profile?.contract_schema_version],
    ["/profile/vocabulary_version", VOCABULARY_VERSION_V1,
      profile?.vocabulary_version],
    ["/input/input_version", EVALUATION_INPUT_VERSION_V1, input?.input_version],
    ...(result === null ? [] : [["/result/result_version", RESULT_VERSION_V1,
      result?.result_version]])
  ]) if (actual !== expected) diagnostics.push(identityDiagnostic(pointer, expected, actual));
  if (diagnostics.length > 0) return Object.freeze({ valid: false,
    stage: "identity", diagnostics: projectBoundedDiagnostics(diagnostics) });

  const contractFamily = validateStableV1ContractFamily(contract);
  if (!contractFamily.valid) diagnostics.push(...contractFamily.diagnostics.diagnostics);
  if (!validateProfileSchemaV1(profile)) diagnostics.push(...schemaErrors(validateProfileSchemaV1));
  if (!validateEvaluationInputSchemaV1(input)) diagnostics.push(
    ...schemaErrors(validateEvaluationInputSchemaV1)
  );
  if (result !== null && !validateResultSchemaV1(result)) diagnostics.push(
    ...schemaErrors(validateResultSchemaV1)
  );
  return Object.freeze({
    valid: diagnostics.length === 0,
    stage: diagnostics.length === 0 ? "complete" : "schema_and_semantics",
    diagnostics: projectBoundedDiagnostics(diagnostics)
  });
}

export { STABLE_IDENTITIES, validateStableV1ContractFamily, validateStableV1Family };
