

import { randomBytes } from "node:crypto";

import { testRuntimeRunner } from "@agent-chassis/controlled-contract/test-proof";

import { PYTEST_PROVIDER_MODES, buildPytestProviderRun, observeLauncherPytestRun,
  refreshInstalledPytestRuntime, resolveInstalledPytestRuntime } from
  "../../workspace-agent-test-proof-pytest-provider.mjs";
import { mintProofStage, resolveTestFileRuntime } from "../ordinary-test-runner.mjs";
import { configuredPytestRuntime } from "../runtime-inputs.mjs";
import { withRuntimeProvenance } from "./native-lifecycle.mjs";
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

const PYTEST_RUNTIME_RUNNER = testRuntimeRunner({ name: "pytest" });

async function routedPytestRuntime(input, worktree) {
  const routed = await resolveTestFileRuntime({ repositoryRoot: input.authority.main_repo, checkoutRoot: worktree,
    target: input.target, descriptor: PYTEST_RUNTIME_RUNNER, environment: input.environment ?? null });
  const failure = (code, message, recovery, route) => Object.assign(new Error(message), { code,
    detail: { failure: "configured_runtime_not_ready", readiness_code: code, recovery: recovery ?? null,
      ...(route === undefined ? {} : { route }) } });
  if (!routed.ok) {
    throw failure(routed.code, routed.message, routed.recovery,
      routed.kind === "route" ? routed.detail : routed.route ?? undefined);
  }
  const resolved = configuredPytestRuntime({ located: { configured: true, ok: true, project: routed.project,
    route: routed.route }, runtime: routed.runtime });
  if (!resolved.ok) {
    throw failure(resolved.failure.code, resolved.failure.message, resolved.failure.recovery,
      resolved.failure.detail);
  }
  return resolved;
}

async function prepare(resolved, input) {
  assertClosedInput(input, ["authority", "target", "authorizedTargets", "selectedTest",
    "executionBudget", "environment"], "provider preparation refuses caller-supplied executable authority");
  selectedTestExecutionInput(input);
  const worktree = launcherResolvedWorktree(input);
  let runtime;
  try {
    const configured = await routedPytestRuntime(input, worktree);
    runtime = await resolveInstalledPytestRuntime({ executionBudget: input.executionBudget ?? null,
      configured });
  } catch (error) {
    return Object.freeze({ status: "unavailable", provider_id: resolved.provider_id,
      run: nativeInterruptedRun(typeof error?.code === "string" ? error.code
        : "test_proof_native_runtime_unavailable", error?.detail ?? null, input.executionBudget) });
  }
  return brandPreparedRuntime({
    schema_version: "workspace-agent-test-proof-native-preparation.v1",
    status: "prepared",
    provider_id: resolved.provider_id,
    provider_version: resolved.provider_version,
    selector_kind: "pytest_node_id",
    runtime,
    runtime_inputs_digest: runtime.runtime_inputs_digest
  });
}

async function execute(resolved, input, selectedTest) {
  const worktree = launcherResolvedWorktree(input);
  const prepared = assertPreparedRuntime(input.preparedRuntime, resolved);

  const refreshed = refreshInstalledPytestRuntime(prepared.runtime);
  const configured = prepared.runtime.runtime_source === "launcher_readiness";
  const mode = PYTEST_PROVIDER_MODES[resolved.provider_id];
  let provenance = null;
  let composed = false;
  let expectation = null;
  const compose = ({ runtime: shared, route }) => {
    composed = true;
    let { runtime } = refreshed;
    let environmentChanged = refreshed.changed.length > 0;
    if (configured) {
      if (shared.executables.python !== prepared.runtime.interpreter ||
          (route?.environment ?? null) !== prepared.runtime.environment) fail(
        TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
        "the configured pytest interpreter or routed environment changed after preparation");
      const population = prepared.runtime.dependency_population;
      const current = shared.identity;
      if (JSON.stringify([current.readiness_digest, current.toolchains, current.dependencies]) !==
          JSON.stringify([population.readiness_digest, population.toolchains, population.dependencies])) {
        environmentChanged = true;
        runtime = Object.freeze({ ...runtime, readiness_digest: current.readiness_digest,
          dependency_population: Object.freeze({ ...population, readiness_digest: current.readiness_digest,
            toolchains: current.toolchains, dependencies: current.dependencies }) });
      }
    } else if (route !== null) {
      fail(TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
        "the pytest target is now routed to a project environment its preparation did not bind");
    }
    provenance = !environmentChanged ? null : Object.freeze({ changed_since_preparation: true,
      runtime_inputs_digest: runtime.runtime_inputs_digest,
      preparation_runtime_inputs_digest: prepared.runtime.runtime_inputs_digest,
      readiness_digest: runtime.readiness_digest, environment: runtime.environment,
      toolchains: runtime.dependency_population?.toolchains ?? null,
      dependencies: runtime.dependency_population?.dependencies ?? null,
      interpreter_digest: runtime.interpreter_digest, runtime_package_digests: runtime.runtime_package_digests });
    const plan = buildPytestProviderRun({ mode, runtime, worktree, selectedTest,
      attemptNonce: randomBytes(32).toString("hex"), selection: resolved.selection });
    expectation = plan.expectation;

    const bound = new Set(shared.binds.map(({ src, dst }) => `${src}\0${dst}`));
    return {
      proof: { args: plan.args },
      additions: { channel: { kind: "fd" },
        readOnlyBinds: plan.read_only_binds.filter(({ src, dst }) => !bound.has(`${src}\0${dst}`)) },
      observe: ({ channelText, exitCode, channelOverflow }) => observeLauncherPytestRun({
        protocolText: channelText, exitCode, expectation, reporterProtocolOverflow: channelOverflow })
    };
  };
  let run = await runDeclaredTest(input, mintProviderExecution(resolved, {
    runner: PYTEST_RUNTIME_RUNNER.name,
    environment: input.environment ?? null,
    targetExtensions: [".py"],
    stage: mintProofStage({ compose })
  }));
  if (configured && !composed && run.ran === false && run.runner_execution?.status === "refused" &&
      typeof run.blocker_code === "string" && run.blocker_code.startsWith("test_runtime_")) {
    fail(TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
      "the configured pytest runtime can no longer be resolved", run.test_proof_observation?.detail ?? null);
  }
  run = withRuntimeProvenance(run, provenance);
  const observation = run.test_proof_observation;
  const provider = providerEvidence(resolved, resolved.capability);
  const artifacts = Object.freeze(observation?.artifacts ?? []);
  if (mode === "candidate") return candidateResult({ observation, run, artifacts, provider });
  if (mode === "falsifier") return falsifierResult({ observation, run, artifacts, provider });
  return traversalResult({ observation, run, artifacts, provider, selection: resolved.selection });
}

export default Object.freeze({ family_id: "pytest", prepare, execute });
