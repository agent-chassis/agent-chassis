

import {
  LAUNCHER_TRANSITION_FAILURES,
  classifyLauncherTransitionBackendRefusal,
  createProspectiveLauncherTransitionPlan,
  revalidateLauncherTransitionPlan
} from "@agent-chassis/agent-launch-core/src/lib/launcher-transition-plan.mjs";
import {
  AGENT_DISPATCH_SCHEMA_VERSION,
  DISPATCH_BLOCKER_CODES
} from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  projectDispatchFailureDetail
} from "../dispatch-tool-helpers.mjs";
import {
  backendRefusalCarrier,
  projectAdvisoryDispatchRefusal,
  projectCompactDispatchRefusal,
  projectPublicBackendDetail,
  publicBackendBlockerCode
} from "./agent-dispatch-refusal-projection.mjs";
import { projectBoundedExactPolicyPayloadIssueReadiness } from
  "./agent-dispatch-cce-admission.mjs";
import { decideBaseSelectionRecovery } from "./dispatch-base-selection-guidance.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

const RUN_STATUS_TOOL_NAME = "workspace_agent_run_status";

async function runStatusCall({ requestContracts, repository, launch }) {
  const contract = requestContracts?.contractFor?.(RUN_STATUS_TOOL_NAME) ?? null;
  if (contract === null || typeof launch?.subject !== "string" || typeof launch?.run_id !== "string") {
    return null;
  }
  const args = { repo: repository, subject: launch.subject, attempt_id: launch.run_id };
  return await contract.acceptsArguments(args) === true
    ? buildNextCall({ tool: RUN_STATUS_TOOL_NAME, arguments: args, recommended: true })
    : null;
}

async function acceptedDispatchReceipt({ launch, repository, requestContracts }) {
  const statusCall = await runStatusCall({ requestContracts, repository, launch });
  return {
    schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
    accepted: true,
    run_id: launch.run_id,
    monitor_handle: launch.monitor_handle,
    role: launch.role,
    subject: launch.subject,
    status: launch.status,
    terminal: launch.terminal,
    ...(statusCall === null ? {} : { next_calls: [statusCall] }),
    ...(launch.resumed === true ? { resumed: true } : {})
  };
}

const DISPATCH_LAUNCH_BACKEND_REASON = "launch_backend_unavailable";
const DISPATCH_LAUNCH_BACKEND_MISSING = "workspace_agent_run_lifecycle";

function routingFailureDetail(routingDecision, env) {
  const refusal = routingDecision?.refusal ?? null;
  return projectDispatchFailureDetail({
    ...(typeof refusal?.code === "string" ? { code: refusal.code } : {}),
    reason: routingDecision?.reason ?? refusal?.reason ?? null,
    detail: routingDecision?.detail ?? refusal?.detail ?? null
  }, { env });
}

export async function executeAdvisoryReviewDispatch({
  args,
  workspace,
  subjectKind,
  dispatchApp,
  dispatchModel,
  dispatchBackend,
  dispatchSessionIdentity,
  formalResultContract,
  jsonContent,
  responseEnv = process.env,
  requestContracts = null,
  projectAcceptedLaunch = acceptedDispatchReceipt
}) {
  if (typeof dispatchBackend?.startAdvisoryReview !== "function") {
    return jsonContent({
      schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
      accepted: false,
      transport: "mcp",
      run_id: null,
      monitor_handle: null,
      blocker: {
        code: "agent_launch.advisory_review.pipeline_unavailable.v1",
        reason: "advisory_review_pipeline_unavailable",
        detail: { role: args.role, subject: args.subject }
      },
      refusal: {
        code: "agent_launch.advisory_review.pipeline_unavailable.v1",
        reason: "advisory_review_pipeline_unavailable",
        authority_limb: "mechanical_failure",
        effects_started: false
      }
    });
  }
  const launch = await dispatchBackend.startAdvisoryReview({
    caller_session_id: dispatchSessionIdentity,
    role: args.role,
    subject: args.subject,

    workspace_alias: workspace.repo,
    app: dispatchApp,
    model: dispatchModel,
    formal_result_contract: formalResultContract,
    ...(Object.prototype.hasOwnProperty.call(args, "reviewed_sha")
      ? { reviewed_sha: args.reviewed_sha }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(args, "diff_base_sha")
      ? { diff_base_sha: args.diff_base_sha }
      : {})
  });
  if (launch?.accepted !== true) {
    return jsonContent(projectAdvisoryDispatchRefusal(launch, {
      role: args.role,
      subject: args.subject,
      subjectKind,
      env: responseEnv
    }));
  }
  return jsonContent(await projectAcceptedLaunch({
    launch, repository: workspace.repo, requestContracts
  }));
}

export async function executeAgentDispatchLaunch({
  args,
  workspace,
  subjectKind,
  readiness,
  dispatchApp,
  dispatchModel,
  resolveTransitionSelection,
  dispatchBackend,
  dispatchSessionIdentity,
  buildTransitionRefusal,
  projectPublicReadiness,
  jsonContent,
  requestSchemaAuthority = null,
  reassessmentAvailable = false,
  responseEnv = process.env,
  requestContracts = null,
  projectAcceptedLaunch = acceptedDispatchReceipt,
  buildMissingBaseGuidance = null
}) {

  const admissionFacts = Object.freeze({
    role: args.role,
    subject: args.subject,
    subject_kind: subjectKind,
    readiness: readiness
      ? Object.freeze({
          decision_code: readiness.decision_code,
          dispatchable: readiness.dispatchable,
          record_id: readiness.record_id ?? null,
          unit: readiness.unit ?? null
        })
      : null
  });

  if (!dispatchBackend) {
    return jsonContent(buildTransitionRefusal({
      readinessSource: readiness,
      failure: LAUNCHER_TRANSITION_FAILURES.RUNTIME_BACKEND_UNAVAILABLE,
      blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
      reason: DISPATCH_LAUNCH_BACKEND_REASON,
      detail: { missing_backend: DISPATCH_LAUNCH_BACKEND_MISSING, admission: admissionFacts }
    }));
  }

  const routingDecision = resolveTransitionSelection();
  if (routingDecision?.ok !== true) {
    return jsonContent(buildTransitionRefusal({
      readinessSource: readiness,
      failure: LAUNCHER_TRANSITION_FAILURES.PROSPECTIVE_LIFECYCLE_UNAVAILABLE,

      blockerCode: LAUNCHER_TRANSITION_FAILURES.PROSPECTIVE_LIFECYCLE_UNAVAILABLE.code,
      reason: routingDecision?.reason ?? "launcher_transition_selection_unavailable",
      detail: {
        admission: admissionFacts,
        routing: routingFailureDetail(routingDecision, responseEnv)
      }
    }));
  }

  const prospectiveTransitionPlan = createProspectiveLauncherTransitionPlan({
    subject: args.subject,
    selection: routingDecision,
    readiness: projectBoundedExactPolicyPayloadIssueReadiness(readiness),
    findingsRouteAdmission: null
  });
  const launchReadiness = admissionFacts.readiness === null
    ? null
    : Object.freeze({
        ...admissionFacts.readiness,
        launcher_transition_plan: prospectiveTransitionPlan
      });

  const launch = await dispatchBackend.startLaunch({
    caller_session_id: dispatchSessionIdentity,
    role: args.role,
    subject: args.subject,
    workspace_alias: workspace.repo,
    workspace_dir: workspace.dir,
    readiness: launchReadiness,
    launcher_transition_plan: prospectiveTransitionPlan,
    app: dispatchApp,
    model: dispatchModel,
    ...(Object.prototype.hasOwnProperty.call(args, "reviewed_sha")
      ? { reviewed_sha: args.reviewed_sha }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(args, "diff_base_sha")
      ? { diff_base_sha: args.diff_base_sha }
      : {})
  });

  if (!launch || launch.accepted !== true) {
    const refusal = launch?.refusal ?? {};
    const backendClassification = classifyLauncherTransitionBackendRefusal({
      schema_version: launch?.schema_version ?? AGENT_DISPATCH_SCHEMA_VERSION,
      accepted: false,
      refusal: {
        code: refusal.code ?? null,
        reason: refusal.reason ?? null,
        detail: refusal.detail ?? null
      }
    });
    const publicBackendDetail = projectPublicBackendDetail(backendClassification, dispatchApp,
      { env: responseEnv });
    const publicBackendCode = publicBackendBlockerCode(backendClassification);
    const settledTransitionPlan = launch?.settled_launcher_transition_plan ??
      launch?.launcher_transition_plan ?? null;
    const managedWkAllocation = launch?.managed_wk_allocation ?? null;
    if (managedWkAllocation !== null) {
      const activeTransitionPlan = launch?.launcher_transition_plan ?? null;
      const settledPlanValid = revalidateLauncherTransitionPlan(settledTransitionPlan, {
        subject: args.subject,
        selection: routingDecision,
        phase: "allocated"
      }) && settledTransitionPlan.identity === prospectiveTransitionPlan.identity;
      const activePlanValid = revalidateLauncherTransitionPlan(activeTransitionPlan, {
        subject: args.subject,
        selection: routingDecision
      }) && activeTransitionPlan.identity === prospectiveTransitionPlan.identity;
      let settledReadiness = null;
      try {
        settledReadiness = settledPlanValid
          ? projectPublicReadiness(readiness, settledTransitionPlan, managedWkAllocation)
          : null;
      } catch {
        settledReadiness = null;
      }
      if (!activePlanValid || settledReadiness?.managed_wk_allocation !== managedWkAllocation) {
        return jsonContent(buildTransitionRefusal({
          readinessSource: readiness,
          failure: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
          blockerCode: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED.code,
          reason: "managed_wk_settled_refusal_projection_diverged",
          detail: publicBackendDetail,
          previousPlan: prospectiveTransitionPlan
        }));
      }

      return jsonContent(projectCompactDispatchRefusal(buildBlockedDispatchResult({
        blockerCode: publicBackendCode,
        reason: backendClassification.cause.code,
        detail: publicBackendDetail,
        nextAction: backendClassification.next_action,
        refusal: backendRefusalCarrier(backendClassification, {
          role: args.role,
          subject: args.subject,
          requestSchemaAuthority
        })
      }), { readiness: settledReadiness, plan: settledTransitionPlan, source: readiness }));
    }

    const baseSelection = await decideBaseSelectionRecovery({
      classification: backendClassification,
      launch,
      role: args.role,
      subject: args.subject,
      workspace,
      requestSchemaAuthority,
      reassessmentAvailable,
      buildMissingBaseGuidance
    });
    if (baseSelection?.kind === "reassess") {
      return Object.freeze({ reassess: baseSelection.evidence });
    }
    return jsonContent(buildTransitionRefusal({
      readinessSource: readiness,
      failure: backendClassification.transition_failure,
      blockerCode: publicBackendCode,
      reason: backendClassification.cause.code,
      detail: publicBackendDetail,
      nextAction: backendClassification.next_action,
      previousPlan: prospectiveTransitionPlan,
      refusal: baseSelection?.refusal ?? backendRefusalCarrier(backendClassification, {
        role: args.role,
        subject: args.subject,
        requestSchemaAuthority
      })
    }));
  }

  const acceptedTransitionPlan = launch.launcher_transition_plan ?? null;
  if (!revalidateLauncherTransitionPlan(acceptedTransitionPlan, {
    subject: args.subject,
    selection: routingDecision,
    phase: "allocated"
  }) || acceptedTransitionPlan.identity !== prospectiveTransitionPlan.identity) {
    return jsonContent(buildTransitionRefusal({
      readinessSource: readiness,
      failure: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
      blockerCode: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED.code,
      reason: "launcher_transition_projection_diverged",
      detail: { admission: admissionFacts },
      previousPlan: prospectiveTransitionPlan
    }));
  }

  const managedWkAllocation = launch.managed_wk_allocation ?? null;
  const acceptedReadiness = managedWkAllocation === null
    ? launchReadiness
    : projectPublicReadiness(readiness, acceptedTransitionPlan, managedWkAllocation);
  if (managedWkAllocation !== null &&
      acceptedReadiness?.managed_wk_allocation !== managedWkAllocation) {
    return jsonContent(buildTransitionRefusal({
      readinessSource: readiness,
      failure: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
      blockerCode: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED.code,
      reason: "managed_wk_allocation_projection_diverged",
      detail: { admission: admissionFacts },
      previousPlan: prospectiveTransitionPlan
    }));
  }
  return jsonContent(await projectAcceptedLaunch({
    launch, repository: workspace.repo, requestContracts
  }));
}

export { LAUNCHER_TRANSITION_FAILURES };
