import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  PROVIDER_REFUSAL_PRECEDENCE,
  resolveStableTestProofProviderBindings
} from "@agent-chassis/controlled-contract";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  NODE_TEST_PROOF_FAULT_LOADER_PATH,
  NODE_TEST_PROOF_REPORTER_PATH
} from "./workspace-agent-test-proof-node-observation.mjs";
import { buildTestProofFaultModuleUrl, testProofFaultMutationAttestationCode,
  testProofRuntimeModuleIdentity } from
  "./workspace-agent-test-proof-module-fault-contract.mjs";

export const TEST_PROOF_PROVIDER_REGISTRY_SCHEMA_VERSION =
  "workspace-agent-test-proof-provider-registry.v1";

export const TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES = Object.freeze({
  BINDING_INVALID: "test_proof_provider_registry.binding_invalid.v1",
  CAPABILITY_MISMATCH: "test_proof_provider_registry.capability_mismatch.v1",
  DUPLICATE: "test_proof_provider_registry.duplicate.v1",
  EXECUTION_UNTRUSTED: "test_proof_provider_registry.execution_untrusted.v1",
  PROVIDER_UNKNOWN: "test_proof_provider_registry.provider_unknown.v1",
  PROVIDER_STALE: "test_proof_provider_registry.provider_stale.v1"
});

const RESOLVED_PROVIDERS = new WeakSet();
const PROVIDER_EXECUTIONS = new WeakSet();
const UNSUPPORTED_TRAVERSAL_ATTESTATIONS = new WeakSet();
const compare = (left, right) => String(left).localeCompare(String(right));

export class TestProofProviderRegistryError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "TestProofProviderRegistryError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = null) {
  throw new TestProofProviderRegistryError(code, message, detail);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function descriptor(providerId) {
  return TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: id }) => id === providerId
  );
}

function providerEvidence(value, capability) {
  const descriptorValue = descriptor(value.provider_id);
  return Object.freeze({
    provider_id: value.provider_id,
    provider_version: value.provider_version,
    capability,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    observation_mechanism: descriptorValue.observation_mechanisms[0],
    evidence_artifact_types: Object.freeze([...descriptorValue.evidence_artifact_types])
  });
}

function resolveExact(binding, expectedCapability, selection = null) {
  if (!isObject(binding)) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.BINDING_INVALID,
    "provider binding must be closed versioned data"
  );
  const found = descriptor(binding.provider_id);
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
  const resolved = Object.freeze({
    schema_version: "workspace-agent-test-proof-resolved-provider.v1",
    provider_id: found.provider_id,
    provider_version: found.provider_version,
    capability: expectedCapability,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    selection: selection === null ? null : Object.freeze(structuredClone(selection))
  });
  RESOLVED_PROVIDERS.add(resolved);
  return resolved;
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
  return Object.freeze({ candidate, falsifiers: Object.freeze(falsifiers), traversal,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST });
}

export function assertLauncherResolvedTestProofProvider(value, expectedCapability) {
  if (!isObject(value) || !Object.isFrozen(value) || !RESOLVED_PROVIDERS.has(value) ||
      value.capability !== expectedCapability ||
      value.capability_snapshot_digest !== TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
    "provider execution requires a launcher-resolved branded implementation"
  );
  return value;
}

function launcherModuleUrl(input, relativePath) {
  const worktree = input?.authority?.worktree_path;
  if (typeof worktree !== "string" || worktree.length === 0) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
    "provider execution requires launcher-bound worktree authority"
  );
  return pathToFileURL(path.join(worktree, relativePath)).href;
}

function launcherReporterUrl(input) {
  const reporterUrl = new URL(launcherModuleUrl(input, NODE_TEST_PROOF_REPORTER_PATH));
  reporterUrl.searchParams.set("launcher_protocol_fd", "3");
  return reporterUrl.href;
}

function mintProviderExecution(provider, nodeArguments, observationExpectation) {
  const execution = Object.freeze({ provider,
    node_arguments: Object.freeze([...nodeArguments]),
    observation_expectation: Object.freeze(structuredClone(observationExpectation)) });
  PROVIDER_EXECUTIONS.add(execution);
  return execution;
}

export function assertLauncherTestProofProviderExecution(value) {
  if (!isObject(value) || !Object.isFrozen(value) || !PROVIDER_EXECUTIONS.has(value)) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
    "test-proof execution context was not minted by the launcher registry"
  );
  return value;
}

async function runDeclaredTest(input, providerExecution) {
  const { runLauncherTestProofDeclaredTest } = await import(
    "./workspace-agent-validation-runner.mjs"
  );
  return runLauncherTestProofDeclaredTest({
    authority: input.authority,
    target: input.target,
    authorizedTargets: input.authorizedTargets,
    testProofProviderExecution: providerExecution
  });
}

export async function executeLauncherTestProofProvider(resolved, input = {}) {
  assertLauncherResolvedTestProofProvider(resolved, resolved?.capability);
  const inputFields = new Set(["authority", "target", "authorizedTargets", "targetTestId"]);
  if (!isObject(input) || Object.keys(input).some((key) => !inputFields.has(key)) ||
      typeof input.targetTestId !== "string" || !/^test-[a-f0-9]{64}$/u.test(input.targetTestId)) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
    "provider execution refuses caller-supplied executable authority"
  );
  if (resolved.capability === "candidate_execution") {
    const reporterUrl = launcherReporterUrl(input);
    const run = await runDeclaredTest(input, mintProviderExecution(resolved, [
      "--test-isolation=none", `--test-reporter=${reporterUrl}`
    ], { capability: "candidate_execution", target: input.target,
      target_test_id: input.targetTestId }));
    const observation = run.test_proof_observation;
    return Object.freeze({ status: observation?.valid === true ? observation.status : "error",
      selected_status: observation?.valid === true ? observation.selected_status : null,
      exit_code: run.exit_code ?? null, observed_shortcuts: [],
      structured_result: observation?.structured_result ?? null,
      test_inventory: observation?.test_inventory ?? null,
      artifacts: Object.freeze(observation?.artifacts ?? []),
      provider: providerEvidence(resolved, resolved.capability), run });
  }
  if (resolved.capability === "falsifier_execution") {
    const selection = resolved.selection;
    const reporterUrl = launcherReporterUrl(input);
    const loaderUrl = new URL(launcherModuleUrl(input, NODE_TEST_PROOF_FAULT_LOADER_PATH));
    const configuration = {
      schema_version: "workspace-agent-test-proof-module-fault.v1",
      strategy: selection.strategy,
      mechanism: selection.mutation.mechanism,
      mutation_id: selection.mutation.mutation_id,
      module_path: selection.mutation.module_path,
      failure_reason_code: selection.failure_reason_code
    };
    loaderUrl.searchParams.set("configuration", Buffer.from(JSON.stringify(
      configuration
    )).toString("base64url"));
    const registrationUrl = `data:text/javascript;base64,${Buffer.from(
      `import { register } from "node:module"; ` +
      `const namespace = await import(${JSON.stringify(
        `${launcherModuleUrl(input, selection.mutation.module_path)}?launcher_fault_export_probe=1`
      )}); ` +
      `register(${JSON.stringify(loaderUrl.href)}, import.meta.url, ` +
      `{ data: { export_names: Object.keys(namespace) } });`
    ).toString("base64")}`;
    const expectation = { capability: "falsifier_execution",
      falsifier_id: selection.falsifier_id, strategy: selection.strategy,
      mutation_id: selection.mutation.mutation_id,
      module_path: selection.mutation.module_path,
      fault_module_identity: `runtime-module-${testProofRuntimeModuleIdentity(
        buildTestProofFaultModuleUrl(configuration)
      ).slice("sha256:".length)}`,
      loader_module_path: NODE_TEST_PROOF_FAULT_LOADER_PATH,
      loader_function_name: "substituteFaultModule",
      target: input.target, target_test_id: input.targetTestId,
      mutation_attestation_code: testProofFaultMutationAttestationCode(configuration),
      failure_reason_code: selection.failure_reason_code };
    const run = await runDeclaredTest(input, mintProviderExecution(resolved, [
      "--test-isolation=none", `--test-reporter=${reporterUrl}`,
      `--import=${registrationUrl}`, "--experimental-test-coverage"
    ], expectation));
    const observation = run.test_proof_observation;
    return Object.freeze({ isolated: true,
      status: observation?.valid === true ? observation.status : "skipped",
      mutation_observed: observation?.mutation_observed === true,
      mutation: observation?.mutation ?? null,
      failure_reason_code: observation?.failure_reason_code ?? null,
      artifacts: Object.freeze(observation?.artifacts ?? []),
      provider: providerEvidence(resolved, resolved.capability), run });
  }
  const selection = resolved.selection;
  const reporterUrl = launcherReporterUrl(input);
  const run = await runDeclaredTest(input, mintProviderExecution(resolved, [
    "--test-isolation=none", `--test-reporter=${reporterUrl}`,
    "--experimental-test-coverage"
  ], { capability: "boundary_traversal", boundary_kind: selection.boundary_kind,
    module_path: selection.module_path, observation_seam: selection.observation_seam,
    target: input.target,
    target_test_id: input.targetTestId }));
  const observation = run.test_proof_observation;
  return Object.freeze({ providerSupport: "supported", authenticated: true,
    observed: observation?.valid === true && observation.traversal_observed === true,
    observation_mechanism: selection.observation_mechanism,
    observation_seam: selection.observation_seam,
    boundary_kind: selection.boundary_kind,
    boundary_observation: observation?.boundary_observation ?? null,
    artifacts: Object.freeze(observation?.artifacts ?? []),
    provider: providerEvidence(resolved, resolved.capability), run });
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
