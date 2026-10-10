

import { z } from "zod";
import { isCanonicalNextCallTool } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { resolveWorkspaceRepo as incumbentResolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";
import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";
import { resolveObligationCoverageQueryContext } from "./controlled-contract-query-context.mjs";
import { guardToolHandler, jsonContent } from "./mcp-response.mjs";
import { createToolInputValidationError } from "./register-tool.mjs";
import { DISPATCH_BLOCKER_CODES, WK_FORGE_HANDOFF_TOOL_NAME } from "./dispatch-tool-constants.mjs";
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
    successPredicate: { fact: "forge_handoff.live_record_published", operator: "is_true" },
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
      missing_component: "wk_forge_handoff_adapter", effects: { published: false },
      correction: "Start this server through the launcher with its canonical repository and configured handoff adapter.",
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
    let carrier;
    try {
      const outcome = await wkForgeHandoffAdapter({ assigned_unit: subject });
      carrier = publicationCarrier(subject, outcome, responseEnv, requestSchemaAuthority);
    } catch (error) {
      carrier = publicationException(subject, error, responseEnv);
    }
    return deliverPublication({ carrier, binding, env: responseEnv, ownerCall, ownerRequestSchema });
  }

  async function original({ subject, source }) {
    parseRequest({ subject });
    if (!entitled) return jsonContent(publicationEntitlementRefusal(subject, role,
      DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE), { env: responseEnv });
    return readPublicationOriginal({ subject, source, binding: await bindingFor(subject), env: responseEnv });
  }

  const config = Object.freeze({ description:
    "Publish the session repository's current exact WK candidate through the existing publication owner.",
  inputSchema: PUBLISH_WORK_INPUT_SCHEMA });
  return Object.freeze({ name: PUBLISH_WORK_TOOL_NAME, config, inputSchema: PUBLISH_WORK_INPUT_SCHEMA,
    handler, call: guardToolHandler(handler, { name: PUBLISH_WORK_TOOL_NAME, env: responseEnv }),
    readOriginal: guardToolHandler(original, { name: PUBLISH_WORK_TOOL_NAME, env: responseEnv }),
    repeatRequest: (subject) => buildPublishWorkRequest(subject, { requestSchemaAuthority }) });
}

export function registerPublishWorkTool({ registerTool, ...composition }) {
  const task = createPublishWorkTask({ ...composition,
    requestSchemaAuthority: requestSchemaAuthorityForRegistration(registerTool) });
  registerTool(task.name, task.config, task.call);
  recordOwnerRegisteredRequestSchema({ registerTool, toolName: task.name, declaredInput: task.inputSchema });
  return task;
}
