

import {
  workspaceToolRouterRecommend
} from "../../../wiki-core/src/operations/tool-router.mjs";
import {
  filterToolDiscoveryTools,
  loadToolDiscoveryDescriptor
} from "../../../wiki-core/src/lib/tool-discovery.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { trimmed } from "./server-composition-helpers.mjs";
import {
  parseToolProfile,
  resolveRegisteredTier,
  shouldExposeTool
} from "./tool-profile.mjs";

const WORKSPACE_TOOL_ROUTER_RECOMMEND_TOOL_NAME = "workspace_tool_router_recommend";

export function registerToolRouterTools({
  registerTool,
  z,
  jsonContent,
  errorContent,
  sessionRole = null,
  registeredTier = null,
  loadDescriptor = loadToolDiscoveryDescriptor,

  requestContracts = registeredToolRequestContracts(registerTool)
}) {
  function resolveSessionRole() {
    if (typeof sessionRole === "string" && sessionRole.trim()) {
      return parseToolProfile({ WIKI_MCP_TOOL_PROFILE: sessionRole.trim() });
    }
    return parseToolProfile();
  }

  async function resolveDescriptorContext() {
    const completeDescriptor = await loadDescriptor();
    const role = resolveSessionRole();
    const tier = typeof registeredTier === "string" && registeredTier
      ? registeredTier
      : resolveRegisteredTier();
    const tierVisible = filterToolDiscoveryTools(completeDescriptor, {
      registered_tier: tier
    });
    const tools = tierVisible.filter(({ tool_name: toolName }) =>
      shouldExposeTool(role, toolName));
    return {
      completeDescriptor,
      descriptor: { ...completeDescriptor, tools },
      requestContracts
    };
  }

  registerTool(
    WORKSPACE_TOOL_ROUTER_RECOMMEND_TOOL_NAME,
    {
      description:
        "Read-only repository tool guidance when the next operation is unclear: a contract-checked match or its missing fields, counted clarification choices with complete-set continuation, or explicit recovery/no-route. Follow emitted candidate_view=complete for omitted choices. Grants no operation authority.",
      inputSchema: z
        .object({
          task_description: z.string().optional(),
          task: z.string().optional(),
          initiative: z.string().optional(),
          unit: z.string().optional(),
          slice_unit: z.string().optional(),
          slice_id: z.string().optional(),
          role: z.string().optional(),
          title: z.string().optional(),
          monitor_handle: z.string().optional(),
          candidate_view: z.enum(["bounded", "complete"]).optional(),
          known_resources: z.record(z.union([z.string(), z.array(z.string())])).optional()
        })
        .strict()
        .refine(
          (value) =>
            Boolean(
              trimmed(value.task_description) ||
                trimmed(value.task) ||
                trimmed(value.initiative) ||
                trimmed(value.unit) ||
                trimmed(value.slice_unit) ||
                trimmed(value.monitor_handle)
            ),
          {
            message:
              "workspace_tool_router_recommend requires a task_description, task, or known identifier"
          }
        )
    },
    async (args) => {
      try {
        return jsonContent(await workspaceToolRouterRecommend(
          args,
          await resolveDescriptorContext()
        ));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
