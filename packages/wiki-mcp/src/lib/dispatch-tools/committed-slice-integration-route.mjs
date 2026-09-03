import { DISPATCH_BLOCKER_CODES } from "../dispatch-tool-constants.mjs";
import { buildDispatchToolExceptionDetail } from "../dispatch-tool-helpers.mjs";

const description = "Request exact committed-slice integration as an orchestrator continuation. A zero-delta slice succeeds idempotently with empty_delivery:true and leaves the WK ref unchanged. Reviewer/redteam results are advisory evidence only: clean output does not authorize and findings do not veto. Finding dispositions are request facts, not authority. CCE alone owns any configured organization-policy decision; paid-tier presence alone configures no gate. Without a configured gate the server uses DEC-0133 free-substrate posture. A configured gate fails closed on missing, unavailable, malformed, unratified, denied, or target-mismatched CCE evidence. Input is closed to repo alias, canonical slice subject, and advisory dispositions. The server rejects authority carriers, re-derives the exact target, and performs CAS-safe idempotent integration exactly once.";

function closedAuthorityInputSchema(zod, schema, allowedFields) {
  if (typeof schema?.catchall !== "function" || typeof schema?.superRefine !== "function") {
    if (zod?.ZodIssueCode !== undefined) {
      throw new TypeError("closed authority input schema requires Zod catchall and superRefine");
    }
    return schema;
  }
  return schema.catchall(zod.unknown()).superRefine((value, context) => {
    const unknownKeys = Object.keys(value).filter((key) => !allowedFields.has(key));
    if (unknownKeys.length > 0) {
      context.addIssue({ code: zod.ZodIssueCode.unrecognized_keys, keys: unknownKeys });
    }
  });
}

function projectEvidenceCorrelation(evidence) {
  if (evidence === null || typeof evidence !== "object") return null;
  const reviews = Array.isArray(evidence.reviews) ? evidence.reviews : [];
  const findingCount = reviews.reduce((total, review) => {
    const count = review?.finding_counts?.total;
    if (Number.isInteger(count) && count >= 0) return total + count;
    return total + (Array.isArray(review?.findings) ? review.findings.length : 0);
  }, 0);

  const digest = reviews.length === 1 &&
      typeof reviews[0]?.structured_result_digest === "string"
    ? reviews[0].structured_result_digest
    : null;
  return {
    structured_result_digest: digest,
    review_count: reviews.length,
    finding_count: findingCount
  };
}

function projectDispositionSummary(dispositions) {
  if (!Array.isArray(dispositions)) return null;
  const summary = { total: dispositions.length, accept: 0, reject: 0, defer: 0 };
  for (const entry of dispositions) {
    if (entry?.disposition === "accept") summary.accept += 1;
    else if (entry?.disposition === "reject") summary.reject += 1;
    else if (entry?.disposition === "defer") summary.defer += 1;
  }
  return summary;
}

function projectTypedIntegrationBlocker(result, refusal) {

  const classification = refusal?.public_blocker_code ?? refusal?.blocker_code ??
    refusal?.classification?.blocker_code ?? refusal?.classification ??
    result?.public_blocker_code ?? result?.blocker_code ??
    result?.classification?.blocker_code ?? result?.classification;
  const publicBlockerCodes = new Set(Object.values(DISPATCH_BLOCKER_CODES));
  return typeof classification === "string" && publicBlockerCodes.has(classification)
    ? classification
    : DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED;
}

function buildIntegrationRefusalResult({ blockerCode, reason, detail = null }) {
  return {
    schema_version: "workspace-integrate-committed-slice.v2",
    accepted: false,
    blocker: {
      code: blockerCode,
      reason: reason ?? null,
      detail: detail ?? null
    },
    transport: "mcp"
  };
}

function projectIntegrationSuccess(subject, result) {
  const projected = {
    schema_version: "workspace-integrate-committed-slice.v2",
    accepted: true,
    subject,
    outcome: result.outcome ?? (result.integrated === true ? "integrated" : null),
    empty_delivery: result.empty_delivery === true
  };
  if (result.closeout_continuation !== undefined) {
    projected.closeout = result.closeout_continuation;
  }
  const evidence = projectEvidenceCorrelation(result.advisory_review_evidence);
  if (evidence !== null) projected.evidence_correlation = evidence;
  const dispositionSummary = projectDispositionSummary(result.orchestrator_dispositions);
  if (dispositionSummary !== null) projected.disposition_summary = dispositionSummary;
  return projected;
}

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
    inputSchema: closedAuthorityInputSchema(z, z.object({
      repo: z.string().optional(), subject: z.string(),
      dispositions: z.array(z.object({
        review_run_id: z.string(), finding_id: z.string(),
        disposition: z.enum(["accept", "reject", "defer"])
      }).strict()).optional()
    }), new Set([
        "repo", "subject", "dispositions", ...authorityFields
      ]))
  }, async (args) => {
    try {
      const refusedFields = authorityFields.filter((field) =>
        Object.prototype.hasOwnProperty.call(args ?? {}, field));
      if (refusedFields.length > 0) return jsonContent(buildIntegrationRefusalResult({
        blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
        reason: "caller_supplied_integration_authority",
        detail: { refused_fields: refusedFields }
      }));
      if (typeof args?.subject !== "string" || !/^WK-\d{4}#SLICE-\d{3}$/u.test(args.subject)) {
        return jsonContent(buildIntegrationRefusalResult({
          blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
          reason: "committed_slice_integration_subject_invalid",
          detail: { subject: typeof args?.subject === "string" ? args.subject : null }
        }));
      }
      resolveWorkspaceRepo(workspaceRepos, args?.repo);
      if (typeof dispatchBackend?.requestCommittedSliceIntegration !== "function") {
        return jsonContent(buildIntegrationRefusalResult({
          blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
          reason: "committed_slice_integration_backend_unavailable",
          detail: { missing_backend: "requestCommittedSliceIntegration" }
        }));
      }
      const result = await dispatchBackend.requestCommittedSliceIntegration({
        subject: args.subject, dispositions: args.dispositions
      });
      if (result?.integrated === true) return jsonContent(
        projectIntegrationSuccess(args.subject, result)
      );
      const refusal = result?.refusal ?? null;
      const refusalCode = refusal?.code ?? result?.code;
      return jsonContent(buildIntegrationRefusalResult({
        blockerCode: projectTypedIntegrationBlocker(result, refusal),
        reason: refusal?.reason ?? result?.reason ?? "committed_slice_integration_refused",
        detail: refusal === null
          ? (typeof refusalCode === "string" ? { code: refusalCode } : null)
          : {
              ...(typeof refusalCode === "string" ? { code: refusalCode } : {}),
              ...(refusal.detail === null || refusal.detail === undefined
                ? {} : { detail: refusal.detail })
            }
      }));
    } catch (error) {
      return jsonContent(buildIntegrationRefusalResult({
        blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
        reason: "dispatch_tool_exception",
        detail: buildDispatchToolExceptionDetail(committedSliceIntegrationToolName, error)
      }));
    }
  });
}
