import { createHash } from "node:crypto";

const TEST_PROOF_PROVIDER_REGISTRY_ID = "launcher.test-proof-provider-registry";
const TEST_PROOF_PROVIDER_REGISTRY_VERSION = "1.0.0";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const TEST_PROOF_PROVIDER_CATALOG = deepFreeze({
  registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
  registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  providers: [{
    provider_id: "launcher.node-test",
    provider_version: "1.0.0",
    capabilities: ["candidate_execution"],
    observation_mechanisms: ["node_test_structured_events"],
    observation_seams: ["node_test_event"],
    evidence_artifact_types: ["structured_test_result"],
    falsifier_strategies: [],
    boundary_kinds: []
  }, {
    provider_id: "launcher.node-test-module-fault",
    provider_version: "1.0.0",
    capabilities: ["falsifier_execution"],
    observation_mechanisms: ["node_test_structured_events", "module_substitution"],
    observation_seams: ["node_test_failure_event"],
    evidence_artifact_types: ["falsifier_result", "structured_test_result"],
    falsifier_strategies: ["dependency_failure"],
    boundary_kinds: ["module"]
  }, {
    provider_id: "launcher.node-test-v8-coverage",
    provider_version: "1.0.0",
    capabilities: ["boundary_traversal"],
    observation_mechanisms: ["node_test_v8_coverage"],
    observation_seams: ["node_test_structured_assertion"],
    evidence_artifact_types: ["boundary_trace", "structured_test_result"],
    falsifier_strategies: [],
    boundary_kinds: ["module"]
  }]
});

const TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST = `sha256:${createHash("sha256")
  .update(JSON.stringify(TEST_PROOF_PROVIDER_CATALOG), "utf8").digest("hex")}`;

const PROVIDER_REFUSAL_PRECEDENCE = Object.freeze([
  "stable_test_proof_provider_missing",
  "stable_test_proof_provider_partial",
  "stable_test_proof_provider_unknown",
  "stable_test_proof_provider_version_mismatch",
  "stable_test_proof_provider_capability_mismatch",
  "stable_test_proof_provider_snapshot_mismatch",
  "stable_test_proof_provider_observation_mismatch",
  "stable_test_proof_provider_observation_seam_mismatch",
  "stable_test_proof_provider_artifact_type_mismatch",
  "stable_test_proof_provider_strategy_mismatch",
  "stable_test_proof_provider_boundary_mismatch"
]);

function diagnostic(code, pointer, expected, actual) {
  return Object.freeze({
    code,
    pointer,
    keyword: "providerCompatibility",
    reason_code: "stable_test_proof_provider_refused",
    expected_identity: expected ?? null,
    actual_identity: actual ?? null,
    message: code
  });
}

function providerResult(code = null, pointer = "/provider", expected = null,
  actual = null, descriptor = null) {
  return Object.freeze(code === null
    ? { valid: true, code: null, diagnostic: null, descriptor }
    : { valid: false, code, diagnostic: diagnostic(code, pointer, expected, actual),
      descriptor: null });
}

function resolveTestProofProviderCompatibility({
  provider,
  capability,
  pointer = "/provider",
  expected_provider_id: expectedProviderId = undefined,
  require_snapshot: requireSnapshot = false,
  observation_mechanism: observationMechanism = undefined,
  observation_seam: observationSeam = undefined,
  evidence_artifact_types: evidenceArtifactTypes = undefined,
  strategy = undefined,
  boundary_kind: boundaryKind = undefined
} = {}) {
  if (provider === null || provider === undefined || typeof provider !== "object" ||
      Array.isArray(provider) || Object.keys(provider).length === 0) return providerResult(
    PROVIDER_REFUSAL_PRECEDENCE[0], pointer, "complete provider binding", provider ?? null
  );
  if (capability === "traversal_unsupported") {
    const required = ["registry_id", "registry_version", "capability",
      "capability_snapshot_digest"];
    if (required.some((field) => !Object.hasOwn(provider, field))) return providerResult(
      PROVIDER_REFUSAL_PRECEDENCE[1], pointer, required,
      required.filter((field) => Object.hasOwn(provider, field))
    );
    if (provider.registry_id !== TEST_PROOF_PROVIDER_REGISTRY_ID) return providerResult(
      PROVIDER_REFUSAL_PRECEDENCE[2], `${pointer}/registry_id`,
      TEST_PROOF_PROVIDER_REGISTRY_ID, provider.registry_id
    );
    if (provider.registry_version !== TEST_PROOF_PROVIDER_REGISTRY_VERSION) {
      return providerResult(PROVIDER_REFUSAL_PRECEDENCE[3], `${pointer}/registry_version`,
        TEST_PROOF_PROVIDER_REGISTRY_VERSION, provider.registry_version);
    }
    if (provider.capability !== capability) return providerResult(
      PROVIDER_REFUSAL_PRECEDENCE[4], `${pointer}/capability`, capability,
      provider.capability
    );
    if (provider.capability_snapshot_digest !==
        TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST) return providerResult(
      PROVIDER_REFUSAL_PRECEDENCE[5], `${pointer}/capability_snapshot_digest`,
      TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
      provider.capability_snapshot_digest
    );
    return providerResult(null, pointer, null, null, null);
  }
  const required = ["provider_id", "provider_version", "capability"];
  if (required.some((field) => !Object.hasOwn(provider, field))) return providerResult(
    PROVIDER_REFUSAL_PRECEDENCE[1], pointer, required,
    required.filter((field) => Object.hasOwn(provider, field))
  );
  const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: providerId }) => providerId === provider.provider_id
  );
  if (!descriptor) return providerResult(PROVIDER_REFUSAL_PRECEDENCE[2],
    `${pointer}/provider_id`, TEST_PROOF_PROVIDER_CATALOG.providers.map(
      ({ provider_id: providerId }) => providerId
    ), provider.provider_id);
  if (expectedProviderId !== undefined && provider.provider_id !== expectedProviderId) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[2], `${pointer}/provider_id`,
      expectedProviderId, provider.provider_id);
  }
  if (provider.provider_version !== descriptor.provider_version) return providerResult(
    PROVIDER_REFUSAL_PRECEDENCE[3], `${pointer}/provider_version`,
    descriptor.provider_version, provider.provider_version
  );
  if (provider.capability !== capability || !descriptor.capabilities.includes(capability)) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[4], `${pointer}/capability`,
      capability, provider.capability);
  }
  if (requireSnapshot && provider.capability_snapshot_digest !==
      TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST) return providerResult(
    PROVIDER_REFUSAL_PRECEDENCE[5], `${pointer}/capability_snapshot_digest`,
    TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    provider.capability_snapshot_digest ?? null
  );
  const actualObservation = observationMechanism ?? provider.observation_mechanism;
  if (actualObservation !== undefined && !descriptor.observation_mechanisms.includes(
    actualObservation
  )) return providerResult(PROVIDER_REFUSAL_PRECEDENCE[6],
    `${pointer}/observation_mechanism`, descriptor.observation_mechanisms,
    actualObservation);
  if (observationSeam !== undefined && !descriptor.observation_seams.includes(
    observationSeam
  )) return providerResult(PROVIDER_REFUSAL_PRECEDENCE[7],
    `${pointer}/observation_seam`, descriptor.observation_seams, observationSeam);
  const artifactTypes = evidenceArtifactTypes ?? provider.evidence_artifact_types;
  if (artifactTypes !== undefined && (!Array.isArray(artifactTypes) ||
      artifactTypes.some((kind) => !descriptor.evidence_artifact_types.includes(kind)))) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[8],
      `${pointer}/evidence_artifact_types`, descriptor.evidence_artifact_types,
      artifactTypes);
  }
  if (strategy !== undefined && !descriptor.falsifier_strategies.includes(strategy)) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[9], `${pointer}/strategy`,
      descriptor.falsifier_strategies, strategy);
  }
  if (boundaryKind !== undefined && !descriptor.boundary_kinds.includes(boundaryKind)) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[10], `${pointer}/boundary_kind`,
      descriptor.boundary_kinds, boundaryKind);
  }
  return providerResult(null, pointer, null, null, descriptor);
}

export {
  PROVIDER_REFUSAL_PRECEDENCE,
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  resolveTestProofProviderCompatibility
};
