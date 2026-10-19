

import {
  WORKER_SCOPE_PATH_REFUSED_DECISION_CODE as WORKER_SCOPE_PATH_REFUSED,
  projectLauncherTransitionReadiness
} from "@agent-chassis/wiki-core/src/lib/work-record-dispatch-readiness-shape.mjs";
import {
  createFailedLauncherTransitionPlan,
  classifyLauncherTransitionBackendRefusal
} from "@agent-chassis/agent-launch-core/src/lib/launcher-transition-plan.mjs";
import { isRuntimeBlockerCode } from
  "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  AGENT_DISPATCH_SCHEMA_VERSION,
  AGENT_DISPATCH_TOOL_NAME,
  DISPATCH_BLOCKER_CODES
} from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchContinuation,
  buildDispatchMechanicalRefusal,
  distillDispatchFailureDetail,
  NO_SUPPORTED_ROUTE_RECOVERY,
  ownedNoRouteRecovery,
  projectDispatchFailureDetail,
  requestSchemaAuthorityForRegistration,
  retainWithheldOriginal
} from "../dispatch-tool-helpers.mjs";
import { buildDispatchGuidanceRefusal, GUIDANCE_CAPABILITY_OWNER, guidanceCapability } from
  "../dispatch-guidance-contract.mjs";
import { loadDispatchSelection } from "@agent-chassis/wiki-core/src/operations/validate-dispatch.mjs";
import { classifyMechanicalRuntimeBlocker } from "./runtime-blocker-classifier.mjs";
import { projectBoundedExactPolicyPayloadIssueReadiness } from
  "./agent-dispatch-cce-admission.mjs";
import { controlledAcceptanceRecoveryCall, servedControlledAcceptanceRecovery } from "../task-start-agent-guidance.mjs";

export function hasValidPrivateHandoff(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join("|") !==
      "authored_source_digest|full_persistence_snapshot_digest|reviewed_unit_digest") {
    return false;
  }
  return keys.every((key) => typeof value[key] === "string" && value[key].length > 0);
}

export function projectWorkerInputRefusal(checked, { role, subject, app, env, requestSchemaAuthority }) {
  const classification = classifyLauncherTransitionBackendRefusal({
    schema_version: AGENT_DISPATCH_SCHEMA_VERSION, accepted: false, refusal: checked.refusal
  });
  return buildBlockedDispatchResult({
    blockerCode: publicBackendBlockerCode(classification), reason: classification.cause.code,
    detail: projectPublicBackendDetail(classification, app, { env }),
    nextAction: classification.next_action,
    refusal: backendRefusalCarrier(classification, { role, subject, requestSchemaAuthority })
  });
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
    ...(readiness?.controlled_acceptance_failure === undefined ? {} : {
      controlled_acceptance_failure: readiness.controlled_acceptance_failure }),
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

const STACK_FRAME_RE = /^\s*at (?:.*? \()?(?:file:\/\/)?(\/[^()]*?):(\d+):(\d+)\)?\s*$/u;
const PACKAGE_RELATIVE_RE = /(?:^|\/)((?:packages|node_modules)\/.+)$/u;

function originFrame(stack) {
  for (const line of stack.split("\n").slice(1)) {
    const frame = STACK_FRAME_RE.exec(line);
    const relative = frame === null ? null : PACKAGE_RELATIVE_RE.exec(frame[1]);
    if (relative !== null) return `${relative[1]}:${frame[2]}:${frame[3]}`;
  }
  return null;
}

function redactDiagnosticStacks(value, location, redactions) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) =>
      redactDiagnosticStacks(entry, `${location}[${index}]`, redactions)));
  }
  if (value === null || typeof value !== "object") return value;
  const errorShaped = typeof value.stack === "string" &&
    (typeof value.name === "string" || typeof value.message === "string");
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (errorShaped && key === "stack") {
      redactions.push(`${location}.stack`);
      if (!Object.hasOwn(value, "origin_frame")) result.origin_frame = originFrame(entry);
      continue;
    }
    result[key] = redactDiagnosticStacks(entry, `${location}.${key}`, redactions);
  }
  return Object.freeze(result);
}

export function projectPublicBackendDetail(classification, app, { env = process.env } = {}) {
  const redactions = [];
  const stackFree = redactDiagnosticStacks(
    classification.diagnostics,
    "originating_detail",
    redactions
  );
  const { detail: distilled, withheld } = distillDispatchFailureDetail(stackFree,
    { at: "originating_detail" });
  const diagnostics = distilled !== null && typeof distilled === "object" ? distilled : stackFree;
  const retention = retainWithheldOriginal(classification.diagnostics,
    [...redactions, ...withheld], { env });
  const projected = {
    app,
    classification_state: classification.state,
    refusal_code: classification.refusal_code,
    refusal_reason: classification.refusal_reason,
    cause: Object.freeze({
      type: classification.cause.type,
      code: classification.cause.code,
      source: classification.cause.source,
      classification_code: classification.cause.classification_code
    }),
    recovery: classification.recovery,
    actor_recovery: classification.actor_recovery,
    authority_limb: classification.authority_limb,
    transition_failure: classification.transition_failure.code,
    originating_detail: diagnostics,
    redactions: Object.freeze(redactions),
    ...retention,
    schema_rejected: classification.schema_rejected
  };

  return Object.freeze(projected);
}

export function routeExceptionRefusal(route) {
  return buildDispatchMechanicalRefusal({
    code: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
    decidingFacts: [{ field: "dispatch.route_completed", value: false }],
    observedFacts: { "dispatch.route_completed": false },
    noSupportedRoute: true,
    recovery: NO_SUPPORTED_ROUTE_RECOVERY,
    route
  });
}

const PUBLIC_START_TOOL = "start_agent";

const EXISTING_ATTEMPT_READ_TOOL = "get_run_result";

export function callerSuppliedAuthorityRefusal({ role, subject, refusedFields,
  requestSchemaAuthority = null }) {
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
        tool: PUBLIC_START_TOOL,
        arguments: { role, subject },
        successPredicate: {
          fact: "request.caller_supplied_authority_present",
          operator: "is_false"
        },
        requestSchemaAuthority
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
        "start_agent admits the same role and subject when no caller-supplied authority carrier accompanies them",
      success_predicate: sameCallContinuation.success_predicate,
      selected_from: ["request.caller_supplied_authority_present"]
    },
    route: PUBLIC_START_TOOL,
    requestSchemaAuthority
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
  const factEntries = [
    ["dispatch.subject_role_accepted", false],
    ["dispatch.role", "reviewer"],
    ["dispatch.subject_commit_sha_shaped", true],
    ["dispatch.canonical_subject_present", false]
  ];
  const decidingFacts = factEntries.map(([field, value]) => ({ field, value }));
  const observedFacts = Object.fromEntries(factEntries);
  const common = {
    code: DISPATCH_BLOCKER_CODES.ROLE_POLICY_VIOLATION,
    decidingFacts,
    observedFacts,
    route: AGENT_DISPATCH_TOOL_NAME
  };
  const built = buildDispatchGuidanceRefusal({
    ...common,
    guidance: {
      tool: "workspace_tools_describe",
      arguments: { tool_name: AGENT_DISPATCH_TOOL_NAME, verbose: true },
      information:
        "The registered workspace_agent_dispatch call contract: canonical WK or slice subject plus diff_base_sha and reviewed_sha."
    },
    recovery: {
      responsible_actor: "coordinator",
      prerequisite: "the request names a commit SHA as its coordination subject",
      selected_from: ["dispatch.canonical_subject_present"],
      retry_condition:
        "resubmit workspace_agent_dispatch with the already-known canonical subject and the SHA pair"
    },
    carried: correction,
    requestSchemaAuthority
  });
  if (built.refusal) return built.refusal;
  return buildDispatchMechanicalRefusal({
    ...common,
    noSupportedRoute: true,
    recovery: NO_SUPPORTED_ROUTE_RECOVERY,
    carried: { ...correction, guidance_unavailable: built.unavailable }
  });
}

export function missingInitiativeAuthoring(readiness) {
  return { unit: readiness.record_id, save_tool: "save_record", placement: "changes.initiative",
    values: "caller_chosen_existing_initiative" };
}
export function missingInitiativeRead(authoring) {
  return { tool: "workspace_read_wiki", arguments: { subject: authoring.unit },
    information: `The parent ${authoring.unit} and its current revision, for a caller-authored ` +
      `${authoring.placement} save naming an existing canonical IN-#### initiative; reading leaves the blocker unchanged.` };
}

const SCOPE_PATH_TEXT_LIMIT = 1024;

function isDeclaredScopePathCause(classification) {
  return classification?.state === "known" &&
    classification.cause?.code === WORKER_SCOPE_PATH_REFUSED &&
    classification.cause?.source === "detail.cause.code";
}

function declaredScopePathFacts(classification) {
  if (!isDeclaredScopePathCause(classification)) return null;
  const facts = classification.diagnostics?.worker_scope_path;
  const text = (value) => typeof value === "string" && value.length > 0 &&
    value.length <= SCOPE_PATH_TEXT_LIMIT;
  if (facts === null || typeof facts !== "object" || facts.code !== WORKER_SCOPE_PATH_REFUSED ||
      !text(facts.field) || !text(facts.cause) || !text(facts.path) ||
      !(facts.component === null || text(facts.component))) {
    return null;
  }
  return facts;
}

export function publicBackendBlockerCode(backendClassification) {
  if (isDeclaredScopePathCause(backendClassification)) return WORKER_SCOPE_PATH_REFUSED;
  const refusalCode = backendClassification?.refusal_code ?? null;
  return refusalCode === backendClassification?.cause?.code && isRuntimeBlockerCode(refusalCode)
    ? refusalCode
    : backendClassification.blocker_code;
}

function scopePathCorrectionRefusal({ blockerCode, facts, role, subject, carried,
  requestSchemaAuthority = null }) {
  const correctedFact = "worker_scope_path.corrected";
  const factEntries = [
    ["dispatch.backend_accepted", false],
    ["dispatch.backend_cause", WORKER_SCOPE_PATH_REFUSED],
    ["worker_scope_path.field", facts.field],
    ["worker_scope_path.path", facts.path],
    ["worker_scope_path.component", facts.component],
    ["worker_scope_path.cause", facts.cause],
    [correctedFact, false]
  ];
  const decidingFacts = factEntries.map(([field, value]) => ({ field, value }));
  const observedFacts = Object.fromEntries(factEntries);
  const continuation = typeof role === "string" && typeof subject === "string"
    ? buildDispatchContinuation({
        tool: PUBLIC_START_TOOL,
        arguments: { role, subject },
        successPredicate: { fact: correctedFact, operator: "is_true" },
        requestSchemaAuthority
      })
    : null;
  if (continuation === null) {
    return buildDispatchMechanicalRefusal({
      code: blockerCode,
      decidingFacts,
      observedFacts,
      noSupportedRoute: true,
      recovery: NO_SUPPORTED_ROUTE_RECOVERY,
      route: AGENT_DISPATCH_TOOL_NAME,
      carried
    });
  }
  const sameCallContinuation = Object.freeze({
    ...continuation,
    prerequisite_predicate: continuation.success_predicate
  });
  return buildDispatchMechanicalRefusal({
    code: blockerCode,
    decidingFacts,
    observedFacts,
    nextCalls: [sameCallContinuation],
    recovery: {
      state: "callable",
      prerequisite:
        "the declared scope path named by worker_scope_path does not resolve at the authenticated scope base; its author corrects the canonical slice contract, or delivers the path at that base, before this call",
      operation: sameCallContinuation.tool,
      success_condition:
        "every declared scope path resolves at the authenticated scope base and start_agent applies its remaining checks to the same role and subject",
      success_predicate: sameCallContinuation.success_predicate,
      selected_from: decidingFacts.map((fact) => fact.field)
    },
    route: PUBLIC_START_TOOL,
    carried,
    requestSchemaAuthority
  });
}

export function carriedBackendRefusalFor(backendClassification) {
  return Object.freeze({
    blocker_code: publicBackendBlockerCode(backendClassification),
    cause: backendClassification?.cause?.code ?? null,
    originating_detail_location: "blocker.detail.originating_detail"
  });
}

export function backendRefusalCarrier(backendClassification, {
  role = null,
  subject = null,
  requestSchemaAuthority = null
} = {}) {
  const causeCode = backendClassification?.cause?.code ?? null;
  const blockerCode = publicBackendBlockerCode(backendClassification);
  const classifiedRecovery = backendClassification?.recovery ?? null;
  const carriedBackendRefusal = carriedBackendRefusalFor(backendClassification);
  let unavailableGuidance = Object.freeze(["guidance_consumer_for_refusal_reason"]);
  let controlledNavigationLimitation = null;
  const controlled = backendClassification?.diagnostics?.controlled_acceptance_failure;
  if (controlled !== undefined && controlled.requested_unit === subject &&
      classifiedRecovery?.state === "guidance" && classifiedRecovery.route === controlled.owner_call?.tool &&
      JSON.stringify(classifiedRecovery.args) === JSON.stringify(controlled.owner_call.arguments)) {
    const call = controlledAcceptanceRecoveryCall(controlled);
    if (call !== null) {
      try {
        const built = buildDispatchGuidanceRefusal({ code: blockerCode,
          decidingFacts: [{ field: "dispatch.backend_accepted", value: false },
            { field: "dispatch.controlled_acceptance_cause", value: controlled.deciding_cause }],
          observedFacts: { "dispatch.backend_accepted": false,
            "dispatch.controlled_acceptance_cause": controlled.deciding_cause },
          guidance: { ...call, information: classifiedRecovery.information },
          recovery: { prerequisite: classifiedRecovery.prerequisite, responsible_actor: classifiedRecovery.responsible_actor,
            selected_from: ["dispatch.controlled_acceptance_cause"] },
          route: PUBLIC_START_TOOL, carried: { launcher_backend_refusal: carriedBackendRefusal }, requestSchemaAuthority });
        if (built.refusal !== undefined) return built.refusal;
        unavailableGuidance = built.unavailable.missing;
      } catch (error) {
        unavailableGuidance = Object.freeze(["request_schema_arguments_rejected"]);
        controlledNavigationLimitation = { code: "controlled_acceptance_navigation_schema_rejected", tool: call.tool,
          cause: { code: error.code ?? null, message: error.message } };
      }
    }
  }

  const identity = backendClassification?.diagnostics?.identity_correction;
  const identityRead = identity?.unit === subject && identity.parent === subject?.split('#')[0] &&
    classifiedRecovery?.route === 'workspace_read_wiki' && classifiedRecovery.args?.subject === identity.parent &&
    Object.keys(classifiedRecovery.args).length === 1;
  const assignment = backendClassification?.diagnostics?.assignment_correction;
  const assignmentRead = assignment?.requested_unit === subject && assignment.unit === subject?.split('#')[0] &&
    classifiedRecovery?.route === 'workspace_read_wiki' && classifiedRecovery.args?.subject === assignment.unit &&
    Object.keys(classifiedRecovery.args).length === 1;
  if (classifiedRecovery?.state === "guidance" &&
      (classifiedRecovery.route === EXISTING_ATTEMPT_READ_TOOL || identityRead || assignmentRead)) {
    const built = buildDispatchGuidanceRefusal({
      code: blockerCode,
      decidingFacts: [
        { field: "dispatch.backend_accepted", value: false },
        { field: "dispatch.backend_cause", value: causeCode }
      ],
      observedFacts: { "dispatch.backend_accepted": false, "dispatch.backend_cause": causeCode },
      guidance: { tool: classifiedRecovery.route, arguments: classifiedRecovery.args,
        information: classifiedRecovery.information },

      recovery: { prerequisite: classifiedRecovery.prerequisite,
        responsible_actor: classifiedRecovery.responsible_actor,
        selected_from: ["dispatch.backend_cause"],
        ...(typeof classifiedRecovery.explanation === "string"
          ? { explanation: classifiedRecovery.explanation } : {}) },
      route: PUBLIC_START_TOOL,
      carried: { launcher_backend_refusal: carriedBackendRefusal },
      requestSchemaAuthority
    });
    if (built.refusal !== undefined) return built.refusal;
    unavailableGuidance = built.unavailable.missing;
  }
  if (classifiedRecovery?.state === "guidance") {
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
        launcher_backend_refusal: carriedBackendRefusal,
        guidance_unavailable: Object.freeze({
          available: false,
          missing: unavailableGuidance,
          owner: GUIDANCE_CAPABILITY_OWNER,
          ...(controlledNavigationLimitation === null ? {} : { limitation: controlledNavigationLimitation }),
          proposal_location: "blocker.detail.recovery"
        })
      }
    });
  }
  const scopePathFacts = declaredScopePathFacts(backendClassification);
  if (scopePathFacts !== null) {
    return scopePathCorrectionRefusal({
      blockerCode,
      facts: scopePathFacts,
      role,
      subject,
      carried: { launcher_backend_refusal: carriedBackendRefusal },
      requestSchemaAuthority
    });
  }

  if (classifiedRecovery?.state === "callable" &&
      typeof classifiedRecovery.route === "string") {
    const successPredicate = Object.freeze({
      fact: `${classifiedRecovery.route}.accepted`,
      operator: "is_true"
    });
    const validatedContinuation = buildDispatchContinuation({
      tool: classifiedRecovery.route,
      arguments: classifiedRecovery.args ?? undefined,
      successPredicate,
      requestSchemaAuthority
    });
    if (validatedContinuation !== null) {

      const sameTool = classifiedRecovery.route === PUBLIC_START_TOOL;
      const continuation = sameTool
        ? Object.freeze({
            ...validatedContinuation,
            prerequisite_predicate: validatedContinuation.success_predicate
          })
        : validatedContinuation;
      const observedFacts = {
        "dispatch.backend_accepted": false,
        "dispatch.backend_cause": causeCode,
        [`${classifiedRecovery.route}.accepted`]: false
      };
      return buildDispatchMechanicalRefusal({
        code: blockerCode,
        decidingFacts: [
          { field: "dispatch.backend_accepted", value: false },
          { field: "dispatch.backend_cause", value: causeCode },
          { field: `${classifiedRecovery.route}.accepted`, value: false }
        ],
        observedFacts,
        nextCalls: [continuation],
        recovery: {
          state: "callable",
          prerequisite:
            "the classified launcher recovery names a registered operation whose request has not yet been accepted",
          operation: continuation.tool,
          success_condition:
            "the named operation accepts the advertised arguments after applying its own checks",
          success_predicate: continuation.success_predicate
        },
        route: sameTool ? PUBLIC_START_TOOL : AGENT_DISPATCH_TOOL_NAME,
        carried: {
          launcher_backend_refusal: carriedBackendRefusal
        },
        requestSchemaAuthority
      });
    }
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
    recovery: classifiedRecovery?.state === "no_supported_route" &&
        typeof classifiedRecovery.responsible_actor === "string" &&
        typeof classifiedRecovery.prerequisite === "string" &&
        typeof classifiedRecovery.operator_action === "string" &&
        typeof classifiedRecovery.retry_condition === "string" &&
        typeof classifiedRecovery.explanation === "string"
      ? Object.freeze({
          state: "no_supported_route",
          responsible_actor: classifiedRecovery.responsible_actor,
          prerequisite: classifiedRecovery.prerequisite,
          operator_action: classifiedRecovery.operator_action,
          retry_condition: classifiedRecovery.retry_condition,
          explanation: classifiedRecovery.explanation
        })
      : NO_SUPPORTED_ROUTE_RECOVERY,
    route: AGENT_DISPATCH_TOOL_NAME,
    carried: {
      launcher_backend_refusal: carriedBackendRefusal
    }
  });
}

export function continuationOrNull({
  requestSchemaAuthority = null,
  tool,
  arguments: callArguments,
  predicate,
  prerequisite,
  successCondition
}) {
  const call = buildDispatchContinuation({
    tool,
    requestSchemaAuthority,
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

export function unresolvedAssignmentAuthoring({ selection, subject }) {
  if (selection.record_id === null) return null;
  const slice = selection.subject !== null && selection.slice_id !== null;
  return { state: slice ? "slice_intent_unresolved" : selection.slice_id === null ? "slice_required" : "slice_absent",
    unit: slice ? subject : selection.record_id, save_tool: "save_record",
    placement: slice ? "changes.agent_role" : "changes.ready_slices", values: "caller_authored" };
}

export const EXACT_SLICE_TARGET_REASON = "managed_worker_exact_slice_required";
export async function exactSliceTargetAuthoring(targetRefusal, { subject, dir, registerTool = null,
  requestSchemaAuthority = null, requestContracts = null }) {
  if (targetRefusal?.refusal?.reason !== EXACT_SLICE_TARGET_REASON) return targetRefusal;
  const tool = "workspace_read_wiki";
  const selection = await loadDispatchSelection({ dir, unitAddress: subject });
  const assignment = unresolvedAssignmentAuthoring({
    selection: { record_id: selection.record_id, slice_id: null, subject: null }, subject });
  const guidance = assignment === null
    ? { limitation: { code: "readiness_guidance_record_unavailable", tool, subject: subject ?? null } }
    : await authoredReadinessGuidance({ subject: assignment.unit, code: targetRefusal.refusal.code,
      assignment: { ...assignment, exact_slice_target: true }, requestContracts,
      requestSchemaAuthority: requestSchemaAuthority ??
        (registerTool === null ? null : requestSchemaAuthorityForRegistration(registerTool)) });
  return { ...targetRefusal, refusal: { ...targetRefusal.refusal,
    ...(assignment === null ? {} : { assignment_authoring: assignment }),
    ...(guidance.refusal === undefined ? { readiness_guidance_limitation: guidance.limitation }
      : { recovery: guidance.refusal.recovery, next_calls: guidance.refusal.next_calls }) } };
}

export async function authoredReadinessGuidance({ subject, readiness, code,
  requestSchemaAuthority, requestContracts, assignment = null, initiative = null }) {
  const target = assignment?.exact_slice_target === true;
  const facts = assignment === null
    ? [["wk.dispatchable", false], ["wk.decision_code", readiness.decision_code]]
    : [[target ? "dispatch.worker_target_exact_slice" : "dispatch.canonical_role_derived", false],
      ["dispatch.assignment_state", assignment.state]];
  const controlled = readiness?.controlled_acceptance_failure;
  const selected = controlled === undefined ? null : await servedControlledAcceptanceRecovery(controlled, requestContracts);
  if (selected?.limitation) return { limitation: selected.limitation };
  const tool = selected?.call.tool ?? "workspace_read_wiki", callArguments = selected?.call.arguments ?? { subject };
  const parentRead = initiative === null ? null : missingInitiativeRead(initiative);
  const capability = guidanceCapability({ tool, requestSchemaAuthority });
  if (!capability.available) return { limitation: {
    code: "readiness_guidance_unavailable", ...capability
  } };
  const contract = requestContracts?.contractFor(tool);
  if (!contract) return { limitation: {
    code: "readiness_guidance_full_contract_unavailable", tool, owner: GUIDANCE_CAPABILITY_OWNER
  } };
  try {
    if (await contract.acceptsArguments(callArguments) !== true) return { limitation: {
      code: "readiness_guidance_arguments_invalid", tool, arguments: callArguments
    } };
    const built = buildDispatchGuidanceRefusal({
      code,
      decidingFacts: facts.map(([field, value]) => ({ field, value })),
      observedFacts: Object.fromEntries(facts),
      guidance: { tool, arguments: callArguments,
        information: selected !== null ? selected.call.information : parentRead !== null ? parentRead.information : assignment === null
          ? `The selected authored unit ${subject}, its current revision and semantic selections for inspecting the readiness defect.`
          : target
            ? `The authored unit ${subject}, its slices and current revision, for a caller-selected implementation slice or a caller-authored ${assignment.placement} save.`
            : `The authored unit ${subject} and its current revision, for a caller-authored ${assignment.placement} save.` },
      recovery: { responsible_actor: "coordinator",
        prerequisite: controlled?.explanation ?? (initiative !== null ? `canonical parent ${subject} declares no canonical IN-#### initiative`
          : assignment === null ? "the selected unit is not dispatchable under its authored contract"
          : target ? "a managed worker starts only on an exact implementation slice"
            : "the saved assignment declares no agent for the requested unit"),
        selected_from: facts.map(([field]) => field),
        retry_condition: initiative !== null
          ? `choose an existing canonical IN-#### initiative, save ${initiative.placement} on ${subject} through save_record ` +
            "at the returned revision, then retry the same subject with start_agent; its other readiness conditions are evaluated then"
          : assignment === null
          ? "correct the selected authored fact through save_record, then reassess the same subject with start_agent"
          : target
            ? `select an existing implementation slice of ${subject}, or author ${assignment.placement} on it through save_record with caller-chosen values, then start that exact slice with start_agent`
            : `author ${assignment.placement} on ${subject} through save_record with caller-chosen values, then start the saved slice with start_agent` },
      route: AGENT_DISPATCH_TOOL_NAME,
      requestSchemaAuthority
    });
    return built.refusal ? built : { limitation: {
      code: "readiness_guidance_unavailable", ...built.unavailable
    } };
  } catch (error) {
    return { limitation: { code: "readiness_guidance_validation_failed", tool,
      cause: { code: error.code ?? null, message: error.message } } };
  }
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
  carried = null,
  requestSchemaAuthority = null
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
    carried,
    requestSchemaAuthority
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
  return projectCompactDispatchRefusal(buildBlockedDispatchResult({
    blockerCode,
    reason,
    detail,
    nextAction,
    refusal: projectedRefusal
  }), {
    readiness: projectPublicReadiness(readinessSource, launcherTransitionPlan),
    plan: launcherTransitionPlan,
    source: readinessSource
  });
}

function compactRefusalReadiness(readiness, plan, source, detail) {
  if (readiness === null) return null;
  const decision = plan?.cce?.decision ?? null;
  const recovery = plan?.cce?.recovery ?? null;
  const publishedRecovery = recovery !== null && detail?.recovery === recovery ? null : recovery;
  return Object.freeze({
    decision_code: readiness.decision_code,
    dispatchable: readiness.dispatchable,
    ...(typeof source?.dispatch_role === "string" ? { dispatch_role: source.dispatch_role } : {}),
    record_id: readiness.record_id,
    unit: readiness.unit,
    ...(decision === null && publishedRecovery === null
      ? {}
      : {
          cce: Object.freeze({
            decision,
            ...(publishedRecovery === null ? {} : { recovery: publishedRecovery })
          })
        })
  });
}

export function projectCompactDispatchRefusal(blocked, { readiness, plan, source }) {
  return Object.freeze({
    ...blocked,
    readiness: compactRefusalReadiness(readiness, plan, source, blocked.blocker?.detail),
    transition_failure: plan?.failure ?? null
  });
}

export function projectAdvisoryDispatchRefusal(launch, { role, subject, subjectKind,
  env = process.env }) {
  const answer = launch !== null && typeof launch === "object" ? launch : {};
  const carrier = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (!Object.hasOwn(value, "detail")) return value;
    return Object.freeze({ ...value, detail: projectDispatchFailureDetail(value.detail, { env }) });
  };
  return Object.freeze({
    schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
    accepted: false,
    transport: "mcp",
    subject_kind: subjectKind,
    role,
    subject,
    run_id: typeof answer.run_id === "string" ? answer.run_id : null,
    monitor_handle: typeof answer.monitor_handle === "string" ? answer.monitor_handle : null,
    ...(Object.hasOwn(answer, "blocker") ? { blocker: carrier(answer.blocker) } : {}),
    ...(Object.hasOwn(answer, "refusal") ? { refusal: carrier(answer.refusal) } : {}),
    ...(Object.hasOwn(answer, "next_action") ? { next_action: answer.next_action } : {}),
    ...(Object.hasOwn(answer, "next_calls") ? { next_calls: answer.next_calls } : {})
  });
}

export function projectPublicReadiness(source, launcherTransitionPlan, managedWkAllocation = null) {
  return source === null
    ? null
    : projectLauncherTransitionReadiness(source, launcherTransitionPlan, managedWkAllocation);
}
