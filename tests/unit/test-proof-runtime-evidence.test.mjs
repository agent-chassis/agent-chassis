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
  digestTestProofEvidence,
  executeTestProofAttempt,
  projectBoundaryTraversal,
  projectFalsifierExecution,
  projectTestProofInventory,
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
import { currentProviderBinding } from "../helpers/verify-proof-runtime-fixture.mjs";
import launcherTestProofReporter from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-reporter.mjs";
import { captureTestFailureDiagnostic, isLauncherTestFailureDiagnostic } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-error-diagnostic.mjs";
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

const WITNESS_PAYLOADS = Object.freeze({
  c: { mechanism: "node_test_v8_coverage", boundary_kind: "module",
    module_path: "validation-runner.mjs", observable_seam: "node_test_structured_assertion",
    target_test_id: testA, target_pass_observed: true, observed: true,
    covered_module_paths: ["validation-runner.mjs"] },
  d: { mechanism: "module_substitution", strategy: "dependency_failure",
    mutation_id: "mutation-test-dependency", target_module_path: "dependency.mjs",
    target_test_id: testA, witness_identity: "d".repeat(64),
    observation: { dependency_invocation_count: 1, reached_assertion: true,
      selected_test_only: true, observed: true } }
});
const artifactPayload = (character) => structuredClone(WITNESS_PAYLOADS[character] ??
  { fixture: character });
const artifactDigest = (character) => digestTestProofEvidence(artifactPayload(character));
const artifactId = (character) => `artifact-${artifactDigest(character).slice(7)}`;
const attemptId = (character) => `attempt-${character.repeat(64)}`;
const provider = (providerId, capability, observationMechanism, artifactTypes) => ({
  provider_id: providerId, capability,
  provider_version: controlledContractCurrent.TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: id }) => id === providerId).provider_version,
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
    error_codes: ["ERR_TEST_FAILURE"],
    failure_diagnostic: captureTestFailureDiagnostic(
      Object.assign(new Error("selected fixture failed"), { code: "ERR_TEST_FAILURE" })
    )}]
});

function structuredArtifact(status = "passed", payload = structuredResult(status)) {
  const digest = digestTestProofEvidence(payload);
  return { artifact_id: `artifact-${digest.slice(7)}`, kind: "structured_test_result",
    digest, owner: "launcher", payload };
}

async function reporterStdout(events) {
  async function* source() {
    yield* events;
  }
  let stdout = "";
  for await (const chunk of launcherTestProofReporter(source())) stdout += chunk;
  return stdout;
}

test("failure capture preserves nested errors and a complete cyclic assertion-value graph", () => {
  let hookCalls = 0;
  const shared = { marker: "shared-value" };
  shared.self = shared;
  const expected = { shared, absent: undefined, nan: Number.NaN, negativeZero: -0,
    bigint: 42n, date: new Date("2026-09-10T00:00:00.000Z"), expression: /proof/giu,
    map: new Map([[shared, "mapped"]]), set: new Set([shared]),
    arrayBuffer: Uint8Array.from([1, 2, 3]).buffer,
    typed: new Uint16Array([258, 772]), bytes: Buffer.from([4, 5, 6]) };
  Object.defineProperty(expected, "getter", { enumerable: true, get() {
    hookCalls++; return "must not execute";
  } });
  expected.toJSON = () => { hookCalls++; return {}; };
  expected[Symbol.for("nodejs.util.inspect.custom")] = () => {
    hookCalls++; return "must not inspect";
  };
  const actual = { shared, values: [1, , 3] };
  const assertion = new assert.AssertionError({
    message: "WK-2554 distinctive assertion explanation",
    expected, actual, operator: "deepStrictEqual"
  });
  assertion.code = "ERR_ASSERTION";
  const aggregateCause = new AggregateError(
    [assertion, Object.assign(new Error("aggregate sibling"), { code: "ERR_AGGREGATE_CHILD" })],
    "aggregate wrapper",
    { cause: Object.assign(new Error("nested cause"), { code: "ERR_NESTED_CAUSE" }) }
  );
  Object.defineProperty(aggregateCause.errors, "map", { get() {
    hookCalls++; throw new Error("aggregate array hooks must not execute");
  } });
  const wrapper = Object.assign(new Error("runner wrapper", { cause: aggregateCause }),
    { code: "ERR_TEST_FAILURE" });
  const hookCallsBeforeCapture = hookCalls;
  const diagnostic = captureTestFailureDiagnostic(wrapper);
  assert.equal(isLauncherTestFailureDiagnostic(diagnostic), true);
  const malformedBytes = structuredClone(diagnostic);
  malformedBytes.values.find(({ type }) => type === "array_buffer").bytes = "A";
  assert.equal(isLauncherTestFailureDiagnostic(malformedBytes), false);
  assert.equal(hookCalls, hookCallsBeforeCapture);
  const errors = new Map(diagnostic.errors.map((entry) => [entry.id, entry]));
  const values = new Map(diagnostic.values.map((entry) => [entry.id, entry]));
  const root = errors.get(diagnostic.root_error);
  const aggregate = errors.get(root.cause);
  const capturedAssertion = diagnostic.errors.find(({ code }) => code === "ERR_ASSERTION");
  assert.equal(root.code, "ERR_TEST_FAILURE");
  assert.equal(aggregate.message, "aggregate wrapper");
  assert.ok(aggregate.aggregate_errors.includes(capturedAssertion.id));
  assert.match(capturedAssertion.message,
    /^WK-2554 distinctive assertion explanation/u);
  assert.equal(capturedAssertion.operator, "deepStrictEqual");
  assert.match(capturedAssertion.stack, /test-proof-runtime-evidence\.test\.mjs/u);
  const expectedNode = values.get(capturedAssertion.expected);
  const actualNode = values.get(capturedAssertion.actual);
  const properties = (node) => new Map(node.properties.map((entry) => [entry.key, entry.value]));
  const expectedProperties = properties(expectedNode);
  const actualProperties = properties(actualNode);
  assert.equal(expectedProperties.get("shared"), actualProperties.get("shared"));
  const sharedNode = values.get(expectedProperties.get("shared"));
  assert.equal(properties(sharedNode).get("self"), sharedNode.id);
  assert.equal(values.get(expectedProperties.get("absent")).type, "undefined");
  assert.equal(values.get(expectedProperties.get("nan")).type, "nonfinite_number");
  assert.equal(values.get(expectedProperties.get("negativeZero")).type, "negative_zero");
  assert.equal(values.get(expectedProperties.get("bigint")).value, "42");
  assert.equal(values.get(expectedProperties.get("date")).value, "2026-09-10T00:00:00.000Z");
  assert.equal(values.get(expectedProperties.get("expression")).type, "regexp");
  assert.equal(values.get(expectedProperties.get("map")).type, "map");
  assert.equal(values.get(expectedProperties.get("set")).type, "set");
  assert.equal(values.get(expectedProperties.get("arrayBuffer")).bytes, "AQID");
  assert.equal(values.get(expectedProperties.get("typed")).type, "typed_array");
  assert.equal(values.get(expectedProperties.get("bytes")).type, "buffer");
  assert.equal(values.get(expectedProperties.get("getter")).type, "unavailable");
  assert.equal(values.get(expectedProperties.get("toJSON")).type, "unavailable");
  assert.ok(diagnostic.issues.some(({ reason }) => reason === "accessor_not_invoked"));
  assert.ok(diagnostic.issues.some(({ reason }) => reason === "unsupported_symbol_key"));
  assert.equal(values.get(properties(values.get(actualProperties.get("values"))).get("0")),
    undefined);
  const sparse = values.get(actualProperties.get("values"));
  assert.deepEqual(sparse.elements.map(({ index }) => index), [0, 2]);
});

test("failure capture explicitly represents an unavailable reporter error", () => {
  const diagnostic = captureTestFailureDiagnostic(undefined);
  assert.deepEqual(diagnostic, {
    schema_version: "launcher-test-failure-diagnostic.v1",
    status: "unavailable", root_error: null, errors: [], values: [],
    issues: [{ path: "/error", reason: "error_not_supplied" }]
  });
  assert.equal(isLauncherTestFailureDiagnostic(diagnostic), true);
});

function inventory(overrides = {}) {
  return projectTestProofInventory({
    selectedTestId: testA,
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
}, structuredArtifact()];

test("records the complete observed population beside the one selected test", () => {
  const projected = inventory({ observedTestIds: [testC, testA], executedTestIds: [testC, testA] });
  assert.deepEqual(projected, {
    selected_test_id: testA,
    declared_test_ids: [testA],
    discovered_test_ids: [testA, testC].sort(),
    executed_test_ids: [testA, testC].sort(),
    skipped_test_ids: []
  });
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.discovered_test_ids), true);
});

test("a skipped selected test is reported as skipped, never inferred executed", () => {
  const projected = inventory({ executedTestIds: [testB], skippedTestIds: [testA] });
  assert.deepEqual(projected.skipped_test_ids, [testA]);
  assert.deepEqual(projected.executed_test_ids, [testB]);
  assert.deepEqual(projected.declared_test_ids, [testA]);
});

test("inventory refuses unobserved, duplicated, or non-stable identities", () => {
  assert.throws(() => inventory({ executedTestIds: [testA, testC] }),
    (error) => error.code === "test_proof_inventory_invalid");
  assert.throws(() => inventory({ skippedTestIds: [testC] }),
    (error) => error.code === "test_proof_inventory_invalid");
  assert.throws(() => inventory({ observedTestIds: [testA, testB, testA] }),
    (error) => error.code === "test_proof_inventory_duplicate");
  assert.throws(() => inventory({ selectedTestId: "file.test.mjs :: 0 :: not a stable id" }),
    (error) => error.code === "test_proof_test_identity_invalid");
});

test("unsupported traversal cannot be caller-declared", () => {
  assert.throws(() => traversal({ providerSupport: "unsupported" }),
    (error) => error.code === "test_proof_provider_registry.execution_untrusted.v1");
  const attestation = authenticateUnsupportedTestProofTraversal({
    mode: "registry_unsupported", registry_id: "launcher.test-proof-provider-registry",
    registry_version: "1.3.0"
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
    limitation: null,
    evidence_artifact_ids: []
  });
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
    assert.equal(observation.structured_result.fail_events[0].failure_diagnostic.status,
      "captured");
    assert.equal(observation.structured_result.fail_events[0].failure_diagnostic
      .errors[0].code, "ERR_ASSERTION");
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

test("file termination before the selected assertion is a complete distinct observation",
  async () => {
    const relativeFile = "tests/integration/selected-purpose.test.mjs";
    const selectedId = stableRuntimeTestId(
      `${relativeFile} :: 0 :: selected proof never starts`
    );
    const failureDiagnostic = captureTestFailureDiagnostic({ code: "ERR_FIXTURE_TERMINATED" });
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
      returned_count: 1,
      omitted_count: 0,
      observed_identity_candidates: [{ test_id: stableRuntimeTestId(
        `${relativeFile} :: 0 :: ${path.join(process.cwd(), relativeFile)}`),
        file: relativeFile, name: relativeFile, nesting: 0,
        status: "failed", error_codes: ["ERR_FIXTURE_TERMINATED"],
        failure_diagnostic: failureDiagnostic }],
      observed_failures: [{ test_id: stableRuntimeTestId(
        `${relativeFile} :: 0 :: ${path.join(process.cwd(), relativeFile)}`),
        file: relativeFile, name: relativeFile, nesting: 0,
        status: "failed", error_codes: ["ERR_FIXTURE_TERMINATED"],
        failure_diagnostic: failureDiagnostic }],
      observed_failure_count: 1,
      file_wrapper_status: "failed",
      file_wrapper_error_codes: ["ERR_FIXTURE_TERMINATED"]
    });
  });

test("failure diagnostics are covered by reporter authentication", async () => {
  const stdout = await reporterStdout([{
    type: "test:fail",
    data: { file: path.join(process.cwd(), "tamper.test.mjs"), name: "tampered",
      nesting: 0, details: { type: "test", error:
        Object.assign(new Error("authentic message"), { code: "ERR_ASSERTION" }) } }
  }, {
    type: "test:summary",
    data: { counts: { passed: 0, failed: 1, skipped: 0,
      cancelled: 0, todo: 0, tests: 1 } }
  }]);
  const envelope = JSON.parse(stdout);
  envelope.events[0].failure_diagnostic.errors[0].message = "tampered message";
  const observation = observeLauncherNodeTestRun({ stdout: JSON.stringify(envelope), exitCode: 1,
    expectation: { capability: "candidate_execution" } });
  assert.deepEqual(observation,
    { valid: false, code: "test_proof_structured_events_digest_mismatch" });
});

test("builds deterministic content-addressed package-valid advisory evidence", () => {
  const input = {
    evidenceIdentity: identity(), contractBinding: contractBinding(),
    executionResult: { status: "passed", exit_code: 0, attempt_id: attemptId("a"),
      structured_result: structuredResult(),
      evidence_artifact_ids: [structuredArtifact().artifact_id],
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
    test_proof_id: "test-proof-provider-resolution",
    verification_claim_id: "claim-provider-resolution",
    system_under_test_boundary: { boundary_id: "sut-boundary-provider-resolution",
      kind: "module", runtime_module_path: "dependency.mjs",
      subject_reference_ids: ["ref-provider-subject"] },
    observable_result: { observable_id: "observable-provider-resolution",
      kind: "return_value", proposition_id: "prop-provider-result" },
    candidate_execution_provider: { provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution" },
    falsifiers: [{ falsifier_id: "falsifier-a", strategy: "dependency_failure",
      proposition_id: "prop-provider-failure", expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-a", mechanism: "module_substitution",
        target_kind: "module", module_path: "dependency.mjs" },
      execution_provider: currentProviderBinding("launcher.node-test-module-fault",
        "falsifier_execution") }],
    traversal_provider: { mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", evidence_artifact_type: "boundary_trace" },
    test_selector: { name: "provider resolution uses the closed registry", nesting: 0 },
    prohibited_shortcuts: ["source_text_inspection"]
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
    [(value) => { value.candidate_execution_provider = {
      ...currentProviderBinding("launcher.node-test-module-fault", "falsifier_execution"),
      capability: "candidate_execution" }; },
      "stable_test_proof_provider_capability_mismatch"],
    [(value) => { value.traversal_provider.observation_mechanism =
      "node_test_structured_events"; },
      "stable_test_proof_provider_observation_mismatch"],
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
  const incomplete = structuredClone(binding);
  delete incomplete.candidate_execution_provider.capability;
  assert.throws(() => resolveTestProofProviders(incomplete), (error) =>
    error.code === "test_proof_provider_registry.binding_invalid.v1" &&
    error.detail?.package_code === "stable_test_proof_incomplete");
  assert.throws(() => assertLauncherResolvedTestProofProvider({
    ...resolved.candidate
  }, "candidate_execution"),
  (error) => error.code === "test_proof_provider_registry.execution_untrusted.v1");
});

test("current public runtime and declarations expose only explicit stable identities", async () => {

  for (const name of ["resolveTestProofProviderBindings",
    "TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V1", "validateTestProofRuntimeEvidence",
    "projectStableTestProofCurrentPopulation",
    "classifyStableTestProofRuntimeReadiness",
    "STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS",
    "STABLE_TEST_PROOF_RUNTIME_READINESS_SCHEMA_VERSION"]) {
    assert.equal(name in controlledContractCurrent, false, name);
  }
  for (const name of ["resolveStableTestProofProviderBindings",
    "TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2", "validateTestProofRuntimeEvidenceV2",
    "projectStableTestProofSelector"]) {
    assert.equal(name in controlledContractCurrent, true, name);
  }
  const declaration = await readFile(new URL(
    "../../packages/controlled-contract/current.d.mts", import.meta.url
  ), "utf8");
  for (const name of ["resolveTestProofProviderBindings",
    "TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V1", "validateTestProofRuntimeEvidence",
    "classifyStableTestProofRuntimeReadiness", "projectStableTestProofCurrentPopulation"]) {
    assert.doesNotMatch(declaration, new RegExp(`\\b${name}\\b`, "u"), name);
  }
  for (const name of ["resolveStableTestProofProviderBindings",
    "TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2", "validateTestProofRuntimeEvidenceV2",
    "projectStableTestProofSelector"]) {
    assert.match(declaration, new RegExp(`\\b${name}\\b`, "u"), name);
  }
  const launcherIdentity = await readFile(new URL(
    "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs",
    import.meta.url
  ), "utf8");
  assert.doesNotMatch(launcherIdentity,
    /exactRuntimeTestId|TEST_PROOF_RUNTIME_TEST_SELECTION_VERSION|runtime_test_identity|coverage_disposition/u);
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
  for (const name of ["workspace-agent-test-proof-error-diagnostic.mjs",
    "workspace-agent-test-proof-node-reporter.mjs",
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
      execution_provider: currentProviderBinding("launcher.node-test-module-fault",
        "falsifier_execution") }],
    traversal_provider: { mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", evidence_artifact_type: "boundary_trace" },

    test_selector: { name: "provider target", nesting: 0 },
    prohibited_shortcuts: ["source_text_inspection"]
  };
  const proofAuthority = mintManagedWorkerTestProofRuntimeAuthority({ authority });
  const selection = await controlledSelection(worktree, binding);

  const missingSelector = structuredClone(selection);
  delete missingSelector.bindings[0].test_selector;
  assert.throws(() => mintLauncherTestProofAttemptContext({
    authority: proofAuthority,
    target,
    authorizedTargets: [target],
    controlledContractSelection: missingSelector,
    verificationId: "claim-verify-slice-006"
  }), (error) => error.code === "test_proof_test_selector_invalid" &&
    error.detail.package_code === "stable_test_proof_selector_invalid" &&
    error.detail.authority_limb === "mechanical_failure" &&
    error.detail.admissibility_effect === "none");
  const invalidSelector = structuredClone(selection);
  invalidSelector.bindings[0].test_selector = { name: "provider target", nesting: 65 };
  assert.throws(() => mintLauncherTestProofAttemptContext({
    authority: proofAuthority,
    target,
    authorizedTargets: [target],
    controlledContractSelection: invalidSelector,
    verificationId: "claim-verify-slice-006"
  }), (error) => error.code === "test_proof_test_selector_invalid");
  for (const callerAuthored of [
    { runtimeTestIdentity: { test_id: providerTestId } },
    { selectedTest: { test_id: providerTestId } },
    { testSelector: { name: "provider target", nesting: 0 } }
  ]) assert.throws(() => mintLauncherTestProofAttemptContext({
    authority: proofAuthority,
    target,
    authorizedTargets: [target],
    controlledContractSelection: selection,
    verificationId: "claim-verify-slice-006",
    ...callerAuthored
  }), (error) => error.code === "test_proof_caller_identity_forbidden");
  const context = mintLauncherTestProofAttemptContext({
    authority: proofAuthority,
    target,
    authorizedTargets: [target],
    controlledContractSelection: selection,
    verificationId: "claim-verify-slice-006"
  });

  assert.deepEqual(context.selected_test, { test_id: providerTestId, file: target,
    name: "provider target", nesting: 0 });
  assert.equal(context.evidence_identity.test_id, providerTestId);
  const attempt = await executeTestProofAttempt({ context });
  assert.equal(attempt.evidence.test_inventory.selected_test_id, providerTestId);
  assert.deepEqual(attempt.evidence.test_inventory.declared_test_ids, [providerTestId]);
  assert.ok(attempt.evidence.test_inventory.executed_test_ids.includes(providerTestId));
  const receipt = extractTestProofRuntimeEvidenceReceipt(attempt);
  assert.equal(receipt.selected_test_id, providerTestId);
  assert.equal(receipt.selected_test_executed, true);
  assert.equal(receipt.observed_test_count,
    attempt.evidence.test_inventory.discovered_test_ids.length);
  assert.equal(Object.hasOwn(receipt, "inventory_change_count"), false);
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
  const failedStructuredResult = structuredResult("failed");
  const failedStructuredArtifact = structuredArtifact("failed", failedStructuredResult);
  const result = buildTestProofRuntimeEvidence({
    evidenceIdentity: identity(), contractBinding: contractBinding(),
    executionResult: { status: "failed", exit_code: 1, attempt_id: attemptId("a"),
      structured_result: failedStructuredResult,
      evidence_artifact_ids: [failedStructuredArtifact.artifact_id],
      provider: provider("launcher.node-test", "candidate_execution",
        "node_test_structured_events", ["structured_test_result"]) }, testInventory: inventory(),
    boundaryTraversals: [traversal()],
    falsifierExecutions: [falsifier({ candidateStatus: "failed" })],
    observedShortcuts: ["source_text_inspection"],
    artifacts: [...artifacts.filter(({ kind }) => kind !== "structured_test_result"),
      failedStructuredArtifact]
  });
  assert.deepEqual(result.evidence.observed_shortcuts, ["source_text_inspection"]);
  assert.equal(result.evidence.falsifier_executions[0].status, "not_detected");
});

test("runtime evidence refuses malformed and dangling failure diagnostic graphs", () => {
  const failedStructuredResult = structuredResult("failed");
  const failedStructuredArtifact = structuredArtifact("failed", failedStructuredResult);
  const evidence = buildTestProofRuntimeEvidence({
    evidenceIdentity: identity(), contractBinding: contractBinding(),
    executionResult: { status: "failed", exit_code: 1, attempt_id: attemptId("a"),
      structured_result: failedStructuredResult,
      evidence_artifact_ids: [failedStructuredArtifact.artifact_id],
      provider: provider("launcher.node-test", "candidate_execution",
        "node_test_structured_events", ["structured_test_result"]) },
    testInventory: inventory(), boundaryTraversals: [traversal()],
    falsifierExecutions: [falsifier({ candidateStatus: "failed" })],
    artifacts: [...artifacts.filter(({ kind }) => kind !== "structured_test_result"),
      failedStructuredArtifact]
  }).evidence;
  assert.equal(controlledContractCurrent.validateTestProofRuntimeEvidenceV2(evidence).valid, true);

  const dangling = structuredClone(evidence);
  dangling.execution_result.structured_result.fail_events[0]
    .failure_diagnostic.errors[0].actual = "value-999";
  const danglingValidation = controlledContractCurrent.validateTestProofRuntimeEvidenceV2(dangling);
  assert.equal(danglingValidation.valid, false);
  assert.ok(danglingValidation.diagnostics.diagnostics.some(({ code }) =>
    code === "runtime_failure_diagnostic_reference_dangling"));

  const duplicate = structuredClone(evidence);
  const diagnostic = duplicate.execution_result.structured_result.fail_events[0].failure_diagnostic;
  diagnostic.errors.push(structuredClone(diagnostic.errors[0]));
  const duplicateValidation = controlledContractCurrent.validateTestProofRuntimeEvidenceV2(duplicate);
  assert.equal(duplicateValidation.valid, false);
  assert.ok(duplicateValidation.diagnostics.diagnostics.some(({ code }) =>
    code === "runtime_failure_diagnostic_error_identity_duplicate"));

  const missing = structuredClone(evidence);
  delete missing.execution_result.structured_result.fail_events[0].failure_diagnostic;
  const missingValidation = controlledContractCurrent.validateTestProofRuntimeEvidenceV2(missing);
  assert.equal(missingValidation.schema_valid, false);

  const malformedBytes = structuredClone(evidence);
  malformedBytes.execution_result.structured_result.fail_events[0]
    .failure_diagnostic.values.push({ id: "value-999", type: "array_buffer",
      byte_length: 0, bytes: "A" });
  const malformedBytesValidation = controlledContractCurrent
    .validateTestProofRuntimeEvidenceV2(malformedBytes);
  assert.equal(malformedBytesValidation.schema_valid, false);

  const tamperedArtifact = structuredClone(evidence);
  const artifact = tamperedArtifact.artifacts.find(({ kind }) => kind === "structured_test_result");
  artifact.payload.fail_events[0].failure_diagnostic.errors[0].message = "artifact tamper";
  const tamperedValidation = controlledContractCurrent.validateTestProofRuntimeEvidenceV2(
    tamperedArtifact
  );
  assert.equal(tamperedValidation.valid, false);
  assert.ok(tamperedValidation.diagnostics.diagnostics.some(({ code }) =>
    code === "runtime_artifact_identity_digest_mismatch"));
  assert.ok(tamperedValidation.diagnostics.diagnostics.some(({ code }) =>
    code === "runtime_structured_result_artifact_mismatch"));
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
