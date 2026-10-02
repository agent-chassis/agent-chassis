

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import {
  resolveControlledContractTestProofRuntimeBindings
} from "../../../wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  computeWorkRecordSourceDigest,
  projectSliceReviewReceiptContracts
} from "../../../wiki-core/src/lib/work-record-schema.mjs";
import {
  projectWorkRecordTestProofValidation
} from "../../../wiki-core/src/lib/work-record-test-proof-bindings.mjs";
import {
  runWithControlledContractAuthorityContext,
  withControlledContractAuthorityExclusion
} from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";
import {
  CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES,
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
  TestProofRuntimeIdentityError
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import {
  TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION,
  constructTerminalReviewContractBinding,
  terminalReviewContractBindingIdentity
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs";
import {
  evaluateWorkRecordParentLifecycleContract,
  PARENT_LIFECYCLE_CONTRACT_FACTS
} from "../../../wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";
import {
  readTerminalWkCandidateMetadata,
  resolveTerminalWkCandidateBaseRef
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  materializeTerminalCandidateCheckout,
  verifyTerminalCandidateCheckout
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import {
  assertTerminalWkCandidateInputsUnmoved,
  assertTerminalWkCandidateVersionDecision,
  inspectTerminalWkCandidateVersion,
  deriveTerminalCandidateCurrentRef,
  deriveTerminalCandidateDurableRefs,
  deriveRecoveredTerminalWkCandidateIdentity,
  deriveTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  freezeReconstructedTerminalWkCandidateInputs,
  freezeRecoveredTerminalWkCandidateInputs,
  freezeTerminalWkCandidateInputs,
  closedTerminalWkCandidateGitDiagnosis,
  observeExactDirectCommitRef,
  projectTerminalWkCandidateGitDiagnosis,
  projectTerminalWkCandidateRefDisagreements,
  publishTerminalWkCandidateVersion,
  readTerminalCandidateCurrentRef,
  TERMINAL_WK_CANDIDATE_CODES,
  terminalWkCandidateVerifyRefs,
  TerminalWkCandidateError,
  verifyTerminalWkCandidateObjectBinding
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
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

    throw new Error(`current controlled-contract generation is absent for ${wkId}`);
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
  let authenticated;
  try {
    authenticated = await authenticateControlledContractGenerationAtW({
      binding,
      deps: { runGit }
    });
  } catch (error) {

    if (error?.code === CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED) {
      throw new TerminalWkCandidateError(
        "current controlled-contract generation is not persisted in the exact WK tip",
        { code: TERMINAL_WK_CANDIDATE_CODES.CONTROLLED_GENERATION_STALE }
      );
    }
    throw error;
  }
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
    throw new Error(`terminal candidate exact WK-bound contract is not parseable: ${error?.message ?? String(error)}`,
      { cause: error });
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

export function canonicalWorkRecordIdentity({ mainRepo, recordId }) {
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
  return Object.freeze({ ok: true, record, initiative: record.initiative });
}

export function canonicalCurrentTerminalReviewContract({ mainRepo, recordId }) {
  const identity = canonicalWorkRecordIdentity({ mainRepo, recordId });
  if (identity.ok !== true) return identity;
  const record = identity.record;
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

function registeredGitDiagnosis(error, code, gitOperation, gitStatus) {
  const registered = projectTerminalWkCandidateGitDiagnosis(error);
  if (registered === null || registered.code !== code ||
      registered.git_operation !== gitOperation || registered.git_status !== gitStatus) return null;
  return closedTerminalWkCandidateGitDiagnosis(registered.diagnosis);
}

function projectTypedTerminalCandidateDetail(error, code, detail) {
  const gitCode = code === TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED ||
    code === TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID;
  const disagreementCode = code === TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES;
  if (!gitCode && !disagreementCode) return null;
  if (!plainNonProxyObject(detail)) return null;
  const projected = {};
  const gitStatus = closedGitStatus(detail);
  const inferredOperation = gitStatus === undefined ? null : gitOperationFromInternalDetail(detail);
  const baseOperationEvidence = inferredOperation === "merge-base" ||
    (typeof ownDataValue(detail, "base") === "string" &&
      typeof ownDataValue(detail, "wk_tip") === "string");
  const gitOperation = code === TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID
    ? baseOperationEvidence ? "merge-base" : null
    : inferredOperation;
  if (gitOperation !== null) {
    projected.git_operation = gitOperation;
    projected.git_status = gitStatus;
    const diagnosis = registeredGitDiagnosis(error, code, gitOperation, gitStatus);
    if (diagnosis !== null) projected.git_diagnosis = diagnosis;
  } else if (gitCode) {
    return null;
  }
  if (disagreementCode) {
    const raw = ownDataValue(detail, "ref_disagreements");
    const disagreements = Array.isArray(raw) && !utilTypes.isProxy(raw)
      ? projectTerminalWkCandidateRefDisagreements(raw) : null;
    if (disagreements === null) return null;
    projected.ref_disagreements = disagreements;
  }
  return Object.freeze(projected);
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
      detail: projectTypedTerminalCandidateDetail(error, code, ownDataValue(error, "detail"))
    });
  } catch {
    return UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
  }
}

const terminalCandidateRecoveryFailures = new WeakMap();

export const TERMINAL_CANDIDATE_RECOVERY_REASONS = Object.freeze({
  FAILED: "terminal_candidate_recovery_failed",
  CONSTRUCTION_FAILED: "terminal_candidate_recovery_construction_failed",
  CANONICAL_RECORD_UNAVAILABLE: "terminal_candidate_recovery_canonical_record_unavailable",
  CURRENT_REF_ABSENT: "terminal_candidate_recovery_current_ref_absent",
  CURRENT_REF_PUBLICATION_DISAGREES:
    "terminal_candidate_recovery_current_ref_publication_disagrees",
  NO_DETERMINISTIC_MATCH: "terminal_candidate_recovery_no_deterministic_match"
});

export const TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION =
  "agent_launch.terminal_candidate_recovery_diagnostic.v1";

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

function failTerminalCandidateConstruction(failure, original) {
  const reason = "terminal_candidate_recovery_construction_failed";
  const error = new Error(failure.message, { cause: original });
  error.code = reason;

  terminalCandidateRecoveryFailures.set(error, Object.freeze({
    reason,
    failure,

    diagnostic: null
  }));
  throw error;
}

function untrustedRecoveryVerdict(reason) {
  return Object.assign(new Error(reason), { code: reason });
}

function failUntrustedTerminalCandidateRunner(original) {
  const error = new Error(TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_MESSAGE, { cause: original });
  error.code = TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_CODE;
  throw error;
}

function failUntrustedTerminalCandidatePreparation(original) {
  const error = new Error(TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_MESSAGE, { cause: original });
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

function terminalCandidateState({ worktreeRoot, wkId, binding, materialization, dependencyProof,
  contract, reviewUnit }) {
  return Object.freeze({
    binding,
    materialization,
    dependency_proof: dependencyProof,
    review_unit: reviewUnit,
    canonical_targets: contract.targets,
    canonical_validation_bindings: contract.validation_bindings,
    validation_runtime_root: path.join(worktreeRoot, ".terminal-validation", wkId, binding.candidate),
    version_decision: binding.version_decision
  });
}

function canonicalRecordInitiative({ mainRepo, recordId }) {
  const identity = canonicalWorkRecordIdentity({ mainRepo, recordId });
  return identity.ok === true ? identity.initiative : null;
}

export async function authenticateExistingTerminalCandidate({
  mainRepo, wkId, candidate, generationAuthentication, runGit = defaultTerminalCandidateRunGit
}) {
  const currentRef = deriveTerminalCandidateCurrentRef({ canonicalWkId: wkId });

  const contract = await exactWkBoundContract({
    recordId: wkId,
    mainRepo,
    wkSha: candidate,
    runGit
  });

  const recoveredWkRef = `refs/heads/wk/${contract.initiative}/${wkId}`;
  const recoveredBaseRef = resolveTerminalWkCandidateBaseRef({
    mainRepo,
    wkRef: recoveredWkRef,
    base: (await readTerminalWkCandidateMetadata({ mainRepo, candidate, runGit })).base
  });
  const frozen = await freezeRecoveredTerminalWkCandidateInputs({
    mainRepo,
    baseRef: recoveredBaseRef,
    wkRef: recoveredWkRef,
    canonicalWkId: wkId,
    candidate,
    generationAuthentication,
    runGit
  });
  const derived = await deriveRecoveredTerminalWkCandidateIdentity({
    frozen,
    runGit
  });
  if (derived.candidate !== candidate || derived.candidate_ref !== currentRef) {
    return Object.freeze({ deterministic: false, contract, frozen, binding: null });
  }
  const binding = Object.freeze({
    ...derived,
    candidate_ref_state: derived.candidate_ref_state === "derived"
      ? "recovered"
      : derived.candidate_ref_state
  });
  await verifyTerminalWkCandidateObjectBinding({ binding, runGit });
  return Object.freeze({ deterministic: true, contract, frozen, binding });
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

  const prepareTerminalCandidate = async ({ integration, initiative, wkId, wkRef, baseSha,
    baseRef }) => {
    try {
      if (integration?.wk_ref !== wkRef || integration?.wk_sha == null ||
          typeof wkId !== "string" || !/^WK-\d{4}$/u.test(wkId)) {
        throw new Error("terminal candidate preparation does not match the exact integrated WK identity");
      }

      if (typeof baseSha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseSha)) {
        throw new Error("terminal candidate preparation requires the launcher-bound WK lifecycle base");
      }
      if (typeof baseRef !== "string" || baseRef.length === 0) {
        throw new Error("terminal candidate preparation requires the launcher-bound WK base branch");
      }
      return await withCurrentControlledGeneration({
        mainRepo, wkId, expectedW: integration.wk_sha, runGit,
        run: async (generationAuthentication) => {
          const canonical = await exactWkBoundContract({
            recordId: wkId,
            initiative: initiative ?? null,
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
            verifyRefs: terminalWkCandidateVerifyRefs(frozen),
            runGit
          });
          const candidateRoot = path.join(worktreeRoot, ".terminal-candidates", wkId, binding.candidate);
          const materialization = await materializeTerminalCandidateCheckout({
            binding,
            candidateRoot,
            runGit
          });
          const dependencyProof = verifyTerminalCandidateDependencies({ binding, materialization });
          const state = terminalCandidateState({
            worktreeRoot,
            wkId, binding, materialization, dependencyProof, contract: canonical,
            reviewUnit: canonical.review_unit
          });
          cycles.set(wkId, state);
          return state;
        }
      });
    } catch (error) {
      if (!authenticatesTerminalCandidateFailures) {
        failUntrustedTerminalCandidatePreparation(error);
      }
      if (terminalCandidateRecoveryFailures.has(error)) throw error;
      failTerminalCandidateConstruction(projectTerminalWkCandidateFailure(error), error);
    }
  };

  const reconstructAbsentTerminalCandidate = async ({
    wkId, currentRef, generationAuthentication
  }) => {
    const initiative = canonicalRecordInitiative({ mainRepo, recordId: wkId });
    if (initiative === null) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner(
        untrustedRecoveryVerdict("terminal_candidate_recovery_canonical_record_unavailable"));
      failTerminalCandidateRecovery("terminal_candidate_recovery_canonical_record_unavailable");
    }

    const contract = await exactWkBoundContract({
      recordId: wkId,
      initiative,
      mainRepo,
      wkSha: generationAuthentication.wk_tip_sha,
      runGit
    });
    const frozen = await freezeReconstructedTerminalWkCandidateInputs({
      mainRepo,
      initiative,
      canonicalWkId: wkId,
      canonicalWkDigest: contract.digest,
      generationAuthentication,
      runGit
    });
    if (frozen === null) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner(
        untrustedRecoveryVerdict("terminal_candidate_recovery_current_ref_absent"));
      failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_absent");
    }
    const derived = await deriveTerminalWkCandidate({ frozen, runGit });
    await assertTerminalWkCandidateInputsUnmoved({ frozen, runGit });

    const publishedBinding = await publishTerminalWkCandidateVersion({
      binding: derived,
      expectedOld: null,
      verifyRefs: terminalWkCandidateVerifyRefs(frozen),
      runGit
    });

    const published = publishedBinding.current_selection_observation;
    if (published !== derived.candidate || publishedBinding.candidate_ref !== currentRef ||
        (publishedBinding.selection.state !== "created" &&
          publishedBinding.selection.state !== "converged")) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner(
        untrustedRecoveryVerdict("terminal_candidate_recovery_current_ref_publication_disagrees"));
      failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_publication_disagrees");
    }
    return Object.freeze({ candidate: published });
  };

  const reviewConsumerUnit = ({ wkId, contract }) => {
    if (contract.review_unit !== null) return contract.review_unit;
    const current = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });
    return current.ok === true ? current.contract.review_unit : null;
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
    const { contract, frozen, recoveredBinding } = await authenticateExistingCandidate({
      wkId, candidate, generationAuthentication
    });
    const binding = await publishTerminalWkCandidateVersion({
      binding: recoveredBinding,
      expectedOld: candidate,
      verifyRefs: terminalWkCandidateVerifyRefs(frozen),
      runGit
    });
    const candidateRoot = path.join(worktreeRoot, ".terminal-candidates", wkId, binding.candidate);
    const materialization = await materializeTerminalCandidateCheckout({
      binding,
      candidateRoot,
      runGit
    });
    const dependencyProof = verifyTerminalCandidateDependencies({ binding, materialization });
    const state = terminalCandidateState({
            worktreeRoot,
      wkId, binding, materialization, dependencyProof, contract,
      reviewUnit: reviewConsumerUnit({ wkId, contract })
    });
    await verifyTerminalWkCandidateObjectBinding({
      binding,
      runGit
    });
    cycles.set(wkId, state);
    return state;
  };

  const authenticateExistingCandidate = async ({ wkId, candidate, generationAuthentication }) => {
    const authenticated = await authenticateExistingTerminalCandidate({
      mainRepo, wkId, candidate, generationAuthentication, runGit
    });
    if (authenticated.deterministic !== true) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner(
        untrustedRecoveryVerdict("terminal_candidate_recovery_no_deterministic_match"));
      failTerminalCandidateRecovery("terminal_candidate_recovery_no_deterministic_match");
    }
    return Object.freeze({
      contract: authenticated.contract,
      frozen: authenticated.frozen,
      recoveredBinding: authenticated.binding
    });
  };

  const observeTerminalCandidateWithGeneration = async ({
    wkId, generationAuthentication, observed
  }) => {
    const { contract, recoveredBinding } = await authenticateExistingCandidate({
      wkId, candidate: observed, generationAuthentication
    });
    const versionDecision = await inspectTerminalWkCandidateVersion({
      binding: recoveredBinding, runGit
    });
    assertTerminalWkCandidateVersionDecision(versionDecision, {
      binding: recoveredBinding,
      requireSelected: true
    });
    const binding = Object.freeze({ ...recoveredBinding, version_decision: versionDecision });
    const materialization = await verifyTerminalCandidateCheckout({
      binding,
      candidateRoot: path.join(worktreeRoot, ".terminal-candidates", wkId, binding.candidate),
      runGit
    });
    return terminalCandidateState({
      worktreeRoot,
      wkId, binding, materialization,
      dependencyProof: verifyTerminalCandidateDependencies({ binding, materialization }),
      contract,
      reviewUnit: null
    });
  };

  const assertDurableReconstructionAuthority = async (wkId) => {
    const initiative = canonicalRecordInitiative({ mainRepo, recordId: wkId });
    if (initiative === null) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner(
        untrustedRecoveryVerdict("terminal_candidate_recovery_canonical_record_unavailable"));
      failTerminalCandidateRecovery("terminal_candidate_recovery_canonical_record_unavailable");
    }
    const refs = deriveTerminalCandidateDurableRefs({ initiative, canonicalWkId: wkId });
    for (const [ref, subject] of [[refs.fork_ref, "durable WK fork ref"], [refs.wk_ref, "durable WK ref"]]) {
      if (await observeExactDirectCommitRef({ mainRepo, ref, runGit, subject }) === null) {
        if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner(
          untrustedRecoveryVerdict("terminal_candidate_recovery_current_ref_absent"));
        failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_absent");
      }
    }
  };

  const recoverTerminalCandidateWithRunner = async ({
    wkId, runWithAuthority, withGeneration = recoverTerminalCandidateWithGeneration
  }) => {
    if (typeof wkId !== "string" || !/^WK-\d{4}$/u.test(wkId)) return null;
    try {
      return await runWithAuthority(async () => {

        const observed = await readTerminalCandidateCurrentRef({
          mainRepo,
          canonicalWkId: wkId,
          runGit
        });

        if (observed === null) {

          if (withGeneration !== recoverTerminalCandidateWithGeneration) {
            if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner(
              untrustedRecoveryVerdict("terminal_candidate_recovery_current_ref_absent"));
            failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_absent");
          }
          await assertDurableReconstructionAuthority(wkId);
        }

        return authenticateCurrentControlledGeneration({
          mainRepo,
          wkId,
          expectedW: null,
          runGit,
          run: async (generationAuthentication) => withGeneration({
            wkId,
            generationAuthentication,
            observed
          })
        });
      });
    } catch (error) {
      if (!authenticatesTerminalCandidateFailures) {
        failUntrustedTerminalCandidateRunner(error);
      }

      if (terminalCandidateRecoveryFailures.has(error)) throw error;

      failTerminalCandidateConstruction(projectTerminalWkCandidateFailure(error), error);
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

  const observeTerminalCandidateUnderAuthority = async ({ wkId, authorityContext } = {}) =>
    recoverTerminalCandidateWithRunner({
      wkId,
      withGeneration: observeTerminalCandidateWithGeneration,
      runWithAuthority: async (run) => runWithControlledContractAuthorityContext({
        repoRoot: mainRepo, wkId, authorityContext, run
      })
    });

  return Object.freeze({
    prepareTerminalCandidate,
    recoverTerminalCandidate,
    recoverTerminalCandidateUnderAuthority,
    observeTerminalCandidateUnderAuthority,
    resolve: (wkId) => cycles.get(wkId) ?? null
  });
}
