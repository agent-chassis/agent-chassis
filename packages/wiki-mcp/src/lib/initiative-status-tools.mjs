

const WORKSPACE_INITIATIVE_STATUS_TOOL_NAME = "workspace_initiative_status";

export async function registerInitiativeStatusTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo
}) {

  const initiativeStatusModule = await import("../../../wiki-core/src/operations/initiative-status.mjs");
  const initiativeStatusHandler =
    initiativeStatusModule.workspace_initiative_status ??
    initiativeStatusModule.workspaceInitiativeStatus ??
    initiativeStatusModule.initiativeStatus ??
    initiativeStatusModule.summarizeInitiativeStatus ??
    initiativeStatusModule.default;

  if (typeof initiativeStatusHandler !== "function") {
    throw new Error("workspace_initiative_status operation is unavailable");
  }

  registerTool(
    WORKSPACE_INITIATIVE_STATUS_TOOL_NAME,
    {
      description:
        "Read compact initiative status and ranked next actions from an initiative or unit selector. Read-only. Invalid or unknown identities refuse; a valid initiative without WK members returns zero-member status. selected_action_id pins a candidate, top_action_limit bounds ranking, and verbose adds evidence detail.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          initiative: z.string().optional(),
          unit: z.string().optional(),
          selected_action_id: z.string().optional(),
          top_action_limit: z.number().int().positive().max(20).optional(),
          verbose: z.boolean().optional()
        })
        .strict()
        .refine((value) => Boolean(value.initiative || value.unit), {
          message: "workspace_initiative_status requires initiative or unit"
        })
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await initiativeStatusHandler({
          repoRoot: workspace.dir,
          initiative: args.initiative ?? null,
          unit: args.unit ?? null,
          selected_action_id: args.selected_action_id ?? null,
          top_action_limit: args.top_action_limit ?? null,
          verbose: Boolean(args.verbose)
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
