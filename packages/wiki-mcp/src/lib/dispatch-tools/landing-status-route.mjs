import { DISPATCH_BLOCKER_CODES, WK_LANDING_STATUS_TOOL_NAME } from "../dispatch-tool-constants.mjs";
import { z } from "zod";
import { buildNextCall, isCanonicalNextCallTool } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { createWkPublicationSelectionSchema, validateWkPublicationSelection } from
  "@agent-chassis/agent-launch-cli/src/lib/wk-forge-handoff.mjs";
import { captureDiagnosticEvidence } from "@agent-chassis/agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { parseToolProfile, shouldExposeTool } from "../tool-profile.mjs";
import { resolveObligationCoverageQueryContext } from "../controlled-contract-query-context.mjs";
import { guardToolHandler, jsonContent, activeMcpInlineByteLimit, measureMcpInlineResultBytes } from "../mcp-response.mjs";
import { SPILL_PERSISTENCE_FAILED_CODE } from "../mcp-response-shared.mjs";
import { createToolInputValidationError, projectToolInputValidationFailure } from "../register-tool.mjs";
import { registeredToolRequestContracts } from "../registered-tool-request-contracts.mjs";
import { retainSelectedResponseSource, readSelectedResponseProjection, selectedResponseLocatorSchema } from "../selected-response-snapshot.mjs";
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
import { buildDispatchContinuation, recordOwnerRegisteredRequestSchema, registrarGuidanceAuthority,
  requestSchemaAuthorityForRegistration } from "../dispatch-tool-helpers.mjs";
import { checkLandingAction, projectCheckLandingAnswer } from "./check-landing-response.mjs";

export const CHECK_LANDING_TOOL_NAME = "workspace_check_landing";
export const CHECK_LANDING_INPUT_SCHEMA = z.object({
  subject: z.string().regex(/^WK-[0-9]{4}$/u),
  selection: createWkPublicationSelectionSchema(z).optional()
}).strict();

export const CHECK_LANDING_ORIGINAL_INPUT_SCHEMA = z.object({ subject: CHECK_LANDING_INPUT_SCHEMA.shape.subject,
  source: selectedResponseLocatorSchema(z)
}).strict();

function parseLandingRequest(request, schema = CHECK_LANDING_INPUT_SCHEMA) {
  const parsed = schema.safeParse(request);
  if (!parsed.success) throw createToolInputValidationError({
    tool: CHECK_LANDING_TOOL_NAME, validationError: parsed.error });
  if (parsed.data.selection !== undefined) {

    const validated = validateWkPublicationSelection(parsed.data.selection);
    if (!validated.ok) throw new TypeError(`publication selection schema disagrees: ${validated.detail.field}`);
    parsed.data.selection = validated.selection;
  }
  return parsed.data;
}

export function buildCheckLandingRequest(request, { requestSchemaAuthority = null } = {}) {
  const args = parseLandingRequest(request);
  const serving = registrarGuidanceAuthority(requestSchemaAuthority);
  const call = !isCanonicalNextCallTool(CHECK_LANDING_TOOL_NAME) ||
      serving?.registeredTools?.has(CHECK_LANDING_TOOL_NAME) !== true ? null
    : buildDispatchContinuation({ tool: CHECK_LANDING_TOOL_NAME, arguments: args,
      successPredicate: { fact: "landing.observation_available", operator: "is_true" },
      requestSchemaAuthority });
  return call ?? Object.freeze({ kind: "intended_tool_request", tool: CHECK_LANDING_TOOL_NAME,
    arguments: Object.freeze(args), callable: false });
}

const landingCause = (cause) => projectRecordedFailureDetail(cause,
  { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION, nested: true });

function checkLandingRecovery(cause, request, requestSchemaAuthority) {
  const detail = cause?.detail ?? cause;
  const recovery = producerEstablishedRecovery(detail, {
    unchanged: detail?.operator_action,
    retryCondition: "observe the same publication only after the stated correction",
    unestablished: null
  });
  if (recovery.responsible_actor === null) return { state: recovery.state, responsible_actor: null };
  return { ...recovery,
    intended_request: buildCheckLandingRequest(request, { requestSchemaAuthority }) };
}

function checkLandingRefusal(request, { code = DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
  reason, cause, recovery, workspace = null, authority = null }) {
  return { ...buildBlockedDispatchResult({ blockerCode: code, reason, detail: landingCause(cause),
    refusal: buildDispatchMechanicalRefusal({ code, route: CHECK_LANDING_TOOL_NAME,
      decidingFacts: [{ field: "landing.request_observable", value: false }],
      observedFacts: { "landing.request_observable": false, "landing.observation_available": false }, noSupportedRoute: true,
      recovery: { ...recovery, intended_request: recovery.intended_request ?? buildCheckLandingRequest(request) } }) }),
    subject: { repo: workspace?.repo ?? null, unit: request.subject }, authority_identity: authority,
    request_mode: request.selection === undefined ? "current" : "explicit",
    ...(request.selection === undefined ? {} : { selection: request.selection, selection_authenticated: false }),
    effects: { object_cache_fetch: "not_attempted" } };
}

export function createCheckLandingTask({ workspace, wkLandingStatusAdapter, env = process.env,
  responseEnv = env, requestSchemaAuthority = null, ownerCall = null, ownerRequestSchema = null } = {}) {
  async function bindingFor(subject) {
    const context = await resolveObligationCoverageQueryContext({ env, workspace });
    return { route: CHECK_LANDING_TOOL_NAME, repository: workspace.repo,
      unit: subject, authority_identity: context.identity };
  }

  function project(body, { source = null, detail = false } = {}) {
    const action = checkLandingAction(body);
    const later = !detail && body.state === "awaiting_human_landing" && body.selection_authenticated === true
      ? buildCheckLandingRequest({ subject: body.subject.unit, selection: body.selection }, { requestSchemaAuthority })
      : null;
    return projectCheckLandingAnswer(body, { action, detail,
      later: later?.callable === false ? null : later,
      detailCall: !detail && action !== null && source !== null && ownerCall !== null ? ownerCall(source) : null });
  }

  const present = (source, binding, detail = false) => readSelectedResponseProjection(source,
    { env: responseEnv, expected: binding, project: ({ carrier }) => project(carrier, { source, detail }) });

  function compositionFailure(request) {
    let role;
    try { role = parseToolProfile(env); } catch (error) {
      return checkLandingRefusal(request, { reason: "check_landing_session_profile_unavailable",
        cause: { stage: "session", reason: "tool_profile_unavailable", message: error.message },
        recovery: ownedNoRouteRecovery({ responsibleActor: "launcher",
          prerequisite: "the launcher binds this server's session tool profile",
          missingComponent: "WIKI_MCP_TOOL_PROFILE" }) });
    }
    if (!shouldExposeTool(role, CHECK_LANDING_TOOL_NAME)) {
      return checkLandingRefusal(request, { reason: "check_landing_role_forbidden",
        cause: { stage: "entitlement", role, required_roles: ["orchestrator", "operator"] },
        recovery: ownedNoRouteRecovery({ responsibleActor: "launcher",
          prerequisite: "an orchestrator or operator session invokes this observation",
          missingComponent: "landing_observer_session_entitlement" }) });
    }
    if (typeof workspace?.repo !== "string" || !workspace.repo ||
        typeof workspace?.dir !== "string" || !workspace.dir) {
      return checkLandingRefusal(request, { reason: "check_landing_session_repository_missing",
        cause: { stage: "session", reason: "session_repository_missing" },
        recovery: ownedNoRouteRecovery({ responsibleActor: "launcher",
          prerequisite: "the launcher supplies the resolved session repository",
          missingComponent: "session_workspace",
          operatorAction: "start the server with its canonical WIKI_MCP_WORKSPACE_DIR binding" }) });
    }
    return null;
  }

  async function respond(input) {
    const request = parseLandingRequest(input);
    const failure = compositionFailure(request);
    if (failure !== null) return { result: jsonContent(project(failure), { env: responseEnv }), source: null, originalRequest: null };
    const binding = await bindingFor(request.subject);
    let body;
    if (typeof wkLandingStatusAdapter !== "function") {
      body = checkLandingRefusal(request, { reason: "check_landing_observer_unavailable", workspace,
        authority: binding.authority_identity,
        cause: { stage: "composition", reason: "wk_landing_status_adapter_missing" },
        recovery: { ...ownedNoRouteRecovery({ responsibleActor: "operator",
          prerequisite: "this server composes the launcher-owned landing observer",
          missingComponent: "wk_landing_status_adapter",
          operatorAction: "Start this server through the launcher with its canonical WIKI_MCP_WORKSPACE_DIR and configured launch backend." }),
          intended_request: buildCheckLandingRequest(request, { requestSchemaAuthority }),
          retry_condition: "Repeat workspace_check_landing with the same subject and selection only after the observer is composed." } });
    } else {
      try {
        const outcome = await wkLandingStatusAdapter({ assigned_unit: request.subject,
          ...(request.selection === undefined ? {} : { selection: request.selection }) });
        if (outcome?.accepted !== true) {
          const cause = outcome?.refusal ?? { stage: "adapter", reason: "landing_adapter_returned_no_observation" };
          body = checkLandingRefusal(request, { reason: "check_landing_observer_refused", workspace,
            authority: binding.authority_identity, cause,
            recovery: checkLandingRecovery(cause, request, requestSchemaAuthority) });
        } else {
          const landing = outcome.landing;
          body = { schema_version: "workspace-check-landing.v1", accepted: true,
            subject: { repo: workspace.repo, unit: request.subject }, authority_identity: binding.authority_identity,
            request_mode: request.selection === undefined ? "current" : "explicit",
            selection: landing.selection ?? request.selection ?? null, selection_authenticated: landing.selection_authenticated === true,
            state: landing.state, transport: landing.transport, landing_authority: landing.landing_authority,
            handoff: landing.handoff ?? null,
            observed_base: landing.observed_base, landed_publication: landing.landed_publication,
            ...(landing.observed_landing == null ? {} : { observed_landing: landing.observed_landing }),
            effects: landing.effects, cause: landing.cause == null ? null : landingCause(landing.cause),
            observed_facts: { "landing.observation_available": landing.state !== "unavailable" },
            ...(landing.state === "unavailable" || landing.state === "contradictory"
              ? { recovery: checkLandingRecovery(landing.cause, { subject: request.subject,
                ...(landing.selection == null ? request.selection === undefined ? {} : { selection: request.selection }
                  : { selection: landing.selection }) }, requestSchemaAuthority) } : {}),
            next_calls: [] };
        }
      } catch (error) {
        const cause = landingCause({ stage: "adapter", reason: "landing_adapter_failed",
          evidence: captureDiagnosticEvidence(error) });
        body = checkLandingRefusal(request, { code: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
          reason: "check_landing_adapter_exception", workspace, authority: binding.authority_identity,
          cause, recovery: checkLandingRecovery(cause, request, requestSchemaAuthority) });
        body = { ...body, effects: null, blocker: { ...body.blocker, detail: { ...body.blocker.detail,
          effects_unavailable: "the adapter raised without an owner observation-effects carrier" } } };
      }
    }
    const complete = () => ({ source: null, originalRequest: null,
      result: jsonContent(project(body), { env: responseEnv }) });

    if ((checkLandingAction(body) === null || ownerCall === null) &&
        measureMcpInlineResultBytes(project(body)) <= activeMcpInlineByteLimit(responseEnv)) return complete();
    let source;
    try {
      source = retainSelectedResponseSource({ binding: { ...binding, query_identity: request,
        observation_identity: { selection: body.selection ?? null,
          selection_authenticated: body.selection_authenticated === true, state: body.state ?? null,
          observed_base: body.observed_base ?? null, landed_publication: body.landed_publication ?? null } },
        carrier: { ...body, delivery: { transport_retention: "retained" } }, ownerCall, ownerRequestSchema }, { env: responseEnv });
    } catch (error) {
      if (error?.envelope?.code !== SPILL_PERSISTENCE_FAILED_CODE) throw error;

      return complete();
    }
    const result = await present(source, binding);
    return Object.freeze({ source, originalRequest: Object.freeze({ subject: request.subject, source }), result });
  }

  async function original(input) {
    const request = parseLandingRequest(input, CHECK_LANDING_ORIGINAL_INPUT_SCHEMA);
    const failure = compositionFailure({ subject: request.subject });
    if (failure !== null) return jsonContent(project(failure), { env: responseEnv });

    return present(Object.freeze({ ...request.source }), await bindingFor(request.subject), true);
  }

  const handler = async (input) => (await respond(input)).result;
  const config = Object.freeze({ description: "Observe the session WK's current or exactly selected publication landing. Landed answers finish; pending answers offer human-action detail and an optional later exact observation. Never publishes, repairs, merges or closes work. Orchestrator/operator only.",
    inputSchema: CHECK_LANDING_INPUT_SCHEMA });
  return Object.freeze({ name: CHECK_LANDING_TOOL_NAME, config, inputSchema: CHECK_LANDING_INPUT_SCHEMA,
    respond, handler, call: guardToolHandler(handler, { name: CHECK_LANDING_TOOL_NAME, env: responseEnv }),
    readOriginal: guardToolHandler(original, { name: CHECK_LANDING_TOOL_NAME, env: responseEnv }),
    repeatRequest: (request) => buildCheckLandingRequest(request, { requestSchemaAuthority }) });
}

export async function projectCheckLandingInputFailure({ args, validationError, requestContract,
  registeredTools = null }) {
  const failure = await projectToolInputValidationFailure({ tool: CHECK_LANDING_TOOL_NAME, args,
    validationError });
  if (!validationError.issues.some((issue) => issue.path.length === 2 &&
      issue.path[0] === "selection" && issue.path[1] === "version")) return failure;
  const current = { subject: args?.subject };
  const call = failure.next_calls.length === 0 && isCanonicalNextCallTool(CHECK_LANDING_TOOL_NAME) &&
    registeredTools?.has(CHECK_LANDING_TOOL_NAME) === true && await requestContract.acceptsArguments(current)
    ? buildNextCall({ tool: CHECK_LANDING_TOOL_NAME, arguments: current }) : null;
  return { ...failure,
    correction: "Correct the explicit pin by copying the COMPLETE selection the publication owner returned, " +
      "unchanged. Do not build one from a worker or delivery commit or the literal \"current\"; a " +
      "well-formed selection is still authenticated, so format alone establishes nothing.",
    current_observation_alternative: call === null ? null : {
      label: "OPTIONAL ALTERNATIVE: observe CURRENT publication status instead of an explicit pin",
      changes_request: "from the explicitly selected publication to the current one",
      not_a_correction: "this is not the requested pinned read and repairs no failed publication",
      call
    },
    next_calls: failure.next_calls };
}

export function registerCheckLandingTool({ registerTool, ...composition }) {
  const requestSchemaAuthority = requestSchemaAuthorityForRegistration(registerTool);
  const task = createCheckLandingTask({ ...composition, requestSchemaAuthority });

  const requestContracts = registeredToolRequestContracts(registerTool);
  registerTool(task.name, requestContracts === null ? task.config : { ...task.config,
    inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: {
      ...jsonContent(await projectCheckLandingInputFailure({ args, validationError,
        requestContract: requestContracts.contractFor(task.name),
        registeredTools: registrarGuidanceAuthority(requestSchemaAuthority)?.registeredTools }),
      { env: composition.responseEnv ?? composition.env ?? process.env }), isError: true } }) }, task.call);
  recordOwnerRegisteredRequestSchema({ registerTool, toolName: task.name, declaredInput: task.inputSchema });
  return task;
}

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
