import { DISPATCH_BLOCKER_CODES, WK_LANDING_STATUS_TOOL_NAME } from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchMechanicalRefusal,
  buildDispatchToolExceptionDetail,
  DISPATCH_FAILURE_ORIGINALS,
  dispatchRepoResolutionRefusal,
  NO_SUPPORTED_ROUTE_RECOVERY,
  ownedNoRouteRecovery,
  producerEstablishedRecovery,
  projectRecordedFailureDetail
} from "../dispatch-tool-helpers.mjs";

const observedCause = (value) => projectRecordedFailureDetail(value,
  { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION });

function landingRefusal({ code, decidingFacts, observedFacts, carried = null,
  recovery = NO_SUPPORTED_ROUTE_RECOVERY }) {
  return buildDispatchMechanicalRefusal({
    code,
    decidingFacts,
    observedFacts,
    noSupportedRoute: true,
    recovery,
    route: WK_LANDING_STATUS_TOOL_NAME,
    carried
  });
}

const MISSING_OBSERVER_RECOVERY = ownedNoRouteRecovery({
  responsibleActor: "operator",
  prerequisite: "this server composes the launcher-owned landing observer",
  missingComponent: "wk_landing_status_adapter",
  operatorAction: "start this wiki-mcp server through the launcher with WIKI_MCP_WORKSPACE_DIR " +
    "bound to the canonical main repository and a launch backend configured, so the server " +
    "composes the landing observer",
  retryCondition: `re-issue ${WK_LANDING_STATUS_TOOL_NAME} for the same assigned_unit once the ` +
    "server composes the observer"
});

function observerRefusalRecovery(observerRefusal) {
  const category = typeof observerRefusal?.category === "string"
    ? observerRefusal.category : "unclassified";
  const reason = typeof observerRefusal?.detail?.reason === "string"
    ? observerRefusal.detail.reason : "no reason";
  return producerEstablishedRecovery(observerRefusal?.detail, {
    unchanged: `the landing observer's ${category} refusal (${reason}) no longer holds`,
    retryCondition: "repeating the read against unchanged facts observes the same refusal; " +
      `re-issue ${WK_LANDING_STATUS_TOOL_NAME} only after the prerequisite holds`,
    unestablished: "the observer's typed refusal does not establish who corrects it; its category " +
      "and detail are published unchanged, and repeating the read against unchanged facts " +
      "observes the same refusal"
  });
}

const description = "Read-only landing status of one WK's existing handoff: awaiting human landing, landed with its authenticated landed-publication carrier, contradictory, or unavailable, with the original cause. Never publishes, merges or reconciles. Orchestrator/operator only.";

export function registerLandingStatusRoute(ctx) {
  const { registerTool, workspaceRepos, z, jsonContent, resolveWorkspaceRepo, invokeWkLandingStatusAdapter } = ctx;
  registerTool(WK_LANDING_STATUS_TOOL_NAME, {
    description,
    inputSchema: z.object({ repo: z.string().optional(), assigned_unit: z.string() }).strict()
  }, async (args) => {
    try {
      const assignedUnit = args?.assigned_unit;
      if (typeof assignedUnit !== "string" || !/^WK-\d{4}$/u.test(assignedUnit)) {
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
          reason: "wk_landing_status_subject_invalid",
          detail: { assigned_unit: typeof assignedUnit === "string" ? assignedUnit : null },
          refusal: landingRefusal({
            code: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
            decidingFacts: [{ field: "landing_status.assigned_unit_wellformed", value: false }],
            observedFacts: { "landing_status.assigned_unit_wellformed": false },
            recovery: ownedNoRouteRecovery({
              responsibleActor: "caller_retry",
              prerequisite: "assigned_unit names one WK record (WK-####)",
              retryCondition: `re-issue ${WK_LANDING_STATUS_TOOL_NAME} with the intended WK id`
            })
          })
        }));
      }
      resolveWorkspaceRepo(workspaceRepos, args?.repo);
      const outcome = typeof invokeWkLandingStatusAdapter === "function"
        ? await invokeWkLandingStatusAdapter(assignedUnit)
        : null;
      if (outcome?.accepted === true) {

        const landing = outcome.landing;
        return jsonContent({
          schema_version: "workspace-wk-landing-status.v1",
          assigned_unit: assignedUnit,
          landing: landing !== null && typeof landing === "object" && landing.cause !== undefined &&
            landing.cause !== null
            ? { ...landing, cause: observedCause(landing.cause) } : landing,
          blocker: null
        });
      }
      const missing = outcome === null;
      const observerRefusal = missing ? null : outcome.refusal ?? null;
      const { detail: observerDetail = null, ...observerIdentity } =
        observerRefusal !== null && typeof observerRefusal === "object" ? observerRefusal : {};
      return jsonContent(buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
        reason: missing ? "wk_landing_status_observer_unavailable" : "wk_landing_status_refused",
        detail: missing ? { missing_backend: "wk_landing_status_adapter" }
          : { refusal: observerRefusal === null ? null
            : { ...observerIdentity, ...(observerDetail === null ? {}
              : { detail: observedCause(observerDetail) }) } },
        refusal: landingRefusal({
          code: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
          decidingFacts: [{ field: "landing_status.observer_available", value: !missing }],
          observedFacts: { "landing_status.observer_available": !missing },
          carried: missing ? null
            : { landing_observer_refusal: observerRefusal === null ? null : observerIdentity },
          recovery: missing ? MISSING_OBSERVER_RECOVERY : observerRefusalRecovery(observerRefusal)
        })
      }));
    } catch (error) {

      const repoRefusal = dispatchRepoResolutionRefusal(WK_LANDING_STATUS_TOOL_NAME, error);
      if (repoRefusal !== null) return jsonContent(buildBlockedDispatchResult(repoRefusal));
      return jsonContent(buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
        reason: "dispatch_tool_exception",

        detail: buildDispatchToolExceptionDetail(WK_LANDING_STATUS_TOOL_NAME, error,
          { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION }),
        refusal: landingRefusal({
          code: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
          decidingFacts: [{ field: "landing_status.route_completed", value: false }],
          observedFacts: { "landing_status.route_completed": false }
        })
      }));
    }
  });
}
