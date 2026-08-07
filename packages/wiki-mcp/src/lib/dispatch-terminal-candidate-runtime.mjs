

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import {
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest,
  projectSliceReviewReceiptContracts
} from "../../../wiki-core/src/index.mjs";
import {
  evaluateWorkRecordParentLifecycleContract
} from "../../../wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";

import {
  materializeTerminalCandidateCheckout
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import {
  assertTerminalWkCandidateInputsUnmoved,
  casTerminalCandidateCurrentRef,
  constructTerminalWkCandidate,
  deriveTerminalCandidateCurrentRef,
  deriveTerminalCandidateDurableRefs,
  deriveRecoveredTerminalWkCandidateIdentity,
  deriveTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  freezeReconstructedTerminalWkCandidateInputs,
  freezeRecoveredTerminalWkCandidateInputs,
  freezeTerminalWkCandidateInputs,
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

function declaredValidationTargets(record) {
  const allowed = Array.isArray(record?.sections?.structured_validation?.allowed)
    ? record.sections.structured_validation.allowed
    : [];
  const targets = allowed
    .filter((entry) => entry?.command === "node_test" && typeof entry.target === "string")
    .map((entry) => entry.target);
  return Object.freeze([...new Set(targets)].sort());
}

function projectTerminalReviewUnit(record) {
  const parentLifecycle = evaluateWorkRecordParentLifecycleContract(record);
  if (parentLifecycle.complete !== true) return null;
  const slice = parentLifecycle.terminal_review_contract_unit;
  const contracts = projectSliceReviewReceiptContracts(record, slice.id);
  if (contracts.slice_review_contract === null) return null;
  return Object.freeze({ slice_id: slice.id, contracts });
}

function exactWkBoundContract({ recordId, initiative = null, mainRepo, wkSha }) {
  let record;
  try {
    const result = defaultTerminalCandidateRunGit({
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
  const projected = projectTerminalReviewUnit(record);
  const reviewUnit = projected === null ? null : Object.freeze({
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
    targets: declaredValidationTargets(record),
    review_unit: reviewUnit
  });
}

export const TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION =
  "agent_launch.terminal_review_contract_binding.v1";

function canonicalCurrentTerminalReviewContract({ mainRepo, recordId }) {
  let record;
  try {
    const requested = path.resolve(mainRepo);

    if (realpathSync(requested) !== requested) return null;
    record = JSON.parse(readFileSync(
      path.join(requested, "wiki", "work-records", `${recordId}.json`),
      "utf8"
    ));
  } catch {
    return null;
  }
  if (record?.id !== recordId || !/^IN-\d{4}$/u.test(record?.initiative ?? "")) return null;
  const projected = projectTerminalReviewUnit(record);
  if (projected === null) return null;
  const subject = `${recordId}#${projected.slice_id}`;

  const binding = {
    schema_version: TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION,
    record_id: recordId,
    initiative: record.initiative,
    review_slice_id: projected.slice_id,
    review_subject: subject,
    review_unit_contract: projected.contracts.slice_review_contract
  };
  return Object.freeze({
    initiative: record.initiative,
    digest: computeWorkRecordSourceDigest(record),
    targets: declaredValidationTargets(record),
    review_subject: subject,
    review_contract_digest: `sha256:${createHash("sha256")
      .update(canonicalizeWorkRecordJson(binding))
      .digest("hex")}`,
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
    const operation = ownDataValue(args, "0");
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

function failTerminalCandidateRecovery(reason, cause = null) {
  const error = new Error(reason);
  error.code = reason;
  if (cause !== null) error.cause = cause;
  terminalCandidateRecoveryFailures.set(error, Object.freeze({
    reason,
    failure: UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION
  }));
  throw error;
}

function failTerminalCandidateConstruction(failure) {
  const reason = "terminal_candidate_recovery_construction_failed";
  const error = new Error(failure.message);
  error.code = reason;

  error.terminal_candidate_failure = failure;
  terminalCandidateRecoveryFailures.set(error, Object.freeze({ reason, failure }));
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
      const canonical = exactWkBoundContract({
        recordId: reviewUnit.record_id,
        initiative: reviewUnit.initiative,
        mainRepo,
        wkSha: integration.wk_sha
      });
      const frozen = freezeTerminalWkCandidateInputs({
        mainRepo,
        baseSha,
        baseRef,
        wkRef,
        canonicalWkId: wkId,
        canonicalWkDigest: canonical.digest,
        runGit
      });
      if (frozen.wk_tip !== integration.wk_sha) {
        throw new Error("terminal candidate frozen WK tip disagrees with final integration");
      }
      const binding = constructTerminalWkCandidate({ frozen, runGit });
      const candidateRoot = path.join(worktreeRoot, ".terminal-candidates", wkId, binding.candidate);
      const materialization = materializeTerminalCandidateCheckout({
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
        validation_runtime_root: path.join(worktreeRoot, ".terminal-validation", wkId, binding.candidate)
      });
      cycles.set(wkId, state);
      return state;
    } catch (error) {
      if (!authenticatesTerminalCandidateFailures) {
        failUntrustedTerminalCandidatePreparation();
      }
      if (terminalCandidateRecoveryFailures.has(error)) throw error;
      failTerminalCandidateConstruction(projectTerminalWkCandidateFailure(error));
    }
  };

  const reconstructAbsentTerminalCandidate = ({ wkId, currentRef }) => {
    const canonical = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });
    if (canonical === null) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery(
        "terminal_candidate_recovery_canonical_review_contract_unavailable");
    }
    const frozen = freezeReconstructedTerminalWkCandidateInputs({
      mainRepo,
      initiative: canonical.initiative,
      canonicalWkId: wkId,
      canonicalWkDigest: canonical.digest,
      terminalReviewSubject: canonical.review_subject,
      terminalReviewContractDigest: canonical.review_contract_digest,
      runGit
    });
    if (frozen === null) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_absent");
    }

    const derived = deriveTerminalWkCandidate({ frozen, runGit });

    const republished = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });
    if (republished === null ||
        republished.review_subject !== frozen.terminal_review_subject ||
        republished.review_contract_digest !== frozen.terminal_review_contract_digest) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery("terminal_candidate_recovery_review_contract_moved");
    }
    assertTerminalWkCandidateInputsUnmoved({ frozen, runGit });

    const refState = casTerminalCandidateCurrentRef({
      mainRepo,
      canonicalWkId: wkId,
      candidate: derived.candidate,
      expectedOld: null,

      verifyRefs: [
        { ref: frozen.wk_ref, oid: frozen.wk_tip },
        { ref: frozen.base_ref, oid: frozen.base }
      ],
      runGit
    });

    const published = readTerminalCandidateCurrentRef({ mainRepo, canonicalWkId: wkId, runGit });
    if (published !== derived.candidate || refState.ref !== currentRef ||
        (refState.state !== "created" && refState.state !== "converged")) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_publication_disagrees");
    }
    return published;
  };

  const recoveredCandidateReviewBinding = ({ wkId, candidate }) => {
    const metadata = readTerminalWkCandidateMetadata({ mainRepo, candidate, runGit });
    if (metadata.schema_version !== TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3) {
      const recoveredCanonical = exactWkBoundContract({ recordId: wkId, mainRepo, wkSha: candidate });
      if (recoveredCanonical.review_unit === null) {
        if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
        failTerminalCandidateRecovery("terminal_candidate_recovery_canonical_wk_binding_disagrees");
      }
      return {
        canonical: recoveredCanonical,
        canonicalWkDigest: null,
        wkRef: `refs/heads/wk/${recoveredCanonical.initiative}/${wkId}`
      };
    }
    const canonical = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });
    if (canonical === null) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery(
        "terminal_candidate_recovery_canonical_review_contract_unavailable");
    }

    if (canonical.review_subject !== metadata.terminal_review_subject) {
      if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
      failTerminalCandidateRecovery(
        "terminal_candidate_recovery_review_contract_binding_disagrees");
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

  const recoverTerminalCandidate = async (wkId) => {
    if (typeof wkId !== "string" || !/^WK-\d{4}$/u.test(wkId)) return null;
    try {
      const currentRef = deriveTerminalCandidateCurrentRef({ canonicalWkId: wkId });
      const observed = readTerminalCandidateCurrentRef({
        mainRepo,
        canonicalWkId: wkId,
        runGit
      });

      const candidate = observed === null
        ? reconstructAbsentTerminalCandidate({ wkId, currentRef })
        : observed;
      const { canonical: recoveredCanonical, canonicalWkDigest, wkRef } =
        recoveredCandidateReviewBinding({ wkId, candidate });
      const frozen = freezeRecoveredTerminalWkCandidateInputs({
        mainRepo,
        wkRef,
        canonicalWkId: wkId,
        candidate,
        canonicalWkDigest,
        runGit
      });
      const derived = deriveRecoveredTerminalWkCandidateIdentity({
        frozen,
        runGit
      });
      if (derived.candidate !== candidate || derived.candidate_ref !== currentRef) {
        if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
        failTerminalCandidateRecovery("terminal_candidate_recovery_no_deterministic_match");
      }
      const binding = Object.freeze({
        ...derived,
        candidate_ref_state: derived.candidate_ref_state === "derived"
          ? "recovered"
          : derived.candidate_ref_state
      });
      verifyTerminalWkCandidateObjectBinding({
        binding,
        runGit
      });
      const candidateRoot = path.join(worktreeRoot, ".terminal-candidates", wkId, binding.candidate);
      const materialization = materializeTerminalCandidateCheckout({
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
        validation_runtime_root: path.join(worktreeRoot, ".terminal-validation", wkId, binding.candidate)
      };
      const validations = await runAllTerminalCandidateValidations({
        binding,
        materialization,
        targets: recoveredState.canonical_targets,
        runtimeRoot: recoveredState.validation_runtime_root,
        runGit
      });
      if (!Array.isArray(validations)) {
        if (!authenticatesTerminalCandidateFailures) failUntrustedTerminalCandidateRunner();
        failTerminalCandidateRecovery("terminal_candidate_recovery_validation_evidence_unavailable");
      }
      verifyTerminalWkCandidateObjectBinding({
        binding,
        runGit
      });
      const state = Object.freeze({
        ...recoveredState,
        validation_evidence: Object.freeze([...validations])
      });
      cycles.set(wkId, state);
      return state;
    } catch (error) {
      if (!authenticatesTerminalCandidateFailures) {
        failUntrustedTerminalCandidateRunner();
      }

      if (terminalCandidateRecoveryFailures.has(error)) throw error;

      failTerminalCandidateConstruction(projectTerminalWkCandidateFailure(error));
    }
  };

  const validateTerminalCandidate = async ({ terminalCandidate }) => runAllTerminalCandidateValidations({
    binding: terminalCandidate.binding,
    materialization: terminalCandidate.materialization,
    targets: terminalCandidate.canonical_targets,
    runtimeRoot: terminalCandidate.validation_runtime_root,
    runGit
  });

  const runTerminalCandidateValidationForUnit = async ({ unit, target }) => {
    const state = cycles.get(unit) ?? null;
    if (state === null) return null;
    if (!state.canonical_targets.includes(target)) {
      throw new Error("terminal candidate target is not present in the frozen canonical whole-WK contract");
    }
    return runTerminalCandidateValidation({
      binding: state.binding,
      materialization: state.materialization,
      target,
      runtimeRoot: state.validation_runtime_root,
      runGit
    });
  };

  return Object.freeze({
    prepareTerminalCandidate,
    validateTerminalCandidate,
    recoverTerminalCandidate,
    runTerminalCandidateValidationForUnit,
    resolve: (wkId) => cycles.get(wkId) ?? null
  });
}
