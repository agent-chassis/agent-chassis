import assert from "node:assert/strict";
import test from "node:test";

import {
  parseToolProfile,
  shouldExposeTool
} from "../packages/wiki-mcp/src/lib/tool-profile.mjs";
import { workspaceInitiativeStatus } from "../packages/wiki-core/src/lib/initiative-status.mjs";

const INITIATIVE_STATUS_TOOL = "workspace_initiative_status";
const prettyJsonBytes = value => Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");

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

test("workspace initiative status keeps the agent-safe default consistency projection bounded", () => {
  const slices = Array.from({ length: 100 }, (_, index) => ({
    id: `SLICE-${String(index + 1).padStart(3, "0")}`,
    status: "review"
  }));
  const result = workspaceInitiativeStatus({
    initiative: "IN-PROFILE-TEST",
    records: [{
      id: "WK-9999",
      initiative: "IN-PROFILE-TEST",
      status: "done",
      slices
    }]
  });

  assert.equal(result.consistency_total, 100);
  assert.equal(result.consistency_returned, result.consistency.length);
  assert.equal(result.consistency_truncated, true);
  assert.ok(result.consistency.length < result.consistency_total);
  assert.ok(prettyJsonBytes(result) <= 4096);
});
