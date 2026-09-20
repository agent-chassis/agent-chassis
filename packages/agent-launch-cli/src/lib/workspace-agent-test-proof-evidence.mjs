import { createHash } from "node:crypto";

import {
  TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2,
  TEST_PROOF_VERSION_V1,
  validateTestProofRuntimeEvidenceV2
} from "@agent-chassis/controlled-contract";
import {
  authenticateUnsupportedTestProofFalsification,
  authenticateUnsupportedTestProofTraversal,
  assertRegistryUnsupportedTraversalAttestation,
  executeLauncherTestProofProvider,
  prepareLauncherTestProofProviderRuntime,
  resolveTestProofProviders
} from "./workspace-agent-test-proof-provider-registry.mjs";
import {
  assertLauncherNativeRuntimeInputsCurrent,
  assertLauncherTestProofAttemptContext,
  assertLauncherTestProofSourceSnapshotCurrent,
  bindLauncherNativeRuntimeInputs
} from "./workspace-agent-test-proof-runtime-identity.mjs";
import { observeLauncherPytestRun } from "./workspace-agent-test-proof-pytest-provider.mjs";
import { projectNativeObservation } from "./test-execution/native-observation.mjs";
import { PROOF_CAPABILITY_LIMITATION_CODES } from
  "./test-execution/proof-providers/execution.mjs";
import {
  TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE,
  projectTestProofForcedInvocationIdentityFailure
} from "./workspace-agent-test-proof-module-fault-contract.mjs";
import { stableRuntimeTestId as deriveStableRuntimeTestId } from
  "./workspace-agent-test-proof-node-reporter.mjs";

import { projectObservedTestFact } from "./workspace-agent-test-proof-node-observation.mjs";

export const TEST_PROOF_ATTEMPT_SCHEMA_VERSION = "workspace-agent-test-proof-attempt.v1";
export const TEST_PROOF_ATTEMPT_AUTHORITY = "advisory_execution_facts";

export class TestProofEvidenceError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "TestProofEvidenceError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = null) {
  throw new TestProofEvidenceError(code, message, detail);
}

const STABLE_RUN_CODE_RE = /^[a-z][a-z0-9_.]{0,159}$/u;

const BOUNDED_RUN_FACT_KEYS = Object.freeze([
  "ran", "disposition", "exit_code", "signal", "timed_out",
  "blocker_code", "output_truncated", "output_elided_bytes"
]);

function boundedRun(run) {
  if (!isObject(run)) return null;
  const bounded = {};
  for (const key of BOUNDED_RUN_FACT_KEYS) {
    if (Object.hasOwn(run, key)) bounded[key] = run[key];
  }
  if (typeof run.refusal_code === "string") {
    bounded.refusal_code = run.refusal_code;
    if (typeof run.detail?.errno === "string") bounded.detail = { errno: run.detail.errno };
  }

  if (typeof run.spawn_error === "string" &&
      STABLE_RUN_CODE_RE.test(run.spawn_error.toLowerCase())) {
    bounded.spawn_error_code = run.spawn_error;
  }

  if (typeof run.test_proof_observation?.code === "string") {
    const { code, detail } = run.test_proof_observation;
    const identityFailure = code === TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE.code
      ? projectTestProofForcedInvocationIdentityFailure(detail) : null;
    bounded.test_proof_observation = { code, ...(identityFailure === null ? {} : {
      detail: { reason: identityFailure.reason, module_path: identityFailure.module_path,
        export_name: identityFailure.export_name }
    }) };
  }
  return bounded;
}

function providerExecutionFailureDetail(trusted, executionStage, run) {
  return {
    execution_stage: executionStage,
    test_proof_id: trusted.test_proof_binding.test_proof_id,
    verification_id: trusted.evidence_identity.verification_id,
    run: boundedRun(run)
  };
}

function selectedIdentityNotObservedDetail(trusted, executionStage, run) {
  const observation = run?.test_proof_observation;
  if (observation?.code !== "test_proof_selected_identity_not_observed" ||
      !isObject(observation.detail)) return null;
  return {
    execution_stage: executionStage,
    test_proof_id: trusted.test_proof_binding.test_proof_id,
    verification_id: trusted.evidence_identity.verification_id,
    ...observation.detail,
    run: boundedRun(run)
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const LIMITATION_REASON_RE = /^[a-z][a-z0-9_]{0,63}$/u;

const REGISTRY_LIMITATION_CODES = Object.freeze([
  "test_proof_registry_falsification_unsupported"
]);
const CAPABILITY_LIMITATION_CODES = Object.freeze([
  ...PROOF_CAPABILITY_LIMITATION_CODES,
  ...REGISTRY_LIMITATION_CODES
]);

export function assertCapabilityLimitation(limitation) {
  if (!isObject(limitation) ||
      !CAPABILITY_LIMITATION_CODES.includes(limitation.reason_code)) fail(
    "test_proof_capability_limitation_invalid",
    "a capability limitation must carry one provider-owned limitation code",
    { reason_code: limitation?.reason_code ?? null });
  const detail = limitation.detail ?? null;
  if (detail !== null && (!isObject(detail) || Object.values(detail).some((value) =>
    typeof value !== "string" || !LIMITATION_REASON_RE.test(value)))) fail(
    "test_proof_capability_limitation_invalid",
    "capability limitation detail carries only stable adapter reason terms");
  return Object.freeze({ reason_code: limitation.reason_code,
    detail: detail === null ? null : Object.freeze({ ...detail }) });
}

export function projectCapabilityLimitations(limitations) {
  return Object.freeze([...limitations].map((entry) => Object.freeze({
    check_kind: entry.check_kind,
    check_id: entry.check_id,
    ...assertCapabilityLimitation(entry)
  })).sort((left, right) =>
    left.check_kind.localeCompare(right.check_kind) ||
    String(left.check_id).localeCompare(String(right.check_id))));
}

function boundIdentityMismatchDetail(candidate, expectedTestId, target) {
  const structured = candidate?.structured_result;
  const events = isObject(structured)
    ? [...(Array.isArray(structured.pass_events) ? structured.pass_events : []),
        ...(Array.isArray(structured.fail_events) ? structured.fail_events : [])]
    : [];
  const projected = events.map(projectObservedTestFact)
    .sort((left, right) =>
      Number(right.file === target) - Number(left.file === target) ||
      (left.file ?? "").localeCompare(right.file ?? "") || left.nesting - right.nesting ||
      (left.name ?? "").localeCompare(right.name ?? "") || left.test_id.localeCompare(right.test_id)
    );
  return {
    expected_test_id: expectedTestId,
    observed_count: events.length,
    returned_count: projected.length,
    omitted_count: events.length - projected.length,
    observed_identity_candidates: projected
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalTestProofEvidenceJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

export function digestTestProofEvidence(value) {
  return `sha256:${createHash("sha256").update(canonicalTestProofEvidenceJson(value)).digest("hex")}`;
}

export function stableRuntimeTestId(testIdentity) {
  if (typeof testIdentity !== "string" || testIdentity.length === 0) {
    fail("test_proof_test_identity_invalid", "test identity must be a nonempty string");
  }
  return deriveStableRuntimeTestId(testIdentity);
}

function sortedUnique(values, field) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value === "")) {
    fail("test_proof_inventory_invalid", `${field} must be an array of nonempty identities`);
  }
  const sorted = [...new Set(values)].sort();
  if (sorted.length !== values.length) {
    fail("test_proof_inventory_duplicate", `${field} contains duplicate identities`, { field });
  }
  return sorted;
}

export function projectTestProofInventory({
  selectedTestId,
  observedTestIds,
  executedTestIds,
  skippedTestIds
} = {}) {
  if (typeof selectedTestId !== "string" || !/^test-[a-f0-9]{64}$/u.test(selectedTestId)) {
    fail("test_proof_test_identity_invalid", "selectedTestId must be one stable runtime test identity");
  }
  const observed = sortedUnique(observedTestIds, "observedTestIds");
  const executed = sortedUnique(executedTestIds, "executedTestIds");
  const skipped = sortedUnique(skippedTestIds, "skippedTestIds");
  const observedSet = new Set(observed);
  for (const id of [...executed, ...skipped]) {
    if (!observedSet.has(id)) fail("test_proof_inventory_invalid", "executed and skipped identities must be observed", { test_id: id });
  }
  return Object.freeze({
    selected_test_id: selectedTestId,
    declared_test_ids: Object.freeze([selectedTestId]),
    discovered_test_ids: Object.freeze(observed),
    executed_test_ids: Object.freeze(executed),
    skipped_test_ids: Object.freeze(skipped)
  });
}

export function projectBoundaryTraversal({
  boundaryId,
  observableId,
  providerSupport,
  authenticated = false,
  observed = false,
  artifactIds = [],
  boundaryKind = null,
  observationMechanism = null,
  observationSeam = null,
  limitation = null,
  provider,
  providerAttestation
} = {}) {
  if (providerSupport !== "supported" && providerSupport !== "unsupported") {
    fail("test_proof_traversal_provider_invalid", "provider support must be supported or unsupported");
  }

  if (providerSupport === "unsupported" && limitation === null) {
    const attestation = assertRegistryUnsupportedTraversalAttestation(providerAttestation);
    return Object.freeze({
      boundary_id: boundaryId,
      observable_id: observableId,
      provider_support: "unsupported",
      provider: attestation.provider,
      authenticated: true,
      boundary_kind: null,
      observation_mechanism: "registry_unsupported",
      observation_seam: null,
      status: "review_only",
      limitation: null,
      evidence_artifact_ids: Object.freeze([])
    });
  }
  if (providerSupport === "unsupported") {
    return Object.freeze({
      boundary_id: boundaryId,
      observable_id: observableId,
      provider_support: "unsupported",
      provider,
      authenticated: false,
      boundary_kind: boundaryKind,
      observation_mechanism: observationMechanism,
      observation_seam: null,
      status: "review_only",
      limitation: assertCapabilityLimitation(limitation),
      evidence_artifact_ids: Object.freeze([])
    });
  }
  return Object.freeze({
    boundary_id: boundaryId,
    observable_id: observableId,
    provider_support: "supported",
    provider,
    authenticated: authenticated === true,
    boundary_kind: boundaryKind,
    observation_mechanism: observationMechanism,
    observation_seam: observationSeam,
    status: authenticated === true && observed === true ? "proven" : "not_proven",
    limitation: null,
    evidence_artifact_ids: Object.freeze(sortedUnique(artifactIds, "artifactIds"))
  });
}

export function projectFalsifierExecution({
  falsifierId,
  targetVerificationId,
  expectedFailureReasonCode,
  attemptId,
  mutation,
  mutationObserved = false,
  isolated,
  candidateStatus,
  falsifiedStatus,
  observedFailureReasonCode = null,
  limitation = null,
  artifactIds = [],
  provider
} = {}) {
  const declaredMutation = Object.freeze({
    mutation_id: mutation.mutation_id,
    strategy: mutation.strategy,
    mechanism: mutation.mechanism,
    target_kind: mutation.target_kind,
    module_path: mutation.module_path,
    observed: limitation === null && mutationObserved === true
  });

  if (limitation !== null) return Object.freeze({
    falsifier_id: falsifierId,
    attempt_id: attemptId,
    target_verification_id: targetVerificationId,
    provider,
    provider_support: "unsupported",
    isolated: false,
    candidate_status: candidateStatus,
    falsified_status: "not_run",
    failure_reason_code: null,
    mutation: declaredMutation,
    status: "review_only",
    limitation: assertCapabilityLimitation(limitation),
    evidence_artifact_ids: Object.freeze([])
  });
  const detected = isolated === true && mutationObserved === true &&
    candidateStatus === "passed" && falsifiedStatus === "failed" &&
    typeof expectedFailureReasonCode === "string" && expectedFailureReasonCode !== "" &&
    observedFailureReasonCode === expectedFailureReasonCode;
  const executionError = candidateStatus === "skipped" || falsifiedStatus === "skipped";
  return Object.freeze({
    falsifier_id: falsifierId,
    attempt_id: attemptId,
    target_verification_id: targetVerificationId,
    provider,
    provider_support: "supported",
    isolated: isolated === true,
    candidate_status: candidateStatus,
    falsified_status: falsifiedStatus,
    failure_reason_code: observedFailureReasonCode,
    mutation: declaredMutation,
    status: detected ? "detected" : executionError ? "execution_error" : "not_detected",
    limitation: null,
    evidence_artifact_ids: Object.freeze(sortedUnique(artifactIds, "artifactIds"))
  });
}

function identityEvidenceId(evidenceWithoutId) {
  return `test-proof-evidence-${createHash("sha256")
    .update(canonicalTestProofEvidenceJson(evidenceWithoutId), "utf8").digest("hex")}`;
}

function executionAttemptId(evidenceIdentity, role, identity) {
  return `attempt-${createHash("sha256").update(canonicalTestProofEvidenceJson({
    run_id: evidenceIdentity.run_id, attempt: evidenceIdentity.attempt, role, identity
  })).digest("hex")}`;
}

function publicArtifact(artifact) {
  if (!isObject(artifact) || artifact.owner !== "launcher" ||
      typeof artifact.artifact_id !== "string" || typeof artifact.digest !== "string") {
    fail("test_proof_artifact_untrusted", "runtime artifacts must be launcher-created");
  }
  return Object.freeze({ artifact_id: artifact.artifact_id, kind: artifact.kind,
    digest: artifact.digest, owner: "launcher",
    payload: Object.freeze(structuredClone(artifact.payload)) });
}

export function buildTestProofRuntimeEvidence({
  evidenceIdentity,
  contractBinding,
  executionResult,
  testInventory,
  boundaryTraversals,
  falsifierExecutions,
  capabilityLimitations = [],
  observedShortcuts = [],
  artifacts = []
} = {}) {
  if (!isObject(evidenceIdentity) || Object.hasOwn(evidenceIdentity, "evidence_id")) {
    fail("test_proof_evidence_identity_invalid", "evidence identity must omit the derived evidence_id");
  }
  const body = canonicalize({
    schema_version: TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2,
    test_proof_version: TEST_PROOF_VERSION_V1,
    authority: TEST_PROOF_ATTEMPT_AUTHORITY,
    evidence_identity: evidenceIdentity,
    contract_binding: contractBinding,
    execution_result: executionResult,
    test_inventory: testInventory,
    boundary_traversals: boundaryTraversals,
    falsifier_executions: falsifierExecutions,
    capability_limitations: projectCapabilityLimitations(capabilityLimitations),
    observed_shortcuts: sortedUnique(observedShortcuts, "observedShortcuts"),
    artifacts: [...artifacts].sort((left, right) => left.artifact_id.localeCompare(right.artifact_id))
  });
  const evidence = canonicalize({
    ...body,
    evidence_identity: {
      evidence_id: identityEvidenceId(body),
      ...body.evidence_identity
    }
  });
  const validation = validateTestProofRuntimeEvidenceV2(evidence);
  if (validation.valid !== true) {
    fail("test_proof_runtime_evidence_invalid",
      `runtime evidence does not satisfy the package-owned schema: ${JSON.stringify(validation)}`,
      validation);
  }
  return Object.freeze({
    schema_version: TEST_PROOF_ATTEMPT_SCHEMA_VERSION,
    evidence: Object.freeze(evidence),
    evidence_digest: digestTestProofEvidence(evidence),
    semantic_judgment: "not_performed_coordinator_owned",
    advisory: true,
    admission_effect: "none",
    dispatch_effect: "none",
    review_effect: "none",
    integration_effect: "none",
    closure_effect: "none",
    publication_effect: "none"
  });
}

export function projectTestProofRuntimeEvidenceReceipt(attempt) {
  if (!isObject(attempt) || attempt.schema_version !== TEST_PROOF_ATTEMPT_SCHEMA_VERSION ||
      typeof attempt.evidence_digest !== "string" || !isObject(attempt.evidence)) {
    fail("test_proof_receipt_projection_invalid", "a validated test-proof attempt is required");
  }
  const validation = validateTestProofRuntimeEvidenceV2(attempt.evidence);
  if (validation.valid !== true) {
    fail("test_proof_receipt_projection_invalid",
      `runtime evidence does not satisfy the package-owned schema: ${JSON.stringify(validation)}`,
      validation);
  }
  if (attempt.evidence_digest !== digestTestProofEvidence(attempt.evidence)) {
    fail("test_proof_receipt_projection_digest_mismatch",
      "test-proof attempt evidence does not reproduce its authenticated digest");
  }
  return Object.freeze({
    schema_version: "workspace-agent-test-proof-evidence-receipt.v1",
    evidence_digest: attempt.evidence_digest,
    authority: TEST_PROOF_ATTEMPT_AUTHORITY,
    evidence_identity: Object.freeze(structuredClone(attempt.evidence.evidence_identity)),
    contract_binding: Object.freeze(structuredClone(attempt.evidence.contract_binding)),
    execution_result: Object.freeze(structuredClone(attempt.evidence.execution_result)),
    selected_test_id: attempt.evidence.test_inventory.selected_test_id,
    observed_test_count: attempt.evidence.test_inventory.discovered_test_ids.length,
    selected_test_executed: attempt.evidence.test_inventory.executed_test_ids.includes(
      attempt.evidence.test_inventory.selected_test_id),
    falsifier_statuses: Object.freeze(attempt.evidence.falsifier_executions.map(
      ({ falsifier_id, status, provider_support, provider }) => ({ falsifier_id, status,
        provider_support, provider: structuredClone(provider) })
    )),
    traversal_statuses: Object.freeze(attempt.evidence.boundary_traversals.map(
      ({ boundary_id, observable_id, status, provider }) => ({ boundary_id,
        observable_id, status, provider: structuredClone(provider) })
    )),
    capability_limitations: Object.freeze(
      structuredClone(attempt.evidence.capability_limitations)),
    semantic_judgment: "not_performed_coordinator_owned",
    advisory: true,
    authority_effect: "none"
  });
}

function selectedTestIdentity(trusted, evidenceIdentity, mismatchDetail) {
  if (!isObject(evidenceIdentity) || typeof evidenceIdentity.test_id !== "string" ||
      evidenceIdentity.test_id === "") {
    fail("test_proof_test_identity_invalid",
      "launcher-bound evidence identity must provide a test_id");
  }
  if (trusted.selected_test?.test_id !== evidenceIdentity.test_id) {
    fail("test_proof_bound_identity_mismatch",
      "launcher-bound evidence identity is not the declaratively selected test",
      mismatchDetail);
  }
  return evidenceIdentity.test_id;
}

export function observeLauncherNativeTestProofRun({ protocolText, exitCode, expectation,
  reporterProtocolOverflow = false } = {}) {
  if (expectation?.family_id === undefined || expectation.family_id === "pytest") {
    return observeLauncherPytestRun({ protocolText, exitCode, expectation, reporterProtocolOverflow });
  }
  return projectNativeObservation({ channelBytes: Buffer.from(String(protocolText ?? ""), "utf8"),
    channelOverflow: reporterProtocolOverflow, exitCode, expectation });
}

export function acceptLauncherNativeTestProofObservation(input = {}) {
  const observation = observeLauncherNativeTestProofRun(input);
  if (observation?.valid !== true) fail("test_proof_native_observation_refused",
    "native observation population is not authentic complete selected-test evidence",
    { observation_code: observation?.code ?? "test_proof_structured_observation_invalid" });
  return observation;
}

function budgetInterruptionRun(executionBudget) {
  const interruption = executionBudget?.interruption?.() ?? null;
  return interruption === null ? null : {
    ran: false, disposition: "not_run", exit_code: null, signal: null,
    timed_out: interruption === "timed_out",
    blocker_code: interruption === "timed_out"
      ? "test_proof_execution_timed_out" : "test_proof_execution_cancelled",
    output_truncated: false, output_elided_bytes: 0
  };
}

export async function executeTestProofAttempt({ context, executionBudget = undefined } = {}) {
  const supplied = arguments[0] ?? {};
  for (const key of ["executeCandidate", "executeFalsifier", "executor", "callback",
    "executable", "command", "argv", "shell", "module", "artifacts", "artifact",
    "environment", "env"]) if (Object.hasOwn(supplied, key)) {
    fail("test_proof_caller_executor_forbidden",
      `caller-supplied test-proof execution authority is forbidden: ${key}`);
  }
  if (Object.hasOwn(supplied, "inventoryInput")) fail(
    "test_proof_caller_inventory_forbidden",
    "caller-supplied inventory population is forbidden");
  for (const field of ["declaredTestIds", "baselineId", "baselineExecutedTestIds",
    "baselineSkippedTestIds", "observedTestIds", "executedTestIds", "skippedTestIds"]) {
    if (Object.hasOwn(supplied, field)) fail(
      "test_proof_caller_inventory_forbidden",
      `caller-supplied inventory population is forbidden: ${field}`);
  }
  for (const key of Object.keys(supplied)) if (key !== "context" && key !== "executionBudget") fail(
    "test_proof_caller_identity_forbidden",
    `caller-supplied test-proof identity or execution input is forbidden: ${key}`
  );
  const trusted = assertLauncherTestProofAttemptContext(context);
  assertLauncherTestProofSourceSnapshotCurrent(trusted);
  const evidenceIdentity = trusted.evidence_identity;
  const contractBinding = trusted.contract_binding;
  const testProofBinding = trusted.test_proof_binding;
  const authority = trusted.authority;
  const target = trusted.target;
  const authorizedTargets = trusted.authorized_targets;
  const falsifierInputs = testProofBinding.falsifiers.map(
    ({ falsifier_id: falsifierId }) => ({ falsifierId })
  );

  const providers = resolveTestProofProviders(testProofBinding);
  const capabilityLimitations = [];
  if (providers.falsification.mode === "registry_unsupported") {
    capabilityLimitations.push({ check_kind: "falsifier", check_id: null,
      ...authenticateUnsupportedTestProofFalsification(testProofBinding.falsification_provider) });
  }
  const assertBudgetOpen = (stage) => {
    const interrupted = budgetInterruptionRun(executionBudget);
    if (interrupted !== null) fail(`test_proof_${stage}_execution_error`,
      "the invocation execution budget interrupted this proof attempt",
      providerExecutionFailureDetail(trusted, stage, interrupted));
  };
  const preparationBase = { authority, target, authorizedTargets,
    selectedTest: trusted.selected_test,
    ...(executionBudget === undefined ? {} : { executionBudget }) };
  assertBudgetOpen("candidate");
  const prepared = await prepareLauncherTestProofProviderRuntime(providers.candidate, preparationBase);
  let nativeDependencies = null;
  if (prepared !== null) {
    if (prepared.status !== "prepared") fail("test_proof_candidate_execution_error",
      "launcher-owned native provider preparation did not complete",
      providerExecutionFailureDetail(trusted, "candidate", prepared.run));
    nativeDependencies = bindLauncherNativeRuntimeInputs({ context: trusted,
      runtimeInputs: prepared.runtime });
  }
  const executionBase = prepared === null ? preparationBase
    : { ...preparationBase, preparedRuntime: prepared };
  const assertNativeInputsCurrent = () => {
    if (nativeDependencies !== null) {
      assertLauncherNativeRuntimeInputsCurrent(nativeDependencies, prepared.runtime);
    }
  };
  assertBudgetOpen("candidate");
  const candidate = await executeLauncherTestProofProvider(
    providers.candidate, executionBase
  );
  const candidateIdentityFailure = selectedIdentityNotObservedDetail(
    trusted, "candidate", candidate.run
  );
  if (candidateIdentityFailure !== null) fail(
    "test_proof_selected_identity_not_observed",
    "launcher-owned candidate did not observe the selected runtime test identity",
    candidateIdentityFailure
  );
  if (candidate.status === "error") fail("test_proof_candidate_execution_error",
    "launcher-owned candidate observation did not complete",
    providerExecutionFailureDetail(trusted, "candidate", candidate.run));
  if (!isObject(candidate.test_inventory)) fail("test_proof_candidate_inventory_missing",
    "launcher-owned candidate events did not yield a complete test inventory");
  const launcherArtifacts = [...candidate.artifacts];
  const falsifierExecutions = [];
  for (const falsifier of [...falsifierInputs].sort((a, b) => a.falsifierId.localeCompare(b.falsifierId))) {
    const association = providers.falsifiers.find(
      ({ falsifier_id: falsifierId }) => falsifierId === falsifier.falsifierId
    );
    if (!association) fail("test_proof_falsifier_provider_missing",
      "every falsifier execution requires one resolved provider association",
      { falsifier_id: falsifier.falsifierId });
    assertBudgetOpen("falsifier");
    assertNativeInputsCurrent();
    const result = await executeLauncherTestProofProvider(association.provider, {
      ...executionBase
    });
    const falsifierIdentityFailure = selectedIdentityNotObservedDetail(
      trusted, "falsifier", result.run
    );
    if (falsifierIdentityFailure !== null) fail(
      "test_proof_selected_identity_not_observed",
      "launcher-owned falsifier did not observe the selected runtime test identity",
      falsifierIdentityFailure
    );
    const providerSelection = association.provider.selection;
    const falsifierProjection = {
      ...falsifier,
      attemptId: executionAttemptId(evidenceIdentity, "falsifier", falsifier.falsifierId),
      targetVerificationId: testProofBinding.verification_claim_id,
      candidateStatus: candidate.selected_status,
      mutation: { ...providerSelection.mutation, strategy: providerSelection.strategy },
      provider: result.provider
    };

    if (result.limitation !== null) {
      capabilityLimitations.push({ check_kind: "falsifier", check_id: falsifier.falsifierId,
        ...result.limitation });
      falsifierExecutions.push(projectFalsifierExecution({ ...falsifierProjection,
        limitation: result.limitation }));
      continue;
    }
    if (result.status === "skipped") fail("test_proof_falsifier_execution_error",
      "launcher-owned falsifier observation did not complete",
      providerExecutionFailureDetail(trusted, "falsifier", result.run));
    launcherArtifacts.push(...result.artifacts);
    falsifierExecutions.push(projectFalsifierExecution({
      ...falsifierProjection,
      isolated: result.isolated,
      falsifiedStatus: result.status,
      expectedFailureReasonCode: providerSelection.failure_reason_code,
      observedFailureReasonCode: result.failure_reason_code,
      mutationObserved: result.mutation_observed,
      artifactIds: result.artifacts.map(({ artifact_id: id }) => id)
    }));
  }
  let traversalResult;
  if (providers.traversal.mode === "registry_unsupported") {
    traversalResult = authenticateUnsupportedTestProofTraversal(testProofBinding.traversal_provider);
  } else {
    assertBudgetOpen("traversal");
    assertNativeInputsCurrent();
    traversalResult = await executeLauncherTestProofProvider(providers.traversal.provider, {
      ...executionBase
    });
    const traversalIdentityFailure = selectedIdentityNotObservedDetail(
      trusted, "traversal", traversalResult.run
    );
    if (traversalIdentityFailure !== null) fail(
      "test_proof_selected_identity_not_observed",
      "launcher-owned traversal did not observe the selected runtime test identity",
      traversalIdentityFailure
    );
    if (traversalResult.limitation !== null) {
      capabilityLimitations.push({ check_kind: "traversal",
        check_id: testProofBinding.system_under_test_boundary.boundary_id,
        ...traversalResult.limitation });
    } else if (traversalResult.run?.test_proof_observation?.valid !== true) fail(
      "test_proof_traversal_execution_error",
      "launcher-owned traversal observation did not complete",
      providerExecutionFailureDetail(trusted, "traversal", traversalResult.run)
    );
    else launcherArtifacts.push(...traversalResult.artifacts);
  }
  assertLauncherTestProofSourceSnapshotCurrent(trusted);
  const mismatchDetail = boundIdentityMismatchDetail(
    candidate, evidenceIdentity.test_id, target
  );
  const selectedTestId = selectedTestIdentity(trusted, evidenceIdentity, mismatchDetail);
  const testInventory = projectTestProofInventory({
    selectedTestId,
    observedTestIds: candidate.test_inventory.observed_test_ids,
    executedTestIds: candidate.test_inventory.executed_test_ids,
    skippedTestIds: candidate.test_inventory.skipped_test_ids
  });
  if (!testInventory.discovered_test_ids.includes(evidenceIdentity.test_id)) fail(
    "test_proof_selected_identity_not_observed",
    "launcher provider events did not observe the launcher-bound evidence identity",
    mismatchDetail);
  return buildTestProofRuntimeEvidence({
    evidenceIdentity,
    contractBinding,
    executionResult: { status: candidate.status, exit_code: candidate.exit_code ?? null,
      attempt_id: executionAttemptId(evidenceIdentity, "candidate", target),
      structured_result: candidate.structured_result,
      evidence_artifact_ids: candidate.artifacts.map(({ artifact_id: id }) => id),
      provider: candidate.provider },
    testInventory,
    boundaryTraversals: [projectBoundaryTraversal({
      boundaryId: testProofBinding.system_under_test_boundary.boundary_id,
      observableId: testProofBinding.observable_result.observable_id,
      providerSupport: traversalResult.providerSupport,
      authenticated: traversalResult.authenticated,
      observed: traversalResult.observed,
      artifactIds: traversalResult.artifacts.map(({ artifact_id: id }) => id),
      boundaryKind: traversalResult.boundary_kind,
      observationMechanism: traversalResult.observation_mechanism,
      observationSeam: traversalResult.observation_seam,
      limitation: traversalResult.limitation ?? null,
      provider: traversalResult.provider,
      providerAttestation: providers.traversal.mode === "registry_unsupported"
        ? traversalResult : undefined
    })],
    falsifierExecutions,
    capabilityLimitations,
    observedShortcuts: candidate.observed_shortcuts ?? [],
    artifacts: [...new Map(launcherArtifacts.map(
      (artifact) => [artifact.artifact_id, artifact]
    )).values()].map(publicArtifact)
  });
}
