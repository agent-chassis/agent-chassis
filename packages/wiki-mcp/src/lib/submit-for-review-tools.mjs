

import {
  createSubmitForReviewRefusal,
  createSubmitForReviewResponse,
  trimmed,
  WORKSPACE_SUBMIT_FOR_REVIEW_TOOL_NAME
} from "./server-composition-helpers.mjs";

export function registerSubmitForReviewTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  setWorkRecordStatusByUnit
}) {
  registerTool(
    WORKSPACE_SUBMIT_FOR_REVIEW_TOOL_NAME,
    {
      description:
        "Set the launcher-assigned WK or slice status to review. Worker-only and write-capable; the assigned unit is environment-bound, and no caller-supplied unit, status, or other field is accepted.",
      inputSchema: z.object({}).strict()
    },
    async () => {
      try {
        const assignedUnit = trimmed(process.env.WIKI_MCP_ASSIGNED_UNIT);
        if (!assignedUnit) {
          return jsonContent(
            createSubmitForReviewRefusal("submit_for_review.missing_assigned_unit.v1", [
              "WIKI_MCP_ASSIGNED_UNIT is not set; workspace_submit_for_review is only available for launcher-assigned worker-profile sessions"
            ])
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos);
        const result = await setWorkRecordStatusByUnit({
          dir: workspace.dir,
          unitAddress: assignedUnit,
          status: "review"
        });
        return jsonContent(createSubmitForReviewResponse(workspace.repo, assignedUnit, result));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
