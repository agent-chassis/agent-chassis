

import { createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { types as utilTypes } from "node:util";
import {
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest
} from "../../../wiki-core/src/lib/work-record-schema.mjs";
import {
  inspectTerminalReviewCandidateAuthority,
  inspectTerminalWkCandidateVersion,
  deriveTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  freezeTerminalWkCandidateInputs,
  publishTerminalWkCandidateVersion,
  readExactWkRecordBlobObservation,
  readTerminalWkCandidateMetadata,
  TERMINAL_WK_CANDIDATE_CODES
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
  authenticateExistingTerminalCandidate,
  CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES,
  canonicalCurrentTerminalReviewContract,
  canonicalWorkRecordIdentity,
  projectTerminalReviewUnit,
  TERMINAL_REVIEW_UNIT_PROJECTION_CODES
} from "./dispatch-terminal-candidate-coordinator.mjs";
import {
  PARENT_LIFECYCLE_CONTRACT_FACTS
} from "../../../wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";
import {
  resolveTerminalWkCandidateBaseRef
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

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
  CANDIDATE_ABSENT: "agent_launch.terminal_candidate.status.candidate_absent.v1",
  CANDIDATE_IDENTITY_INVALID_OR_MOVED:
    "agent_launch.terminal_candidate.status.candidate_identity_invalid_or_moved.v1",
  CANDIDATE_STALE_W: "agent_launch.terminal_candidate.status.candidate_stale_w.v1",
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
  candidate_absent: TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_ABSENT,
  candidate_identity_invalid_or_moved:
    TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_IDENTITY_INVALID_OR_MOVED,
  candidate_stale_w: TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_STALE_W,
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

function withAcceptedRepository(projection, acceptedRepository) {
  if (projection === null || !plainNonProxyObject(projection)) return projection;
  return Object.freeze({
    ...projection,
    next_call: appendAcceptedRepository(projection.next_call ?? null, acceptedRepository)
  });
}

function statusResult({ state, cause = null, nextCall = null, candidate = null,
  versionLifecycle = null, reviewConsumer = null }, snapshot = null, acceptedRepository = undefined) {
  const result = Object.freeze({
    schema_version: TERMINAL_CANDIDATE_STATUS_SCHEMA_VERSION,
    state,
    code: STATUS_CODE_BY_STATE[state],
    cause,
    next_call: appendAcceptedRepository(nextCall, acceptedRepository),
    candidate,
    version_lifecycle: withAcceptedRepository(versionLifecycle, acceptedRepository),
    review_consumer: withAcceptedRepository(reviewConsumer, acceptedRepository)
  });
  if (snapshot !== null) statusAuthoritySnapshots.set(result, snapshot);
  return result;
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

function statusCandidateProjection(snapshot, versionDecision = null) {
  if (snapshot === null) return null;
  return Object.freeze({
    candidate: snapshot.candidate,
    schema_version: snapshot.schema,
    base: snapshot.base,
    embedded_w: snapshot.embeddedW,
    current_w: snapshot.currentW,
    version_identity: versionDecision?.version_identity ?? null,
    immutable_version_ref: versionDecision?.immutable_version_ref ?? null,
    current_selection_ref: versionDecision?.current_selection_ref ?? null,
    current_selection_observation: versionDecision?.current_selection_observation ?? null
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

function classifyThrownCandidateError(error) {
  if (error?.code === TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.TRANSPORT_FAILURE,
      "terminal candidate Git observation failed");
  }
  return error;
}

async function readCandidateRecord({ mainRepo, wkId, initiative, candidate, runGit }) {
  let observation;
  try {
    observation = await readExactWkRecordBlobObservation({
      mainRepo,
      wkTip: candidate,
      canonicalWkId: wkId,
      objectFormat: objectFormatForOid(candidate),
      runGit
    });
  } catch (error) {
    classifyThrownCandidateError(error);
    return Object.freeze({ ok: false, cause: error?.code ?? "historical_record_invalid" });
  }
  if (observation.state === "absent") {
    return Object.freeze({ ok: false, cause: "historical_record_absent" });
  }
  let record;
  try {
    record = JSON.parse(observation.content);
  } catch {
    return Object.freeze({ ok: false, cause: "historical_record_unparseable" });
  }
  if (record?.id !== wkId || record?.initiative !== initiative) {
    return Object.freeze({ ok: false, cause: "historical_record_identity_disagrees" });
  }
  return Object.freeze({ ok: true, record, digest: computeWorkRecordSourceDigest(record) });
}

function divergenceBinding(binding) {
  return Object.freeze({
    repository: binding.repositoryDigest,
    wk_id: binding.wkId,
    candidate: binding.candidate,
    embedded_w: binding.embeddedW,
    current_w: binding.currentW,
    historical_digest: binding.historicalDigest,
    live_digest: binding.liveDigest
  });
}

function projectDivergencePage(binding, differences, continuation) {
  const expectedBinding = divergenceBinding(binding);
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
    historical_digest: binding.historicalDigest,
    live_digest: binding.liveDigest,
    total: differences.length,
    returned: entries.length,
    remaining: differences.length - nextOffset,
    entries,
    continuation: nextOffset < differences.length
      ? encodeStatusContinuation({ ...expectedBinding, offset: nextOffset })
      : null
  });
}

function designatesNoReviewUnit(cause) {
  return cause?.code ===
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.TERMINAL_REVIEW_UNIT_UNPROJECTABLE &&
    cause?.projection_code ===
      TERMINAL_REVIEW_UNIT_PROJECTION_CODES.PARENT_LIFECYCLE_CONTRACT_INCOMPLETE &&
    cause.missing_facts?.length === 1 &&
    cause.missing_facts[0] === PARENT_LIFECYCLE_CONTRACT_FACTS.TERMINAL_REVIEW_CONTRACT_UNIT &&
    cause.ambiguous_facts?.length === 0;
}

function reviewCoordinationFailureCause(cause) {
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

async function projectReviewConsumer({ mainRepo, wkId, backend, candidateRecord, snapshot,
  continuation }) {
  const reviewDivergenceRequested = continuation !== null && continuation !== undefined;
  const current = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });
  if (current.ok !== true) {
    if (reviewDivergenceRequested) {
      decodeStatusContinuation(continuation);
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_STALE,
        "terminal candidate status continuation no longer binds a review divergence");
    }
    if (designatesNoReviewUnit(current.cause)) return null;
    return Object.freeze({
      authority: "advisory_review_consumer",
      subject: null,
      lifecycle: "inadmissible",
      cause: reviewCoordinationFailureCause(current.cause),
      next_call: null,
      divergence: null
    });
  }
  const live = current.contract;
  const historical = projectTerminalReviewUnit(candidateRecord.record);
  const base = {
    authority: "advisory_review_consumer",
    subject: live.review_subject
  };
  const reviewerCall = Object.freeze({
    tool: "workspace_agent_dispatch",
    arguments: Object.freeze({ role: "reviewer", subject: live.review_subject })
  });
  const finish = (projection) => {
    if (reviewDivergenceRequested) {
      decodeStatusContinuation(continuation);
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_STALE,
        "terminal candidate status continuation no longer binds a review divergence");
    }
    return Object.freeze({ ...base, divergence: null, ...projection });
  };
  try {
    if (historical.ok === true) {
      if (historical.slice_id !== live.review_unit.slice_id) {
        return finish({ lifecycle: "inadmissible", cause: "historical_live_review_slice_identity_disagrees",
          next_call: null });
      }
      const lifecycleInputs = {
        historicalParentContract: historical.contracts.canonical_parent_wk_contract,
        liveParentContract: live.review_unit.canonical_parent_wk_contract,
        recordId: wkId,
        reviewSliceId: historical.slice_id
      };
      if (typeof backend?.decideTerminalReviewLifecycle === "function") {
        await backend.decideTerminalReviewLifecycle(lifecycleInputs);
      } else {
        decideAuthenticatedTerminalReviewLifecycleDelta(lifecycleInputs);
      }
    } else {
      assertAdmissibleLiveTerminalReviewCoordination({
        liveParentContract: live.review_unit.canonical_parent_wk_contract,
        recordId: wkId,
        reviewSliceId: live.review_unit.slice_id
      });
    }
  } catch (error) {
    const differences = error?.terminal_review_lifecycle?.detail?.differences;
    if (historical.ok === true && Array.isArray(differences)) {
      return Object.freeze({
        ...base,
        lifecycle: "authored_contract_divergent",
        cause: error.terminal_review_lifecycle.reason,
        next_call: null,
        divergence: projectDivergencePage({
          ...snapshot,
          historicalDigest: candidateRecord.digest,
          liveDigest: live.digest
        }, differences, continuation)
      });
    }
    return finish({
      lifecycle: "inadmissible",
      cause: error?.terminal_review_lifecycle?.reason ?? "review_lifecycle_inadmissible",
      next_call: null
    });
  }
  return finish({ lifecycle: "admissible", cause: null, next_call: reviewerCall });
}

export async function evaluateTerminalReviewCandidateStatus({
  mainRepo,
  wkId,
  backend = null,
  acceptedRepository,
  continuation = null,
  runGit = defaultTerminalCandidateRunGit,
  dependencies = {}
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      !/^WK-\d{4}$/u.test(wkId ?? "") ||
      typeof runGit !== "function" ||
      (acceptedRepository !== undefined &&
        (typeof acceptedRepository !== "string" || acceptedRepository.length === 0))) {
    runtimeRefusal(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "terminal candidate status inputs are invalid");
  }
  const inspect = dependencies.inspectTerminalReviewCandidateAuthority ?? inspectTerminalReviewCandidateAuthority;
  const readMetadata = dependencies.readTerminalWkCandidateMetadata ?? readTerminalWkCandidateMetadata;
  const finish = (value, snapshot = null) => {
    if (continuation !== null && continuation !== undefined) {
      decodeStatusContinuation(continuation);
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_STALE,
        "terminal candidate status continuation no longer binds a review divergence");
    }
    return statusResult(value, snapshot, acceptedRepository);
  };
  const identity = canonicalWorkRecordIdentity({ mainRepo, recordId: wkId });
  if (identity.ok !== true) {
    if (identity.cause.code === CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.REPOSITORY_ROOT_NOT_CANONICAL) {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CANONICAL_ROOT_INVALID,
        "canonical repository root is not readable under its exact identity");
    }
    if (identity.cause.code === CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_UNREADABLE) {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CANONICAL_RECORD_UNREADABLE,
        "canonical WK record is unreadable");
    }
    return finish({ state: "candidate_identity_invalid_or_moved", cause: identity.cause.code });
  }
  const initiative = identity.initiative;
  let generationAuthentication;
  try {
    generationAuthentication = await authenticateStatusGeneration({
      mainRepo,
      wkId,
      runGit
    });
  } catch (error) {
    classifyThrownCandidateError(error);
    return finish({
      state: "candidate_identity_invalid_or_moved",
      cause: error?.code ?? "controlled_contract_generation_authentication_failed"
    });
  }
  let inspection;
  try {
    inspection = await inspect({
      mainRepo,
      initiative,
      canonicalWkId: wkId,
      generationAuthentication,
      runGit
    });
  } catch (error) {
    classifyThrownCandidateError(error);
    return finish({
      state: "candidate_identity_invalid_or_moved",
      cause: error?.code ?? "candidate_inspection_failed"
    });
  }
  if (inspection.state === "absent") {
    return finish({ state: "candidate_absent" });
  }
  const mechanicallyValid = inspection.state === "observed" &&
    inspection.wk_identity_equal === true && inspection.repository_binding_equal === true &&
    inspection.tree_equal === true && inspection.sole_parent_base === true &&
    inspection.fork_equal_base === true && inspection.base_ancestor_current_w === true;
  if (!mechanicallyValid) {
    return finish({
      state: "candidate_identity_invalid_or_moved",
      cause: inspection.state === "incomplete"
        ? inspection.absence_causes?.[0] ?? "candidate_authority_incomplete"
        : inspection.invariant_causes?.[0] ?? "candidate_authority_invalid"
    });
  }

  let metadata;
  try {
    metadata = await readMetadata({ mainRepo, candidate: inspection.candidate_oid, runGit });
  } catch (error) {
    classifyThrownCandidateError(error);
    return finish({
      state: "candidate_identity_invalid_or_moved",
      cause: error?.code ?? "candidate_metadata_invalid"
    });
  }
  const snapshot = Object.freeze({
    wkId,
    initiative,
    candidate: inspection.candidate_oid,
    schema: metadata.schema_version,
    base: inspection.embedded_base,
    embeddedW: inspection.embedded_wk,
    currentW: inspection.current_wk,
    candidateRef: inspection.candidate_ref,
    forkRef: inspection.fork_ref,
    wkRef: inspection.wk_ref,
    repositoryDigest: metadata.repository_digest,
    metadata,
  });
  const candidateRecord = await readCandidateRecord({
    mainRepo, wkId, initiative, candidate: inspection.candidate_oid, runGit
  });
  if (candidateRecord.ok !== true || candidateRecord.digest !== metadata.canonical_wk_digest) {
    return finish({
      state: "candidate_identity_invalid_or_moved",
      cause: candidateRecord.ok !== true ? candidateRecord.cause : "historical_contract_digest_disagrees",
      candidate: statusCandidateProjection(snapshot)
    });
  }
  if (inspection.embedded_w_equal_current_w !== true) {
    return finish({
      state: "candidate_stale_w",
      nextCall: Object.freeze({
        tool: "workspace_terminal_review_candidate_advance",
        arguments: Object.freeze({ wk_id: wkId })
      }),
      candidate: statusCandidateProjection(snapshot)
    }, snapshot);
  }

  let authenticated;
  let versionDecision;
  try {
    authenticated = await authenticateExistingTerminalCandidate({
      mainRepo, wkId, candidate: inspection.candidate_oid, generationAuthentication, runGit
    });
    versionDecision = authenticated.deterministic === true
      ? await inspectTerminalWkCandidateVersion({ binding: authenticated.binding, runGit })
      : null;
  } catch (error) {
    classifyThrownCandidateError(error);
    return finish({
      state: "candidate_identity_invalid_or_moved",
      cause: error?.code ?? "candidate_binding_invalid",
      candidate: statusCandidateProjection(snapshot)
    });
  }
  if (authenticated.deterministic !== true) {
    return finish({
      state: "candidate_identity_invalid_or_moved",
      cause: "candidate_no_deterministic_match",
      candidate: statusCandidateProjection(snapshot)
    });
  }
  const candidate = statusCandidateProjection(snapshot, versionDecision);
  if (versionDecision.state !== "selected") {
    return finish({
      state: "candidate_identity_invalid_or_moved",
      cause: `candidate_version_${versionDecision.state}`,
      candidate,
      versionLifecycle: Object.freeze({
        state: "blocked",
        cause: versionDecision.state,
        version_decision: versionDecision,
        next_call: null
      })
    });
  }
  const reviewConsumer = await projectReviewConsumer({
    mainRepo, wkId, backend, candidateRecord, snapshot, continuation
  });
  return statusResult({
    state: "candidate_healthy",
    candidate,
    versionLifecycle: Object.freeze({
      state: "selected",
      cause: null,
      version_decision: versionDecision,
      next_call: null
    }),
    reviewConsumer
  }, null, acceptedRepository);
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

async function selectAdvanceRecord({ mainRepo, wkId, snapshot, runGit }) {
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
      "current W record observation refused candidate derivation");
  }
  if (observed.state === "absent") {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_SCHEMA_REFUSED,
      "current W carries no canonical record for the candidate contract digest");
  }
  const record = parseExactRecordObservation(
    observed,
    wkId,
    TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_SCHEMA_REFUSED
  );
  return Object.freeze({ record, digest: computeWorkRecordSourceDigest(record) });
}

function assertSameSnapshotFreeze(frozen, snapshot) {
  if (frozen === null || frozen.base !== snapshot.base || frozen.wk_tip !== snapshot.currentW) {
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_INPUT_MOVED,
      "candidate advance durable inputs moved or became absent");
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
      const generationAuthentication = await authenticateAdvanceGeneration({
        mainRepo, wkId, expectedW: snapshot.currentW, runGit,
        refusalCode: TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_SCHEMA_REFUSED
      });
      const selection = await selectAdvanceRecord({ mainRepo, wkId, snapshot, runGit });

      const baseRef = resolveTerminalWkCandidateBaseRef({
        mainRepo,
        wkRef: snapshot.wkRef,
        base: snapshot.base,
        ...(dependencies.resolveCapturedWkBase === undefined
          ? {}
          : { resolveCapturedBase: dependencies.resolveCapturedWkBase })
      });
      const frozen = await freezeTerminalWkCandidateInputs({
        mainRepo,
        baseSha: snapshot.base,
        baseRef,
        wkRef: snapshot.wkRef,
        canonicalWkId: wkId,
        canonicalWkDigest: selection.digest,
        generationAuthentication,
        runGit
      });
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
        contract_binding: Object.freeze({
          kind: "candidate_tree_record_digest", digest: selection.digest
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
