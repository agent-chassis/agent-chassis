import assert from "node:assert/strict";
import test from "node:test";

import {
  parseToolProfile,
  shouldExposeTool
} from "../packages/wiki-mcp/src/lib/tool-profile.mjs";

const INITIATIVE_STATUS_TOOL = "workspace_initiative_status";

test("WK-1132#SLICE-040 exposes initiative status to agent-safe but not worker profile", () => {
  const agentSafeProfile = parseToolProfile({
    WIKI_MCP_TOOL_PROFILE: "agent-safe"
  });
  const workerProfile = parseToolProfile({
    WIKI_MCP_TOOL_PROFILE: "worker"
  });

  assert.equal(
    shouldExposeTool(agentSafeProfile, INITIATIVE_STATUS_TOOL),
    true
  );
  assert.equal(
    shouldExposeTool(workerProfile, INITIATIVE_STATUS_TOOL),
    false
  );
});
