import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { coverageUnitArguments } from
  "../../../wiki-core/src/operations/controlled-contract/coverage-recovery-guidance.mjs";
import { projectObservedIdentity } from "./verify-proof-result-detail.mjs";
import { PROVIDER_REFUSAL_PRECEDENCE } from "@agent-chassis/controlled-contract";
import { VERIFY_PROOF_EXECUTION_FAILURE_CODES } from
  "../../../agent-launch-cli/src/lib/workspace-agent-verify-proof-capability.mjs";
import { ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES } from
  "../../../agent-launch-cli/src/lib/workspace-agent-orchestrator-test-proof-runtime.mjs";
import { TEST_PROOF_SELECTED_TEST_SKIPPED_CODE } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-node-observation.mjs";
import { TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-provider-registry.mjs";
import { TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-module-fault-contract.mjs";
import { isLauncherTestFailureDiagnostic, projectSelectedTestFailureDiagnostic } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-error-diagnostic.mjs";
import { publicRunFacts } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-run-facts.mjs";
import { parseProofSourceUnitAddress as parseProofAuthoringUnitAddress } from
  "../../../wiki-core/src/operations/controlled-contract/saved-proof-source.mjs";
import { isControlledContractFocus } from
  "../../../wiki-core/src/lib/controlled-contract-tools.mjs";

export const VERIFY_PROOF_REFUSAL_SCHEMA_VERSION = "workspace-verify-proof-refusal.v1";
export const VERIFY_PROOF_EXECUTION_CODES = new Set(
  Object.values(VERIFY_PROOF_EXECUTION_FAILURE_CODES)
);
export const VERIFY_PROOF_EXECUTION_FAILURES = Object.freeze({
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

const INFRASTRUCTURE_CORRECTION_OWNERS = Object.freeze({
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.INPUT_INVALID]: "verify_proof_server",
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.ATTEMPT_CONTEXT]: "launcher_verify_proof_execution",
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.ATTEMPT_EXECUTION]: "launcher_verify_proof_execution",
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.RECEIPT_INCOMPLETE]: "launcher_test_proof_provider",
  [VERIFY_PROOF_EXECUTION_FAILURE_CODES.RECEIPT_CROSS_BOUND]: "launcher_test_proof_provider",
  test_proof_caller_executor_forbidden: "verify_proof_server",
  test_proof_artifact_untrusted: "launcher_test_proof_provider",
  test_proof_evidence_identity_invalid: "launcher_test_proof_provider",
  test_proof_receipt_projection_digest_mismatch: "launcher_test_proof_provider",
  test_proof_receipt_projection_invalid: "launcher_test_proof_provider",
  test_proof_runtime_evidence_invalid: "launcher_test_proof_provider",
  test_proof_native_import_policy_unenforced: "launcher_test_proof_provider",
  [TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED]: "launcher_test_proof_provider"
});

export function infrastructureCorrection(condition) {
  if (typeof condition !== "string" ||
      !Object.hasOwn(INFRASTRUCTURE_CORRECTION_OWNERS, condition)) return null;
  return { retry: false, correction_owner: INFRASTRUCTURE_CORRECTION_OWNERS[condition], condition };
}

const TEST_PROOF_EVIDENCE_FAILURES = Object.freeze({
  test_proof_artifact_untrusted: "repair_the_receipt_provider_protocol_then_retry",
  test_proof_bound_identity_mismatch: "repair_the_reporter_identity_binding_then_retry",
  test_proof_selected_identity_not_observed:
    "repair_the_declared_test_startup_or_reporter_observation_then_retry",

  test_proof_selected_test_skipped: "remove_the_selected_test_skip_then_retry",
  test_proof_caller_executor_forbidden:
    "repair_the_server_owned_verify_proof_execution_input_then_retry",
  test_proof_candidate_execution_error: null,

  test_proof_candidate_inventory_missing: "resolve_the_selected_test_observation_failure_then_retry",
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
  test_proof_test_selector_invalid: "author_a_valid_declarative_test_selector_then_retry",
  test_proof_traversal_execution_error: null,
  test_proof_traversal_provider_invalid: "repair_the_canonical_proof_binding_then_retry"
});
const TEST_PROOF_PROVIDER_CODES = new Set([
  ...Object.values(TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES),
  ...PROVIDER_REFUSAL_PRECEDENCE
]);
export const ORCHESTRATOR_RUNTIME_FAILURES = Object.freeze({
  [ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.WORKTREE_BINDING]:
    "repair_the_configured_current_worktree_binding_then_retry",
  [ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.WORKTREE_MOVED]:
    "stabilize_the_configured_current_worktree_then_retry",
  [ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.EXACT_DEPENDENCY_PROJECTION]:
    "repair_the_authenticated_exact_candidate_dependency_projection_then_retry"
});

const OID_RE = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
export function projectedDependencyProjectionFacts(detail) {
  const facts = {};
  if (detail?.candidate_commit !== undefined) {
    if (typeof detail.candidate_commit !== "string" || !OID_RE.test(detail.candidate_commit)) return null;
    facts.candidate_commit = detail.candidate_commit;
  }
  if (detail?.validator_cache !== undefined) {
    const cache = detail.validator_cache;
    if (cache === null || typeof cache !== "object" || Array.isArray(cache) ||
        Object.keys(cache).some((key) => key !== "cache_root" && key !== "path") ||
        Object.values(cache).some((value) => typeof value !== "string" ||
          !path.isAbsolute(value) || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value))) {
      return null;
    }
    if (Object.keys(cache).length > 0) facts.validator_cache = { ...cache };
  }
  return facts;
}

const VALIDATOR_CACHE_CONTAINMENT_CODE = "validator_cache_containment_violation";
const VERIFY_PROOF_TOOL_NAME = "workspace_verify_proof";
export function dependencyProjectionCorrection(details, subject) {
  if (details.cause_code !== VALIDATOR_CACHE_CONTAINMENT_CODE) return null;
  const unreported = [
    ...(typeof subject === "string" && subject.length > 0 ? [] : ["requested_subject"]),
    ...(details.candidate_commit === undefined ? ["candidate_commit"] : []),
    ...(details.validator_cache === undefined ? ["validator_cache_location"] : [])
  ];
  return {
    recovery_action: "operator_corrects_the_validator_cache_containment_then_verify_again",
    retry: false,
    correction_owner: "operator",
    condition: VALIDATOR_CACHE_CONTAINMENT_CODE,
    correction: {
      actor: "operator",
      affected: {
        ...(unreported.includes("requested_subject") ? {} : { subject }),
        ...(details.candidate_commit === undefined ? {} : { candidate_commit: details.candidate_commit }),
        ...(details.validator_cache === undefined ? {} : { validator_cache: { ...details.validator_cache } })
      },
      known_effects: { proof_execution: "not_started", validator_cache_writes_by_verification: "none" },
      uncertainty: {
        validator_cache_contents: "unknown_whether_written_by_another_actor",
        ...(unreported.length === 0 ? {} : { unreported_facts: unreported })
      },
      steps: [
        "remove_the_affected_validator_cache_root_or_group",
        "investigate_who_redirected_or_made_the_cache_writable",
        "republish_the_cache_with_prepare_validator_cache"
      ],
      runbook: "the project documentation#recovering-a-bad-artifact",
      agent_capability: "none: verification never chmods, deletes or rebuilds the cache",
      ...(unreported.includes("requested_subject") || details.candidate_commit === undefined ? {} : {
        verify_after_correction: { tool: VERIFY_PROOF_TOOL_NAME,
          arguments: { subject, git_sha: details.candidate_commit } }
      })
    }
  };
}

export const IMMUTABLE_CANDIDATE_RECOVERIES = Object.freeze({
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
  "open_the_controlled_contract_design_workbench_then_retry";
export const VERIFY_PROOF_OPERATION_FAILURES = Object.freeze({
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
  },
  "verify_proof.environment_incompatible.v1": {
    recovery_action: "name_a_prepared_environment_applicable_to_every_selected_proof_or_omit_environment",
    owning_boundary: "wiki-mcp.workspace-verify-proof-environment-selection"
  }
});
const ENVIRONMENT_REASONS = new Set(["ecosystem_mismatch", "runner_not_proved",
  "target_outside_environment", "provider_unknown",
  "environment_unavailable"]);
const boundedText = (value) => typeof value === "string" && value.length > 0 && value.length <= 512 &&
  !/[\u0000-\u001f\u007f]/u.test(value);

function projectedEnvironmentSelectionDetail(details) {
  const ids = (values) => Array.isArray(values) && values.every(boundedText);
  if (!boundedText(details.requested_environment) || !ids(details.valid_choices) ||
      !ids(details.prepared_environments) || !Array.isArray(details.incompatible) ||
      details.incompatible.length === 0) return null;
  const incompatible = [];
  for (const entry of details.incompatible) {
    if (!boundedText(entry?.test_proof_id) || !boundedText(entry?.target) || !ids(entry?.obligation_ids) ||
        !ENVIRONMENT_REASONS.has(entry?.reason) ||
        (entry.code !== null && (typeof entry.code !== "string" || !STABLE_CODE_RE.test(entry.code)))) {
      return null;
    }
    incompatible.push({ test_proof_id: entry.test_proof_id, obligation_ids: [...entry.obligation_ids],
      target: entry.target,
      family_id: entry.family_id ?? null, reason: entry.reason, code: entry.code,
      ...(entry.runner === undefined ? {} : { runner: entry.runner }) });
  }
  return { requested_environment: details.requested_environment, incompatible,
    valid_choices: [...details.valid_choices], prepared_environments: [...details.prepared_environments] };
}
const SOURCE_BINDING_BOUNDARY =
  "wiki-core.controlled-contract.verify-proof-source-binding";
const SUBJECT_AMBIGUOUS_CODE = "verify_proof.subject_ambiguous.v1";

export const VERIFY_PROOF_SOURCE_SELECTION_FAILURES = Object.freeze({
  "verify_proof.source_invalid.v1": Object.freeze({
    recovery_action: "correct_the_closed_source_selection_then_retry",
    owning_boundary: WIKI_CORE_VERIFY_PROOF_BOUNDARY
  }),
  "verify_proof.source_subject_conflict.v1": Object.freeze({
    recovery_action: "omit_source_for_a_population_subject_then_retry",
    owning_boundary: WIKI_CORE_VERIFY_PROOF_BOUNDARY
  }),
  "verify_proof.source_tuple_ambiguous.v1": Object.freeze({
    recovery_action: "select_source",
    owning_boundary: SOURCE_BINDING_BOUNDARY
  }),
  [SUBJECT_AMBIGUOUS_CODE]: Object.freeze({
    recovery_action: "select_source",
    owning_boundary: WIKI_CORE_VERIFY_PROOF_BOUNDARY
  })
});
const SOURCE_ACCEPTED_FORM = Object.freeze({
  unit: "a canonical WK ID (WK-1234) or slice address (WK-1234#SLICE-001)",
  focus: "omit for the root source, or one canonical lowercase focus slug of at most 128 UTF-8 bytes"
});
const SOURCE_INVALID_FIELDS = new Set(["source", "source.unit", "source.focus"]);
const PERMITTED_RETRY_OPTIONS = Object.freeze(["repo", "timeout", "git_sha", "environment"]);

function canonicalSubject(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function canonicalSourceChoice(choice) {
  if (choice === null || typeof choice !== "object" || Array.isArray(choice) ||
      Object.keys(choice).some((key) => !["unit", "focus"].includes(key))) return null;
  try {
    parseProofAuthoringUnitAddress(choice.unit);
  } catch {
    return null;
  }
  if (Object.hasOwn(choice, "focus") && (choice.focus === null ||
      !isControlledContractFocus(choice.focus))) return null;
  return { unit: choice.unit, ...(Object.hasOwn(choice, "focus") ? { focus: choice.focus } : {}) };
}

export function isVerifyProofSourceSelectionFailure(error) {
  if (!Object.hasOwn(VERIFY_PROOF_SOURCE_SELECTION_FAILURES, error?.code)) return false;
  return error.code !== SUBJECT_AMBIGUOUS_CODE || Array.isArray(error.details?.source_choices);
}

export function projectVerifyProofSourceRetryCalls(choices, { subject, request = {} }) {
  const options = Object.fromEntries(PERMITTED_RETRY_OPTIONS
    .filter((key) => request?.[key] !== undefined)
    .map((key) => [key, structuredClone(request[key])]));
  return choices.map((choice) => Object.freeze({
    tool: "workspace_verify_proof",
    arguments: Object.freeze({ subject, source: Object.freeze({ ...choice }), ...options })
  }));
}

export function projectedSourceSelectionDetail(error) {
  const details = error.details;
  if (details === null || typeof details !== "object" || Array.isArray(details)) return null;
  if (error.code === "verify_proof.source_invalid.v1") {
    if (!SOURCE_INVALID_FIELDS.has(details.field) || typeof details.cause !== "string" ||
        !STABLE_CODE_RE.test(details.cause)) return null;
    const unsupported = details.unsupported_keys;
    if (unsupported !== undefined && (!Array.isArray(unsupported) || unsupported.length > 64 ||
        unsupported.some((key) => !canonicalSubject(key) || key.length > 128))) return null;
    return { details: { field: details.field, cause: details.cause,
      ...(unsupported === undefined ? {} : { unsupported_keys: [...unsupported] }),
      accepted_form: { ...SOURCE_ACCEPTED_FORM } }, choices: null };
  }
  if (error.code === "verify_proof.source_subject_conflict.v1") {
    if (details.field !== "source" || typeof details.cause !== "string" ||
        !STABLE_CODE_RE.test(details.cause) || !canonicalSubject(details.subject) ||
        canonicalSourceChoice({ unit: details.source_unit }) === null) return null;
    return { details: { field: "source", cause: details.cause, subject: details.subject,
      source_unit: details.source_unit }, choices: null };
  }
  const choices = details.source_choices;
  if (!Array.isArray(choices) || details.choice_count !== choices.length ||
      !Number.isSafeInteger(details.match_count) || details.match_count < 2) return null;
  const projected = choices.map(canonicalSourceChoice);
  if (projected.some((choice) => choice === null) ||
      new Set(projected.map((choice) => JSON.stringify(choice))).size !== projected.length) return null;
  if (error.code !== SUBJECT_AMBIGUOUS_CODE && !canonicalSubject(details.subject)) return null;
  return { details: { ...(details.subject === undefined ? {} : { subject: details.subject }),
    match_count: details.match_count, choice_count: projected.length }, choices: projected };
}

const TEST_ID_RE = /^test-[a-f0-9]{64}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const WK_ID_RE = /^WK-[0-9]{4}$/u;
const FOCUS_RE = /^(?!wk-[0-9])(?!slice-[0-9]+$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function projectProofAuthoringRecoveryCall(call, { wkId = null, source = null,
  obligationId = null } = {}) {
  const callKeys = call && typeof call === "object" && !Array.isArray(call)
    ? Object.keys(call) : [];
  const args = call?.arguments;
  if (call?.tool !== "workspace_controlled_contract_obligation_coverage_query" ||
      callKeys.length !== 2 || !callKeys.includes("tool") || !callKeys.includes("arguments") ||
      args === null || typeof args !== "object" || Array.isArray(args)) return null;
  if (obligationId !== null) {
    if (typeof obligationId !== "string" || !WK_ID_RE.test(source?.wkId ?? "")) return null;
    const expected = { ...coverageUnitArguments({ wkId: source.wkId, focus: source.focus ?? null,
      selectedUnit: source.selectedUnit ?? null }), obligation_id: obligationId };
    return isDeepStrictEqual({ ...args }, expected) ? structuredClone(call) : null;
  }
  const argumentKeys = Object.keys(args);
  if (!argumentKeys.includes("unit") ||
      argumentKeys.some((key) => !["unit", "focus"].includes(key)) ||
      !WK_ID_RE.test(args.unit ?? "") ||
      (wkId !== null && args.unit !== wkId) ||
      (Object.hasOwn(args, "focus") &&
        (typeof args.focus !== "string" || !FOCUS_RE.test(args.focus)))) return null;
  return structuredClone(call);
}

export const TEST_PROOF_FAILURES = Object.freeze({
  test_proof_test_selector_invalid: {
    recovery_action: "author_a_valid_declarative_test_selector_then_retry",
    detail(detail) {
      const packageCode = detail?.package_code;
      return (packageCode === null || packageCode === undefined ||
        (typeof packageCode === "string" && STABLE_CODE_RE.test(packageCode))) &&
        detail?.authority_limb === "mechanical_failure" &&
        detail?.admissibility_effect === "none"
        ? { ...(packageCode ? { cause_code: packageCode } : {}),
            authority_limb: "mechanical_failure", admissibility_effect: "none",
            ...(projectProofAuthoringRecoveryCall(detail?.recovery_call) === null ? {} : {
              recovery_call: projectProofAuthoringRecoveryCall(detail.recovery_call)
            }) }
        : null;
    }
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

        ? { entry_kind: "symbolic_link", path: detail.path }
        : null;
    }
  },
  test_proof_exact_candidate_dependency_projection_unavailable: {
    recovery_action: "repair_the_authenticated_exact_candidate_dependency_projection_then_retry",
    detail(detail) {
      return typeof detail?.reason_code === "string" &&
        /^[a-z0-9_.-]{1,160}$/u.test(detail.reason_code)
        ? { cause_code: detail.reason_code }
        : null;
    }
  }
});

export const STABLE_CODE_RE = /^[a-z0-9_.-]{1,160}$/u;
const SAFE_WRAPPER_ERROR_CODE_RE = /^[A-Za-z0-9._-]{1,160}$/u;
const SAFE_IDENTITY_RE = /^[A-Za-z0-9#._:-]{1,512}$/u;
const SAFE_EXECUTION_STAGES = Object.freeze([
  "preparation", "candidate", "falsifier", "traversal", "receipt"
]);

function safeDeclaredTarget(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !path.posix.isAbsolute(value) && !value.includes("\\") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".." &&
      /^[A-Za-z0-9_.-]+$/u.test(part));
}

export function projectedExecutionDetail(error, subject) {
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

const NATIVE_SOURCE_OBSERVATION_CODES = new Set([
  "test_proof_native_dependency_population_unsupported",
  "test_proof_native_instrumentation_unsupported",
  "test_proof_native_selection_unsupported",
  "test_proof_python_fault_unsupported"
]);
const NATIVE_RUNTIME_SETUP_CODES = new Set([
  "test_proof_native_interpreter_unavailable",
  "test_proof_native_runtime_inputs_stale",
  "test_proof_native_runtime_unavailable"
]);

const LAUNCHER_PREREQUISITE_OBSERVATION_CODES = new Set([
  "test_proof_native_import_policy_unenforced"
]);

function runtimeSetupCode(code) {
  return typeof code === "string" &&
    (code.startsWith("test_runtime_") || NATIVE_RUNTIME_SETUP_CODES.has(code));
}

const LAUNCHER_ATTRIBUTION_OBSERVATION_CODES = new Set([
  "test_proof_structured_events_exit_status_mismatch",
  "test_proof_structured_events_lifecycle_invalid",
  "test_proof_structured_events_unselected_execution",
  "test_proof_structured_test_identity_duplicate"
]);
const LAUNCHER_OBSERVATION_DEFECT_ACTION = "report_the_launcher_selected_test_observation_defect";
const LAUNCHER_OBSERVATION_CORRECTION_OWNER = "launcher_test_proof_provider";

const NATIVE_INSTRUMENTATION_UNSUPPORTED_CODE = "test_proof_native_instrumentation_unsupported";
const SELECTED_TEST_CORRECTIONS = Object.freeze({
  selected_test_not_observable: Object.freeze({
    action: "author_the_named_selected_test_or_correct_the_saved_selection",
    correction_owner: "proof_author"
  }),
  selected_test_shape_unsupported: Object.freeze({
    action: "report_the_launcher_provider_selected_test_shape_limitation",
    correction_owner: LAUNCHER_OBSERVATION_CORRECTION_OWNER
  })
});

function selectedTestCorrection(details) {
  return details.structured_observation_code === NATIVE_INSTRUMENTATION_UNSUPPORTED_CODE
    ? SELECTED_TEST_CORRECTIONS[details.structured_observation_detail?.reason] ?? null : null;
}

function noRetryCorrection(recoveryAction, details) {
  if (recoveryAction === LAUNCHER_OBSERVATION_DEFECT_ACTION) {
    return { correction_owner: LAUNCHER_OBSERVATION_CORRECTION_OWNER,
      condition: details.structured_observation_code };
  }
  const selection = selectedTestCorrection(details);
  return selection?.action === recoveryAction ? { correction_owner: selection.correction_owner,
    condition: details.structured_observation_detail.reason } : null;
}

function evidenceExecutionRecovery(details) {

  if (details.structured_observation_code === TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE.code) {
    return "repair_the_canonical_proof_binding_then_retry";
  }

  if (runtimeSetupCode(details.structured_observation_code) ||
      runtimeSetupCode(details.blocker_code)) {
    return "run_local_test_runtime_setup_then_retry";
  }
  const selection = selectedTestCorrection(details);
  if (selection !== null) return selection.action;

  if (NATIVE_SOURCE_OBSERVATION_CODES.has(details.structured_observation_code)) {
    return "repair_the_declared_native_proof_source_then_retry";
  }
  if (LAUNCHER_PREREQUISITE_OBSERVATION_CODES.has(details.structured_observation_code)) {
    return "repair_the_launcher_execution_prerequisite_then_retry";
  }
  if (LAUNCHER_ATTRIBUTION_OBSERVATION_CODES.has(details.structured_observation_code)) {
    return LAUNCHER_OBSERVATION_DEFECT_ACTION;
  }
  if (details.structured_observation_code !== undefined) {
    return "resolve_the_selected_test_observation_failure_then_retry";
  }
  if (details.timed_out === true) {
    return "repair_the_launcher_runtime_timeout_prerequisite_then_retry";
  }
  return "repair_the_launcher_execution_prerequisite_then_retry";
}

function publicObservedIdentity(event) {
  const { failure_diagnostic: cause, ...identity } = projectObservedIdentity(event);
  if (cause === undefined) return identity;
  if (!isLauncherTestFailureDiagnostic(cause)) return null;
  return { ...identity, failure_diagnostic: projectSelectedTestFailureDiagnostic(cause) };
}

function publicObservedIdentities(events) {
  const projected = events.map(publicObservedIdentity);
  return projected.includes(null) ? null : projected;
}

function projectedBoundIdentityMismatch(detail) {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail) ||
      !TEST_ID_RE.test(detail.expected_test_id) ||
      !Number.isSafeInteger(detail.observed_count) || detail.observed_count < 0 ||
      !Number.isSafeInteger(detail.returned_count) || detail.returned_count < 0 ||
      !Number.isSafeInteger(detail.omitted_count) || detail.omitted_count < 0 ||
      detail.returned_count + detail.omitted_count !== detail.observed_count ||
      !Array.isArray(detail.observed_identity_candidates) ||
      detail.observed_identity_candidates.length !== detail.returned_count) return null;
  const candidates = publicObservedIdentities(detail.observed_identity_candidates);
  if (candidates === null) return null;
  return {
    expected_test_id: detail.expected_test_id,
    observed_count: detail.observed_count,
    returned_count: detail.returned_count,
    omitted_count: detail.omitted_count,
    observed_identity_candidates: candidates
  };
}

const LIMITATION_REASON_CODES = Object.freeze([
  "test_proof_native_instrumentation_unsupported",
  "test_proof_native_runner_unsupported",
  "test_proof_native_selection_unsupported",
  "test_proof_registry_falsification_unsupported"
]);
const LIMITATION_DETAIL_RE = /^[a-z][a-z0-9_]{0,63}$/u;

function projectCapabilityLimitations(limitations) {
  if (!Array.isArray(limitations)) {
    throw new TypeError("authenticated proof receipt carries no limitation population");
  }
  return limitations.map((entry) => {
    if (!LIMITATION_REASON_CODES.includes(entry?.reason_code) ||
        !["falsifier", "traversal"].includes(entry.check_kind) ||
        !(entry.check_id === null || SAFE_IDENTITY_RE.test(entry.check_id))) {
      throw new TypeError("authenticated capability limitation cannot be safely projected");
    }
    const detail = Object.entries(entry.detail ?? {});
    if (detail.some(([, value]) => typeof value !== "string" ||
      !LIMITATION_DETAIL_RE.test(value))) {
      throw new TypeError("authenticated capability limitation cannot be safely projected");
    }
    return {
      check_kind: entry.check_kind,
      check_id: entry.check_id,
      reason_code: entry.reason_code,
      detail: detail.length === 0 ? null : Object.fromEntries(detail)
    };
  });
}

const FALSIFIER_OUTCOME_STATUSES = new Set([
  "detected", "execution_error", "not_detected", "review_only"
]);
const FALSIFIER_EXECUTION_STATUSES = new Set(["failed", "not_run", "passed", "skipped"]);

function projectFalsifierOutcome(falsifier) {
  if (!SAFE_IDENTITY_RE.test(falsifier?.falsifier_id) ||
      !SAFE_IDENTITY_RE.test(falsifier?.attempt_id) ||
      !FALSIFIER_OUTCOME_STATUSES.has(falsifier?.status) ||
      !FALSIFIER_EXECUTION_STATUSES.has(falsifier?.falsified_status) ||
      !["failed", "passed", "skipped"].includes(falsifier?.candidate_status) ||
      !["supported", "unsupported"].includes(falsifier?.provider_support) ||
      typeof falsifier?.isolated !== "boolean" ||
      typeof falsifier?.mutation?.observed !== "boolean") {
    throw new TypeError("authenticated falsifier outcome cannot be safely projected");
  }
  return {
    falsifier_id: falsifier.falsifier_id,
    attempt_id: falsifier.attempt_id,
    status: falsifier.status,
    provider_support: falsifier.provider_support,
    isolated: falsifier.isolated,
    candidate_status: falsifier.candidate_status,
    falsified_status: falsifier.falsified_status,
    mutation_observed: falsifier.mutation.observed
  };
}

export function projectObservedEvidence(receipt, target, expectedTestId) {
  const events = [
    ...(Array.isArray(receipt?.execution_result?.structured_result?.pass_events)
      ? receipt.execution_result.structured_result.pass_events : []),
    ...(Array.isArray(receipt?.execution_result?.structured_result?.fail_events)
      ? receipt.execution_result.structured_result.fail_events : [])
  ];
  const candidates = events.map(projectObservedIdentity).sort((left, right) =>
    Number(right.test_id === expectedTestId) - Number(left.test_id === expectedTestId) ||
    Number(right.file === target) - Number(left.file === target) ||
    (left.file ?? "").localeCompare(right.file ?? "") || left.nesting - right.nesting ||
    (left.name ?? "").localeCompare(right.name ?? "") || left.test_id.localeCompare(right.test_id)
  );
  const evidenceId = receipt?.evidence_identity?.evidence_id;
  if (!SAFE_IDENTITY_RE.test(evidenceId) ||
      !["passed", "failed"].includes(receipt?.execution_result?.status) ||
      !(receipt.execution_result.exit_code === null ||
        Number.isSafeInteger(receipt.execution_result.exit_code))) {
    throw new TypeError("authenticated proof receipt cannot be safely projected");
  }
  const artifacts = new Map((receipt.artifacts ?? []).map((artifact) =>
    [artifact.artifact_id, artifact]));
  const falsifierOutcomes = (receipt.falsifier_executions ?? []).map(projectFalsifierOutcome);
  const executionRows = [];
  const appendStructuredExecutions = (phase, association, phaseIdentity) => {
    for (const artifactId of association?.evidence_artifact_ids ?? []) {
      const artifact = artifacts.get(artifactId);
      if (artifact === undefined) {
        throw new TypeError("authenticated execution references an unavailable evidence artifact");
      }
      if (artifact?.kind !== "structured_test_result") continue;
      if (!/^sha256:[a-f0-9]{64}$/u.test(artifact.digest) ||
          artifact.payload === null || typeof artifact.payload !== "object" ||
          !Array.isArray(artifact.payload.pass_events) ||
          !Array.isArray(artifact.payload.fail_events)) {
        throw new TypeError("authenticated structured test artifact cannot be safely projected");
      }
      executionRows.push({
        phase,
        evidence_id: evidenceId,
        selected_test_id: expectedTestId,
        ...phaseIdentity,
        artifact_id: artifact.artifact_id,
        artifact_digest: artifact.digest,
        observed_test_events: [
          ...artifact.payload.pass_events,
          ...artifact.payload.fail_events
        ].map(projectObservedIdentity)
      });
    }
  };
  appendStructuredExecutions("candidate", receipt.execution_result, {
    attempt_id: receipt.execution_result.attempt_id
  });
  for (const falsifier of receipt.falsifier_executions ?? []) {
    appendStructuredExecutions("falsifier", falsifier, {
      falsifier_id: falsifier.falsifier_id,
      attempt_id: falsifier.attempt_id
    });
  }
  for (const traversal of receipt.boundary_traversals ?? []) {
    appendStructuredExecutions("traversal", traversal, {
      boundary_id: traversal.boundary_id,
      observable_id: traversal.observable_id
    });
  }
  return {
    schema_version: "workspace-verify-proof-observed-evidence.v1",
    evidence_id: evidenceId,
    selected_test_id: expectedTestId,
    selected_status: events.find((event) => event.test_id === expectedTestId)?.status ?? null,

    capability_limitations: projectCapabilityLimitations(receipt.capability_limitations),
    file_exit_code: receipt.execution_result.exit_code,
    observed_count: events.length,
    returned_count: candidates.length,
    omitted_count: events.length - candidates.length,
    observed_identity_candidates: candidates,
    falsifier_outcomes: falsifierOutcomes,
    executions: executionRows
  };
}

function projectedSelectedIdentityNotObserved(detail, executionContext) {
  const projected = projectedBoundIdentityMismatch(detail);
  if (projected === null || !Array.isArray(detail.observed_failures) ||
      detail.observed_failure_count !== detail.observed_failures.length ||
      !safeDeclaredTarget(detail.target) ||
      detail.target !== executionContext.declared_target ||
      ![null, "passed", "failed", "skipped", "todo"].includes(
        detail.file_wrapper_status
      ) || !Array.isArray(detail.file_wrapper_error_codes) ||
      detail.file_wrapper_error_codes.some((code) =>
        typeof code !== "string" || !SAFE_WRAPPER_ERROR_CODE_RE.test(code))) return null;
  const observedFailures = publicObservedIdentities(detail.observed_failures);
  if (observedFailures === null) return null;
  return {
    ...projected,
    target: detail.target,
    file_wrapper_status: detail.file_wrapper_status,
    file_wrapper_error_codes: [...detail.file_wrapper_error_codes],
    observed_failures: observedFailures,
    observed_failure_count: detail.observed_failure_count
  };
}

function projectedSelectedSkip(detail) {
  const event = detail?.selected_event;
  if (event === null || typeof event !== "object" || Array.isArray(event) ||
      detail.execution_stage !== "candidate") return null;
  const identity = publicObservedIdentity(event);
  if (identity === null || identity.test_id !== detail.expected_test_id ||
      identity.status !== "skipped") return null;
  return { test_id: identity.test_id, file: identity.file, name: identity.name,
    nesting: identity.nesting, status: identity.status };
}

const SELECTED_OBSERVATION_CODES = new Set([
  "test_proof_selected_identity_not_observed", TEST_PROOF_SELECTED_TEST_SKIPPED_CODE
]);

export function projectedEvidenceFailure(error, executionContext) {
  if (!Object.hasOwn(TEST_PROOF_EVIDENCE_FAILURES, error.code)) return null;
  const detail = error.detail;
  if (detail !== null && (typeof detail !== "object" || Array.isArray(detail))) return null;
  const projected = {
    ...executionContext,
    deepest_stable_cause_code: error.code
  };
  if (error.code === "test_proof_bound_identity_mismatch" ||
      SELECTED_OBSERVATION_CODES.has(error.code)) {
    const mismatch = error.code === "test_proof_bound_identity_mismatch"
      ? projectedBoundIdentityMismatch(detail)
      : projectedSelectedIdentityNotObserved(detail, executionContext);
    if (mismatch === null) return null;
    Object.assign(projected, mismatch);
  }
  if (error.code === TEST_PROOF_SELECTED_TEST_SKIPPED_CODE) {
    const selectedObservation = projectedSelectedSkip(detail);
    if (selectedObservation === null) return null;
    projected.selected_observation = selectedObservation;
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
  if (detail?.provider !== undefined) {
    if (!SAFE_IDENTITY_RE.test(detail.provider?.provider_id) ||
        !SAFE_IDENTITY_RE.test(detail.provider?.provider_version)) return null;
    projected.provider_id = detail.provider.provider_id;
    projected.provider_version = detail.provider.provider_version;
  }
  const executionFailure = TEST_PROOF_EVIDENCE_FAILURES[error.code] === null;
  if (executionFailure || SELECTED_OBSERVATION_CODES.has(error.code)) {
    if (!SAFE_EXECUTION_STAGES.includes(projected.execution_stage)) return null;
    const runFacts = publicRunFacts(detail?.run,
      { attributionCodes: LAUNCHER_ATTRIBUTION_OBSERVATION_CODES });
    if (runFacts === null) return null;
    Object.assign(projected, runFacts);
  }
  const stage = error.code.startsWith("test_proof_receipt_") ||
    error.code === "test_proof_runtime_evidence_invalid" ||
    error.code === "test_proof_artifact_untrusted" ||
    error.code === "test_proof_evidence_identity_invalid"
    ? "receipt" : null;
  if (stage !== null) projected.execution_stage = stage;
  const recoveryAction = executionFailure
    ? evidenceExecutionRecovery(projected)
    : TEST_PROOF_EVIDENCE_FAILURES[error.code];
  const correction = noRetryCorrection(recoveryAction, projected) ??
    infrastructureCorrection(executionFailure ? projected.structured_observation_code : error.code);
  return {
    details: projected,
    recovery_action: recoveryAction,
    ...(correction === null ? {} : { ...correction, retry: false })
  };
}

export function projectedProviderFailure(error, executionContext) {
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
      : "repair_the_canonical_proof_provider_binding_then_retry",
    ...infrastructureCorrection(error.code)
  };
}

const CONTRACT_DIAGNOSTIC_LIMIT = 16;
const POINTER_RE = /^\/[^\u0000-\u001f\u007f]{0,255}$/u;
const KEYWORD_RE = /^[A-Za-z][A-Za-z0-9_$-]{0,63}$/u;

function projectedContractInvalidDetail(details) {
  const carried = Array.isArray(details.diagnostics)
    ? { total_count: details.diagnostics.length, diagnostics: details.diagnostics }
    : details.diagnostics;
  if (carried === null || typeof carried !== "object" || Array.isArray(carried) ||
      !Array.isArray(carried.diagnostics)) return {};
  const totalCount = Number.isSafeInteger(carried.total_count) && carried.total_count >= 0
    ? carried.total_count : carried.diagnostics.length;
  const projected = [];
  for (const entry of carried.diagnostics) {
    if (projected.length === CONTRACT_DIAGNOSTIC_LIMIT) break;
    if (!entry || typeof entry !== "object" || typeof entry.code !== "string" ||
        !STABLE_CODE_RE.test(entry.code) || typeof entry.pointer !== "string" ||
        !POINTER_RE.test(entry.pointer)) return {};
    const node = { code: entry.code, pointer: entry.pointer };
    if (typeof entry.keyword === "string" && entry.keyword.length > 0) {
      if (!KEYWORD_RE.test(entry.keyword)) return {};
      node.keyword = entry.keyword;
    }
    projected.push(Object.freeze(node));
  }
  return {
    diagnostic_count: totalCount,
    returned_diagnostic_count: projected.length,
    omitted_diagnostic_count: Math.max(totalCount - projected.length, 0),
    diagnostics: Object.freeze(projected)
  };
}

export function projectedOperationDetail(error) {
  const details = error.details;
  if (details === null || typeof details !== "object" || Array.isArray(details)) return null;
  if (error.code === "verify_proof.controlled_contract_invalid.v1") {
    return projectedContractInvalidDetail(details);
  }
  if (error.code === "verify_proof.environment_incompatible.v1") {
    return projectedEnvironmentSelectionDetail(details);
  }
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
      if (packageCode !== null && (typeof packageCode !== "string" ||
          !STABLE_CODE_RE.test(packageCode))) return null;
      if (details.operation !== "resolve_test_proof_runtime_bindings" ||
          details.stage !== "runtime_binding_resolution") return null;
      return {
        package_code: packageCode,
        operation: details.operation,
        stage: details.stage
      };
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

export const LOCAL_ATTEMPT_CAUSE_CODES = new Set([
  ...PROVIDER_REFUSAL_PRECEDENCE,
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.BINDING_INVALID,
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.CAPABILITY_MISMATCH,
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.DUPLICATE,
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.PROVIDER_UNKNOWN,
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.PROVIDER_STALE,
  "test_proof_selected_identity_not_observed",
  TEST_PROOF_SELECTED_TEST_SKIPPED_CODE,
  "test_proof_falsifier_provider_missing",
  "test_proof_candidate_execution_error",
  "test_proof_candidate_inventory_missing",
  "test_proof_falsifier_execution_error",
  "test_proof_traversal_execution_error",
  "test_proof_receipt_projection_invalid"
]);

function localExecutionStatus(details) {
  if (details?.ran !== true) return "not_started";
  return details.timed_out === true ? "interrupted" : "completed";
}

export function proofLocalContinuationFacts(chain) {
  const execution = chain.find((entry) => entry.code === "agent_launch.verify_proof.attempt_execution_failed.v1" ||
    entry.code === "agent_launch.verify_proof.receipt_incomplete.v1");
  const causes = chain.filter((entry) => entry !== execution).map((entry) => entry.code);
  if (execution === undefined || causes.length === 0 ||
      causes.some((code) => !LOCAL_ATTEMPT_CAUSE_CODES.has(code))) return null;
  const { verification_id: verificationId, declared_target: target } = execution.details ?? {};
  const selectedObservation = chain.at(-1)?.details?.selected_observation;
  return typeof verificationId === "string" && typeof target === "string"
    ? Object.freeze({ verification_id: verificationId, target,
      execution_status: localExecutionStatus(chain.at(-1)?.details),
      ...(selectedObservation === undefined ? {} : {
        selected_observation: structuredClone(selectedObservation) }) }) : null;
}
