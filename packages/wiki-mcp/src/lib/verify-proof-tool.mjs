import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  buildProofVerificationResult,
  canonicalProofVerificationDigest
} from "../../../controlled-contract/lib/proof-obligation-runtime-resolver.mjs";
import { evaluateTestProofEvidenceSemantics } from
  "../../../controlled-contract/lib/test-proof-evidence-semantic-kernel.mjs";
import { loadExactAdmittedProofPack } from
  "../../../controlled-contract/lib/admitted-proof-packs.mjs";
import { PROVIDER_REFUSAL_PRECEDENCE } from
  "../../../controlled-contract/current.mjs";
import {
  VerifyProofOperationError,
  assertVerifyProofCallerShape,
  resolveVerifyProofOperation
} from
  "../../../wiki-core/src/operations/controlled-contract/verify-proof-operations.mjs";
import {
  readControlledContractCarrierFile
} from "../../../wiki-core/src/lib/controlled-contract-carrier-set-tools.mjs";
import {
  readControlledContractGeneration,
  resolveControlledContractTestProofRuntimeBindings
} from "../../../wiki-core/src/lib/controlled-contract-tools.mjs";
import { ControlledContractToolError } from
  "../../../wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import {
  executeLauncherVerifyProofReceiptPopulation,
  VERIFY_PROOF_EXECUTION_FAILURE_CODES,
  VerifyProofExecutionError
} from
  "../../../agent-launch-cli/src/lib/workspace-agent-verify-proof-capability.mjs";
import {
  ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES,
  OrchestratorTestProofRuntimeError,
  withOrchestratorTestProofRuntime
} from "../../../agent-launch-cli/src/lib/workspace-agent-orchestrator-test-proof-runtime.mjs";
import { ImmutableCandidateError } from
  "../../../agent-launch-cli/src/lib/backend-immutable-candidate.mjs";
import {
  assertManagedReviewerTestProofRuntimeCurrent,
  captureLauncherTestProofSourceSnapshot,
  mintLauncherTestProofAttemptContext,
  mintManagedReviewerTestProofRuntimeAuthority,
  mintManagedWorkerTestProofRuntimeAuthority,
  TestProofRuntimeIdentityError
} from "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import { runWorkspaceAgentTestProofAttempt } from
  "../../../agent-launch-cli/src/lib/workspace-agent-validation-runner.mjs";
import { TestProofEvidenceError } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-evidence.mjs";
import {
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES,
  TestProofProviderRegistryError
} from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-provider-registry.mjs";
import { extractTestProofRuntimeEvidenceReceipt } from
  "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import { resolveWorktreeBinding } from
  "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import { verifyExactSliceCommitBinding } from
  "../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs";
import { mintManagedWorkerTestRunAuthority } from
  "../../../agent-launch-cli/src/lib/managed-worker-test-run-authority.mjs";
import { defaultTerminalCandidateRunGit } from
  "../../../agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  resolveFrozenReviewContractArtifact,
  resolveLauncherRunState
} from "./launcher-run-credential.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import { resolveDispatchWorktreeProvisioningConfig } from "./dispatch-launch-runtime.mjs";

export const VERIFY_PROOF_TOOL_NAME = "workspace_verify_proof";

const VERIFY_PROOF_REFUSAL_SCHEMA_VERSION = "workspace-verify-proof-refusal.v1";
const VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION = "workspace-verify-proof-aggregate.v1";
export const VERIFY_PROOF_PUBLIC_MAX_BYTES = 65_536;
const MAX_PROJECTED_CAUSE_DEPTH = 4;
const VERIFY_PROOF_EXECUTION_CODES = new Set(
  Object.values(VERIFY_PROOF_EXECUTION_FAILURE_CODES)
);
const VERIFY_PROOF_EXECUTION_FAILURES = Object.freeze({
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.INPUT_INVALID]:
    "repair_the_server_owned_verify_proof_execution_input_then_retry",
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.BINDING_RESOLUTION]:
    "repair_the_canonical_proof_binding_then_retry",
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.ATTEMPT_CONTEXT]:
    "repair_the_launcher_attempt_context_prerequisite_then_retry",
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.ATTEMPT_EXECUTION]:
    "repair_the_launcher_execution_prerequisite_then_retry",
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.RECEIPT_INCOMPLETE]:
    "repair_the_receipt_provider_binding_then_retry",
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.RECEIPT_CROSS_BOUND]:
    "repair_the_receipt_provider_binding_then_retry"
});
const TEST_PROOF_EVIDENCE_FAILURES = Object.freeze({
  test_proof_artifact_untrusted: "repair_the_receipt_provider_protocol_then_retry",
  test_proof_bound_identity_mismatch: "repair_the_reporter_identity_binding_then_retry",
  test_proof_selected_identity_not_observed:
    "repair_the_declared_test_startup_or_reporter_observation_then_retry",
  test_proof_caller_executor_forbidden:
    "repair_the_server_owned_verify_proof_execution_input_then_retry",
  test_proof_candidate_execution_error: null,
  test_proof_candidate_inventory_missing: "repair_the_node_test_reporter_protocol_then_retry",
  test_proof_evidence_identity_invalid: "repair_the_receipt_provider_binding_then_retry",
  test_proof_falsifier_execution_error: null,
  test_proof_falsifier_provider_missing: "repair_the_canonical_proof_binding_then_retry",
  test_proof_inventory_binding_invalid: "repair_the_canonical_proof_binding_then_retry",
  test_proof_inventory_duplicate: "repair_the_canonical_proof_binding_then_retry",
  test_proof_inventory_invalid: "repair_the_canonical_proof_binding_then_retry",
  test_proof_receipt_projection_digest_mismatch:
    "repair_the_receipt_provider_protocol_then_retry",
  test_proof_receipt_projection_invalid: "repair_the_receipt_provider_protocol_then_retry",
  test_proof_rename_invalid: "repair_the_canonical_proof_binding_then_retry",
  test_proof_runtime_evidence_invalid: "repair_the_receipt_provider_protocol_then_retry",
  test_proof_test_identity_invalid: "repair_the_canonical_proof_binding_then_retry",
  test_proof_traversal_execution_error: null,
  test_proof_traversal_provider_invalid: "repair_the_canonical_proof_binding_then_retry"
});
const TEST_PROOF_PROVIDER_CODES = new Set([
  ...Object.values(TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES),
  ...PROVIDER_REFUSAL_PRECEDENCE
]);
const ORCHESTRATOR_RUNTIME_FAILURES = Object.freeze({
  [ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.WORKTREE_BINDING]:
    "repair_the_configured_current_worktree_binding_then_retry",
  [ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.WORKTREE_MOVED]:
    "stabilize_the_configured_current_worktree_then_retry"
});
const IMMUTABLE_CANDIDATE_RECOVERIES = Object.freeze({
  repository_invalid: "repair_the_launcher_configured_repository_identity",
  locator_width_mismatch: "supply_the_complete_exact_commit_identity",
  commit_object_not_commit: "supply_one_exact_commit_object_identity",
  object_format_unavailable: "repair_the_configured_repository_object_database",
  object_format_unsupported: "use_a_supported_configured_repository_object_format",
  commit_tree_unavailable: "fetch_or_repair_the_exact_commit_object_then_retry",
  materialization_input_invalid: "repair_the_launcher_owned_candidate_configuration",
  materialization_root_unavailable: "repair_the_launcher_owned_worktree_root_then_retry",
  materialization_failed: "repair_the_shared_immutable_candidate_materializer_then_retry",
  materialized_identity_unavailable: "repair_the_shared_immutable_candidate_authentication",
  materialized_identity_mismatch: "repair_the_shared_immutable_candidate_authentication",
  cleanup_failed: "remove_the_retained_launcher_owned_candidate_then_retry"
});
const WIKI_CORE_VERIFY_PROOF_BOUNDARY =
  "wiki-core.controlled-contract.verify-proof-operations";
const RUNTIME_BINDING_BOUNDARY =
  "wiki-mcp.workspace-verify-proof-runtime-binding";
const QUERY_AND_REPAIR_BINDINGS =
  "query_and_repair_with_workspace_controlled_test_proof_query_and_patch";
const VERIFY_PROOF_OPERATION_FAILURES = Object.freeze({
  "verify_proof.subject_ambiguous.v1": {
    recovery_action: "supply_one_unambiguous_canonical_subject",
    owning_boundary: WIKI_CORE_VERIFY_PROOF_BOUNDARY
  },
  "verify_proof.test_proof_identity_ambiguous.v1": {
    recovery_action: "repair_the_canonical_test_proof_relationships_then_retry",
    owning_boundary: WIKI_CORE_VERIFY_PROOF_BOUNDARY
  },
  "verify_proof.contract_generation_mismatch.v1": {
    recovery_action: "repair_the_cross_bound_canonical_generation_then_retry",
    owning_boundary: WIKI_CORE_VERIFY_PROOF_BOUNDARY
  },
  "verify_proof.controlled_contract_invalid.v1": {
    recovery_action: "repair_the_canonical_controlled_contract_then_retry",
    owning_boundary: WIKI_CORE_VERIFY_PROOF_BOUNDARY
  },
  "verify_proof.obligation_coverage_invalid.v1": {
    recovery_action: "repair_the_canonical_obligation_coverage_then_retry",
    owning_boundary: WIKI_CORE_VERIFY_PROOF_BOUNDARY
  },
  "verify_proof.runtime_binding_selection_status_incomplete.v1": {
    recovery_action: QUERY_AND_REPAIR_BINDINGS,
    owning_boundary: RUNTIME_BINDING_BOUNDARY
  },
  "verify_proof.runtime_binding_resolution_failed.v1": {
    recovery_action: "repair_the_controlled_test_proof_binding_resolution_then_retry",
    owning_boundary: RUNTIME_BINDING_BOUNDARY
  },
  "verify_proof.runtime_binding_requested_count_mismatch.v1": {
    recovery_action: "repair_the_controlled_test_proof_binding_query_contract",
    owning_boundary: RUNTIME_BINDING_BOUNDARY
  },
  "verify_proof.runtime_binding_matched_count_mismatch.v1": {
    recovery_action: QUERY_AND_REPAIR_BINDINGS,
    owning_boundary: RUNTIME_BINDING_BOUNDARY
  },
  "verify_proof.runtime_binding_count_mismatch.v1": {
    recovery_action: QUERY_AND_REPAIR_BINDINGS,
    owning_boundary: RUNTIME_BINDING_BOUNDARY
  },
  "verify_proof.runtime_binding_verification_identity_duplicate.v1": {
    recovery_action: QUERY_AND_REPAIR_BINDINGS,
    owning_boundary: RUNTIME_BINDING_BOUNDARY
  },
  "verify_proof.runtime_binding_verification_identity_unexpected.v1": {
    recovery_action: QUERY_AND_REPAIR_BINDINGS,
    owning_boundary: RUNTIME_BINDING_BOUNDARY
  },
  "verify_proof.runtime_binding_contract_content_digest_mismatch.v1": {
    recovery_action: "repair_the_authenticated_canonical_contract_carrier",
    owning_boundary: RUNTIME_BINDING_BOUNDARY
  },
  "verify_proof.runtime_binding_controlled_generation_invalid.v1": {
    recovery_action: "repair_the_authenticated_canonical_generation_projection",
    owning_boundary: RUNTIME_BINDING_BOUNDARY
  },
  "verify_proof.runtime_binding_controlled_generation_moved.v1": {
    recovery_action: "restart_after_the_canonical_controlled_contract_generation_stabilizes",
    owning_boundary: RUNTIME_BINDING_BOUNDARY
  }
});
const TEST_ID_RE = /^test-[a-f0-9]{64}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const MAX_PROJECTED_VERIFICATION_IDENTITIES = 16;

function projectRuntimeReadinessDetail(detail) {
  if (!Array.isArray(detail?.candidate_test_ids) ||
      detail.candidate_test_ids.length > 16 ||
      detail.candidate_test_ids.some((testId) => !TEST_ID_RE.test(testId)) ||
      !Number.isSafeInteger(detail.candidate_total) || detail.candidate_total < 0 ||
      !Number.isSafeInteger(detail.candidate_test_ids_omitted) ||
      detail.candidate_test_ids_omitted < 0 ||
      detail.candidate_test_ids.length + detail.candidate_test_ids_omitted !==
        detail.candidate_total ||
      detail.authority_limb !== "mechanical_failure" ||
      detail.admissibility_effect !== "none" ||
      detail.recovery_operation !== "workspace_controlled_test_proof_patch" ||
      detail.complete_retrieval?.tool !== "workspace_controlled_test_proof_query" ||
      typeof detail.complete_retrieval?.arguments?.wk_id !== "string" ||
      !Array.isArray(detail.complete_retrieval?.arguments?.verification_ids) ||
      detail.complete_retrieval.arguments.verification_ids.length !== 1 ||
      typeof detail.complete_retrieval.arguments.verification_ids[0] !== "string") return null;
  const selected = detail.selected_test_id;
  if (selected !== null && !TEST_ID_RE.test(selected)) return null;
  return {
    readiness_reason: detail.readiness_reason,
    selected_test_id: selected,
    candidate_test_ids: [...detail.candidate_test_ids],
    candidate_total: detail.candidate_total,
    candidate_test_ids_omitted: detail.candidate_test_ids_omitted,
    authority_limb: "mechanical_failure",
    admissibility_effect: "none",
    recovery_operation: detail.recovery_operation,
    complete_retrieval: structuredClone(detail.complete_retrieval)
  };
}

const TEST_PROOF_FAILURES = Object.freeze({
  test_proof_runtime_inventory_missing: {
    recovery_action: "author_complete_observed_inventory_then_mint_a_new_candidate",
    detail: projectRuntimeReadinessDetail
  },
  test_proof_runtime_test_selection_missing: {
    recovery_action: "author_one_exact_stable_runtime_test_identity",
    detail: projectRuntimeReadinessDetail
  },
  test_proof_runtime_test_selection_invalid: {
    recovery_action: "select_one_member_of_the_complete_current_test_population",
    detail: projectRuntimeReadinessDetail
  },
  test_proof_controlled_contract_generation_snapshot_mismatch: {
    recovery_action: "repair_the_manifest_selected_carrier_member_then_retry",
    detail(detail) {
      const storageMode = detail?.storage_mode;
      return typeof detail?.filename === "string" &&
        /^[A-Za-z0-9._-]{1,256}$/u.test(detail.filename) &&
        ["manifest_generation", "legacy_root"].includes(storageMode)
        ? {
            carrier_filename: detail.filename,
            carrier_storage_mode: storageMode,
            mismatch: "authenticated_source_member"
          }
        : null;
    }
  },
  test_proof_controlled_contract_generation_digest_mismatch: {
    recovery_action: "author_a_candidate_with_one_authentic_complete_controlled_generation",
    detail(detail) { return detail === null || detail === undefined ? {} : null; }
  },
  test_proof_source_snapshot_symlink_unsupported: {
    recovery_action: "remove_the_symlink_from_the_launcher_bound_source",
    detail(detail) {
      return typeof detail?.path === "string" && detail.path.length > 0 &&
        detail.path.length <= 4096 && !path.isAbsolute(detail.path)
        ? { entry_kind: "symbolic_link", path_disclosed: false }
        : null;
    },
    redactions: [{ field: "details.path", reason: "internal_identifier" }]
  }
});

const STABLE_CODE_RE = /^[a-z0-9_.-]{1,160}$/u;
const SAFE_WRAPPER_ERROR_CODE_RE = /^(?:[A-Z][A-Z0-9_]{0,127}|[a-z][a-z0-9_.-]{0,127})$/u;
const SAFE_IDENTITY_RE = /^[A-Za-z0-9#._:-]{1,512}$/u;
const SAFE_EXECUTION_STAGES = Object.freeze([
  "candidate", "falsifier", "traversal", "receipt"
]);

function safeDeclaredTarget(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !path.posix.isAbsolute(value) && !value.includes("\\") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".." &&
      /^[A-Za-z0-9_.-]+$/u.test(part));
}

function projectedExecutionDetail(error, subject) {
  const details = error.details;
  if (typeof subject !== "string" || !SAFE_IDENTITY_RE.test(subject)) return null;
  const projected = {
    subject,
    outer_wrapper_code: error.code,
    deepest_stable_cause_code: error.code
  };
  if (details !== null && typeof details === "object" && !Array.isArray(details) &&
      Object.hasOwn(details, "target") && safeDeclaredTarget(details.target)) {
    projected.declared_target = details.target;
  }
  if (details !== null && typeof details === "object" && !Array.isArray(details) &&
      Object.hasOwn(details, "verification_id") &&
      SAFE_IDENTITY_RE.test(details.verification_id)) {
    projected.verification_id = details.verification_id;
  }
  if ([VERIFY_PROOF_EXECUTION_FAILURE_CODES.RECEIPT_INCOMPLETE,
    VERIFY_PROOF_EXECUTION_FAILURE_CODES.RECEIPT_CROSS_BOUND].includes(error.code)) {
    projected.execution_stage = "receipt";
  }
  return projected;
}

function projectedRunFacts(run) {
  if (run === null || typeof run !== "object" || Array.isArray(run)) return null;
  const facts = {};
  if (Object.hasOwn(run, "ran")) {
    if (typeof run.ran !== "boolean") return null;
    facts.ran = run.ran;
  }
  if (Object.hasOwn(run, "disposition")) {
    if (!["passed", "failed", "not_run"].includes(run.disposition)) return null;
    facts.disposition = run.disposition;
  }
  if (Object.hasOwn(run, "exit_code")) {
    if (run.exit_code !== null && (!Number.isSafeInteger(run.exit_code) ||
        Math.abs(run.exit_code) > 2_147_483_647)) return null;
    facts.exit_code = run.exit_code;
  }
  if (Object.hasOwn(run, "timed_out")) {
    if (typeof run.timed_out !== "boolean") return null;
    facts.timed_out = run.timed_out;
  }
  if (Object.hasOwn(run, "signal")) {
    if (run.signal !== null && (typeof run.signal !== "string" ||
        !/^SIG[A-Z0-9]{1,32}$/u.test(run.signal))) return null;
    facts.signal = run.signal;
  }
  if (Object.hasOwn(run, "blocker_code")) {
    if (typeof run.blocker_code !== "string" || !STABLE_CODE_RE.test(run.blocker_code)) {
      return null;
    }
    facts.blocker_code = run.blocker_code;
  }
  const observationCode = run.test_proof_observation?.code;
  if (observationCode !== undefined) {
    if (typeof observationCode !== "string" || !STABLE_CODE_RE.test(observationCode)) {
      return null;
    }
    facts.structured_observation_code = observationCode;
  }
  if (Object.hasOwn(run, "output_truncated")) {
    if (typeof run.output_truncated !== "boolean") return null;
    facts.output_truncated = run.output_truncated;
  }
  if (Object.hasOwn(run, "output_elided_bytes")) {
    if (!Number.isSafeInteger(run.output_elided_bytes) || run.output_elided_bytes < 0) {
      return null;
    }
    facts.output_elided_bytes = run.output_elided_bytes;
  }
  return facts;
}

function evidenceExecutionRecovery(details) {
  if (details.structured_observation_code !== undefined) {
    return "repair_the_node_test_reporter_protocol_then_retry";
  }
  if (details.timed_out === true) {
    return "repair_the_launcher_runtime_timeout_prerequisite_then_retry";
  }
  return "repair_the_launcher_execution_prerequisite_then_retry";
}

function projectedBoundIdentityMismatch(detail) {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail) ||
      !TEST_ID_RE.test(detail.expected_test_id) ||
      !Number.isSafeInteger(detail.observed_count) || detail.observed_count < 0 ||
      !Number.isSafeInteger(detail.returned_count) || detail.returned_count < 0 ||
      !Number.isSafeInteger(detail.omitted_count) || detail.omitted_count < 0 ||
      detail.returned_count + detail.omitted_count !== detail.observed_count ||
      !Array.isArray(detail.observed_identity_candidates) ||
      detail.observed_identity_candidates.length !== detail.returned_count ||
      detail.observed_identity_candidates.length > 8) return null;
  const candidates = [];
  for (const candidate of detail.observed_identity_candidates) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate) ||
        !TEST_ID_RE.test(candidate.test_id) || !safeDeclaredTarget(candidate.file) ||
        typeof candidate.name !== "string" || candidate.name.length === 0 ||
        candidate.name.length > 512 || /[\u0000-\u001f\u007f]/u.test(candidate.name) ||
        candidate.name.startsWith("/") || candidate.name.startsWith("file:") ||
        /^[A-Za-z]:[\\/]/u.test(candidate.name) ||
        !Number.isSafeInteger(candidate.nesting) || candidate.nesting < 0 ||
        candidate.nesting > 1_000_000) return null;
    candidates.push({
      test_id: candidate.test_id,
      file: candidate.file,
      name: candidate.name,
      nesting: candidate.nesting
    });
  }
  return {
    expected_test_id: detail.expected_test_id,
    observed_count: detail.observed_count,
    returned_count: detail.returned_count,
    omitted_count: detail.omitted_count,
    observed_identity_candidates: candidates
  };
}

function boundedObservedEvidence(receipt, target, expectedTestId) {
  const events = [
    ...(Array.isArray(receipt?.execution_result?.structured_result?.pass_events)
      ? receipt.execution_result.structured_result.pass_events : []),
    ...(Array.isArray(receipt?.execution_result?.structured_result?.fail_events)
      ? receipt.execution_result.structured_result.fail_events : [])
  ];
  const candidates = events.map((event) => ({
    test_id: event?.test_id,
    file: event?.file,
    name: event?.name,
    nesting: event?.nesting
  })).filter((candidate) => projectedBoundIdentityMismatch({
    expected_test_id: expectedTestId,
    observed_count: 1,
    returned_count: 1,
    omitted_count: 0,
    observed_identity_candidates: [candidate]
  }) !== null).sort((left, right) =>
    Number(right.test_id === expectedTestId) - Number(left.test_id === expectedTestId) ||
    Number(right.file === target) - Number(left.file === target) ||
    left.file.localeCompare(right.file) || left.nesting - right.nesting ||
    left.name.localeCompare(right.name) || left.test_id.localeCompare(right.test_id)
  ).slice(0, 8);
  const evidenceId = receipt?.evidence_identity?.evidence_id;
  if (!SAFE_IDENTITY_RE.test(evidenceId) ||
      !["passed", "failed"].includes(receipt?.execution_result?.status) ||
      !(receipt.execution_result.exit_code === null ||
        Number.isSafeInteger(receipt.execution_result.exit_code))) {
    throw new TypeError("authenticated proof receipt cannot be safely projected");
  }
  return {
    schema_version: "workspace-verify-proof-observed-evidence.v1",
    evidence_id: evidenceId,
    selected_test_id: expectedTestId,
    selected_status: events.some((event) => event.test_id === expectedTestId &&
      event.status === "passed") ? "passed" : "failed",
    file_exit_code: receipt.execution_result.exit_code,
    observed_count: events.length,
    returned_count: candidates.length,
    omitted_count: events.length - candidates.length,
    observed_identity_candidates: candidates
  };
}

function projectedSelectedIdentityNotObserved(detail, executionContext) {
  const projected = projectedBoundIdentityMismatch(detail);
  if (projected === null || !safeDeclaredTarget(detail.target) ||
      detail.target !== executionContext.declared_target ||
      ![null, "passed", "failed", "skipped", "todo"].includes(
        detail.file_wrapper_status
      ) || !Array.isArray(detail.file_wrapper_error_codes) ||
      detail.file_wrapper_error_codes.length > 8 ||
      detail.file_wrapper_error_codes.some((code) =>
        typeof code !== "string" || !SAFE_WRAPPER_ERROR_CODE_RE.test(code))) return null;
  return {
    ...projected,
    target: detail.target,
    file_wrapper_status: detail.file_wrapper_status,
    file_wrapper_error_codes: [...detail.file_wrapper_error_codes]
  };
}

function projectedEvidenceFailure(error, executionContext) {
  if (!Object.hasOwn(TEST_PROOF_EVIDENCE_FAILURES, error.code)) return null;
  const detail = error.detail;
  if (detail !== null && (typeof detail !== "object" || Array.isArray(detail))) return null;
  const projected = {
    ...executionContext,
    deepest_stable_cause_code: error.code
  };
  if (error.code === "test_proof_bound_identity_mismatch" ||
      error.code === "test_proof_selected_identity_not_observed") {
    const mismatch = error.code === "test_proof_bound_identity_mismatch"
      ? projectedBoundIdentityMismatch(detail)
      : projectedSelectedIdentityNotObserved(detail, executionContext);
    if (mismatch === null) return null;
    Object.assign(projected, mismatch);
  }
  if (detail?.test_proof_id !== undefined) {
    if (!SAFE_IDENTITY_RE.test(detail.test_proof_id)) return null;
    projected.test_proof_id = detail.test_proof_id;
  }
  if (detail?.verification_id !== undefined) {
    if (!SAFE_IDENTITY_RE.test(detail.verification_id) ||
        (projected.verification_id !== undefined &&
          projected.verification_id !== detail.verification_id)) return null;
    projected.verification_id = detail.verification_id;
  }
  if (detail?.execution_stage !== undefined) {
    if (!SAFE_EXECUTION_STAGES.includes(detail.execution_stage)) return null;
    projected.execution_stage = detail.execution_stage;
  }
  const executionFailure = TEST_PROOF_EVIDENCE_FAILURES[error.code] === null;
  if (executionFailure) {
    if (!SAFE_EXECUTION_STAGES.includes(projected.execution_stage)) return null;
    const runFacts = projectedRunFacts(detail?.run);
    if (runFacts === null) return null;
    Object.assign(projected, runFacts);
  }
  const stage = error.code.startsWith("test_proof_receipt_") ||
    error.code === "test_proof_runtime_evidence_invalid" ||
    error.code === "test_proof_artifact_untrusted" ||
    error.code === "test_proof_evidence_identity_invalid"
    ? "receipt" : null;
  if (stage !== null) projected.execution_stage = stage;
  return {
    details: projected,
    recovery_action: executionFailure
      ? evidenceExecutionRecovery(projected)
      : TEST_PROOF_EVIDENCE_FAILURES[error.code]
  };
}

function projectedProviderFailure(error, executionContext) {
  if (!TEST_PROOF_PROVIDER_CODES.has(error.code) || !STABLE_CODE_RE.test(error.code)) {
    return null;
  }
  return {
    details: {
      ...executionContext,
      deepest_stable_cause_code: error.code
    },
    recovery_action: error.code ===
      TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED
      ? "repair_the_launcher_execution_prerequisite_then_retry"
      : "repair_the_canonical_proof_provider_binding_then_retry"
  };
}

function projectedOperationDetail(error) {
  const details = error.details;
  if (details === null || typeof details !== "object" || Array.isArray(details)) return null;
  if (error.code === "verify_proof.subject_ambiguous.v1") {
    if (Object.hasOwn(details, "match_count")) {
      return Number.isSafeInteger(details.match_count) && details.match_count > 1
        ? { match_count: details.match_count } : null;
    }
    if (!Array.isArray(details.match_kinds) || details.match_kinds.length < 2 ||
        details.match_kinds.length > 4 || details.match_kinds.some((kind) =>
          !["wk", "slice", "test_proof", "obligation"].includes(kind))) return null;
    return { match_kinds: [...details.match_kinds] };
  }
  if (error.code.startsWith("verify_proof.runtime_binding_")) {
    if (error.code === "verify_proof.runtime_binding_resolution_failed.v1") {
      const packageCode = details.package_code;
      return packageCode === null || (typeof packageCode === "string" &&
        STABLE_CODE_RE.test(packageCode))
        ? { package_code: packageCode }
        : null;
    }
    const countKeys = [
      "expected_requested_count", "actual_requested_count",
      "expected_matched_count", "actual_matched_count",
      "expected_binding_count", "actual_binding_count",
      "expected_unique_verification_identity_count",
      "actual_unique_verification_identity_count",
      "invalid_verification_identity_count",
      "expected_verification_ids_omitted", "observed_verification_ids_omitted",
      "missing_verification_ids_omitted", "unexpected_verification_ids_omitted"
    ];
    if (countKeys.some((key) => details[key] !== null &&
        (!Number.isSafeInteger(details[key]) || details[key] < 0))) return null;
    const identityKeys = [
      "expected_verification_ids", "observed_verification_ids",
      "missing_verification_ids", "unexpected_verification_ids"
    ];
    if (identityKeys.some((key) => !Array.isArray(details[key]) ||
        details[key].length > MAX_PROJECTED_VERIFICATION_IDENTITIES ||
        details[key].some((id) => typeof id !== "string" || id.length === 0 ||
          id.length > 512 || /[\u0000-\u001f\u007f]/u.test(id)))) return null;
    for (const key of ["expected_contract_content_digest",
      "actual_contract_content_digest", "expected_controlled_contract_generation_digest",
      "actual_controlled_contract_generation_digest"]) {
      if (details[key] !== null && !DIGEST_RE.test(details[key])) return null;
    }
    if (details.expected_selection_status !== "complete" ||
        (details.actual_selection_status !== null &&
          (typeof details.actual_selection_status !== "string" ||
            details.actual_selection_status.length > 64 ||
            /[\u0000-\u001f\u007f]/u.test(details.actual_selection_status)))) return null;
    return Object.fromEntries([
      "expected_selection_status", "actual_selection_status",
      ...countKeys, ...identityKeys,
      "expected_contract_content_digest", "actual_contract_content_digest",
      "expected_controlled_contract_generation_digest",
      "actual_controlled_contract_generation_digest"
    ].map((key) => [key, structuredClone(details[key])]));
  }
  return {};
}

function projectVerifyProofFailure(error, { subject = null } = {}) {
  const chain = [];
  const seen = new Set();
  let current = error;
  let deepestFailure = null;
  let executionContext = null;
  projection: for (let depth = 0; depth < MAX_PROJECTED_CAUSE_DEPTH; depth += 1) {
    if (!current || typeof current !== "object" || seen.has(current)) {
      if (executionContext !== null) break;
      return null;
    }
    seen.add(current);
    let node;
    if (current instanceof VerifyProofExecutionError &&
        VERIFY_PROOF_EXECUTION_CODES.has(current.code)) {
      const details = projectedExecutionDetail(current, subject);
      if (details === null) return null;
      node = { code: current.code,
        owning_boundary: "agent-launch-core.workspace-agent-verify-proof-capability",
        details };
      executionContext = details;
      deepestFailure = {
        recovery_action: VERIFY_PROOF_EXECUTION_FAILURES[current.code]
      };
    } else if (current instanceof TestProofEvidenceError) {
      const failure = projectedEvidenceFailure(current, executionContext ?? {
        subject,
        outer_wrapper_code: null
      });
      if (failure === null) {
        if (executionContext !== null) break;
        return null;
      }
      node = { code: current.code,
        owning_boundary: "agent-launch-cli.workspace-agent-test-proof-evidence",
        details: failure.details };
      deepestFailure = failure;
    } else if (current instanceof TestProofProviderRegistryError) {
      const failure = projectedProviderFailure(current, executionContext ?? {
        subject,
        outer_wrapper_code: null
      });
      if (failure === null) {
        if (executionContext !== null) break;
        return null;
      }
      node = { code: current.code,
        owning_boundary: "agent-launch-cli.workspace-agent-test-proof-provider-registry",
        details: failure.details };
      deepestFailure = failure;
    } else if (current instanceof VerifyProofOperationError &&
        Object.hasOwn(VERIFY_PROOF_OPERATION_FAILURES, current.code)) {
      const details = projectedOperationDetail(current);
      if (details === null) {
        if (executionContext !== null) break;
        return null;
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
        if (executionContext !== null) break;
        return null;
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
        if (executionContext !== null) break;
        return null;
      }
      node = { code: current.code,
        owning_boundary: "agent-launch-cli.workspace-agent-orchestrator-test-proof-runtime",
        details: { selector } };
      deepestFailure = {
        recovery_action: ORCHESTRATOR_RUNTIME_FAILURES[current.code]
      };
    } else if (current instanceof ImmutableCandidateError &&
        Object.hasOwn(IMMUTABLE_CANDIDATE_RECOVERIES, current.detail?.reason)) {
      const detail = current.detail;
      const details = { reason: detail.reason };
      for (const key of ["expected_commit", "observed_commit", "expected_tree",
        "observed_tree"]) {
        if (detail[key] !== undefined) {
          if (typeof detail[key] !== "string" || !/^[a-f0-9]{40,64}$/u.test(detail[key])) {
            if (executionContext !== null) break projection;
            return null;
          }
          details[key] = detail[key];
        }
      }
      for (const key of ["worktree_registration_retained", "checkout_root_present",
        "filesystem_removal_failed"]) {
        if (detail[key] !== undefined) {
          if (typeof detail[key] !== "boolean") {
            if (executionContext !== null) break projection;
            return null;
          }
          details[key] = detail[key];
        }
      }
      if (detail.primary_error_code !== undefined && detail.primary_error_code !== null) {
        if (typeof detail.primary_error_code !== "string" ||
            !STABLE_CODE_RE.test(detail.primary_error_code)) {
          if (executionContext !== null) break;
          return null;
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
        if (executionContext !== null) break;
        return null;
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
      if (executionContext !== null) break;
      return null;
    }
    chain.push(Object.freeze(node));
    let cause;
    try { cause = current.cause; } catch {
      if (executionContext !== null) break;
      return null;
    }
    if (cause === undefined || cause === null) break;
    current = cause;
    if (depth === MAX_PROJECTED_CAUSE_DEPTH - 1) {
      if (executionContext !== null) break;
      return null;
    }
  }
  if (deepestFailure === null) return null;
  const deepest = chain.at(-1);
  const detail = deepest.details ?? {};
  const recoveryFacts = {};
  for (const key of ["declared_target", "verification_id", "test_proof_id",
    "expected_test_id", "observed_count", "returned_count", "omitted_count",
    "observed_identity_candidates", "file_wrapper_status", "file_wrapper_error_codes",
    "execution_stage", "timed_out", "disposition", "blocker_code", "reason",
    "selector", "expected_commit", "observed_commit", "expected_tree", "observed_tree"]) {
    if (detail[key] !== undefined) recoveryFacts[key] = structuredClone(detail[key]);
  }
  return boundPublicVerifyProofResult(Object.freeze({
    schema_version: VERIFY_PROOF_REFUSAL_SCHEMA_VERSION,
    subject: Object.freeze({ requested: subject, kind: null, canonical_id: null }),
    subject_binding: null,
    status: "not_executable",
    counts: Object.freeze({ proofs: 0, relationships: 0, satisfied: 0,
      unsatisfied: 0, not_executable: 0, ready: 0, nonready: 0,
      execution_not_started: 0 }),
    proof_results: Object.freeze([]),
    reason_code: deepest.code,
    recovery: Object.freeze({
      action: deepestFailure.recovery_action,
      retry_operation: VERIFY_PROOF_TOOL_NAME,
      ...(Object.keys(recoveryFacts).length === 0 ? {} : { facts: recoveryFacts })
    })
  }));
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function selectedUnit(record, address) {
  if (record?.id === address) return record;
  const [wkId, sliceId, ...rest] = String(address ?? "").split("#");
  if (rest.length > 0 || record?.id !== wkId) return null;
  return record.slices?.find(({ id }) => id === sliceId) ?? null;
}

function aggregateStatus(statuses) {
  if (statuses.includes("unsatisfied")) return "unsatisfied";
  if (statuses.includes("not_executable")) return "not_executable";
  return "satisfied";
}

function aggregateResult({ resolution, runtime, proofResults, reasonCode = null,
  diagnostics = [] }) {
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
    advisory: true,
    subject: structuredClone(resolution.subject),
    resolved_unit: resolution.wk_id,
    contract_generation: resolution.contract_generation,
    subject_binding: runtime?.candidateIdentity ?? null,
    reason_code: reasonCode,
    diagnostics: structuredClone(diagnostics),
    counts,
    proof_results: structuredClone(proofResults),
    downstream_authority: Object.freeze({ review: false, admission: false,
      closure: false, merge: false, lifecycle: false })
  };
  return Object.freeze({ ...body, result_digest: canonicalProofVerificationDigest(body) });
}

export function projectPublicVerifyProofAggregate(result) {
  const proofResults = result.proof_results.map((proof) => {
    const relationshipFailure = proof.relationship_results?.find(
      ({ status }) => status !== "satisfied");
    const reasonCode = proof.reason_code ?? relationshipFailure?.reason_code ?? null;
    return Object.freeze({
      test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_id,
      status: proof.status,
      readiness_status: proof.readiness_status,
      execution_status: proof.execution_status,
      ...(reasonCode === null ? {} : { reason_code: reasonCode }),
      ...(proof.readiness_status === "not_ready" && proof.recovery !== undefined
        ? { recovery: structuredClone(proof.recovery) }
        : proof.status === "unsatisfied" ? { recovery: Object.freeze({
          action: "repair_or_reassess_the_failed_selected_assertion",
          retry_operation: VERIFY_PROOF_TOOL_NAME
        }) } : {})
    });
  });
  return boundPublicVerifyProofResult(Object.freeze({
    schema_version: result.schema_version,
    subject: structuredClone(result.subject),
    subject_binding: Object.freeze({
      wk_id: result.resolved_unit,
      contract_generation: result.contract_generation,
      candidate_identity: result.subject_binding
    }),
    status: result.status,
    counts: structuredClone(result.counts),
    proof_results: Object.freeze(proofResults),
    ...(result.reason_code === null ? {} : {
      reason_code: result.reason_code,
      ...(result.reason_code === "verify_proof.population_not_ready.v1" ? {} : {
      recovery: Object.freeze({
        action: typeof result.recovery?.action === "string" &&
          STABLE_CODE_RE.test(result.recovery.action)
          ? result.recovery.action : "repair_the_named_proof_prerequisite",
        retry_operation: VERIFY_PROOF_TOOL_NAME })
      })
    })
  }));
}

function boundPublicVerifyProofResult(result) {
  if (Buffer.byteLength(JSON.stringify(result), "utf8") <= VERIFY_PROOF_PUBLIC_MAX_BYTES) {
    return result;
  }
  return Object.freeze({
    schema_version: VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION,
    subject: result.subject,
    subject_binding: result.subject_binding ?? null,
    status: "not_executable",
    counts: result.counts,
    proof_results: Object.freeze([]),
    reason_code: "verify_proof.public_result_size_exceeded.v1",
    recovery: Object.freeze({
      action: "narrow_the_requested_proof_subject",
      retry_operation: VERIFY_PROOF_TOOL_NAME
    })
  });
}

function preflightFailureResult(resolution, runtime) {
  const diagnostics = resolution.diagnostics ?? [];
  const proofResults = (resolution.proofs ?? []).map((proof) => {
    const blockers = diagnostics.filter((diagnostic) =>
      diagnostic.test_proof_id === proof.test_proof_id);
    const blocker = blockers.find((diagnostic) => [
      "verify_proof.runtime_test_inventory_missing.v1",
      "verify_proof.runtime_test_selection_missing.v1",
      "verify_proof.runtime_test_selection_invalid.v1"
    ].includes(diagnostic.reason_code)) ?? blockers[0] ?? null;
    const ready = blocker === null;
    const reasonCode = ready
      ? "verify_proof.atomic_preflight_blocked.v1"
      : blocker.reason_code;
    const recoveryOperation = blocker?.details?.recovery_operation;
    const recovery = ready ? undefined : Object.freeze({
      action: reasonCode === "verify_proof.runtime_test_inventory_missing.v1"
        ? "author_complete_observed_inventory_then_retry"
        : reasonCode === "verify_proof.runtime_test_selection_missing.v1"
          ? "author_one_exact_stable_runtime_test_identity_then_retry"
          : reasonCode === "verify_proof.runtime_test_selection_invalid.v1"
            ? "select_one_member_of_the_complete_current_test_population_then_retry"
            : "repair_the_named_proof_prerequisite",
      ...(typeof recoveryOperation === "string" && STABLE_CODE_RE.test(recoveryOperation)
        ? { authoring_operation: recoveryOperation }
        : {}),
      retry_operation: VERIFY_PROOF_TOOL_NAME
    });
    return {
      test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_id,
      status: "not_executable",
      readiness_status: ready ? "ready" : "not_ready",
      execution_status: "not_started",
      reason_code: reasonCode,
      ...(recovery === undefined ? {} : { recovery }),
      subject_binding_ref: "aggregate.subject_binding",
      declared_target: proof.declared_target?.status === "resolved"
        ? structuredClone(proof.declared_target) : null,
      relationship_results: proof.relationships.map((relationship) => ({
        obligation_id: relationship.obligation_id,
        status: "not_executable",
        reason_code: reasonCode,
        relation_ids: [...relationship.relation_ids]
      }))
    };
  });
  return aggregateResult({ resolution, runtime, proofResults,
    reasonCode: resolution.reason_code, diagnostics });
}

function individualResolution(population, proof, relationship) {
  return {
    status: "executable",
    obligation_id: relationship.obligation_id,
    contract_generation: population.contract_generation,
    contract_digest: population.contract_digest,
    obligation_coverage_digest: population.obligation_coverage_digest,
    proof_plan_digest: population.proof_plan_digest,
    proof_plan_entry_digest: relationship.proof_plan_entry_digest,
    proof_plan_entry: relationship.proof_plan_entry,
    behavior_claim_ids: relationship.behavior_claim_ids,
    verification_id: proof.verification_id,
    relation_ids: relationship.relation_ids,
    declared_target: proof.declared_target,
    test_proof: proof.test_proof,
    post_delivery_pack: population.post_delivery_pack
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

function boundedIdentities(values) {
  const safe = values.filter(isSafeVerificationIdentity).sort();
  return {
    values: safe.slice(0, MAX_PROJECTED_VERIFICATION_IDENTITIES),
    omitted: Math.max(0, safe.length - MAX_PROJECTED_VERIFICATION_IDENTITIES)
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
  const expected = boundedIdentities([...expectedSet]);
  const observed = boundedIdentities([...observedSet]);
  const missing = boundedIdentities([...expectedSet].filter((id) => !observedSet.has(id)));
  const unexpected = boundedIdentities([...observedSet].filter((id) => !expectedSet.has(id)));
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
  if (selection.content_digest !== resolution.contract_digest) failRuntimeBindingInvariant(
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

async function canonicalSubjectWkMatches({ root, subject }) {
  const recordRoot = path.join(root, "wiki", "work-records");
  const recordNames = readdirSync(recordRoot).filter((name) =>
    /^WK-[0-9]{4}\.json$/u.test(name)).sort();
  const matches = new Set();
  for (const name of recordNames) {
    const record = JSON.parse(readFileSync(path.join(recordRoot, name), "utf8"));
    if (record.id === subject || (record.slices ?? []).some((slice) =>
      `${record.id}#${slice.id}` === subject)) matches.add(record.id);
    const coveragePath = path.join(root, "wiki", "contracts",
      `${record.id}.obligation-coverage.json`);
    if (existsSync(coveragePath)) {
      const coverage = JSON.parse(readFileSync(coveragePath, "utf8"));
      if ((coverage.obligations ?? []).some(({ obligation_id: id }) => id === subject)) {
        matches.add(record.id);
      }
    }
    const manifestPath = path.join(root, "wiki", "contracts",
      `${record.id}.carrier-set-manifest.json`);
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const contractMember = manifest.carriers?.find(({ carrier_kind: kind }) => kind === "contract");
    if (!contractMember) continue;
    const contractPath = path.join(root, "wiki", "contracts", contractMember.path);
    if (!existsSync(contractPath)) continue;
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    if ((contract.test_proofs ?? []).some(({ test_proof_id: id }) => id === subject)) {
      matches.add(record.id);
    }
  }
  return [...matches].sort();
}

async function resolveCanonicalSubjectWkId({ repoRoot, subject }) {
  const matches = await canonicalSubjectWkMatches({ root: repoRoot, subject });
  if (matches.length === 0) throw new VerifyProofOperationError(
    "verify_proof.subject_unknown.v1",
    "subject does not exist in canonical work-record and contract relationships"
  );
  if (matches.length !== 1) throw new VerifyProofOperationError(
    "verify_proof.subject_ambiguous.v1",
    "subject is ambiguous across canonical work-record and contract relationships",
    { match_count: matches.length }
  );
  return matches[0];
}

async function gitIdentity(root) {
  const [commitResult, treeResult] = await Promise.all([
    defaultTerminalCandidateRunGit({ repo: root,
      args: ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{commit}"] }),
    defaultTerminalCandidateRunGit({ repo: root,
      args: ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{tree}"] })
  ]);
  const commit = commitResult?.ok === true ? String(commitResult.stdout ?? "").trim() : null;
  const tree = treeResult?.ok === true ? String(treeResult.stdout ?? "").trim() : null;
  if (!/^[a-f0-9]{40,64}$/u.test(commit ?? "") ||
      !/^[a-f0-9]{40,64}$/u.test(tree ?? "")) throw Object.assign(new Error(
    "launcher review materialization has no exact Git candidate identity"
  ), { code: "verify_proof.reviewer_candidate_unresolved.v1" });
  return { commit, tree };
}

async function resolveRuntimeAuthority({ env, mainRepo, state, wkId }) {
  if (state.role === "worker") {
    const credential = state.credential;
    if (!credential || state.assignedUnit?.startsWith(`${wkId}#`) !== true) throw Object.assign(
      new Error("managed worker proof authority is unavailable"),
      { code: "verify_proof.worker_authority_unavailable.v1" });
    const binding = verifyExactSliceCommitBinding({
      binding: resolveWorktreeBinding({ mainRepo, launchRef: credential.launchRef,
        runId: credential.runId, retryId: credential.retryId }),
      mainRepo,
      assignedUnit: state.assignedUnit,
      launchRef: credential.launchRef,
      runId: credential.runId,
      retryId: credential.retryId
    });
    const managed = mintManagedWorkerTestRunAuthority({ commitBinding: binding, mainRepo });
    const authority = mintManagedWorkerTestProofRuntimeAuthority({ authority: managed });
    return { authority, role: "worker", selectedUnitAddress: state.assignedUnit,
      candidateIdentity: authority.candidate_identity ?? authority.run_id };
  }
  if (state.role !== "reviewer" || state.assignedUnit?.startsWith(`${wkId}#`) !== true) {
    throw Object.assign(new Error(
      "verify_proof is available only in eligible launcher-managed worker and reviewer sessions"
    ), { code: "verify_proof.role_ineligible.v1" });
  }
  const artifact = resolveFrozenReviewContractArtifact({ state });
  if (artifact.status === "refused" || artifact.technical_role !== "reviewer" ||
      artifact.canonical_parent_wk_contract?.id !== wkId) throw Object.assign(new Error(
    "managed reviewer frozen contract is unavailable or cross-bound"
  ), { code: "verify_proof.reviewer_frozen_contract_refused.v1" });
  const root = realpathSync(env.WIKI_MCP_REVIEW_MATERIALIZATION_DIR ?? "");
  const identity = await gitIdentity(root);
  const runDigest = createHash("sha256").update(
    `${state.credential.launchRef}\0${state.credential.runId}\0${state.credential.retryId}`
  ).digest("hex");
  const authority = await mintManagedReviewerTestProofRuntimeAuthority({
    mainRepo,
    worktreePath: root,
    runId: `run-review-${runDigest}`,
    wkId,
    selectedUnit: state.assignedUnit,
    reviewedSha: identity.commit,
    reviewedTree: identity.tree
  });
  return { authority, role: "reviewer", selectedUnitAddress: state.assignedUnit,
    candidateIdentity: identity.commit,
    reviewedTargetBinding: Object.freeze({
      schema_version: "launcher-frozen-reviewed-test-target-binding.v1",
      reviewer_unit: state.assignedUnit,
      reviewed_unit: artifact.review_unit_contract.admission_review_target_unit ?? null,
      artifact_digest: artifact.artifact_digest
    }) };
}

async function resolveProductionContext({ args, repoRoot, env, state = null, wkId }) {
  const authenticatedState = state ?? resolveLauncherRunState(env);
  const runtime = await resolveRuntimeAuthority({
    env, mainRepo: repoRoot, state: authenticatedState, wkId
  });
  const root = runtime.authority.worktree_path;
  const [contract, proofPlan, generation, pack] = await Promise.all([
    readControlledContractCarrierFile({ repoRoot: root, wkId, focus: null,
      carrierKind: "contract" }),
    readControlledContractCarrierFile({ repoRoot: root, wkId, focus: null,
      carrierKind: "proof_plan" }),
    readControlledContractGeneration({ repoRoot: root, wkId }),
    loadExactAdmittedProofPack({ profileId: "proof.verification.test-validity",
      profileVersion: "4.0.0", evaluationStage: "post_delivery" })
  ]);
  const coveragePath = path.join(root, "wiki", "contracts", `${wkId}.obligation-coverage.json`);
  const recordPath = path.join(root, "wiki", "work-records", `${wkId}.json`);
  const coverageBytes = readFileSync(coveragePath);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const unit = selectedUnit(record, runtime.selectedUnitAddress);
  if (unit === null) throw Object.assign(new Error(
    "launcher-selected unit is absent from the exact candidate work record"
  ), { code: "verify_proof.selected_unit_unresolved.v1" });
  const source = captureLauncherTestProofSourceSnapshot(runtime.authority);
  return {
    runtime: runtime.role === "worker" ? {
      ...runtime,
      executionAuthorityIdentity: runtime.candidateIdentity,
      candidateIdentity: source.source_snapshot_digest
    } : runtime,
    resolutionContext: {
      obligationCoverage: JSON.parse(coverageBytes.toString("utf8")),
      obligationCoverageDigest: digestBytes(coverageBytes),
      controlledContract: contract.content,
      contractWkId: generation.wk_id,
      contractDigest: contract.content_digest,
      contractGeneration: generation.generation_digest,
      proofPlan: proofPlan.content,
      proofPlanDigest: proofPlan.content_digest,
      postDeliveryPack: pack,
      workRecord: record,
      selectedUnit: unit,
      authenticatedRole: runtime.role,
      reviewedTargetBinding: runtime.reviewedTargetBinding ?? null,
      sourceSnapshotDigest: source.source_snapshot_digest
    }
  };
}

export async function executeVerifyProofForContext({
  args,
  resolutionContext,
  runtime,
  deps = {}
} = {}) {
  const resolveOperation = deps.resolveVerifyProofOperation ?? resolveVerifyProofOperation;
  const resolution = resolveOperation({ args, context: resolutionContext });
  if (resolution.status === "not_executable") return preflightFailureResult(
    resolution, runtime
  );
  const targets = [...new Set(resolution.proofs.map((proof) =>
    proof.declared_target.target))].sort();
  const validationBindings = Object.fromEntries(targets.map((target) => [target,
    resolution.proofs.filter((proof) => proof.declared_target.target === target)
      .map(({ verification_id: id }) => id).sort()
  ]));
  const verificationIds = resolution.proofs.map(({ verification_id: id }) => id).sort();
  const resolveBindings = deps.resolveBindings ??
    resolveControlledContractTestProofRuntimeBindings;
  let completeSelection;
  try {
    completeSelection = await resolveBindings({
      repoRoot: runtime.authority.worktree_path,
      wkId: resolution.wk_id,
      verificationIds
    });
  } catch (error) {
    const packageCode = typeof error?.code === "string" && STABLE_CODE_RE.test(error.code)
      ? error.code : null;
    throw new VerifyProofOperationError(
      "verify_proof.runtime_binding_resolution_failed.v1",
      "internal controlled test-proof binding resolution failed",
      { package_code: packageCode }
    );
  }
  assertCompleteRuntimeSelection(completeSelection, verificationIds, resolution);
  const executed = await (deps.executeLauncherVerifyProofReceiptPopulation ??
    executeLauncherVerifyProofReceiptPopulation)({
    roleContext: { role: runtime.role, managed: runtime.role !== "orchestrator",
      candidate_identity: runtime.executionAuthorityIdentity ?? runtime.candidateIdentity },
    proofAuthority: runtime.authority,
    targets,
    validationBindings,
    resolveBindings: async ({ verificationIds: requested }) =>
      subsetSelection(completeSelection, requested),
    mintAttemptContext: deps.mintAttemptContext ?? mintLauncherTestProofAttemptContext,
    runAttempt: deps.runAttempt ?? runWorkspaceAgentTestProofAttempt,
    extractReceipt: deps.extractReceipt ?? extractTestProofRuntimeEvidenceReceipt,
    assertCurrentIdentity: typeof runtime.assertCurrentIdentity === "function"
      ? runtime.assertCurrentIdentity
      : runtime.role === "reviewer"
        ? () => (deps.assertReviewerCurrent ??
          assertManagedReviewerTestProofRuntimeCurrent)(runtime.authority)
        : null
  });
  const evidenceByVerification = new Map();
  for (const target of targets) {
    const ids = validationBindings[target];
    const evidence = executed.evidence_by_target[target] ?? [];
    ids.forEach((id, index) => evidenceByVerification.set(id, evidence[index]));
  }
  const proofResults = resolution.proofs.map((proof) => {
    const receipts = [evidenceByVerification.get(proof.verification_id)].filter(Boolean);
    const relationshipResults = proof.relationships.map((relationship) => {
      const one = individualResolution(resolution, proof, relationship);
      const semanticFacts = (deps.evaluateSemantics ?? evaluateTestProofEvidenceSemantics)({
        resolution: one,
        receipts,
        expected: {
          wk_id: runtime.authority.wk_id,
          selected_unit: runtime.authority.selected_unit,
          source_snapshot_digest: proof.declared_target.source_snapshot_digest,
          test_id: proof.test_proof.runtime_test_identity.test_id,
          candidate: { identity: runtime.candidateIdentity, role: runtime.role }
        }
      });
      if (semanticFacts.status === "not_executable") return {
        obligation_id: relationship.obligation_id,
        status: "not_executable",
        reason_code: semanticFacts.reason_code,
        relation_ids: [...relationship.relation_ids],
        diagnostics: []
      };
      const evaluation = resolution.post_delivery_pack.test_validity_evaluator.evaluate({
        semantic_facts: semanticFacts
      });
      const result = buildProofVerificationResult({ resolution: one, semanticFacts, evaluation });
      const { candidate: _candidate, ...proofInstance } = result.proof_instance;
      return {
        obligation_id: relationship.obligation_id,
        status: result.status,
        reason_code: result.reason_code,
        relation_ids: [...relationship.relation_ids],
        diagnostics: result.diagnostics,
        proof_instance: { ...proofInstance,
          subject_binding_ref: "aggregate.subject_binding" },
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
      observed_evidence: boundedObservedEvidence(
        receipts[0], proof.declared_target.target,
        proof.test_proof.runtime_test_identity.test_id
      ),
      relationship_results: relationshipResults
    };
  });
  return aggregateResult({ resolution, runtime, proofResults });
}

async function executeProductionVerifyProof({ args, env, repoRoot, repository, deps }) {
  const state = (deps.resolveLauncherRunState ?? resolveLauncherRunState)(env);
  assertVerifyProofCallerShape(args, { authenticatedRole: state.role });
  const wkId = state.role === "orchestrator"
    ? await (deps.resolveCanonicalSubjectWkId ?? resolveCanonicalSubjectWkId)({
      repoRoot, subject: args.subject
    })
    : state.assignedUnit?.split("#")[0];
  if (typeof wkId !== "string") throw Object.assign(new Error(
    "launcher-bound subject has no canonical WK identity"
  ), { code: "verify_proof.subject_unknown.v1" });
  if (state.role !== "orchestrator") {
    const context = await (deps.resolveProductionContext ?? resolveProductionContext)({
      args, repoRoot, env, state, wkId
    });
    return executeVerifyProofForContext({
      args,
      resolutionContext: context.resolutionContext,
      runtime: context.runtime,
      deps
    });
  }
  const result = await (deps.withOrchestratorTestProofRuntime ??
    withOrchestratorTestProofRuntime)({
    mainRepo: repoRoot,
    repository,
    selectedUnit: wkId,
    ...(args.git_sha === undefined ? {} : {
      worktreeRoot: (deps.resolveDispatchWorktreeProvisioningConfig ??
        resolveDispatchWorktreeProvisioningConfig)(env)?.worktreeRoot
    }),
    ...(args.git_sha === undefined ? {} : { gitSha: args.git_sha })
  }, async (runtime) => {
    const context = await resolveProductionContextFromRuntime({ args, runtime });
    return executeVerifyProofForContext({
      args,
      resolutionContext: context.resolutionContext,
      runtime,
      deps
    });
  });
  if (result?.schema_version === VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION) return result;
  const resolution = {
    subject: { requested: args.subject, kind: null, canonical_id: null },
    wk_id: wkId,
    contract_generation: null
  };
  return Object.freeze({ ...aggregateResult({
    resolution,
    runtime: null,
    proofResults: [],
    reasonCode: result.reason_code,
    diagnostics: []
  }), ...(result.recovery === undefined ? {} : { recovery: result.recovery }) });
}

async function resolveProductionContextFromRuntime({ args, runtime }) {
  const wkId = runtime.authority.wk_id;
  const root = runtime.authority.worktree_path;
  const [contract, proofPlan, generation, pack] = await Promise.all([
    readControlledContractCarrierFile({ repoRoot: root, wkId, focus: null,
      carrierKind: "contract" }),
    readControlledContractCarrierFile({ repoRoot: root, wkId, focus: null,
      carrierKind: "proof_plan" }),
    readControlledContractGeneration({ repoRoot: root, wkId }),
    loadExactAdmittedProofPack({ profileId: "proof.verification.test-validity",
      profileVersion: "4.0.0", evaluationStage: "post_delivery" })
  ]);
  const coveragePath = path.join(root, "wiki", "contracts", `${wkId}.obligation-coverage.json`);
  const recordPath = path.join(root, "wiki", "work-records", `${wkId}.json`);
  const coverageBytes = readFileSync(coveragePath);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const unit = selectedUnit(record, runtime.selectedUnitAddress);
  if (unit === null) throw Object.assign(new Error(
    "orchestrator-selected unit is absent from the authenticated existing worktree"
  ), { code: "verify_proof.selected_unit_unresolved.v1" });
  return {
    resolutionContext: {
      obligationCoverage: JSON.parse(coverageBytes.toString("utf8")),
      obligationCoverageDigest: digestBytes(coverageBytes),
      controlledContract: contract.content,
      contractWkId: generation.wk_id,
      contractDigest: contract.content_digest,
      contractGeneration: generation.generation_digest,
      proofPlan: proofPlan.content,
      proofPlanDigest: proofPlan.content_digest,
      postDeliveryPack: pack,
      workRecord: record,
      selectedUnit: unit,
      authenticatedRole: "orchestrator",
      reviewedTargetBinding: null,
      sourceSnapshotDigest: runtime.authority.source_snapshot_digest
    }
  };
}

export function registerVerifyProofTool({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  env = process.env,
  deps = {}
}) {
  registerTool(VERIFY_PROOF_TOOL_NAME, {
    writeSemantics: MCP_WRITE_SEMANTICS.NONE,
    description: "Verify the complete declared proof population selected by one canonical subject: a WK, slice, test-proof ID, or obligation ID. Input is required subject plus optional repo and orchestrator-only git_sha. The server resolves relationships, preflights every proof with package-owned readiness before any process starts, and returns one deterministic aggregate shape. Omitted git_sha executes directly in the configured clean or dirty worktree. Supplied git_sha uses the review-shared launcher-owned lifecycle to create, authenticate, execute in, and remove one private detached exact-commit worktree, including Git worktree administration writes. No caller path is accepted. Side effects: confined process_spawn and exact-SHA-only workspace_write. Results are purpose-neutral, advisory, and non-authoritative.",
    inputSchema: z.object({
      subject: z.string().min(1).max(512),
      repo: z.string().optional(),
      git_sha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u).optional()
    }).strict()
  }, async (args) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const result = await executeProductionVerifyProof({
        args,
        env,
        repoRoot: realpathSync(path.resolve(workspace.dir)),
        repository: workspace.repo,
        deps
      });
      return jsonContent(projectPublicVerifyProofAggregate(result));
    } catch (error) {
      const envelope = projectVerifyProofFailure(error, { subject: args.subject });
      if (envelope === null) return errorContent(error);
      const projected = Object.assign(new Error(
        "workspace_verify_proof refused a modeled proof failure"
      ), { code: envelope.code, envelope });
      return errorContent(projected);
    }
  });
}
