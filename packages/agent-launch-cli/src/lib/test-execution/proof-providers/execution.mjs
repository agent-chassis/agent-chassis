

import { realpathSync } from "node:fs";

import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG
} from "@agent-chassis/controlled-contract";

import { stableRuntimeTestIdFromParts } from "../../workspace-agent-test-proof-node-reporter.mjs";
import { nativeRuntimeTestId } from "../../workspace-agent-test-proof-runtime-identity.mjs";

export const TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES = Object.freeze({
  BINDING_INVALID: "test_proof_provider_registry.binding_invalid.v1",
  CAPABILITY_MISMATCH: "test_proof_provider_registry.capability_mismatch.v1",
  DUPLICATE: "test_proof_provider_registry.duplicate.v1",
  EXECUTION_UNTRUSTED: "test_proof_provider_registry.execution_untrusted.v1",
  PROVIDER_UNKNOWN: "test_proof_provider_registry.provider_unknown.v1",
  PROVIDER_STALE: "test_proof_provider_registry.provider_stale.v1"
});

export class TestProofProviderRegistryError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "TestProofProviderRegistryError";
    this.code = code;
    this.detail = detail;
  }
}

export function fail(code, message, detail = null) {
  throw new TestProofProviderRegistryError(code, message, detail);
}

const RESOLVED_PROVIDERS = new WeakSet();
const PROVIDER_EXECUTIONS = new WeakSet();
const PREPARED_NATIVE_RUNTIMES = new WeakSet();

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function catalogDescriptor(providerId) {
  return TEST_PROOF_PROVIDER_CATALOG.providers.find(({ provider_id: id }) => id === providerId) ?? null;
}

export function brandResolvedProvider(value) {
  const resolved = Object.freeze(value);
  RESOLVED_PROVIDERS.add(resolved);
  return resolved;
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

export function providerEvidence(resolved, capability) {
  const descriptor = catalogDescriptor(resolved.provider_id);
  return Object.freeze({
    provider_id: resolved.provider_id,
    provider_version: resolved.provider_version,
    capability,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    observation_mechanism: descriptor.observation_mechanisms[0],
    evidence_artifact_types: Object.freeze([...descriptor.evidence_artifact_types])
  });
}

export function mintProviderExecution(provider, nodeArguments, observationExpectation, native = null,
  nodeRuntime = null, nodeAssetBinds = []) {
  const execution = Object.freeze({ provider,
    node_arguments: Object.freeze([...nodeArguments]),
    node_asset_binds: Object.freeze(nodeAssetBinds.map((bind) =>
      Object.freeze({ src: bind.src, dst: bind.dst }))),
    node_runtime: nodeRuntime === null ? null : Object.freeze({ executable: nodeRuntime.executable,
      binds: Object.freeze(nodeRuntime.binds.map((bind) => Object.freeze({ src: bind.src, dst: bind.dst }))),
      mountpoints: Object.freeze([...nodeRuntime.mountpoints]) }),
    observation_expectation: Object.freeze(structuredClone(observationExpectation)),
    native: native === null ? null : Object.freeze({
      runtime: Object.freeze({ env: Object.freeze({ ...native.runtime.env }),
        binds: Object.freeze(native.runtime.binds.map((bind) => Object.freeze({ ...bind }))),
        mountpoints: Object.freeze([...(native.runtime.mountpoints ?? [])]) }),
      invocation: Object.freeze(native.invocation),
      target_extensions: Object.freeze([...native.target_extensions]),
      timeout_ms: native.timeout_ms,
      observe: native.observe,
      native_report: native.native_report ?? null
    }) });
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

export function brandPreparedRuntime(prepared) {
  const frozen = Object.freeze(prepared);
  if (frozen.status === "prepared") PREPARED_NATIVE_RUNTIMES.add(frozen);
  return frozen;
}

export function assertPreparedRuntime(prepared, resolved) {
  if (!isObject(prepared) || !PREPARED_NATIVE_RUNTIMES.has(prepared) ||
      prepared.provider_version === undefined ||
      prepared.selector_kind !== catalogDescriptor(resolved.provider_id)?.selector_kind) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
    "native provider execution requires launcher-prepared installed runtime inputs"
  );
  return prepared;
}

export function assertClosedInput(input, fields, message) {
  const allowed = new Set(fields);
  if (!isObject(input) || Object.keys(input).some((key) => !allowed.has(key))) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED, message);
  return input;
}

export function launcherResolvedWorktree(input) {
  const worktree = input?.authority?.worktree_path;
  if (typeof worktree !== "string" || worktree.length === 0) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
    "provider execution requires launcher-bound worktree authority"
  );
  try {
    return realpathSync(worktree);
  } catch (error) {
    return fail(TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
      "provider execution requires a resolvable launcher-bound worktree",
      { errno: error?.code ?? null });
  }
}

export function selectedTestExecutionInput(input) {
  const selectedTest = input.selectedTest;
  if (isObject(selectedTest) && selectedTest.selector_kind !== undefined) {
    if (!Object.isFrozen(selectedTest) || selectedTest.file !== input.target ||
        typeof selectedTest.node_id !== "string" || selectedTest.test_id !== nativeRuntimeTestId({
          provider_id: selectedTest.provider_id, provider_version: selectedTest.provider_version,
          path: selectedTest.file, node_id: selectedTest.node_id })) fail(
      TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
      "provider execution requires one complete launcher-authenticated native selected test"
    );
    return selectedTest;
  }
  if (!isObject(selectedTest) || !Object.isFrozen(selectedTest) ||
      selectedTest.file !== input.target || typeof selectedTest.name !== "string" ||
      selectedTest.name.length === 0 || !Number.isSafeInteger(selectedTest.nesting) ||
      selectedTest.nesting < 0 || selectedTest.test_id !== stableRuntimeTestIdFromParts({
        file: selectedTest.file, name: selectedTest.name, nesting: selectedTest.nesting
      })) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
    "provider execution requires one complete launcher-authenticated selected test"
  );
  return selectedTest;
}

export function nativeInterruptedRun(code, detail, budget) {
  const interruption = budget?.interruption?.() ?? null;
  return Object.freeze({ ran: false, disposition: "not_run", exit_code: null, signal: null,
    timed_out: interruption === "timed_out",
    blocker_code: interruption === "timed_out" ? "test_proof_execution_timed_out"
      : interruption === "cancelled" ? "test_proof_execution_cancelled" : code,
    output_truncated: false, output_elided_bytes: 0, detail });
}

export async function runDeclaredTest(input, providerExecution) {
  const { runLauncherTestProofDeclaredTest } = await import(
    "../../workspace-agent-validation-runner.mjs"
  );
  return runLauncherTestProofDeclaredTest({
    authority: input.authority,
    target: input.target,
    authorizedTargets: input.authorizedTargets,
    testProofProviderExecution: providerExecution,
    ...(input.executionBudget === undefined ? {} : { executionBudget: input.executionBudget })
  });
}

const NATIVE_INSTRUMENTATION_UNSUPPORTED_CODE = "test_proof_native_instrumentation_unsupported";
export const PROOF_CAPABILITY_LIMITATION_CODES = Object.freeze([
  NATIVE_INSTRUMENTATION_UNSUPPORTED_CODE,
  "test_proof_native_runner_unsupported",
  "test_proof_native_selection_unsupported"
]);

const MALFORMED_REPLACEMENT_REASONS = Object.freeze([
  "replacement_kind_incompatible",
  "replacement_not_distinct",
  "replacement_not_scalar"
]);

const LIMITATION_REASON_KEYS = Object.freeze(["reason", "grammar", "original_kind",
  "replacement_kind"]);
const LIMITATION_REASON_RE = /^[a-z][a-z0-9_]{0,63}$/u;

export function proofCapabilityLimitation(run) {
  const observation = run?.test_proof_observation;
  if (!isObject(observation) || observation.valid === true ||
      !PROOF_CAPABILITY_LIMITATION_CODES.includes(observation.code)) return null;
  if (observation.code === NATIVE_INSTRUMENTATION_UNSUPPORTED_CODE &&
      MALFORMED_REPLACEMENT_REASONS.includes(observation.detail?.reason)) return null;
  const detail = {};
  for (const key of LIMITATION_REASON_KEYS) {
    const value = observation.detail?.[key];
    if (typeof value === "string" && LIMITATION_REASON_RE.test(value)) detail[key] = value;
  }
  return Object.freeze({
    reason_code: observation.code,
    detail: Object.keys(detail).length === 0 ? null : Object.freeze(detail)
  });
}

export function candidateResult({ observation, run, artifacts, provider }) {
  const valid = observation?.valid === true;
  return Object.freeze({ status: valid ? observation.status : "error",
    selected_status: valid ? observation.selected_status : null, exit_code: run.exit_code ?? null,
    observed_shortcuts: [], structured_result: observation?.structured_result ?? null,
    test_inventory: observation?.test_inventory ?? null, artifacts, provider, run });
}

export function falsifierResult({ observation, run, artifacts, provider }) {
  const valid = observation?.valid === true;
  return Object.freeze({ isolated: true, status: valid ? observation.status : "skipped",
    limitation: proofCapabilityLimitation(run),
    mutation_observed: observation?.mutation_observed === true,
    mutation: observation?.mutation ?? null,
    failure_reason_code: observation?.failure_reason_code ?? null, artifacts, provider, run });
}

export function traversalResult({ observation, run, artifacts, provider, selection }) {
  const valid = observation?.valid === true;

  const limitation = proofCapabilityLimitation(run);
  return Object.freeze({ providerSupport: limitation === null ? "supported" : "unsupported",
    authenticated: limitation === null, limitation,
    observed: valid && observation.traversal_observed === true,
    observation_mechanism: selection.observation_mechanism,
    observation_seam: limitation === null ? selection.observation_seam : null,
    boundary_kind: selection.boundary_kind,
    boundary_observation: observation?.boundary_observation ?? null, artifacts, provider, run });
}
