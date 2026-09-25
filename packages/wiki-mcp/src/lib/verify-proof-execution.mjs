import { buildNotExecutableProofVerificationResult, buildProofVerificationResult, canonicalProofVerificationDigest } from "../../../controlled-contract/lib/proof-obligation-runtime-resolver.mjs";
import { evaluateTestProofEvidenceSemantics } from "../../../controlled-contract/lib/test-proof-evidence-semantic-kernel.mjs";
import { VerifyProofOperationError, parseVerifyProofTimeout, resolveVerifyProofOperation } from "../../../wiki-core/src/operations/controlled-contract/verify-proof-operations.mjs";
import { executeLauncherVerifyProofReceiptPopulation } from "../../../agent-launch-cli/src/lib/workspace-agent-verify-proof-capability.mjs";
import { deriveLauncherTestProofRuntimeTestIdentity, mintLauncherTestProofAttemptContext } from "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import { mintTestProofExecutionBudget, runWorkspaceAgentTestProofAttempt } from "../../../agent-launch-cli/src/lib/workspace-agent-validation-runner.mjs";
import { validateTestProofEnvironmentSelection } from "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-provider-registry.mjs";
import { extractTestProofRuntimeEvidenceReceipt } from "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import { captureDiagnosticEvidence } from "../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { VERIFY_PROOF_TOOL_NAME, projectProofAuthoringRecoveryCall, projectObservedEvidence,
  projectVerifyProofFailure, verifyProofFailureContinuationFacts } from "./verify-proof-public-result.mjs";

const VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION = "workspace-verify-proof-aggregate.v1";
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const STABLE_CODE_RE = /^[a-z0-9_.-]{1,160}$/u;

const EXECUTION_INTERRUPTIONS = Object.freeze({
  timed_out: Object.freeze({
    interrupted: "verify_proof.execution_timed_out.v1",
    unstarted: "verify_proof.execution_budget_exhausted_before_start.v1",
    action: "retry_with_a_larger_timeout_or_a_narrower_subject"
  }),
  cancelled: Object.freeze({
    interrupted: "verify_proof.execution_cancelled.v1",
    unstarted: "verify_proof.execution_cancelled_before_start.v1",
    action: "retry_the_cancelled_invocation_when_needed"
  })
});

const DEFINITION_BLOCKER_ACTIONS = Object.freeze({
  "verify_proof.test_selector_invalid.v1":
    "author_a_valid_declarative_test_selector_then_retry"
});

function aggregateStatus(statuses) {
  if (!statuses.length) return "not_executable";
  if (statuses.includes("unsatisfied")) return "unsatisfied";
  if (statuses.includes("not_executable")) return "not_executable";
  return "satisfied";
}

function aggregateResult({ resolution, runtime, proofResults, reasonCode = null,
  diagnostics = [], requestedEnvironment = null }) {
  const statuses = proofResults.map(({ status }) => status);
  const status = reasonCode === null ? aggregateStatus(statuses) : "not_executable";
  const counts = {
    proofs: proofResults.length,
    relationships: proofResults.reduce((total, proof) =>
      total + proof.relationship_results.length, 0),
    satisfied: proofResults.filter((proof) => proof.status === "satisfied").length,
    unsatisfied: proofResults.filter((proof) => proof.status === "unsatisfied").length,
    not_executable: proofResults.filter((proof) => proof.status === "not_executable").length,
    ready: proofResults.filter((proof) => proof.readiness_status === "ready").length,
    nonready: proofResults.filter((proof) => proof.readiness_status === "not_ready").length,
    execution_not_started: proofResults.filter(
      (proof) => proof.execution_status === "not_started"
    ).length
  };
  const body = {
    schema_version: VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION,
    status,
    authority: "non_authoritative",
    ...(status === "not_executable" ? { authority_limb: "mechanical_failure" } : {}),
    execution_source_binding: resolution.execution_source_binding ?? null,
    source_detail_entitlement: runtime?.role === "orchestrator" ? "repository" : "selected_unit",
    advisory: true,
    subject: structuredClone(resolution.subject),
    resolved_unit: resolution.wk_id,
    contract_generation: resolution.contract_generation,
    contract_digest: resolution.contract_digest ?? null,
    subject_binding: runtime?.candidateIdentity ?? null,

    requested_environment: requestedEnvironment,
    reason_code: reasonCode,
    diagnostics: structuredClone(diagnostics),
    counts,
    proof_results: structuredClone(proofResults),
    downstream_authority: Object.freeze({ review: false, admission: false,
      closure: false, merge: false, lifecycle: false })
  };
  return Object.freeze({ ...body, result_digest: canonicalProofVerificationDigest(body) });
}

const DEFINITION_REPAIR_REQUIRED_ANSWERS = Object.freeze({
  "verify_proof.test_selector_invalid.v1": Object.freeze({
    "runtime_test.falsifier.select": "one existing falsifier identity from the row's current population",
    "runtime_test.selector": "the exact node:test name and nesting depth inside the unit's bound node_test target, or the exact provider-qualified literal native node identity inside the authored case target"
  })
});

export function projectDefinitionRepairQuestion({ reasonCode, verificationId }) {
  const requiredAnswer = DEFINITION_REPAIR_REQUIRED_ANSWERS[reasonCode];
  if (requiredAnswer === undefined || typeof verificationId !== "string") return undefined;
  return Object.freeze({
    semantic_owner: "saved_obligation_proof",
    capability_status: "semantic_correction_requires_saved_obligation_identity",
    verification_id: verificationId,
    required_meaning: requiredAnswer,
    correction_route: null,
    next_step:
      "Read the saved obligation that owns this verification identity, then amend its semantic proof inputs through workspace_controlled_contract_obligation_coverage_upsert.",
    execution_evidence: "owned_by_workspace_verify_proof"
  });
}

export function buildUnavailableProofResult({ resolution, runtime, proof, blockers = [],
  reasonCode = null, readinessStatus = null, recovery: projectedRecovery = undefined,
  executionStatus = "not_started" } = {}) {
    const blocker = blockers.find((diagnostic) =>
      Object.hasOwn(DEFINITION_BLOCKER_ACTIONS, diagnostic.reason_code)) ?? blockers[0] ?? null;
    const ready = readinessStatus === null ? blocker === null : readinessStatus === "ready";
    const unavailableReason = reasonCode ?? blocker?.reason_code ?? "verify_proof.proof_unavailable.v1";
    const definitionBlocked = Object.hasOwn(DEFINITION_BLOCKER_ACTIONS, unavailableReason);
    const recoveryCall = definitionBlocked
      ? projectProofAuthoringRecoveryCall(blocker?.details?.recovery_call, resolution.wk_id) : null;
    if (definitionBlocked && recoveryCall === null) throw new VerifyProofOperationError(
      "verify_proof.runtime_recovery_projection_invalid.v1",
      "definition recovery must name the ordinary query and server-resolved unit"
    );
    const repair = blocker === null ? undefined : projectDefinitionRepairQuestion({
      reasonCode: unavailableReason, verificationId: proof.verification_id
    });

    const recovery = projectedRecovery === undefined
      ? blocker === null ? undefined : Object.freeze(definitionBlocked ? {
        action: DEFINITION_BLOCKER_ACTIONS[unavailableReason],
        ...(recoveryCall === null ? {} : { recovery_call: recoveryCall }),
        retry_operation: VERIFY_PROOF_TOOL_NAME,
        ...(repair === undefined ? {} : { repair })
      } : {
        action: "repair_the_named_proof_prerequisite",
        condition: unavailableReason,
        subject: Object.freeze({ test_proof_id: proof.test_proof_id,
          verification_id: proof.verification_id }),
        ...(repair === undefined ? {} : { repair })
      }) : structuredClone(projectedRecovery);
    return {
      test_proof_id: proof.test_proof_id, verification_id: proof.verification_id,
      status: "not_executable", readiness_status: ready ? "ready" : "not_ready",
      execution_status: executionStatus, reason_code: unavailableReason,
      ...(recovery === undefined ? {} : { recovery }),
      subject_binding_ref: "aggregate.subject_binding",
      declared_target: proof.declared_target?.status === "resolved" ? structuredClone(proof.declared_target) : null,
      relationship_results: proof.relationships.map((relationship) => ({
        ...buildNotExecutableProofVerificationResult({ obligationId: relationship.obligation_id,
          reasonCode: unavailableReason, diagnostics: blockers }), relation_ids: [...relationship.relation_ids]
      }))
    };
}

function preflightFailureResult(resolution, runtime, requestedEnvironment) {
  const diagnostics = resolution.diagnostics ?? [];
  const proofResults = (resolution.proofs ?? []).map((proof) => {
    const blockers = proof.failure ? [proof.failure] : diagnostics.filter((diagnostic) =>
      diagnostic.test_proof_id === proof.test_proof_id &&
      (!Object.hasOwn(diagnostic, "obligation_id") || proof.relationships.some(
        (relationship) => relationship.obligation_id === diagnostic.obligation_id)));
    return buildUnavailableProofResult({ resolution, runtime, proof, blockers,
      reasonCode: blockers[0]?.reason_code ?? "verify_proof.proof_unavailable.v1" });
  });
  return aggregateResult({ resolution, runtime, proofResults,
    reasonCode: resolution.reason_code, diagnostics, requestedEnvironment });
}

function individualResolution(population, proof, relationship) {
  return {
    status: "executable",
    obligation_id: relationship.obligation_id,
    contract_generation: population.contract_generation,
    contract_digest: population.contract_digest,
    obligation_coverage_digest: population.obligation_coverage_digest,
    schema_version: "controlled-contract-proof-obligation-resolution.v3",
    execution_source_binding: { binding_digest: population.execution_source_binding.binding_digest,
      reference: "aggregate.execution_source_binding" },
    ...(relationship.authored_case ? { authored_case: relationship.authored_case } : {}),
    selected_definition: relationship.selected_definition,
    resolved_node_identity: relationship.resolved_node_identity,
    behavior_claim_ids: relationship.behavior_claim_ids,
    verification_id: proof.verification_id,
    relation_ids: relationship.relation_ids,
    declared_target: proof.declared_target,
    test_proof: proof.test_proof,
    execution_pack: population.execution_pack
  };
}

function subsetSelection(selection, verificationIds) {
  const requested = new Set(verificationIds);
  const bindings = selection.bindings.filter(({ verification_claim_id: id }) =>
    requested.has(id));
  return Object.freeze({
    ...selection,
    requested_count: verificationIds.length,
    matched_count: bindings.length,
    bindings: Object.freeze(bindings)
  });
}

function isSafeVerificationIdentity(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function projectVerificationIdentities(values) {
  const safe = values.filter(isSafeVerificationIdentity).sort();
  return {
    values: safe,
    omitted: 0
  };
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function runtimeBindingFacts(selection, verificationIds, resolution) {
  const bindings = Array.isArray(selection?.bindings) ? selection.bindings : null;
  const rawObserved = bindings === null ? [] : bindings.map((binding) =>
    binding?.verification_claim_id);
  const observedStrings = rawObserved.filter(isSafeVerificationIdentity);
  const expectedSet = new Set(verificationIds);
  const observedSet = new Set(observedStrings);
  const expected = projectVerificationIdentities([...expectedSet]);
  const observed = projectVerificationIdentities([...observedSet]);
  const missing = projectVerificationIdentities([...expectedSet].filter((id) => !observedSet.has(id)));
  const unexpected = projectVerificationIdentities([...observedSet].filter((id) => !expectedSet.has(id)));
  return Object.freeze({
    expected_selection_status: "complete",
    actual_selection_status: typeof selection?.status === "string" &&
      selection.status.length <= 64 && !/[\u0000-\u001f\u007f]/u.test(selection.status)
      ? selection.status : null,
    expected_requested_count: verificationIds.length,
    actual_requested_count: safeCount(selection?.requested_count),
    expected_matched_count: verificationIds.length,
    actual_matched_count: safeCount(selection?.matched_count),
    expected_binding_count: verificationIds.length,
    actual_binding_count: bindings === null ? null : bindings.length,
    expected_unique_verification_identity_count: expectedSet.size,
    actual_unique_verification_identity_count: observedSet.size,
    invalid_verification_identity_count: rawObserved.length - observedStrings.length,
    expected_verification_ids: expected.values,
    expected_verification_ids_omitted: expected.omitted,
    observed_verification_ids: observed.values,
    observed_verification_ids_omitted: observed.omitted,
    missing_verification_ids: missing.values,
    missing_verification_ids_omitted: missing.omitted,
    unexpected_verification_ids: unexpected.values,
    unexpected_verification_ids_omitted: unexpected.omitted,
    expected_contract_content_digest: resolution.contract_digest,
    actual_contract_content_digest: DIGEST_RE.test(selection?.content_digest ?? "")
      ? selection.content_digest : null,
    expected_controlled_contract_generation_digest: resolution.contract_generation,
    actual_controlled_contract_generation_digest:
      DIGEST_RE.test(selection?.controlled_contract_generation ?? "")
        ? selection.controlled_contract_generation : null
  });
}

function failRuntimeBindingInvariant(code, message, facts) {
  throw new VerifyProofOperationError(code, message, facts);
}

function assertCompleteRuntimeSelection(selection, verificationIds, resolution) {
  const facts = runtimeBindingFacts(selection, verificationIds, resolution);
  if (selection?.status !== "complete") failRuntimeBindingInvariant(
    "verify_proof.runtime_binding_selection_status_incomplete.v1",
    "runtime binding selection did not complete", facts
  );
  if (selection.requested_count !== verificationIds.length) failRuntimeBindingInvariant(
    "verify_proof.runtime_binding_requested_count_mismatch.v1",
    "runtime binding selection reported a contradictory requested count", facts
  );
  if (selection.matched_count !== verificationIds.length) failRuntimeBindingInvariant(
    "verify_proof.runtime_binding_matched_count_mismatch.v1",
    "runtime binding selection did not match every requested verification", facts
  );
  if (!Array.isArray(selection.bindings) ||
      selection.bindings.length !== verificationIds.length) failRuntimeBindingInvariant(
    "verify_proof.runtime_binding_count_mismatch.v1",
    "runtime binding selection returned an incomplete binding population", facts
  );
  if (facts.invalid_verification_identity_count > 0 ||
      facts.actual_unique_verification_identity_count !== selection.bindings.length) {
    failRuntimeBindingInvariant(
      "verify_proof.runtime_binding_verification_identity_duplicate.v1",
      "runtime binding selection returned duplicate or invalid verification identities", facts
    );
  }
  if (facts.missing_verification_ids.length > 0 ||
      facts.unexpected_verification_ids.length > 0) failRuntimeBindingInvariant(
    "verify_proof.runtime_binding_verification_identity_unexpected.v1",
    "runtime binding selection returned unexpected verification identities", facts
  );
  if (selection.content_digest !== resolution.contract_digest ||
      selection.derived_contract_digest !== resolution.execution_source_binding.contract_digest) failRuntimeBindingInvariant(
    "verify_proof.runtime_binding_contract_content_digest_mismatch.v1",
    "runtime binding selection contradicts the authenticated contract carrier content", facts
  );
  if (!DIGEST_RE.test(selection.controlled_contract_generation ?? "")) {
    failRuntimeBindingInvariant(
      "verify_proof.runtime_binding_controlled_generation_invalid.v1",
      "runtime binding selection has no authenticated canonical generation digest", facts
    );
  }
  if (selection.controlled_contract_generation !== resolution.contract_generation) {
    failRuntimeBindingInvariant(
      "verify_proof.runtime_binding_controlled_generation_moved.v1",
      "canonical controlled-contract generation moved during proof population binding", facts
    );
  }
}

function interruptedRunFacts(error) {
  const seen = new Set();
  for (let current = error; current && typeof current === "object" && !seen.has(current);
    current = current.cause) {
    seen.add(current);
    const blocker = current.detail?.run?.blocker_code;
    if (typeof blocker === "string" && STABLE_CODE_RE.test(blocker)) {
      const stage = current.detail.execution_stage;
      return { run_blocker_code: blocker,
        ...(["candidate", "falsifier", "traversal"].includes(stage) ? { interrupted_stage: stage } : {}) };
    }
  }
  return {};
}

const BUDGET_INTERRUPTION_CODES = new Set(["test_proof_execution_timed_out",
  "test_proof_execution_cancelled", "test_proof_execution_cleanup_failed",
  "test_proof_native_preparation_interrupted"]);

function budgetInterruptionCause(error) {
  const seen = new Set();
  for (let current = error; current && typeof current === "object" && !seen.has(current);
    current = current.cause) {
    seen.add(current);
    if (BUDGET_INTERRUPTION_CODES.has(current.code) ||
        BUDGET_INTERRUPTION_CODES.has(current.detail?.run?.blocker_code)) return true;
  }
  return false;
}

export async function executeVerifyProofForContext({
  args,
  resolutionContext,
  runtime,
  deps = {},
  signal = null
} = {}) {
  const resolveOperation = deps.resolveVerifyProofOperation ?? resolveVerifyProofOperation;
  if (typeof runtime?.assertCurrentIdentity !== "function") throw new VerifyProofOperationError(
    "verify_proof.currentness_check_unavailable.v1", "Execution requires an invocation-bound currentness check");
  const timeout = parseVerifyProofTimeout(args?.timeout);
  await runtime.assertCurrentIdentity();
  const resolution = resolveOperation({ args, context: resolutionContext });
  const eligible = resolution.eligible ?? (resolution.status === "executable" ? resolution.proofs : []);
  const ineligible = resolution.ineligible ?? (resolution.status === "not_executable" ? resolution.proofs : []);
  if (!eligible.length) {
    await runtime.assertCurrentIdentity();
    return preflightFailureResult(resolution, runtime, args?.environment ?? null);
  }
  const requestedEnvironment = args?.environment ?? null;
  if (requestedEnvironment !== null) {

    const unique = [...new Map(eligible.map((proof) => [proof.execution_key, proof])).values()];
    const checked = (deps.validateEnvironmentSelection ?? validateTestProofEnvironmentSelection)({
      repositoryRoot: runtime.authority.main_repo, checkoutRoot: runtime.authority.worktree_path,
      environment: requestedEnvironment,
      proofs: unique.map((proof) => ({ test_proof_id: proof.test_proof_id,
        obligation_ids: [...new Set(proof.relationships.map(({ obligation_id: id }) => id))].sort(),
        target: proof.declared_target.target, binding: proof.test_proof })) });
    if (!checked.ok) {
      await runtime.assertCurrentIdentity();
      throw new VerifyProofOperationError("verify_proof.environment_incompatible.v1",
        `prepared environment ${requestedEnvironment} cannot run every selected proof`, {
          requested_environment: requestedEnvironment,
          incompatible: structuredClone(checked.incompatible),
          valid_choices: [...checked.valid_choices],
          prepared_environments: [...checked.prepared_environments]
        });
    }
  }
  const verificationIds = [...new Set(eligible.map(({ verification_id: id }) => id))].sort();
  const resolveBindings = deps.resolveBindings ?? runtime.resolveBindings;
  let completeSelection;
  try {
    completeSelection = await resolveBindings({
      repoRoot: runtime.authority.worktree_path,
      wkId: resolution.wk_id,
      focus: resolution.focus ?? null,
      verificationIds
    });
  } catch (error) {
    const packageCode = typeof error?.code === "string" && STABLE_CODE_RE.test(error.code)
      ? error.code : null;
    throw new VerifyProofOperationError(
      "verify_proof.runtime_binding_resolution_failed.v1",
      "internal controlled test-proof binding resolution failed",
      {
        package_code: packageCode,
        operation: "resolve_test_proof_runtime_bindings",
        stage: "runtime_binding_resolution",
        cause_diagnostic: captureDiagnosticEvidence(error)
      },
      { cause: error }
    );
  }
  assertCompleteRuntimeSelection(completeSelection, verificationIds, resolution);

  const budget = mintTestProofExecutionBudget({ timeoutMs: timeout.milliseconds, signal });
  try {
    return await executeResolvedPopulation({ resolution, eligible, ineligible, runtime, deps,
      completeSelection, budget, timeout, requestedEnvironment });
  } finally {
    budget.dispose();
  }
}

async function executeResolvedPopulation({ resolution, eligible, ineligible, runtime, deps,
  completeSelection, budget, timeout, requestedEnvironment }) {
  const evidenceByExecution = new Map();
  const runtimeEnvironmentByExecution = new Map();
  const mintAttemptContext = deps.mintAttemptContext ?? mintLauncherTestProofAttemptContext;

  const unavailableProofs = new Set(ineligible);
  const unavailableResult = (proof) => {
    const blockers = proof.failure ? [proof.failure] : (proof.failure_diagnostics ??
      (resolution.diagnostics ?? []).filter((diagnostic) => diagnostic.test_proof_id === proof.test_proof_id));
    return buildUnavailableProofResult({ resolution, runtime, proof, blockers,
      reasonCode: blockers[0]?.reason_code ?? "verify_proof.proof_unavailable.v1" });
  };
  const attempted = new Set();
  const localUnavailable = new Map();
  const interrupted = new Map();
  const unstarted = new Map();
  for (const proof of eligible) {
    if (attempted.has(proof.execution_key)) continue;
    attempted.add(proof.execution_key);
    const pending = budget.interruption();
    if (pending !== null) {
      unstarted.set(proof.execution_key, pending);
      continue;
    }
    await runtime.assertCurrentIdentity();
    const target = proof.declared_target.target;
    try {
      const executed = await (deps.executeLauncherVerifyProofReceiptPopulation ??
        executeLauncherVerifyProofReceiptPopulation)({
      roleContext: { role: runtime.role, managed: runtime.role !== "orchestrator",
        candidate_identity: runtime.executionAuthorityIdentity ?? runtime.candidateIdentity },
      proofAuthority: runtime.authority, targets: [target],
      validationBindings: { [target]: [proof.verification_id] },
      resolveBindings: async ({ verificationIds: requested }) => subsetSelection(completeSelection, requested),
      mintAttemptContext: requestedEnvironment === null ? mintAttemptContext
        : (input) => mintAttemptContext({ ...input, environment: requestedEnvironment }),
      runAttempt: ({ context }) => (deps.runAttempt ?? runWorkspaceAgentTestProofAttempt)({
        context, executionBudget: budget }),
      extractReceipt: deps.extractReceipt ?? extractTestProofRuntimeEvidenceReceipt,
      assertCurrentIdentity: runtime.assertCurrentIdentity
    });
      evidenceByExecution.set(proof.execution_key, executed.evidence_by_target[target] ?? []);
      runtimeEnvironmentByExecution.set(proof.execution_key,
        executed.runtime_environments_by_target?.[target]?.[0] ?? null);
      await runtime.assertCurrentIdentity();
    } catch (error) {

      const interruption = budget.interruption();
      if (interruption !== null && !evidenceByExecution.has(proof.execution_key) &&
          budgetInterruptionCause(error)) {

        interrupted.set(proof.execution_key, { interruption, ...interruptedRunFacts(error),
          evidence: captureDiagnosticEvidence(error) });
        continue;
      }
      const projected = projectVerifyProofFailure(error, { subject: resolution.subject?.requested ?? null,
        continuation: true });
      const continuation = verifyProofFailureContinuationFacts(projected);
      if (continuation?.verification_id === proof.verification_id && continuation.target === target) {
        await runtime.assertCurrentIdentity();
        localUnavailable.set(proof.execution_key, { projected,
          executionStatus: continuation.execution_status });
        continue;
      }
      throw error;
    }
  }
  const budgetFacts = {
    timeout: { label: timeout.label, seconds: timeout.seconds },
    elapsed_ms: Math.round(budget.elapsedMs())
  };
  const interruptionResult = (proof, entry, phase) => {
    const outcome = EXECUTION_INTERRUPTIONS[entry.interruption];
    const reasonCode = outcome[phase];
    const facts = { ...budgetFacts, interruption: entry.interruption,
      ...(entry.run_blocker_code ? { run_blocker_code: entry.run_blocker_code } : {}),
      ...(entry.interrupted_stage ? { interrupted_stage: entry.interrupted_stage } : {}) };
    return buildUnavailableProofResult({ resolution, runtime, proof,
      blockers: [{ code: reasonCode, reason_code: reasonCode, test_proof_id: proof.test_proof_id,
        verification_id: proof.verification_id, authority_limb: "mechanical_failure",
        details: entry.evidence === undefined ? facts : { ...facts, evidence: entry.evidence } }],
      reasonCode, readinessStatus: "ready",
      executionStatus: phase === "interrupted" ? "interrupted" : "not_started",
      recovery: { action: outcome.action, retry_operation: VERIFY_PROOF_TOOL_NAME, facts } });
  };
  const proofResults = resolution.proofs.map((proof) => {
    if (unavailableProofs.has(proof)) return unavailableResult(proof);
    const stopped = interrupted.get(proof.execution_key);
    if (stopped !== undefined) return interruptionResult(proof, stopped, "interrupted");
    const notReached = unstarted.get(proof.execution_key);
    if (notReached !== undefined) {
      return interruptionResult(proof, { interruption: notReached }, "unstarted");
    }

    const local = localUnavailable.get(proof.execution_key);
    if (local !== undefined) return buildUnavailableProofResult({ resolution, runtime, proof,
      blockers: local.projected.diagnostics ?? [], reasonCode: local.projected.reason_code,
      readinessStatus: "ready", recovery: local.projected.recovery,
      executionStatus: local.executionStatus });
    const receipts = evidenceByExecution.get(proof.execution_key);

    const selectedTest = (deps.deriveRuntimeTestIdentity ??
      deriveLauncherTestProofRuntimeTestIdentity)({
      binding: proof.test_proof, target: proof.declared_target.target
    });
    const relationshipResults = proof.relationships.map((relationship) => {
      const one = individualResolution(resolution, proof, relationship);
      const semanticFacts = (deps.evaluateSemantics ?? evaluateTestProofEvidenceSemantics)({
        resolution: one,
        receipts,
        expected: {
          wk_id: runtime.authority.wk_id,
          selected_unit: runtime.authority.selected_unit,
          source_snapshot_digest: proof.declared_target.source_snapshot_digest,
          test_id: selectedTest.test_id,
          candidate: { identity: runtime.candidateIdentity, role: runtime.role }
        }
      });
      if (semanticFacts.status === "not_executable") return {
        ...buildNotExecutableProofVerificationResult({ obligationId: relationship.obligation_id,
          reasonCode: semanticFacts.reason_code, diagnostics: semanticFacts.diagnostics ?? [] }),
        relation_ids: [...relationship.relation_ids]
      };
      const evaluation = resolution.execution_pack.test_validity_evaluator.evaluate({
        semantic_facts: semanticFacts
      });
      const result = buildProofVerificationResult({ resolution: one, semanticFacts, evaluation });
      return {
        obligation_id: relationship.obligation_id,
        status: result.status,
        reason_code: result.reason_code,
        relation_ids: [...relationship.relation_ids],
        diagnostics: result.diagnostics,
        schema_version: result.schema_version,
        proof_instance: result.proof_instance,
        result_digest: result.result_digest
      };
    });
    return {
      test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_id,
      status: aggregateStatus(relationshipResults.map(({ status }) => status)),
      readiness_status: "ready",
      execution_status: "completed",
      reason_code: relationshipResults.some(({ status }) => status === "not_executable")
        ? "verify_proof.relationship_evaluation_incomplete.v1" : null,
      subject_binding_ref: "aggregate.subject_binding",
      declared_target: structuredClone(proof.declared_target),
      selected_test: {
        test_id: selectedTest.test_id, file: selectedTest.file,
        name: selectedTest.name, nesting: selectedTest.nesting,
        ...(selectedTest.node_id === undefined ? {} : { node_id: selectedTest.node_id,
          provider_id: selectedTest.provider_id, provider_version: selectedTest.provider_version })
      },
      observed_evidence: projectObservedEvidence(
        receipts[0], proof.declared_target.target, selectedTest.test_id
      ),
      runtime_environment: structuredClone(runtimeEnvironmentByExecution.get(proof.execution_key) ?? null),
      relationship_results: relationshipResults
    };
  });
  await runtime.assertCurrentIdentity();
  const interruption = budget.interruption();
  const aggregateDiagnostics = [...(resolution.diagnostics ?? []),
    ...(interrupted.size + unstarted.size === 0 || interruption === null ? [] : [{
      code: EXECUTION_INTERRUPTIONS[interruption].interrupted,
      reason_code: EXECUTION_INTERRUPTIONS[interruption].interrupted,
      authority_limb: "mechanical_failure",
      details: { ...budgetFacts, interruption,
        completed_execution_count: evidenceByExecution.size + localUnavailable.size,
        interrupted_execution_count: interrupted.size,
        unstarted_execution_count: unstarted.size }
    }])];
  return aggregateResult({ resolution, runtime, proofResults,
    diagnostics: aggregateDiagnostics, requestedEnvironment });
}

export { aggregateResult, VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION };
