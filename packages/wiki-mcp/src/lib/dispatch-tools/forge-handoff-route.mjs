import { DISPATCH_BLOCKER_CODES, WK_FORGE_HANDOFF_TOOL_NAME } from "../dispatch-tool-constants.mjs";
import { buildBlockedDispatchResult, buildDispatchToolExceptionDetail, mapBackendRefusalToDispatchCode } from "../dispatch-tool-helpers.mjs";
const description = "Request exact terminal-candidate publication through the host forge executor. Reviewer/redteam evidence is advisory: clean output cannot authorize and findings cannot veto. CCE alone decides configured policy; invalid evidence fails closed, while no gate follows DEC-0133 free substrate and reports non-audit. Orchestrator/operator only. Input is closed to a workspace alias and record-level assigned_unit. The server derives C/B/W, candidate-bound record, materialization, remote, branch, and PR. Cold recovery reads only refs/agent-launch/terminal-current-v2/<WK> and accepts only an already-present, directly commit-valued, mechanically authenticated target. An absent fixed ref fails closed with terminal_candidate_recovery_current_ref_absent. Absent-ref construction exists only in the hot post-worker lifecycle, where launcher-bound B/W/contracts exist and absence is the expected-old CAS state. Monitor memory, historical bindings, and legacy candidate refs are irrelevant. Per DEC-0169, landing movement does not invalidate review or block unchanged C; merge readiness belongs to the forge actor and CCE policy. Missing, ambiguous, moved, or inconsistent required Git/object/record/remote facts refuse. Exact branch and PR state recovers without duplication. Credentials and raw process output never enter requests or results.";
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
          detail: { assigned_unit: typeof assignedUnit === "string" ? assignedUnit : null }
        }));
      }
      resolveWorkspaceRepo(workspaceRepos, args?.repo);
      if (typeof invokeWkForgeHandoffAdapter !== "function") {
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
          reason: "wk_forge_handoff_executor_unavailable",
          detail: { missing_backend: "wk_forge_handoff_adapter" }
        }));
      }
      const outcome = await invokeWkForgeHandoffAdapter(assignedUnit);
      if (outcome && outcome.accepted === true) return jsonContent({
        schema_version: "workspace-wk-forge-handoff.v1", assigned_unit: assignedUnit,
        forge_handoff: outcome.forge_handoff, blocker: null });
      const refusal = outcome && typeof outcome.refusal === "object" && outcome.refusal !== null
        ? outcome.refusal : {};
      return jsonContent(buildBlockedDispatchResult({
        blockerCode: mapBackendRefusalToDispatchCode(refusal.code) ??
          DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
        reason: typeof refusal.reason === "string" ? refusal.reason : "wk_forge_handoff_refused",
        detail: refusal.detail ?? (typeof refusal.category === "string" ? { category: refusal.category } : null)
      }));
    } catch (error) {
      return jsonContent(buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
        reason: "dispatch_tool_exception",
        detail: buildDispatchToolExceptionDetail(WK_FORGE_HANDOFF_TOOL_NAME, error)
      }));
    }
  });
}
