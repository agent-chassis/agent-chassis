import { DISPATCH_BLOCKER_CODES } from "../dispatch-tool-constants.mjs";
import { buildBlockedDispatchResult, buildDispatchToolExceptionDetail } from "../dispatch-tool-helpers.mjs";

const description = "Request exact committed-slice integration as an orchestrator continuation. A slice with no remaining tree delta succeeds idempotently with empty_delivery:true and leaves the WK ref unchanged even when its tip is a proper ancestor, its worktree is absent, or lifecycle/review evidence is absent or ambiguous. Findings-only reviewer and redteam results are append-only advisory evidence with no admission or veto authority; clean output cannot authorize and findings cannot prohibit this operation. The orchestrator may accept, reject, or defer individual retained findings, but those dispositions are request facts, not authorization. CCE alone owns any configured organization-policy decision. Paid-tier presence by itself configures no gate and implies no decision. With no configured gate the server proceeds on DEC-0133 free substrate and reports a non-audit posture; with a configured gate, a missing, unavailable, malformed, unratified, denied, or target-mismatched CCE decision fails closed. Input is closed to repo alias, canonical slice subject, and advisory dispositions; refs, SHAs, receipts, review results, policy verdicts, CCE attestations, liveness, and other authority carriers are rejected. The server re-derives the exact target and performs CAS-safe idempotent integration exactly once.";

export function registerCommittedSliceIntegrationRoute(ctx) {
  const {
    registerTool, workspaceRepos, z, jsonContent, resolveWorkspaceRepo, dispatchBackend,
    committedSliceIntegrationToolName, callerNodeEngineAuthorityFields,
    callerCommittedSliceAuthorityFields, callerCcePolicyAuthorityFields
  } = ctx;
  const authorityFields = [
    ...callerNodeEngineAuthorityFields,
    ...callerCommittedSliceAuthorityFields,
    ...callerCcePolicyAuthorityFields
  ];
  registerTool(committedSliceIntegrationToolName, {
    description,
    inputSchema: z.object({
      repo: z.string().optional(), subject: z.string(),
      dispositions: z.array(z.object({
        review_run_id: z.string(), finding_id: z.string(),
        disposition: z.enum(["accept", "reject", "defer"])
      }).strict()).optional(),
      ...Object.fromEntries(authorityFields.map((field) => [field, z.unknown().optional()]))
    }).strict()
  }, async (args) => {
    try {
      const refusedFields = authorityFields.filter((field) =>
        Object.prototype.hasOwnProperty.call(args ?? {}, field));
      if (refusedFields.length > 0) return jsonContent(buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
        reason: "caller_supplied_integration_authority",
        detail: { refused_fields: refusedFields }
      }));
      if (typeof args?.subject !== "string" || !/^WK-\d{4}#SLICE-\d{3}$/u.test(args.subject)) {
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
          reason: "committed_slice_integration_subject_invalid",
          detail: { subject: typeof args?.subject === "string" ? args.subject : null }
        }));
      }
      resolveWorkspaceRepo(workspaceRepos, args?.repo);
      if (typeof dispatchBackend?.requestCommittedSliceIntegration !== "function") {
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
          reason: "committed_slice_integration_backend_unavailable",
          detail: { missing_backend: "requestCommittedSliceIntegration" }
        }));
      }
      const result = await dispatchBackend.requestCommittedSliceIntegration({
        subject: args.subject, dispositions: args.dispositions
      });
      if (result?.integrated === true) return jsonContent({
        schema_version: "workspace-integrate-committed-slice.v1", accepted: true,
        subject: args.subject, integration: result, blocker: null
      });
      const refusal = result?.refusal ?? null;
      return jsonContent(buildBlockedDispatchResult({
        blockerCode: refusal?.code?.includes("unavailable") || refusal?.code?.includes("missing")
          ? DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE : DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
        reason: refusal?.reason ?? result?.reason ?? "committed_slice_integration_refused",
        detail: refusal === null
          ? (typeof result?.code === "string" ? { code: result.code } : null)
          : { cce_policy_refusal: refusal }
      }));
    } catch (error) {
      return jsonContent(buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
        reason: "dispatch_tool_exception",
        detail: buildDispatchToolExceptionDetail(committedSliceIntegrationToolName, error)
      }));
    }
  });
}
