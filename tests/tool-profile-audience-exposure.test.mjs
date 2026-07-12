

import assert from "node:assert/strict";
import test from "node:test";

import { WORKER_COMMIT_TOOL_NAME } from "../packages/agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import {
  parseToolProfile,
  shouldExposeTool,
  SESSION_ROLE_VALUES
} from "../packages/wiki-mcp/src/lib/tool-profile.mjs";

const SUBMIT_FOR_REVIEW = "workspace_submit_for_review";

test("known session roles are exactly the five policy roles", () => {
  assert.deepEqual(
    [...SESSION_ROLE_VALUES].sort(),
    ["operator", "orchestrator", "redteam", "reviewer", "worker"]
  );
});

test("orchestrator gets content reads, process-measurement reads, and authority; not delivery or cache writers", () => {
  const role = "orchestrator";
  for (const name of [
    "workspace_search_repo",
    "workspace_read_page",
    "workspace_validate_dispatch",
    "workspace_coordination_preflight",
    "workspace_initiative_status",
    "workspace_agent_run_wait",
    "workspace_node_engine_admission_runtime_diagnostic",
    "workspace_work_record_set_status",
    "workspace_agent_dispatch",
    "workspace_generate_and_lint"
  ]) {
    assert.equal(shouldExposeTool(role, name), true, `orchestrator must see ${name}`);
  }
  for (const name of [
    WORKER_COMMIT_TOOL_NAME,
    SUBMIT_FOR_REVIEW,
    "workspace_build_search_index",
    "workspace_code_index_build"
  ]) {
    assert.equal(shouldExposeTool(role, name), false, `orchestrator must not see ${name}`);
  }
});

test("reviewer and redteam get broad CONTENT reads + submit-for-review, but no process-measurement or authority", () => {
  for (const role of ["reviewer", "redteam"]) {
    for (const name of [
      "workspace_search_repo",
      "workspace_read_page",
      "workspace_get_record",
      "workspace_code_index_callers",
      "workspace_work_record_validate",
      "workspace_work_record_summary",
      SUBMIT_FOR_REVIEW
    ]) {
      assert.equal(shouldExposeTool(role, name), true, `${role} must see ${name}`);
    }

    for (const name of [
      "workspace_validate_dispatch",
      "workspace_coordination_preflight",
      "workspace_initiative_status",
      "workspace_integration_status",
      "workspace_agent_run_status",
      "workspace_agent_run_wait",
      "workspace_node_engine_admission_runtime_diagnostic",
      "workspace_work_record_set_status",
      "workspace_agent_dispatch",
      "workspace_create_record",
      WORKER_COMMIT_TOOL_NAME
    ]) {
      assert.equal(shouldExposeTool(role, name), false, `${role} must not see ${name}`);
    }
  }
});

test("worker gets exactly commit + submit-for-review", () => {
  const role = "worker";
  assert.equal(shouldExposeTool(role, WORKER_COMMIT_TOOL_NAME), true);
  assert.equal(shouldExposeTool(role, SUBMIT_FOR_REVIEW), true);
  for (const name of [
    "workspace_search_repo",
    "workspace_read_page",
    "workspace_work_record_validate",
    "workspace_work_record_set_status"
  ]) {
    assert.equal(shouldExposeTool(role, name), false, `worker must not see ${name}`);
  }
});

test("operator (and the full alias) see the entire surface, including cache writers", () => {
  for (const profile of ["operator", "full"]) {
    for (const name of [
      "workspace_build_search_index",
      "workspace_code_index_rebuild",
      WORKER_COMMIT_TOOL_NAME,
      SUBMIT_FOR_REVIEW,
      "some_unlisted_tool_name"
    ]) {
      assert.equal(shouldExposeTool(profile, name), true, `${profile} must see ${name}`);
    }
  }
});

test("agent-safe resolves to the orchestrator surface (transition alias)", () => {
  for (const name of [
    "workspace_search_repo",
    "workspace_validate_dispatch",
    "workspace_work_record_set_status",
    WORKER_COMMIT_TOOL_NAME,
    SUBMIT_FOR_REVIEW,
    "workspace_build_search_index"
  ]) {
    assert.equal(
      shouldExposeTool("agent-safe", name),
      shouldExposeTool("orchestrator", name),
      `agent-safe must mirror orchestrator for ${name}`
    );
  }
});

test("shouldExposeTool ignores any caller-threaded descriptor-derived set", () => {

  assert.equal(
    shouldExposeTool("reviewer", "workspace_agent_dispatch", {
      roleToolNames: new Set(["workspace_agent_dispatch"]),
      agentSafeToolNames: new Set(["workspace_agent_dispatch"])
    }),
    false
  );

  assert.equal(
    shouldExposeTool("reviewer", "workspace_search_repo", {
      roleToolNames: new Set(),
      agentSafeToolNames: new Set()
    }),
    true
  );
});

test("an unknown/unmintable profile is exposed nothing (fail closed)", () => {
  assert.equal(shouldExposeTool("nonsense-role", "workspace_search_repo"), false);
  assert.throws(() => parseToolProfile({ WIKI_MCP_TOOL_PROFILE: "nonsense-role" }));
});

test("an absent or empty profile is rejected (fail closed)", () => {
  for (const env of [
    {},
    { WIKI_MCP_TOOL_PROFILE: "" },
    { WIKI_MCP_TOOL_PROFILE: "   " }
  ]) {
    assert.throws(
      () => parseToolProfile(env),
      /WIKI_MCP_TOOL_PROFILE is required.*absent or empty profile/s
    );
  }
});
