import {
  projectCommittedSliceIntegrationRefusal,
  resolveCommittedSliceIntegrationRetryFacts
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";
import { COMMITTED_SLICE_SCOPE_CORRECTION_CONDITION } from
  "@agent-chassis/agent-launch-cli/src/lib/committed-slice-review-admission.mjs";
import { getRuntimeBlockerEntry } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { RECOVERY_RESPONSIBLE_ACTORS } from
  "@agent-chassis/wiki-core/src/lib/refusal-recovery-contract.mjs";
import { producerConditionRequiredCorrection } from "../dispatch-post-worker-lifecycle-bindings.mjs";
import { DISPATCH_BLOCKER_CODES } from "../dispatch-tool-constants.mjs";
import {
  buildDispatchMechanicalRefusal,
  buildDispatchToolExceptionDetail,
  dispatchRepoResolutionRefusal,
  ownedNoRouteRecovery,
  projectDispatchFailureDetail
} from "../dispatch-tool-helpers.mjs";

const description = "Integrate an exact committed slice idempotently under CAS; zero delta leaves the WK ref unchanged. Orchestrator continuation. Reviews/dispositions are advisory. Only configured CCE policy gates admission; invalid configured-gate evidence refuses.";

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

function jsonFacts(value) {
  return JSON.parse(JSON.stringify(value));
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

const CCE_POLICY_REFUSED_CODE = "agent_launch.slice_integration.cce_policy_refused.v1";

function projectTypedIntegrationBlocker(result, refusal, authenticated) {
  if (authenticated?.public_blocker_code === CCE_POLICY_REFUSED_CODE) return CCE_POLICY_REFUSED_CODE;

  const classification = refusal?.public_blocker_code ?? refusal?.blocker_code ??
    refusal?.classification?.blocker_code ?? refusal?.classification ??
    result?.public_blocker_code ?? result?.blocker_code ??
    result?.classification?.blocker_code ?? result?.classification;
  const publicBlockerCodes = new Set(Object.values(DISPATCH_BLOCKER_CODES));

  return typeof classification === "string" && publicBlockerCodes.has(classification)
    ? classification
    : DISPATCH_BLOCKER_CODES.SLICE_INTEGRATION_CLASSIFICATION_UNAVAILABLE;
}

function buildIntegrationRefusalResult({ blockerCode, reason, detail = null, refusal = null }) {
  return {
    schema_version: "workspace-integrate-committed-slice.v2",
    accepted: false,
    blocker: {
      code: blockerCode,
      reason: reason ?? null,
      detail: detail ?? null
    },
    transport: "mcp",
    ...(refusal === null ? {} : { refusal })
  };
}

function integrationRefusal(route, { code, facts, recovery, carried = null }) {
  return buildDispatchMechanicalRefusal({
    code,
    decidingFacts: facts.map(([field, value]) => ({ field, value })),
    observedFacts: Object.fromEntries(facts),
    noSupportedRoute: true,
    recovery,
    route,
    carried
  });
}

function producerCorrectionRecovery(route, retryFacts) {
  const condition = retryFacts.correction_condition;
  const retryCondition = `re-issue ${route} for the same subject only after the condition ` +
    "changes; an unchanged request refuses identically";
  const required = producerConditionRequiredCorrection(condition);
  if (required?.kind === "serving_runtime_prerequisite") {
    return ownedNoRouteRecovery({
      responsibleActor: "operator",
      prerequisite: required.requirement,
      operatorAction: required.correction,
      retryCondition
    });
  }
  if (condition === COMMITTED_SLICE_SCOPE_CORRECTION_CONDITION) {
    return ownedNoRouteRecovery({
      responsibleActor: "coordinator",
      prerequisite: "every path the delivery changes lies inside the slice's canonical write " +
        "scope at its authenticated diff base",
      retryCondition,
      explanation: "the scope decision's inputs (subject, write scope, diff base, base tree, " +
        "reviewed commit) must change; a delivery outside the allocated scope is new-generation work"
    });
  }
  return ownedNoRouteRecovery({
    responsibleActor: null,
    prerequisite: `the producer's correction condition ${condition} changes`,
    retryCondition
  });
}

function backendRefusalRecovery(route, blockerCode, retryFacts, reason) {
  if (retryFacts !== null) return producerCorrectionRecovery(route, retryFacts);
  const actor = getRuntimeBlockerEntry(blockerCode)?.actor_recovery ?? null;
  const unchanged = `the producer's refusal (${reason}) no longer holds`;
  if (RECOVERY_RESPONSIBLE_ACTORS.includes(actor)) {
    return ownedNoRouteRecovery({
      responsibleActor: actor,
      prerequisite: unchanged,
      ...(blockerCode === CCE_POLICY_REFUSED_CODE
        ? { explanation: "the returned CCE decision and its own recovery govern; this route " +
            "neither reinterprets nor retries it" }
        : {})
    });
  }
  return ownedNoRouteRecovery({
    responsibleActor: null,
    prerequisite: unchanged,
    explanation: "the integration producer supplied no classification or correction condition " +
      "for this refusal, so no correction owner is established"
  });
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
    callerCommittedSliceAuthorityFields, callerCcePolicyAuthorityFields,

    responseEnv = process.env
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
        detail: { refused_fields: refusedFields },
        refusal: integrationRefusal(committedSliceIntegrationToolName, {
          code: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
          facts: [["integration.caller_authority_fields", refusedFields]],
          recovery: ownedNoRouteRecovery({
            responsibleActor: "caller_retry",
            prerequisite: "the request carries no integration authority field; the backend " +
              "derives the exact target and authority itself",
            retryCondition: `re-issue ${committedSliceIntegrationToolName} with only repo, ` +
              "subject and dispositions"
          })
        })
      }));
      if (typeof args?.subject !== "string" || !/^WK-\d{4}#SLICE-\d{3}$/u.test(args.subject)) {
        return jsonContent(buildIntegrationRefusalResult({
          blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
          reason: "committed_slice_integration_subject_invalid",
          detail: { subject: typeof args?.subject === "string" ? args.subject : null },
          refusal: integrationRefusal(committedSliceIntegrationToolName, {
            code: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
            facts: [["integration.subject_wellformed", false]],
            recovery: ownedNoRouteRecovery({
              responsibleActor: "caller_retry",
              prerequisite: "subject names one exact slice, for example WK-1234#SLICE-001",
              retryCondition: `re-issue ${committedSliceIntegrationToolName} with the intended slice`
            })
          })
        }));
      }
      resolveWorkspaceRepo(workspaceRepos, args?.repo);
      if (typeof dispatchBackend?.requestCommittedSliceIntegration !== "function") {
        return jsonContent(buildIntegrationRefusalResult({
          blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
          reason: "committed_slice_integration_backend_unavailable",
          detail: { missing_backend: "requestCommittedSliceIntegration" },
          refusal: integrationRefusal(committedSliceIntegrationToolName, {
            code: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
            facts: [["integration.backend_registered", false]],
            recovery: ownedNoRouteRecovery({
              responsibleActor: "operator",
              prerequisite: "this server composes the launcher-owned dispatch backend's " +
                "committed-slice integration route",
              missingComponent: "requestCommittedSliceIntegration",
              operatorAction: "start this wiki-mcp server through the launcher with " +
                "WIKI_MCP_WORKSPACE_DIR bound to the canonical main repository and a launch " +
                "backend configured"
            })
          })
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

      const authenticated = projectCommittedSliceIntegrationRefusal(result);
      const retryFacts = resolveCommittedSliceIntegrationRetryFacts(result);
      const blockerCode = projectTypedIntegrationBlocker(result, refusal, authenticated);
      const reason = refusal?.reason ?? result?.reason ?? "committed_slice_integration_refused";

      const { refusal: _refusal, integrated: _integrated, ...resultFacts } =
        result !== null && typeof result === "object" ? result : {};
      const { detail: _refusalDetail, evidence: _refusalEvidence, ...refusalIdentity } =
        refusal !== null && typeof refusal === "object" ? refusal : {};
      return jsonContent(buildIntegrationRefusalResult({
        blockerCode,
        reason,
        detail: refusal === null
          ? (Object.keys(resultFacts).length === 0 ? null : projectDispatchFailureDetail(resultFacts, { env: responseEnv }))
          : projectDispatchFailureDetail({
              ...(typeof refusalCode === "string" ? { code: refusalCode } : {}),
              ...refusal
            }, { env: responseEnv }),
        refusal: integrationRefusal(committedSliceIntegrationToolName, {
          code: blockerCode,
          facts: [
            ["integration.integrated", false],
            ["integration.producer_refusal_code",
              typeof refusalCode === "string" ? refusalCode : null],
            ["integration.classification_authenticated", authenticated !== null],
            ["integration.correction_condition", retryFacts?.correction_condition ?? null]
          ],
          recovery: backendRefusalRecovery(committedSliceIntegrationToolName, blockerCode,
            retryFacts, reason),
          carried: {
            ...(refusal === null ? {} : { integration_refusal: jsonFacts(refusalIdentity) }),
            ...(authenticated === null ? {} : { integration_classification: jsonFacts(authenticated) }),
            ...(retryFacts === null ? {} : { producer_correction: jsonFacts(retryFacts) })
          }
        })
      }));
    } catch (error) {
      const repoRefusal = dispatchRepoResolutionRefusal(committedSliceIntegrationToolName, error);
      if (repoRefusal !== null) return jsonContent(buildIntegrationRefusalResult(repoRefusal));
      return jsonContent(buildIntegrationRefusalResult({
        blockerCode: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
        reason: "dispatch_tool_exception",
        detail: buildDispatchToolExceptionDetail(committedSliceIntegrationToolName, error,
          { env: responseEnv })
      }));
    }
  });
}
