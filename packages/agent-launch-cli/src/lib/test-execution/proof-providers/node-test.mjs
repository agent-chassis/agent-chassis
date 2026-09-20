

import { randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  NODE_TEST_PROOF_FAULT_LOADER_PATH,
  NODE_TEST_PROOF_REPORTER_PATH
} from "../../workspace-agent-test-proof-node-observation.mjs";
import { TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION, buildTestProofFaultModuleRegistrationSource,
  describeTestProofModuleFaultAttempt } from "../../workspace-agent-test-proof-module-fault-contract.mjs";
import {
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES,
  candidateResult,
  fail,
  falsifierResult,
  launcherResolvedWorktree,
  mintProviderExecution,
  providerEvidence,
  runDeclaredTest,
  traversalResult
} from "./execution.mjs";

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
  const provider = providerEvidence(resolved, resolved.capability);
  if (resolved.capability === "candidate_execution") {
    const reporterUrl = launcherReporterUrl(launcherWorktree);
    const run = await runDeclaredTest(input, mintProviderExecution(resolved, [
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
    const run = await runDeclaredTest(input, mintProviderExecution(resolved, [
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
  const run = await runDeclaredTest(input, mintProviderExecution(resolved, [
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

  prepare: async () => null,
  execute
});
