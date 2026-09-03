

import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import {
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest,
  projectSliceReviewReceiptContracts
} from "../../../wiki-core/src/index.mjs";
import {
  evaluateWorkRecordParentLifecycleContract,
  PARENT_LIFECYCLE_CONTRACT_FACTS
} from "../../../wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";

import {
  materializeTerminalCandidateCheckout
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import {
  assertTerminalWkCandidateVersionDecision,
  inspectTerminalReviewCandidateAuthority,
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
  readExactWkRecordBlobObservation,
  readTerminalCandidateCurrentRef,
  readTerminalWkCandidateMetadata,
  TERMINAL_WK_CANDIDATE_CODES,
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION,
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,
  TerminalWkCandidateError,
  verifyTerminalWkCandidateObjectBinding
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  assertAdmissibleLiveTerminalReviewCoordination,
  decideAuthenticatedTerminalReviewLifecycleDelta
} from "@agent-chassis/agent-launch-cli/src/lib/backend-terminal-review-lifecycle-authority.mjs";
import {
  authenticateControlledContractGenerationAtW,
  resolveControlledContractGenerationBinding
} from "@agent-chassis/agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs";
import { resolveControlledContractAttachmentGeneration } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  assertAuthenticatedControlledContractGeneration,
  authenticatedControlledContractGenerationsEqual
} from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-generation-authentication.mjs";
import {
  runAllTerminalCandidateValidations,
  runTerminalCandidateValidation,
  verifyTerminalCandidateDependencies
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate-validation.mjs";
import {
  CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES,
  canonicalCurrentTerminalReviewContract,
  projectTerminalReviewUnit,
  TERMINAL_REVIEW_UNIT_PROJECTION_CODES
} from "./dispatch-terminal-candidate-coordinator.mjs";

export {
  CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES,
  TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION,
  TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION,
  TERMINAL_CANDIDATE_RECOVERY_REASONS,
  TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE,
  TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION,
  TERMINAL_REVIEW_UNIT_PROJECTION_CODES,
  TERMINAL_TEST_PROOF_RUNTIME_REFUSAL_CODES,
  bindTerminalTestProofVerificationIds,
  createTerminalCandidateCoordinator,
  projectAuthenticatedTerminalCandidateFailure,
  projectTerminalCandidateRecoveryDiagnostic,
  projectTerminalCandidateRecoveryReason,
  projectTerminalWkCandidateFailure
} from "./dispatch-terminal-candidate-coordinator.mjs";

export const TERMINAL_CANDIDATE_STATUS_SCHEMA_VERSION =
  "agent_launch.terminal_candidate_status.v1";
export const TERMINAL_CANDIDATE_ADVANCE_SCHEMA_VERSION =
  "agent_launch.terminal_candidate_advance.v1";
export const TERMINAL_CANDIDATE_RUNTIME_CODES = Object.freeze({
  TERMINAL_REVIEW_WORKFLOW_NOT_SELECTED:
    "agent_launch.terminal_candidate.status.workflow_not_selected.v1",
  CANDIDATE_ABSENT: "agent_launch.terminal_candidate.status.candidate_absent.v1",
  CANDIDATE_IDENTITY_INVALID_OR_MOVED:
    "agent_launch.terminal_candidate.status.candidate_identity_invalid_or_moved.v1",
  CANDIDATE_BOUND: "agent_launch.terminal_candidate.status.candidate_bound.v1",
  LIVE_COORDINATION_INADMISSIBLE:
    "agent_launch.terminal_candidate.status.live_coordination_inadmissible.v1",
  CANDIDATE_STALE_W: "agent_launch.terminal_candidate.status.candidate_stale_w.v1",
  CANDIDATE_AUTHORED_CONTRACT_DIVERGENT:
    "agent_launch.terminal_candidate.status.candidate_authored_contract_divergent.v1",
  CANDIDATE_HEALTHY: "agent_launch.terminal_candidate.status.candidate_healthy.v1",
  CANONICAL_ROOT_INVALID:
    "agent_launch.terminal_candidate.canonical_root_invalid.v1",
  CANONICAL_RECORD_UNREADABLE:
    "agent_launch.terminal_candidate.canonical_record_unreadable.v1",
  TRANSPORT_FAILURE: "agent_launch.terminal_candidate.transport_failure.v1",
  CONTINUATION_INVALID: "agent_launch.terminal_candidate.continuation_invalid.v1",
  CONTINUATION_STALE: "agent_launch.terminal_candidate.continuation_stale.v1",
  ROUTE_FAILURE: "agent_launch.terminal_candidate.route_failure.v1",
  ADVANCE_NOT_STALE: "agent_launch.terminal_candidate.advance_not_stale.v1",
  ADVANCE_SCHEMA_REFUSED: "agent_launch.terminal_candidate.advance_schema_refused.v1",
  ADVANCE_INPUT_MOVED: "agent_launch.terminal_candidate.advance_input_moved.v1",
  ADVANCE_FINAL_RECHECK_FAILED:
    "agent_launch.terminal_candidate.advance_final_recheck_failed.v1",
  ADVANCE_GENERATION_ABSENT:
    "agent_launch.terminal_candidate.advance_generation_absent.v1"
});

const STATUS_CODE_BY_STATE = Object.freeze({
  terminal_review_workflow_not_selected:
    TERMINAL_CANDIDATE_RUNTIME_CODES.TERMINAL_REVIEW_WORKFLOW_NOT_SELECTED,
  candidate_absent: TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_ABSENT,
  candidate_identity_invalid_or_moved:
    TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_IDENTITY_INVALID_OR_MOVED,
  candidate_bound: TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_BOUND,
  live_coordination_inadmissible:
    TERMINAL_CANDIDATE_RUNTIME_CODES.LIVE_COORDINATION_INADMISSIBLE,
  candidate_stale_w: TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_STALE_W,
  candidate_authored_contract_divergent:
    TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_AUTHORED_CONTRACT_DIVERGENT,
  candidate_healthy: TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_HEALTHY
});
const STATUS_CONTINUATION_SECRET = randomBytes(32);
const statusAuthoritySnapshots = new WeakMap();

export class TerminalCandidateRuntimeError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "TerminalCandidateRuntimeError";
    this.code = code;
    this.detail = detail;
  }
}

function runtimeRefusal(code, message, detail = null) {
  throw new TerminalCandidateRuntimeError(code, message, detail);
}

function plainNonProxyObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function appendAcceptedRepository(nextCall, acceptedRepository) {
  if (nextCall === null || acceptedRepository === undefined) return nextCall;
  if (!plainNonProxyObject(nextCall) || !plainNonProxyObject(nextCall.arguments) ||
      Object.hasOwn(nextCall.arguments, "repo")) {
    runtimeRefusal(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "terminal candidate continuation repository projection is invalid");
  }
  return Object.freeze({
    ...nextCall,
    arguments: Object.freeze({ ...nextCall.arguments, repo: acceptedRepository })
  });
}

function statusResult({ state, cause = null, nextCall = null, candidate = null, divergence = null,
  versionLifecycle = null, decidingFacts = null, workflowGuidance = null },
  snapshot = null, acceptedRepository = undefined) {
  const result = Object.freeze({
    schema_version: TERMINAL_CANDIDATE_STATUS_SCHEMA_VERSION,
    state,
    code: STATUS_CODE_BY_STATE[state],
    cause,
    next_call: appendAcceptedRepository(nextCall, acceptedRepository),
    candidate,
    divergence,
    version_lifecycle: versionLifecycle,
    ...(decidingFacts === null ? {} : { deciding_facts: decidingFacts }),
    ...(workflowGuidance === null ? {} : { workflow_guidance: workflowGuidance })
  });
  if (snapshot !== null) statusAuthoritySnapshots.set(result, snapshot);
  return result;
}

const TERMINAL_WORKFLOW_NOT_SELECTED_CAUSE = "zero_eligible_terminal_review_units";
const TERMINAL_WORKFLOW_NOT_SELECTED_DECIDING_FACTS = Object.freeze([
  Object.freeze({ field: "canonical_record.valid", value: true }),
  Object.freeze({ field: "canonical_parent_identity.complete", value: true }),
  Object.freeze({ field: "canonical_parent_acceptance.complete", value: true }),
  Object.freeze({ field: "terminal_review_designation.eligible_count", value: 0 })
]);
const TERMINAL_WORKFLOW_NOT_SELECTED_GUIDANCE = Object.freeze({
  applies_only_to: "launcher_built_managed_terminal_candidate",
  summary:
    "This status route applies only to launcher-built managed terminal candidates.",
  direct_to_main: Object.freeze({
    lifecycle: "operator_authorized_direct_to_main",
    first_step: "commit_the_exact_scoped_implementation_candidate",
    review_tool: "workspace_agent_dispatch",
    review_request: Object.freeze({
      role: "reviewer",
      subject: "canonical_WK_or_review_slice",
      required_additional_fields: Object.freeze(["diff_base_sha", "reviewed_sha"]),
      sha_pair_requirement: "complete_landed_commit_diff_base_sha_and_reviewed_sha"
    }),
    reviewer_git_posture: "read_only_and_never_creates_git_objects"
  }),
  excluded_operations: Object.freeze([
    "workspace_terminal_review_candidate_status",
    "workspace_terminal_review_candidate_advance",
    "workspace_wk_forge_handoff",
    "external_review",
    "shell_review"
  ])
});

function isTerminalWorkflowNotSelected(cause) {
  return cause?.code ===
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.TERMINAL_REVIEW_UNIT_UNPROJECTABLE &&
    cause?.projection_code ===
      TERMINAL_REVIEW_UNIT_PROJECTION_CODES.PARENT_LIFECYCLE_CONTRACT_INCOMPLETE &&
    cause.missing_facts?.length === 1 &&
    cause.missing_facts[0] === PARENT_LIFECYCLE_CONTRACT_FACTS.TERMINAL_REVIEW_CONTRACT_UNIT &&
    cause.ambiguous_facts?.length === 0;
}

function canonicalTerminalCoordinationFailureCause(cause) {
  if (cause?.projection_code ===
      TERMINAL_REVIEW_UNIT_PROJECTION_CODES.PARENT_LIFECYCLE_CONTRACT_INCOMPLETE) {
    if (cause.missing_facts?.length === 0 && cause.ambiguous_facts?.length === 1 &&
        cause.ambiguous_facts[0] ===
          PARENT_LIFECYCLE_CONTRACT_FACTS.TERMINAL_REVIEW_CONTRACT_UNIT) {
      return "ambiguous_terminal_review_coordination";
    }
    return TERMINAL_REVIEW_UNIT_PROJECTION_CODES.PARENT_LIFECYCLE_CONTRACT_INCOMPLETE;
  }
  return cause?.projection_code ?? cause?.code ?? "canonical_terminal_review_contract_invalid";
}

function continuationMac(encodedPayload) {
  return createHmac("sha256", STATUS_CONTINUATION_SECRET)
    .update(encodedPayload)
    .digest("base64url");
}

function encodeStatusContinuation(payload) {
  const encoded = Buffer.from(canonicalizeWorkRecordJson(payload), "utf8").toString("base64url");
  return `${encoded}.${continuationMac(encoded)}`;
}

function decodeStatusContinuation(token) {
  if (typeof token !== "string" || token.length === 0 || token.length > 8192) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_INVALID,
      "terminal candidate status continuation is invalid");
  }
  const [encoded, mac, extra] = token.split(".");
  if (extra !== undefined || typeof encoded !== "string" || typeof mac !== "string" ||
      continuationMac(encoded) !== mac) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_INVALID,
      "terminal candidate status continuation is invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_INVALID,
      "terminal candidate status continuation is invalid");
  }
  if (!plainNonProxyObject(parsed) || !Number.isInteger(parsed.offset) || parsed.offset < 1) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_INVALID,
      "terminal candidate status continuation is invalid");
  }
  return parsed;
}

function statusCandidateProjection(snapshot) {
  if (snapshot === null) return null;
  return Object.freeze({
    candidate: snapshot.candidate,
    schema_version: snapshot.schema,
    base: snapshot.base,
    embedded_w: snapshot.embeddedW,
    current_w: snapshot.currentW,
    version_identity: snapshot.versionDecision?.version_identity ?? null,
    immutable_version_ref: snapshot.versionDecision?.immutable_version_ref ?? null,
    current_selection_ref: snapshot.versionDecision?.current_selection_ref ?? null,
    current_selection_observation:
      snapshot.versionDecision?.current_selection_observation ?? null
  });
}

function objectFormatForOid(oid) {
  return oid?.length === 64 ? "sha256" : "sha1";
}

function parseExactRecordObservation(observation, wkId, refusalCode) {
  if (observation?.state !== "present") return null;
  let record;
  try {
    record = JSON.parse(observation.content);
  } catch {
    runtimeRefusal(refusalCode, "exact WK record blob is not parseable");
  }
  if (record?.id !== wkId || !/^IN-\d{4}$/u.test(record?.initiative ?? "")) {
    runtimeRefusal(refusalCode, "exact WK record blob identity disagrees");
  }
  return record;
}

function currentCanonicalContractForStatus(mainRepo, wkId) {
  const resolved = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });
  if (resolved.ok === true) return resolved;
  if (resolved.cause.code === CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.REPOSITORY_ROOT_NOT_CANONICAL) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CANONICAL_ROOT_INVALID,
      "canonical repository root is not readable under its exact identity");
  }
  if (resolved.cause.code === CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_UNREADABLE) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CANONICAL_RECORD_UNREADABLE,
      "canonical WK record is unreadable");
  }
  return resolved;
}

function classifyThrownCandidateError(error) {
  if (error?.code === TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.TRANSPORT_FAILURE,
      "terminal candidate Git observation failed");
  }
  return error;
}

async function readV2HistoricalContract({ mainRepo, wkId, inspection, runGit }) {
  let observation;
  try {
    observation = await readExactWkRecordBlobObservation({
      mainRepo,
      wkTip: inspection.candidate_oid,
      canonicalWkId: wkId,
      objectFormat: objectFormatForOid(inspection.candidate_oid),
      runGit
    });
  } catch (error) {
    classifyThrownCandidateError(error);
    return Object.freeze({ ok: false, cause: error?.code ?? "historical_record_invalid" });
  }
  if (observation.state === "absent") {
    return Object.freeze({ ok: false, cause: "historical_record_absent", observation });
  }
  let record;
  try {
    record = JSON.parse(observation.content);
  } catch {
    return Object.freeze({ ok: false, cause: "historical_record_unparseable" });
  }
  if (record?.id !== wkId || record?.initiative !== inspection.initiative) {
    return Object.freeze({ ok: false, cause: "historical_record_identity_disagrees" });
  }
  const projected = projectTerminalReviewUnit(record);
  if (projected.ok !== true) {
    return Object.freeze({ ok: false, cause: projected.cause.code, observation: projected.cause });
  }
  return Object.freeze({
    ok: true,
    record,
    digest: computeWorkRecordSourceDigest(record),
    slice_id: projected.slice_id,
    parent_contract: projected.contracts.canonical_parent_wk_contract
  });
}

function divergenceBinding(snapshot) {
  return Object.freeze({
    repository: snapshot.repositoryDigest,
    wk_id: snapshot.wkId,
    candidate: snapshot.candidate,
    embedded_w: snapshot.embeddedW,
    current_w: snapshot.currentW,
    historical_digest: snapshot.historicalDigest,
    live_digest: snapshot.liveDigest
  });
}

function projectDivergencePage(snapshot, differences, continuation) {
  const expectedBinding = divergenceBinding(snapshot);
  let offset = 0;
  if (continuation !== null && continuation !== undefined) {
    const decoded = decodeStatusContinuation(continuation);
    const decodedBinding = { ...decoded };
    delete decodedBinding.offset;
    if (canonicalizeWorkRecordJson(decodedBinding) !== canonicalizeWorkRecordJson(expectedBinding)) {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_STALE,
        "terminal candidate status continuation no longer binds current authority");
    }
    offset = decoded.offset;
  }
  if (offset >= differences.length) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_INVALID,
      "terminal candidate status continuation offset is exhausted");
  }
  const entries = Object.freeze(differences.slice(offset, offset + 128));
  const nextOffset = offset + entries.length;
  return Object.freeze({
    historical_digest: snapshot.historicalDigest,
    live_digest: snapshot.liveDigest,
    total: differences.length,
    returned: entries.length,
    remaining: differences.length - nextOffset,
    entries,
    continuation: nextOffset < differences.length
      ? encodeStatusContinuation({ ...expectedBinding, offset: nextOffset })
      : null
  });
}

export async function evaluateTerminalReviewCandidateStatus({
  mainRepo,
  wkId,
  backend,
  acceptedRepository,
  continuation = null,
  runGit = defaultTerminalCandidateRunGit,
  dependencies = {}
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      !/^WK-\d{4}$/u.test(wkId ?? "") ||
      typeof backend?.observeTerminalCandidateBoundState !== "function" ||
      typeof runGit !== "function" ||
      (acceptedRepository !== undefined &&
        (typeof acceptedRepository !== "string" || acceptedRepository.length === 0))) {
    runtimeRefusal(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "terminal candidate status inputs are invalid");
  }
  const inspect = dependencies.inspectTerminalReviewCandidateAuthority ?? inspectTerminalReviewCandidateAuthority;
  const readMetadata = dependencies.readTerminalWkCandidateMetadata ?? readTerminalWkCandidateMetadata;
  const finishNonDivergent = (value, snapshot = null) => {
    if (continuation !== null && continuation !== undefined) {
      decodeStatusContinuation(continuation);
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_STALE,
        "terminal candidate status continuation no longer binds a divergence");
    }
    return statusResult(value, snapshot, acceptedRepository);
  };
  const liveResolved = currentCanonicalContractForStatus(mainRepo, wkId);
  if (liveResolved.ok !== true) {
    if (isTerminalWorkflowNotSelected(liveResolved.cause)) {
      return finishNonDivergent({
        state: "terminal_review_workflow_not_selected",
        cause: TERMINAL_WORKFLOW_NOT_SELECTED_CAUSE,
        decidingFacts: TERMINAL_WORKFLOW_NOT_SELECTED_DECIDING_FACTS,
        workflowGuidance: TERMINAL_WORKFLOW_NOT_SELECTED_GUIDANCE
      });
    }
    return finishNonDivergent({
      state: "candidate_identity_invalid_or_moved",
      cause: canonicalTerminalCoordinationFailureCause(liveResolved.cause)
    });
  }
  const live = liveResolved.contract;
  let generationAuthentication;
  try {
    generationAuthentication = await authenticateStatusGeneration({
      mainRepo,
      wkId,
      runGit
    });
  } catch (error) {
    classifyThrownCandidateError(error);
    return finishNonDivergent({
      state: "candidate_identity_invalid_or_moved",
      cause: error?.code ?? "controlled_contract_generation_authentication_failed"
    });
  }
  let inspection;
  try {
    inspection = await inspect({
      mainRepo,
      initiative: live.initiative,
      canonicalWkId: wkId,
      generationAuthentication,
      runGit
    });
  } catch (error) {
    classifyThrownCandidateError(error);
    return finishNonDivergent({
      state: "candidate_identity_invalid_or_moved",
      cause: error?.code ?? "candidate_inspection_failed"
    });
  }
  if (inspection.state === "absent") {
    return finishNonDivergent({ state: "candidate_absent" });
  }
  const mechanicallyValid = inspection.state === "observed" &&
    inspection.wk_identity_equal === true && inspection.repository_binding_equal === true &&
    inspection.tree_equal === true && inspection.sole_parent_base === true &&
    inspection.fork_equal_base === true && inspection.base_ancestor_current_w === true;
  if (!mechanicallyValid) {
    return finishNonDivergent({
      state: "candidate_identity_invalid_or_moved",
      cause: inspection.state === "incomplete"
        ? inspection.absence_causes?.[0] ?? "candidate_authority_incomplete"
        : inspection.invariant_causes?.[0] ?? "candidate_authority_invalid"
    });
  }
  const bound = await backend.observeTerminalCandidateBoundState(wkId);
  if (bound?.state === "transport_failure") {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.TRANSPORT_FAILURE,
      "terminal candidate bound-state observation failed");
  }
  if (bound?.state === "invalid") {
    return finishNonDivergent({
      state: "candidate_identity_invalid_or_moved",
      cause: bound.reason ?? "bound_state_invalid"
    });
  }
  let publicationState = null;
  if (bound?.state === "bound" &&
      typeof backend.resolveTerminalCandidatePublicationState === "function") {
    try {
      publicationState = await backend.resolveTerminalCandidatePublicationState(wkId);
    } catch (error) {
      classifyThrownCandidateError(error);
      return finishNonDivergent({
        state: "candidate_identity_invalid_or_moved",
        cause: error?.code ?? "candidate_publication_state_unavailable"
      });
    }
  }

  let metadata;
  try {
    metadata = await readMetadata({ mainRepo, candidate: inspection.candidate_oid, runGit });
  } catch (error) {
    classifyThrownCandidateError(error);
    return finishNonDivergent({
      state: "candidate_identity_invalid_or_moved",
      cause: error?.code ?? "candidate_metadata_invalid"
    });
  }
  const snapshotBase = {
    wkId,
    initiative: live.initiative,
    candidate: inspection.candidate_oid,
    schema: metadata.schema_version,
    base: inspection.embedded_base,
    embeddedW: inspection.embedded_wk,
    currentW: inspection.current_wk,
    candidateRef: inspection.candidate_ref,
    forkRef: inspection.fork_ref,
    wkRef: inspection.wk_ref,
    repositoryDigest: metadata.repository_digest,
    live,
    metadata,
    versionDecision: publicationState?.version_decision ?? bound?.version_decision ?? null
  };
  const candidateProjection = statusCandidateProjection(snapshotBase);
  if (bound.state === "bound") {
    return finishNonDivergent({
      state: "candidate_bound",
      candidate: candidateProjection,
      versionLifecycle: publicationState?.lifecycle ?? bound.lifecycle ?? Object.freeze({
        state: "unreviewed",
        version_decision: bound.version_decision,
        next_call: Object.freeze({
          tool: "workspace_agent_dispatch",
          arguments: Object.freeze({ role: "reviewer", assigned_unit: live.review_subject })
        })
      })
    });
  }
  if (new Set(["conflict", "recovery", "unpublished"]).has(bound.state)) {
    return finishNonDivergent({
      state: "candidate_identity_invalid_or_moved",
      cause: `candidate_version_${bound.state}`,
      candidate: candidateProjection,
      versionLifecycle: Object.freeze({
        state: "blocked",
        cause: bound.state,
        version_decision: bound.version_decision,
        next_call: Object.freeze({
          tool: "workspace_terminal_review_candidate_status",
          arguments: Object.freeze({ wk_id: wkId })
        })
      })
    });
  }

  let historical = null;
  if (metadata.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION) {
    historical = await readV2HistoricalContract({
      mainRepo,
      wkId,
      inspection: { ...inspection, initiative: live.initiative },
      runGit
    });
    if (historical.ok !== true) {
      return finishNonDivergent({
        state: "candidate_identity_invalid_or_moved",
        cause: historical.cause,
        candidate: candidateProjection
      });
    }
    if (historical.digest !== metadata.canonical_wk_digest ||
        historical.slice_id !== live.review_unit.slice_id) {
      return finishNonDivergent({
        state: "candidate_identity_invalid_or_moved",
        cause: historical.digest !== metadata.canonical_wk_digest
          ? "historical_contract_digest_disagrees"
          : "historical_live_review_slice_identity_disagrees",
        candidate: candidateProjection
      });
    }
  }
  const snapshot = Object.freeze({
    ...snapshotBase,
    historical,
    historicalDigest: historical?.digest ?? metadata.terminal_review_contract_digest,
    liveDigest: live.digest
  });
  if (inspection.embedded_w_equal_current_w !== true) {
    const result = statusResult({
      state: "candidate_stale_w",
      nextCall: Object.freeze({
        tool: "workspace_terminal_review_candidate_advance",
        arguments: Object.freeze({ wk_id: wkId })
      }),
      candidate: candidateProjection
    }, snapshot, acceptedRepository);
    if (continuation !== null && continuation !== undefined) {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_STALE,
        "terminal candidate status continuation no longer binds a divergence");
    }
    return result;
  }

  if (metadata.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION) {
    try {
      const lifecycleInputs = {
        historicalParentContract: historical.parent_contract,
        liveParentContract: live.review_unit.canonical_parent_wk_contract,
        recordId: wkId,
        reviewSliceId: historical.slice_id
      };
      if (typeof backend.decideTerminalReviewLifecycle === "function") {
        await backend.decideTerminalReviewLifecycle(lifecycleInputs);
      } else {
        decideAuthenticatedTerminalReviewLifecycleDelta(lifecycleInputs);
      }
    } catch (error) {
      const differences = error?.terminal_review_lifecycle?.detail?.differences;
      if (!Array.isArray(differences)) {
        return finishNonDivergent({
          state: "candidate_identity_invalid_or_moved",
          cause: error?.terminal_review_lifecycle?.reason ?? "lifecycle_authentication_failed",
          candidate: candidateProjection
        });
      }
      return statusResult({
        state: "candidate_authored_contract_divergent",
        cause: error.terminal_review_lifecycle.reason,
        candidate: candidateProjection,
        divergence: projectDivergencePage(snapshot, differences, continuation)
      }, snapshot, acceptedRepository);
    }
  } else {
    try {
      assertAdmissibleLiveTerminalReviewCoordination({
        liveParentContract: live.review_unit.canonical_parent_wk_contract,
        recordId: wkId,
        reviewSliceId: live.review_unit.slice_id
      });
    } catch (error) {
      return finishNonDivergent({
        state: "live_coordination_inadmissible",
        cause: error?.terminal_review_lifecycle?.reason ?? "live_coordination_inadmissible",
        candidate: candidateProjection
      });
    }
    if (continuation !== null && continuation !== undefined) {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_STALE,
        "terminal candidate status continuation does not bind this candidate schema");
    }
  }

  const reviewerDispatchAllowed = metadata.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION ||
    metadata.terminal_review_subject === live.review_subject;
  return finishNonDivergent({
    state: "candidate_healthy",
    nextCall: reviewerDispatchAllowed
      ? Object.freeze({
          tool: "workspace_agent_dispatch",
          arguments: Object.freeze({ role: "reviewer", assigned_unit: live.review_subject })
        })
      : null,
    candidate: candidateProjection,
    versionLifecycle: Object.freeze({
      state: bound.state === "superseded" ? "superseded" : "unreviewed",
      version_decision: bound.version_decision ?? null,
      next_call: reviewerDispatchAllowed
        ? Object.freeze({
            tool: "workspace_agent_dispatch",
            arguments: Object.freeze({ role: "reviewer", assigned_unit: live.review_subject })
          })
        : null
    })
  }, snapshot);
}

async function authenticateStatusGeneration({ mainRepo, wkId, runGit }) {
  const generation = await resolveControlledContractAttachmentGeneration({
    repoRoot: mainRepo,
    wkId
  });
  if (generation === null) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_IDENTITY_INVALID_OR_MOVED,
      "current controlled-contract generation is absent");
  }
  const binding = await resolveControlledContractGenerationBinding({
    repoRoot: mainRepo,
    wkId,
    generation,
    lifecycleBinding: null,
    deps: { runGit }
  });
  const authenticated = await authenticateControlledContractGenerationAtW({
    binding,
    deps: { runGit }
  });
  return assertAuthenticatedControlledContractGeneration(authenticated, {
    repository: binding.repository,
    wkId,
    wkTipSha: binding.wk_tip_sha,
    requireManifest: true
  });
}

async function selectAdvanceSchema({ mainRepo, wkId, snapshot, runGit }) {
  let observed;
  try {
    observed = await readExactWkRecordBlobObservation({
      mainRepo,
      wkTip: snapshot.currentW,
      canonicalWkId: wkId,
      objectFormat: objectFormatForOid(snapshot.currentW),
      runGit
    });
  } catch (error) {
    classifyThrownCandidateError(error);
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_SCHEMA_REFUSED,
      "current W record observation refused schema selection");
  }
  if (observed.state === "absent") return Object.freeze({ schema: "v3", record: null });
  const record = parseExactRecordObservation(
    observed,
    wkId,
    TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_SCHEMA_REFUSED
  );
  const evaluated = evaluateWorkRecordParentLifecycleContract(record);
  if (evaluated.complete === true) {
    const projected = projectTerminalReviewUnit(record);
    if (projected.ok !== true || `${wkId}#${projected.slice_id}` !== snapshot.live.review_subject) {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_SCHEMA_REFUSED,
        "current W terminal-review subject disagrees");
    }
    return Object.freeze({
      schema: "v2",
      record,
      digest: computeWorkRecordSourceDigest(record),
      slice_id: projected.slice_id,
      parent_contract: projected.contracts.canonical_parent_wk_contract
    });
  }
  const onlyTerminalUnitMissing = evaluated.missing_facts.length === 1 &&
    evaluated.missing_facts[0] === PARENT_LIFECYCLE_CONTRACT_FACTS.TERMINAL_REVIEW_CONTRACT_UNIT &&
    evaluated.ambiguous_facts.length === 0;
  if (onlyTerminalUnitMissing) return Object.freeze({ schema: "v3", record });
  runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_SCHEMA_REFUSED,
    "current W record is not an exact supported candidate schema source");
}

function assertSameSnapshotFreeze(frozen, snapshot) {
  if (frozen === null || frozen.base !== snapshot.base || frozen.wk_tip !== snapshot.currentW) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_INPUT_MOVED,
      "candidate advance durable inputs moved or became absent");
  }
}

async function normalizeAdvanceV2(snapshot, liveContract, backend) {
  try {
    const inputs = {
      historicalParentContract: snapshot.historical.parent_contract,
      liveParentContract: liveContract.review_unit.canonical_parent_wk_contract,
      recordId: snapshot.wkId,
      reviewSliceId: snapshot.historical.slice_id
    };
    return typeof backend.decideTerminalReviewLifecycle === "function"
      ? await backend.decideTerminalReviewLifecycle(inputs)
      : decideAuthenticatedTerminalReviewLifecycleDelta(inputs);
  } catch {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_FINAL_RECHECK_FAILED,
      "candidate advance v2 lifecycle authentication refused");
  }
}

async function authenticateAdvanceGeneration({ mainRepo, wkId, expectedW, runGit, refusalCode }) {
  try {
    const generation = await resolveControlledContractAttachmentGeneration({
      repoRoot: mainRepo,
      wkId
    });
    if (generation === null) {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_GENERATION_ABSENT,
        "current controlled-contract generation is absent");
    }
    const binding = await resolveControlledContractGenerationBinding({
      repoRoot: mainRepo,
      wkId,
      generation,
      lifecycleBinding: null,
      deps: { runGit }
    });
    if (binding.wk_tip_sha !== expectedW) {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_INPUT_MOVED,
        "persistent WK ref moved before controlled generation authentication");
    }
    const authenticated = await authenticateControlledContractGenerationAtW({
      binding,
      deps: { runGit }
    });
    return assertAuthenticatedControlledContractGeneration(authenticated, {
      repository: binding.repository,
      wkId,
      wkTipSha: expectedW,
      requireManifest: true
    });
  } catch (error) {
    if (error instanceof TerminalCandidateRuntimeError) throw error;
    runtimeRefusal(refusalCode,
      "controlled-contract generation authentication refused", { cause: error?.code ?? error?.message ?? null });
  }
}

export async function advanceTerminalReviewCandidate({
  mainRepo,
  wkId,
  backend,
  acceptedRepository,
  runGit = defaultTerminalCandidateRunGit,
  dependencies = {}
} = {}) {
  if (typeof backend?.withTerminalCandidateAdvanceExclusion !== "function") {
    runtimeRefusal(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "terminal candidate advance backend authority is unavailable");
  }
  const evaluate = dependencies.evaluateTerminalReviewCandidateStatus ??
    (() => evaluateTerminalReviewCandidateStatus({
      mainRepo, wkId, backend, acceptedRepository, runGit, dependencies
    }));
  const derive = dependencies.deriveTerminalWkCandidate ?? deriveTerminalWkCandidate;
  const publish = dependencies.publishTerminalWkCandidateVersion ??
    publishTerminalWkCandidateVersion;
  return backend.withTerminalCandidateAdvanceExclusion({
    wkId,
    evaluateTerminalReviewCandidateStatus: evaluate,
    run: async (inside) => {
      const snapshot = statusAuthoritySnapshots.get(inside) ?? dependencies.authoritySnapshot?.(inside) ?? null;
      if (inside?.state !== "candidate_stale_w" || snapshot === null) {
        runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_NOT_STALE,
          "candidate advance requires the evaluator-owned stale-W snapshot");
      }
      if (snapshot.versionDecision !== null) {
        const selectedVersion = assertTerminalWkCandidateVersionDecision(
          snapshot.versionDecision,
          { requireSelected: true }
        );
        if (selectedVersion.candidate !== snapshot.candidate ||
            selectedVersion.base !== snapshot.base ||
            selectedVersion.wk !== snapshot.embeddedW ||
            selectedVersion.current_selection_observation !== snapshot.candidate) {
          runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_INPUT_MOVED,
            "candidate advance version snapshot disagrees");
        }
      }
      const generationAuthentication = await authenticateAdvanceGeneration({
        mainRepo, wkId, expectedW: snapshot.currentW, runGit,
        refusalCode: TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_SCHEMA_REFUSED
      });
      const selection = await selectAdvanceSchema({ mainRepo, wkId, snapshot, runGit });
      let frozen;
      if (selection.schema === "v2") {
        await normalizeAdvanceV2(snapshot, snapshot.live, backend);
        frozen = await freezeTerminalWkCandidateInputs({
          mainRepo,
          baseSha: snapshot.base,
          baseRef: "main",
          wkRef: snapshot.wkRef,
          canonicalWkId: wkId,
          canonicalWkDigest: selection.digest,
          generationAuthentication,
          runGit
        });
      } else {
        frozen = await freezeReconstructedTerminalWkCandidateInputs({
          mainRepo,
          initiative: snapshot.initiative,
          canonicalWkId: wkId,
          canonicalWkDigest: snapshot.live.digest,
          terminalReviewSubject: snapshot.live.review_subject,
          terminalReviewContractDigest: snapshot.live.review_contract_digest,
          generationAuthentication,
          runGit
        });
      }
      assertSameSnapshotFreeze(frozen, snapshot);
      const derived = await derive({ frozen, runGit });
      const finalGenerationAuthentication = await authenticateAdvanceGeneration({
        mainRepo, wkId, expectedW: snapshot.currentW, runGit,
        refusalCode: TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_FINAL_RECHECK_FAILED
      });
      if (!authenticatedControlledContractGenerationsEqual(
        finalGenerationAuthentication, generationAuthentication)) {
        runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_FINAL_RECHECK_FAILED,
          "controlled-contract generation moved during candidate derivation");
      }
      const finalLive = currentCanonicalContractForStatus(mainRepo, wkId);
      if (finalLive.ok !== true || finalLive.contract.review_subject !== snapshot.live.review_subject ||
          finalLive.contract.review_contract_digest !== snapshot.live.review_contract_digest ||
          (selection.schema === "v3" && finalLive.contract.digest !== snapshot.live.digest)) {
        runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_FINAL_RECHECK_FAILED,
          "candidate advance canonical review contract moved");
      }
      if (selection.schema === "v2") {
        await normalizeAdvanceV2(snapshot, finalLive.contract, backend);
      }
      const published = await publish({
        binding: derived,
        expectedOld: snapshot.candidate,
        verifyRefs: [
          { ref: snapshot.forkRef, oid: snapshot.base },
          { ref: snapshot.wkRef, oid: snapshot.currentW }
        ],
        runGit
      });
      return Object.freeze({
        schema_version: TERMINAL_CANDIDATE_ADVANCE_SCHEMA_VERSION,
        wk_id: wkId,
        old_candidate: snapshot.candidate,
        new_candidate: derived.candidate,
        candidate_ref: published.candidate_ref,
        candidate_ref_state: published.selection.state,
        version_identity: published.version_identity,
        immutable_version_ref: published.version_ref,
        current_selection_observation: published.current_selection_observation,
        version_decision: published.version_decision,
        candidate_schema: frozen.schema_version,
        base: frozen.base,
        wk: frozen.wk_tip,
        tree: derived.candidate_tree,
        contract_binding: selection.schema === "v2"
          ? Object.freeze({ kind: "candidate_tree_record_digest", digest: selection.digest })
          : Object.freeze({
              kind: "canonical_terminal_review_contract",
              subject: frozen.terminal_review_subject,
              digest: frozen.terminal_review_contract_digest
            }),
        invariants: Object.freeze({ tree_equals_w: true, sole_parent_b: true }),
        next_call: appendAcceptedRepository(Object.freeze({
          tool: "workspace_terminal_review_candidate_status",
          arguments: Object.freeze({ wk_id: wkId })
        }), acceptedRepository)
      });
    }
  });
}
