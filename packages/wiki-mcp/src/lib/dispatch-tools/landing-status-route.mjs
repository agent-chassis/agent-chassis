import { DISPATCH_BLOCKER_CODES, WK_LANDING_STATUS_TOOL_NAME } from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchMechanicalRefusal,
  buildDispatchToolExceptionDetail,
  NO_SUPPORTED_ROUTE_RECOVERY
} from "../dispatch-tool-helpers.mjs";

function landingRefusal({ code, decidingFacts, observedFacts, carried = null }) {
  return buildDispatchMechanicalRefusal({
    code,
    decidingFacts,
    observedFacts,
    noSupportedRoute: true,
    recovery: NO_SUPPORTED_ROUTE_RECOVERY,
    route: WK_LANDING_STATUS_TOOL_NAME,
    carried
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
            observedFacts: { "landing_status.assigned_unit_wellformed": false }
          })
        }));
      }
      resolveWorkspaceRepo(workspaceRepos, args?.repo);
      const outcome = typeof invokeWkLandingStatusAdapter === "function"
        ? await invokeWkLandingStatusAdapter(assignedUnit)
        : null;
      if (outcome?.accepted === true) {
        return jsonContent({
          schema_version: "workspace-wk-landing-status.v1",
          assigned_unit: assignedUnit,
          landing: outcome.landing,
          blocker: null
        });
      }
      const missing = outcome === null;
      return jsonContent(buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
        reason: missing ? "wk_landing_status_observer_unavailable" : "wk_landing_status_refused",
        detail: missing ? { missing_backend: "wk_landing_status_adapter" } : { refusal: outcome.refusal ?? null },
        refusal: landingRefusal({
          code: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
          decidingFacts: [{ field: "landing_status.observer_available", value: !missing }],
          observedFacts: { "landing_status.observer_available": !missing },
          carried: missing ? null : { landing_observer_refusal: outcome.refusal ?? null }
        })
      }));
    } catch (error) {
      return jsonContent(buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
        reason: "dispatch_tool_exception",
        detail: buildDispatchToolExceptionDetail(WK_LANDING_STATUS_TOOL_NAME, error),
        refusal: landingRefusal({
          code: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
          decidingFacts: [{ field: "landing_status.route_completed", value: false }],
          observedFacts: { "landing_status.route_completed": false }
        })
      }));
    }
  });
}
