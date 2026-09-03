import { createHash } from "node:crypto";

import {
  TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2,
  TEST_PROOF_VERSION_V1,
  projectStableTestProofCurrentPopulation,
  validateTestProofRuntimeEvidenceV2
} from "@agent-chassis/controlled-contract";
import {
  authenticateUnsupportedTestProofTraversal,
  assertRegistryUnsupportedTraversalAttestation,
  executeLauncherTestProofProvider,
  resolveTestProofProviders
} from "./workspace-agent-test-proof-provider-registry.mjs";
import {
  assertLauncherTestProofAttemptContext,
  assertLauncherTestProofSourceSnapshotCurrent
} from "./workspace-agent-test-proof-runtime-identity.mjs";
import { stableRuntimeTestId as deriveStableRuntimeTestId } from
  "./workspace-agent-test-proof-node-reporter.mjs";

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

function providerExecutionFailureDetail(trusted, executionStage, run) {
  return {
    execution_stage: executionStage,
    test_proof_id: trusted.test_proof_binding.test_proof_id,
    verification_id: trusted.evidence_identity.verification_id,
    run
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
    ...observation.detail
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const STABLE_TEST_ID_RE = /^test-[a-f0-9]{64}$/u;
const MAX_BOUND_IDENTITY_CANDIDATES = 8;

function safeRelativeTestFile(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !value.includes("\\") && !pathIsAbsolute(value) && value.split("/").every(
      (part) => part !== "" && part !== "." && part !== ".." &&
        /^[A-Za-z0-9_.-]+$/u.test(part)
    );
}

function pathIsAbsolute(value) {
  return value.startsWith("/");
}

function boundedIdentityCandidate(event) {
  if (!isObject(event) || !STABLE_TEST_ID_RE.test(event.test_id) ||
      !safeRelativeTestFile(event.file) || typeof event.name !== "string" ||
      event.name.length === 0 || event.name.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(event.name) ||
      !Number.isSafeInteger(event.nesting) || event.nesting < 0 ||
      event.nesting > 1_000_000) return null;
  return {
    test_id: event.test_id,
    file: event.file,
    name: event.name,
    nesting: event.nesting
  };
}

function boundIdentityMismatchDetail(candidate, expectedTestId, target) {
  const structured = candidate?.structured_result;
  const events = isObject(structured)
    ? [...(Array.isArray(structured.pass_events) ? structured.pass_events : []),
        ...(Array.isArray(structured.fail_events) ? structured.fail_events : [])]
    : [];
  const projected = events.map(boundedIdentityCandidate).filter((value) => value !== null)
    .sort((left, right) =>
      Number(right.file === target) - Number(left.file === target) ||
      left.file.localeCompare(right.file) || left.nesting - right.nesting ||
      left.name.localeCompare(right.name) || left.test_id.localeCompare(right.test_id)
    ).slice(0, MAX_BOUND_IDENTITY_CANDIDATES);
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

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

export function compareTestProofInventories({
  baselineId,
  declaredTestIds,
  baselineExecutedTestIds,
  baselineSkippedTestIds = [],
  observedTestIds,
  executedTestIds,
  skippedTestIds,
  declaredRenames = [],
  coverageDispositions = []
} = {}) {
  const declared = sortedUnique(declaredTestIds, "declaredTestIds");
  const baselineExecuted = sortedUnique(baselineExecutedTestIds, "baselineExecutedTestIds");
  const baselineSkipped = sortedUnique(baselineSkippedTestIds, "baselineSkippedTestIds");
  const observed = sortedUnique(observedTestIds, "observedTestIds");
  const executed = sortedUnique(executedTestIds, "executedTestIds");
  const skipped = sortedUnique(skippedTestIds, "skippedTestIds");
  if (typeof baselineId !== "string" || baselineId === "") {
    fail("test_proof_inventory_invalid", "baselineId must be a nonempty identity");
  }
  const observedSet = new Set(observed);
  for (const id of [...executed, ...skipped]) {
    if (!observedSet.has(id)) fail("test_proof_inventory_invalid", "executed and skipped identities must be observed", { test_id: id });
  }
  const renameByBaseline = new Map();
  const renameObserved = new Set();
  for (const rename of declaredRenames) {
    if (!isObject(rename) || typeof rename.baseline_test_id !== "string" ||
        typeof rename.observed_test_id !== "string" || renameByBaseline.has(rename.baseline_test_id) ||
        renameObserved.has(rename.observed_test_id)) {
      fail("test_proof_rename_invalid", "declared rename identities must be unique pairs");
    }
    renameByBaseline.set(rename.baseline_test_id, rename.observed_test_id);
    renameObserved.add(rename.observed_test_id);
  }
  const baselinePopulation = [...new Set([...baselineExecuted, ...baselineSkipped])].sort();
  const renamed = baselinePopulation.filter((id) => {
    const replacement = renameByBaseline.get(id);
    return replacement !== undefined && !observedSet.has(id) && observedSet.has(replacement);
  }).map((id) => ({ baseline_test_id: id, observed_test_id: renameByBaseline.get(id) }));
  const renamedBaseline = new Set(renamed.map(({ baseline_test_id: id }) => id));
  const removed = difference(baselinePopulation, observed).filter((id) => !renamedBaseline.has(id));
  const declaredSet = new Set(declared);
  const unexpected = observed.filter((id) => !declaredSet.has(id) && !renameObserved.has(id));
  const baselineSkippedSet = new Set(baselineSkipped);
  const newlySkipped = skipped.filter((id) => !baselineSkippedSet.has(id));
  const dispositionSet = new Set(sortedUnique(coverageDispositions, "coverageDispositions"));
  const changedCoverage = [...new Set([...removed, ...renamed.map((entry) => entry.baseline_test_id), ...newlySkipped])].sort();
  const undispositioned = changedCoverage.filter((id) => !dispositionSet.has(id));
  return Object.freeze({
    baseline_id: baselineId,
    declared_test_ids: Object.freeze(declared),
    discovered_test_ids: Object.freeze(observed),
    executed_test_ids: Object.freeze(executed),
    skipped_test_ids: Object.freeze(skipped),
    removed_baseline_test_ids: Object.freeze(removed),
    renamed_baseline_tests: Object.freeze(renamed),
    unexpected_test_ids: Object.freeze(unexpected),
    newly_skipped_test_ids: Object.freeze(newlySkipped),
    undispositioned_coverage_test_ids: Object.freeze(undispositioned)
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
  provider,
  providerAttestation
} = {}) {
  if (providerSupport !== "supported" && providerSupport !== "unsupported") {
    fail("test_proof_traversal_provider_invalid", "provider support must be supported or unsupported");
  }
  if (providerSupport === "unsupported") {
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
  artifactIds = [],
  provider
} = {}) {
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
    isolated: isolated === true,
    candidate_status: candidateStatus,
    falsified_status: falsifiedStatus,
    failure_reason_code: observedFailureReasonCode,
    mutation: Object.freeze({
      mutation_id: mutation.mutation_id,
      strategy: mutation.strategy,
      mechanism: mutation.mechanism,
      target_kind: mutation.target_kind,
      module_path: mutation.module_path,
      observed: mutationObserved === true
    }),
    status: detected ? "detected" : executionError ? "execution_error" : "not_detected",
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
    inventory_change_count:
      attempt.evidence.test_inventory.removed_baseline_test_ids.length +
      attempt.evidence.test_inventory.renamed_baseline_tests.length +
      attempt.evidence.test_inventory.unexpected_test_ids.length +
      attempt.evidence.test_inventory.newly_skipped_test_ids.length +
      attempt.evidence.test_inventory.undispositioned_coverage_test_ids.length,
    falsifier_statuses: Object.freeze(attempt.evidence.falsifier_executions.map(
      ({ falsifier_id, status, provider }) => ({ falsifier_id, status,
        provider: structuredClone(provider) })
    )),
    traversal_statuses: Object.freeze(attempt.evidence.boundary_traversals.map(
      ({ boundary_id, observable_id, status, provider }) => ({ boundary_id,
        observable_id, status, provider: structuredClone(provider) })
    )),
    semantic_judgment: "not_performed_coordinator_owned",
    advisory: true,
    authority_effect: "none"
  });
}

function deriveCanonicalTestInventory(testProofBinding, evidenceIdentity, mismatchDetail) {
  const disposition = testProofBinding?.coverage_disposition;
  if (!isObject(disposition) || !Array.isArray(disposition.items) ||
      typeof disposition.baseline_id !== "string" || disposition.baseline_id === "") {
    fail("test_proof_inventory_binding_invalid",
      "package-validated coverage disposition is required for inventory authority");
  }
  if (!isObject(evidenceIdentity) || typeof evidenceIdentity.test_id !== "string" ||
      evidenceIdentity.test_id === "") {
    fail("test_proof_test_identity_invalid",
      "launcher-bound evidence identity must provide a test_id");
  }
  const baselineExecutedTestIds = disposition.baseline_state === "complete_executed_inventory"
    ? disposition.items.map(({ test_id: testId }) => testId)
    : [];
  const baselineSkippedTestIds = [];
  const declaredTestIds = projectStableTestProofCurrentPopulation(testProofBinding);
  if (!declaredTestIds.includes(evidenceIdentity.test_id)) {
    fail("test_proof_bound_identity_mismatch",
      "launcher-bound evidence identity is not in the canonical declared inventory",
      mismatchDetail);
  }
  return { baselineId: disposition.baseline_id, declaredTestIds,
    baselineExecutedTestIds, baselineSkippedTestIds };
}

export async function executeTestProofAttempt({ context } = {}) {
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
  for (const key of Object.keys(supplied)) if (key !== "context") fail(
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
  if (falsifierInputs.length === 0) fail(
    "test_proof_falsifiers_required", "at least one declared falsifier is required"
  );
  const providers = resolveTestProofProviders(testProofBinding);
  const executionBase = { authority, target, authorizedTargets,
    targetTestId: evidenceIdentity.test_id };
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
    if (result.status === "skipped") fail("test_proof_falsifier_execution_error",
      "launcher-owned falsifier observation did not complete",
      providerExecutionFailureDetail(trusted, "falsifier", result.run));
    launcherArtifacts.push(...result.artifacts);
    const providerSelection = association.provider.selection;
    falsifierExecutions.push(projectFalsifierExecution({
      ...falsifier,
      attemptId: executionAttemptId(evidenceIdentity, "falsifier", falsifier.falsifierId),
      targetVerificationId: testProofBinding.verification_claim_id,
      isolated: result.isolated,
      candidateStatus: candidate.selected_status,
      falsifiedStatus: result.status,
      expectedFailureReasonCode: providerSelection.failure_reason_code,
      observedFailureReasonCode: result.failure_reason_code,
      mutation: { ...providerSelection.mutation, strategy: providerSelection.strategy },
      mutationObserved: result.mutation_observed,
      artifactIds: result.artifacts.map(({ artifact_id: id }) => id),
      provider: result.provider
    }));
  }
  let traversalResult;
  if (providers.traversal.mode === "registry_unsupported") {
    traversalResult = authenticateUnsupportedTestProofTraversal(testProofBinding.traversal_provider);
  } else {
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
    if (traversalResult.run?.test_proof_observation?.valid !== true) fail(
      "test_proof_traversal_execution_error",
      "launcher-owned traversal observation did not complete",
      providerExecutionFailureDetail(trusted, "traversal", traversalResult.run)
    );
    launcherArtifacts.push(...traversalResult.artifacts);
  }
  assertLauncherTestProofSourceSnapshotCurrent(trusted);
  const mismatchDetail = boundIdentityMismatchDetail(
    candidate, evidenceIdentity.test_id, target
  );
  const canonicalInventory = deriveCanonicalTestInventory(
    testProofBinding, evidenceIdentity, mismatchDetail
  );
  const testInventory = compareTestProofInventories({
    ...canonicalInventory,
    observedTestIds: candidate.test_inventory.observed_test_ids,
    executedTestIds: candidate.test_inventory.executed_test_ids,
    skippedTestIds: candidate.test_inventory.skipped_test_ids,
    coverageDispositions: testProofBinding.coverage_disposition.items.map(
      ({ test_id: testId }) => testId
    )
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
      provider: traversalResult.provider,
      providerAttestation: providers.traversal.mode === "registry_unsupported"
        ? traversalResult : undefined
    })],
    falsifierExecutions,
    observedShortcuts: candidate.observed_shortcuts ?? [],
    artifacts: [...new Map(launcherArtifacts.map(
      (artifact) => [artifact.artifact_id, artifact]
    )).values()].map(publicArtifact)
  });
}
