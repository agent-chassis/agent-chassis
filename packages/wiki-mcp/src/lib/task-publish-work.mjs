

import { z } from "zod";
import { isCanonicalNextCallTool } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { resolveWorkspaceRepo as incumbentResolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";
import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";
import { resolveObligationCoverageQueryContext } from "./controlled-contract-query-context.mjs";
import { guardToolHandler, jsonContent } from "./mcp-response.mjs";
import { createToolInputValidationError, projectToolInputValidationFailure } from "./register-tool.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { DISPATCH_BLOCKER_CODES } from "./dispatch-tool-constants.mjs";
import { buildDispatchContinuation, dispatchRepoResolutionRefusal,
  recordOwnerRegisteredRequestSchema, registrarGuidanceAuthority,
  requestSchemaAuthorityForRegistration } from "./dispatch-tool-helpers.mjs";
import {
  deliverPublication, publicationCarrier, publicationEntitlementRefusal,
  publicationException, publicationRepoResolutionRefusal, PUBLISH_WORK_TOOL_NAME, readPublicationOriginal
} from "./task-publish-work-response.mjs";

export const PUBLISH_WORK_INPUT_SCHEMA = z.object({
  subject: z.string().regex(/^WK-[0-9]{4}$/u)
}).strict();

function parseRequest(request) {
  const parsed = PUBLISH_WORK_INPUT_SCHEMA.safeParse(request);
  if (!parsed.success) throw createToolInputValidationError({
    tool: PUBLISH_WORK_TOOL_NAME, validationError: parsed.error
  });
  return parsed.data;
}

export function buildPublishWorkRequest(subject, { requestSchemaAuthority = null } = {}) {
  const args = parseRequest({ subject });
  const serving = registrarGuidanceAuthority(requestSchemaAuthority);
  const call = !isCanonicalNextCallTool(PUBLISH_WORK_TOOL_NAME) ||
      serving?.registeredTools?.has(PUBLISH_WORK_TOOL_NAME) !== true ? null
    : buildDispatchContinuation({ tool: PUBLISH_WORK_TOOL_NAME, arguments: args,
    successPredicate: { fact: "publication.confirmed", operator: "is_true" },
    requestSchemaAuthority });
  return call === null ? Object.freeze({ kind: "intended_tool_request", tool: PUBLISH_WORK_TOOL_NAME,
    arguments: Object.freeze(args), callable: false }) : call;
}

export function createPublishWorkTask({ workspaceRepos, wkForgeHandoffAdapter,
  resolveWorkspaceRepo = incumbentResolveWorkspaceRepo, env = process.env,
  responseEnv = env, requestSchemaAuthority = null, ownerCall = null, ownerRequestSchema = null } = {}) {
  const role = parseToolProfile(env);
  const entitled = shouldExposeTool(role, PUBLISH_WORK_TOOL_NAME);

  async function bindingFor(subject) {

    const workspace = resolveWorkspaceRepo(workspaceRepos);
    const context = await resolveObligationCoverageQueryContext({ env, workspace });
    return { route: PUBLISH_WORK_TOOL_NAME, repository: workspace.repo,
      unit: subject, authority_identity: context.identity };
  }

  async function handler(request) {
    const { subject } = parseRequest(request);
    if (!entitled) return jsonContent(publicationEntitlementRefusal(subject, role,
      DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE), { env: responseEnv });
    if (typeof wkForgeHandoffAdapter !== "function") return jsonContent({
      accepted: false, code: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
      reason: "wk_forge_handoff_executor_unavailable", subject,
      effects: { publication: "not_attempted" },
      stopping_condition: "Publication cannot be executed through this session. This call attempted no publication; stop this dependent step.",
      next_calls: [] }, { env: responseEnv });
    let binding;
    try {
      binding = await bindingFor(subject);
    } catch (error) {
      const refusal = dispatchRepoResolutionRefusal(PUBLISH_WORK_TOOL_NAME, error);
      if (refusal !== null) return jsonContent(publicationRepoResolutionRefusal(subject, refusal),
        { env: responseEnv });
      throw error;
    }
    let outcome;
    try {
      outcome = await wkForgeHandoffAdapter({ assigned_unit: subject });
    } catch (error) {
      return deliverPublication({ carrier: publicationException(subject, error, responseEnv, requestSchemaAuthority),
        binding, env: responseEnv, ownerCall, ownerRequestSchema });
    }
    const carrier = publicationCarrier(subject, outcome, responseEnv, requestSchemaAuthority);
    return deliverPublication({ carrier, binding, env: responseEnv, ownerCall, ownerRequestSchema });
  }

  async function original({ subject, source }) {
    parseRequest({ subject });
    if (!entitled) return jsonContent(publicationEntitlementRefusal(subject, role,
      DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE), { env: responseEnv });
    return readPublicationOriginal({ subject, source, binding: await bindingFor(subject), env: responseEnv });
  }

  const config = Object.freeze({ description:
    "Publish the session repository's current WK to its configured destination: " +
    "a hosted pull request or local/Git handoff. Publication requires preserving reviewed work; " +
    "the current request does not fence an earlier inspected version. Availability grants no publication permission. " +
    "The direct-to-main lifecycle excludes this call. Publication neither merges nor completes work.",
  inputSchema: PUBLISH_WORK_INPUT_SCHEMA });
  return Object.freeze({ name: PUBLISH_WORK_TOOL_NAME, config, inputSchema: PUBLISH_WORK_INPUT_SCHEMA,
    handler, call: guardToolHandler(handler, { name: PUBLISH_WORK_TOOL_NAME, env: responseEnv }),
    readOriginal: guardToolHandler(original, { name: PUBLISH_WORK_TOOL_NAME, env: responseEnv }),
    repeatRequest: (subject) => buildPublishWorkRequest(subject, { requestSchemaAuthority }) });
}

export function registerPublishWorkTool({ registerTool, ...composition }) {
  const task = createPublishWorkTask({ ...composition,
    requestSchemaAuthority: requestSchemaAuthorityForRegistration(registerTool) });
  const contracts = registeredToolRequestContracts(registerTool);
  registerTool(task.name, contracts === null ? task.config : { ...task.config,
    advertisedInputSchema: task.inputSchema,
    inputValidationErrorProjector: async ({ args, validationError }) => {
      const projection = await projectToolInputValidationFailure({ tool: task.name, args, validationError,
        inputSchema: task.inputSchema });
      if (args === null || typeof args !== "object" || !Object.hasOwn(args, "version")) return { terminal_result: {
        ...jsonContent(projection, { env: composition.responseEnv ?? composition.env ?? process.env }), isError: true } };
      return { terminal_result: { ...jsonContent({ ...projection,
        invalid_fields: projection.invalid_fields.map(field => {
          if (field.code !== "unrecognized_keys" || field.path.length !== 0 || !field.keys.includes("version")) return field;
          const { message: _message, ...facts } = field;
          return facts;
        }),
        effects: { publication: "not_attempted" },
        correction: "This operation cannot publish an explicitly selected version. Stop this exact-version request; " +
          "no supported correction expresses that selection. Subject-only publication selects current canonical work: " +
          "it is a different request, not a correction for the requested version.",
        next_calls: [] }, { env: composition.responseEnv ?? composition.env ?? process.env }), isError: true } };
    } }, task.call);
  recordOwnerRegisteredRequestSchema({ registerTool, toolName: task.name, declaredInput: task.inputSchema });
  return task;
}
