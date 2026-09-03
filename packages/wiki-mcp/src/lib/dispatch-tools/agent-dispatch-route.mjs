

import { LAUNCHER_DURABLE_STATE_CODES } from
  "@agent-chassis/agent-launch-core/src/lib/durable-runtime-state.mjs";
import { isRuntimeBlockerCode } from
  "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  AGENT_DISPATCH_ROLE_VALUES,
  AGENT_DISPATCH_TOOL_NAME,
  DISPATCH_BLOCKER_CODES
} from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchMechanicalRefusal,
  buildDispatchToolExceptionDetail,
  loadReviewerSubjectAdmissionContext,
  NO_SUPPORTED_ROUTE_RECOVERY,
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
  projectPublicReadiness,
  readinessFailure,
  routeExceptionRefusal
} from "./agent-dispatch-refusal-projection.mjs";
import { orchestrateAgentDispatchReadiness } from "./agent-dispatch-readiness.mjs";
import {
  LAUNCHER_TRANSITION_FAILURES,
  executeAdvisoryReviewDispatch,
  executeAgentDispatchLaunch
} from "./agent-dispatch-launch-route.mjs";

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
  registerTool(
    AGENT_DISPATCH_TOOL_NAME,
    {
      description:
        "Dispatch a Codex, Claude, or Agy worker, reviewer, or redteam. The normal agent call supplies only `role` and canonical `subject`; reviewer/redteam may add a complete diff_base_sha/reviewed_sha pair to the same request. A commit SHA is a review locator, never the subject. The caller supplies its already-known canonical WK or slice; the server does not infer or search for a WK from a SHA. Reviewer example: {\"role\":\"reviewer\",\"subject\":\"WK-1234#SLICE-005\",\"diff_base_sha\":\"<40-character base commit>\",\"reviewed_sha\":\"<40-character reviewed commit>\"}. The same registered dispatcher performs this read-only review. No external reviewer, shell command, wrapper, alternate transport, terminal candidate, ref creation, attestation append, or provenance repair is required. Launcher-owned configuration selects the app and the role model; typed overrides are never authority. Caller-supplied identity or Node Engine authority fields are rejected, as is caller CCE policy authority. Reviewer/redteam require empty write_scope and return advisory text. Ordinary reviews request no formal attestation; a schema_constrained canonical selected contract derives and publishes one during this result settlement or reports it unavailable. Integration is separate. A missing backend fails closed with backend_unavailable.",
      inputSchema: {
        repo: z.string().optional(),
        app: z.string().optional(),
        model: z.string().optional(),
        role: z.enum(AGENT_DISPATCH_ROLE_VALUES),
        subject: z.string(),
        reviewed_sha: z.string().optional(),
        diff_base_sha: z.string().optional(),
        env: z.record(z.unknown()).optional(),
        request: z.record(z.unknown()).optional(),
        prompt: z.record(z.unknown()).optional(),
        argv: z.record(z.unknown()).optional(),
        claimed_identity: z.object({ role: z.string().optional() }).optional(),
        ...Object.fromEntries([
          ...CALLER_NODE_ENGINE_AUTHORITY_FIELDS,
          ...CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS,
          ...CALLER_CCE_POLICY_AUTHORITY_FIELDS,
          ...CALLER_TRANSITION_PLAN_AUTHORITY_FIELDS
        ].map((field) => [field, z.unknown().optional()]))
      }
    },
    async (args) => {
      try {
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
          jsonContent
        });
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
          blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
          reason: "dispatch_tool_exception",
          detail: buildDispatchToolExceptionDetail(AGENT_DISPATCH_TOOL_NAME, error),
          refusal: routeExceptionRefusal(AGENT_DISPATCH_TOOL_NAME)
        }));
      }
    }
  );
}
