

import { captureDiagnosticEvidence } from
  "@agent-chassis/agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { isTerminalReviewLifecycleRefusal } from
  "@agent-chassis/agent-launch-cli/src/lib/backend-terminal-review-lifecycle-authority.mjs";
import { isCanonicalNextCallTool } from
  "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

import { classifyDispatchSubject } from "./dispatch-subject-classifier.mjs";
import {
  CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES
} from "./dispatch-terminal-review-contract.mjs";
import {
  projectTerminalWkCandidateFailure,
  TERMINAL_CANDIDATE_RUNTIME_CODES
} from "./dispatch-terminal-candidate-runtime.mjs";
import {
  buildDispatchContinuation,
  buildDispatchMechanicalRefusal,
  distillCapturedCauses,
  hasRequestSchemaAuthority,
  mapBackendRefusalToDispatchCode,
  ownedNoRouteRecovery
} from "./dispatch-tool-helpers.mjs";
import { measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { selectedResponseDeliveryBound } from "./selected-response-snapshot.mjs";
import { advanceRequest as ownerAdvanceRequest } from "./task-advance-candidate.mjs";
import { buildPublishWorkRequest } from "./task-publish-work.mjs";
import { candidateInspectionReadCall } from "./task-inspect-candidate-read-call.mjs";
import { isDeepStrictEqual } from "node:util";
import { TerminalWkCandidateError, TERMINAL_WK_CANDIDATE_CODES } from
  "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES, isControlledContractGenerationNotPersisted } from
  "@agent-chassis/agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs";

export const INSPECT_CANDIDATE_TOOL_NAME = "workspace_inspect_candidate";
export const CANDIDATE_INSPECTION_RESPONSE_SCHEMA_VERSION = "workspace-inspect-candidate.v1";

const EFFECTS = Object.freeze({ observation_only: true });

const CODE_BY_STATE = Object.freeze({
  candidate_absent: TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_ABSENT,
  candidate_identity_invalid_or_moved:
    TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_IDENTITY_INVALID_OR_MOVED,
  candidate_stale_w: TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_STALE_W,
  candidate_healthy: TERMINAL_CANDIDATE_RUNTIME_CODES.CANDIDATE_HEALTHY,
  historical_version: TERMINAL_CANDIDATE_RUNTIME_CODES.HISTORICAL_VERSION
});

function conditionOf(failure) {
  if (typeof failure?.code === "string" && failure.code.length > 0) return failure.code;
  if (failure instanceof Error) return failure.name;
  return "non_error_value_thrown";
}

function causeOf(failure) {
  if (failure === null || failure === undefined) return { cause_chain: [] };
  const typed = projectTerminalWkCandidateFailure(failure);
  return {
    cause_chain: distillCapturedCauses(captureDiagnosticEvidence(failure), { nested: true }),
    ...(typed.kind === "typed_candidate_error" ? { candidate_failure: typed } : {})
  };
}

function diagnostic({ operation, condition, affected, uncertainty = null, failure = null }) {
  return {
    operation,
    condition,
    affected,
    known_effects: EFFECTS,
    uncertainty,
    ...causeOf(failure)
  };
}

function correctionOf(correction) {
  if (correction === null) return null;
  const { observation, failure } = correction.verified_outcome;
  return {
    kind: correction.kind,
    original_condition: {
      condition: conditionOf(correction.original_condition.failure),
      ...causeOf(correction.original_condition.failure)
    },
    verified_outcome: {
      observed: observation !== null,
      state: observation?.state ?? null,
      condition: failure === null ? null : conditionOf(failure)
    }
  };
}

const COORDINATOR_REVIEW_RECOVERY = Object.freeze({
  incompatible: ownedNoRouteRecovery({
    responsibleActor: "coordinator",
    prerequisite: "the canonical record designates exactly one terminal review unit whose " +
      "contract is compatible with the contract this candidate recorded",
    missingComponent: "review_designation_correction_projection",
    explanation: "which designation or scope to correct is the coordinator's authoring " +
      "decision; no registered call from this observation makes it, and the candidate is unchanged"
  }),
  authored_contract_divergent: ownedNoRouteRecovery({
    responsibleActor: "coordinator",
    prerequisite: "the live canonical contract and the contract this candidate recorded have " +
      "no authored difference",
    missingComponent: "authored_contract_correction_projection",
    explanation: "which authored change to make is the coordinator's decision; inspection " +
      "restores nothing and a candidate advance does not bypass authored drift"
  })
});

function reviewLimb(review) {
  if (review === null) return null;
  const limb = (fields) => ({
    authority: "advisory_review_consumer",
    compatibility: review.compatibility,
    subject: review.subject,
    cause: review.cause,
    divergence: null,
    recovery: null,
    next_calls: [],
    ...fields
  });
  switch (review.compatibility) {
    case "not_designated":
    case "compatible":
      return limb({});
    case "incompatible":
      return limb({ recovery: COORDINATOR_REVIEW_RECOVERY.incompatible,
        ...(review.missing_facts?.length ? { missing_facts: review.missing_facts } : {}),
        ...(review.ambiguous_facts?.length ? { ambiguous_facts: review.ambiguous_facts } : {}) });
    case "authored_contract_divergent":
      return limb({
        divergence: {
          historical_digest: review.divergence.historical_digest,
          live_digest: review.divergence.live_digest,
          total: review.divergence.differences.length,
          differences: review.divergence.differences
        },
        recovery: COORDINATOR_REVIEW_RECOVERY.authored_contract_divergent
      });
    default:

      return limb({
        cause: conditionOf(review.failure),
        recovery: ownedNoRouteRecovery({
          responsibleActor: null,
          prerequisite: "the review comparison for this candidate completes",
          explanation: "the comparison failed with the diagnosed cause, which establishes no " +
            "responsible actor; the candidate facts are as observed"
        })
      });
  }
}

function reviewDiagnostic(review) {
  if (review === null || review.failure === null || isTerminalReviewLifecycleRefusal(review.failure)) {
    return null;
  }
  return diagnostic({
    operation: "compare_review_contract",
    condition: review.compatibility === null ? conditionOf(review.failure) : review.cause,
    affected: { review_subject: review.subject },
    uncertainty: review.compatibility === null ? "review compatibility is unknown" : null,
    failure: review.failure
  });
}

function invalidRecovery(observation, correction) {
  if (observation.cause === CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_IDENTITY_DISAGREES) {
    return ownedNoRouteRecovery({
      responsibleActor: null,
      prerequisite: "the canonical WK record's own id matches the requested WK and its initiative " +
        "is a canonical initiative identity",
      missingComponent: "canonical_record_identity_recovery",
      explanation: "Stop: candidate status cannot be established from a work record with the wrong identity. " +
        "Inspection offers no supported correction for that record."
    });
  }
  if (observation.cause === CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.REF_UNRESOLVABLE) {
    return ownedNoRouteRecovery({
      responsibleActor: null,
      prerequisite: "the WK branch identified in the cause is available and resolves to a commit",
      explanation: "Stop: candidate status is unknown while that branch is missing or cannot be resolved. " +
        "Inspection offers no supported call to establish it."
    });
  }
  const currentSelectionMoved = (failure) => failure instanceof TerminalWkCandidateError &&
    failure.code === TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED &&
    failure.detail?.field === "current_ref";
  if (correction?.kind === "reobserve_current_once" &&
      currentSelectionMoved(correction.original_condition.failure) &&
      currentSelectionMoved(observation.context.failure)) {
    return ownedNoRouteRecovery({
      responsibleActor: "caller_retry",
      prerequisite: "the current candidate selection stays in place for one complete observation",
      retryCondition: "re-issue the same subject request without version after current selection movement settles",
      explanation: "both permitted current observations encountered selection movement; " +
        "a later current observation asks what is selected then, and inspection restores no ref " +
        "or original material"
    });
  }

  return observation.context.generationAuthentication === null
    ? ownedNoRouteRecovery({
        responsibleActor: null,
        prerequisite: "the WK inputs needed to determine candidate status can be read and validated",
        missingComponent: "controlled_generation_recovery",
        explanation: "Stop: candidate selection, validity and relation to the current WK tip are unknown. " +
          "Inspection offers no supported correction for the reported cause."
      })
    : ownedNoRouteRecovery({
        responsibleActor: null,
        prerequisite: "the selected candidate can be verified without the reported failure",
        missingComponent: "terminal_candidate_identity_recovery",
        explanation: "Stop: a valid selected candidate could not be established. " +
          "Inspection offers no supported repair for the reported cause."
      });
}

export function createCandidateInspectionResponder({
  requestSchemaAuthority = null,
  advanceRequest = null,
  responseEnv = process.env
} = {}) {

  function staleRecovery(selection) {
    const spec = advanceRequest === null ? null : advanceRequest({
      subject: selection.subject.unit, version: selection.candidate.version_identity
    });
    if (spec !== null && !isDeepStrictEqual(spec, ownerAdvanceRequest({
      subject: selection.subject.unit, version: selection.candidate.version_identity
    }))) {
      throw new TypeError("candidate advance specification must match the selected-version owner request");
    }
    const call = spec === null || !isCanonicalNextCallTool(spec.tool) ? null : buildDispatchContinuation({
      tool: spec.tool,
      arguments: spec.arguments,
      successPredicate: spec.successPredicate,
      requestSchemaAuthority
    });
    if (call === null) {
      return {
        next_calls: [],
        recovery: ownedNoRouteRecovery({
          responsibleActor: null,
          prerequisite: "the selected-version advance operation is available in this session",
          missingComponent: "selected_version_candidate_advance_request",
          explanation: "No supported advancement call is available in this session. " +
            "Finish this status question, or stop the requested advancement here."
        })
      };
    }
    return {
      next_calls: [call],
      recovery: {
        state: "callable",
        prerequisite: "the caller chooses to advance this exact stale version; the action rechecks the selected version and current WK inputs",
        operation: call.tool,
        success_condition: "the selected candidate embeds the live W after the advance",
        success_predicate: call.success_predicate
      }
    };
  }

  function observed(selection, fields) {
    return {
      schema_version: CANDIDATE_INSPECTION_RESPONSE_SCHEMA_VERSION,
      outcome: "observed",
      subject: selection.subject,
      selection: selection.selection,
      state: selection.state,
      code: CODE_BY_STATE[selection.state],
      candidate: selection.candidate,
      currentness: selection.currentness,
      review_consumer: reviewLimb(selection.review),
      effects: EFFECTS,
      automatic_correction: correctionOf(selection.automatic_correction),
      diagnostic: null,
      recovery: null,
      next_calls: [],
      ...fields
    };
  }

  function observedCurrent(selection) {
    const { observation } = selection.context.current;
    const observedW = selection.currentness.observed_w;
    switch (selection.state) {
      case "candidate_healthy":
        return observed(selection, { diagnostic: reviewDiagnostic(selection.review) });
      case "candidate_stale_w":
        return observed(selection, {
          diagnostic: diagnostic({
            operation: "observe_current_candidate",
            condition: "candidate_stale_w",
            affected: { candidate_w: selection.candidate.wk, observed_w: observedW }
          }),
          ...staleRecovery(selection)
        });
      case "candidate_absent":
        return observed(selection, {
          diagnostic: diagnostic({
            operation: "observe_current_candidate",
            condition: "candidate_absent",
            affected: { current_selection: null, observed_w: observedW }
          }),
        });
      default:
        return observed(selection, {
          diagnostic: diagnostic({
            operation: "observe_current_candidate",
            condition: observation.cause,
            affected: { observed_w: observedW },
            uncertainty: observedW === null
              ? "Candidate selection, validity and relation to the current WK tip are unknown."
              : "A valid selected candidate and its relation to the current WK tip could not be established.",
            failure: selection.failure
          }),
          recovery: invalidRecovery(observation, selection.automatic_correction)
        });
    }
  }

  function refused(selection) {
    const historical = selection.selection.kind === "historical";
    const condition = conditionOf(selection.failure);
    const facts = {
      "inspect_candidate.observation_completed": false,
      "inspect_candidate.failed_condition": condition,
      "inspect_candidate.selection": selection.selection.kind
    };
    return buildDispatchMechanicalRefusal({
      code: mapBackendRefusalToDispatchCode(selection.failure?.code),
      decidingFacts: Object.entries(facts).map(([field, value]) => ({ field, value })),
      observedFacts: facts,
      noSupportedRoute: true,
      recovery: historical
        ? ownedNoRouteRecovery({
            responsibleActor: "caller_retry",
            prerequisite: "the requested immutable version exists for this WK and authenticates " +
              "from its own material",
            retryCondition: "re-issue the same request with the same version only after its material is available and authenticates; " +
              "omitting version asks a different question, the current candidate",
            explanation: "no other version and no current candidate is substituted for the " +
              "requested one"
          })
        : ownedNoRouteRecovery({
            responsibleActor: null,
            prerequisite: condition === TERMINAL_CANDIDATE_RUNTIME_CODES.CANONICAL_RECORD_ABSENT
              ? "the WK's canonical work record is available"
              : condition === TERMINAL_CANDIDATE_RUNTIME_CODES.CANONICAL_RECORD_UNREADABLE
                ? "the WK's canonical work record is readable"
                : condition === TERMINAL_CANDIDATE_RUNTIME_CODES.CANONICAL_RECORD_MALFORMED
                  ? "the WK's canonical work record is valid JSON"
                  : "the intended candidate selection can be read and verified without the reported failure",
            explanation: "Stop: current candidate status could not be established. " +
              "Inspection offers no supported correction for the reported cause."
          }),
      route: INSPECT_CANDIDATE_TOOL_NAME,
      carried: {
        subject: selection.subject,
        selection: selection.selection,
        effects: EFFECTS,
        diagnostic: diagnostic({
          operation: historical ? "authenticate_historical_candidate_version" : "observe_current_candidate",
          condition,
          affected: historical
            ? { version: selection.selection.version }
            : { current_selection: "unverified" },
          uncertainty: historical
            ? "whether the requested version exists unmodified is not established"
            : "no current candidate state was verified",
          failure: selection.failure
        }),
        ...(selection.automatic_correction === null
          ? {} : { automatic_correction: correctionOf(selection.automatic_correction) })
      },
      requestSchemaAuthority
    });
  }

  function prepare(selection) {
    const isObserved = selection.state !== null;
    let body = !isObserved ? refused(selection)
      : selection.selection.kind === "historical" ? observed(selection, {})
        : observedCurrent(selection);

    if (selection.selection.kind === "current" && isControlledContractGenerationNotPersisted(selection.failure)) {
      const publication = buildPublishWorkRequest(selection.subject.unit, { requestSchemaAuthority });
      const callable = publication.callable !== false;
      body = { ...body, next_calls: callable ? [publication] : [], recovery: {
        state: callable ? "callable" : "no_supported_route",
        prerequisite: "Publication of current work must be explicitly intended and permitted by the applicable lifecycle.",
        explanation: "Current canonical changes have not been persisted to the WK branch. Publication synchronizes those changes, " +
          "may replace the selected candidate, and publishes to the configured handoff destination. " +
          "It rechecks its prerequisites and may refuse; this observation neither authorizes publication nor promises success." +
          (callable ? "" : " No supported publication call is available in this session; stop this synchronization here.")
      } };
      if (callable) delete body.no_supported_route;
    }

    if (selection.failure instanceof TerminalWkCandidateError &&
        selection.failure.code === TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED) {
      const call = candidateInspectionReadCall({ subject: selection.subject.unit,
        ...(selection.selection.kind === "historical" ? { version: selection.selection.version } : {}) }, {
        information: selection.selection.kind === "historical"
          ? "After the same selected material is available, valid and no longer moving, observe this exact historical candidate version. Inspection repairs nothing."
          : "After inputs stop moving, observe current candidate status. Inspection repairs nothing.",
        requestSchemaAuthority
      });
      if (call !== null) body = { ...body, next_calls: [call] };
    }
    const bytes = measureMcpInlineResultBytes(body);
    const bound = selectedResponseDeliveryBound(responseEnv);
    return {
      registered: hasRequestSchemaAuthority(INSPECT_CANDIDATE_TOOL_NAME, requestSchemaAuthority),
      outcome: isObserved ? "observed" : "refused",
      body,
      delivery: { delivered: false, measured_bytes: bytes, bound_bytes: bound, fits: bytes <= bound,
        complete_transport_required: bytes > bound }
    };
  }

  return Object.freeze({ prepare });
}

export function candidateInspectionSubjectCorrection(args, { requestSchemaAuthority = null } = {}) {
  const rejected = args !== null && typeof args === "object" ? args.subject : undefined;
  const classified = classifyDispatchSubject(rejected);
  if (classified === null || typeof classified.slice_id !== "string") return null;
  const versionPresent = Object.hasOwn(args, "version");
  const versionValid = !versionPresent || typeof args.version === "string" && /^[0-9a-f]{64}$/u.test(args.version);
  const onlyKnownFields = Reflect.ownKeys(args).every(key => key === "subject" || key === "version");
  const corrected = { subject: classified.record_id, ...(versionPresent ? { version: args.version } : {}) };
  const call = !onlyKnownFields || !versionValid ? null : candidateInspectionReadCall(corrected, {
    information: versionPresent
      ? "Observe the same immutable candidate version for the parent WK; a slice has no separate candidate."
      : "Observe current candidate status for the parent WK; a slice has no separate candidate.",
    requestSchemaAuthority
  });
  return {
    details: {
      subject_correction: {
        rejected_subject: rejected,
        reason: "slice_subject_names_no_candidate",
        parent_subject: classified.record_id
      }
    },
    next_calls: !versionValid || call === null ? [] : [call]
  };
}
