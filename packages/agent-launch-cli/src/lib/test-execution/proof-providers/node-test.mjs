

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { testRuntimeRunner } from "@agent-chassis/controlled-contract/test-proof";

import {
  NODE_TEST_PROOF_FAULT_LOADER_PATH,
  NODE_TEST_PROOF_REPORTER_PATH
} from "../../workspace-agent-test-proof-node-observation.mjs";
import { TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION, buildTestProofFaultModuleRegistrationSource,
  describeTestProofModuleFaultAttempt } from "../../workspace-agent-test-proof-module-fault-contract.mjs";
import { readinessRecovery } from "../../test-runtime-setup/readiness.mjs";
import { resolveProofEnvironment, resolveRunnerRuntimeInputs } from "../runtime-inputs.mjs";
import {
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES,
  assertClosedInput,
  assertPreparedRuntime,
  brandPreparedRuntime,
  candidateResult,
  fail,
  falsifierResult,
  launcherResolvedWorktree,
  mintProviderExecution,
  nativeInterruptedRun,
  providerEvidence,
  runDeclaredTest,
  selectedTestExecutionInput,
  traversalResult
} from "./execution.mjs";
import { runtimeInputsDigest } from "./native-lifecycle.mjs";

const NODE_TEST_RUNNER = testRuntimeRunner({ name: "node-test" });

const NODE_TEST_PROVIDER_ASSET_DIGEST = `sha256:${createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url))).digest("hex")}`;

function resolvePreparedNodeRuntime(input, worktree) {
  const repositoryRoot = input.authority.main_repo;
  const located = resolveProofEnvironment({ repositoryRoot, checkoutRoot: worktree, target: input.target,
    runner: NODE_TEST_RUNNER, environment: input.environment ?? null });
  if (!located.configured) return null;
  if (!located.ok) {
    return { ok: false, code: located.failure.code, detail: { failure: "configured_runtime_not_ready",
      readiness_code: located.failure.code, recovery: located.failure.recovery ?? readinessRecovery(),
      ...(located.failure.detail === undefined ? {} : { route: located.failure.detail }) } };
  }
  const runtime = resolveRunnerRuntimeInputs({ repositoryRoot, checkoutRoot: worktree,
    descriptor: NODE_TEST_RUNNER, project: located.project });
  if (!runtime.ok) {
    return { ok: false, code: runtime.code, detail: { failure: "configured_runtime_not_ready",
      readiness_code: runtime.code, recovery: runtime.recovery ?? null, route: located.route } };
  }
  return { ok: true, project: located.project, route: located.route, runtime,
    runtime_inputs_digest: runtimeInputsDigest(runtime, NODE_TEST_PROVIDER_ASSET_DIGEST) };
}

async function prepare(resolved, input) {
  assertClosedInput(input, ["authority", "target", "authorizedTargets", "selectedTest",
    "executionBudget", "environment"], "provider preparation refuses caller-supplied executable authority");
  selectedTestExecutionInput(input);
  const worktree = launcherResolvedWorktree(input);
  const located = resolvePreparedNodeRuntime(input, worktree);
  if (located === null) return null;
  if (!located.ok) {
    return brandPreparedRuntime({ status: "unavailable", provider_id: resolved.provider_id,
      run: nativeInterruptedRun(located.code, located.detail, input.executionBudget) });
  }
  const { runtime } = located;
  return brandPreparedRuntime({
    schema_version: "workspace-agent-test-proof-node-preparation.v1",
    status: "prepared",
    provider_id: resolved.provider_id,
    provider_version: resolved.provider_version,
    selector_kind: "node_test_name",
    project: located.project,
    runtime: Object.freeze({
      runtime_source: "launcher_readiness",
      runtime_runner: NODE_TEST_RUNNER.runner_id,
      project: located.project,
      environment: runtime.identity.environment,
      route: located.route,
      readiness_digest: runtime.identity.readiness_digest,
      provider_asset_digest: NODE_TEST_PROVIDER_ASSET_DIGEST,
      runtime_inputs_digest: located.runtime_inputs_digest,
      dependency_population: Object.freeze({ source: "launcher_readiness",
        readiness_digest: runtime.identity.readiness_digest, environment: runtime.identity.environment,
        route: located.route, toolchains: runtime.identity.toolchains,
        dependencies: runtime.identity.dependencies })
    }),
    runtime_inputs_digest: located.runtime_inputs_digest
  });
}

function preparedNodeRuntime(input, worktree) {
  if (input.preparedRuntime === undefined) return null;
  const prepared = input.preparedRuntime;
  const current = resolvePreparedNodeRuntime(input, worktree);
  if (current === null || !current.ok) fail(TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
    "the prepared node:test runtime is no longer ready", current?.detail ?? null);
  if (current.runtime_inputs_digest !== prepared.runtime_inputs_digest ||
      current.runtime.identity.environment !== prepared.runtime.environment) {
    throw Object.assign(new Error("installed node:test runtime inputs changed after preparation"), {
      code: "test_proof_native_runtime_inputs_stale",
      detail: { expected: prepared.runtime_inputs_digest, actual: current.runtime_inputs_digest } });
  }
  const { runtime } = current;
  return Object.freeze({ executable: runtime.executables.node,
    binds: Object.freeze(runtime.binds.map((bind) => Object.freeze({ src: bind.src, dst: bind.dst }))),
    mountpoints: Object.freeze([...runtime.mountpoints]) });
}

function launcherModuleUrl(worktree, relativePath) {
  return pathToFileURL(path.join(worktree, relativePath)).href;
}

function launcherReporterUrl(worktree) {
  const reporterUrl = new URL(launcherModuleUrl(worktree, NODE_TEST_PROOF_REPORTER_PATH));
  reporterUrl.searchParams.set("launcher_protocol_fd", "3");
  return reporterUrl.href;
}

function nodeTestSelectionArguments(selectedTest) {
  const literalName = selectedTest.name
    .replace(/[\\^$.*+?()[\]{}|/]/gu, "\\$&")
    .replace(/\n/gu, "\\n")
    .replace(/\r/gu, "\\r")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
  const exact = `(?:${literalName})(?![\\s\\S])`;
  const selectedArguments = [`--test-name-pattern=^${exact}`];

  if (selectedTest.nesting === 0) selectedArguments.push(
    `--test-skip-pattern=^(?:\\s+(?:${literalName})\\s*|(?:${literalName})\\s+)(?![\\s\\S])`
  );
  return selectedArguments;
}

function nodeDeclaredCoverageArguments(modulePaths) {
  return ["--experimental-test-coverage",
    ...[...new Set(modulePaths)].sort().map((modulePath) => `--test-coverage-include=${
      modulePath.replace(/[*?[\]{}()!+@]/gu, (character) => `[${character}]`)}`),
    "--test-coverage-exclude=**/node_modules/**"];
}

async function execute(resolved, input, selectedTest) {
  if (selectedTest.selector_kind !== undefined) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.CAPABILITY_MISMATCH,
    "a node:test provider cannot execute a native selected test");
  const selectedArguments = nodeTestSelectionArguments(selectedTest);

  const launcherWorktree = launcherResolvedWorktree(input);
  if (input.preparedRuntime !== undefined) assertPreparedRuntime(input.preparedRuntime, resolved);
  const nodeRuntime = preparedNodeRuntime(input, launcherWorktree);
  const mint = (nodeArguments, expectation) =>
    mintProviderExecution(resolved, nodeArguments, expectation, null, nodeRuntime);
  const provider = providerEvidence(resolved, resolved.capability);
  if (resolved.capability === "candidate_execution") {
    const reporterUrl = launcherReporterUrl(launcherWorktree);
    const run = await runDeclaredTest(input, mint([
      "--test-isolation=none", `--test-reporter=${reporterUrl}`, ...selectedArguments
    ], { capability: "candidate_execution", target: input.target,
      target_test_id: selectedTest.test_id }));
    const observation = run.test_proof_observation;
    return candidateResult({ observation, run, provider,
      artifacts: Object.freeze(observation?.artifacts ?? []) });
  }
  if (resolved.capability === "falsifier_execution") {
    const selection = resolved.selection;

    const attempt = describeTestProofModuleFaultAttempt({
      ...(selection.strategy === "forced_invocation" ? {
        entry_export: selection.mutation.entry_export, operation: selection.mutation.operation,
        invocation: selection.mutation.invocation
      } : {}),
      schema_version: TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION,
      strategy: selection.strategy,
      mechanism: selection.mutation.mechanism,
      mutation_id: selection.mutation.mutation_id,
      module_path: selection.mutation.module_path,
      failure_reason_code: selection.failure_reason_code,
      attempt_nonce: randomBytes(32).toString("hex")
    }, launcherWorktree);
    const configuration = attempt.configuration;
    const reporterUrl = launcherReporterUrl(launcherWorktree);
    const loaderUrl = new URL(launcherModuleUrl(launcherWorktree,
      NODE_TEST_PROOF_FAULT_LOADER_PATH));
    loaderUrl.searchParams.set("configuration", Buffer.from(JSON.stringify(
      configuration
    )).toString("base64url"));
    const registrationUrl = `data:text/javascript;base64,${Buffer.from(
      buildTestProofFaultModuleRegistrationSource(configuration, loaderUrl.href,
        launcherWorktree)
    ).toString("base64")}`;
    const expectation = { capability: "falsifier_execution",
      falsifier_id: selection.falsifier_id, strategy: configuration.strategy, configuration,
      mutation_attestation_code: attempt.mutation_attestation_code,
      fault_module_identity: attempt.fault_module_identity,
      target: input.target, target_test_id: selectedTest.test_id };
    const run = await runDeclaredTest(input, mint([
      "--test-isolation=none", `--test-reporter=${reporterUrl}`,
      `--import=${registrationUrl}`, ...nodeDeclaredCoverageArguments([
        selection.mutation.module_path,
        ...(selection.strategy === "forced_invocation" ? [selection.mutation.operation.module_path] : [])
      ]), ...selectedArguments
    ], expectation));
    const observation = run.test_proof_observation;
    return falsifierResult({ observation, run, provider,
      artifacts: Object.freeze(observation?.artifacts ?? []) });
  }
  const selection = resolved.selection;
  const reporterUrl = launcherReporterUrl(launcherWorktree);
  const run = await runDeclaredTest(input, mint([
    "--test-isolation=none", `--test-reporter=${reporterUrl}`,
    ...nodeDeclaredCoverageArguments([selection.module_path]), ...selectedArguments
  ], { capability: "boundary_traversal", boundary_kind: selection.boundary_kind,
    module_path: selection.module_path, observation_seam: selection.observation_seam,
    target: input.target,
    target_test_id: selectedTest.test_id }));
  const observation = run.test_proof_observation;
  return traversalResult({ observation, run, provider, selection,
    artifacts: Object.freeze(observation?.artifacts ?? []) });
}

export default Object.freeze({
  family_id: "node-test",
  prepare,
  execute
});
