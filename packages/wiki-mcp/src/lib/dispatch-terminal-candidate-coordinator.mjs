

import path from "node:path";
import { types as utilTypes } from "node:util";
import {
  runWithControlledContractAuthorityContext,
  withControlledContractAuthorityExclusion
} from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";
import {
  authenticateCurrentControlledContractGenerationStateAtW
} from "@agent-chassis/agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs";
import {
  TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs";
import {
  materializeTerminalCandidateCheckout,
  verifyTerminalCandidateCheckout
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-candidate-checkout.mjs";
import {
  assertTerminalWkCandidateInputsUnmoved,
  assertTerminalWkCandidateVersionDecision,
  inspectTerminalWkCandidateVersion,
  deriveTerminalCandidateCurrentRef,
  deriveTerminalCandidateDurableRefs,
  deriveTerminalWkCandidate,
  deriveTerminalWkCandidateVersionIdentity,
  defaultTerminalCandidateRunGit,
  freezeReconstructedTerminalWkCandidateInputs,
  freezeTerminalWkCandidateInputs,
  closedTerminalWkCandidateGitDiagnosis,
  observeExactDirectCommitRef,
  projectTerminalWkCandidateGitDiagnosis,
  projectTerminalWkCandidateRefDisagreements,
  publishTerminalWkCandidateVersion,
  readTerminalCandidateCurrentRef,
  readTerminalWkCandidateMetadata,
  TERMINAL_WK_CANDIDATE_CODES,
  terminalWkCandidateVerifyRefs,
  TerminalWkCandidateError,
  verifyTerminalWkCandidateObjectBinding
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  verifyTerminalCandidateDependencies
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate-validation.mjs";
import {
  authenticateExistingTerminalCandidate,
  terminalCandidateState
} from "./dispatch-terminal-candidate-authentication.mjs";
import {
  isControlledGenerationNotPersisted
} from "./dispatch-terminal-candidate-publication.mjs";
import {
  canonicalCurrentTerminalReviewContract,
  canonicalRecordInitiative,
  exactWkBoundContract
} from "./dispatch-terminal-review-contract.mjs";

async function authenticateCurrentControlledGeneration({
  mainRepo, wkId, expectedW, runGit, run
}) {
  const authenticate = async () => {
    let authenticated;
    ({ authenticated } = await authenticateCurrentControlledContractGenerationStateAtW({
      repoRoot: mainRepo,
      wkId,
      ...(expectedW === null ? {} : { expectedWkTipSha: expectedW }),
      deps: { runGit }
    }));
    return authenticated;
  };
  const refuse = (error) => {
    if (!isControlledGenerationNotPersisted(error)) throw error;

    throw new TerminalWkCandidateError(
      "current controlled-contract generation is not persisted in the exact WK tip",
      { code: TERMINAL_WK_CANDIDATE_CODES.CONTROLLED_GENERATION_STALE, cause: error }
    );
  };
  let authenticated;
  try {
    authenticated = await authenticate();
  } catch (error) {
    refuse(error);
  }
  return run(authenticated);
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

export { TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION };

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
  NO_DETERMINISTIC_MATCH: "terminal_candidate_recovery_no_deterministic_match",
  EXPECTED_VERSION_MISMATCH: "terminal_candidate_recovery_expected_version_mismatch"
});

export const TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION =
  "agent_launch.terminal_candidate_recovery_diagnostic.v1";

function failTerminalCandidateRecovery(reason, diagnostic = null) {
  const error = new Error(reason);
  error.code = reason;
  terminalCandidateRecoveryFailures.set(error, Object.freeze({
    reason,
    failure: null,
    diagnostic
  }));
  throw error;
}

function failTerminalCandidateConstruction(failure, original) {
  if ((typeof original === "object" && original !== null) || typeof original === "function") {
    terminalCandidateRecoveryFailures.set(original, Object.freeze({
      reason: TERMINAL_CANDIDATE_RECOVERY_REASONS.CONSTRUCTION_FAILED,
      failure: failure.kind === "typed_candidate_error" ? failure : null,
      diagnostic: null
    }));
  }
  throw original;
}

function untrustedRecoveryVerdict(reason) {
  return Object.assign(new Error(reason), { code: reason });
}

const UNTRUSTED_TERMINAL_CANDIDATE_FAILURE_RECORD = Object.freeze({
  reason: "terminal_candidate_recovery_failed",
  failure: null,
  diagnostic: null
});

function forwardUntrustedTerminalCandidateFailure(original) {
  if ((typeof original === "object" && original !== null) || typeof original === "function") {
    terminalCandidateRecoveryFailures.set(original, UNTRUSTED_TERMINAL_CANDIDATE_FAILURE_RECORD);
  }
  throw original;
}

export function isForwardedTerminalCandidateFailure(error) {
  return ((typeof error === "object" && error !== null) || typeof error === "function") &&
    terminalCandidateRecoveryFailures.has(error);
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

  const prepareTerminalCandidate = async ({ integration, initiative, wkId, wkRef, baseSha,
    baseRef, preserveSelectedCandidate = false }) => {
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
          if (preserveSelectedCandidate && expectedOld !== null && expectedOld !== derived.candidate) {
            failTerminalCandidateRecovery("terminal_candidate_recovery_expected_version_mismatch");
          }
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
      if (isForwardedTerminalCandidateFailure(error)) throw error;
      if (!authenticatesTerminalCandidateFailures) forwardUntrustedTerminalCandidateFailure(error);
      failTerminalCandidateConstruction(projectTerminalWkCandidateFailure(error), error);
    }
  };

  const reconstructAbsentTerminalCandidate = async ({
    wkId, currentRef, generationAuthentication, expectedVersion, expectedOld = null
  }) => {
    const initiative = canonicalRecordInitiative({ mainRepo, recordId: wkId });
    if (initiative === null) {
      if (!authenticatesTerminalCandidateFailures) {
        throw untrustedRecoveryVerdict("terminal_candidate_recovery_canonical_record_unavailable");
      }
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
      if (!authenticatesTerminalCandidateFailures) {
        throw untrustedRecoveryVerdict("terminal_candidate_recovery_current_ref_absent");
      }
      failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_absent");
    }
    const derived = await deriveTerminalWkCandidate({ frozen, runGit });
    await assertTerminalWkCandidateInputsUnmoved({ frozen, runGit });

    if (expectedVersion !== null &&
        deriveTerminalWkCandidateVersionIdentity({ binding: derived }) !== expectedVersion) {
      if (!authenticatesTerminalCandidateFailures) {
        throw untrustedRecoveryVerdict("terminal_candidate_recovery_expected_version_mismatch");
      }
      failTerminalCandidateRecovery("terminal_candidate_recovery_expected_version_mismatch");
    }

    const publishedBinding = await publishTerminalWkCandidateVersion({
      binding: derived,
      expectedOld,
      verifyRefs: terminalWkCandidateVerifyRefs(frozen),
      runGit
    });

    const published = publishedBinding.current_selection_observation;
    if (published !== derived.candidate || publishedBinding.candidate_ref !== currentRef ||
        (publishedBinding.selection.state !== (expectedOld === null ? "created" : "advanced") &&
          publishedBinding.selection.state !== "converged")) {
      if (!authenticatesTerminalCandidateFailures) {
        throw untrustedRecoveryVerdict("terminal_candidate_recovery_current_ref_publication_disagrees");
      }
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
    wkId, generationAuthentication, observed, expectedVersion
  }) => {
    const currentRef = deriveTerminalCandidateCurrentRef({ canonicalWkId: wkId });

    const reconstruction = observed === null
      ? await reconstructAbsentTerminalCandidate({
          wkId, currentRef, generationAuthentication, expectedVersion
        })
      : null;
    const candidate = reconstruction?.candidate ?? observed;
    const { contract, frozen, recoveredBinding } = await authenticateExistingCandidate({
      wkId, candidate, generationAuthentication
    });

    if (expectedVersion !== null &&
        deriveTerminalWkCandidateVersionIdentity({ binding: recoveredBinding }) !== expectedVersion) {
      if (!authenticatesTerminalCandidateFailures) {
        throw untrustedRecoveryVerdict("terminal_candidate_recovery_expected_version_mismatch");
      }
      failTerminalCandidateRecovery("terminal_candidate_recovery_expected_version_mismatch");
    }
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
      if (!authenticatesTerminalCandidateFailures) {
        throw untrustedRecoveryVerdict("terminal_candidate_recovery_no_deterministic_match");
      }
      failTerminalCandidateRecovery("terminal_candidate_recovery_no_deterministic_match");
    }
    return Object.freeze({
      contract: authenticated.contract,
      frozen: authenticated.frozen,
      recoveredBinding: authenticated.binding
    });
  };

  const observeTerminalCandidateWithGeneration = async ({
    wkId, generationAuthentication, observed, expectedVersion = null
  }) => {
    const { contract, recoveredBinding } = await authenticateExistingCandidate({
      wkId, candidate: observed, generationAuthentication
    });
    if (expectedVersion !== null &&
        deriveTerminalWkCandidateVersionIdentity({ binding: recoveredBinding }) !== expectedVersion) {
      if (!authenticatesTerminalCandidateFailures) throw untrustedRecoveryVerdict("terminal_candidate_recovery_expected_version_mismatch");
      failTerminalCandidateRecovery("terminal_candidate_recovery_expected_version_mismatch");
    }
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
      if (!authenticatesTerminalCandidateFailures) {
        throw untrustedRecoveryVerdict("terminal_candidate_recovery_canonical_record_unavailable");
      }
      failTerminalCandidateRecovery("terminal_candidate_recovery_canonical_record_unavailable");
    }
    const refs = deriveTerminalCandidateDurableRefs({ initiative, canonicalWkId: wkId });
    for (const [ref, subject] of [[refs.fork_ref, "durable WK fork ref"], [refs.wk_ref, "durable WK ref"]]) {
      if (await observeExactDirectCommitRef({ mainRepo, ref, runGit, subject }) === null) {
        if (!authenticatesTerminalCandidateFailures) {
          throw untrustedRecoveryVerdict("terminal_candidate_recovery_current_ref_absent");
        }
        failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_absent");
      }
    }
  };

  const recoverTerminalCandidateWithRunner = async ({
    wkId, runWithAuthority, withGeneration = recoverTerminalCandidateWithGeneration,
    expectedVersion = null
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
            if (!authenticatesTerminalCandidateFailures) {
              throw untrustedRecoveryVerdict("terminal_candidate_recovery_current_ref_absent");
            }
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
            observed,
            expectedVersion
          })
        });
      });
    } catch (error) {

      if (isForwardedTerminalCandidateFailure(error)) throw error;

      if (!authenticatesTerminalCandidateFailures) {
        forwardUntrustedTerminalCandidateFailure(error);
      }
      failTerminalCandidateConstruction(projectTerminalWkCandidateFailure(error), error);
    }
  };

  const recoverTerminalCandidate = async (wkId) => recoverTerminalCandidateWithRunner({
    wkId,
    runWithAuthority: async (run) => withControlledContractAuthorityExclusion({
      repoRoot: mainRepo, wkId, run
    })
  });

  const recoverTerminalCandidateUnderAuthority = async ({
    wkId, authorityContext, expectedVersion = null
  } = {}) => recoverTerminalCandidateWithRunner({
        wkId,
        expectedVersion,
        withGeneration: observeTerminalCandidateWithGeneration,
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

  const observeTerminalCandidate = async (wkId) => {
    try {
      return await recoverTerminalCandidateWithRunner({
        wkId,
        withGeneration: observeTerminalCandidateWithGeneration,
        runWithAuthority: async (run) => {
          const observed = await run();
          const selected = await readTerminalCandidateCurrentRef({
            mainRepo, canonicalWkId: wkId, runGit
          });
          if (selected !== observed.binding.candidate) {
            if (!authenticatesTerminalCandidateFailures) {
              throw untrustedRecoveryVerdict("terminal_candidate_recovery_current_ref_publication_disagrees");
            }
            failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_publication_disagrees");
          }
          return observed;
        }
      });
    } catch (error) {
      if (terminalCandidateRecoveryFailures.get(error)?.reason ===
          TERMINAL_CANDIDATE_RECOVERY_REASONS.CURRENT_REF_ABSENT) return null;
      throw error;
    }
  };

  return Object.freeze({
    prepareTerminalCandidate,
    recoverTerminalCandidate,
    recoverTerminalCandidateUnderAuthority,
    observeTerminalCandidateUnderAuthority,
    observeTerminalCandidate,
    resolve: (wkId) => cycles.get(wkId) ?? null
  });
}
