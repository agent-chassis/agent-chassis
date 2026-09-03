import { compareCodeUnits, stableSemanticKey } from
  "./equality-normalization-v1.mjs";
import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  TEST_PROOF_VERSION_V1,
  VOCABULARY_VERSION_V1,
  validateAndResolveNativeContractV1
} from "./native-contract-carrier-v1.mjs";
import {
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION
} from "./test-proof-provider-registry.mjs";
import { projectBoundedDiagnostics } from "./bounded-diagnostic-projection.mjs";
import { validateProjectedContractWithStableCore } from
  "./projected-contract-validation.mjs";

const SCHEMA_VERSION_V034 = "controlled-acceptance-contract.experimental.v0.2";
const PROFILE_ID_V034 = "acceptance-contract.standard.experimental.v0.2";
const VOCABULARY_VERSION_V034 = "cv.experimental.0.34";
const TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03 =
  "controlled-acceptance-contract.experimental.v0.3";
const TEST_PROOF_CONTRACT_PROFILE_ID_V03 =
  "acceptance-contract.standard.experimental.v0.3";

const STABLE_MIGRATION_REASON_CODES = Object.freeze([
  "stable_migration_source_invalid",
  "stable_migration_source_family_unsupported",
  "stable_migration_source_already_stable",
  "stable_migration_partial_or_mixed_family",
  "stable_migration_test_proofs_required",
  "stable_migration_provider_bindings_required",
  "stable_migration_supplement_forbidden",
  "stable_migration_result_invalid",
  "stable_migration_ambiguous"
]);

class StableMigrationError extends Error {
  constructor(reasonCode, diagnostics = []) {
    super(`stable-v1 migration refused: ${reasonCode}`);
    this.name = "StableMigrationError";
    this.reason_code = reasonCode;
    this.code = reasonCode;
    this.diagnostics = projectBoundedDiagnostics(diagnostics.map((diagnostic) => ({
      ...diagnostic, reason_code: reasonCode
    })));
  }
}

function refuse(reasonCode, diagnostics = []) {
  throw new StableMigrationError(reasonCode, diagnostics.length > 0 ? diagnostics : [{
    code: reasonCode, pointer: "/", keyword: "migrationDecision",
    message: `migration refused by ${reasonCode}`
  }]);
}

const identity = (pointer, expected, actual, code = "migration_identity_mismatch") => ({
  code, pointer, keyword: "const", expected_identity: expected,
  actual_identity: actual, message: "carrier family identity mismatch"
});

function exactIdentity(source, schema, profile, vocabulary) {
  return source?.schema_version === schema && source?.profile_id === profile &&
    source?.vocabulary_version === vocabulary;
}

const knownSchemas = new Set([
  SCHEMA_VERSION_V034, TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03, SCHEMA_VERSION_V1
]);
const knownProfiles = new Set([
  PROFILE_ID_V034, TEST_PROOF_CONTRACT_PROFILE_ID_V03, PROFILE_ID_V1
]);
const knownVocabularies = new Set([VOCABULARY_VERSION_V034, VOCABULARY_VERSION_V1]);
const wellFormedFamily = (value) => typeof value === "string" &&
  /^[a-z][a-z0-9.-]+(?:v[0-9]+(?:\.[0-9]+)*)$/u.test(value);

function classifySource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return "invalid";
  const hasProofVersion = Object.hasOwn(source, "test_proof_version");
  const hasProofs = Object.hasOwn(source, "test_proofs");
  if (exactIdentity(source, SCHEMA_VERSION_V1, PROFILE_ID_V1, VOCABULARY_VERSION_V1) &&
      source.test_proof_version === TEST_PROOF_VERSION_V1 && hasProofs) return "stable";
  const v02 = exactIdentity(source, SCHEMA_VERSION_V034, PROFILE_ID_V034,
    VOCABULARY_VERSION_V034) && !hasProofVersion && !hasProofs;
  const v03 = exactIdentity(source, TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03,
    TEST_PROOF_CONTRACT_PROFILE_ID_V03, VOCABULARY_VERSION_V034) &&
    source.test_proof_version === TEST_PROOF_VERSION_V1 && hasProofs;
  if (v02) return "v0.2";
  if (v03) return "v0.3";
  const markers = [source.schema_version, source.profile_id, source.vocabulary_version];
  if (markers.some((value) => knownSchemas.has(value) || knownProfiles.has(value) ||
      knownVocabularies.has(value)) || hasProofVersion || hasProofs) return "partial_or_mixed";
  if (wellFormedFamily(source.schema_version) && wellFormedFamily(source.profile_id) &&
      wellFormedFamily(source.vocabulary_version)) return "unsupported";
  return "invalid";
}

function classificationGate(source) {
  const family = classifySource(source);
  if (family === "stable") refuse("stable_migration_source_already_stable", [
    identity("/schema_version", "an experimental source family", source.schema_version)
  ]);
  if (family === "partial_or_mixed") refuse("stable_migration_partial_or_mixed_family", [
    identity("/", "one exact v0.2 or v0.3 family", {
      schema_version: source?.schema_version ?? null,
      profile_id: source?.profile_id ?? null,
      vocabulary_version: source?.vocabulary_version ?? null
    }, "migration_family_mixed")
  ]);
  if (family === "unsupported") refuse("stable_migration_source_family_unsupported", [
    identity("/schema_version", [SCHEMA_VERSION_V034,
      TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03], source.schema_version)
  ]);
  if (family === "invalid") refuse("stable_migration_source_invalid", [{
    code: "migration_source_unclassifiable", pointer: "/", keyword: "type",
    message: "migration source is malformed or unclassifiable"
  }]);
  return family;
}

function proofClaims(contract) {
  return contract.claims.filter(({ kind, verification_method: method }) =>
    kind === "verification" && method === "test_execution"
  ).map(({ claim_id: claimId }) => claimId).sort(compareCodeUnits);
}

function ambiguousProofDiagnostics(testProofs) {
  if (!Array.isArray(testProofs)) return [];
  const byClaim = new Map();
  const diagnostics = [];
  for (const [index, proof] of testProofs.entries()) {
    const claimId = proof?.verification_claim_id;
    const prior = byClaim.get(claimId);
    if (prior && stableSemanticKey(prior.proof) !== stableSemanticKey(proof)) diagnostics.push({
      code: "migration_supplement_authority_conflict", pointer: `/test_proofs/${index}`,
      keyword: "uniqueAuthority", expected_identity: prior.proof.test_proof_id ?? null,
      actual_identity: proof?.test_proof_id ?? null,
      message: "duplicate nonidentical proof authorities are ambiguous"
    });
    if (!prior) byClaim.set(claimId, { index, proof });
  }
  return diagnostics;
}

function incompleteProofDiagnostics(contract, testProofs) {
  if (!Array.isArray(testProofs)) return [{ code: "migration_test_proofs_absent",
    pointer: "/test_proofs", keyword: "required", message: "test proofs are required" }];
  const required = proofClaims(contract);
  const counts = new Map();
  for (const proof of testProofs) counts.set(proof?.verification_claim_id,
    (counts.get(proof?.verification_claim_id) ?? 0) + 1);
  return required.flatMap((claimId) => counts.get(claimId) === 1 ? [] : [{
    code: "migration_test_proof_population_incomplete", pointer: "/test_proofs",
    keyword: "completePopulation", expected_identity: claimId,
    actual_identity: counts.get(claimId) ?? 0,
    message: "each test_execution claim requires exactly one authored proof"
  }]);
}

function providerDiagnostics(testProofs) {
  return testProofs.flatMap((proof, index) => {
    const diagnostics = [];
    const validateProvider = (provider, capability, pointer, extraKeys = []) => {
      const requiredKeys = ["capability", "provider_id", "provider_version", ...extraKeys]
        .sort(compareCodeUnits);
      if (!provider || typeof provider !== "object" || Array.isArray(provider) ||
          JSON.stringify(Object.keys(provider).sort(compareCodeUnits)) !==
            JSON.stringify(requiredKeys)) {
        diagnostics.push({ code: "migration_provider_binding_malformed", pointer,
          keyword: "closedProviderBinding",
          message: "provider binding must have one complete closed shape" });
        return;
      }
      const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
        ({ provider_id: providerId }) => providerId === provider.provider_id
      );
      if (!descriptor || provider.provider_version !== descriptor.provider_version ||
          provider.capability !== capability || !descriptor.capabilities.includes(capability)) {
        diagnostics.push({ code: "migration_provider_binding_incompatible", pointer,
          keyword: "providerCompatibility", expected_identity: capability,
          actual_identity: provider.capability ?? null,
          message: "provider binding must match the package provider registry" });
      }
      if (capability === "boundary_traversal" && (
        !descriptor?.boundary_kinds.includes(provider.boundary_kind) ||
        !descriptor?.observation_mechanisms.includes(provider.observation_mechanism) ||
        !descriptor?.observation_seams.includes(provider.observation_seam) ||
        !descriptor?.evidence_artifact_types.includes(provider.evidence_artifact_type)
      )) diagnostics.push({ code: "migration_provider_binding_incompatible", pointer,
        keyword: "providerCompatibility",
        message: "traversal provider details must match the package provider registry" });
    };
    validateProvider(proof?.candidate_execution_provider, "candidate_execution",
      `/test_proofs/${index}/candidate_execution_provider`);
    const falsifiers = Array.isArray(proof?.falsifiers) ? proof.falsifiers : [];
    if (!Array.isArray(proof?.falsifiers)) diagnostics.push({
      code: "migration_provider_binding_malformed",
      pointer: `/test_proofs/${index}/falsifiers`, keyword: "type",
      message: "falsifier provider population must be an array"
    });
    for (const [falsifierIndex, falsifier] of falsifiers.entries()) {
      validateProvider(falsifier?.execution_provider, "falsifier_execution",
        `/test_proofs/${index}/falsifiers/${falsifierIndex}/execution_provider`);
    }
    const traversal = proof?.traversal_provider;
    if (traversal?.mode === "registry_unsupported") {
      const keys = Object.keys(traversal).sort(compareCodeUnits);
      if (JSON.stringify(keys) !== JSON.stringify([
        "mode", "registry_id", "registry_version"
      ]) || traversal.registry_id !== TEST_PROOF_PROVIDER_REGISTRY_ID ||
          traversal.registry_version !== TEST_PROOF_PROVIDER_REGISTRY_VERSION) {
        diagnostics.push({ code: "migration_provider_binding_incompatible",
          pointer: `/test_proofs/${index}/traversal_provider`,
          keyword: "providerCompatibility",
          message: "unsupported traversal must bind the exact provider registry" });
      }
    } else {
      validateProvider(traversal, "boundary_traversal",
        `/test_proofs/${index}/traversal_provider`, [
          "boundary_kind", "evidence_artifact_type", "mode", "observation_mechanism",
          "observation_seam"
        ]);
      if (traversal?.mode !== "provider") diagnostics.push({
        code: "migration_provider_binding_incompatible",
        pointer: `/test_proofs/${index}/traversal_provider/mode`,
        keyword: "const", expected_identity: "provider",
        actual_identity: traversal?.mode ?? null,
        message: "traversal provider mode must be package-owned"
      });
    }
    return diagnostics;
  });
}

function canonicalPropertyOrder(value) {
  if (Array.isArray(value)) return value.map(canonicalPropertyOrder);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map((key) => [
      key, canonicalPropertyOrder(value[key])
    ])
  );
  return value;
}

function constructStable(source, testProofs) {
  return canonicalPropertyOrder({
    ...structuredClone(source),
    schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1,
    test_proof_version: TEST_PROOF_VERSION_V1,
    test_proofs: structuredClone(testProofs)
  });
}

function finishMigration(source, family, testProofs) {
  const sourceValidation = validateProjectedContractWithStableCore(source);
  if (!sourceValidation.schema_valid || sourceValidation.diagnostics.length > 0) refuse(
    "stable_migration_source_invalid",
    [...sourceValidation.schema_errors, ...sourceValidation.diagnostics]
  );
  const result = constructStable(source, testProofs);
  const resultValidation = validateAndResolveNativeContractV1(result);
  if (!resultValidation.valid) refuse("stable_migration_result_invalid", [
    ...resultValidation.schema_errors, ...resultValidation.diagnostics
  ]);
  return Object.freeze(result);
}

function migrateControlledAcceptanceContractV02ToV1({ contract, testProofs }) {
  const family = classificationGate(contract);
  if (family !== "v0.2") refuse("stable_migration_source_family_unsupported");
  const ambiguous = ambiguousProofDiagnostics(testProofs);
  if (ambiguous.length > 0) refuse("stable_migration_ambiguous", ambiguous);
  const incomplete = incompleteProofDiagnostics(contract, testProofs);
  if (incomplete.length > 0) refuse("stable_migration_test_proofs_required", incomplete);
  const providers = providerDiagnostics(testProofs);
  if (providers.length > 0) refuse("stable_migration_provider_bindings_required", providers);
  const canonicalProofs = [...testProofs].sort((left, right) => compareCodeUnits(
    left.verification_claim_id, right.verification_claim_id
  ));
  return finishMigration(contract, family, canonicalProofs);
}

function migrateControlledAcceptanceContractV03ToV1({ contract, supplement = undefined }) {
  const family = classificationGate(contract);
  if (family !== "v0.3") refuse("stable_migration_source_family_unsupported");
  if (supplement !== undefined) refuse("stable_migration_supplement_forbidden", [{
    code: "migration_replacement_supplement_forbidden", pointer: "/supplement",
    keyword: "forbidden", message: "v0.3 proof/provider state is source-owned"
  }]);
  const sourceProofDiagnostics = [
    ...ambiguousProofDiagnostics(contract.test_proofs),
    ...incompleteProofDiagnostics(contract, contract.test_proofs),
    ...providerDiagnostics(contract.test_proofs ?? [])
  ];
  if (sourceProofDiagnostics.length > 0) refuse(
    "stable_migration_source_invalid", sourceProofDiagnostics
  );
  return finishMigration(contract, family, contract.test_proofs);
}

export {
  STABLE_MIGRATION_REASON_CODES,
  StableMigrationError,
  classifySource,
  migrateControlledAcceptanceContractV02ToV1,
  migrateControlledAcceptanceContractV03ToV1
};
