import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  buildTestProofRuntimeEvidence,
  canonicalTestProofEvidenceJson,
  compareTestProofInventories,
  digestTestProofEvidence,
  executeTestProofAttempt,
  projectBoundaryTraversal,
  projectFalsifierExecution,
  stableRuntimeTestId
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-evidence.mjs";
import {
  assertLauncherResolvedTestProofProvider,
  authenticateUnsupportedTestProofTraversal,
  describeTestProofProviderRegistry,
  resolveTestProofProviders
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-provider-registry.mjs";
import { TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST } from
  "../../packages/controlled-contract/current.mjs";
import * as controlledContractCurrent from
  "../../packages/controlled-contract/current.mjs";
import { mintManagedWorkerTestRunAuthority } from
  "../../packages/agent-launch-cli/src/lib/managed-worker-test-run-authority.mjs";
import {
  canonicalTestProofCommandIdentity,
  mintLauncherTestProofAttemptContext,
  mintManagedWorkerTestProofRuntimeAuthority
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import { observeLauncherNodeTestRun } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-observation.mjs";
import {
  buildTestProofFaultModuleSource,
  testProofFaultMutationAttestationCode
} from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-module-fault-contract.mjs";
import launcherTestProofReporter from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-reporter.mjs";
import { extractTestProofRuntimeEvidenceReceipt } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import {
  bindTerminalTestProofVerificationIds,
  TERMINAL_TEST_PROOF_RUNTIME_REFUSAL_CODES
} from
  "../../packages/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs";

const digest = (value) => `sha256:${value.repeat(64)}`;
const digestBytes = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const testA = stableRuntimeTestId("file.test.mjs :: suite :: preserves behavior");
const testB = stableRuntimeTestId("file.test.mjs :: suite :: rejects bypass");
const testC = stableRuntimeTestId("file.test.mjs :: suite :: replacement identity");
const artifactPayload = (character) => ({ fixture: character });
const artifactDigest = (character) => digestTestProofEvidence(artifactPayload(character));
const artifactId = (character) => `artifact-${artifactDigest(character).slice(7)}`;
const attemptId = (character) => `attempt-${character.repeat(64)}`;
const provider = (providerId, capability, observationMechanism, artifactTypes) => ({
  provider_id: providerId, provider_version: "1.0.0", capability,
  capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  observation_mechanism: observationMechanism,
  evidence_artifact_types: artifactTypes
});
const structuredResult = (status = "passed") => ({
  mechanism: "node_test_structured_events", exit_code: status === "passed" ? 0 : 1,
  summary: { passed: status === "passed" ? 1 : 0, failed: status === "passed" ? 0 : 1,
    skipped: 0, cancelled: 0, todo: 0, tests: 1 },
  pass_events: status === "passed" ? [{type: "test:pass", name: "target",
    test_id: testA, file: "provider-target.test.mjs", nesting: 0, status: "passed"}] : [],
  fail_events: status === "passed" ? [] : [{type: "test:fail", name: "target",
    test_id: testA, file: "provider-target.test.mjs", nesting: 0, status: "failed",
    error_codes: ["ERR_TEST_FAILURE"]}]
});

const expectedFalsifierReason = "test_proof_fault.dependency_failure.v1";
const differentFalsifierReason = "test_proof_fault.different_failure.v1";
const falsifierMutationAttestationCode = testProofFaultMutationAttestationCode({
  schema_version: "workspace-agent-test-proof-module-fault.v1",
  strategy: "dependency_failure",
  mechanism: "module_substitution",
  mutation_id: "mutation-provider-dependency",
  module_path: "provider-dependency.mjs",
  failure_reason_code: expectedFalsifierReason
});
const falsifierTargetTestId = stableRuntimeTestId(
  "falsifier-target.test.mjs :: 0 :: falsifier target"
);

test("module-fault replacement preserves observed export names and faults on invocation",
  async () => {
    const configuration = {
      schema_version: "workspace-agent-test-proof-module-fault.v1",
      strategy: "dependency_failure",
      mechanism: "module_substitution",
      mutation_id: "mutation-export-shape",
      module_path: "packages/core/lib/package-docs-carrier.mjs",
      failure_reason_code: "test_proof_fault.dependency_failure.v1"
    };
    const names = ["CORE_PACKAGE_DOCS_MANIFEST_SCHEMA_VERSION",
      "createCorePackageDocsCarrier"];
    const source = buildTestProofFaultModuleSource(configuration, names);
    const namespace = await import(`data:text/javascript;base64,${
      Buffer.from(source).toString("base64")}`);
    assert.deepEqual(Object.keys(namespace), names);
    assert.throws(() => namespace.createCorePackageDocsCarrier(), (error) =>
      error.code === configuration.failure_reason_code &&
      error.cause?.code === testProofFaultMutationAttestationCode(configuration));
  });

function failureError(reasonCodes) {
  if (reasonCodes.length === 0) return {};
  return {
    code: reasonCodes[0],
    errors: reasonCodes.slice(1).map((code) => ({ code }))
  };
}

async function reporterStdout(events) {
  async function* source() {
    yield* events;
  }
  let stdout = "";
  for await (const chunk of launcherTestProofReporter(source())) stdout += chunk;
  return stdout;
}

async function observeFalsifierRun({
  targetReasonCodes,
  unrelatedReasonCodes = null,
  stdoutReasonCode = null
}) {
  const workingDirectory = process.cwd();
  const testFailure = (file, name, reasonCodes) => ({
    type: "test:fail",
    data: {
      file: path.join(workingDirectory, file),
      name,
      nesting: 0,
      details: { type: "test", error: failureError(reasonCodes) }
    }
  });
  const failureEvents = [
    testFailure("falsifier-target.test.mjs", "falsifier target",
      [...targetReasonCodes, falsifierMutationAttestationCode]),
    ...(unrelatedReasonCodes === null ? [] : [
      testFailure("unrelated.test.mjs", "unrelated failure", unrelatedReasonCodes)
    ])
  ];
  let stdout = await reporterStdout([{
    type: "test:coverage",
    data: { summary: { workingDirectory, files: [{
      path: path.join(workingDirectory,
        "packages/agent-launch-cli/src/lib/workspace-agent-test-proof-module-fault-loader.mjs"),
      coveredLineCount: 1,
      functions: [{ name: "substituteFaultModule", count: 1 }]
    }] } }
  }, ...failureEvents, {
    type: "test:summary",
    data: { counts: { passed: 0, failed: failureEvents.length, skipped: 0,
      cancelled: 0, todo: 0, tests: failureEvents.length } }
  }]);
  if (stdoutReasonCode !== null) {
    const envelope = JSON.parse(stdout);
    stdout = `${JSON.stringify({ ...envelope, stdout: stdoutReasonCode })}\n`;
  }
  return observeLauncherNodeTestRun({
    stdout,
    exitCode: 1,
    expectation: {
      capability: "falsifier_execution",
      mutation_id: "mutation-provider-dependency",
      strategy: "dependency_failure",
      module_path: "provider-dependency.mjs",
      fault_module_identity: "runtime-module-fault",
      loader_module_path:
        "packages/agent-launch-cli/src/lib/workspace-agent-test-proof-module-fault-loader.mjs",
      loader_function_name: "substituteFaultModule",
      target_test_id: falsifierTargetTestId,
      mutation_attestation_code: falsifierMutationAttestationCode,
      failure_reason_code: expectedFalsifierReason
    }
  });
}

function inventory(overrides = {}) {
  return compareTestProofInventories({
    baselineId: "coverage-baseline-suite",
    declaredTestIds: [testA, testB],
    baselineExecutedTestIds: [testA, testB],
    observedTestIds: [testA, testB],
    executedTestIds: [testA, testB],
    skippedTestIds: [],
    ...overrides
  });
}

function identity() {
  return {
    run_id: "run-example",
    wk_id: "WK-2064",
    selected_unit: "WK-2064#SLICE-006",
    controlled_contract_generation: digest("a"),
    verification_id: "claim-verify-slice-006",
    source_snapshot_digest: digest("b"),
    command_id: "command-node-test",
    command_target: "tests/unit/test-proof-runtime-evidence.test.mjs",
    test_id: testA,
    attempt: 1
  };
}

function contractBinding() {
  return {
    contract_digest: digest("a"),
    contract_schema_version: "controlled-acceptance-contract.v1",
    verification_claim_id: "claim-verify-slice-006",
    test_proof_id: "test-proof-runtime-evidence"
  };
}

async function controlledSelection(root, binding) {
  const filename = "WK-2064.controlled-acceptance.json";
  const bytes = await readFile(path.join(root, "wiki/contracts", filename));
  const contentDigest = digestBytes(bytes);
  const carriers = [{
    filename,
    content_digest: contentDigest,
    source_member: {
      schema_version: "controlled-contract-authenticated-runtime-member.v1",
      storage_mode: "legacy_root",
      logical_filename: filename,
      repository_relative_path: `wiki/contracts/${filename}`,
      content_digest: contentDigest,
      manifest_generation: null,
      manifest_content_digest: null
    }
  }];
  const generation = {
    schema_version: "controlled-contract-generation.v1",
    wk_id: "WK-2064",
    carriers: carriers.map(({ filename: name, content_digest: digest }) => ({
      filename: name, content_digest: digest
    }))
  };
  return {
    status: "complete", wk_id: "WK-2064", focus: null,
    requested_count: 1, matched_count: 1,
    content_digest: carriers[0].content_digest,
    controlled_contract_generation: digestBytes(
      Buffer.from(`${JSON.stringify(generation, null, 2)}\n`, "utf8")
    ),
    controlled_contract_generation_schema_version: generation.schema_version,
    controlled_contract_generation_carrier_count: carriers.length,
    controlled_contract_generation_carriers: carriers,
    contract_schema_version: "controlled-acceptance-contract.v1",
    bindings: [binding]
  };
}

function traversal(overrides = {}) {
  return projectBoundaryTraversal({
    boundaryId: "sut-boundary-validation-runner",
    observableId: "observable-test-result",
    providerSupport: "supported",
    authenticated: true,
    observed: true,
    boundaryKind: "module", observationMechanism: "node_test_v8_coverage",
    observationSeam: "node_test_structured_assertion",
    artifactIds: [artifactId("c")],
    provider: provider("launcher.node-test-v8-coverage", "boundary_traversal",
      "node_test_v8_coverage", ["boundary_trace", "structured_test_result"]),
    ...overrides
  });
}

function falsifier(overrides = {}) {
  return projectFalsifierExecution({
    falsifierId: "falsifier-test-removed",
    attemptId: attemptId("f"),
    targetVerificationId: "claim-verify-slice-006",
    expectedFailureReasonCode: "test_proof_fault.dependency_failure.v1",
    isolated: true,
    candidateStatus: "passed",
    falsifiedStatus: "failed",
    observedFailureReasonCode: "test_proof_fault.dependency_failure.v1",
    mutation: { mutation_id: "mutation-test-dependency", strategy: "dependency_failure",
      mechanism: "module_substitution", target_kind: "module", module_path: "dependency.mjs" },
    mutationObserved: true,
    artifactIds: [artifactId("d")],
    provider: provider("launcher.node-test-module-fault", "falsifier_execution",
      "node_test_structured_events", ["falsifier_result", "structured_test_result"]),
    ...overrides
  });
}

const artifacts = [{
  artifact_id: artifactId("c"),
  kind: "boundary_trace",
  digest: artifactDigest("c"), owner: "launcher", payload: artifactPayload("c")
}, {
  artifact_id: artifactId("d"),
  kind: "falsifier_result",
  digest: artifactDigest("d"), owner: "launcher", payload: artifactPayload("d")
}, {
  artifact_id: artifactId("e"),
  kind: "structured_test_result",
  digest: artifactDigest("e"), owner: "launcher", payload: artifactPayload("e")
}];

test("records and compares complete declared and observed identity inventories", () => {
  const compared = inventory({ observedTestIds: [testA, testC], executedTestIds: [testA, testC] });
  assert.deepEqual(compared.removed_baseline_test_ids, [testB]);
  assert.deepEqual(compared.unexpected_test_ids, [testC]);
});

test("distinguishes explicit rename identity from removal and flags undispositioned coverage", () => {
  const compared = inventory({
    declaredTestIds: [testA, testC], observedTestIds: [testA, testC], executedTestIds: [testA, testC],
    declaredRenames: [{ baseline_test_id: testB, observed_test_id: testC }]
  });
  assert.deepEqual(compared.removed_baseline_test_ids, []);
  assert.deepEqual(compared.renamed_baseline_tests, [{ baseline_test_id: testB, observed_test_id: testC }]);
  assert.deepEqual(compared.undispositioned_coverage_test_ids, [testB]);
});

test("detects newly skipped identities independently of aggregate counts", () => {
  const compared = inventory({ executedTestIds: [testA], skippedTestIds: [testB] });
  assert.deepEqual(compared.newly_skipped_test_ids, [testB]);
});

test("unsupported traversal cannot be caller-declared", () => {
  assert.throws(() => traversal({ providerSupport: "unsupported" }),
    (error) => error.code === "test_proof_provider_registry.execution_untrusted.v1");
  const attestation = authenticateUnsupportedTestProofTraversal({
    mode: "registry_unsupported", registry_id: "launcher.test-proof-provider-registry",
    registry_version: "1.0.0"
  });
  assert.deepEqual(projectBoundaryTraversal({
    boundaryId: "sut-boundary-validation-runner",
    observableId: "observable-test-result",
    providerSupport: "unsupported",
    providerAttestation: attestation
  }), {
    boundary_id: "sut-boundary-validation-runner",
    observable_id: "observable-test-result",
    provider_support: "unsupported",
    provider: attestation.provider,
    authenticated: true,
    boundary_kind: null,
    observation_mechanism: "registry_unsupported",
    observation_seam: null,
    status: "review_only",
    evidence_artifact_ids: []
  });
});

test("falsifier proof requires isolation, unchanged pass, target failure, and exact reason", () => {
  assert.equal(falsifier().status, "detected");
  assert.equal(falsifier({ observedFailureReasonCode: "unrelated_failure" }).status, "not_detected");
  assert.equal(falsifier({ isolated: false }).status, "not_detected");
  assert.equal(falsifier({ mutationObserved: false }).status, "not_detected");
  assert.equal(falsifier({ falsifiedStatus: "skipped" }).status, "execution_error");
});

test("loader execution with target failure and exact structured reason is detected", async () => {
  const observation = await observeFalsifierRun({
    targetReasonCodes: [expectedFalsifierReason, "ERR_TEST_FAILURE"]
  });
  assert.equal(observation.valid, true);
  assert.equal(observation.mutation_observed, true);
  assert.equal(observation.failure_reason_code, expectedFalsifierReason);
  assert.equal(falsifier({
    falsifiedStatus: observation.status,
    mutationObserved: observation.mutation_observed,
    observedFailureReasonCode: observation.failure_reason_code
  }).status, "detected");
  assert.deepEqual(observation.mutation.structured_failure_error_codes,
    ["ERR_TEST_FAILURE", expectedFalsifierReason, falsifierMutationAttestationCode]);
});

test("a valid structured selected assertion failure remains evaluable proof evidence",
  async () => {
    const workingDirectory = process.cwd();
    const testId = stableRuntimeTestId(
      "candidate-failure.test.mjs :: 0 :: selected assertion fails"
    );
    const stdout = await reporterStdout([{
      type: "test:fail",
      data: {
        file: path.join(workingDirectory, "candidate-failure.test.mjs"),
        name: "selected assertion fails",
        nesting: 0,
        details: { type: "test", error: { code: "ERR_ASSERTION" } }
      }
    }, {
      type: "test:summary",
      data: { counts: { passed: 0, failed: 1, skipped: 0,
        cancelled: 0, todo: 0, tests: 1 } }
    }]);
    const observation = observeLauncherNodeTestRun({
      stdout,
      exitCode: 1,
      expectation: { capability: "candidate_execution", target_test_id: testId }
    });
    assert.equal(observation.valid, true);
    assert.equal(observation.status, "failed");
    assert.equal(observation.selected_status, "failed");
    assert.deepEqual(observation.test_inventory.observed_test_ids, [testId]);
    assert.deepEqual(observation.test_inventory.executed_test_ids, [testId]);
  });

test("reporter and observer share file-URL normalization for a nested top-level test",
  async () => {
    const relativeFile = "tests/integration/nested-runtime-identity.test.mjs";
    const file = pathToFileURL(path.join(process.cwd(), relativeFile)).href;
    const parentName = "selected top-level identity";
    const childName = "nested state";
    const parentId = stableRuntimeTestId(`${relativeFile} :: 0 :: ${parentName}`);
    const childId = stableRuntimeTestId(`${relativeFile} :: 1 :: ${childName}`);
    const stdout = await reporterStdout([{
      type: "test:pass",
      data: { file, name: childName, nesting: 1, details: { type: "test" } }
    }, {
      type: "test:pass",
      data: { file, name: parentName, nesting: 0, details: { type: "test" } }
    }, {
      type: "test:summary",
      data: { counts: { passed: 2, failed: 0, skipped: 0,
        cancelled: 0, todo: 0, tests: 2 } }
    }]);
    const observation = observeLauncherNodeTestRun({
      stdout,
      exitCode: 0,
      expectation: { capability: "candidate_execution", target_test_id: parentId }
    });
    assert.equal(observation.valid, true, JSON.stringify(observation));
    assert.equal(observation.status, "passed");
    assert.equal(observation.selected_status, "passed");
    assert.deepEqual(observation.test_inventory.observed_test_ids,
      [parentId, childId].sort());
    assert.ok(observation.test_inventory.executed_test_ids.includes(parentId));
  });

test("selected assertion status is independent of sibling failures and the file exit code",
  async () => {
    const relativeFile = "tests/integration/selected-purpose.test.mjs";
    const selectedName = "selected proof passes";
    const selectedId = stableRuntimeTestId(`${relativeFile} :: 0 :: ${selectedName}`);
    const stdout = await reporterStdout([{
      type: "test:fail",
      data: { file: path.join(process.cwd(), relativeFile), name: "unrelated sibling fails",
        nesting: 0, details: { type: "test", error: { code: "ERR_ASSERTION" } } }
    }, {
      type: "test:pass",
      data: { file: path.join(process.cwd(), relativeFile), name: selectedName,
        nesting: 0, details: { type: "test" } }
    }, {
      type: "test:summary",
      data: { counts: { passed: 1, failed: 1, skipped: 0,
        cancelled: 0, todo: 0, tests: 2 } }
    }]);
    const observation = observeLauncherNodeTestRun({ stdout, exitCode: 1,
      expectation: { capability: "candidate_execution", target: relativeFile,
        target_test_id: selectedId } });
    assert.equal(observation.valid, true);
    assert.equal(observation.status, "failed");
    assert.equal(observation.selected_status, "passed");
    assert.equal(observation.test_inventory.observed_test_ids.length, 2);
  });

test("file termination before the selected assertion is a bounded distinct observation",
  async () => {
    const relativeFile = "tests/integration/selected-purpose.test.mjs";
    const selectedId = stableRuntimeTestId(
      `${relativeFile} :: 0 :: selected proof never starts`
    );
    const stdout = await reporterStdout([{
      type: "test:fail",
      data: { file: path.join(process.cwd(), relativeFile),
        name: path.join(process.cwd(), relativeFile), nesting: 0,
        details: { type: "test", error: { code: "ERR_FIXTURE_TERMINATED" } } }
    }, {
      type: "test:summary",
      data: { counts: { passed: 0, failed: 1, skipped: 0,
        cancelled: 0, todo: 0, tests: 1 } }
    }]);
    const observation = observeLauncherNodeTestRun({ stdout, exitCode: 1,
      expectation: { capability: "candidate_execution", target: relativeFile,
        target_test_id: selectedId } });
    assert.equal(observation.valid, false);
    assert.equal(observation.code, "test_proof_selected_identity_not_observed");
    assert.deepEqual(observation.detail, {
      expected_test_id: selectedId,
      target: relativeFile,
      observed_count: 1,
      returned_count: 0,
      omitted_count: 1,
      observed_identity_candidates: [],
      file_wrapper_status: "failed",
      file_wrapper_error_codes: ["ERR_FIXTURE_TERMINATED"]
    });
  });

test("loader execution with a different target failure reason is not detected", async () => {
  const observation = await observeFalsifierRun({
    targetReasonCodes: [differentFalsifierReason]
  });
  assert.equal(observation.mutation_observed, false);
  assert.equal(observation.failure_reason_code, null);
  assert.equal(falsifier({
    falsifiedStatus: observation.status,
    mutationObserved: observation.mutation_observed,
    observedFailureReasonCode: observation.failure_reason_code
  }).status, "not_detected");
  assert.deepEqual(observation.mutation.structured_failure_error_codes,
    [differentFalsifierReason, falsifierMutationAttestationCode]);
});

test("loader execution with no structured target failure reason is not detected", async () => {
  const observation = await observeFalsifierRun({ targetReasonCodes: [] });
  assert.equal(observation.mutation_observed, false);
  assert.equal(observation.failure_reason_code, null);
  assert.equal(falsifier({
    falsifiedStatus: observation.status,
    mutationObserved: observation.mutation_observed,
    observedFailureReasonCode: observation.failure_reason_code
  }).status, "not_detected");
  assert.deepEqual(observation.mutation.structured_failure_error_codes,
    [falsifierMutationAttestationCode]);
});

test("stdout-only exact failure reason is not detected", async () => {
  const observation = await observeFalsifierRun({
    targetReasonCodes: [],
    stdoutReasonCode: expectedFalsifierReason
  });
  assert.equal(observation.mutation_observed, false);
  assert.equal(observation.failure_reason_code, null);
  assert.equal(falsifier({
    falsifiedStatus: observation.status,
    mutationObserved: observation.mutation_observed,
    observedFailureReasonCode: observation.failure_reason_code
  }).status, "not_detected");
  assert.deepEqual(observation.mutation.structured_failure_error_codes,
    [falsifierMutationAttestationCode]);
});

test("exact failure reason from an unrelated test is not detected", async () => {
  const observation = await observeFalsifierRun({
    targetReasonCodes: [differentFalsifierReason],
    unrelatedReasonCodes: [expectedFalsifierReason]
  });
  assert.equal(observation.mutation_observed, false);
  assert.equal(observation.failure_reason_code, null);
  assert.equal(falsifier({
    falsifiedStatus: observation.status,
    mutationObserved: observation.mutation_observed,
    observedFailureReasonCode: observation.failure_reason_code
  }).status, "not_detected");
  assert.deepEqual(observation.mutation.structured_failure_error_codes,
    [expectedFalsifierReason, differentFalsifierReason,
      falsifierMutationAttestationCode].sort());
});

test("builds deterministic content-addressed package-valid advisory evidence", () => {
  const input = {
    evidenceIdentity: identity(), contractBinding: contractBinding(),
    executionResult: { status: "passed", exit_code: 0, attempt_id: attemptId("a"),
      structured_result: structuredResult(), evidence_artifact_ids: [artifactId("e")],
      provider: provider("launcher.node-test", "candidate_execution",
        "node_test_structured_events", ["structured_test_result"]) }, testInventory: inventory(),
    boundaryTraversals: [traversal()], falsifierExecutions: [falsifier()], artifacts
  };
  const first = buildTestProofRuntimeEvidence(input);
  const second = buildTestProofRuntimeEvidence(structuredClone(input));
  assert.equal(canonicalTestProofEvidenceJson(first), canonicalTestProofEvidenceJson(second));
  assert.equal(first.evidence_digest, digestTestProofEvidence(first.evidence));
  assert.equal(first.semantic_judgment, "not_performed_coordinator_owned");
  assert.equal(first.admission_effect, "none");
  assert.equal(Object.hasOwn(first.evidence, "timestamp"), false);
  const receipt = extractTestProofRuntimeEvidenceReceipt(first);
  assert.equal(receipt.evidence_digest, first.evidence_digest);
  assert.equal(receipt.authority_effect, "none");
});

test("closed registry resolves exact versioned provider capabilities", () => {
  const binding = {
    system_under_test_boundary: { kind: "module", runtime_module_path: "dependency.mjs" },
    candidate_execution_provider: { provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution" },
    falsifiers: [{ falsifier_id: "falsifier-a", strategy: "dependency_failure",
      mutation: { mutation_id: "mutation-a", mechanism: "module_substitution",
        target_kind: "module", module_path: "dependency.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: "1.0.0", capability: "falsifier_execution" } }],
    traversal_provider: { mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", evidence_artifact_type: "boundary_trace" }
  };
  const registry = describeTestProofProviderRegistry();
  const resolved = resolveTestProofProviders(binding);
  assert.equal(registry.capability_snapshot_digest,
    TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST);
  assert.equal(resolved.candidate.capability, "candidate_execution");
  assert.equal(resolved.falsifiers[0].provider.capability, "falsifier_execution");
  assert.equal(resolved.traversal.provider.capability, "boundary_traversal");
  for (const [mutate, code] of [
    [(value) => { value.candidate_execution_provider.provider_id = "launcher.unknown"; },
      "stable_test_proof_provider_unknown"],
    [(value) => { value.candidate_execution_provider.provider_version = "0.9.0"; },
      "stable_test_proof_provider_version_mismatch"],
    [(value) => { value.traversal_provider = { mode: "registry_unsupported",
      registry_id: "launcher.test-proof-provider-registry", registry_version: "0.9.0" }; },
    "stable_test_proof_provider_version_mismatch"],
    [(value) => { delete value.candidate_execution_provider.capability; },
      "stable_test_proof_provider_partial"],
    [(value) => { value.candidate_execution_provider.capability = "falsifier_execution"; },
      "stable_test_proof_provider_capability_mismatch"],
    [(value) => { value.traversal_provider.observation_mechanism = "printed_marker"; },
      "stable_test_proof_provider_observation_mismatch"],
    [(value) => { value.traversal_provider.observation_seam = "printed_marker"; },
      "stable_test_proof_provider_observation_seam_mismatch"],
    [(value) => { value.traversal_provider.evidence_artifact_type = "stdout"; },
      "stable_test_proof_provider_artifact_type_mismatch"],
    [(value) => { value.falsifiers[0].strategy = "result_inversion"; },
      "stable_test_proof_provider_strategy_mismatch"],
    [(value) => { value.traversal_provider.boundary_kind = "process"; },
      "stable_test_proof_provider_boundary_mismatch"],
    [(value) => { value.falsifiers.push(structuredClone(value.falsifiers[0])); },
      "test_proof_provider_registry.duplicate.v1"]
  ]) {
    const weakened = structuredClone(binding);
    mutate(weakened);
    assert.throws(() => resolveTestProofProviders(weakened),
      (error) => error.code === code);
  }
  assert.throws(() => assertLauncherResolvedTestProofProvider({
    ...resolved.candidate
  }, "candidate_execution"),
  (error) => error.code === "test_proof_provider_registry.execution_untrusted.v1");
});

test("current public runtime and declarations expose only explicit stable identities", async () => {
  for (const name of ["resolveTestProofProviderBindings",
    "TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V1", "validateTestProofRuntimeEvidence"]) {
    assert.equal(name in controlledContractCurrent, false, name);
  }
  for (const name of ["resolveStableTestProofProviderBindings",
    "TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2", "validateTestProofRuntimeEvidenceV2",
    "projectStableTestProofCurrentPopulation",
    "classifyStableTestProofRuntimeReadiness",
    "STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS"]) {
    assert.equal(name in controlledContractCurrent, true, name);
  }
  const declaration = await readFile(new URL(
    "../../packages/controlled-contract/current.d.mts", import.meta.url
  ), "utf8");
  for (const name of ["resolveTestProofProviderBindings",
    "TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V1", "validateTestProofRuntimeEvidence"]) {
    assert.doesNotMatch(declaration, new RegExp(`\\b${name}\\b`, "u"), name);
  }
  for (const name of ["resolveStableTestProofProviderBindings",
    "TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2", "validateTestProofRuntimeEvidenceV2",
    "StableRuntimeTestIdentityV1", "classifyStableTestProofRuntimeReadiness"]) {
    assert.match(declaration, new RegExp(`\\b${name}\\b`, "u"), name);
  }
  const launcherIdentity = await readFile(new URL(
    "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs",
    import.meta.url
  ), "utf8");
  assert.doesNotMatch(launcherIdentity,
    /exactRuntimeTestId|TEST_PROOF_RUNTIME_TEST_SELECTION_VERSION/u);
  const stableOwner = await readFile(new URL(
    "../../packages/controlled-contract/lib/test-proof-contract-v1.mjs",
    import.meta.url
  ), "utf8");
  assert.doesNotMatch(stableOwner,
    /controlled-acceptance-contract\.experimental\.v0\.[23]|runtime_test_selection/u);
});

test("public runtime refuses caller-injected executor callbacks", async () => {
  await assert.rejects(() => executeTestProofAttempt({
    executeCandidate: async () => ({ status: "passed" }),
    executeFalsifier: async () => ({ status: "failed" })
  }), (error) => error.code === "test_proof_caller_executor_forbidden");
  await assert.rejects(() => executeTestProofAttempt({
    inventoryInput: { observedTestIds: [testA] }
  }), (error) => error.code === "test_proof_caller_inventory_forbidden");
  await assert.rejects(() => executeTestProofAttempt({
    inventoryInput: { baselineId: "caller-authored-baseline" }
  }), (error) => error.code === "test_proof_caller_inventory_forbidden");
  await assert.rejects(() => executeTestProofAttempt({
    declaredTestIds: [testA]
  }), (error) => error.code === "test_proof_caller_inventory_forbidden");
  for (const key of ["evidenceIdentity", "contractBinding", "testProofBinding",
    "authority", "target", "authorizedTargets", "traversalInputs", "falsifierInputs",
    "sourceSnapshot", "generationDigest", "testId"]) {
    await assert.rejects(() => executeTestProofAttempt({ [key]: {} }),
      (error) => error.code === "test_proof_caller_identity_forbidden");
  }
  for (const key of ["executor", "callback", "command", "argv", "environment",
    "artifacts", "module"]) {
    await assert.rejects(() => executeTestProofAttempt({ [key]: {} }),
      (error) => error.code === "test_proof_caller_executor_forbidden");
  }
});

test("printed markers, echoed reasons, and environment-shaped output are never observations", () => {
  for (const stdout of [
    "test_proof_fault.dependency_failure.v1\n",
    "TEST_PROOF_TRAVERSAL:sut-boundary-validation-runner:observable-test-result\n",
    JSON.stringify({ AGENT_CHASSIS_TEST_PROOF_FAILURE_REASON:
      "test_proof_fault.dependency_failure.v1" })
  ]) assert.equal(observeLauncherNodeTestRun({ stdout, exitCode: 1,
    expectation: { capability: "falsifier_execution" } }).valid, false);
});

test("stable launcher executes candidate, falsifier, and traversal with v2 evidence", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "test-proof-provider-"));
  const mainRepo = path.join(root, "main");
  const worktree = path.join(root, "worktree");
  await mkdir(mainRepo);
  await mkdir(worktree);
  await mkdir(path.join(worktree, "wiki/contracts"), { recursive: true });
  await writeFile(path.join(worktree, "wiki/contracts/WK-2064.controlled-acceptance.json"),
    "{}\n");
  const launcherLib = path.join(worktree, "packages/agent-launch-cli/src/lib");
  await mkdir(launcherLib, { recursive: true });
  for (const name of ["workspace-agent-test-proof-node-reporter.mjs",
    "workspace-agent-test-proof-module-fault-loader.mjs",
    "workspace-agent-test-proof-module-fault-contract.mjs"]) {
    await writeFile(path.join(launcherLib, name), await readFile(new URL(
      `../../packages/agent-launch-cli/src/lib/${name}`, import.meta.url
    )));
  }
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = "provider-target.test.mjs";
  const dependency = "provider-dependency.mjs";
  const providerTestId = stableRuntimeTestId(
    "provider-target.test.mjs :: 0 :: provider target"
  );
  await writeFile(path.join(worktree, dependency),
    "export function value() { return 42; }\n");
  await writeFile(path.join(worktree, target), `
import assert from "node:assert/strict";
import test from "node:test";
console.log("test_proof_fault.dependency_failure.v1");
console.log("TEST_PROOF_TRAVERSAL:sut-boundary-validation-runner:observable-test-result");
test("provider target", async () => {
  assert.equal(process.env.AGENT_CHASSIS_TEST_PROOF_FAILURE_REASON, undefined);
  assert.equal(process.env.AGENT_CHASSIS_TEST_PROOF_BOUNDARY_ID, undefined);
  const { value } = await import("./provider-dependency.mjs");
  assert.equal(value(), 42);
});
`);
  const authority = mintManagedWorkerTestRunAuthority({
    mainRepo,
    commitBinding: { subject: "WK-2064#SLICE-006",
      write_scope_source: "wiki/work-records/WK-2064.json#SLICE-006",
      worktree_path: worktree, source_digest: digest("e"),
      launch_ref: "refs/heads/slice/IN-0001/WK-2064/SLICE-006", run_id: "run-provider" }
  });
  const binding = {
    test_proof_id: "test-proof-runtime-evidence",
    verification_claim_id: "claim-verify-slice-006",
    system_under_test_boundary: { boundary_id: "sut-boundary-validation-runner",
      kind: "module", runtime_module_path: dependency, subject_reference_ids: ["ref-runtime"] },
    observable_result: { observable_id: "observable-test-result", kind: "return_value",
      proposition_id: "prop-runtime" },
    candidate_execution_provider: { provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution" },
    falsifiers: [{ falsifier_id: "falsifier-test-removed", strategy: "dependency_failure",
      proposition_id: "prop-runtime-fails", expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-provider-dependency", mechanism: "module_substitution",
        target_kind: "module", module_path: dependency },
      execution_provider: { provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
        capability: "falsifier_execution" } }],
    traversal_provider: { mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", evidence_artifact_type: "boundary_trace" },
    coverage_disposition: { baseline_id: "coverage-baseline-suite",
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: providerTestId, disposition: "preserved" }] },
    runtime_test_identity: { test_id: providerTestId },
    prohibited_shortcuts: ["source_text_inspection"]
  };
  const proofAuthority = mintManagedWorkerTestProofRuntimeAuthority({ authority });
  const selection = await controlledSelection(worktree, binding);
  const missingSelection = structuredClone(selection);
  delete missingSelection.bindings[0].runtime_test_identity;
  assert.throws(() => mintLauncherTestProofAttemptContext({
    authority: proofAuthority,
    target,
    authorizedTargets: [target],
    controlledContractSelection: missingSelection,
    verificationId: "claim-verify-slice-006"
  }), (error) => error.code === "test_proof_runtime_test_selection_missing" &&
    error.detail.candidate_total === 1 &&
    error.detail.authority_limb === "mechanical_failure");
  const invalidSelection = structuredClone(selection);
  invalidSelection.bindings[0].runtime_test_identity = {
    test_id: `test-${"f".repeat(64)}`
  };
  assert.throws(() => mintLauncherTestProofAttemptContext({
    authority: proofAuthority,
    target,
    authorizedTargets: [target],
    controlledContractSelection: invalidSelection,
    verificationId: "claim-verify-slice-006"
  }), (error) => error.code === "test_proof_runtime_test_selection_invalid");
  assert.throws(() => mintLauncherTestProofAttemptContext({
    authority: proofAuthority,
    target,
    authorizedTargets: [target],
    controlledContractSelection: selection,
    verificationId: "claim-verify-slice-006",
    runtimeTestIdentity: { test_id: providerTestId }
  }), (error) => error.code === "test_proof_caller_identity_forbidden");
  const context = mintLauncherTestProofAttemptContext({
    authority: proofAuthority,
    target,
    authorizedTargets: [target],
    controlledContractSelection: selection,
    verificationId: "claim-verify-slice-006"
  });
  const attempt = await executeTestProofAttempt({ context });
  assert.equal(attempt.evidence.schema_version,
    controlledContractCurrent.TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2);
  assert.equal(attempt.evidence.test_proof_version,
    controlledContractCurrent.TEST_PROOF_VERSION_V1);
  assert.equal(attempt.evidence.contract_binding.contract_schema_version,
    controlledContractCurrent.SCHEMA_VERSION_V1);
  assert.equal(attempt.evidence.execution_result.status, "passed");
  assert.deepEqual(attempt.evidence.falsifier_executions.map(({ status }) => status),
    ["detected"]);
  assert.deepEqual(attempt.evidence.boundary_traversals.map(({ status }) => status),
    ["proven"]);
  assert.equal(controlledContractCurrent.validateTestProofRuntimeEvidenceV2(
    attempt.evidence
  ).valid, true);

  for (const contractSchemaVersion of [
    "controlled-acceptance-contract.experimental.v0.2",
    "controlled-acceptance-contract.experimental.v0.3"
  ]) {
    const experimental = { ...selection,
      contract_schema_version: contractSchemaVersion };
    assert.throws(() => mintLauncherTestProofAttemptContext({
      authority: proofAuthority,
      target,
      authorizedTargets: [target],
      controlledContractSelection: experimental,
      verificationId: "claim-verify-slice-006"
    }), (error) => error.code === "test_proof_controlled_contract_identity_invalid");
  }
});

test("source-text inspection is recorded as a prohibited shortcut, never evidence", () => {
  const result = buildTestProofRuntimeEvidence({
    evidenceIdentity: identity(), contractBinding: contractBinding(),
    executionResult: { status: "failed", exit_code: 1, attempt_id: attemptId("a"),
      structured_result: structuredResult("failed"), evidence_artifact_ids: [artifactId("e")],
      provider: provider("launcher.node-test", "candidate_execution",
        "node_test_structured_events", ["structured_test_result"]) }, testInventory: inventory(),
    boundaryTraversals: [traversal()],
    falsifierExecutions: [falsifier({ candidateStatus: "failed" })],
    observedShortcuts: ["source_text_inspection"], artifacts
  });
  assert.deepEqual(result.evidence.observed_shortcuts, ["source_text_inspection"]);
  assert.equal(result.evidence.falsifier_executions[0].status, "not_detected");
});

test("terminal validation refuses identities without exact receipts", () => {
  assert.throws(() => bindTerminalTestProofVerificationIds(
    [{ target: "tests/example.test.mjs", ok: true }],
    { "tests/example.test.mjs": ["claim-verify-example"] }
  ), (error) => error.code ===
    TERMINAL_TEST_PROOF_RUNTIME_REFUSAL_CODES.RECEIPT_INCOMPLETE);
  const [bound] = bindTerminalTestProofVerificationIds(
    [{ target: "tests/example.test.mjs", ok: true }],
    { "tests/example.test.mjs": ["claim-verify-example"] },
    { "tests/example.test.mjs": [{ evidence_identity: {
      verification_id: "claim-verify-example"
    } }] }
  );
  assert.deepEqual(bound.verification_ids, ["claim-verify-example"]);
  assert.equal(bound.test_proof_evidence_authority, "advisory_execution_facts");
});
