import { DISPATCH_BLOCKER_CODES, WK_FORGE_HANDOFF_TOOL_NAME } from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchMechanicalRefusal,
  buildDispatchToolExceptionDetail,
  dispatchRepoResolutionRefusal,
  mapBackendRefusalToDispatchCode,
  NO_SUPPORTED_ROUTE_RECOVERY,
  ownedNoRouteRecovery,
  producerEstablishedRecovery,
  projectDispatchFailureDetail,
  requestSchemaAuthorityForRegistration
} from "../dispatch-tool-helpers.mjs";
import { acceptanceValidationDriftGuidance } from "./forge-handoff-drift-guidance.mjs";
import {
  activeMcpInlineByteLimit,
  describeRetainedArtifactFile,
  describeRetentionFailure,
  measureMcpInlineResultBytes,
  retainOperatorOnlyEvidence
} from "../mcp-response.mjs";

function forgeRefusal({ code, decidingFacts, observedFacts, carried = null,
  recovery = NO_SUPPORTED_ROUTE_RECOVERY }) {
  return buildDispatchMechanicalRefusal({
    code,
    decidingFacts,
    observedFacts,
    noSupportedRoute: true,
    recovery,
    route: WK_FORGE_HANDOFF_TOOL_NAME,
    carried
  });
}

function executorRefusalRecovery(refusal, detail) {
  const category = typeof refusal.category === "string" ? refusal.category : "unclassified";
  const reason = typeof refusal.reason === "string" ? refusal.reason : "no reason";
  return producerEstablishedRecovery(detail, {
    unchanged: `the executor's ${category} refusal (${reason}) no longer holds`,
    retryCondition: `re-issue ${WK_FORGE_HANDOFF_TOOL_NAME} for the same assigned_unit only after the prerequisite holds`,
    unestablished: "the executor's typed refusal does not establish who corrects it; its category, " +
      "reason and detail are published unchanged, and re-issuing against unchanged facts refuses again"
  });
}

function retainedErrorLogOriginal({ retainedEvidence, original, assignedUnit, env }) {
  if (retainedEvidence?.retained === true) return { reference: retainedEvidence, failure: null };
  if (retainedEvidence?.retained === false) {
    const { fields: _fields, audience: _audience, ...failure } = retainedEvidence;
    return { reference: null, failure };
  }
  try {
    return { reference: retainOperatorOnlyEvidence(original, { env }), failure: null };
  } catch (error) {
    return { reference: null, failure: describeRetentionFailure(error, {
      operation: "retain_forge_handoff_error_log", subject: { assigned_unit: assignedUnit } }) };
  }
}

function boundedDiagnosticAnswer({ answer, detail, original, assignedUnit, env }) {
  const complete = answer(detail);
  const inlineByteLimit = activeMcpInlineByteLimit(env);
  const completeFrameBytes = measureMcpInlineResultBytes(complete);
  if (completeFrameBytes <= inlineByteLimit) return complete;
  const detailObject = detail !== null && typeof detail === "object" && !Array.isArray(detail);
  const { retained_evidence: retainedEvidence, category, ...facts } = detailObject ? detail : { detail };
  const retained = retainedErrorLogOriginal({ retainedEvidence, original, assignedUnit, env });
  let errorLog = null;
  let errorLogFailure = retained.failure;
  if (retained.reference !== null) {
    try {
      errorLog = { ...describeRetainedArtifactFile(retained.reference, { env }),
        holds: "the complete diagnostic of this failure; read this file directly" };
    } catch (error) {
      errorLogFailure = describeRetentionFailure(error, { operation: "locate_forge_handoff_error_log",
        subject: { assigned_unit: assignedUnit, ref_id: retained.reference.ref_id } });
    }
  }
  const compact = {
    ...(category === undefined ? {} : { category }),
    response_budget: { inline_byte_limit: inlineByteLimit, complete_frame_bytes: completeFrameBytes },
    error_log: errorLog,
    ...(errorLogFailure === null ? {} : { error_log_failure: errorLogFailure }),
    facts_not_inline: []
  };
  for (const [key, value] of Object.entries(facts)) {
    const candidate = { ...compact, [key]: value };
    if (measureMcpInlineResultBytes(answer(candidate)) <= inlineByteLimit) compact[key] = value;
    else compact.facts_not_inline.push(key);
  }
  return answer(compact);
}

const description = "Hand off the exact terminal candidate to the configured destination: local, Git delivery, or hosted branch and PR. Server derives refs; retries recover idempotently; never merges. Reviews are advisory; CCE owns policy. Cold recovery requires an authenticated current candidate. Orchestrator/operator only.";
export function registerForgeHandoffRoute(ctx) {

  const { registerTool, workspaceRepos, z, jsonContent, resolveWorkspaceRepo, invokeWkForgeHandoffAdapter,
    responseEnv = process.env } = ctx;
  const requestSchemaAuthority = requestSchemaAuthorityForRegistration(registerTool);
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
            observedFacts: { "forge_handoff.assigned_unit_wellformed": false },
            recovery: ownedNoRouteRecovery({
              responsibleActor: "caller_retry",
              prerequisite: "assigned_unit names one WK record (WK-####)",
              retryCondition: `re-issue ${WK_FORGE_HANDOFF_TOOL_NAME} with the intended WK id`
            })
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
            observedFacts: { "forge_handoff.executor_registered": false },
            recovery: ownedNoRouteRecovery({
              responsibleActor: "operator",
              prerequisite: "this server composes the launcher-owned WK forge handoff executor",
              missingComponent: "wk_forge_handoff_adapter",
              operatorAction: "start this wiki-mcp server through the launcher with " +
                "WIKI_MCP_WORKSPACE_DIR bound to the canonical main repository and a launch " +
                "backend configured, so the server composes the handoff executor",
              retryCondition: `re-issue ${WK_FORGE_HANDOFF_TOOL_NAME} for the same assigned_unit ` +
                "once the server composes the executor"
            })
          })
        }));
      }
      const outcome = await invokeWkForgeHandoffAdapter(assignedUnit);
      if (outcome && outcome.accepted === true) {

        const livePublished = outcome.forge_handoff?.live_record_published;
        const accepted = (forgeHandoff) => ({
          schema_version: "workspace-wk-forge-handoff.v1", assigned_unit: assignedUnit,
          forge_handoff: forgeHandoff, blocker: null,
          ...(typeof livePublished === "boolean"
            ? { observed_facts: { "forge_handoff.live_record_published": livePublished } } : {})
        });

        const { diagnostic, ...result } = outcome.forge_handoff ?? {};
        if (diagnostic === undefined || diagnostic === null) return jsonContent(accepted(outcome.forge_handoff));
        return jsonContent(boundedDiagnosticAnswer({
          answer: (published) => accepted({ ...result, diagnostic: published }),
          detail: projectDispatchFailureDetail(diagnostic, { env: responseEnv }),
          original: diagnostic,
          assignedUnit,
          env: responseEnv
        }));
      }
      const refusal = outcome && typeof outcome.refusal === "object" && outcome.refusal !== null
        ? outcome.refusal : {};

      const publicCode = mapBackendRefusalToDispatchCode(refusal.code);
      const { detail: executorDetail = null, ...refusalIdentity } = refusal;
      const executorFacts = {
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

        carried: { forge_executor_refusal: refusalIdentity }
      };

      const drift = acceptanceValidationDriftGuidance({ refusal, detail: executorDetail, assignedUnit,
        code: publicCode, ...executorFacts, requestSchemaAuthority });
      const { recovery: _proposal, ...driftFacts } = drift === null ? {} : executorDetail;
      const refusalDetail = drift === null ? executorDetail : driftFacts;
      const executorRefusal = drift?.refusal ?? forgeRefusal({
        code: publicCode,
        ...executorFacts,
        recovery: drift?.recovery ?? executorRefusalRecovery(refusal, refusalDetail)
      });
      const blockedAnswer = (published) => buildBlockedDispatchResult({
        blockerCode: publicCode,
        reason: typeof refusal.reason === "string" ? refusal.reason : "wk_forge_handoff_refused",
        detail: published,
        refusal: executorRefusal
      });
      return jsonContent(boundedDiagnosticAnswer({
        answer: blockedAnswer,
        detail: refusalDetail !== null ? projectDispatchFailureDetail(refusalDetail, { env: responseEnv })
          : (typeof refusal.category === "string" ? { category: refusal.category } : null),
        original: refusal,
        assignedUnit,
        env: responseEnv
      }));
    } catch (error) {
      const repoRefusal = dispatchRepoResolutionRefusal(WK_FORGE_HANDOFF_TOOL_NAME, error);
      if (repoRefusal !== null) return jsonContent(buildBlockedDispatchResult(repoRefusal));
      return jsonContent(buildBlockedDispatchResult({

        blockerCode: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
        reason: "dispatch_tool_exception",
        detail: buildDispatchToolExceptionDetail(WK_FORGE_HANDOFF_TOOL_NAME, error,
          { env: responseEnv }),

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
