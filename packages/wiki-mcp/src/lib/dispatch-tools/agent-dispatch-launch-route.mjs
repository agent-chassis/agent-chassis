

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
import { buildBlockedDispatchResult } from "../dispatch-tool-helpers.mjs";
import { projectPublicFinalResult } from "../dispatch-final-result-projection.mjs";
import {
  backendRefusalCarrier,
  projectPublicBackendDetail,
  publicBackendBlockerCode
} from "./agent-dispatch-refusal-projection.mjs";
import { projectBoundedExactPolicyPayloadIssueReadiness } from
  "./agent-dispatch-cce-admission.mjs";
import { decideBaseSelectionRecovery } from "./dispatch-base-selection-guidance.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

const RUN_STATUS_TOOL_NAME = "workspace_agent_run_status";

async function advisoryRunStatusCall({ requestContracts, repository, launch }) {
  const contract = requestContracts?.contractFor?.(RUN_STATUS_TOOL_NAME) ?? null;
  if (contract === null || typeof launch?.subject !== "string" || typeof launch?.run_id !== "string") {
    return null;
  }
  const args = { repo: repository, subject: launch.subject, attempt_id: launch.run_id };
  return await contract.acceptsArguments(args) === true
    ? buildNextCall({ tool: RUN_STATUS_TOOL_NAME, arguments: args, recommended: true })
    : null;
}

const DISPATCH_LAUNCH_BACKEND_REASON = "launch_backend_unavailable";
const DISPATCH_LAUNCH_BACKEND_DETAIL = Object.freeze({
  missing_backend: "workspace_agent_run_lifecycle",
  intended_owner: "WK-0526#launcher-admission-wiring",
  description:
    "No launcher-side update seam is wired to advance workspace_agent_dispatch monitor handles from pending_launch through launching/running/terminal. Dispatch fails closed at admission so callers see a stable structured blocker instead of an indefinitely pending monitor handle. A separate WK must deliver the launch backend; agents must not work around this with wrapper, shell, env, bwrap, temp worktree, or graph-impact side-channel launch."
});

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
  requestContracts = null
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
    return jsonContent({
      ...launch,
      schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
      transport: "mcp",
      subject_kind: subjectKind
    });
  }
  const statusCall = await advisoryRunStatusCall({ requestContracts, repository: workspace.repo, launch });
  return jsonContent({
    ...launch,
    schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
    transport: "mcp",
    subject_kind: subjectKind,
    ...(Object.hasOwn(launch, "final_result")
      ? { final_result: projectPublicFinalResult(launch.final_result) }
      : {}),
    blocker: null,
    ...(statusCall === null ? {} : { next_calls: [statusCall] })
  });
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
  responseEnv = process.env
}) {
  const admissionDetail = {
    role: args.role,
    subject: args.subject,
    subject_kind: subjectKind,
    readiness: readiness
      ? {
          decision_code: readiness.decision_code,
          dispatchable: readiness.dispatchable,
          record_id: readiness.record_id ?? null,
          unit: readiness.unit ?? null
        }
      : null
  };

  if (!dispatchBackend) {
    return jsonContent(buildTransitionRefusal({
      readinessSource: readiness,
      failure: LAUNCHER_TRANSITION_FAILURES.RUNTIME_BACKEND_UNAVAILABLE,
      blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
      reason: DISPATCH_LAUNCH_BACKEND_REASON,
      detail: { ...DISPATCH_LAUNCH_BACKEND_DETAIL, admission: admissionDetail }
    }));
  }

  const routingDecision = resolveTransitionSelection();
  if (routingDecision?.ok !== true) {
    return jsonContent(buildTransitionRefusal({
      readinessSource: readiness,
      failure: LAUNCHER_TRANSITION_FAILURES.PROSPECTIVE_LIFECYCLE_UNAVAILABLE,

      blockerCode: LAUNCHER_TRANSITION_FAILURES.PROSPECTIVE_LIFECYCLE_UNAVAILABLE.code,
      reason: routingDecision?.reason ?? "launcher_transition_selection_unavailable",
      detail: { admission: admissionDetail, routing: routingDecision ?? null }
    }));
  }

  const prospectiveTransitionPlan = createProspectiveLauncherTransitionPlan({
    subject: args.subject,
    selection: routingDecision,
    readiness: projectBoundedExactPolicyPayloadIssueReadiness(readiness),
    findingsRouteAdmission: null
  });
  admissionDetail.launcher_transition_plan = prospectiveTransitionPlan;
  if (admissionDetail.readiness !== null) {
    admissionDetail.readiness = Object.freeze({
      ...admissionDetail.readiness,
      launcher_transition_plan: prospectiveTransitionPlan
    });
  }

  const launch = await dispatchBackend.startLaunch({
    caller_session_id: dispatchSessionIdentity,
    role: args.role,
    subject: args.subject,
    workspace_alias: workspace.repo,
    workspace_dir: workspace.dir,
    readiness: admissionDetail.readiness,
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
      return jsonContent(Object.freeze({
        ...buildBlockedDispatchResult({
          blockerCode: publicBackendCode,
          reason: backendClassification.cause.code,
          detail: publicBackendDetail,
          nextAction: backendClassification.next_action,
          refusal: backendRefusalCarrier(backendClassification, {
            role: args.role,
            subject: args.subject
          })
        }),
        run_id: null,
        monitor_handle: null,

        readiness: settledReadiness,
        ...(settledReadiness.launcher_transition_plan === activeTransitionPlan
          ? {}
          : { launcher_transition_plan: activeTransitionPlan }),
        ...(typeof launch?.review_dispatch_id === "string"
          ? { review_dispatch_id: launch.review_dispatch_id }
          : {}),
        ...(typeof launch?.attempt_id === "string" ? { attempt_id: launch.attempt_id } : {}),
        ...(typeof launch?.transition_id === "string"
          ? { transition_id: launch.transition_id }
          : {})
      }));
    }

    const baseSelection = await decideBaseSelectionRecovery({
      classification: backendClassification,
      launch,
      role: args.role,
      subject: args.subject,
      workspace,
      requestSchemaAuthority,
      reassessmentAvailable
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
        subject: args.subject
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
      detail: { admission: admissionDetail },
      previousPlan: prospectiveTransitionPlan
    }));
  }
  const managedWkAllocation = launch.managed_wk_allocation ?? null;
  const acceptedReadiness = managedWkAllocation === null
    ? admissionDetail.readiness
    : projectPublicReadiness(readiness, acceptedTransitionPlan, managedWkAllocation);
  if (managedWkAllocation !== null &&
      acceptedReadiness?.managed_wk_allocation !== managedWkAllocation) {
    return jsonContent(buildTransitionRefusal({
      readinessSource: readiness,
      failure: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
      blockerCode: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED.code,
      reason: "managed_wk_allocation_projection_diverged",
      detail: { admission: admissionDetail },
      previousPlan: prospectiveTransitionPlan
    }));
  }
  return jsonContent({
    schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
    accepted: true,
    transport: "mcp",
    run_id: launch.run_id,
    monitor_handle: launch.monitor_handle,
    app: launch.app ?? dispatchApp,
    model: launch.model ?? dispatchModel ?? null,
    backend: launch.backend ?? null,
    role: launch.role,
    subject: launch.subject,
    subject_kind: subjectKind,
    status: launch.status,
    terminal: launch.terminal,
    started_at: launch.started_at,
    updated_at: launch.updated_at,
    ...(launch.review_result ? { review_result: launch.review_result } : {}),
    readiness: acceptedReadiness,
    ...(typeof launch.review_dispatch_id === "string"
      ? { review_dispatch_id: launch.review_dispatch_id }
      : {}),
    ...(typeof launch.attempt_id === "string" ? { attempt_id: launch.attempt_id } : {}),
    ...(typeof launch.transition_id === "string" ? { transition_id: launch.transition_id } : {}),
    ...(launch.resumed === true ? { resumed: true } : {}),
    ...(launch.attempt_lineage_resolution === undefined
      ? {}
      : { attempt_lineage_resolution: launch.attempt_lineage_resolution }),
    ...(acceptedReadiness?.launcher_transition_plan === acceptedTransitionPlan
      ? {}
      : { launcher_transition_plan: acceptedTransitionPlan }),
    final_result: projectPublicFinalResult(launch.final_result ?? null),
    blocker: null
  });
}

export { LAUNCHER_TRANSITION_FAILURES };
