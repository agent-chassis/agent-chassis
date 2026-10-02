import { TestProofEvidenceSemanticKernelError } from "@agent-chassis/controlled-contract";
import { ProofObligationResolutionError } from "@agent-chassis/controlled-contract";
import { ProofAuthoringError } from "@agent-chassis/controlled-contract";
import { AdmittedProofPackError } from "@agent-chassis/controlled-contract";
import { projectPublicDiagnostic } from "./verify-proof-result-detail.mjs";
import { VerifyProofOperationError } from
  "../../../wiki-core/src/operations/controlled-contract/verify-proof-operations.mjs";
import { ControlledContractToolError } from
  "../../../wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import { VerifyProofExecutionError } from
  "../../../agent-launch-cli/src/lib/workspace-agent-verify-proof-capability.mjs";
import { ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES, OrchestratorTestProofRuntimeError } from
  "../../../agent-launch-cli/src/lib/workspace-agent-orchestrator-test-proof-runtime.mjs";
import { ImmutableCandidateError } from
  "../../../agent-launch-cli/src/lib/backend-immutable-candidate.mjs";
import { TestProofRuntimeIdentityError } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import { TERMINAL_CANDIDATE_VALIDATION_CODES, TerminalCandidateValidationError } from
  "../../../agent-launch-cli/src/lib/terminal-wk-candidate-validation.mjs";
import { TestProofEvidenceError } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-evidence.mjs";
import { TestProofProviderRegistryError } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-provider-registry.mjs";
import { captureDiagnosticEvidence } from
  "../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import {
  VERIFY_PROOF_SUMMARY_SCHEMA_VERSION
} from "./mcp-response.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
export { VERIFY_PROOF_SUMMARY_SCHEMA_VERSION };

export const VERIFY_PROOF_TOOL_NAME = "workspace_verify_proof";
const CONTINUATION_FACTS = new WeakMap();

export function verifyProofFailureContinuationFacts(result) {
  return result !== null && typeof result === "object"
    ? CONTINUATION_FACTS.get(result) ?? null : null;
}
import {
  IMMUTABLE_CANDIDATE_RECOVERIES,
  ORCHESTRATOR_RUNTIME_FAILURES,
  STABLE_CODE_RE,
  TEST_PROOF_FAILURES,
  VERIFY_PROOF_REFUSAL_SCHEMA_VERSION,
  VERIFY_PROOF_EXECUTION_CODES,
  VERIFY_PROOF_EXECUTION_FAILURES,
  infrastructureCorrection,
  VERIFY_PROOF_OPERATION_FAILURES,
  VERIFY_PROOF_SOURCE_SELECTION_FAILURES,
  dependencyProjectionCorrection,
  isVerifyProofSourceSelectionFailure,
  projectObservedEvidence,
  projectVerifyProofSourceRetryCalls,
  projectedSourceSelectionDetail,
  projectedEvidenceFailure,
  projectedExecutionDetail,
  projectedDependencyProjectionFacts,
  projectedOperationDetail,
  projectedProviderFailure,
  proofLocalContinuationFacts
} from "./verify-proof-failure-detail.mjs";

export { projectObservedEvidence, projectProofAuthoringRecoveryCall } from
  "./verify-proof-failure-detail.mjs";

export function projectVerifyProofFailure(error, { subject = null, continuation = false,
  request = null, timing = null } = {}) {

  const originalEvidence = captureDiagnosticEvidence(error);
  const chain = [];
  const seen = new Set();
  let current = error;
  let deepestFailure = null;
  let executionContext = null;
  let causeTraversalComplete = false;
  projection: while (current) {
    if (!current || typeof current !== "object" || seen.has(current)) {
      break projection;
    }
    seen.add(current);
    let node;
    if (current instanceof VerifyProofExecutionError &&
        VERIFY_PROOF_EXECUTION_CODES.has(current.code)) {
      const details = projectedExecutionDetail(current, subject);
      if (details === null) break projection;
      node = { code: current.code,
        owning_boundary: "agent-launch-core.workspace-agent-verify-proof-capability",
        details };
      executionContext = details;
      deepestFailure = {
        recovery_action: VERIFY_PROOF_EXECUTION_FAILURES[current.code],
        ...infrastructureCorrection(current.code)
      };
    } else if (current instanceof TestProofEvidenceError) {
      const failure = projectedEvidenceFailure(current, executionContext ?? {
        subject,
        outer_wrapper_code: null
      });
      if (failure === null) {
        break projection;
      }
      node = { code: current.detail?.run?.accepted === false
          ? failure.details.blocker_code : current.code,
        owning_boundary: "agent-launch-cli.workspace-agent-test-proof-evidence",
        details: failure.details };
      deepestFailure = failure;
    } else if (current instanceof TestProofProviderRegistryError) {
      const failure = projectedProviderFailure(current, executionContext ?? {
        subject,
        outer_wrapper_code: null
      });
      if (failure === null) {
        break projection;
      }
      node = { code: current.code,
        owning_boundary: "agent-launch-cli.workspace-agent-test-proof-provider-registry",
        details: failure.details };
      deepestFailure = failure;
    } else if ((current instanceof VerifyProofOperationError ||
        current instanceof ControlledContractToolError) &&
        isVerifyProofSourceSelectionFailure(current)) {
      const projected = projectedSourceSelectionDetail(current);
      if (projected === null) {
        break projection;
      }
      const failure = VERIFY_PROOF_SOURCE_SELECTION_FAILURES[current.code];
      node = { code: current.code, owning_boundary: failure.owning_boundary,
        details: projected.details };
      deepestFailure = projected.choices === null ? failure : {
        ...failure,
        recovery_action: projected.choices.length > 0 ? failure.recovery_action
          : "supply_one_unambiguous_canonical_subject",
        choices: projectVerifyProofSourceRetryCalls(projected.choices, {
          subject: subject ?? projected.details.subject, request })
      };
    } else if (current instanceof ProofObligationResolutionError || current instanceof ProofAuthoringError ||
        current instanceof AdmittedProofPackError || current instanceof TestProofEvidenceSemanticKernelError ||
        current instanceof VerifyProofOperationError && !Object.hasOwn(VERIFY_PROOF_OPERATION_FAILURES, current.code) ||
        current instanceof TestProofRuntimeIdentityError && ['test_proof_saved_source_stale',
          'test_proof_saved_source_binding_mismatch'].includes(current.code) ||
        current instanceof ControlledContractToolError && (/^(obligation_coverage_|acceptance_coverage_|verify_proof\.|controlled_contract_carrier_set_)/u.test(current.code) ||
          ["controlled_contract_carrier_validation_failed", "controlled_contract_carrier_not_found",
            "controlled_contract_generation_stale", "controlled_contract_generation_invalid"]
            .includes(current.code))) {
      node = { code: current.code, owning_boundary: current.name,
        details: structuredClone(current.details ?? current.detail ?? {}) };
      deepestFailure = { recovery_action: "repair_the_named_proof_prerequisite" };
    } else if (current instanceof VerifyProofOperationError &&
        Object.hasOwn(VERIFY_PROOF_OPERATION_FAILURES, current.code)) {
      const details = projectedOperationDetail(current);
      if (details === null) {
        break projection;
      }
      const failure = VERIFY_PROOF_OPERATION_FAILURES[current.code];
      node = { code: current.code,
        owning_boundary: failure.owning_boundary,
        details };
      deepestFailure = failure;
    } else if (current instanceof TestProofRuntimeIdentityError &&
        Object.hasOwn(TEST_PROOF_FAILURES, current.code)) {
      const failure = TEST_PROOF_FAILURES[current.code];
      const details = failure.detail(current.detail);
      if (details === null) {
        break projection;
      }
      node = { code: current.code,
        owning_boundary: "agent-launch-cli.workspace-agent-test-proof-runtime-identity",
        details };
      deepestFailure = failure;
    } else if (current instanceof OrchestratorTestProofRuntimeError &&
        Object.hasOwn(ORCHESTRATOR_RUNTIME_FAILURES, current.code)) {
      const selector = current.detail?.selector;
      if (typeof selector !== "string" ||
          !["current_main", "exact_sha"].includes(selector)) {
        break projection;
      }
      const details = { selector };
      let correction = null;
      if (current.code === ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.EXACT_DEPENDENCY_PROJECTION) {
        if (typeof current.detail?.cause_code !== "string" ||
            !STABLE_CODE_RE.test(current.detail.cause_code)) {
          break projection;
        }
        details.cause_code = current.detail.cause_code;
        const facts = projectedDependencyProjectionFacts(current.detail);
        if (facts === null) break projection;
        Object.assign(details, facts);
        correction = dependencyProjectionCorrection(details, subject);
      }
      node = { code: current.code,
        owning_boundary: "agent-launch-cli.workspace-agent-orchestrator-test-proof-runtime",
        details };
      deepestFailure = correction ?? {
        recovery_action: ORCHESTRATOR_RUNTIME_FAILURES[current.code]
      };
    } else if (current instanceof TerminalCandidateValidationError &&
        current.code === TERMINAL_CANDIDATE_VALIDATION_CODES.MOUNT_IDENTITY_CHANGED) {
      node = { code: current.code,
        owning_boundary: "agent-launch-cli.terminal-wk-candidate-validation",
        details: {} };
      deepestFailure = {
        recovery_action:
          "repair_the_authenticated_exact_candidate_dependency_projection_then_retry"
      };
    } else if (current instanceof ImmutableCandidateError &&
        Object.hasOwn(IMMUTABLE_CANDIDATE_RECOVERIES, current.detail?.reason)) {
      const detail = current.detail;
      const details = { reason: detail.reason };
      for (const key of ["expected_commit", "observed_commit", "expected_tree",
        "observed_tree"]) {
        if (detail[key] !== undefined) {
          if (typeof detail[key] !== "string" || !/^[a-f0-9]{40,64}$/u.test(detail[key])) {
            break projection;
          }
          details[key] = detail[key];
        }
      }
      for (const key of ["worktree_registration_retained", "checkout_root_present",
        "filesystem_removal_failed"]) {
        if (detail[key] !== undefined) {
          if (typeof detail[key] !== "boolean") {
            break projection;
          }
          details[key] = detail[key];
        }
      }
      if (detail.primary_error_code !== undefined && detail.primary_error_code !== null) {
        if (typeof detail.primary_error_code !== "string" ||
            !STABLE_CODE_RE.test(detail.primary_error_code)) {
          break projection;
        }
        details.primary_error_code = detail.primary_error_code;
      }
      node = { code: current.code,
        owning_boundary: "agent-launch-cli.backend-immutable-candidate", details };
      deepestFailure = {
        recovery_action: IMMUTABLE_CANDIDATE_RECOVERIES[detail.reason]
      };
    } else if (current instanceof ControlledContractToolError &&
        current.code === "controlled_contract_carrier_not_found") {
      const carrierKind = current.details?.carrier_kind;
      if (!["contract", "evaluation_input", "proof_plan_request", "proof_plan"]
        .includes(carrierKind) || typeof subject !== "string" ||
        subject.length === 0 || subject.length > 512 ||
        !/^[A-Za-z0-9#._-]+$/u.test(subject)) {
        break projection;
      }
      node = {
        code: "verify_proof.controlled_contract_carrier_absent.v1",
        owning_boundary: "wiki-core.controlled-contract-carrier-set",
        details: { subject, carrier_kind: carrierKind }
      };
      deepestFailure = {
        recovery_action: "author_the_canonical_controlled_contract_and_proof_population_then_retry"
      };
    } else {
      break projection;
    }
    if (chain.length === 0) {
      node.details = { ...node.details, evidence: originalEvidence };
    }
    chain.push(Object.freeze(node));
    let cause;
    try { cause = current.cause; } catch {
      break projection;
    }
    if (cause === undefined || cause === null) {
      causeTraversalComplete = true;
      break;
    }
    current = cause;
  }
  if (deepestFailure === null) return null;
  const deepest = chain.at(-1);
  const detail = deepest.details ?? {};

  const redactions = [];
  const recoveryFacts = {};
  for (const key of ["outer_wrapper_code", "deepest_stable_cause_code", "declared_target", "verification_id", "test_proof_id",
    "expected_test_id", "observed_count", "returned_count", "omitted_count",
    "observed_identity_candidates", "file_wrapper_status", "file_wrapper_error_codes",
    "observed_failures", "observed_failure_count", "ran", "exit_code", "signal",
    "filesystem_error_code", "spawn_error_code", "structured_observation_code", "failure_diagnostic",
    "output_truncated", "output_elided_bytes",
    "execution_stage", "timed_out", "disposition", "blocker_code", "reason",
    "provider_id", "provider_version", "structured_observation_detail",
    "selector", "cause_code", "candidate_commit", "validator_cache", "expected_commit", "observed_commit", "expected_tree",
    "observed_tree", "diagnostic_count", "returned_diagnostic_count",
    "omitted_diagnostic_count", "match_count", "choice_count", "field",
    "unsupported_keys", "accepted_form", "source_unit", "requested_environment", "incompatible",
    "valid_choices", "prepared_environments"]) {
    if (detail[key] !== undefined) recoveryFacts[key] = structuredClone(detail[key]);
  }
  const result = {
    schema_version: VERIFY_PROOF_REFUSAL_SCHEMA_VERSION,
    subject: Object.freeze({ requested: subject, kind: null, canonical_id: null }),
    subject_binding: null,
    status: "not_executable",
    authority_limb: "mechanical_failure",
    counts: Object.freeze({ proofs: 0, relationships: 0, proven: 0,
      unproven: 0, not_executable: 0, ready: 0, nonready: 0,
      execution_not_started: 0 }),
    proof_results: Object.freeze([]),
    reason_code: deepest.code,
    diagnostics: projectPublicDiagnostic(chain, "diagnostics", redactions),
    diagnostic_redactions: redactions,
    next_calls: detail.recovery_call === undefined ? [] : [buildNextCall({
      ...detail.recovery_call, recommended: true
    })],
    recovery: Object.freeze({
      action: deepestFailure.recovery_action,

      ...(deepestFailure.retry === false ? {
        correction_owner: deepestFailure.correction_owner,
        condition: deepestFailure.condition,
        ...(deepestFailure.correction === undefined ? {} : {
          correction: structuredClone(deepestFailure.correction) })
      } : { retry_operation: VERIFY_PROOF_TOOL_NAME }),
      ...(deepestFailure.choices === undefined ? {} : {
        choices: Object.freeze([...deepestFailure.choices]),
        choice_count: deepestFailure.choices.length
      }),
      ...(Object.keys(recoveryFacts).length === 0 ? {} : { facts: recoveryFacts })
    }),
    ...(timing === null ? {} : { timing: structuredClone(timing) })
  };
  const local = continuation && causeTraversalComplete
    ? proofLocalContinuationFacts(chain) : null;
  const frozen = Object.freeze(result);
  if (local !== null) CONTINUATION_FACTS.set(frozen, local);
  return frozen;
}

export { projectPublicVerifyProofRefusal, selectedVerifyProofSourceChoice,
  verifyProofSourceAmbiguityChoices } from "./dispatch-run-proof-verification.mjs";

export { projectPublicVerifyProofAggregate } from "./verify-proof-result-detail.mjs";
export { projectVerifyProofSummary } from "./verify-proof-result-summary.mjs";
