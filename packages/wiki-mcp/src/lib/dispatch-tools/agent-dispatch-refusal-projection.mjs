

import { projectLauncherRedactionReason } from
  "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";
import { projectLauncherTransitionReadiness } from
  "@agent-chassis/wiki-core/src/lib/work-record-dispatch-readiness-shape.mjs";
import {
  createFailedLauncherTransitionPlan
} from "@agent-chassis/agent-launch-core/src/lib/launcher-transition-plan.mjs";
import { isRuntimeBlockerCode } from
  "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { AGENT_DISPATCH_TOOL_NAME, DISPATCH_BLOCKER_CODES } from
  "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchContinuation,
  buildDispatchMechanicalRefusal,
  NO_SUPPORTED_ROUTE_RECOVERY
} from "../dispatch-tool-helpers.mjs";
import { classifyMechanicalRuntimeBlocker } from "./runtime-blocker-classifier.mjs";
import { projectBoundedExactPolicyPayloadIssueReadiness } from
  "./agent-dispatch-cce-admission.mjs";

export function hasValidPrivateHandoff(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join("|") !==
      "authored_source_digest|full_persistence_snapshot_digest|reviewed_unit_digest") {
    return false;
  }
  return keys.every((key) => typeof value[key] === "string" && value[key].length > 0);
}

export function strictAdmissionComponentIssue(readiness) {
  const admissionState = readiness?.recovery?.admission_metrics;
  if (admissionState !== "fresh") return admissionState ?? "admission_metrics_missing";
  const targetState = readiness?.recovery?.target_resolution;
  if (targetState !== "fresh" && targetState !== "not_required") {
    return targetState ?? "target_resolution_missing";
  }
  return null;
}

export function boundedRecoveryDetail(readiness, extra = {}) {
  return {
    readiness_decision_code: readiness?.decision_code ?? null,
    recovery: readiness?.recovery ?? null,
    ...extra
  };
}

export function namedAuthoredReadinessClassification(readiness, override = {}) {
  const firstReason = Array.isArray(readiness?.reasons) ? readiness.reasons[0] : null;
  const reason = firstReason && typeof firstReason === "object" ? firstReason : {};
  const decisionCode = String(readiness?.decision_code ?? "work_record_not_dispatchable");
  return classifyMechanicalRuntimeBlocker({
    producer: "authored_readiness",
    condition: "named_contract_defect",
    named_defect: {
      check: String(override.check ?? reason.code ?? decisionCode),
      status: String(override.status ?? reason.status ?? decisionCode),
      path: String(
        override.path ?? reason.path ?? reason.field ??
        `wiki/work-records/${readiness?.record_id ?? "selected-unit"}.json`
      )
    }
  });
}

export function evidenceFailureClassification(condition, issue) {
  return classifyMechanicalRuntimeBlocker({
    producer: "evidence",
    condition,
    detail: { issue: String(issue ?? condition).slice(0, 256) }
  });
}

export function projectPublicBackendDetail(classification, app) {
  const { diagnostics } = classification;
  const projected = {
    app,
    classification_state: classification.state,
    refusal_code: classification.refusal_code,
    refusal_reason: classification.refusal_reason,
    cause: Object.freeze({
      type: diagnostics.cause?.type ?? classification.cause.type,
      code: classification.cause.code,
      source: classification.cause.source,
      classification_code: classification.cause.classification_code
    }),
    recovery: classification.recovery,
    actor_recovery: classification.actor_recovery,
    authority_limb: classification.authority_limb,
    transition_failure: classification.transition_failure.code,
    redactions: Object.freeze(
      classification.redactions.map((signal) => Object.freeze({
        field: signal.field,
        reason: projectLauncherRedactionReason(signal.reason)
      }))
    ),
    schema_rejected: classification.schema_rejected
  };
  for (const field of [
    "cause_code", "next_action", "next_action_args",
    "mismatch_field", "expected", "actual", "subject", "role",
    "message", "detail", "error", "stderr", "stdout", "stack",
    "explanation", "reason_detail", "diagnostic", "output"
  ]) {
    if (Object.hasOwn(diagnostics, field)) projected[field] = diagnostics[field];
  }
  return Object.freeze(projected);
}

export function routeExceptionRefusal(route) {
  return buildDispatchMechanicalRefusal({
    code: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
    decidingFacts: [{ field: "dispatch.route_completed", value: false }],
    observedFacts: { "dispatch.route_completed": false },
    noSupportedRoute: true,
    recovery: NO_SUPPORTED_ROUTE_RECOVERY,
    route
  });
}

export function callerSuppliedAuthorityRefusal({ role, subject, refusedFields }) {
  const observedFacts = {
    "request.caller_supplied_authority_present": true,
    "request.caller_supplied_authority_field_count": refusedFields.length
  };
  const decidingFacts = [
    { field: "request.caller_supplied_authority_present", value: true },
    { field: "request.caller_supplied_authority_field_count", value: refusedFields.length }
  ];
  const continuation = typeof role === "string" && typeof subject === "string"
    ? buildDispatchContinuation({
        tool: AGENT_DISPATCH_TOOL_NAME,
        arguments: { role, subject },
        successPredicate: {
          fact: "request.caller_supplied_authority_present",
          operator: "is_false"
        }
      })
    : null;
  if (continuation === null) {
    return buildDispatchMechanicalRefusal({
      code: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
      decidingFacts,
      observedFacts,
      noSupportedRoute: true,
      recovery: NO_SUPPORTED_ROUTE_RECOVERY,
      route: AGENT_DISPATCH_TOOL_NAME
    });
  }
  const sameCallContinuation = Object.freeze({
    ...continuation,
    prerequisite_predicate: continuation.success_predicate
  });
  return buildDispatchMechanicalRefusal({
    code: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
    decidingFacts,
    observedFacts,
    nextCalls: [sameCallContinuation],
    recovery: {
      state: "callable",
      prerequisite: "the request carries authority this route is closed to",
      operation: sameCallContinuation.tool,
      success_condition:
        "workspace_agent_dispatch admits the same role and subject when no caller-supplied authority carrier accompanies them",
      success_predicate: sameCallContinuation.success_predicate,
      selected_from: ["request.caller_supplied_authority_present"]
    },
    route: AGENT_DISPATCH_TOOL_NAME
  });
}

export function subjectRoleMatrixRefusal({ role, subject, subjectKind }) {
  return buildDispatchMechanicalRefusal({
    code: DISPATCH_BLOCKER_CODES.ROLE_POLICY_VIOLATION,
    decidingFacts: [
      { field: "dispatch.subject_role_accepted", value: false },
      { field: "dispatch.role", value: role ?? null },
      { field: "dispatch.subject_kind", value: subjectKind ?? null }
    ],
    observedFacts: {
      "dispatch.subject_role_accepted": false,
      "dispatch.role": role ?? null,
      "dispatch.subject_kind": subjectKind ?? null
    },
    noSupportedRoute: true,
    recovery: NO_SUPPORTED_ROUTE_RECOVERY,
    route: AGENT_DISPATCH_TOOL_NAME,
    carried: { rejected_subject: typeof subject === "string" ? subject : null }
  });
}

export function reviewerShaSubjectCorrection(subject) {
  return Object.freeze({
    schema_version: "workspace_agent_dispatch.same_tool_correction.v1",
    misuse: "review_commit_sha_used_as_coordination_subject",
    observed_caller_value: Object.freeze({
      value: subject,
      authority: "non_authoritative",
      meaning: "review_locator_not_coordination_subject"
    }),
    same_tool_correction: Object.freeze({
      tool: AGENT_DISPATCH_TOOL_NAME,
      route_supported: true,
      dispatcher: "same_registered_workspace_agent_dispatch",
      required_fields: Object.freeze([
        "role",
        "subject",
        "diff_base_sha",
        "reviewed_sha"
      ]),
      field_contract: Object.freeze({
        role: "reviewer",
        subject: "canonical_WK_or_WK_slice",
        diff_base_sha: "complete_base_commit_sha",
        reviewed_sha: "complete_reviewed_commit_sha"
      }),
      statement:
        "The SHA is a review locator, not the coordination subject. The caller supplies its already-known canonical WK or review slice in subject and adds diff_base_sha and reviewed_sha to the same workspace_agent_dispatch request. The server does not infer or search for a WK from a SHA.",
      canonical_subject_source: "caller_supplied_already_known_WK_or_slice",
      server_subject_resolution: "does_not_infer_or_search_for_WK_from_SHA",
      external_reviewer_required: false,
      reviewer_git_posture: "read_only_and_never_creates_git_objects",
      not_required: Object.freeze([
        "external_reviewer",
        "shell_command",
        "wrapper",
        "alternate_transport",
        "terminal_candidate",
        "ref_creation",
        "attestation_append",
        "provenance_repair"
      ])
    })
  });
}

export function reviewerShaSubjectRefusal({ subject, requestSchemaAuthority = null }) {
  const correction = reviewerShaSubjectCorrection(subject);
  const predicate = Object.freeze({
    fact: "dispatch.workspace_agent_dispatch_description_loaded",
    operator: "is_true"
  });
  const continuation = buildDispatchContinuation({
    tool: "workspace_tools_describe",
    arguments: {
      tool_name: AGENT_DISPATCH_TOOL_NAME,
      verbose: true
    },
    successPredicate: predicate,
    requestSchemaAuthority
  });
  if (continuation === null) {
    throw new TypeError(
      "workspace_tools_describe request-schema authority is unavailable for reviewer SHA-subject recovery"
    );
  }
  return buildDispatchMechanicalRefusal({
    code: DISPATCH_BLOCKER_CODES.ROLE_POLICY_VIOLATION,
    decidingFacts: [
      { field: "dispatch.subject_role_accepted", value: false },
      { field: "dispatch.role", value: "reviewer" },
      { field: "dispatch.subject_commit_sha_shaped", value: true },
      { field: "dispatch.canonical_subject_present", value: false },
      { field: "dispatch.workspace_agent_dispatch_description_loaded", value: false }
    ],
    observedFacts: {
      "dispatch.subject_role_accepted": false,
      "dispatch.role": "reviewer",
      "dispatch.subject_commit_sha_shaped": true,
      "dispatch.canonical_subject_present": false,
      "dispatch.workspace_agent_dispatch_description_loaded": false
    },
    nextCalls: [continuation],
    recovery: {
      state: "callable",
      prerequisite:
        "the caller has not loaded the registered workspace_agent_dispatch call contract",
      operation: "workspace_tools_describe",
      success_condition:
        "workspace_tools_describe returns the registered workspace_agent_dispatch description containing the canonical subject and complete SHA-pair call shape",
      success_predicate: continuation.success_predicate,
      selected_from: ["dispatch.workspace_agent_dispatch_description_loaded"]
    },
    route: AGENT_DISPATCH_TOOL_NAME,
    carried: correction,
    requestSchemaAuthority
  });
}

export function publicBackendBlockerCode(backendClassification) {
  const refusalCode = backendClassification?.refusal_code ?? null;
  return refusalCode === backendClassification?.cause?.code && isRuntimeBlockerCode(refusalCode)
    ? refusalCode
    : backendClassification.blocker_code;
}

export function backendRefusalCarrier(backendClassification, {
  role = null,
  subject = null
} = {}) {
  const causeCode = backendClassification?.cause?.code ?? null;
  const blockerCode = publicBackendBlockerCode(backendClassification);
  if (causeCode === "agent_launch.review_target_resolution.failed.v1" &&
      typeof role === "string" && typeof subject === "string") {
    const continuation = buildDispatchContinuation({
      tool: AGENT_DISPATCH_TOOL_NAME,
      arguments: { role, subject },
      successPredicate: { fact: "request.review_target_range_valid", operator: "is_true" }
    });
    const sameCallContinuation = Object.freeze({
      ...continuation,
      prerequisite_predicate: continuation.success_predicate
    });
    return buildDispatchMechanicalRefusal({
      code: blockerCode,
      decidingFacts: [
        { field: "request.review_target_range_valid", value: false },
        { field: "dispatch.backend_cause", value: causeCode }
      ],
      observedFacts: {
        "request.review_target_range_valid": false,
        "dispatch.backend_cause": causeCode
      },
      nextCalls: [sameCallContinuation],
      recovery: {
        state: "callable",
        prerequisite: "the current review call carries an unreadable commit range",
        operation: AGENT_DISPATCH_TOOL_NAME,
        success_condition:
          "re-call with a complete valid diff_base_sha/reviewed_sha pair, or omit both to use the canonical selector",
        success_predicate: sameCallContinuation.success_predicate,
        selected_from: ["request.review_target_range_valid"]
      },
      route: AGENT_DISPATCH_TOOL_NAME,
      carried: {
        launcher_backend_refusal: { blocker_code: blockerCode, cause: causeCode }
      }
    });
  }
  return buildDispatchMechanicalRefusal({
    code: blockerCode,
    decidingFacts: [
      { field: "dispatch.backend_accepted", value: false },
      { field: "dispatch.backend_cause", value: causeCode }
    ],
    observedFacts: {
      "dispatch.backend_accepted": false,
      "dispatch.backend_cause": causeCode
    },
    noSupportedRoute: true,
    recovery: NO_SUPPORTED_ROUTE_RECOVERY,
    route: AGENT_DISPATCH_TOOL_NAME,
    carried: {
      launcher_backend_refusal: { blocker_code: blockerCode, cause: causeCode }
    }
  });
}

export function continuationOrNull({
  tool,
  arguments: callArguments,
  predicate,
  prerequisite,
  successCondition
}) {
  const call = buildDispatchContinuation({
    tool,
    arguments: callArguments,
    successPredicate: predicate
  });
  return call === null ? null : { call, prerequisite, successCondition };
}

export function readinessFailure(source, launcherTransitionFailures) {
  const status = source?.admissibility?.status ?? null;
  if (status !== null && status !== "unavailable" &&
      status !== "admit" && status !== "local_only_fail_open") {
    return launcherTransitionFailures.CCE_POLICY_REFUSED;
  }
  return launcherTransitionFailures.PROSPECTIVE_LIFECYCLE_UNAVAILABLE;
}

export function buildTransitionRefusal({
  args,
  resolveTransitionSelection,
  readinessSource,
  projectPublicReadiness,
  failure,
  blockerCode,
  reason,
  detail = null,
  nextAction = null,
  previousPlan = null,
  refusal = null,
  decidingFacts = null,
  observedFacts = null,
  continuation = null,
  carried = null
}) {
  const launcherTransitionPlan = createFailedLauncherTransitionPlan({
    previousPlan,
    subject: args.subject,
    selection: resolveTransitionSelection(),
    readiness: projectBoundedExactPolicyPayloadIssueReadiness(readinessSource),
    failure
  });
  const facts = observedFacts ?? {
    "dispatch.admitted": false,
    "dispatch.refusal_reason": reason
  };
  const published = decidingFacts ?? [
    { field: "dispatch.admitted", value: false },
    { field: "dispatch.refusal_reason", value: reason }
  ];
  const common = {
    code: blockerCode,
    decidingFacts: published,
    observedFacts: facts,
    route: AGENT_DISPATCH_TOOL_NAME,
    carried
  };
  const projectedRefusal = refusal ?? (continuation === null
    ? buildDispatchMechanicalRefusal({
        ...common,
        noSupportedRoute: true,
        recovery: NO_SUPPORTED_ROUTE_RECOVERY
      })
    : buildDispatchMechanicalRefusal({
        ...common,
        nextCalls: [continuation.call],
        recovery: {
          state: "callable",
          prerequisite: continuation.prerequisite,
          operation: continuation.call.tool,
          success_condition: continuation.successCondition,
          success_predicate: continuation.call.success_predicate
        }
      }));
  return Object.freeze({
    ...buildBlockedDispatchResult({
      blockerCode,
      reason,
      detail,
      nextAction,
      refusal: projectedRefusal
    }),
    readiness: projectPublicReadiness(readinessSource, launcherTransitionPlan),
    launcher_transition_plan: launcherTransitionPlan
  });
}

export function projectPublicReadiness(source, launcherTransitionPlan, managedWkAllocation = null) {
  return source === null
    ? null
    : projectLauncherTransitionReadiness(source, launcherTransitionPlan, managedWkAllocation);
}
