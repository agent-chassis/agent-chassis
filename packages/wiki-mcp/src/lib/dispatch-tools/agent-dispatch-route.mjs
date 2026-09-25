

import { LAUNCHER_DURABLE_STATE_CODES } from
  "@agent-chassis/agent-launch-core/src/lib/durable-runtime-state.mjs";
import { isRuntimeBlockerCode } from
  "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  AGENT_DISPATCH_TOOL_NAME,
  DISPATCH_BLOCKER_CODES
} from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchMechanicalRefusal,
  buildDispatchToolExceptionDetail,
  loadReviewerSubjectAdmissionContext,
  NO_SUPPORTED_ROUTE_RECOVERY,
  bindActiveRegisteredToolNames,
  requestSchemaAuthorityForRegistration
} from "../dispatch-tool-helpers.mjs";
import {
  CALLER_CCE_POLICY_AUTHORITY_FIELDS,
  CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS,
  CALLER_NODE_ENGINE_AUTHORITY_FIELDS,
  CALLER_TRANSITION_PLAN_AUTHORITY_FIELDS,
  admitAgentDispatchRequest
} from "./agent-dispatch-request-admission.mjs";
import {
  buildTransitionRefusal,
  callerSuppliedAuthorityRefusal,
  projectPublicReadiness,
  readinessFailure,
  routeExceptionRefusal
} from "./agent-dispatch-refusal-projection.mjs";
import {
  deriveAgentDispatchRole,
  loadDispatchSubject
} from "@agent-chassis/wiki-core/src/operations/validate-dispatch.mjs";
import { AGENT_DISPATCH_ROLE_VALUES } from "../dispatch-tool-constants.mjs";
import { orchestrateAgentDispatchReadiness } from "./agent-dispatch-readiness.mjs";
import { agentDispatchSelectionShape } from "./agent-dispatch-selection-contract.mjs";
import {
  LAUNCHER_TRANSITION_FAILURES,
  executeAdvisoryReviewDispatch,
  executeAgentDispatchLaunch
} from "./agent-dispatch-launch-route.mjs";

export const CALLER_REVIEW_AUTHORITY_FIELD_REASONS = Object.freeze({
  terminal_candidate: "caller_supplied_committed_slice_authority",
  reviewer_launch_identity: "caller_supplied_identity_carrier"
});

export const CALLER_ASSIGNMENT_AUTHORITY_FIELDS = Object.freeze([
  "prompt", "request", "argv", "env"
]);

function refuseCallerAssignmentAuthority(args, jsonContent) {
  const fields = CALLER_ASSIGNMENT_AUTHORITY_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(args ?? {}, field));
  if (fields.length === 0) return null;
  return jsonContent(buildBlockedDispatchResult({
    blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
    reason: "caller_supplied_assignment_authority",
    detail: { refused_fields: fields,
      assignment_source: "canonical unit and authenticated launcher facts" },
    refusal: callerSuppliedAuthorityRefusal({
      role: args?.role,
      subject: args?.subject,
      refusedFields: fields
    })
  }));
}

function refuseCallerReviewAuthority(args, jsonContent) {
  const fields = Object.keys(CALLER_REVIEW_AUTHORITY_FIELD_REASONS)
    .filter((field) => Object.prototype.hasOwnProperty.call(args ?? {}, field));
  if (fields.length === 0) return null;
  return jsonContent(buildBlockedDispatchResult({
    blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
    reason: CALLER_REVIEW_AUTHORITY_FIELD_REASONS[fields[0]],
    detail: { refused_fields: fields },
    refusal: callerSuppliedAuthorityRefusal({
      role: args?.role,
      subject: args?.subject,
      refusedFields: fields
    })
  }));
}

async function startedAgentDispatchSelection({ args, workspaceRepos, resolveWorkspaceRepo,
  jsonContent }) {
  if (args?.role !== undefined) return { args };
  const subjectAddress = args?.subject;
  if (typeof subjectAddress !== "string" || subjectAddress.trim().length === 0) {
    return { args };
  }
  let workspace;
  try {
    workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
  } catch {

    return { args };
  }
  const subject = await loadDispatchSubject({ dir: workspace.dir, unitAddress: subjectAddress });
  const derived = deriveAgentDispatchRole(subject, subjectAddress);
  if (derived.refusal) {
    return {
      response: jsonContent(buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
        reason: "canonical_dispatch_intent_unresolved",
        detail: { subject: subjectAddress,
          intended_agent_role: subject?.dispatch_intent?.intended_agent_role ?? null,
          readiness: derived.refusal },
        refusal: buildDispatchMechanicalRefusal({
          code: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
          decidingFacts: [
            { field: "dispatch.canonical_role_derived", value: false },
            { field: "dispatch.subject", value: subjectAddress }
          ],
          observedFacts: {
            "dispatch.canonical_role_derived": false,
            "dispatch.subject": subjectAddress
          },

          noSupportedRoute: true,
          recovery: NO_SUPPORTED_ROUTE_RECOVERY,
          route: AGENT_DISPATCH_TOOL_NAME
        })
      }))
    };
  }
  return { args: { ...args, role: derived.role } };
}

export function registerAgentDispatchRoute({
  registerTool,
  registeredToolNames,
  workspaceRepos,
  z,
  jsonContent,
  resolveWorkspaceRepo,
  dispatchBackend,
  dispatchSessionIdentity,
  launcherConfirmedNoCceAuthority,
  validateDispatch,
  validateLaunchIntent,
  revalidatePrivateHandoff,
  generateGraphImpactEvidence,
  refreshAdmissionEvidence,
  isPaidTier
}) {
  const requestSchemaAuthority = requestSchemaAuthorityForRegistration(registerTool);
  bindActiveRegisteredToolNames(registerTool, registeredToolNames);

  async function runDispatchPipeline(args, { jsonContent, reassessmentAvailable }) {
    const started = await startedAgentDispatchSelection({
      args, workspaceRepos, resolveWorkspaceRepo, jsonContent
    });
    if (started.response) return started.response;
    args = started.args;
    const admission = admitAgentDispatchRequest({
      args,
      workspaceRepos,
      resolveWorkspaceRepo,
      dispatchBackend,
      jsonContent,
      requestSchemaAuthority
    });
    if (admission.response) return admission.response;
    const {
      workspace,
      subjectKind,
      dispatchApp,
      dispatchModel,
      resolveTransitionSelection
    } = admission;

    if (args.role === "reviewer" || args.role === "redteam") {
      return await executeAdvisoryReviewDispatch({
        args,
        workspace,
        subjectKind,
        dispatchApp,
        dispatchModel,
        dispatchBackend,
        dispatchSessionIdentity,
        jsonContent
      });
    }

    const projectTransitionRefusal = (input) => buildTransitionRefusal({
      args,
      resolveTransitionSelection,
      projectPublicReadiness,
      ...input
    });
    const classifyReadinessFailure = (source) =>
      readinessFailure(source, LAUNCHER_TRANSITION_FAILURES);

    const readinessResult = await orchestrateAgentDispatchReadiness({
      args,
      subjectKind,
      workspace,
      dispatchBackend,
      launcherConfirmedNoCceAuthority,
      isPaidTier,
      validateDispatch,
      validateLaunchIntent,
      revalidatePrivateHandoff,
      generateGraphImpactEvidence,
      refreshAdmissionEvidence,
      loadReviewerSubjectAdmissionContext,
      buildTransitionRefusal: projectTransitionRefusal,
      readinessFailure: classifyReadinessFailure,
      launcherTransitionFailures: LAUNCHER_TRANSITION_FAILURES,
      jsonContent
    });
    if (readinessResult.response) return readinessResult.response;

    return await executeAgentDispatchLaunch({
      args,
      workspace,
      subjectKind,
      readiness: readinessResult.readiness,
      dispatchApp,
      dispatchModel,
      resolveTransitionSelection,
      dispatchBackend,
      dispatchSessionIdentity,
      buildTransitionRefusal: projectTransitionRefusal,
      projectPublicReadiness,
      jsonContent,
      requestSchemaAuthority,
      reassessmentAvailable
    });
  }

  registerTool(
    AGENT_DISPATCH_TOOL_NAME,
    {
      description:
        "Start a canonical unit, or dispatch a reviewer or redteam by canonical subject. Omit role to start the unit as the agent its dispatch_intent declares; the system resolves the task, scope, acceptance, validation, material and runtime from that unit, so no caller prompt, request, argv or env is accepted. Managed workers require an explicit existing canonical implementation slice, even for a one-slice WK; dispatch never creates or selects one. Its root WK must select base_branch before first allocation (frozen after); if missing, dispatch refuses with read-only field guidance. Reviews use empty write_scope and the same dispatcher; no external reviewer, shell, wrapper or alternate transport. backend_unavailable fails closed. Supply an already-known WK or slice plus diff_base_sha/reviewed_sha for exact review; no WK is inferred from a SHA. Implementation requires complete or opted-out proof posture; CCE policy remains separate. Reviews can precede authoring. Caller identity/policy carriers refuse.",
      inputSchema: {
        ...agentDispatchSelectionShape(z),

        role: z.enum(AGENT_DISPATCH_ROLE_VALUES).optional().describe(
          "Optional. Omitted, the dispatch target is derived from the canonical unit's " +
          "dispatch_intent.intended_agent_role."
        ),
        reviewed_sha: z.string().optional(),
        diff_base_sha: z.string().optional(),
        env: z.record(z.unknown()).optional(),
        request: z.record(z.unknown()).optional(),
        prompt: z.record(z.unknown()).optional(),
        argv: z.record(z.unknown()).optional(),
        claimed_identity: z.object({ role: z.string().optional() }).optional(),
        ...Object.fromEntries([
          ...Object.keys(CALLER_REVIEW_AUTHORITY_FIELD_REASONS),
          ...CALLER_NODE_ENGINE_AUTHORITY_FIELDS,
          ...CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS,
          ...CALLER_CCE_POLICY_AUTHORITY_FIELDS,
          ...CALLER_TRANSITION_PLAN_AUTHORITY_FIELDS
        ].map((field) => [field, z.unknown().optional()]))
      }
    },
    async (args) => {
      try {
        const reviewAuthorityRefusal = refuseCallerReviewAuthority(args, jsonContent);
        if (reviewAuthorityRefusal !== null) return reviewAuthorityRefusal;
        const assignmentAuthorityRefusal = refuseCallerAssignmentAuthority(args, jsonContent);
        if (assignmentAuthorityRefusal !== null) return assignmentAuthorityRefusal;

        const first = await runDispatchPipeline(args, {
          jsonContent, reassessmentAvailable: true
        });
        if (first?.reassess === undefined) return first;
        const reassessment = first.reassess;
        const second = await runDispatchPipeline(args, {
          jsonContent: (value) => jsonContent({
            ...value, base_selection_reassessment: reassessment
          }),
          reassessmentAvailable: false
        });
        if (second?.reassess !== undefined) {
          throw new TypeError("base-selection reassessment is single-use");
        }
        return second;
      } catch (error) {
        if (error?.code === LAUNCHER_DURABLE_STATE_CODES.ROOT_UNWRITABLE &&
            isRuntimeBlockerCode(error.code)) {
          return jsonContent(buildBlockedDispatchResult({
            blockerCode: error.code,
            reason: error.code,
            detail: { tool: AGENT_DISPATCH_TOOL_NAME, cause_code: error.code },
            refusal: buildDispatchMechanicalRefusal({
              code: error.code,
              decidingFacts: [
                { field: "dispatch.backend_accepted", value: false },
                { field: "dispatch.backend_cause", value: error.code }
              ],
              observedFacts: {
                "dispatch.backend_accepted": false,
                "dispatch.backend_cause": error.code
              },
              noSupportedRoute: true,
              recovery: NO_SUPPORTED_ROUTE_RECOVERY,
              route: AGENT_DISPATCH_TOOL_NAME
            })
          }));
        }
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
          reason: "dispatch_tool_exception",
          detail: buildDispatchToolExceptionDetail(AGENT_DISPATCH_TOOL_NAME, error),
          refusal: routeExceptionRefusal(AGENT_DISPATCH_TOOL_NAME)
        }));
      }
    }
  );
}
