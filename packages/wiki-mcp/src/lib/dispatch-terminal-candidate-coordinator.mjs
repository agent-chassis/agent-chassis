

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import {
  STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS,
  classifyStableTestProofRuntimeReadiness
} from "@agent-chassis/controlled-contract";
import {
  computeWorkRecordSourceDigest,
  projectWorkRecordTestProofValidation,
  projectSliceReviewReceiptContracts,
  resolveControlledContractTestProofRuntimeBindings
} from "../../../wiki-core/src/index.mjs";
import {
  runWithControlledContractAuthorityContext,
  withControlledContractAuthorityExclusion
} from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";
import {
  resolveControlledContractGenerationBinding,
  authenticateControlledContractGenerationAtW
} from "@agent-chassis/agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs";
import { resolveControlledContractAttachmentGeneration } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import { assertAuthenticatedControlledContractGeneration } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-generation-authentication.mjs";
import { extractTestProofRuntimeEvidenceReceipt } from
  "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import { runWorkspaceAgentTestProofAttempt } from
  "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-validation-runner.mjs";
import {
  mintLauncherTestProofAttemptContext,
  mintTerminalCandidateTestProofRuntimeAuthority,
  TestProofRuntimeIdentityError
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import {
  TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION,
  compareTerminalReviewContractBindingIdentity,
  constructTerminalReviewContractBinding,
  terminalReviewContractBindingAddresses,
  terminalReviewContractBindingIdentity
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs";
import {
  evaluateWorkRecordParentLifecycleContract,
  PARENT_LIFECYCLE_CONTRACT_FACTS
} from "../../../wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";
import { materializeTerminalCandidateCheckout } from
  "@agent-chassis/agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import {
  assertTerminalWkCandidateInputsUnmoved,
  deriveTerminalCandidateCurrentRef,
  deriveTerminalCandidateDurableRefs,
  deriveRecoveredTerminalWkCandidateIdentity,
  deriveTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  freezeReconstructedTerminalWkCandidateInputs,
  freezeRecoveredTerminalWkCandidateInputs,
  freezeTerminalWkCandidateInputs,
  publishTerminalWkCandidateVersion,
  readTerminalCandidateCurrentRef,
  readTerminalWkCandidateMetadata,
  TERMINAL_WK_CANDIDATE_CODES,
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,
  TerminalWkCandidateError,
  verifyTerminalWkCandidateObjectBinding
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  runAllTerminalCandidateValidations,
  runTerminalCandidateValidation,
  verifyTerminalCandidateDependencies
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate-validation.mjs";
import {
  executeVerifyProofReceiptPopulation,
  VERIFY_PROOF_EXECUTION_FAILURE_CODES,
  VerifyProofExecutionError
} from
  "../../../agent-launch-core/src/lib/workspace-agent-verify-proof-capability.mjs";

export function declaredValidationBindings(record) {
  return projectWorkRecordTestProofValidation({ selectedUnit: record }).validation_bindings;
}

export const TERMINAL_TEST_PROOF_RUNTIME_REFUSAL_CODES = Object.freeze({
  RECEIPT_INCOMPLETE:
    "agent_launch.terminal_candidate_test_proof.receipt_incomplete.v1"
});

function failTerminalTestProofReceiptIncomplete(message, cause = null) {
  const error = cause === null ? new Error(message) : new Error(message, { cause });
  error.code = TERMINAL_TEST_PROOF_RUNTIME_REFUSAL_CODES.RECEIPT_INCOMPLETE;
  throw error;
}

export function bindTerminalTestProofVerificationIds(validations, bindings, receiptsByTarget = {}) {
  return Object.freeze(validations.map((entry) => {
    const verificationIds = bindings[entry.target] ?? Object.freeze([]);
    const receipts = receiptsByTarget[entry.target] ?? Object.freeze([]);
    const receiptIds = receipts.map((receipt) => receipt?.evidence_identity?.verification_id);
    if (verificationIds.length !== receipts.length || verificationIds.some(
      (verificationId, index) => receiptIds[index] !== verificationId
    )) {
      failTerminalTestProofReceiptIncomplete(
        "terminal test-proof verification identities require complete exact runtime-evidence receipts"
      );
    }
    return Object.freeze({
      ...entry,
      verification_ids: verificationIds,
      test_proof_evidence_authority: "advisory_execution_facts",
      ...(verificationIds.length > 0
        ? { test_proof_runtime_evidence: Object.freeze([...receipts]) }
        : {})
    });
  }));
}

export async function executeTestProofReceiptsWithAuthority({
  proofAuthority,
  targets,
  validationBindings,
  assertCurrentIdentity = null
}) {
  const readinessCodes = {
    [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.MISSING_INVENTORY]:
      "test_proof_runtime_inventory_missing",
    [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.MISSING_SELECTION]:
      "test_proof_runtime_test_selection_missing",
    [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.INVALID_SELECTION]:
      "test_proof_runtime_test_selection_invalid"
  };
  const proofWkId = proofAuthority?.wk_id ?? proofAuthority?.record_id;
  const selections = new Map();
  try {
    for (const target of targets) {
      const verificationIds = validationBindings[target] ?? Object.freeze([]);
      if (verificationIds.length === 0) continue;
      let selection;
      try {
        selection = await resolveControlledContractTestProofRuntimeBindings({
          repoRoot: proofAuthority.worktree_path,
          wkId: proofWkId,
          verificationIds
        });
      } catch (error) {
        throw new VerifyProofExecutionError(
          VERIFY_PROOF_EXECUTION_FAILURE_CODES.BINDING_RESOLUTION,
          "verify-proof could not resolve the exact controlled-contract bindings",
          { target, verification_ids: verificationIds },
          error
        );
      }
      if (selection?.status !== "complete" ||
          selection.requested_count !== verificationIds.length ||
          selection.matched_count !== verificationIds.length ||
          !Array.isArray(selection.bindings)) {
        throw new VerifyProofExecutionError(
          VERIFY_PROOF_EXECUTION_FAILURE_CODES.BINDING_RESOLUTION,
          "verify-proof preflight did not resolve the complete exact binding population",
          { target, verification_ids: verificationIds }
        );
      }
      for (const verificationId of verificationIds) {
        const matches = selection.bindings.filter(
          (binding) => binding?.verification_claim_id === verificationId
        );
        if (matches.length !== 1) throw new VerifyProofExecutionError(
          VERIFY_PROOF_EXECUTION_FAILURE_CODES.BINDING_RESOLUTION,
          "verify-proof preflight resolved a missing or duplicate binding",
          { target, verification_id: verificationId }
        );
        const readiness = classifyStableTestProofRuntimeReadiness(matches[0]);
        if (readiness.status !== "ready") {
          const cause = new TestProofRuntimeIdentityError(
            readinessCodes[readiness.reason],
            "proof execution requires a package-ready runtime test identity",
            {
              readiness_reason: readiness.reason,
              candidate_total: readiness.candidate_total,
              candidate_test_ids: readiness.current_test_ids.slice(0, 16),
              candidate_test_ids_omitted: Math.max(readiness.candidate_total - 16, 0),
              selected_test_id: readiness.selected_test_id,
              authority_limb: "mechanical_failure",
              admissibility_effect: "none",
              recovery_operation: "workspace_controlled_test_proof_patch",
              complete_retrieval: {
                tool: "workspace_controlled_test_proof_query",
                arguments: {
                  wk_id: proofWkId,
                  verification_ids: [verificationId]
                }
              }
            }
          );
          throw new VerifyProofExecutionError(
            VERIFY_PROOF_EXECUTION_FAILURE_CODES.ATTEMPT_CONTEXT,
            "verify-proof could not mint the exact attempt context",
            { target, verification_id: verificationId },
            cause
          );
        }
      }
      selections.set(JSON.stringify(verificationIds), selection);
    }
    return await executeVerifyProofReceiptPopulation({
      proofAuthority,
      targets,
      validationBindings,
      resolveBindings: async ({ verificationIds }) =>
        selections.get(JSON.stringify(verificationIds)),
      mintAttemptContext: mintLauncherTestProofAttemptContext,
      runAttempt: runWorkspaceAgentTestProofAttempt,
      extractReceipt: extractTestProofRuntimeEvidenceReceipt,
      assertCurrentIdentity
    });
  } catch (error) {
    if (error?.code?.startsWith("agent_launch.verify_proof.")) {
      failTerminalTestProofReceiptIncomplete(error.message, error);
    }
    throw error;
  }
}

async function executeTerminalTestProofReceipts({
  binding,
  materialization,
  targets,
  validationBindings,
  runGit
}) {
  const verificationCount = targets.reduce(
    (count, target) => count + (validationBindings[target]?.length ?? 0),
    0
  );
  if (verificationCount === 0) {
    return Object.freeze(Object.fromEntries(
      targets.map((target) => [target, Object.freeze([])])
    ));
  }
  const proofAuthority = await mintTerminalCandidateTestProofRuntimeAuthority({
    binding, materialization, runGit
  });
  const executed = await executeTestProofReceiptsWithAuthority({
    proofAuthority, targets, validationBindings
  });
  return executed.receipts_by_target;
}

async function runTerminalCandidateValidationsWithProofs({
  binding,
  materialization,
  targets,
  runtimeRoot,
  validationBindings,
  runGit
}) {
  const validations = await runAllTerminalCandidateValidations({
    binding, materialization, targets, runtimeRoot, runGit
  });
  const receipts = await executeTerminalTestProofReceipts({
    binding,
    materialization,
    targets,
    validationBindings,
    runGit
  });
  return bindTerminalTestProofVerificationIds(validations, validationBindings, receipts);
}

export const TERMINAL_REVIEW_UNIT_PROJECTION_CODES = Object.freeze({
  PARENT_LIFECYCLE_CONTRACT_INCOMPLETE: "parent_lifecycle_contract_incomplete",
  SLICE_REVIEW_CONTRACT_ABSENT: "slice_review_contract_absent"
});

const PARENT_LIFECYCLE_CONTRACT_FACT_ORDER = Object.freeze(
  Object.values(PARENT_LIFECYCLE_CONTRACT_FACTS)
);
const NO_LIFECYCLE_FACTS = Object.freeze([]);

function closedLifecycleFacts(facts) {
  if (!Array.isArray(facts) || facts.length === 0) return NO_LIFECYCLE_FACTS;
  const present = new Set(facts);
  const closed = PARENT_LIFECYCLE_CONTRACT_FACT_ORDER.filter((fact) => present.has(fact));
  return closed.length === 0 ? NO_LIFECYCLE_FACTS : Object.freeze(closed);
}

function terminalReviewUnitProjectionFailure(code, parentLifecycle = null) {
  return Object.freeze({
    ok: false,
    cause: Object.freeze({
      code,
      missing_facts: closedLifecycleFacts(parentLifecycle?.missing_facts),
      ambiguous_facts: closedLifecycleFacts(parentLifecycle?.ambiguous_facts)
    })
  });
}

export function projectTerminalReviewUnit(record) {
  const parentLifecycle = evaluateWorkRecordParentLifecycleContract(record);
  if (parentLifecycle.complete !== true) {
    return terminalReviewUnitProjectionFailure(
      TERMINAL_REVIEW_UNIT_PROJECTION_CODES.PARENT_LIFECYCLE_CONTRACT_INCOMPLETE,
      parentLifecycle
    );
  }
  const slice = parentLifecycle.terminal_review_contract_unit;
  const contracts = projectSliceReviewReceiptContracts(record, slice.id);
  if (contracts.slice_review_contract === null) {
    return terminalReviewUnitProjectionFailure(
      TERMINAL_REVIEW_UNIT_PROJECTION_CODES.SLICE_REVIEW_CONTRACT_ABSENT
    );
  }
  return Object.freeze({ ok: true, slice_id: slice.id, contracts });
}

async function authenticateCurrentControlledGeneration({
  mainRepo, wkId, expectedW, runGit, run
}) {
  const generation = await resolveControlledContractAttachmentGeneration({
    repoRoot: mainRepo,
    wkId
  });
  if (generation === null) {
    throw new Error("current controlled-contract generation is absent");
  }
  const binding = await resolveControlledContractGenerationBinding({
    repoRoot: mainRepo,
    wkId,
    generation,
    lifecycleBinding: null,
    deps: { runGit }
  });
  if (expectedW !== null && binding.wk_tip_sha !== expectedW) {
    throw new Error("persistent WK ref moved before terminal candidate preparation");
  }
  const authenticated = await authenticateControlledContractGenerationAtW({
    binding,
    deps: { runGit }
  });
  return run(assertAuthenticatedControlledContractGeneration(authenticated, {
    repository: binding.repository,
    wkId,
    wkTipSha: binding.wk_tip_sha,
    requireManifest: true
  }));
}

async function withCurrentControlledGeneration({ mainRepo, wkId, expectedW = null, runGit, run }) {
  return withControlledContractAuthorityExclusion({
    repoRoot: mainRepo,
    wkId,
    run: async () => authenticateCurrentControlledGeneration({
      mainRepo, wkId, expectedW, runGit, run
    })
  });
}

async function exactWkBoundContract({
  recordId,
  initiative = null,
  mainRepo,
  wkSha,
  runGit = defaultTerminalCandidateRunGit
}) {
  let record;
  try {
    const result = await runGit({
      repo: mainRepo,
      args: ["show", `${wkSha}:wiki/work-records/${recordId}.json`],
      env: null
    });
    if (!result || result.ok !== true) {
      throw new Error("exact WK record blob is unavailable");
    }
    record = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`terminal candidate exact WK-bound contract is not parseable: ${error?.message ?? String(error)}`);
  }
  if (record?.id !== recordId || !/^IN-\d{4}$/u.test(record?.initiative ?? "") ||
      (initiative !== null && record.initiative !== initiative)) {
    throw new Error("terminal candidate exact WK-bound contract identity disagrees");
  }
  const validationProjection = projectWorkRecordTestProofValidation({ selectedUnit: record });
  if (validationProjection.status !== "valid") {
    throw new Error("terminal candidate exact WK-bound validation declarations are invalid");
  }
  const projected = projectTerminalReviewUnit(record);
  const reviewUnit = projected.ok !== true ? null : Object.freeze({
    record_id: recordId,
    slice_id: projected.slice_id,
    subject: `${recordId}#${projected.slice_id}`,
    initiative: record.initiative,
    parent_status: record.status ?? null,

    contract_source: "exact_candidate_tree",
    canonical_parent_wk_contract: projected.contracts.canonical_parent_wk_contract,
    review_unit_contract: projected.contracts.slice_review_contract
  });
  return Object.freeze({
    initiative: record.initiative,
    digest: computeWorkRecordSourceDigest(record),
    targets: validationProjection.targets,
    validation_bindings: validationProjection.validation_bindings,
    review_unit: reviewUnit,

    review_unit_absence: projected.ok === true ? null : projected.cause
  });
}

export { TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION };

const canonicalTerminalReviewBindings = new WeakMap();

export const CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES = Object.freeze({
  REPOSITORY_ROOT_NOT_CANONICAL: "canonical_repository_root_not_canonical",
  RECORD_UNREADABLE: "canonical_record_unreadable",
  RECORD_IDENTITY_DISAGREES: "canonical_record_identity_disagrees",
  TERMINAL_REVIEW_UNIT_UNPROJECTABLE: "terminal_review_unit_unprojectable",
  REVIEW_SUBJECT_MOVED: "canonical_review_subject_moved",
  REVIEW_CONTRACT_DIGEST_MOVED: "canonical_review_contract_digest_moved"
});

function canonicalCurrentTerminalReviewFailure(code, projectionCause = null) {
  return Object.freeze({
    ok: false,
    cause: Object.freeze({
      code,
      projection_code: projectionCause?.code ?? null,
      missing_facts: projectionCause?.missing_facts ?? NO_LIFECYCLE_FACTS,
      ambiguous_facts: projectionCause?.ambiguous_facts ?? NO_LIFECYCLE_FACTS
    })
  });
}

export function canonicalCurrentTerminalReviewContract({ mainRepo, recordId }) {
  let requested;
  try {
    requested = path.resolve(mainRepo);

    if (realpathSync(requested) !== requested) {
      return canonicalCurrentTerminalReviewFailure(
        CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.REPOSITORY_ROOT_NOT_CANONICAL);
    }
  } catch {
    return canonicalCurrentTerminalReviewFailure(
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.REPOSITORY_ROOT_NOT_CANONICAL);
  }
  let record;
  try {
    record = JSON.parse(readFileSync(
      path.join(requested, "wiki", "work-records", `${recordId}.json`),
      "utf8"
    ));
  } catch {
    return canonicalCurrentTerminalReviewFailure(
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_UNREADABLE);
  }
  if (record?.id !== recordId || !/^IN-\d{4}$/u.test(record?.initiative ?? "")) {
    return canonicalCurrentTerminalReviewFailure(
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_IDENTITY_DISAGREES);
  }
  const projected = projectTerminalReviewUnit(record);
  if (projected.ok !== true) {
    return canonicalCurrentTerminalReviewFailure(
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.TERMINAL_REVIEW_UNIT_UNPROJECTABLE,
      projected.cause);
  }
  const subject = `${recordId}#${projected.slice_id}`;

  const binding = constructTerminalReviewContractBinding({
    recordId,
    initiative: record.initiative,
    reviewSliceId: projected.slice_id,
    reviewSubject: subject,
    reviewUnitContract: projected.contracts.slice_review_contract
  });
  const bindingIdentity = terminalReviewContractBindingIdentity(binding);
  const contract = Object.freeze({
    initiative: record.initiative,
    digest: computeWorkRecordSourceDigest(record),
    targets: projectWorkRecordTestProofValidation({ selectedUnit: record }).targets,
    validation_bindings: projectWorkRecordTestProofValidation({ selectedUnit: record })
      .validation_bindings,
    review_subject: subject,
    review_contract_digest: bindingIdentity.review_contract_digest,
    review_unit: Object.freeze({
      record_id: recordId,
      slice_id: projected.slice_id,
      subject,
      initiative: record.initiative,
      parent_status: record.status ?? null,

      contract_source: "canonical_current_record",
      canonical_parent_wk_contract: projected.contracts.canonical_parent_wk_contract,
      review_unit_contract: projected.contracts.slice_review_contract
    })
  });
  canonicalTerminalReviewBindings.set(contract, binding);
  return Object.freeze({ ok: true, contract });
}

export const TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION =
  "agent_launch.terminal_candidate_failure_projection.v1";
export const TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE =
  "terminal WK candidate: typed construction or recovery failure";
export const TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE =
  "terminal WK candidate: unknown construction or recovery failure";

const TERMINAL_CANDIDATE_GIT_OPERATIONS = Object.freeze(new Set([
  "rev-parse",
  "rev-list",
  "cat-file",
  "commit-tree",
  "for-each-ref",
  "update-ref",
  "merge-base"
]));
const TERMINAL_CANDIDATE_FAILURE_CODES = Object.freeze(
  new Set(Object.values(TERMINAL_WK_CANDIDATE_CODES))
);
const UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION = Object.freeze({
  schema_version: TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION,
  kind: "unknown_cause",
  code: null,
  message: TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  detail: null
});
const PRODUCTION_TERMINAL_CANDIDATE_RUN_GIT = defaultTerminalCandidateRunGit;
const TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_CODE =
  "terminal_candidate_recovery_construction_failed";
const TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_MESSAGE =
  "terminal candidate recovery construction failed";

function ownDataValue(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value")) return undefined;
  return descriptor.value;
}

function plainNonProxyObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      utilTypes.isProxy(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function closedGitStatus(detail) {
  const status = ownDataValue(detail, "status");
  return status === null ||
    (Number.isInteger(status) && status >= 0 && status <= 255)
    ? status
    : undefined;
}

function gitOperationFromInternalDetail(detail) {
  const args = ownDataValue(detail, "args");
  if (Array.isArray(args) && !utilTypes.isProxy(args)) {
    const first = ownDataValue(args, "0");
    const operation = first === "--no-replace-objects"
      ? ownDataValue(args, "1")
      : first;
    return typeof operation === "string" && TERMINAL_CANDIDATE_GIT_OPERATIONS.has(operation)
      ? operation
      : null;
  }

  return typeof ownDataValue(detail, "ref") === "string"
    ? "for-each-ref"
    : null;
}

function projectTypedTerminalCandidateDetail(code, detail) {
  if (code !== TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED &&
      code !== TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID) return null;
  if (!plainNonProxyObject(detail)) return null;
  const gitStatus = closedGitStatus(detail);
  if (gitStatus === undefined) return null;
  const inferredOperation = gitOperationFromInternalDetail(detail);
  const baseOperationEvidence = inferredOperation === "merge-base" ||
    (typeof ownDataValue(detail, "base") === "string" &&
      typeof ownDataValue(detail, "wk_tip") === "string");
  const gitOperation = code === TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID
    ? baseOperationEvidence ? "merge-base" : null
    : inferredOperation;
  if (gitOperation === null) return null;
  return Object.freeze({
    git_operation: gitOperation,
    git_status: gitStatus
  });
}

export function projectTerminalWkCandidateFailure(error) {
  try {
    if (!utilTypes.isNativeError(error) ||
        !(error instanceof TerminalWkCandidateError)) {
      return UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
    }
    const code = ownDataValue(error, "code");
    if (!TERMINAL_CANDIDATE_FAILURE_CODES.has(code)) {
      return UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
    }
    return Object.freeze({
      schema_version: TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION,
      kind: "typed_candidate_error",
      code,
      message: TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE,
      detail: projectTypedTerminalCandidateDetail(code, ownDataValue(error, "detail"))
    });
  } catch {
    return UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
  }
}

const terminalCandidateRecoveryFailures = new WeakMap();

export const TERMINAL_CANDIDATE_RECOVERY_REASONS = Object.freeze({
  FAILED: "terminal_candidate_recovery_failed",
  CONSTRUCTION_FAILED: "terminal_candidate_recovery_construction_failed",
  CANONICAL_REVIEW_CONTRACT_UNAVAILABLE:
    "terminal_candidate_recovery_canonical_review_contract_unavailable",
  CURRENT_REF_ABSENT: "terminal_candidate_recovery_current_ref_absent",
  REVIEW_CONTRACT_MOVED: "terminal_candidate_recovery_review_contract_moved",
  CURRENT_REF_PUBLICATION_DISAGREES:
    "terminal_candidate_recovery_current_ref_publication_disagrees",
  CANONICAL_WK_BINDING_DISAGREES:
    "terminal_candidate_recovery_canonical_wk_binding_disagrees",
  REVIEW_CONTRACT_BINDING_DISAGREES:
    "terminal_candidate_recovery_review_contract_binding_disagrees",
  NO_DETERMINISTIC_MATCH: "terminal_candidate_recovery_no_deterministic_match",
  VALIDATION_EVIDENCE_UNAVAILABLE:
    "terminal_candidate_recovery_validation_evidence_unavailable"
});

export const TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION =
  "agent_launch.terminal_candidate_recovery_diagnostic.v1";

function terminalCandidateRecoveryDiagnostic(cause) {
  if (cause === null || cause === undefined) return null;
  return Object.freeze({
    schema_version: TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION,
    contract_code: cause.code ?? null,
    projection_code: cause.projection_code ?? null,
    missing_facts: cause.missing_facts ?? NO_LIFECYCLE_FACTS,
    ambiguous_facts: cause.ambiguous_facts ?? NO_LIFECYCLE_FACTS
  });
}

function failTerminalCandidateRecovery(reason, diagnostic = null) {
  const error = new Error(reason);
  error.code = reason;
  terminalCandidateRecoveryFailures.set(error, Object.freeze({
    reason,
    failure: UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION,
    diagnostic
  }));
  throw error;
}

function failTerminalCandidateConstruction(failure) {
  const reason = "terminal_candidate_recovery_construction_failed";
  const error = new Error(failure.message);
  error.code = reason;

  error.terminal_candidate_failure = failure;
  terminalCandidateRecoveryFailures.set(error, Object.freeze({
    reason,
    failure,

    diagnostic: null
  }));
  throw error;
}

function failUntrustedTerminalCandidateRunner() {
  const error = new Error(TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_MESSAGE);
  error.code = TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_CODE;
  throw error;
}

function failUntrustedTerminalCandidatePreparation() {
  const error = new Error(TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_MESSAGE);
  error.code = TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_CODE;
  error.terminal_candidate_failure = UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
  throw error;
}

export function projectAuthenticatedTerminalCandidateFailure(error) {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") {
    return UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
  }
  return terminalCandidateRecoveryFailures.get(error)?.failure ??
    UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
}

export function projectTerminalCandidateRecoveryReason(error) {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") {
    return "terminal_candidate_recovery_failed";
  }
  return terminalCandidateRecoveryFailures.get(error)?.reason ??
    "terminal_candidate_recovery_failed";
}

export function projectTerminalCandidateRecoveryDiagnostic(error) {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") {
    return null;
  }
  return terminalCandidateRecoveryFailures.get(error)?.diagnostic ?? null;
}

export function createTerminalCandidateCoordinator({
  mainRepo,
  worktreeRoot,

  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      typeof worktreeRoot !== "string" || !path.isAbsolute(worktreeRoot) ||
      typeof runGit !== "function") {
    throw new Error("terminal candidate coordinator requires launcher-owned repository and worktree roots");
  }

  const authenticatesTerminalCandidateFailures =
    runGit === PRODUCTION_TERMINAL_CANDIDATE_RUN_GIT;
  const cycles = new Map();

  const prepareTerminalCandidate = async ({ integration, reviewUnit, wkId, wkRef, baseSha, baseRef = "main" }) => {
    try {
      if (integration?.wk_ref !== wkRef || integration?.wk_sha == null || reviewUnit?.record_id !== wkId) {
        throw new Error("terminal candidate preparation does not match the exact integrated WK identity");
      }

      if (typeof baseSha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseSha)) {
        throw new Error("terminal candidate preparation requires the launcher-bound WK lifecycle base");
      }
      return await withCurrentControlledGeneration({
        mainRepo, wkId, expectedW: integration.wk_sha, runGit,
        run: async (generationAuthentication) => {
          const canonical = await exactWkBoundContract({
            recordId: reviewUnit.record_id,
            initiative: reviewUnit.initiative,
            mainRepo,
            wkSha: integration.wk_sha,
            runGit
          });
          const frozen = await freezeTerminalWkCandidateInputs({
            mainRepo,
            baseSha,
            baseRef,
            wkRef,
            canonicalWkId: wkId,
            canonicalWkDigest: canonical.digest,
            generationAuthentication,
            runGit
          });
          if (frozen.wk_tip !== integration.wk_sha) {
            throw new Error("terminal candidate frozen WK tip disagrees with final integration");
          }
          const expectedOld = await readTerminalCandidateCurrentRef({
            mainRepo,
            canonicalWkId: wkId,
            runGit
          });
          const derived = await deriveTerminalWkCandidate({ frozen, runGit });
          const binding = await publishTerminalWkCandidateVersion({
            binding: derived,
            expectedOld,
            verifyRefs: [
              { ref: frozen.wk_ref, oid: frozen.wk_tip },
              ...(frozen.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3
                ? [{ ref: frozen.base_ref, oid: frozen.base }]
                : [])
            ],
            runGit
          });
          const candidateRoot = path.join(worktreeRoot, ".terminal-candidates", wkId, binding.candidate);
          const materialization = await materializeTerminalCandidateCheckout({
            binding,
            candidateRoot,
            runGit
          });
          const dependencyProof = verifyTerminalCandidateDependencies({ binding, materialization });
          const state = Object.freeze({
            binding,
            materialization,
            dependency_proof: dependencyProof,
            review_unit: canonical.review_unit,
            canonical_targets: canonical.targets,
            canonical_validation_bindings: canonical.validation_bindings,
            validation_runtime_root: path.join(worktreeRoot, ".terminal-validation", wkId, binding.candidate),
            version_decision: binding.version_decision
          });
          cycles.set(wkId, state);
          return state;
        }
      });
    } catch (error) {
      if (!authenticatesTerminalCandidateFailures) {
        failUntrustedTerminalCandidatePreparation();
      }
      if (terminalCandidateRecoveryFailures.has(error)) throw error;
      failTerminalCandidateConstruction(projectTerminalWkCandidateFailure(error));
    }
  };

  const reconstructAbsentTerminalCandidate = async ({
    wkId, currentRef, generationAuthentication
  }) => {
    const resolved = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });
    if (resolved.ok !== true) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery(
        "terminal_candidate_recovery_canonical_review_contract_unavailable",
        terminalCandidateRecoveryDiagnostic(resolved.cause));
    }
    const canonical = resolved.contract;
    const frozen = await freezeReconstructedTerminalWkCandidateInputs({
      mainRepo,
      initiative: canonical.initiative,
      canonicalWkId: wkId,
      canonicalWkDigest: canonical.digest,
      terminalReviewSubject: canonical.review_subject,
      terminalReviewContractDigest: canonical.review_contract_digest,
      generationAuthentication,
      runGit
    });
    if (frozen === null) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_absent");
    }

    const derived = await deriveTerminalWkCandidate({ frozen, runGit });

    const republished = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });

    let republishedMovement = republished.ok !== true ? republished.cause : null;
    if (republishedMovement === null) {
      const comparison = compareTerminalReviewContractBindingIdentity(
        canonicalTerminalReviewBindings.get(republished.contract), {
          reviewSubject: frozen.terminal_review_subject,
          reviewContractDigest: frozen.terminal_review_contract_digest
        });
      if (comparison.reason === "review_subject_moved") {
        republishedMovement = {
          code: CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.REVIEW_SUBJECT_MOVED
        };
      } else if (comparison.reason === "review_contract_digest_moved") {
        republishedMovement = {
          code: CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.REVIEW_CONTRACT_DIGEST_MOVED
        };
      }
    }
    if (republishedMovement !== null) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery("terminal_candidate_recovery_review_contract_moved",
        terminalCandidateRecoveryDiagnostic(republishedMovement));
    }
    await assertTerminalWkCandidateInputsUnmoved({ frozen, runGit });

    const publishedBinding = await publishTerminalWkCandidateVersion({
      binding: derived,
      expectedOld: null,

      verifyRefs: [
        { ref: frozen.wk_ref, oid: frozen.wk_tip },
        ...(frozen.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3
          ? [{ ref: frozen.base_ref, oid: frozen.base }]
          : [])
      ],
      runGit
    });

    const published = publishedBinding.current_selection_observation;
    if (published !== derived.candidate || publishedBinding.candidate_ref !== currentRef ||
        (publishedBinding.selection.state !== "created" &&
          publishedBinding.selection.state !== "converged")) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_publication_disagrees");
    }
    return Object.freeze({
      candidate: published,
      generationAuthentication
    });
  };

  const recoveredCandidateReviewBinding = async ({ wkId, candidate }) => {
    const metadata = await readTerminalWkCandidateMetadata({ mainRepo, candidate, runGit });
    if (metadata.schema_version !== TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3) {
      const recoveredCanonical = await exactWkBoundContract({
        recordId: wkId,
        mainRepo,
        wkSha: candidate,
        runGit
      });
      if (recoveredCanonical.review_unit === null) {
        if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
        failTerminalCandidateRecovery("terminal_candidate_recovery_canonical_wk_binding_disagrees",
          terminalCandidateRecoveryDiagnostic(recoveredCanonical.review_unit_absence));
      }
      return {
        canonical: recoveredCanonical,
        canonicalWkDigest: null,
        wkRef: `refs/heads/wk/${recoveredCanonical.initiative}/${wkId}`
      };
    }
    const resolved = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });
    if (resolved.ok !== true) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery(
        "terminal_candidate_recovery_canonical_review_contract_unavailable",
        terminalCandidateRecoveryDiagnostic(resolved.cause));
    }
    const canonical = resolved.contract;

    if (!terminalReviewContractBindingAddresses(
      canonicalTerminalReviewBindings.get(canonical), metadata.terminal_review_subject)) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery(
        "terminal_candidate_recovery_review_contract_binding_disagrees",
        terminalCandidateRecoveryDiagnostic({
          code: CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.REVIEW_SUBJECT_MOVED
        }));
    }
    return {
      canonical,
      canonicalWkDigest: canonical.digest,
      wkRef: deriveTerminalCandidateDurableRefs({
        initiative: canonical.initiative,
        canonicalWkId: wkId
      }).wk_ref
    };
  };

  const recoverTerminalCandidateWithGeneration = async ({
    wkId, generationAuthentication, observed
  }) => {
    const currentRef = deriveTerminalCandidateCurrentRef({ canonicalWkId: wkId });

    const reconstruction = observed === null
      ? await reconstructAbsentTerminalCandidate({
          wkId, currentRef, generationAuthentication
        })
      : null;
    const candidate = reconstruction?.candidate ?? observed;
    const { canonical: recoveredCanonical, canonicalWkDigest, wkRef } =
      await recoveredCandidateReviewBinding({ wkId, candidate });
    const frozen = await freezeRecoveredTerminalWkCandidateInputs({
      mainRepo,
      wkRef,
      canonicalWkId: wkId,
      candidate,
      canonicalWkDigest,
      generationAuthentication,
      runGit
    });
    const derived = await deriveRecoveredTerminalWkCandidateIdentity({
      frozen,
      runGit
    });
    if (derived.candidate !== candidate || derived.candidate_ref !== currentRef) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery("terminal_candidate_recovery_no_deterministic_match");
    }
    const recoveredBinding = Object.freeze({
      ...derived,
      candidate_ref_state: derived.candidate_ref_state === "derived"
        ? "recovered"
        : derived.candidate_ref_state
    });
    await verifyTerminalWkCandidateObjectBinding({
      binding: recoveredBinding,
      runGit
    });
    const binding = await publishTerminalWkCandidateVersion({
      binding: recoveredBinding,
      expectedOld: candidate,
      verifyRefs: [
        { ref: frozen.wk_ref, oid: frozen.wk_tip },
        ...(frozen.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3
          ? [{ ref: frozen.base_ref, oid: frozen.base }]
          : [])
      ],
      runGit
    });
    const candidateRoot = path.join(worktreeRoot, ".terminal-candidates", wkId, binding.candidate);
    const materialization = await materializeTerminalCandidateCheckout({
      binding,
      candidateRoot,
      runGit
    });
    const dependencyProof = verifyTerminalCandidateDependencies({ binding, materialization });
    const recoveredState = {
      binding,
      materialization,
      dependency_proof: dependencyProof,
      review_unit: recoveredCanonical.review_unit,
      canonical_targets: recoveredCanonical.targets,
      canonical_validation_bindings: recoveredCanonical.validation_bindings,
      validation_runtime_root: path.join(worktreeRoot, ".terminal-validation", wkId, binding.candidate),
      version_decision: binding.version_decision
    };
    const validations = await runTerminalCandidateValidationsWithProofs({
      binding,
      materialization,
      targets: recoveredState.canonical_targets,
      runtimeRoot: recoveredState.validation_runtime_root,
      validationBindings: recoveredState.canonical_validation_bindings,
      runGit
    });
    if (!Array.isArray(validations)) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery("terminal_candidate_recovery_validation_evidence_unavailable");
    }
    await verifyTerminalWkCandidateObjectBinding({
      binding,
      runGit
    });
    const state = Object.freeze({
      ...recoveredState,
      validation_evidence: Object.freeze([...validations])
    });
    cycles.set(wkId, state);
    return state;
  };

  const recoverTerminalCandidateWithRunner = async ({ wkId, runWithAuthority }) => {
    if (typeof wkId !== "string" || !/^WK-\d{4}$/u.test(wkId)) return null;
    try {
      return await runWithAuthority(async () => {

        const observed = await readTerminalCandidateCurrentRef({
          mainRepo,
          canonicalWkId: wkId,
          runGit
        });

        return authenticateCurrentControlledGeneration({
          mainRepo,
          wkId,
          expectedW: null,
          runGit,
          run: async (generationAuthentication) => recoverTerminalCandidateWithGeneration({
            wkId,
            generationAuthentication,
            observed
          })
        });
      });
    } catch (error) {
      if (!authenticatesTerminalCandidateFailures) {
        failUntrustedTerminalCandidateRunner();
      }

      if (terminalCandidateRecoveryFailures.has(error)) throw error;

      failTerminalCandidateConstruction(projectTerminalWkCandidateFailure(error));
    }
  };

  const recoverTerminalCandidate = async (wkId) => recoverTerminalCandidateWithRunner({
    wkId,
    runWithAuthority: async (run) => withControlledContractAuthorityExclusion({
      repoRoot: mainRepo, wkId, run
    })
  });

  const recoverTerminalCandidateUnderAuthority = async ({ wkId, authorityContext } = {}) =>
    recoverTerminalCandidateWithRunner({
      wkId,
      runWithAuthority: async (run) => runWithControlledContractAuthorityContext({
        repoRoot: mainRepo, wkId, authorityContext, run
      })
    });

  const validateTerminalCandidate = async ({ terminalCandidate }) =>
    runTerminalCandidateValidationsWithProofs({
      binding: terminalCandidate.binding,
      materialization: terminalCandidate.materialization,
      targets: terminalCandidate.canonical_targets,
      runtimeRoot: terminalCandidate.validation_runtime_root,
      validationBindings: terminalCandidate.canonical_validation_bindings ?? Object.freeze({}),
      runGit
    });

  const runTerminalCandidateValidationForUnit = async ({ unit, target }) => {
    const state = cycles.get(unit) ?? null;
    if (state === null) return null;
    if (!state.canonical_targets.includes(target)) {
      throw new Error("terminal candidate target is not present in the frozen canonical whole-WK contract");
    }
    const validation = await runTerminalCandidateValidation({
      binding: state.binding,
      materialization: state.materialization,
      target,
      runtimeRoot: state.validation_runtime_root,
      runGit
    });
    const validationBindings = state.canonical_validation_bindings ?? Object.freeze({});
    const receipts = await executeTerminalTestProofReceipts({
      binding: state.binding,
      materialization: state.materialization,
      targets: [target],
      validationBindings,
      runGit
    });
    return bindTerminalTestProofVerificationIds([validation], validationBindings, receipts)[0];
  };

  return Object.freeze({
    prepareTerminalCandidate,
    validateTerminalCandidate,
    recoverTerminalCandidate,
    recoverTerminalCandidateUnderAuthority,
    runTerminalCandidateValidationForUnit,
    resolve: (wkId) => cycles.get(wkId) ?? null
  });
}
