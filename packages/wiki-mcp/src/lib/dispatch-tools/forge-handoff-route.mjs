import { DISPATCH_BLOCKER_CODES, WK_FORGE_HANDOFF_TOOL_NAME } from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchMechanicalRefusal,
  buildDispatchToolExceptionDetail,
  mapBackendRefusalToDispatchCode,
  NO_SUPPORTED_ROUTE_RECOVERY
} from "../dispatch-tool-helpers.mjs";

function forgeRefusal({ code, decidingFacts, observedFacts, carried = null }) {
  return buildDispatchMechanicalRefusal({
    code,
    decidingFacts,
    observedFacts,
    noSupportedRoute: true,
    recovery: NO_SUPPORTED_ROUTE_RECOVERY,
    route: WK_FORGE_HANDOFF_TOOL_NAME,
    carried
  });
}
const description = "Hand off the exact terminal candidate to the configured destination: local, Git delivery, or hosted branch and PR. Server derives refs; retries recover idempotently; never merges. Reviews are advisory; CCE owns policy. Cold recovery requires an authenticated current candidate. Orchestrator/operator only.";
export function registerForgeHandoffRoute(ctx) {
  const { registerTool, workspaceRepos, z, jsonContent, resolveWorkspaceRepo, invokeWkForgeHandoffAdapter } = ctx;
  registerTool(WK_FORGE_HANDOFF_TOOL_NAME, {
    description,
    inputSchema: z.object({ repo: z.string().optional(), assigned_unit: z.string() }).strict()
  }, async (args) => {
    try {
      const assignedUnit = args?.assigned_unit;
      if (typeof assignedUnit !== "string" || !/^WK-\d{4}$/u.test(assignedUnit)) {
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
          reason: "wk_forge_handoff_subject_invalid",
          detail: { assigned_unit: typeof assignedUnit === "string" ? assignedUnit : null },
          refusal: forgeRefusal({
            code: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
            decidingFacts: [{ field: "forge_handoff.assigned_unit_wellformed", value: false }],
            observedFacts: { "forge_handoff.assigned_unit_wellformed": false }
          })
        }));
      }
      resolveWorkspaceRepo(workspaceRepos, args?.repo);
      if (typeof invokeWkForgeHandoffAdapter !== "function") {
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
          reason: "wk_forge_handoff_executor_unavailable",
          detail: { missing_backend: "wk_forge_handoff_adapter" },
          refusal: forgeRefusal({
            code: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
            decidingFacts: [{ field: "forge_handoff.executor_registered", value: false }],
            observedFacts: { "forge_handoff.executor_registered": false }
          })
        }));
      }
      const outcome = await invokeWkForgeHandoffAdapter(assignedUnit);
      if (outcome && outcome.accepted === true) return jsonContent({
        schema_version: "workspace-wk-forge-handoff.v1", assigned_unit: assignedUnit,
        forge_handoff: outcome.forge_handoff, blocker: null });
      const refusal = outcome && typeof outcome.refusal === "object" && outcome.refusal !== null
        ? outcome.refusal : {};

      const publicCode = mapBackendRefusalToDispatchCode(refusal.code);
      return jsonContent(buildBlockedDispatchResult({
        blockerCode: publicCode,
        reason: typeof refusal.reason === "string" ? refusal.reason : "wk_forge_handoff_refused",
        detail: refusal.detail ?? (typeof refusal.category === "string" ? { category: refusal.category } : null),
        refusal: forgeRefusal({
          code: publicCode,
          decidingFacts: [
            { field: "forge_handoff.executor_accepted", value: false },
            { field: "forge_handoff.executor_refusal_category",
              value: typeof refusal.category === "string" ? refusal.category : null }
          ],
          observedFacts: {
            "forge_handoff.executor_accepted": false,
            "forge_handoff.executor_refusal_category":
              typeof refusal.category === "string" ? refusal.category : null
          },

          carried: { forge_executor_refusal: refusal }
        })
      }));
    } catch (error) {
      return jsonContent(buildBlockedDispatchResult({

        blockerCode: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
        reason: "dispatch_tool_exception",
        detail: buildDispatchToolExceptionDetail(WK_FORGE_HANDOFF_TOOL_NAME, error),

        refusal: forgeRefusal({
          code: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
          decidingFacts: [
            { field: "forge_handoff.route_completed", value: false }
          ],
          observedFacts: { "forge_handoff.route_completed": false }
        })
      }));
    }
  });
}
