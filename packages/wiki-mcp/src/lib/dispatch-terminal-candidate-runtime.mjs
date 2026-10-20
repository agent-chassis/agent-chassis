

import { createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { captureDiagnosticEvidence } from "@agent-chassis/agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { types as utilTypes } from "node:util";
import {
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest
} from "../../../wiki-core/src/lib/work-record-schema.mjs";
import {
  inspectTerminalReviewCandidateAuthority,
  inspectTerminalWkCandidateVersion,
  projectTerminalWkCandidateVersion,
  projectTerminalWkCandidateFailure as projectPrimitiveFailure,
  TerminalWkCandidateError,
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
  authenticateCurrentControlledContractGenerationAtW,
  CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES
} from "@agent-chassis/agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs";
import {
  CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES,
  canonicalCurrentTerminalReviewContract,
  canonicalWorkRecordIdentity,
  projectTerminalReviewUnit,
  TERMINAL_REVIEW_UNIT_PROJECTION_CODES
} from "./dispatch-terminal-review-contract.mjs";
import {
  authenticateExistingTerminalCandidate,
  authenticateHistoricalTerminalCandidate,
  authenticateObservedTerminalCandidateVersion
} from "./dispatch-terminal-candidate-authentication.mjs";
import {
  PARENT_LIFECYCLE_CONTRACT_FACTS
} from "../../../wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";
import {
  resolveTerminalWkCandidateBaseRef
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

export {
  TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION,
  TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION,
  TERMINAL_CANDIDATE_RECOVERY_REASONS,
  TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE,
  TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION,
  createTerminalCandidateCoordinator,
  projectAuthenticatedTerminalCandidateFailure,
  projectTerminalCandidateRecoveryDiagnostic,
  projectTerminalCandidateRecoveryReason,
  projectTerminalWkCandidateFailure
} from "./dispatch-terminal-candidate-coordinator.mjs";
export {
  TERMINAL_TEST_PROOF_RUNTIME_REFUSAL_CODES,
  bindTerminalTestProofVerificationIds
} from "./dispatch-terminal-test-proof-receipts.mjs";
export {
  CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES,
  TERMINAL_REVIEW_UNIT_PROJECTION_CODES
} from "./dispatch-terminal-review-contract.mjs";

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
  HISTORICAL_VERSION: "agent_launch.terminal_candidate.inspect.historical_version.v1",
  CANONICAL_ROOT_INVALID:
    "agent_launch.terminal_candidate.canonical_root_invalid.v1",
  CANONICAL_RECORD_UNREADABLE:
    "agent_launch.terminal_candidate.canonical_record_unreadable.v1",
  CANONICAL_RECORD_ABSENT: "agent_launch.terminal_candidate.canonical_record_absent.v1",
  CANONICAL_RECORD_MALFORMED: "agent_launch.terminal_candidate.canonical_record_malformed.v1",
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

const runtimeFailureOrigins = new WeakMap();

export class TerminalCandidateRuntimeError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "TerminalCandidateRuntimeError";
    this.code = code;
    this.detail = detail;
    if (new.target === TerminalCandidateRuntimeError) {

      const seen = new Set();
      const freezeData = value => {
        if (value === null || typeof value !== "object") return true;
        if (utilTypes.isProxy(value)) return false;
        if (value instanceof Error) return true;
        if (seen.has(value)) return false;
        seen.add(value);
        if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
          if (!Object.hasOwn(descriptor, "value") || !freezeData(descriptor.value)) return false;
        }
        Object.freeze(value);
        return true;
      };
      if (freezeData(detail)) {
        runtimeFailureOrigins.set(this, Object.freeze({ code, detail, message: this.message }));
      }
    }
  }
}

function unchangedFailureOrigin(error, origin, prototype) {
  if (origin === undefined || Object.getPrototypeOf(error) !== prototype) return null;
  for (const field of ["code", "detail", "message"]) {
    const descriptor = Object.getOwnPropertyDescriptor(error, field);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value !== origin[field]) return null;
  }
  return origin;
}

export function projectTerminalCandidateRuntimeFailure(error) {
  const origin = unchangedFailureOrigin(error, runtimeFailureOrigins.get(error),
    TerminalCandidateRuntimeError.prototype);
  return origin !== null &&
    [...Object.values(TERMINAL_CANDIDATE_RUNTIME_CODES), ...Object.values(TERMINAL_WK_CANDIDATE_CODES)]
      .includes(origin.code) ? origin : null;
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
      "terminal candidate Git observation failed", { cause: error });
  }
  return error;
}

async function readCandidateRecord({ mainRepo, wkId, initiative, candidate, runGit }) {
  const recordPath = `wiki/work-records/${wkId}.json`;
  const unavailable = (cause, message, detail = {}) => Object.freeze({ ok: false, cause,
    failure: new TerminalCandidateRuntimeError(cause, message,
      { operation: "read_candidate_record", path: recordPath, ...detail }) });
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
    return unavailable(error?.code ?? "historical_record_invalid",
      "the selected candidate's work record could not be read", { cause: error });
  }
  if (observation.state === "absent") {
    return unavailable("historical_record_absent", "the selected candidate contains no work record");
  }
  let record;
  try {
    record = JSON.parse(observation.content);
  } catch (error) {
    return unavailable("historical_record_unparseable", "the selected candidate's work record is not valid JSON",
      { cause: error });
  }
  if (record?.id !== wkId || record?.initiative !== initiative) {
    return unavailable("historical_record_identity_disagrees",
      "the selected candidate's work record identifies different work",
      { expected_id: wkId, observed_id: record?.id ?? null, initiative: record?.initiative ?? null });
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

function reviewConsumerFacts({ compatibility, subject = null, cause = null, divergence = null,
  failure = null, missingFacts = [], ambiguousFacts = [] }) {
  return Object.freeze({ compatibility, subject, cause, divergence, failure,
    missing_facts: missingFacts, ambiguous_facts: ambiguousFacts });
}

export async function observeTerminalReviewConsumer({ mainRepo, wkId, backend = null,
  candidateRecord }) {
  const current = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });
  if (current.ok !== true) {

    if (designatesNoReviewUnit(current.cause)) {
      return reviewConsumerFacts({ compatibility: "not_designated" });
    }
    return reviewConsumerFacts({
      compatibility: "incompatible",
      cause: reviewCoordinationFailureCause(current.cause),
      missingFacts: current.cause.missing_facts,
      ambiguousFacts: current.cause.ambiguous_facts,
      failure: current.cause.failure === undefined ? null : current.cause
    });
  }
  const live = current.contract;
  const historical = projectTerminalReviewUnit(candidateRecord.record);
  const subject = live.review_subject;
  try {
    if (historical.ok === true) {
      if (historical.slice_id !== live.review_unit.slice_id) {
        return reviewConsumerFacts({
          compatibility: "incompatible", subject,
          cause: "historical_live_review_slice_identity_disagrees"
        });
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
      return reviewConsumerFacts({
        compatibility: "authored_contract_divergent",
        subject,
        cause: error.terminal_review_lifecycle.reason,
        divergence: Object.freeze({
          historical_digest: candidateRecord.digest,
          live_digest: live.digest,
          differences
        }),
        failure: error
      });
    }
    return reviewConsumerFacts({
      compatibility: "incompatible",
      subject,
      cause: error?.terminal_review_lifecycle?.reason ?? "review_lifecycle_inadmissible",
      failure: error
    });
  }
  return reviewConsumerFacts({ compatibility: "compatible", subject });
}

async function projectReviewConsumer({ mainRepo, wkId, backend, candidateRecord, snapshot,
  continuation }) {
  const facts = await observeTerminalReviewConsumer({ mainRepo, wkId, backend, candidateRecord });
  const base = { authority: "advisory_review_consumer", subject: facts.subject };
  if (facts.compatibility === "authored_contract_divergent") {
    return Object.freeze({
      ...base,
      lifecycle: "authored_contract_divergent",
      cause: facts.cause,
      next_call: null,
      divergence: projectDivergencePage({
        ...snapshot,
        historicalDigest: facts.divergence.historical_digest,
        liveDigest: facts.divergence.live_digest
      }, facts.divergence.differences, continuation)
    });
  }
  if (continuation !== null && continuation !== undefined) {
    decodeStatusContinuation(continuation);
    runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_STALE,
      "terminal candidate status continuation no longer binds a review divergence");
  }
  if (facts.compatibility === "not_designated") return null;
  if (facts.compatibility === "compatible") {
    return Object.freeze({
      ...base,
      divergence: null,
      lifecycle: "admissible",
      cause: null,
      next_call: Object.freeze({
        tool: "workspace_agent_dispatch",
        arguments: Object.freeze({ role: "reviewer", subject: facts.subject })
      })
    });
  }
  return Object.freeze({
    ...base, divergence: null, lifecycle: "inadmissible", cause: facts.cause, next_call: null
  });
}

function candidateObservation({ state, cause = null, candidate = null,
  generationAuthentication = null, snapshot = null, candidateRecord = null,
  versionDecision = null, observedVersion = null, failure = null }) {
  return Object.freeze({
    state,
    cause,
    candidate,
    observed_w: generationAuthentication?.wk_tip_sha ?? null,
    context: Object.freeze({
      snapshot, candidateRecord, versionDecision, observedVersion, generationAuthentication,
      failure
    })
  });
}

export async function observeTerminalCandidateFacts({
  mainRepo,
  wkId,
  runGit = defaultTerminalCandidateRunGit,
  dependencies = {}
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      !/^WK-\d{4}$/u.test(wkId ?? "") ||
      typeof runGit !== "function") {
    runtimeRefusal(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "terminal candidate status inputs are invalid");
  }
  const inspect = dependencies.inspectTerminalReviewCandidateAuthority ?? inspectTerminalReviewCandidateAuthority;
  const readMetadata = dependencies.readTerminalWkCandidateMetadata ?? readTerminalWkCandidateMetadata;
  const invalid = (cause, facts = {}) => candidateObservation({
    state: "candidate_identity_invalid_or_moved", cause, ...facts
  });
  const identity = canonicalWorkRecordIdentity({ mainRepo, recordId: wkId });
  if (identity.ok !== true) {
    if (identity.cause.code === CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.REPOSITORY_ROOT_NOT_CANONICAL) {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CANONICAL_ROOT_INVALID,
        "canonical repository root is not readable under its exact identity", identity.cause);
    }
    if (identity.cause.code === CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_UNREADABLE) {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CANONICAL_RECORD_UNREADABLE,
        "canonical WK record is unreadable", identity.cause);
    }
    for (const kind of ["RECORD_ABSENT", "RECORD_MALFORMED"]) {
      if (identity.cause.code === CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES[kind]) {
        runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES[`CANONICAL_${kind}`],
          identity.cause.failure.message, identity.cause);
      }
    }
    return invalid(identity.cause.code, { failure: identity.cause });
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
    return invalid(error?.code ?? "controlled_contract_generation_authentication_failed",
      { failure: error });
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
    return invalid(error?.code ?? "candidate_inspection_failed",
      { generationAuthentication, failure: error });
  }
  if (inspection.state === "absent") {
    return candidateObservation({ state: "candidate_absent", generationAuthentication });
  }
  const mechanicallyValid = inspection.state === "observed" &&
    inspection.wk_identity_equal === true && inspection.repository_binding_equal === true &&
    inspection.tree_equal === true && inspection.sole_parent_base === true &&
    inspection.fork_equal_base === true && inspection.base_ancestor_current_w === true;
  if (!mechanicallyValid) {
    return invalid(inspection.state === "incomplete"
      ? inspection.absence_causes?.[0] ?? "candidate_authority_incomplete"
      : inspection.invariant_causes?.[0] ?? "candidate_authority_invalid",
    { generationAuthentication });
  }

  let metadata;
  try {
    metadata = await readMetadata({ mainRepo, candidate: inspection.candidate_oid, runGit });
  } catch (error) {
    classifyThrownCandidateError(error);
    return invalid(error?.code ?? "candidate_metadata_invalid",
      { generationAuthentication, failure: error });
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
  const observed = { generationAuthentication, snapshot, candidateRecord };
  if (candidateRecord.ok !== true || candidateRecord.digest !== metadata.canonical_wk_digest) {
    return invalid(
      candidateRecord.ok !== true ? candidateRecord.cause : "historical_contract_digest_disagrees",
      { ...observed, failure: candidateRecord.failure ?? null });
  }
  if (inspection.embedded_w_equal_current_w !== true) {

    let observedVersion;
    try {
      observedVersion = await authenticateObservedTerminalCandidateVersion({
        mainRepo, wkId, candidate: inspection.candidate_oid, runGit
      });
    } catch (error) {
      classifyThrownCandidateError(error);
      return invalid(error?.code ?? "candidate_version_authentication_failed",
        { ...observed, failure: error });
    }
    return candidateObservation({
      state: "candidate_stale_w",
      candidate: projectTerminalWkCandidateVersion(observedVersion),
      ...observed,
      observedVersion
    });
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
    return invalid(error?.code ?? "candidate_binding_invalid", { ...observed, failure: error });
  }
  if (authenticated.deterministic !== true) {
    return invalid("candidate_no_deterministic_match", observed);
  }
  if (versionDecision.state !== "selected") {
    return invalid(`candidate_version_${versionDecision.state}`, { ...observed, versionDecision });
  }
  return candidateObservation({
    state: "candidate_healthy",
    candidate: projectTerminalWkCandidateVersion(versionDecision),
    ...observed,
    versionDecision
  });
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
  if (acceptedRepository !== undefined &&
      (typeof acceptedRepository !== "string" || acceptedRepository.length === 0)) {
    runtimeRefusal(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "terminal candidate status inputs are invalid");
  }
  const finish = (value, snapshot = null) => {
    if (continuation !== null && continuation !== undefined) {
      decodeStatusContinuation(continuation);
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CONTINUATION_STALE,
        "terminal candidate status continuation no longer binds a review divergence");
    }
    return statusResult(value, snapshot, acceptedRepository);
  };
  const { state, cause, context } = await observeTerminalCandidateFacts({
    mainRepo, wkId, runGit, dependencies
  });
  const { snapshot, candidateRecord, versionDecision, observedVersion } = context;
  if (state === "candidate_stale_w") {

    return finish({
      state,
      nextCall: Object.freeze({
        tool: "workspace_terminal_review_candidate_advance",
        arguments: Object.freeze({ wk_id: wkId })
      }),
      candidate: statusCandidateProjection(snapshot, Object.freeze({
        version_identity: observedVersion.version_identity,
        immutable_version_ref: observedVersion.version_ref,
        current_selection_ref: observedVersion.binding.candidate_ref,
        current_selection_observation: observedVersion.binding.candidate
      }))
    }, Object.freeze({
      ...snapshot,
      versionIdentity: observedVersion.version_identity,
      objectFormat: observedVersion.binding.repository.object_format
    }));
  }
  const candidate = statusCandidateProjection(snapshot, versionDecision);
  if (state !== "candidate_healthy") {
    return finish({
      state,
      cause,
      candidate,
      ...(versionDecision === null ? {} : {
        versionLifecycle: Object.freeze({
          state: "blocked",
          cause: versionDecision.state,
          version_decision: versionDecision,
          next_call: null
        })
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

function currentGenerationRefusalCondition(error) {
  return error?.code === CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED
    ? error?.details?.condition ?? null
    : null;
}

async function authenticateStatusGeneration({ mainRepo, wkId, runGit }) {
  try {
    return (await authenticateCurrentControlledContractGenerationAtW({
      repoRoot: mainRepo, wkId, deps: { runGit }
    })).authenticated;
  } catch (error) {
    if (currentGenerationRefusalCondition(error) === "current_generation_absent") {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_IDENTITY_INVALID_OR_MOVED,
        "current controlled-contract generation is absent");
    }
    throw error;
  }
}

async function selectAdvanceRecord({ mainRepo, wkId, snapshot, runGit }) {
  let observed;
  try {
    observed = await readExactWkRecordBlobObservation({
      mainRepo,
      wkTip: snapshot.currentW,
      canonicalWkId: wkId,
      objectFormat: snapshot.objectFormat,
      runGit
    });
  } catch (error) {
    runtimeRefusal(error?.code === TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED
      ? TERMINAL_CANDIDATE_RUNTIME_CODES.TRANSPORT_FAILURE
      : TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_SCHEMA_REFUSED,
      "current W record observation refused candidate derivation", { cause: error });
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
      "candidate advance durable inputs moved or became absent", {
        field: "frozen_inputs",
        expected: { base: snapshot.base, wk: snapshot.currentW },
        observed: frozen === null ? null : { base: frozen.base, wk: frozen.wk_tip }
      });
  }
}

async function authenticateAdvanceGeneration({ mainRepo, wkId, expectation, runGit, refusalCode }) {
  try {
    return (await authenticateCurrentControlledContractGenerationAtW({
      repoRoot: mainRepo, wkId, ...expectation, deps: { runGit }
    })).authenticated;
  } catch (error) {
    const condition = currentGenerationRefusalCondition(error);
    if (condition === "current_generation_absent") {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_GENERATION_ABSENT,
        "current controlled-contract generation is absent", { condition, cause: error });
    }
    if (condition === "expected_w_mismatch") {
      runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_INPUT_MOVED,
        "persistent WK ref moved before controlled generation authentication",
        { condition, expected: error?.details?.expected_tip ?? expectation.expectedWkTipSha,
          observed: error?.details?.actual_tip ?? null, cause: error });
    }
    runtimeRefusal(refusalCode,
      "controlled-contract generation authentication refused", { condition, cause: error });
  }
}

const advanceFailureProgress = new WeakMap();
const advancePrimitiveFailures = new WeakMap();

export function projectTerminalCandidateAdvancePrimitiveFailure(error) {
  return unchangedFailureOrigin(error, advancePrimitiveFailures.get(error),
    TerminalWkCandidateError.prototype);
}

export function projectTerminalCandidateAdvanceFailure(error) {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") return null;
  return advanceFailureProgress.get(error) ?? null;
}

async function advanceCandidatePipeline({
  mainRepo,
  wkId,
  selectedVersion,
  backend,
  acceptedRepository,
  runGit = defaultTerminalCandidateRunGit,
  dependencies = {}
} = {}) {

  const runnerThrows = new Set();
  const suppliedRunGit = runGit;
  let unconfirmedPublication = null;
  runGit = async (request) => {
    const transaction = request.args.includes("update-ref") && request.args.includes("--stdin");
    if (transaction) progress.ref_transaction_attempted = true;
    try {
      const result = await suppliedRunGit(request);
      if (transaction) {

        unconfirmedPublication = captureDiagnosticEvidence(result);
      }
      return result;
    } catch (error) { runnerThrows.add(error); throw error; }
  };
  const evaluate = dependencies.evaluateTerminalReviewCandidateStatus ??
    (() => evaluateTerminalReviewCandidateStatus({
      mainRepo, wkId, backend, acceptedRepository, runGit, dependencies
    }));
  const derive = dependencies.deriveTerminalWkCandidate ?? deriveTerminalWkCandidate;
  const publish = dependencies.publishTerminalWkCandidateVersion ??
    publishTerminalWkCandidateVersion;
  const progress = {
    stage: "request", requested_version: selectedVersion ?? null,
    source: null, target: null, derived_candidate: null, ref_transaction_attempted: false
  };
  let primitiveProducer = null;
  try {
    if (typeof backend?.withTerminalCandidateAdvanceExclusion !== "function") {
      runtimeRefusal(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
        "terminal candidate advance backend authority is unavailable");
    }
    if (selectedVersion !== undefined &&
        (typeof selectedVersion !== "string" || !/^[0-9a-f]{64}$/u.test(selectedVersion))) {
      runtimeRefusal(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
        "terminal candidate advance requires one exact immutable version identity");
    }
    progress.stage = "exclusion";
    return await backend.withTerminalCandidateAdvanceExclusion({
      mainRepo,
      wkId,
      evaluateTerminalReviewCandidateStatus: evaluate,
      run: async (inside) => {
        progress.stage = "selection";
        const snapshot = statusAuthoritySnapshots.get(inside) ?? null;
        if (inside?.state !== "candidate_stale_w" || snapshot === null) {
          runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_NOT_STALE,
            "candidate advance requires the evaluator-owned stale-W snapshot");
        }
        progress.target = Object.freeze({ wk: snapshot.currentW, base: snapshot.base });
        if (selectedVersion !== undefined) {
          primitiveProducer = "authenticateHistoricalTerminalCandidate";
          const selected = await authenticateHistoricalTerminalCandidate({
            mainRepo, wkId, versionIdentity: selectedVersion, runGit
          });
          primitiveProducer = null;
          if (selected.binding.candidate !== snapshot.candidate) {
            runtimeRefusal(TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_INPUT_MOVED,
              "requested candidate version is not the currently selected candidate", {
                field: "selected_version",
                expected: Object.freeze({
                  version_identity: selectedVersion, candidate: selected.binding.candidate
                }),
                observed: Object.freeze({
                  version_identity: snapshot.versionIdentity, candidate: snapshot.candidate
                })
              });
          }
          progress.source = projectTerminalWkCandidateVersion(selected);
        }
        progress.stage = "generation_authentication";
        const generationAuthentication = await authenticateAdvanceGeneration({
          mainRepo, wkId, expectation: { expectedWkTipSha: snapshot.currentW }, runGit,
          refusalCode: TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_SCHEMA_REFUSED
        });
        progress.stage = "input_freeze";
        const selection = await selectAdvanceRecord({ mainRepo, wkId, snapshot, runGit });

        primitiveProducer = dependencies.resolveCapturedWkBase === undefined
          ? "resolveTerminalWkCandidateBaseRef" : null;
        const baseRef = resolveTerminalWkCandidateBaseRef({
          mainRepo,
          wkRef: snapshot.wkRef,
          base: snapshot.base,
          ...(dependencies.resolveCapturedWkBase === undefined
            ? {}
            : { resolveCapturedBase: dependencies.resolveCapturedWkBase })
        });
        primitiveProducer = "freezeTerminalWkCandidateInputs";
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
        primitiveProducer = null;
        assertSameSnapshotFreeze(frozen, snapshot);
        primitiveProducer = derive === deriveTerminalWkCandidate ? "deriveTerminalWkCandidate" : null;
        progress.stage = "derivation";
        const derived = await derive({ frozen, runGit });
        primitiveProducer = null;
        progress.derived_candidate = derived.candidate;
        progress.stage = "final_recheck";

        await authenticateAdvanceGeneration({
          mainRepo, wkId,
          expectation: {
            expectedWkTipSha: snapshot.currentW,
            expectedGeneration: generationAuthentication
          },
          runGit,
          refusalCode: TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_FINAL_RECHECK_FAILED
        });
        primitiveProducer = publish === publishTerminalWkCandidateVersion ? "publishTerminalWkCandidateVersion" : null;
        progress.stage = "ref_publication";
        const published = await publish({
          binding: derived,
          expectedOld: snapshot.candidate,
          verifyRefs: [
            { ref: snapshot.forkRef, oid: snapshot.base },
            { ref: snapshot.wkRef, oid: snapshot.currentW }
          ],
          runGit
        });
        primitiveProducer = null;
        return Object.freeze({ snapshot, frozen, selection, derived, published,
          source: progress.source, target: progress.target,
          unconfirmedPublication: published.selection.state === "converged" ? unconfirmedPublication : null });
      }
    });
  } catch (error) {
    if ((typeof error === "object" && error !== null) || typeof error === "function") {
      advanceFailureProgress.set(error, Object.freeze({ ...progress }));

      if (primitiveProducer !== null && !runnerThrows.has(error) && !utilTypes.isProxy(error) &&
          Object.getPrototypeOf(error) === TerminalWkCandidateError.prototype) {
        const code = Object.getOwnPropertyDescriptor(error, "code");
        const detail = Object.getOwnPropertyDescriptor(error, "detail");
        const message = Object.getOwnPropertyDescriptor(error, "message");
        if (code && Object.hasOwn(code, "value") && detail && Object.hasOwn(detail, "value") &&
            message && Object.hasOwn(message, "value")) {
          advancePrimitiveFailures.set(error, Object.freeze({ producer: primitiveProducer,
            code: code.value, detail: detail.value, message: message.value,
            refEffects: detail.value?.ref_effects ?? null,
            projection: projectPrimitiveFailure(error) }));
        }
      }
    }
    throw error;
  }
}

export async function advanceTerminalReviewCandidate({
  mainRepo, wkId, backend, acceptedRepository,
  runGit = defaultTerminalCandidateRunGit, dependencies = {}
} = {}) {
  const { snapshot, frozen, selection, derived, published } = await advanceCandidatePipeline({
    mainRepo, wkId, backend, acceptedRepository, runGit, dependencies
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

export async function advanceSelectedTerminalCandidate({
  mainRepo, wkId, version, backend,
  runGit = defaultTerminalCandidateRunGit, dependencies = {}
} = {}) {
  if (typeof version !== "string" || !/^[0-9a-f]{64}$/u.test(version)) {
    const error = new TerminalCandidateRuntimeError(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "terminal candidate advance requires one exact immutable version identity");
    advanceFailureProgress.set(error, Object.freeze({ stage: "request", requested_version: null,
      source: null, target: null, derived_candidate: null, ref_transaction_attempted: false }));
    throw error;
  }
  const { source, target, published, unconfirmedPublication } = await advanceCandidatePipeline({
    mainRepo, wkId, selectedVersion: version, backend, runGit, dependencies
  });
  return Object.freeze({
    schema_version: "agent_launch.selected_terminal_candidate_advance.v1",
    wk_id: wkId, requested_version: version, source, target,
    advanced: projectTerminalWkCandidateVersion(published.version_decision),
    version_state: published.version_state, selection_state: published.selection.state,
    immutable_version_ref: published.version_ref, candidate_ref: published.candidate_ref,
    unconfirmed_publication: unconfirmedPublication
  });
}
