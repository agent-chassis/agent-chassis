

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { testRuntimeRunner } from "@agent-chassis/controlled-contract/test-proof";

import {
  NODE_TEST_PROOF_LAUNCHER_ASSETS,
  launcherNodeTestFaultLoaderUrl,
  launcherNodeTestRunReporterUrl,
  observeLauncherNodeTestRun
} from "../../workspace-agent-test-proof-node-observation.mjs";
import { TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION, buildTestProofFaultModuleRegistrationSource,
  describeTestProofModuleFaultAttempt } from "../../workspace-agent-test-proof-module-fault-contract.mjs";
import { mintProofStage, resolveTestFileRuntime } from "../ordinary-test-runner.mjs";
import { configuredExecutableFailure } from "../runtime-inputs.mjs";
import { nodeTestNativeReport } from "./node-test-native-report.mjs";
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
import { runtimeInputsDigest, runtimeProvenanceSincePreparation, withRuntimeProvenance } from
  "./native-lifecycle.mjs";

const NODE_TEST_RUNNER = testRuntimeRunner({ name: "node-test" });

function nodeTestProviderAssetDigest() {
  return `sha256:${createHash("sha256").update(JSON.stringify(
    [fileURLToPath(import.meta.url), ...NODE_TEST_PROOF_LAUNCHER_ASSETS].map((asset) =>
      [path.basename(asset), createHash("sha256").update(readFileSync(asset)).digest("hex")])))
    .digest("hex")}`;
}

async function resolvePreparedNodeRuntime(input, worktree) {
  const resolved = await resolveTestFileRuntime({ repositoryRoot: input.authority.main_repo,
    checkoutRoot: worktree, target: input.target, descriptor: NODE_TEST_RUNNER,
    environment: input.environment ?? null });
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, detail: { failure: "configured_runtime_not_ready",
      readiness_code: resolved.code, recovery: resolved.recovery,
      ...(resolved.kind === "route" ? { route: resolved.detail }
        : resolved.kind === "runtime" ? { route: resolved.route, ...resolved.detail } : {}) } };
  }
  const { runtime } = resolved;
  const unavailable = configuredExecutableFailure(runtime, runtime.executables.node);
  if (unavailable !== null) {
    return { ok: false, code: unavailable.code, detail: { failure: "configured_executable_unavailable",
      readiness_code: unavailable.code, recovery: unavailable.recovery, route: resolved.route,
      ...unavailable.detail } };
  }
  const providerAssetDigest = nodeTestProviderAssetDigest();
  return { ok: true, project: resolved.project, route: resolved.route, runtime,
    provider_asset_digest: providerAssetDigest,
    runtime_inputs_digest: runtimeInputsDigest(runtime, providerAssetDigest) };
}

async function prepare(resolved, input) {
  assertClosedInput(input, ["authority", "target", "authorizedTargets", "selectedTest",
    "executionBudget", "environment"], "provider preparation refuses caller-supplied executable authority");
  selectedTestExecutionInput(input);
  const worktree = launcherResolvedWorktree(input);
  const located = await resolvePreparedNodeRuntime(input, worktree);
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
      provider_asset_digest: located.provider_asset_digest,
      runtime_inputs_digest: located.runtime_inputs_digest,
      dependency_population: Object.freeze({ source: "launcher_readiness",
        readiness_digest: runtime.identity.readiness_digest, environment: runtime.identity.environment,
        route: located.route, toolchains: runtime.identity.toolchains,
        dependencies: runtime.identity.dependencies })
    }),
    runtime_inputs_digest: located.runtime_inputs_digest
  });
}

const NODE_TEST_ASSET_BINDS = Object.freeze(NODE_TEST_PROOF_LAUNCHER_ASSETS.map((asset) =>
  Object.freeze({ src: asset, dst: asset })));

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

function nodeDeclaredCoverageArguments(worktree, modulePaths) {
  return ["--experimental-test-coverage",
    ...[...new Set(modulePaths)].sort().map((modulePath) => `--test-coverage-include=${
      path.join(worktree, modulePath).replace(/[*?[\]{}()!+@]/gu, (character) => `[${character}]`)}`),
    "--test-coverage-exclude=**/node_modules/**"];
}

async function execute(resolved, input, selectedTest) {
  if (selectedTest.selector_kind !== undefined) fail(
    TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.CAPABILITY_MISMATCH,
    "a node:test provider cannot execute a native selected test");
  const selectedArguments = nodeTestSelectionArguments(selectedTest);

  const launcherWorktree = launcherResolvedWorktree(input);
  const prepared = input.preparedRuntime === undefined ? null
    : assertPreparedRuntime(input.preparedRuntime, resolved);
  const provider = providerEvidence(resolved, resolved.capability);

  const runStage = async (options, expectation) => {
    let provenance = null;
    let composed = false;
    const compose = ({ runtime, project, executionRoot }) => {
      composed = true;

      const assets = nodeTestProviderAssetDigest();
      if (prepared !== null && (assets !== prepared.runtime.provider_asset_digest ||
          project !== prepared.project || runtime.identity.environment !== prepared.runtime.environment)) {
        throw Object.assign(new Error("the node:test provider or its routed environment changed after preparation"), {
          code: "test_proof_native_runtime_inputs_stale",
          detail: { provider_asset_digest: { expected: prepared.runtime.provider_asset_digest, actual: assets },
            environment: { expected: prepared.runtime.environment, actual: runtime.identity.environment } } });
      }
      provenance = prepared === null ? null
        : runtimeProvenanceSincePreparation(prepared, runtime, runtimeInputsDigest(runtime, assets));
      const privateRoot = path.join(executionRoot.scratch, ".launcher-test-proof");
      const reportPath = path.join(privateRoot, "node-test-events.json");
      const reporter = ["--test-reporter=spec", "--test-reporter-destination=stdout",
        `--test-reporter=${launcherNodeTestRunReporterUrl(launcherWorktree)}`,
        `--test-reporter-destination=${reportPath}`];
      return {
        proof: { options: [...reporter, ...options, ...selectedArguments] },
        additions: { directories: [privateRoot], channel: { kind: "file", path: reportPath },
          readOnlyBinds: NODE_TEST_ASSET_BINDS },
        nativeReport: () => nodeTestNativeReport({ workRoot: launcherWorktree }),
        observe: ({ channelText, exitCode, channelOverflow, nativeReport }) => observeLauncherNodeTestRun({
          stdout: channelText, exitCode, expectation, reporterProtocolOverflow: channelOverflow,
          nativeReport })
      };
    };
    const run = await runDeclaredTest(input, mintProviderExecution(resolved, {
      runner: NODE_TEST_RUNNER.name,
      environment: input.environment ?? null,
      consumerDependencies: true,
      stage: mintProofStage({ compose })
    }));
    if (prepared !== null && !composed && run.ran === false && run.runner_execution?.status === "refused" &&
        typeof run.blocker_code === "string" && run.blocker_code.startsWith("test_runtime_")) {
      fail(TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
        "the prepared node:test runtime can no longer be resolved",
        { failure: "configured_runtime_not_ready", readiness_code: run.blocker_code,
          ...(run.test_proof_observation?.detail ?? {}) });
    }
    return withRuntimeProvenance(run, provenance);
  };
  if (resolved.capability === "candidate_execution") {
    const run = await runStage([], { capability: "candidate_execution", target: input.target,
      target_test_id: selectedTest.test_id });
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
    const registrationUrl = `data:text/javascript;base64,${Buffer.from(
      buildTestProofFaultModuleRegistrationSource(configuration,
        launcherNodeTestFaultLoaderUrl(configuration, launcherWorktree), launcherWorktree)
    ).toString("base64")}`;
    const expectation = { capability: "falsifier_execution",
      falsifier_id: selection.falsifier_id, strategy: configuration.strategy, configuration,
      mutation_attestation_code: attempt.mutation_attestation_code,
      fault_module_identity: attempt.fault_module_identity,
      target: input.target, target_test_id: selectedTest.test_id };
    const run = await runStage([`--import=${registrationUrl}`,
      ...nodeDeclaredCoverageArguments(launcherWorktree, [
        selection.mutation.module_path,
        ...(selection.strategy === "forced_invocation" ? [selection.mutation.operation.module_path] : [])
      ])], expectation);
    const observation = run.test_proof_observation;
    return falsifierResult({ observation, run, provider,
      artifacts: Object.freeze(observation?.artifacts ?? []) });
  }
  const selection = resolved.selection;
  const run = await runStage(nodeDeclaredCoverageArguments(launcherWorktree, [selection.module_path]),
    { capability: "boundary_traversal", boundary_kind: selection.boundary_kind,
      module_path: selection.module_path, observation_seam: selection.observation_seam,
      target: input.target,
      target_test_id: selectedTest.test_id });
  const observation = run.test_proof_observation;
  return traversalResult({ observation, run, provider, selection,
    artifacts: Object.freeze(observation?.artifacts ?? []) });
}

export default Object.freeze({
  family_id: "node-test",
  prepare,
  execute
});
