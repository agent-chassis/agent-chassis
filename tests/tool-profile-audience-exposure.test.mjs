import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadToolDiscoveryDescriptor } from "../packages/wiki-core/src/lib/tool-discovery.mjs";
import { WORKER_COMMIT_TOOL_NAME } from "../packages/agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import {
  deriveAgentSafeToolNamesFromDescriptor,
  loadAgentSafeToolNamesFromDescriptor,
  shouldExposeTool
} from "../packages/wiki-mcp/src/lib/tool-profile.mjs";

const PRIOR_HARDCODED_AGENT_SAFE_NAMES = Object.freeze([
  "get_contract_manifest",
  "workspace_agent_dispatch",
  "workspace_agent_dispatch_identity_contract",
  "workspace_agent_faq",
  "workspace_agent_run_status",
  "workspace_agent_run_wait",
  "workspace_autofix_docs_backlinks",
  "workspace_build_search_index",
  "workspace_code_index_build",
  "workspace_code_index_context_for_path",
  "workspace_code_index_graph_impact_diff",
  "workspace_code_index_graph_impact_paths",
  "workspace_code_index_impact_paths",
  "workspace_code_index_rebuild",
  "workspace_code_index_status",
  "workspace_coordination_preflight",
  "workspace_create_record",
  "workspace_docs_policy_validate",
  "workspace_generate_and_lint",
  "workspace_get_record",
  "workspace_initiative_status",
  "workspace_lint_repo",
  "workspace_node_engine_admission_runtime_diagnostic",
  "workspace_read_mcp_content_reference",
  "workspace_read_page",
  "workspace_record_graph_impact_evidence",
  "workspace_record_review_attestation",
  "workspace_record_review_result_evidence",
  "workspace_run_validation",
  "workspace_runtime_blocker_taxonomy",
  "workspace_search_repo",
  "workspace_tool_router_recommend",
  "workspace_tools_describe",
  "workspace_tools_list",
  "workspace_tools_query",
  "workspace_validate_dispatch",
  "workspace_work_record_cleanup_derived_evidence",
  "workspace_work_record_delete_slice",
  "workspace_work_record_refresh_admission_metrics",
  "workspace_work_record_refresh_target_resolution_evidence",
  "workspace_work_record_set_acceptance",
  "workspace_work_record_set_closure",
  "workspace_work_record_set_list_field",
  "workspace_work_record_set_status",
  "workspace_work_record_set_task",
  "workspace_work_record_shape_review_unit",
  "workspace_work_record_summary",
  "workspace_work_record_upsert_slice",
  "workspace_work_record_validate"
]);

const EXPECTED_READ_ONLY_ADDITIONS = Object.freeze([
  "workspace_code_index_callees",
  "workspace_code_index_callers",
  "workspace_code_index_definition",
  "workspace_code_index_find_references",
  "workspace_integration_status"
]);

const EXPECTED_AGENT_SAFE_NAMES = Object.freeze([
  ...PRIOR_HARDCODED_AGENT_SAFE_NAMES,
  ...EXPECTED_READ_ONLY_ADDITIONS
].sort());

function installedSupportedMcpTool(toolName, overrides = {}) {
  return {
    tool_name: toolName,
    kind: "mcp_tool",
    install_state: "installed",
    runtime_posture: "supported",
    audience: ["agent"],
    ...overrides
  };
}

function sortedNames(set) {
  return [...set].sort();
}

test("derived descriptor agent-safe set matches the committed golden set", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const derivedNames = sortedNames(deriveAgentSafeToolNamesFromDescriptor(descriptor));

  assert.deepEqual(
    derivedNames,
    EXPECTED_AGENT_SAFE_NAMES,
    "agent-safe exposure must be exactly the prior hardcoded set plus the five reviewed read-only additions"
  );

  const additions = EXPECTED_AGENT_SAFE_NAMES.filter(
    (name) => !PRIOR_HARDCODED_AGENT_SAFE_NAMES.includes(name)
  );
  assert.deepEqual(additions, [...EXPECTED_READ_ONLY_ADDITIONS].sort());
});

test("agent-safe audience derivation fails closed for absent or non-literal agent audience", () => {
  const derivedNames = sortedNames(deriveAgentSafeToolNamesFromDescriptor({
    tools: [
      installedSupportedMcpTool("literal_agent"),
      installedSupportedMcpTool("missing_audience", { audience: undefined }),
      installedSupportedMcpTool("empty_audience", { audience: [] }),
      installedSupportedMcpTool("non_array_audience", { audience: "agent" }),
      installedSupportedMcpTool("substring_audience", { audience: ["agent-preview"] }),
      installedSupportedMcpTool("operator_only", { audience: ["operator"] })
    ]
  }));

  assert.deepEqual(derivedNames, ["literal_agent"]);
});

test("agent-safe audience derivation excludes non-live, non-installed, and non-MCP entries", () => {
  const derivedNames = sortedNames(deriveAgentSafeToolNamesFromDescriptor({
    tools: [
      installedSupportedMcpTool("live_mcp_tool"),
      installedSupportedMcpTool("deactivated_mcp_tool", { runtime_posture: "deactivated" }),
      installedSupportedMcpTool("conditional_mcp_tool", { runtime_posture: "conditional" }),
      installedSupportedMcpTool("package_file_only_mcp_tool", { install_state: "package_file_only" }),
      installedSupportedMcpTool("missing_name", { tool_name: "" }),
      installedSupportedMcpTool("wiki-agent-faq", { kind: "cli_command" })
    ]
  }));

  assert.deepEqual(derivedNames, ["live_mcp_tool"]);
});

test("agent-safe descriptor helper throws on missing or unparseable descriptor sources", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tool-profile-audience-"));
  try {
    await assert.rejects(
      loadAgentSafeToolNamesFromDescriptor(path.join(tempDir, "missing.json")),
      /ENOENT|no such file/i
    );

    const invalidPath = path.join(tempDir, "invalid.json");
    await writeFile(invalidPath, "{ not json", "utf8");
    await assert.rejects(
      loadAgentSafeToolNamesFromDescriptor(invalidPath),
      /not valid JSON/i
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("full and worker profiles do not consume the derived agent-safe audience set", () => {
  const injectedAgentSafeNames = new Set(["only_agent_safe"]);

  assert.equal(
    shouldExposeTool("full", "unlisted_tool", { agentSafeToolNames: new Set() }),
    true
  );
  assert.equal(
    shouldExposeTool("worker", WORKER_COMMIT_TOOL_NAME, {
      agentSafeToolNames: injectedAgentSafeNames
    }),
    true
  );
  assert.equal(
    shouldExposeTool("worker", "only_agent_safe", {
      agentSafeToolNames: injectedAgentSafeNames
    }),
    false
  );
});
