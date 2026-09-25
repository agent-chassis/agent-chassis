import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildTestProofRuntimeEvidence,
  projectBoundaryTraversal,
  projectFalsifierExecution,
  projectTestProofInventory
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-evidence.mjs";
import {
  authenticateUnsupportedTestProofTraversal,
  resolveTestProofProviders
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-provider-registry.mjs";
import {
  TEST_PROOF_MODULE_FAULT_OBSERVATION_CODES,
  launcherArtifact,
  observeLauncherNodeTestRun
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-observation.mjs";
import {
  TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE,
  TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION,
  TEST_PROOF_MODULE_FAULT_WITNESS_NAMES,
  buildTestProofFaultModuleSource,
  buildTestProofFaultModuleUrl,
  describeTestProofModuleFaultAttempt,
  testProofFaultMutationAttestationCode,
  validateTestProofModuleFaultConfiguration,
  verifyTestProofModuleFaultExpectation
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-module-fault-contract.mjs";
import launcherTestProofReporter, { stableRuntimeTestIdFromParts } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-reporter.mjs";
import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  resolveTestProofProviderCompatibility
} from "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";
import { validateTestProofRuntimeEvidenceV2 } from "../../packages/controlled-contract/current.mjs";
import { currentProviderBinding } from "../helpers/verify-proof-runtime-fixture.mjs";

const CODES = TEST_PROOF_MODULE_FAULT_OBSERVATION_CODES;
const workingDirectory = process.cwd();
const TARGET = "falsifier-target.test.mjs";
const SELECTED = "falsifier target";
const selectedTestId = stableRuntimeTestIdFromParts({ file: TARGET, name: SELECTED, nesting: 0 });
const DEPENDENCY_PATH = "provider-dependency.mjs";
const RUNNER_PATH = "runner.mjs";
const OPERATIONS_PATH = "operations.mjs";
const VERIFICATION_ID = "claim-verify-node-mutation";

function moduleFaultConfiguration(strategy, overrides = {}) {
  const forced = strategy === "forced_invocation";
  return {
    schema_version: TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION, strategy, mechanism: "module_substitution",
    mutation_id: forced ? "mutation-forced-operation" : "mutation-provider-dependency",
    module_path: forced ? RUNNER_PATH : DEPENDENCY_PATH,
    failure_reason_code: `test_proof_fault.${strategy}.v1`, attempt_nonce: "a".repeat(64),
    ...(forced ? { entry_export: "run",
      operation: { module_path: OPERATIONS_PATH, export_name: "forbidden" },
      invocation: "first_original_return_no_arguments" } : {}),
    ...overrides
  };
}

function attemptExpectation(configuration) {
  const attempt = describeTestProofModuleFaultAttempt(configuration, workingDirectory);
  return { attempt, expectation: { capability: "falsifier_execution",
    falsifier_id: `falsifier-${configuration.strategy.replaceAll("_", "-")}`,
    strategy: configuration.strategy, configuration: structuredClone(attempt.configuration),
    mutation_attestation_code: attempt.mutation_attestation_code,
    fault_module_identity: attempt.fault_module_identity,
    target: TARGET, target_test_id: selectedTestId } };
}

function failureError(reasonCodes) {
  if (reasonCodes.length === 0) return {};
  return { code: reasonCodes[0], errors: reasonCodes.slice(1).map((code) => ({ code })) };
}

async function reporterStdout(events) {
  async function* source() {
    yield* events;
  }
  let stdout = "";
  for await (const chunk of launcherTestProofReporter(source())) stdout += chunk;
  return stdout;
}

function selectedOutcome(passed, { codes = ["ERR_ASSERTION"], name = SELECTED, nesting = 0 } = {}) {
  return { type: passed ? "test:pass" : "test:fail", data: { file: path.join(workingDirectory, TARGET),
    name, nesting, details: { type: "test", ...(passed ? {} : { error: failureError(codes) }) } } };
}

function coverage(rows) {
  return { type: "test:coverage", data: { summary: { workingDirectory, files: rows.map(
    ([modulePath, functions]) => ({ path: path.join(workingDirectory, modulePath),
      coveredLineCount: 1, functions })) } } };
}

function witnessFunctions(attempt, counts = {}, identity = attempt.witness_identity) {
  return Object.keys(attempt.witness_names).map((base) =>
    ({ name: `${base}_${identity}`, count: counts[base] ?? 0 }));
}

function dependencyCoverage(attempt, invocations, identity = attempt.witness_identity) {
  return coverage([[DEPENDENCY_PATH, [{ name: "value", count: 0 }]],
    [DEPENDENCY_PATH, witnessFunctions(attempt,
      { launcherObservedDependencyInvocation: invocations }, identity)]]);
}

const REACHED_FORCED = Object.freeze({ launcherObservedOriginalEntry: 1,
  launcherObservedOrderedOperationEntry: 1 });

function forcedCoverage(attempt, counts = REACHED_FORCED, { entry = 1, operation = 1,
  operationName = "forbidden", identity = attempt.witness_identity } = {}) {
  return coverage([[RUNNER_PATH, [{ name: "run", count: entry }]],
    [RUNNER_PATH, witnessFunctions(attempt, counts, identity)],
    [OPERATIONS_PATH, [{ name: operationName, count: operation }]]]);
}

const reachedCoverage = (strategy, attempt, identity = attempt.witness_identity) =>
  strategy === "forced_invocation" ? forcedCoverage(attempt, REACHED_FORCED, { identity })
    : dependencyCoverage(attempt, 1, identity);

async function observeRun(expectation, events, { stdoutTransform = (stdout) => stdout } = {}) {
  const tests = events.filter(({ type }) => type === "test:pass" || type === "test:fail");
  const failed = tests.filter(({ type }) => type === "test:fail").length;
  const stdout = stdoutTransform(await reporterStdout([...events, { type: "test:summary",
    data: { counts: { passed: tests.length - failed, failed, skipped: 0, cancelled: 0, todo: 0,
      tests: tests.length } } }]));
  return observeLauncherNodeTestRun({ stdout, exitCode: failed > 0 ? 1 : 0, expectation });
}

const candidateObservation = () => observeRun({ capability: "candidate_execution", target: TARGET,
  target_test_id: selectedTestId }, [selectedOutcome(true)]);

function providerRow(providerId, capability) {
  const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: id }) => id === providerId);
  return { provider_id: providerId, provider_version: descriptor.provider_version, capability,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    observation_mechanism: descriptor.observation_mechanisms[0],
    evidence_artifact_types: [...descriptor.evidence_artifact_types] };
}

function falsifierRow(configuration, observation, candidate) {
  return projectFalsifierExecution({
    falsifierId: `falsifier-${configuration.strategy.replaceAll("_", "-")}`,
    attemptId: `attempt-${"f".repeat(64)}`, targetVerificationId: VERIFICATION_ID,
    expectedFailureReasonCode: configuration.failure_reason_code, isolated: true,
    candidateStatus: candidate.selected_status, falsifiedStatus: observation.status,
    observedFailureReasonCode: observation.failure_reason_code,
    mutation: { mutation_id: configuration.mutation_id, strategy: configuration.strategy,
      mechanism: configuration.mechanism, target_kind: "module", module_path: configuration.module_path },
    mutationObserved: observation.mutation_observed,
    artifactIds: observation.artifacts.map(({ artifact_id: id }) => id),
    provider: providerRow("launcher.node-test-module-fault", "falsifier_execution")
  });
}

function buildEvidence(candidate, falsifiers) {
  const artifacts = [...new Map([...candidate.artifacts,
    ...falsifiers.flatMap(({ observation }) => observation.artifacts)]
    .map((artifact) => [artifact.artifact_id, structuredClone({ ...artifact })])).values()];
  return buildTestProofRuntimeEvidence({
    evidenceIdentity: { run_id: "run-node-mutation", wk_id: "WK-2619", selected_unit: "WK-2619#SLICE-003",
      controlled_contract_generation: `sha256:${"1".repeat(64)}`, verification_id: VERIFICATION_ID,
      source_snapshot_digest: `sha256:${"2".repeat(64)}`, command_id: "command-node-test",
      command_target: TARGET, test_id: selectedTestId, attempt: 1 },
    contractBinding: { contract_digest: `sha256:${"3".repeat(64)}`,
      contract_schema_version: "controlled-acceptance-contract.v1",
      verification_claim_id: VERIFICATION_ID, test_proof_id: "test-proof-node-mutation" },
    executionResult: { status: candidate.status, exit_code: 0, attempt_id: `attempt-${"a".repeat(64)}`,
      structured_result: candidate.structured_result,
      evidence_artifact_ids: candidate.artifacts.map(({ artifact_id: id }) => id),
      provider: providerRow("launcher.node-test", "candidate_execution") },
    testInventory: projectTestProofInventory({ selectedTestId,
      observedTestIds: candidate.test_inventory.observed_test_ids,
      executedTestIds: candidate.test_inventory.executed_test_ids,
      skippedTestIds: candidate.test_inventory.skipped_test_ids }),
    boundaryTraversals: [projectBoundaryTraversal({ boundaryId: "sut-boundary-node-mutation",
      observableId: "observable-node-mutation", providerSupport: "unsupported",
      providerAttestation: authenticateUnsupportedTestProofTraversal({ mode: "registry_unsupported",
        registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
        registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION }) })],
    falsifierExecutions: falsifiers.map(({ configuration, observation }) =>
      falsifierRow(configuration, observation, candidate)),
    artifacts
  });
}

const diagnosticCodes = (validation) => validation.diagnostics.diagnostics.map(({ code }) => code);

test("Node mutation evidence preserves authenticated artifact relationships", async () => {
  const candidate = await candidateObservation();
  assert.equal(candidate.valid, true, JSON.stringify(candidate));
  const dependency = attemptExpectation(moduleFaultConfiguration("dependency_failure"));
  const forced = attemptExpectation(moduleFaultConfiguration("forced_invocation"));
  const dependencyObservation = await observeRun(dependency.expectation,
    [dependencyCoverage(dependency.attempt, 1), selectedOutcome(true)]);
  const forcedObservation = await observeRun(forced.expectation,
    [forcedCoverage(forced.attempt), selectedOutcome(true)]);
  for (const [{ attempt, expectation }, observation] of [[dependency, dependencyObservation],
    [forced, forcedObservation]]) {
    assert.equal(observation.valid, true, JSON.stringify(observation));
    assert.deepEqual(observation.artifacts.map(({ kind }) => kind),
      ["structured_test_result", "falsifier_result"]);
    for (const artifact of observation.artifacts) {
      assert.equal(artifact.owner, "launcher");
      assert.deepEqual(artifact, launcherArtifact(artifact.kind, artifact.payload));
    }
    const [structured, trace] = observation.artifacts;
    assert.deepEqual(structured.payload, observation.structured_result);
    assert.deepEqual(trace.payload, observation.mutation);
    assert.equal(trace.payload.structured_event_digest, structured.digest);
    assert.equal(trace.payload.target_test_id, selectedTestId);
    assert.equal(trace.payload.attempt_nonce, attempt.configuration.attempt_nonce);
    assert.equal(trace.payload.witness_identity, attempt.witness_identity);
    assert.equal(trace.payload.fault_module_identity, expectation.fault_module_identity);
    assert.equal(trace.payload.observer_module_path, attempt.witness_module_path);
    assert.equal(observation.status, "passed");
    assert.equal(observation.mutation_observed, true);
    assert.equal(trace.payload.observation.observed, true);
    assert.equal(trace.payload.observation.reached_assertion, false);
  }

  assert.deepEqual(Object.keys(forcedObservation.mutation).sort(), ["attempt_nonce", "entry_export",
    "fault_module_identity", "invocation", "mechanism", "mutation_id", "observation",
    "observer_module_path", "operation", "strategy", "structured_event_digest", "target_module_path",
    "target_test_id", "witness_identity"]);

  const attempt = buildEvidence(candidate, [
    { configuration: dependency.attempt.configuration, observation: dependencyObservation },
    { configuration: forced.attempt.configuration, observation: forcedObservation }]);
  const { evidence } = attempt;
  assert.equal(validateTestProofRuntimeEvidenceV2(evidence).valid, true);
  assert.deepEqual(evidence.falsifier_executions.map(({ status, mutation }) => [status, mutation.observed]),
    [["not_detected", true], ["not_detected", true]]);
  const artifactIds = new Set(evidence.artifacts.map(({ artifact_id: id }) => id));
  for (const row of evidence.falsifier_executions) {
    assert.equal(row.evidence_artifact_ids.length, 2);
    assert.ok(row.evidence_artifact_ids.every((id) => artifactIds.has(id)));
    assert.equal(row.provider.provider_version, "2.0.0");
    assert.equal(row.provider.capability_snapshot_digest, TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST);
  }

  assert.equal(dependencyObservation.artifacts[0].artifact_id, candidate.artifacts[0].artifact_id);
  assert.deepEqual(evidence.execution_result.evidence_artifact_ids, [candidate.artifacts[0].artifact_id]);

  assert.equal(evidence.authority, "advisory_execution_facts");
  assert.equal(attempt.advisory, true);
  assert.equal(attempt.semantic_judgment, "not_performed_coordinator_owned");
  for (const effect of ["admission_effect", "dispatch_effect", "review_effect", "integration_effect",
    "closure_effect", "publication_effect"]) assert.equal(attempt[effect], "none", effect);

  const tampered = structuredClone(evidence);
  tampered.artifacts.find(({ kind, payload }) => kind === "falsifier_result" &&
    payload.strategy === "forced_invocation").payload.observation.observed = false;
  const tamperedValidation = validateTestProofRuntimeEvidenceV2(tampered);
  assert.equal(tamperedValidation.valid, false);
  assert.ok(diagnosticCodes(tamperedValidation).includes("runtime_artifact_identity_digest_mismatch"));
  const dangling = structuredClone(evidence);
  dangling.falsifier_executions[0].evidence_artifact_ids = [`artifact-${"0".repeat(64)}`];
  const danglingValidation = validateTestProofRuntimeEvidenceV2(dangling);
  assert.equal(danglingValidation.valid, false);
  assert.ok(diagnosticCodes(danglingValidation).includes("dangling_runtime_evidence_artifact"));
  assert.throws(() => buildEvidence(candidate, [{ configuration: dependency.attempt.configuration,
    observation: { ...dependencyObservation, artifacts: dependencyObservation.artifacts.map((artifact) =>
      artifact.kind === "falsifier_result"
        ? { ...artifact, payload: { ...artifact.payload, witness_identity: "0".repeat(64) } }
        : artifact) } }]), (error) => error.code === "test_proof_runtime_evidence_invalid");
  const undeclared = structuredClone(evidence);
  const forcedIndex = undeclared.artifacts.findIndex(({ kind, payload }) => kind === "falsifier_result" &&
    payload.strategy === "forced_invocation");
  undeclared.artifacts[forcedIndex] = structuredClone({ ...launcherArtifact("falsifier_result",
    { ...forcedObservation.mutation, dependency_invocation_count: 1 }) });
  assert.equal(validateTestProofRuntimeEvidenceV2(undeclared).schema_valid, false);

  const marked = await observeRun(dependency.expectation, [dependencyCoverage(dependency.attempt, 0),
    selectedOutcome(false, { codes: [dependency.attempt.failure_reason_code] })], {
    stdoutTransform: (stdout) => `${JSON.stringify({ ...JSON.parse(stdout),
      stdout: dependency.attempt.failure_reason_code, launcher_observed_dependency_invocation: 1 })}\n` });
  assert.equal(marked.valid, true, JSON.stringify(marked));
  assert.equal(marked.mutation_observed, false);
  assert.equal(marked.failure_reason_code, null);
  assert.equal(falsifierRow(dependency.attempt.configuration, marked, candidate).status, "not_detected");
});

test("Node mutation identities bind each current launcher attempt", async () => {
  for (const strategy of ["dependency_failure", "forced_invocation"]) {
    const forced = strategy === "forced_invocation";
    const configuration = moduleFaultConfiguration(strategy);
    const { attempt, expectation } = attemptExpectation(configuration);
    assert.equal(attempt.mutation_attestation_code, testProofFaultMutationAttestationCode(configuration));
    assert.deepEqual(Object.keys(attempt.witness_names), [...TEST_PROOF_MODULE_FAULT_WITNESS_NAMES[strategy]]);
    for (const [base, name] of Object.entries(attempt.witness_names)) {
      assert.equal(name, `${base}_${attempt.witness_identity}`);
    }
    assert.equal(new URL(buildTestProofFaultModuleUrl(configuration, workingDirectory))
      .searchParams.get("launcher_module_fault"), attempt.mutation_attestation_code);

    const source = buildTestProofFaultModuleSource(configuration,
      [{ name: forced ? "run" : "value", callable: true }]);
    for (const [base, name] of Object.entries(attempt.witness_names)) {
      assert.ok(source.includes(`function ${name}(`), name);
      assert.equal(source.includes(`function ${base}(`), false, base);
    }
    const events = [reachedCoverage(strategy, attempt), selectedOutcome(false)];

    for (const change of [
      (value) => { delete value.attempt_nonce; },
      (value) => { value.attempt_nonce = "caller"; },
      (value) => { value.attempt_nonce = "A".repeat(64); },
      (value) => { value.attempt_nonce = "a".repeat(63); },
      (value) => { value.source = "caller source"; },
      (value) => { value.command = "node caller.mjs"; },
      (value) => { value.env = { NODE_OPTIONS: "--import=caller.mjs" }; }
    ]) {
      const changed = structuredClone(configuration);
      change(changed);
      assert.throws(() => validateTestProofModuleFaultConfiguration(changed), /unsupported/u);
      assert.throws(() => describeTestProofModuleFaultAttempt(changed, workingDirectory), /unsupported/u);
      const forged = structuredClone(expectation);
      forged.configuration = changed;
      assert.throws(() => verifyTestProofModuleFaultExpectation(forged), /unsupported/u);
      const observed = await observeRun(forged, events);
      assert.deepEqual([observed.valid, observed.code], [false, CODES.EXPECTATION_INVALID]);
    }

    for (const change of [
      (value) => { value.attempt_nonce = "b".repeat(64); },
      (value) => { value.mutation_id = "mutation-another-selection"; },
      (value) => { value.module_path = "another-owner.mjs"; },
      ...(forced ? [
        (value) => { value.entry_export = "anotherEntry"; },
        (value) => { value.operation.module_path = "another-operations.mjs"; },
        (value) => { value.operation.export_name = "anotherOperation"; }
      ] : [])
    ]) {
      const changed = structuredClone(configuration);
      change(changed);
      const other = describeTestProofModuleFaultAttempt(changed, workingDirectory);
      assert.notEqual(other.mutation_attestation_code, attempt.mutation_attestation_code);
      assert.notEqual(other.witness_identity, attempt.witness_identity);

      const mismatched = structuredClone(expectation);
      mismatched.configuration = changed;
      assert.throws(() => verifyTestProofModuleFaultExpectation(mismatched), /does not match/u);
      const observed = await observeRun(mismatched, events);
      assert.deepEqual([observed.valid, observed.code], [false, CODES.EXPECTATION_INVALID]);
    }
    for (const change of [
      (value) => { value.strategy = forced ? "dependency_failure" : "forced_invocation"; },
      (value) => { value.mutation_attestation_code = `test_proof_fault_mutation.${"0".repeat(64)}`; },
      (value) => { value.fault_module_identity = "caller-selected-module"; },
      (value) => { delete value.configuration; }
    ]) {
      const drifted = structuredClone(expectation);
      change(drifted);
      assert.throws(() => verifyTestProofModuleFaultExpectation(drifted));
      assert.equal((await observeRun(drifted, events)).code, CODES.EXPECTATION_INVALID);
    }

    assert.notEqual(testProofFaultMutationAttestationCode(moduleFaultConfiguration(forced
      ? "dependency_failure" : "forced_invocation", { mutation_id: configuration.mutation_id })),
    attempt.mutation_attestation_code);

    const foreign = describeTestProofModuleFaultAttempt({ ...configuration, attempt_nonce: "c".repeat(64) },
      workingDirectory);
    const replayed = await observeRun(expectation, [reachedCoverage(strategy, attempt,
      foreign.witness_identity), selectedOutcome(false)]);
    assert.deepEqual([replayed.valid, replayed.code], [false, CODES.WITNESS_IDENTITY_MISMATCH]);
    const mixed = await observeRun(expectation, [reachedCoverage(strategy, attempt),
      reachedCoverage(strategy, attempt, foreign.witness_identity), selectedOutcome(false)]);
    assert.equal(mixed.code, CODES.WITNESS_IDENTITY_MISMATCH);

    const first = await observeRun(expectation, events);
    const second = await observeRun(expectation, events);
    assert.equal(first.valid, true, JSON.stringify(first));
    assert.equal(first.mutation_observed, true);
    assert.deepEqual(second, first);
  }
});

test("Only the evidence projection decides mutation detection", async () => {
  const candidate = await candidateObservation();
  const { attempt, expectation } = attemptExpectation(moduleFaultConfiguration("dependency_failure"));
  const reachedPass = await observeRun(expectation, [dependencyCoverage(attempt, 1), selectedOutcome(true)]);
  const reachedFail = await observeRun(expectation, [dependencyCoverage(attempt, 1), selectedOutcome(false)]);
  const unreachedFail = await observeRun(expectation, [dependencyCoverage(attempt, 0),
    selectedOutcome(false, { codes: [attempt.failure_reason_code] })]);

  assert.deepEqual([reachedPass.valid, reachedPass.status, reachedPass.mutation_observed,
    reachedPass.failure_reason_code], [true, "passed", true, attempt.failure_reason_code]);
  assert.deepEqual([reachedFail.status, reachedFail.mutation_observed], ["failed", true]);
  assert.deepEqual([unreachedFail.status, unreachedFail.mutation_observed,
    unreachedFail.failure_reason_code], ["failed", false, null]);
  for (const observation of [reachedPass, reachedFail, unreachedFail]) {
    assert.equal(Object.hasOwn(observation, "detected"), false);
    assert.equal(Object.hasOwn(observation.mutation, "status"), false);
  }
  const project = (observation, overrides = {}) => projectFalsifierExecution({
    falsifierId: "falsifier-dependency-failure", attemptId: `attempt-${"f".repeat(64)}`,
    targetVerificationId: VERIFICATION_ID, expectedFailureReasonCode: attempt.failure_reason_code,
    isolated: true, candidateStatus: candidate.selected_status, falsifiedStatus: observation.status,
    observedFailureReasonCode: observation.failure_reason_code,
    mutation: { mutation_id: attempt.configuration.mutation_id, strategy: attempt.strategy,
      mechanism: "module_substitution", target_kind: "module", module_path: DEPENDENCY_PATH },
    mutationObserved: observation.mutation_observed,
    artifactIds: observation.artifacts.map(({ artifact_id: id }) => id),
    provider: providerRow("launcher.node-test-module-fault", "falsifier_execution"),
    ...overrides
  });
  assert.equal(project(reachedFail).status, "detected");
  assert.equal(project(reachedFail).mutation.observed, true);
  assert.equal(project(reachedPass).status, "not_detected", "reached mutation with selected pass");
  assert.equal(project(reachedPass).mutation.observed, true);
  assert.equal(project(unreachedFail).status, "not_detected", "selected failure alone");
  assert.equal(project(reachedFail, { mutationObserved: false }).status, "not_detected");
  assert.equal(project(reachedFail, { candidateStatus: "failed" }).status, "not_detected");
  assert.equal(project(reachedFail, { observedFailureReasonCode: "test_proof_fault.forced_invocation.v1" })
    .status, "not_detected");
  assert.equal(project(reachedFail, { expectedFailureReasonCode: "", observedFailureReasonCode: "" })
    .status, "not_detected");
  assert.equal(project(reachedFail, { isolated: false }).status, "not_detected");
  assert.equal(project(reachedFail, { falsifiedStatus: "skipped" }).status, "execution_error");
  assert.equal(project(reachedFail, { candidateStatus: "skipped" }).status, "execution_error");
});

function nodeBinding() {
  return {
    test_proof_id: "test-proof-provider-resolution",
    verification_claim_id: "claim-provider-resolution",
    system_under_test_boundary: { boundary_id: "sut-boundary-provider-resolution",
      kind: "module", runtime_module_path: DEPENDENCY_PATH, subject_reference_ids: ["ref-provider-subject"] },
    observable_result: { observable_id: "observable-provider-resolution",
      kind: "return_value", proposition_id: "prop-provider-result" },
    candidate_execution_provider: currentProviderBinding("launcher.node-test", "candidate_execution"),
    falsifiers: [{ falsifier_id: "falsifier-a", strategy: "dependency_failure",
      proposition_id: "prop-provider-failure", expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-a", mechanism: "module_substitution",
        target_kind: "module", module_path: DEPENDENCY_PATH },
      execution_provider: currentProviderBinding("launcher.node-test-module-fault", "falsifier_execution") }],
    traversal_provider: { mode: "provider",
      ...currentProviderBinding("launcher.node-test-v8-coverage", "boundary_traversal"),
      boundary_kind: "module", observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", evidence_artifact_type: "boundary_trace" },
    test_selector: { name: "provider resolution uses the closed registry", nesting: 0 },
    prohibited_shortcuts: ["source_text_inspection"]
  };
}

test("Node mutation provider versions prevent evidence reinterpretation", async () => {
  assert.equal(TEST_PROOF_PROVIDER_REGISTRY_VERSION, "1.3.0");
  assert.deepEqual(TEST_PROOF_PROVIDER_CATALOG.providers.filter(({ provider_id: id }) =>
    id === "launcher.node-test-module-fault").map(({ provider_version: version }) => version), ["2.0.0"]);
  const current = { provider_id: "launcher.node-test-module-fault", provider_version: "2.0.0",
    capability: "falsifier_execution" };
  for (const strategy of ["dependency_failure", "forced_invocation"]) {
    assert.equal(resolveTestProofProviderCompatibility({ provider: current,
      capability: "falsifier_execution", strategy }).valid, true, strategy);
  }
  const provider1 = resolveTestProofProviderCompatibility({
    provider: { ...current, provider_version: "1.0.0" }, capability: "falsifier_execution" });
  assert.deepEqual([provider1.valid, provider1.code, provider1.diagnostic.expected_identity,
    provider1.diagnostic.actual_identity],
  [false, "stable_test_proof_provider_version_mismatch", "2.0.0", "1.0.0"]);
  assert.equal(resolveTestProofProviderCompatibility({ provider: { ...current,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST },
  capability: "falsifier_execution", require_snapshot: true }).valid, true);
  assert.equal(resolveTestProofProviderCompatibility({ provider: { ...current,
    capability_snapshot_digest: `sha256:${"0".repeat(64)}` },
  capability: "falsifier_execution", require_snapshot: true }).code,
  "stable_test_proof_provider_snapshot_mismatch");
  const unsupported = (registryVersion) => resolveTestProofProviderCompatibility({ provider: {
    registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID, registry_version: registryVersion,
    capability: "traversal_unsupported",
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST
  }, capability: "traversal_unsupported" });
  assert.equal(unsupported("1.1.0").code, "stable_test_proof_provider_version_mismatch");
  assert.equal(unsupported("1.2.0").code, "stable_test_proof_provider_version_mismatch");
  assert.equal(unsupported("1.3.0").valid, true);

  assert.deepEqual(TEST_PROOF_PROVIDER_CATALOG.providers.filter(({ provider_id: id, selector_kind: kind }) =>
    id !== "launcher.node-test-module-fault" && ["node_test_name", "pytest_node_id"].includes(kind)).map(({ provider_id: id, provider_version: version,
    capabilities, falsifier_strategies: strategies }) => [id, version, [...capabilities], [...strategies]]), [
    ["launcher.node-test", "1.0.0", ["candidate_execution"], []],
    ["launcher.node-test-v8-coverage", "1.0.0", ["boundary_traversal"], []],
    ["launcher.pytest", "1.0.0", ["candidate_execution"], []],
    ["launcher.pytest-scalar-return", "1.0.0", ["falsifier_execution"], ["result_inversion"]],
    ["launcher.pytest-call-trace", "1.0.0", ["boundary_traversal"], []]
  ]);

  const binding = nodeBinding();
  assert.equal(resolveTestProofProviders(binding).falsifiers[0].provider.provider_version, "2.0.0");
  const pinned = structuredClone(binding);
  pinned.falsifiers[0].execution_provider.provider_version = "1.0.0";
  assert.throws(() => resolveTestProofProviders(pinned),
    (error) => error.code === "stable_test_proof_provider_version_mismatch");

  const candidate = await candidateObservation();
  const dependency = attemptExpectation(moduleFaultConfiguration("dependency_failure"));
  const observation = await observeRun(dependency.expectation,
    [dependencyCoverage(dependency.attempt, 1), selectedOutcome(false)]);
  const { evidence } = buildEvidence(candidate,
    [{ configuration: dependency.attempt.configuration, observation }]);
  assert.equal(validateTestProofRuntimeEvidenceV2(evidence).valid, true);
  assert.equal(evidence.falsifier_executions[0].status, "detected");
  for (const [field, value, code] of [
    ["provider_version", "1.0.0", "stable_test_proof_provider_version_mismatch"],
    ["capability_snapshot_digest", `sha256:${"0".repeat(64)}`, "stable_test_proof_provider_snapshot_mismatch"]
  ]) {
    const reinterpreted = structuredClone(evidence);
    reinterpreted.falsifier_executions[0].provider[field] = value;
    const validation = validateTestProofRuntimeEvidenceV2(reinterpreted);
    assert.equal(validation.valid, false, field);
    assert.ok(diagnosticCodes(validation).includes(code), field);
  }

});

test("dependency observation credits the attempt invocation witness without consumer error codes",
  async () => {
    const { attempt, expectation } = attemptExpectation(moduleFaultConfiguration("dependency_failure"));
    for (const codes of [[attempt.failure_reason_code, "ERR_TEST_FAILURE"], ["ERR_ASSERTION"], []]) {
      const observation = await observeRun(expectation,
        [dependencyCoverage(attempt, 2), selectedOutcome(false, { codes })]);
      assert.equal(observation.valid, true, JSON.stringify(observation));
      assert.equal(observation.status, "failed");
      assert.equal(observation.mutation_observed, true, JSON.stringify(codes));
      assert.equal(observation.failure_reason_code, attempt.failure_reason_code);
      assert.deepEqual(observation.mutation.observation, { dependency_invocation_count: 2,
        reached_assertion: true, selected_test_only: true, observed: true });
      for (const retired of ["loader_module_path", "loader_function_name", "attributed_failure_test_ids",
        "structured_failure_error_codes", "target_failure_observed", "failure_reason_code"]) {
        assert.equal(Object.hasOwn(observation.mutation, retired), false, retired);
      }
    }
  });

test("a declared dependency reason without the invocation witness is not reached", async () => {
  const { attempt, expectation } = attemptExpectation(moduleFaultConfiguration("dependency_failure"));
  const unreached = await observeRun(expectation, [dependencyCoverage(attempt, 0),
    selectedOutcome(false, { codes: [attempt.failure_reason_code, "test_proof_fault.different_failure.v1"] })]);
  assert.equal(unreached.valid, true, JSON.stringify(unreached));
  assert.equal(unreached.mutation_observed, false);
  assert.equal(unreached.failure_reason_code, null);
  assert.equal(unreached.mutation.observation.dependency_invocation_count, 0);

  for (const [label, events] of [
    ["never loaded", [selectedOutcome(false, { codes: [attempt.failure_reason_code] })]],
    ["probe only", [coverage([[DEPENDENCY_PATH, [{ name: "value", count: 1 }]]]),
      selectedOutcome(false)]],
    ["malformed count", [coverage([[DEPENDENCY_PATH, [{ name:
      attempt.witness_names.launcherObservedDependencyInvocation, count: -1 }]]]), selectedOutcome(false)]]
  ]) {
    const observation = await observeRun(expectation, events);
    assert.deepEqual([observation.valid, observation.code], [false, CODES.INSTRUMENTATION_UNAVAILABLE], label);
  }
});

test("stdout-only exact failure reason is never observation", async () => {
  const { attempt, expectation } = attemptExpectation(moduleFaultConfiguration("dependency_failure"));
  const observation = await observeRun(expectation, [dependencyCoverage(attempt, 0), selectedOutcome(false, {
    codes: [] })], { stdoutTransform: (stdout) =>
    `${JSON.stringify({ ...JSON.parse(stdout), stdout: attempt.failure_reason_code })}\n` });
  assert.equal(observation.valid, true);
  assert.equal(observation.mutation_observed, false);
  assert.equal(observation.failure_reason_code, null);
});

test("an unrelated executed test makes dependency selection unattributable", async () => {
  const { attempt, expectation } = attemptExpectation(moduleFaultConfiguration("dependency_failure"));
  const siblingId = stableRuntimeTestIdFromParts({ file: TARGET, name: "unrelated failure", nesting: 0 });
  for (const passed of [false, true]) {
    const observation = await observeRun(expectation, [dependencyCoverage(attempt, 1),
      selectedOutcome(passed, { name: "unrelated failure", codes: [attempt.failure_reason_code] }),
      selectedOutcome(false, { codes: ["ERR_ASSERTION"] })]);
    assert.deepEqual(observation, { valid: false, code: CODES.SELECTION_UNATTRIBUTABLE,
      detail: { expected_test_id: selectedTestId, unattributed_test_ids: [siblingId] } });
  }
});

test("dependency selection follows the runtime-reported ancestry of the selected test", async () => {
  const { attempt, expectation } = attemptExpectation(moduleFaultConfiguration("dependency_failure"));
  const file = path.join(workingDirectory, TARGET);
  const nestedId = stableRuntimeTestIdFromParts({ file: TARGET, name: "nested dependency use", nesting: 1 });
  const enqueue = (name, nesting, testId, parentId, type = "test") =>
    ({ type: "test:enqueue", data: { file, name, nesting, testId, parentId, type } });
  const outcome = (type, name, nesting, testId, parentId, reasonCodes = null) => ({ type,
    data: { file, name, nesting, testId, parentId, details: { type: "test",
      ...(reasonCodes === null ? {} : { error: failureError(reasonCodes) }) } } });
  const witness = dependencyCoverage(attempt, 1);
  const selected = enqueue(SELECTED, 0, 1, 0);
  const nested = enqueue("nested dependency use", 1, 2, 1);
  const selectedFails = outcome("test:fail", SELECTED, 0, 1, 0, ["ERR_TEST_FAILURE"]);
  const observe = async (events, target = expectation) => {
    const tests = events.filter(({ type }) => type === "test:pass" || type === "test:fail");
    const stdout = await reporterStdout([...events, { type: "test:summary", data: { counts: {
      passed: tests.filter(({ type }) => type === "test:pass").length,
      failed: tests.filter(({ type }) => type === "test:fail").length,
      skipped: 0, cancelled: 0, todo: 0, tests: tests.length } } }]);
    return { envelope: JSON.parse(stdout),
      observation: observeLauncherNodeTestRun({ stdout, exitCode: 1, expectation: target }) };
  };

  const credited = await observe([witness, selected, nested,
    outcome("test:fail", "nested dependency use", 1, 2, 1, ["ERR_ASSERTION"]), selectedFails]);
  assert.deepEqual(credited.envelope.events.filter(({ type }) => type === "test:fail")
    .map(({ test_id: testId, ancestor_test_ids: ancestors }) => [testId, ancestors]),
  [[nestedId, [selectedTestId]], [selectedTestId, []]]);
  assert.equal(credited.observation.valid, true, JSON.stringify(credited.observation));
  assert.equal(credited.observation.mutation_observed, true);
  assert.equal(credited.observation.failure_reason_code, attempt.failure_reason_code);
  for (const event of credited.observation.structured_result.fail_events) {
    assert.equal(Object.hasOwn(event, "ancestor_test_ids"), false, "evidence keeps closed structured events");
  }

  const staticSelectedId = stableRuntimeTestIdFromParts({ file: TARGET, name: SELECTED, nesting: 1 });
  const staticSuite = await observe([witness, enqueue("container", 0, 1, 0, "suite"),
    enqueue(SELECTED, 1, 2, 1), outcome("test:fail", SELECTED, 1, 2, 1, ["ERR_ASSERTION"])],
  { ...expectation, target_test_id: staticSelectedId });
  assert.equal(staticSuite.observation.valid, true, JSON.stringify(staticSuite.observation));
  assert.equal(staticSuite.observation.mutation_observed, true);

  const passing = await observe([witness, selected, nested,
    outcome("test:pass", "nested dependency use", 1, 2, 1), outcome("test:pass", SELECTED, 0, 1, 0)]);
  assert.deepEqual([passing.observation.valid, passing.observation.status,
    passing.observation.mutation_observed], [true, "passed", true]);

  const dynamicParentSelectedId = stableRuntimeTestIdFromParts({ file: TARGET, name: SELECTED, nesting: 1 });
  for (const [label, events, target] of [
    ["a root sibling", [witness, selected, enqueue("unrelated sibling", 0, 2, 0),
      outcome("test:fail", "unrelated sibling", 0, 2, 0, ["ERR_ASSERTION"]), selectedFails], expectation],
    ["conflicting runtime identifiers", [witness, selected, enqueue("reused runtime identifier", 0, 1, 0),
      nested, outcome("test:fail", "nested dependency use", 1, 2, 1, ["ERR_ASSERTION"]), selectedFails],
    expectation],
    ["a dynamic ancestor test", [witness, enqueue("dynamic parent", 0, 1, 0), enqueue(SELECTED, 1, 2, 1),
      outcome("test:fail", SELECTED, 1, 2, 1, ["ERR_ASSERTION"]),
      outcome("test:fail", "dynamic parent", 0, 1, 0, ["ERR_TEST_FAILURE"])],
    { ...expectation, target_test_id: dynamicParentSelectedId }]
  ]) {
    const { observation } = await observe(events, target);
    assert.equal(observation.valid, false, label);
    assert.equal(observation.code, CODES.SELECTION_UNATTRIBUTABLE, label);
  }
});

test("forced selection is closed and every execution selection changes authenticated identity", () => {
  const configuration = moduleFaultConfiguration("forced_invocation");
  const population = [{ name: "run", callable: true }];
  assert.doesNotThrow(() => buildTestProofFaultModuleSource(configuration, population));
  const original = testProofFaultMutationAttestationCode(configuration);
  for (const change of [
    (value) => { value.entry_export = "anotherEntry"; },
    (value) => { value.operation.export_name = "anotherOperation"; },
    (value) => { value.operation.module_path = "another-owner.mjs"; },
    (value) => { value.attempt_nonce = "b".repeat(64); },
    (value) => { value.mutation_id = "mutation-another"; }
  ]) {
    const value = structuredClone(configuration);
    change(value);
    assert.notEqual(testProofFaultMutationAttestationCode(value), original);
  }
  for (const change of [
    (value) => { delete value.operation; },
    (value) => { delete value.entry_export; },
    (value) => { value.invocation = "pre_entry"; },
    (value) => { value.operation.arguments = []; },
    (value) => { value.operation.export_name = "arbitrary()"; },
    (value) => { value.source = "caller source"; },
    (value) => { value.command = "caller command"; },
    (value) => { value.attempt_nonce = "caller"; },
    (value) => { delete value.attempt_nonce; }
  ]) {
    const value = structuredClone(configuration);
    change(value);
    assert.throws(() => buildTestProofFaultModuleSource(value, population));
  }
});

test("forced observation reports reached-valid facts only with private witnesses and the exact attempt selection",
  async () => {
    const { attempt, expectation } = attemptExpectation(moduleFaultConfiguration("forced_invocation"));
    const observe = ({ counts = REACHED_FORCED, passed = false, codes = ["ERR_ASSERTION"], rows = null,
      spoofedMarker = null, target = expectation, ...options } = {}) => observeRun(target, [
      rows ?? forcedCoverage(attempt, counts, options),
      { type: "test:stdout", data: { message: spoofedMarker } },
      selectedOutcome(passed, { codes })]);
    const reached = { original_entry_count: 1, operation_entry_count: 1, inspector_original_entry_count: 1,
      inspector_ordered_operation_count: 1, invalid_order_count: 0, inspection_failure_count: 0 };

    for (const codes of [["ERR_ASSERTION"], [], ["ERR_TEST_FAILURE"]]) {
      const observation = await observe({ codes });
      assert.equal(observation.valid, true, JSON.stringify(observation));
      assert.equal(observation.mutation_observed, true, JSON.stringify(codes));
      assert.equal(observation.failure_reason_code, attempt.failure_reason_code);
      assert.deepEqual(observation.mutation.observation, { ...reached, reached_assertion: true,
        selected_test_only: true, observed: true });
    }
    const passing = await observe({ passed: true });
    assert.equal(passing.status, "passed");
    assert.equal(passing.mutation_observed, true, "reached mutation is a fact beside a passing selected test");
    assert.deepEqual(passing.mutation.observation, { ...reached, reached_assertion: false,
      selected_test_only: true, observed: true });
    for (const [label, options] of [
      ["no original entry", { entry: 0 }],
      ["no operation entry", { operation: 0 }],
      ["swapped operation", { operationName: "swapped" }],
      ["no inspector original entry", { counts: { launcherObservedOrderedOperationEntry: 1 } }],
      ["no ordered operation", { counts: { launcherObservedOriginalEntry: 1 } }],
      ["invalid order", { counts: { ...REACHED_FORCED, launcherObservedInvalidOrder: 1 } }],
      ["inspection failure", { counts: { ...REACHED_FORCED, launcherObservedInspectionFailure: 1 } }]
    ]) {
      const observation = await observe(options);
      assert.equal(observation.valid, true, label);
      assert.equal(observation.mutation_observed, false, label);
      assert.equal(observation.failure_reason_code, null, label);
    }
    for (const [label, rows, detail] of [
      ["never loaded", coverage([[RUNNER_PATH, [{ name: "run", count: 0 }]]]), null],
      ["operation module absent", coverage([[RUNNER_PATH, [{ name: "run", count: 1 }]],
        [RUNNER_PATH, witnessFunctions(attempt, REACHED_FORCED)]]),
      { missing_module_paths: [OPERATIONS_PATH] }]
    ]) {
      const observation = await observe({ rows,
        spoofedMarker: JSON.stringify({ original_entry: true, operation_invoked: true }) });
      assert.deepEqual([observation.valid, observation.code], [false, CODES.INSTRUMENTATION_UNAVAILABLE], label);
      if (detail !== null) assert.deepEqual(observation.detail, detail, label);
    }

    const identityFailure = await observe({ counts: { launcherIdentityAbsentExport: 1 } });
    assert.deepEqual(identityFailure, { valid: false, code: TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE.code,
      detail: { reason: "missing", module_path: OPERATIONS_PATH, export_name: "forbidden" } });
    for (const change of [
      (value) => { value.configuration.attempt_nonce = "b".repeat(64); },
      (value) => { value.configuration.operation.export_name = "swapped"; },
      (value) => { delete value.configuration.entry_export; }
    ]) {
      const target = structuredClone(expectation);
      change(target);
      assert.equal((await observe({ target })).code, CODES.EXPECTATION_INVALID);
    }
    assert.equal((await observe({ identity: "b".repeat(64) })).code, CODES.WITNESS_IDENTITY_MISMATCH,
      "cross-attempt private witnesses cannot be replayed");
  });

test("printed markers, echoed reasons, and environment-shaped output are never observations", () => {
  const { expectation } = attemptExpectation(moduleFaultConfiguration("dependency_failure"));
  for (const stdout of [
    "test_proof_fault.dependency_failure.v1\n",
    "TEST_PROOF_TRAVERSAL:sut-boundary-validation-runner:observable-test-result\n",
    JSON.stringify({ AGENT_CHASSIS_TEST_PROOF_FAILURE_REASON:
      "test_proof_fault.dependency_failure.v1" })
  ]) {
    for (const target of [expectation, { capability: "falsifier_execution" }]) {
      assert.equal(observeLauncherNodeTestRun({ stdout, exitCode: 1, expectation: target }).valid, false);
    }
  }
});
