import { createHash } from "node:crypto";

import { compiledValidators } from "./compiled-validator-cache.mjs";
import TEST_PROOF_CONTRACT_SCHEMA_V03 from
  "../schema/controlled-acceptance-contract.experimental.v0.3.schema.json" with { type: "json" };
import TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V1 from
  "../schema/controlled-contract-test-proof-runtime-evidence.v1.schema.json" with { type: "json" };
import {
  NATIVE_CONTRACT_SCHEMA_V034,
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034,
  validateAndResolveNativeContractV034
} from "./native-contract-carrier-v034.mjs";
import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION
} from "./test-proof-provider-registry.mjs";

const TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03 =
  "controlled-acceptance-contract.experimental.v0.3";
const TEST_PROOF_CONTRACT_PROFILE_ID_V03 =
  "acceptance-contract.standard.experimental.v0.3";
const TEST_PROOF_VERSION_V1 = "controlled-contract-test-proof.v1";
const TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V1 =
  "controlled-contract-test-proof-runtime-evidence.v1";
const V02_SCHEMA_ID = new URL(
  "controlled-acceptance-contract.experimental.v0.2.schema.json",
  TEST_PROOF_CONTRACT_SCHEMA_V03.$id
).href;

const v02Schema = structuredClone(NATIVE_CONTRACT_SCHEMA_V034);
v02Schema.$id = V02_SCHEMA_ID;
const {
  validateV03Schema,
  validateRuntimeEvidenceSchema
} = await compiledValidators("controlled-contract.test-proof-contract.v03", {
  schemas: [v02Schema],
  validators: {
    validateV03Schema: TEST_PROOF_CONTRACT_SCHEMA_V03,
    validateRuntimeEvidenceSchema: TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V1
  }
});

const proofDefs = TEST_PROOF_CONTRACT_SCHEMA_V03.$defs;
const TEST_PROOF_VOCABULARY = deepFreeze({
  vocabulary_version: TEST_PROOF_VERSION_V1,
  identity_grammars: Object.fromEntries([
    "test_proof_id", "boundary_id", "observable_id", "falsifier_id",
    "coverage_baseline_id", "test_id"
  ].map((name) => [name, proofDefs[name].pattern])),
  system_under_test_boundary_kinds:
    proofDefs.system_under_test_boundary.properties.kind.enum,
  observable_result_kinds: proofDefs.observable_result.properties.kind.enum,
  falsifier_strategies: proofDefs.falsifier.properties.strategy.enum,
  coverage_baseline_states: ["complete_executed_inventory", "no_executed_coverage"],
  coverage_dispositions: ["preserved", "replaced", "retired"],
  coverage_retirement_reasons:
    proofDefs.coverage_item.oneOf[2].properties.reason.enum,
  prohibited_shortcuts:
    proofDefs.test_proof_binding.properties.prohibited_shortcuts.items.enum,
  mandatory_prohibited_shortcuts: ["source_text_inspection"],
  provider_capabilities: [
    "boundary_traversal", "candidate_execution", "falsifier_execution"
  ],
  provider_binding_modes: ["provider", "registry_unsupported"],
  provider_observation_mechanisms: [
    "module_substitution", "node_test_structured_events", "node_test_v8_coverage"
  ],
  provider_observation_seams: [
    "node_test_event", "node_test_failure_event", "node_test_structured_assertion"
  ],
  provider_evidence_artifact_types: [
    "boundary_trace", "falsifier_result", "structured_test_result"
  ],
  provider_catalog: structuredClone(TEST_PROOF_PROVIDER_CATALOG),
  provider_capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  provider_capability_snapshot_digest_rule:
    "sha256 of UTF-8 compact JSON for provider_catalog in declared provider/capability order",
  runtime_test_selection_version: "controlled-contract-runtime-test-selection.v1",
  runtime_test_selection_authority: "coordinator_owned_exact_test_identity",
  semantic_authority: "coordinator_owned"
});

class TestProofContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TestProofContractError";
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

const compare = (left, right) => {
  const leftValue = String(left);
  const rightValue = String(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
};
const sorted = (values) => [...values].sort(compare);
const by = (key) => (left, right) => compare(left[key], right[key]);

function canonicalizeTestProofs(testProofs) {
  return structuredClone(testProofs).map((proof) => ({
    ...proof,
    system_under_test_boundary: {
      ...proof.system_under_test_boundary,
      subject_reference_ids: sorted(proof.system_under_test_boundary.subject_reference_ids)
    },
    falsifiers: [...proof.falsifiers].sort(by("falsifier_id")),
    coverage_disposition: {
      ...proof.coverage_disposition,
      items: [...proof.coverage_disposition.items].map((item) => ({
        ...item,
        ...(item.replacement_test_ids
          ? { replacement_test_ids: sorted(item.replacement_test_ids) }
          : {})
      })).sort(by("test_id"))
    },
    prohibited_shortcuts: sorted(proof.prohibited_shortcuts)
  })).sort(by("verification_claim_id"));
}

function isCanonical(values, identity = (value) => value) {
  return values.every((value, index) => index === 0 ||
    compare(identity(values[index - 1]), identity(value)) < 0);
}

function partialMigrationDiagnostic(contract) {
  const hasProofVersion = Object.hasOwn(contract, "test_proof_version");
  const hasProofs = Object.hasOwn(contract, "test_proofs");
  const hasV03Marker = contract.schema_version === TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03 ||
    contract.profile_id === TEST_PROOF_CONTRACT_PROFILE_ID_V03 || hasProofVersion || hasProofs;
  const completeV03 = contract.schema_version === TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03 &&
    contract.profile_id === TEST_PROOF_CONTRACT_PROFILE_ID_V03 &&
    contract.vocabulary_version === VOCABULARY_VERSION_V034 &&
    contract.test_proof_version === TEST_PROOF_VERSION_V1 && hasProofs;
  return hasV03Marker && !completeV03
    ? [{ code: "partial_test_proof_migration" }]
    : [];
}

function v02Projection(contract) {
  const {
    test_proof_version: ignoredVersion,
    test_proofs: ignoredProofs,
    ...base
  } = contract;
  return {
    ...base,
    schema_version: SCHEMA_VERSION_V034,
    profile_id: PROFILE_ID_V034,
    vocabulary_version: VOCABULARY_VERSION_V034
  };
}

function testProofDiagnostics(contract) {
  const diagnostics = [];
  const references = new Set(contract.references.map(({ reference_id: id }) => id));
  const propositions = new Set(contract.propositions.map(({ proposition_id: id }) => id));
  const claims = new Map(contract.claims.map((claim) => [claim.claim_id, claim]));
  const testClaims = contract.claims.filter((claim) =>
    claim.kind === "verification" && claim.verification_method === "test_execution"
  ).map(({ claim_id: id }) => id).sort(compare);
  const boundClaims = contract.test_proofs.map(({ verification_claim_id: id }) => id).sort(compare);
  const duplicate = (values, code, field) => {
    const seen = new Set();
    for (const value of values) {
      if (seen.has(value)) diagnostics.push({ code, [field]: value });
      seen.add(value);
    }
  };
  duplicate(contract.test_proofs.map(({ test_proof_id: id }) => id),
    "duplicate_test_proof_id", "test_proof_id");
  duplicate(boundClaims, "duplicate_test_proof_verification_binding", "verification_claim_id");
  for (const claimId of testClaims) if (!boundClaims.includes(claimId)) diagnostics.push({
    code: "missing_test_proof_binding", verification_claim_id: claimId
  });
  for (const claimId of boundClaims) if (!testClaims.includes(claimId)) diagnostics.push({
    code: claims.has(claimId) ? "non_test_execution_binding" : "dangling_verification_claim",
    verification_claim_id: claimId
  });
  if (!isCanonical(contract.test_proofs, ({ verification_claim_id: id }) => id)) diagnostics.push({
    code: "noncanonical_test_proof_order"
  });
  for (const proof of contract.test_proofs) {
    const proofId = proof.test_proof_id;
    diagnostics.push(...providerBindingDiagnostics(
      proof, contract.test_proofs.indexOf(proof)
    ).map((diagnostic) => ({ ...diagnostic, test_proof_id: proofId,
      verification_claim_id: proof.verification_claim_id })));
    for (const referenceId of proof.system_under_test_boundary.subject_reference_ids) {
      if (!references.has(referenceId)) diagnostics.push({
        code: "dangling_sut_boundary_reference", test_proof_id: proofId,
        reference_id: referenceId
      });
    }
    if (!propositions.has(proof.observable_result.proposition_id)) diagnostics.push({
      code: "dangling_observable_proposition", test_proof_id: proofId,
      proposition_id: proof.observable_result.proposition_id
    });
    for (const falsifier of proof.falsifiers) if (!propositions.has(falsifier.proposition_id)) {
      diagnostics.push({ code: "dangling_falsifier_proposition", test_proof_id: proofId,
        falsifier_id: falsifier.falsifier_id, proposition_id: falsifier.proposition_id });
    }
    const ordered = [
      [proof.system_under_test_boundary.subject_reference_ids, (value) => value, "sut_references"],
      [proof.falsifiers, ({ falsifier_id: id }) => id, "falsifiers"],
      [proof.coverage_disposition.items, ({ test_id: id }) => id, "coverage_items"],
      [proof.prohibited_shortcuts, (value) => value, "prohibited_shortcuts"]
    ];
    for (const [values, identity, field] of ordered) if (!isCanonical(values, identity)) {
      diagnostics.push({ code: "noncanonical_test_proof_population", test_proof_id: proofId, field });
    }
    for (const item of proof.coverage_disposition.items) {
      if (item.replacement_test_ids && !isCanonical(item.replacement_test_ids)) diagnostics.push({
        code: "noncanonical_test_proof_population", test_proof_id: proofId,
        field: `replacement_test_ids:${item.test_id}`
      });
    }
    const selectedTestId = proof.runtime_test_selection?.test_id;
    if (selectedTestId !== undefined &&
        proof.coverage_disposition.baseline_state === "complete_executed_inventory") {
      const declared = proof.coverage_disposition.items.flatMap((item) =>
        item.disposition === "preserved" ? [item.test_id]
          : item.disposition === "replaced" ? item.replacement_test_ids : []
      );
      if (!declared.includes(selectedTestId)) diagnostics.push({
        code: "runtime_test_selection_not_declared", test_proof_id: proofId,
        verification_claim_id: proof.verification_claim_id,
        test_id: selectedTestId
      });
    }
  }
  return diagnostics.sort((left, right) => compare(
    JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
  ));
}

const FORBIDDEN_PROVIDER_DATA_KEYS = new Set([
  "args", "argv", "callback", "command", "cwd", "env", "environment",
  "execute", "executeCandidate", "executeFalsifier", "executable", "function",
  "module", "module_path", "path", "shell", "shell_text"
]);

function findForbiddenProviderData(value, field) {
  if (!value || typeof value !== "object") return [];
  const diagnostics = [];
  for (const [key, child] of Object.entries(value)) {
    const childField = `${field}/${key}`;
    if (FORBIDDEN_PROVIDER_DATA_KEYS.has(key) || typeof child === "function") diagnostics.push({
      code: "test_proof_provider_executable_data_forbidden", field: childField
    });
    else diagnostics.push(...findForbiddenProviderData(child, childField));
  }
  return diagnostics;
}

function exactProviderDiagnostic(binding, expectedCapability, field) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return [{
    code: "test_proof_provider_binding_missing", field
  }];
  const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: id }) => id === binding.provider_id
  );
  if (!descriptor) return [{
    code: "test_proof_provider_unknown", field: `${field}/provider_id`,
    provider_id: binding.provider_id ?? null
  }];
  if (descriptor.provider_version !== binding.provider_version) return [{
    code: "test_proof_provider_version_stale", field: `${field}/provider_version`,
    provider_id: binding.provider_id,
    expected: descriptor.provider_version, actual: binding.provider_version ?? null
  }];
  if (binding.capability !== expectedCapability ||
      !descriptor.capabilities.includes(expectedCapability)) return [{
    code: "test_proof_provider_capability_mismatch", field: `${field}/capability`,
    provider_id: binding.provider_id, expected: expectedCapability,
    actual: binding.capability ?? null
  }];
  return [];
}

function providerBindingDiagnostics(binding, index = 0) {
  const root = `/test_proofs/${index}`;
  const diagnostics = findForbiddenProviderData(
    binding?.candidate_execution_provider, `${root}/candidate_execution_provider`
  );
  diagnostics.push(...exactProviderDiagnostic(
    binding?.candidate_execution_provider, "candidate_execution",
    `${root}/candidate_execution_provider`
  ));
  for (const [falsifierIndex, falsifier] of (binding?.falsifiers ?? []).entries()) {
    const field = `${root}/falsifiers/${falsifierIndex}/execution_provider`;
    diagnostics.push(...findForbiddenProviderData(falsifier?.execution_provider, field));
    diagnostics.push(...exactProviderDiagnostic(
      falsifier?.execution_provider, "falsifier_execution",
      field
    ));
    const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
      ({ provider_id: id }) => id === falsifier?.execution_provider?.provider_id
    );
    if (descriptor && !descriptor.falsifier_strategies.includes(falsifier.strategy)) {
      diagnostics.push({ code: "test_proof_provider_strategy_mismatch",
        field: `${root}/falsifiers/${falsifierIndex}/strategy`,
        provider_id: descriptor.provider_id, actual: falsifier.strategy });
    }
    if (descriptor && !descriptor.boundary_kinds.includes(
      falsifier?.mutation?.target_kind
    )) diagnostics.push({ code: "test_proof_provider_mutation_target_mismatch",
      field: `${root}/falsifiers/${falsifierIndex}/mutation/target_kind`,
      provider_id: descriptor.provider_id, actual: falsifier?.mutation?.target_kind ?? null });
    if (falsifier?.mutation?.module_path !==
        binding?.system_under_test_boundary?.runtime_module_path) diagnostics.push({
      code: "test_proof_provider_mutation_boundary_mismatch",
      field: `${root}/falsifiers/${falsifierIndex}/mutation/module_path`,
      expected: binding?.system_under_test_boundary?.runtime_module_path ?? null,
      actual: falsifier?.mutation?.module_path ?? null
    });
  }
  const traversal = binding?.traversal_provider;
  if (traversal?.mode === "registry_unsupported") {
    if (traversal.registry_id !== TEST_PROOF_PROVIDER_REGISTRY_ID ||
        traversal.registry_version !== TEST_PROOF_PROVIDER_REGISTRY_VERSION) diagnostics.push({
      code: "test_proof_traversal_registry_identity_invalid",
      field: `${root}/traversal_provider`
    });
  } else {
    diagnostics.push(...findForbiddenProviderData(traversal, `${root}/traversal_provider`));
    diagnostics.push(...exactProviderDiagnostic(
      traversal, "boundary_traversal", `${root}/traversal_provider`
    ));
    const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
      ({ provider_id: id }) => id === traversal?.provider_id
    );
    if (descriptor && !descriptor.boundary_kinds.includes(
      binding?.system_under_test_boundary?.kind
    )) diagnostics.push({ code: "test_proof_provider_boundary_kind_mismatch",
      field: `${root}/traversal_provider/boundary_kind`,
      provider_id: descriptor.provider_id,
      actual: binding?.system_under_test_boundary?.kind ?? null });
    if (traversal?.boundary_kind !== binding?.system_under_test_boundary?.kind) diagnostics.push({
      code: "test_proof_provider_boundary_kind_mismatch",
      field: `${root}/traversal_provider/boundary_kind`,
      actual: traversal?.boundary_kind ?? null
    });
    if (!descriptor?.observation_mechanisms.includes(traversal?.observation_mechanism)) {
      diagnostics.push({ code: "test_proof_provider_observation_mechanism_mismatch",
        field: `${root}/traversal_provider/observation_mechanism`,
        provider_id: descriptor?.provider_id ?? null,
        actual: traversal?.observation_mechanism ?? null });
    }
    if (!descriptor?.evidence_artifact_types.includes(traversal?.evidence_artifact_type)) {
      diagnostics.push({ code: "test_proof_provider_artifact_type_mismatch",
        field: `${root}/traversal_provider/evidence_artifact_type`,
        provider_id: descriptor?.provider_id ?? null,
        actual: traversal?.evidence_artifact_type ?? null });
    }
    if (!descriptor?.observation_seams.includes(traversal?.observation_seam)) {
      diagnostics.push({ code: "test_proof_provider_observation_seam_mismatch",
        field: `${root}/traversal_provider/observation_seam`,
        provider_id: descriptor?.provider_id ?? null,
        actual: traversal?.observation_seam ?? null });
    }
  }
  return diagnostics;
}

function resolveTestProofProviderBindings(binding) {
  const diagnostics = providerBindingDiagnostics(binding, 0);
  if (diagnostics.length > 0) throw new TestProofContractError(
    "test_proof_provider_binding_invalid",
    "Test-proof provider bindings do not resolve against the closed provider catalog.",
    { diagnostics }
  );
  const descriptor = (provider) => structuredClone(
    TEST_PROOF_PROVIDER_CATALOG.providers.find(
      ({ provider_id: id }) => id === provider.provider_id
    )
  );
  return deepFreeze({
    candidate: descriptor(binding.candidate_execution_provider),
    falsifiers: binding.falsifiers.map((falsifier) => ({
      falsifier_id: falsifier.falsifier_id,
      strategy: falsifier.strategy,
      mutation: structuredClone(falsifier.mutation),
      provider: descriptor(falsifier.execution_provider)
    })).sort(by("falsifier_id")),
    traversal: binding.traversal_provider.mode === "registry_unsupported"
      ? { mode: "registry_unsupported", registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
        registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION }
      : { mode: "provider", boundary_kind: binding.traversal_provider.boundary_kind,
        observation_mechanism: binding.traversal_provider.observation_mechanism,
        observation_seam: binding.traversal_provider.observation_seam,
        evidence_artifact_type: binding.traversal_provider.evidence_artifact_type,
        runtime_module_path: binding.system_under_test_boundary.runtime_module_path,
        provider: descriptor(binding.traversal_provider) }
  });
}

function resultEnvelope({ family, schemaValid, schemaErrors = [], diagnostics = [], facts = null }) {
  return {
    contract_family: family,
    schema_valid: schemaValid,
    schema_errors: structuredClone(schemaErrors),
    diagnostics: structuredClone(diagnostics),
    facts,
    valid: schemaValid && diagnostics.length === 0,
    semantic_judgment: "not_performed_coordinator_owned"
  };
}

function validateTestProofContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return resultEnvelope({
    family: "unknown", schemaValid: false,
    diagnostics: [{ code: "contract_must_be_object" }]
  });
  const partial = partialMigrationDiagnostic(contract);
  if (partial.length > 0) return resultEnvelope({
    family: "mixed", schemaValid: false, diagnostics: partial
  });
  if (contract.schema_version === SCHEMA_VERSION_V034) {
    const base = validateAndResolveNativeContractV034(contract);
    return resultEnvelope({ family: "v0.2", schemaValid: base.schema_valid,
      schemaErrors: base.schema_errors, diagnostics: base.diagnostics, facts: base.facts });
  }
  if (contract.schema_version !== TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03) return resultEnvelope({
    family: "unknown", schemaValid: false,
    diagnostics: [{ code: "unsupported_contract_schema_version",
      schema_version: contract.schema_version ?? null }]
  });
  if (!validateV03Schema(contract)) return resultEnvelope({
    family: "v0.3", schemaValid: false, schemaErrors: validateV03Schema.errors
  });
  const base = validateAndResolveNativeContractV034(v02Projection(contract));
  const diagnostics = [...base.diagnostics, ...testProofDiagnostics(contract)];
  return resultEnvelope({ family: "v0.3", schemaValid: base.schema_valid,
    schemaErrors: base.schema_errors, diagnostics,
    facts: base.facts && { ...base.facts, test_proof_count: contract.test_proofs.length } });
}

function migrateControlledAcceptanceContractV02ToV03({ contract, testProofs }) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) throw new
    TestProofContractError("migration_source_invalid", "Migration source must be an object.");
  if (Object.hasOwn(contract, "test_proof_version") || Object.hasOwn(contract, "test_proofs")) {
    throw new TestProofContractError("partial_test_proof_migration",
      "Migration source already contains v0.3 test-proof state.");
  }
  const source = validateTestProofContract(contract);
  if (source.contract_family !== "v0.2" || !source.valid) throw new TestProofContractError(
    "migration_source_invalid", "Migration requires a valid v0.2 carrier.", { source }
  );
  if (!Array.isArray(testProofs)) throw new TestProofContractError(
    "migration_test_proofs_required", "Migration requires the complete test-proof population."
  );
  const authored = {
    ...structuredClone(contract),
    schema_version: TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03,
    profile_id: TEST_PROOF_CONTRACT_PROFILE_ID_V03,
    test_proof_version: TEST_PROOF_VERSION_V1,
    test_proofs: structuredClone(testProofs)
  };
  if (!validateV03Schema(authored)) {
    const errors = structuredClone(validateV03Schema.errors);
    const providerMissing = errors.some(({ keyword, params }) => keyword === "required" && [
      "candidate_execution_provider", "execution_provider", "traversal_provider"
    ].includes(params?.missingProperty));
    throw new TestProofContractError(
      providerMissing ? "migration_provider_bindings_required" : "migration_result_invalid",
      providerMissing
        ? "Migration requires coordinator-authored provider bindings for every test proof."
        : "Authored test-proof state is structurally incomplete.",
      { schema_errors: errors }
    );
  }
  const migrated = { ...authored, test_proofs: canonicalizeTestProofs(testProofs) };
  const result = validateTestProofContract(migrated);
  if (!result.valid) throw new TestProofContractError(
    "migration_result_invalid", "Complete v0.3 migration validation failed.", { result }
  );
  return migrated;
}

function canonicalTestProofContractJson(contract) {
  const result = validateTestProofContract(contract);
  if (!result.valid) throw new TestProofContractError(
    "contract_invalid", "Cannot canonicalize an invalid test-proof contract.", { result }
  );
  return `${JSON.stringify(canonicalValue(contract))}\n`;
}

function validateTestProofRuntimeEvidence(evidence) {
  if (!validateRuntimeEvidenceSchema(evidence)) return {
    schema_valid: false, schema_errors: structuredClone(validateRuntimeEvidenceSchema.errors),
    diagnostics: [], valid: false, semantic_judgment: "not_performed_coordinator_owned"
  };
  const diagnostics = [];
  const { evidence_identity: identity, contract_binding: binding } = evidence;
  if (identity.verification_id !== binding.verification_claim_id) diagnostics.push({
    code: "runtime_verification_identity_binding_mismatch",
    field: "/evidence_identity/verification_id"
  });
  if (!identity.selected_unit.startsWith(`${identity.wk_id}#`) &&
      identity.selected_unit !== identity.wk_id) diagnostics.push({
    code: "runtime_selected_unit_wk_mismatch",
    field: "/evidence_identity/selected_unit"
  });
  const validateProviderEvidence = (provider, expectedCapability, field) => {
    if (provider?.capability_snapshot_digest !==
        TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST) diagnostics.push({
      code: "runtime_provider_snapshot_digest_mismatch", field
    });
    if (expectedCapability === "traversal_unsupported") {
      if (provider?.registry_id !== TEST_PROOF_PROVIDER_REGISTRY_ID ||
          provider?.registry_version !== TEST_PROOF_PROVIDER_REGISTRY_VERSION ||
          provider?.capability !== expectedCapability) diagnostics.push({
        code: "runtime_traversal_registry_evidence_invalid", field
      });
      return;
    }
    const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
      ({ provider_id: id }) => id === provider?.provider_id
    );
    if (!descriptor) diagnostics.push({ code: "runtime_provider_unknown", field });
    else if (provider.provider_version !== descriptor.provider_version) diagnostics.push({
      code: "runtime_provider_version_mismatch", field
    });
    if (provider?.capability !== expectedCapability ||
        !descriptor?.capabilities.includes(expectedCapability)) diagnostics.push({
      code: "runtime_provider_capability_mismatch", field
    });
    if (descriptor && !descriptor.observation_mechanisms.includes(
      provider?.observation_mechanism
    )) diagnostics.push({ code: "runtime_provider_observation_mechanism_mismatch", field });
    if (descriptor && (!Array.isArray(provider?.evidence_artifact_types) ||
        provider.evidence_artifact_types.some(
          (kind) => !descriptor.evidence_artifact_types.includes(kind)
        ))) diagnostics.push({ code: "runtime_provider_artifact_type_mismatch", field });
  };
  validateProviderEvidence(evidence.execution_result.provider,
    "candidate_execution", "/execution_result/provider");
  evidence.falsifier_executions.forEach((entry, index) => validateProviderEvidence(
    entry.provider, "falsifier_execution", `/falsifier_executions/${index}/provider`
  ));
  evidence.falsifier_executions.forEach((entry, index) => {
    if (entry.target_verification_id !== binding.verification_claim_id) diagnostics.push({
      code: "runtime_falsifier_verification_identity_mismatch",
      field: `/falsifier_executions/${index}/target_verification_id`
    });
  });
  evidence.boundary_traversals.forEach((entry, index) => validateProviderEvidence(
    entry.provider, entry.provider_support === "unsupported"
      ? "traversal_unsupported" : "boundary_traversal",
    `/boundary_traversals/${index}/provider`
  ));
  const artifacts = new Set(evidence.artifacts.map(({ artifact_id: id }) => id));
  const artifactKinds = new Map(evidence.artifacts.map(({ artifact_id: id, kind }) => [id, kind]));
  for (const [index, artifact] of evidence.artifacts.entries()) {
    const contentDigest = `sha256:${createHash("sha256").update(
      `${JSON.stringify(canonicalValue(artifact.payload))}\n`, "utf8"
    ).digest("hex")}`;
    if (artifact.digest !== contentDigest ||
        artifact.artifact_id !== `artifact-${contentDigest.slice("sha256:".length)}`) {
      diagnostics.push({ code: "runtime_artifact_identity_digest_mismatch",
        field: `/artifacts/${index}` });
    }
  }
  const ordered = [
    ...Object.entries(evidence.test_inventory).filter(([key]) => key.endsWith("_test_ids")),
    ["boundary_traversals", evidence.boundary_traversals.map(({ boundary_id: id }) => id)],
    ["falsifier_executions", evidence.falsifier_executions.map(({ falsifier_id: id }) => id)],
    ["observed_shortcuts", evidence.observed_shortcuts],
    ["artifacts", evidence.artifacts.map(({ artifact_id: id }) => id)]
  ];
  for (const [field, values] of ordered) if (!isCanonical(values)) diagnostics.push({
    code: "noncanonical_runtime_evidence_population", field
  });
  for (const entry of [...evidence.boundary_traversals, ...evidence.falsifier_executions]) {
    for (const artifactId of entry.evidence_artifact_ids) if (!artifacts.has(artifactId)) {
      diagnostics.push({ code: "dangling_runtime_evidence_artifact", artifact_id: artifactId });
    }
  }
  const checkArtifactKinds = (ids, provider, field) => {
    const expected = new Set(provider?.evidence_artifact_types ?? []);
    for (const artifactId of ids) {
      const actual = artifactKinds.get(artifactId);
      if (actual !== undefined && !expected.has(actual)) diagnostics.push({
        code: "runtime_evidence_artifact_kind_mismatch", field, artifact_id: artifactId,
        expected: [...expected].sort(compare), actual
      });
    }
  };
  checkArtifactKinds(evidence.execution_result.evidence_artifact_ids,
    evidence.execution_result.provider, "/execution_result/evidence_artifact_ids");
  evidence.boundary_traversals.forEach((entry, index) => checkArtifactKinds(
    entry.evidence_artifact_ids, entry.provider,
    `/boundary_traversals/${index}/evidence_artifact_ids`
  ));
  evidence.falsifier_executions.forEach((entry, index) => checkArtifactKinds(
    entry.evidence_artifact_ids, entry.provider,
    `/falsifier_executions/${index}/evidence_artifact_ids`
  ));
  const structured = evidence.execution_result.structured_result;
  const summary = structured.summary;
  const passEvents = structured.pass_events;
  const failEvents = structured.fail_events;
  if (structured.exit_code !== evidence.execution_result.exit_code) diagnostics.push({
    code: "runtime_execution_exit_code_mismatch",
    field: "/execution_result/structured_result/exit_code"
  });
  if (summary.passed !== passEvents.length || summary.failed !== failEvents.length ||
      summary.tests !== summary.passed + summary.failed + summary.skipped +
        summary.cancelled + summary.todo) diagnostics.push({
    code: "runtime_structured_result_count_mismatch",
    field: "/execution_result/structured_result/summary"
  });
  for (const [field, events, type, status] of [
    ["pass_events", passEvents, "test:pass", "passed"],
    ["fail_events", failEvents, "test:fail", "failed"]
  ]) for (const [index, event] of events.entries()) {
    if (event.type !== type || event.status !== status) diagnostics.push({
      code: "runtime_structured_event_status_mismatch",
      field: `/execution_result/structured_result/${field}/${index}`
    });
  }
  const statusCoherent = evidence.execution_result.status === "passed"
    ? evidence.execution_result.exit_code === 0 && summary.failed === 0
    : evidence.execution_result.status === "failed"
      ? Number.isInteger(evidence.execution_result.exit_code) &&
        evidence.execution_result.exit_code !== 0 && summary.failed > 0
      : evidence.execution_result.exit_code !== 0 && summary.failed === 0;
  if (!statusCoherent) diagnostics.push({
    code: "runtime_execution_status_incoherent",
    field: "/execution_result/status"
  });
  for (const [index, entry] of evidence.falsifier_executions.entries()) {
    if (entry.status === "detected" && (entry.mutation.observed !== true ||
        entry.evidence_artifact_ids.length === 0)) diagnostics.push({
      code: "runtime_falsifier_launcher_evidence_missing",
      field: `/falsifier_executions/${index}`
    });
  }
  for (const [index, entry] of evidence.boundary_traversals.entries()) {
    if (entry.status === "proven" && (entry.observation_mechanism !==
        "node_test_v8_coverage" || entry.observation_seam !==
        "node_test_structured_assertion" || entry.evidence_artifact_ids.length === 0)) diagnostics.push({
      code: "runtime_traversal_launcher_evidence_missing",
      field: `/boundary_traversals/${index}`
    });
  }
  const discovered = new Set(evidence.test_inventory.discovered_test_ids);
  if (!discovered.has(identity.test_id)) diagnostics.push({
    code: "runtime_selected_test_not_discovered",
    field: "/evidence_identity/test_id", test_id: identity.test_id
  });
  for (const field of ["executed_test_ids", "skipped_test_ids"]) {
    for (const testId of evidence.test_inventory[field]) if (!discovered.has(testId)) diagnostics.push({
      code: "runtime_test_not_discovered", field, test_id: testId
    });
  }
  return { schema_valid: true, schema_errors: [], diagnostics,
    valid: diagnostics.length === 0,
    semantic_judgment: "not_performed_coordinator_owned" };
}

const TEST_PROOF_AUTHORING_LIMITS = deepFreeze({
  query_bytes: 16384,
  verification_ids: 64,
  patch_operations: 64
});

function describeTestProofAuthoring() {
  return deepFreeze({
    schema_version: "controlled-contract-test-proof-authoring-description.v1",
    contract_schema_version: TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03,
    test_proof_version: TEST_PROOF_VERSION_V1,
    binding_schema: structuredClone(proofDefs.test_proof_binding),
    runtime_test_selection_schema: structuredClone(proofDefs.runtime_test_selection),
    compatibility: {
      v0_2: "unchanged_legacy_contract",
      v0_3_without_runtime_test_selection:
        "valid_for_authoring_and_assessment_but_not_executable_as_production_runtime_evidence",
      migration: "never_invents_runtime_test_selection"
    },
    vocabulary: structuredClone(TEST_PROOF_VOCABULARY),
    limits: structuredClone(TEST_PROOF_AUTHORING_LIMITS),
    semantic_judgment: "not_performed_coordinator_owned"
  });
}

function assertVerificationIds(verificationIds) {
  if (!Array.isArray(verificationIds) || verificationIds.length === 0 ||
      verificationIds.length > TEST_PROOF_AUTHORING_LIMITS.verification_ids ||
      verificationIds.some((value) => typeof value !== "string" || value.length === 0) ||
      new Set(verificationIds).size !== verificationIds.length) {
    throw new TestProofContractError("test_proof_verification_ids_invalid",
      "verification_ids must contain 1 to 64 unique controlled verification identities.");
  }
}

function queryTestProofBindings({ contract, verificationIds }) {
  assertVerificationIds(verificationIds);
  const validation = validateTestProofContract(contract);
  if (validation.contract_family === "v0.2" && validation.valid) return deepFreeze({
    schema_version: "controlled-contract-test-proof-binding-query.v1",
    status: "migration_required",
    contract_schema_version: contract.schema_version,
    requested_count: verificationIds.length,
    matched_count: 0,
    missing_verification_ids: sorted(verificationIds),
    bindings: [],
    semantic_judgment: "not_performed_coordinator_owned"
  });
  if (validation.contract_family !== "v0.3" || !validation.valid) throw new
    TestProofContractError("test_proof_contract_invalid",
      "Test-proof bindings may be queried only from a complete valid v0.3 carrier.",
      { validation });
  const claims = new Map(contract.claims.map((claim) => [claim.claim_id, claim]));
  const requested = sorted(verificationIds);
  const missing = requested.filter((id) => !claims.has(id));
  const nonTest = requested.filter((id) => claims.has(id) && !(
    claims.get(id).kind === "verification" &&
    claims.get(id).verification_method === "test_execution"
  ));
  if (missing.length > 0) throw new TestProofContractError(
    "test_proof_verification_unknown", "One or more verification identities are unknown.",
    { verification_ids: missing }
  );
  if (nonTest.length > 0) throw new TestProofContractError(
    "test_proof_verification_not_test_execution",
    "One or more verification identities are not test_execution claims.",
    { verification_ids: nonTest }
  );
  const bindings = contract.test_proofs.filter(
    ({ verification_claim_id: id }) => requested.includes(id)
  ).map((value) => structuredClone(value));
  const result = {
    schema_version: "controlled-contract-test-proof-binding-query.v1",
    status: "selected",
    contract_schema_version: contract.schema_version,
    requested_count: requested.length,
    matched_count: bindings.length,
    missing_verification_ids: requested.filter((id) => !bindings.some(
      ({ verification_claim_id: candidate }) => candidate === id
    )),
    bindings,
    semantic_judgment: "not_performed_coordinator_owned"
  };
  if (Buffer.byteLength(JSON.stringify(result, null, 2), "utf8") >
      TEST_PROOF_AUTHORING_LIMITS.query_bytes) throw new TestProofContractError(
    "test_proof_query_too_large", "Selected test-proof bindings exceed 16,384 bytes.",
    { requested_count: requested.length }
  );
  return deepFreeze(result);
}

function patchTestProofBindings({ contract, operations }) {
  const validation = validateTestProofContract(contract);
  if (validation.contract_family === "v0.2" && validation.valid) throw new
    TestProofContractError("test_proof_migration_required",
      "A valid v0.2 carrier must be explicitly migrated before test-proof patching.");
  if (validation.contract_family !== "v0.3" || !validation.valid) throw new
    TestProofContractError("test_proof_contract_invalid",
      "Test-proof patching requires a complete valid v0.3 carrier.", { validation });
  if (!Array.isArray(operations) || operations.length === 0 ||
      operations.length > TEST_PROOF_AUTHORING_LIMITS.patch_operations) throw new
    TestProofContractError("test_proof_patch_invalid",
      "operations must contain 1 to 64 typed test-proof mutations.");
  const testClaims = new Set(contract.claims.filter(({ kind, verification_method: method }) =>
    kind === "verification" && method === "test_execution"
  ).map(({ claim_id: id }) => id));
  const next = structuredClone(contract);
  for (const operation of operations) {
    const keys = operation && typeof operation === "object" && !Array.isArray(operation)
      ? Object.keys(operation) : [];
    if (!operation || !["upsert", "remove"].includes(operation.op) ||
        typeof operation.verification_id !== "string" ||
        keys.some((key) => !["op", "verification_id", "binding"].includes(key))) {
      throw new TestProofContractError("test_proof_patch_invalid",
        "Each operation must be one closed typed test-proof mutation.");
    }
    const verificationId = operation.verification_id;
    if (!testClaims.has(verificationId)) throw new TestProofContractError(
      "test_proof_verification_unknown",
      "A patch verification identity is not a same-carrier test_execution claim.",
      { verification_id: verificationId }
    );
    const index = next.test_proofs.findIndex(
      ({ verification_claim_id: id }) => id === verificationId
    );
    if (operation.op === "remove") {
      if (Object.hasOwn(operation, "binding")) throw new TestProofContractError(
        "test_proof_patch_invalid", "Remove operations cannot carry a binding."
      );
      if (index >= 0) next.test_proofs.splice(index, 1);
      continue;
    }
    if (!operation.binding || operation.binding.verification_claim_id !== verificationId) {
      throw new TestProofContractError("test_proof_patch_identity_mismatch",
        "An upsert binding must carry its selected verification identity.");
    }
    if (index < 0) next.test_proofs.push(structuredClone(operation.binding));
    else next.test_proofs[index] = structuredClone(operation.binding);
  }
  next.test_proofs = canonicalizeTestProofs(next.test_proofs);
  const result = validateTestProofContract(next);
  if (!result.valid) throw new TestProofContractError(
    "test_proof_patch_result_invalid",
    "The prospective carrier would contain mixed, partial, or invalid test-proof state.",
    { validation: result }
  );
  return deepFreeze({
    contract: next,
    changed_verification_ids: sorted(operations.map(
      ({ verification_id: id }) => id
    ).filter((id, index, values) => values.indexOf(id) === index)),
    semantic_judgment: "not_performed_coordinator_owned"
  });
}

export {
  TEST_PROOF_CONTRACT_PROFILE_ID_V03,
  TEST_PROOF_CONTRACT_SCHEMA_V03,
  TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03,
  TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V1,
  TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V1,
  TEST_PROOF_VERSION_V1,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  TEST_PROOF_VOCABULARY,
  TEST_PROOF_AUTHORING_LIMITS,
  TestProofContractError,
  canonicalTestProofContractJson,
  describeTestProofAuthoring,
  migrateControlledAcceptanceContractV02ToV03,
  patchTestProofBindings,
  queryTestProofBindings,
  resolveTestProofProviderBindings,
  validateTestProofContract,
  validateTestProofRuntimeEvidence
};
