

import { randomBytes } from "node:crypto";

import { testRuntimeRunner } from "@agent-chassis/controlled-contract/test-proof";

import { PYTEST_PROVIDER_MODES, assertInstalledPytestRuntimeCurrent, buildPytestProviderRun,
  observeLauncherPytestRun, resolveInstalledPytestRuntime } from
  "../../workspace-agent-test-proof-pytest-provider.mjs";
import { DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS } from "../confined-capture.mjs";
import { resolveConfiguredPytestRuntime } from "../runtime-inputs.mjs";
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

function configuredPytestRuntime(input, worktree) {
  const repositoryRoot = input?.authority?.main_repo;
  if (typeof repositoryRoot !== "string") return null;
  const resolved = resolveConfiguredPytestRuntime({ repositoryRoot, checkoutRoot: worktree,
    target: input.target, runner: PYTEST_RUNTIME_RUNNER });
  if (!resolved.configured) return null;
  if (!resolved.ok) {
    throw Object.assign(new Error(resolved.failure.message), {
      code: resolved.failure.code,
      detail: { failure: "configured_runtime_not_ready", readiness_code: resolved.failure.code,
        recovery: resolved.failure.recovery ?? null }
    });
  }
  return resolved;
}

function nativeExecution(plan, worktree) {
  return {
    runtime: { env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      binds: plan.read_only_binds },
    invocation: { command: plan.command, args: [...plan.args], cwd: worktree,
      channel: { kind: "fd" } },
    target_extensions: plan.target_extensions,
    timeout_ms: DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS,
    observe: ({ channelText, exitCode, channelOverflow }) => observeLauncherPytestRun({
      protocolText: channelText, exitCode, expectation: plan.expectation,
      reporterProtocolOverflow: channelOverflow })
  };
}

async function prepare(resolved, input) {
  assertClosedInput(input, ["authority", "target", "authorizedTargets", "selectedTest",
    "executionBudget"], "provider preparation refuses caller-supplied executable authority");
  const selectedTest = selectedTestExecutionInput(input);
  const worktree = launcherResolvedWorktree(input);
  let runtime;
  try {
    const configured = configuredPytestRuntime(input, worktree);
    runtime = await resolveInstalledPytestRuntime({ executionBudget: input.executionBudget ?? null,
      configured });
  } catch (error) {
    return Object.freeze({ status: "unavailable", provider_id: resolved.provider_id,
      run: nativeInterruptedRun(typeof error?.code === "string" ? error.code
        : "test_proof_native_runtime_unavailable", error?.detail ?? null, input.executionBudget) });
  }
  const plan = buildPytestProviderRun({ mode: "probe", runtime, worktree, selectedTest,
    attemptNonce: randomBytes(32).toString("hex") });
  const run = await runDeclaredTest(input, mintProviderExecution(resolved, [], plan.expectation,
    nativeExecution(plan, worktree)));
  const observation = run.test_proof_observation;
  return brandPreparedRuntime({
    schema_version: "workspace-agent-test-proof-native-preparation.v1",
    status: observation?.valid === true ? "prepared" : "unavailable",
    provider_id: resolved.provider_id,
    provider_version: resolved.provider_version,
    selector_kind: "pytest_node_id",
    runtime,
    runtime_inputs_digest: runtime.runtime_inputs_digest,
    pytest_version: observation?.valid === true ? observation.pytest_version : null,
    consumer_compilation: observation?.valid === true ? observation.consumer_compilation : null,
    run
  });
}

async function execute(resolved, input, selectedTest) {
  const worktree = launcherResolvedWorktree(input);
  const prepared = assertPreparedRuntime(input.preparedRuntime, resolved);
  assertInstalledPytestRuntimeCurrent(prepared.runtime);
  if (prepared.runtime.runtime_source === "launcher_readiness") {
    const current = configuredPytestRuntime(input, worktree);
    if (current === null || current.readiness_digest !== prepared.runtime.readiness_digest ||
        current.interpreter !== prepared.runtime.interpreter) fail(
      TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
      "the configured pytest runtime readiness changed after preparation");
  }
  const mode = PYTEST_PROVIDER_MODES[resolved.provider_id];
  const plan = buildPytestProviderRun({ mode, runtime: prepared.runtime, worktree, selectedTest,
    attemptNonce: randomBytes(32).toString("hex"), selection: resolved.selection });
  const run = await runDeclaredTest(input, mintProviderExecution(resolved, [], plan.expectation,
    nativeExecution(plan, worktree)));
  const observation = run.test_proof_observation;
  const provider = providerEvidence(resolved, resolved.capability);
  const artifacts = Object.freeze(observation?.artifacts ?? []);
  if (mode === "candidate") return candidateResult({ observation, run, artifacts, provider });
  if (mode === "falsifier") return falsifierResult({ observation, run, artifacts, provider });
  return traversalResult({ observation, run, artifacts, provider, selection: resolved.selection });
}

export default Object.freeze({ family_id: "pytest", prepare, execute });
