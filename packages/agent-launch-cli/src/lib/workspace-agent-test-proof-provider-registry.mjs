import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  PROVIDER_REFUSAL_PRECEDENCE,
  resolveStableTestProofProviderBindings
} from "@agent-chassis/controlled-contract";
import { testProofProviderFamily } from "@agent-chassis/controlled-contract/test-proof";

import {
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES,
  TestProofProviderRegistryError,
  assertClosedInput,
  assertLauncherResolvedTestProofProvider,
  assertLauncherTestProofProviderExecution,
  brandResolvedProvider,
  catalogDescriptor,
  fail,
  isObject,
  selectedTestExecutionInput
} from "./test-execution/proof-providers/execution.mjs";
import { installedProofProviderImplementation } from "./test-execution/proof-providers/index.mjs";

export {
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES,
  TestProofProviderRegistryError,
  assertLauncherResolvedTestProofProvider,
  assertLauncherTestProofProviderExecution
};

export const TEST_PROOF_PROVIDER_REGISTRY_SCHEMA_VERSION =
  "workspace-agent-test-proof-provider-registry.v1";

const LAUNCHER_PROVIDER_IMPLEMENTATIONS = Object.freeze(Object.fromEntries(
  TEST_PROOF_PROVIDER_CATALOG.providers.map(({ provider_id: id, selector_kind: kind }) => [id,
    installedProofProviderImplementation(testProofProviderFamily(kind)?.family_id)])
));
if (Object.values(LAUNCHER_PROVIDER_IMPLEMENTATIONS).includes(null)) {
  throw new Error("launcher test-proof provider catalog names a provider without an installed integration");
}
const UNSUPPORTED_TRAVERSAL_ATTESTATIONS = new WeakSet();
const compare = (left, right) => String(left).localeCompare(String(right));

function implementationFor(resolved) {
  return LAUNCHER_PROVIDER_IMPLEMENTATIONS[resolved.provider_id];
}

function resolveExact(binding, expectedCapability, selection = null) {
  if (!isObject(binding)) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.BINDING_INVALID,
    "provider binding must be closed versioned data"
  );
  const found = catalogDescriptor(binding.provider_id);
  if (!found) fail(TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.PROVIDER_UNKNOWN,
    "provider identity is not present in the launcher registry",
    { provider_id: binding.provider_id ?? null });
  if (binding.provider_version !== found.provider_version) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.PROVIDER_STALE,
    "provider version does not match the launcher registry",
    { provider_id: found.provider_id, expected: found.provider_version,
      actual: binding.provider_version ?? null }
  );
  if (binding.capability !== expectedCapability ||
      !found.capabilities.includes(expectedCapability)) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.CAPABILITY_MISMATCH,
    "provider does not implement the required capability",
    { provider_id: found.provider_id, expected: expectedCapability,
      actual: binding.capability ?? null }
  );
  return brandResolvedProvider({
    schema_version: "workspace-agent-test-proof-resolved-provider.v1",
    provider_id: found.provider_id,
    provider_version: found.provider_version,
    capability: expectedCapability,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    selection: selection === null ? null : Object.freeze(structuredClone(selection))
  });
}

export function describeTestProofProviderRegistry() {
  return Object.freeze({
    schema_version: TEST_PROOF_PROVIDER_REGISTRY_SCHEMA_VERSION,
    registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
    registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    capability_snapshot_digest_rule:
      "sha256 of UTF-8 compact JSON for the package provider catalog in declared provider/capability order",
    providers: Object.freeze(TEST_PROOF_PROVIDER_CATALOG.providers.map((provider) =>
      Object.freeze({ ...provider, capabilities: Object.freeze([...provider.capabilities]) })
    )),
    authority: "launcher_owned_closed_registry"
  });
}

export function resolveTestProofProviders(binding) {
  try { resolveStableTestProofProviderBindings(binding); }
  catch (error) {
    const packageCode = error?.code;
    fail(PROVIDER_REFUSAL_PRECEDENCE.includes(packageCode)
      ? packageCode
      : TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.BINDING_INVALID,
      "package-owned provider binding validation failed",
      { package_code: packageCode ?? null, package_details: error?.details ?? null });
  }
  const candidate = resolveExact(binding.candidate_execution_provider, "candidate_execution");
  const falsifiers = binding.falsifiers.map((falsifier) => Object.freeze({
    falsifier_id: falsifier.falsifier_id,
    provider: resolveExact(falsifier.execution_provider, "falsifier_execution", {
      falsifier_id: falsifier.falsifier_id,
      strategy: falsifier.strategy,
      mutation: falsifier.mutation,
      failure_reason_code: `test_proof_fault.${falsifier.strategy}.v1`
    })
  })).sort((left, right) => compare(left.falsifier_id, right.falsifier_id));
  if (new Set(falsifiers.map(({ falsifier_id: id }) => id)).size !== falsifiers.length) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.DUPLICATE,
    "falsifier/provider associations must be unique"
  );
  let traversal;
  if (binding.traversal_provider.mode === "registry_unsupported") traversal = Object.freeze({
    mode: "registry_unsupported",
    registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
    registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION,
    capability: "traversal_unsupported",
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST
  });
  else traversal = Object.freeze({
    mode: "provider",
    provider: resolveExact(binding.traversal_provider, "boundary_traversal", {
      boundary_kind: binding.system_under_test_boundary.kind,
      module_path: binding.system_under_test_boundary.runtime_module_path,
      observation_mechanism: binding.traversal_provider.observation_mechanism,
      observation_seam: binding.traversal_provider.observation_seam,
      evidence_artifact_type: binding.traversal_provider.evidence_artifact_type
    })
  });
  const falsification = binding.falsification_provider?.mode === "registry_unsupported"
    ? Object.freeze({ mode: "registry_unsupported" })
    : Object.freeze({ mode: "provider" });
  return Object.freeze({ candidate, falsifiers: Object.freeze(falsifiers), falsification,
    traversal, capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST });
}

export function authenticateUnsupportedTestProofFalsification(binding) {
  if (!isObject(binding) || binding.mode !== "registry_unsupported" ||
      binding.registry_id !== TEST_PROOF_PROVIDER_REGISTRY_ID ||
      binding.registry_version !== TEST_PROOF_PROVIDER_REGISTRY_VERSION) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.BINDING_INVALID,
    "unsupported falsification must bind the exact launcher registry identity"
  );
  return Object.freeze({ reason_code: "test_proof_registry_falsification_unsupported",
    detail: null });
}

export async function prepareLauncherTestProofProviderRuntime(resolved, input = {}) {
  assertLauncherResolvedTestProofProvider(resolved, "candidate_execution");
  const implementation = implementationFor(resolved);
  if (implementation.family_id === "node-test") return null;
  assertClosedInput(input, ["authority", "target", "authorizedTargets", "selectedTest",
    "executionBudget"], "provider preparation refuses caller-supplied executable authority");
  return implementation.prepare(resolved, input);
}

export async function executeLauncherTestProofProvider(resolved, input = {}) {
  assertLauncherResolvedTestProofProvider(resolved, resolved?.capability);
  assertClosedInput(input, ["authority", "target", "authorizedTargets", "selectedTest",
    "executionBudget", "preparedRuntime"], "provider execution refuses caller-supplied executable authority");
  const selectedTest = selectedTestExecutionInput(input);
  const implementation = implementationFor(resolved);
  const selectorKind = catalogDescriptor(resolved.provider_id).selector_kind;
  if ((selectedTest.selector_kind ?? "node_test_name") !== selectorKind) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.CAPABILITY_MISMATCH,
    "the selected test belongs to another provider family");
  return implementation.execute(resolved, input, selectedTest);
}

export function authenticateUnsupportedTestProofTraversal(binding) {
  if (!isObject(binding) || binding.mode !== "registry_unsupported" ||
      binding.registry_id !== TEST_PROOF_PROVIDER_REGISTRY_ID ||
      binding.registry_version !== TEST_PROOF_PROVIDER_REGISTRY_VERSION) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.BINDING_INVALID,
    "unsupported traversal must bind the exact launcher registry identity"
  );
  const attestation = Object.freeze({ providerSupport: "unsupported", authenticated: true,
    observed: false, artifacts: [], observation_mechanism: "registry_unsupported",
    boundary_kind: null, provider: Object.freeze({
      registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
      registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION,
      capability: "traversal_unsupported",
      capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST
    }) });
  UNSUPPORTED_TRAVERSAL_ATTESTATIONS.add(attestation);
  return attestation;
}

export function assertRegistryUnsupportedTraversalAttestation(value) {
  if (!isObject(value) || !Object.isFrozen(value) ||
      !UNSUPPORTED_TRAVERSAL_ATTESTATIONS.has(value)) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
    "unsupported traversal requires a launcher-registry attestation"
  );
  return value;
}
