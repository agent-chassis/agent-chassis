import test from "node:test";
import assert from "node:assert/strict";

import {
  loadToolDiscoveryDescriptor,
  TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH,
  TOOL_DISCOVERY_INSTALL_STATE_VALUES,
  TOOL_DISCOVERY_RUNTIME_POSTURE_VALUES,
  TOOL_DISCOVERY_RECOMMENDED_ROUTE_VALUES,
  TOOL_DISCOVERY_SIDE_EFFECT_VALUES,
  TOOL_DISCOVERY_AUTHORITY_VALUES,
  TOOL_DISCOVERY_AUDIENCE_VALUES,
  TOOL_DISCOVERY_CONTROLLED_TASK_IDS
} from "../packages/wiki-core/src/lib/tool-discovery.mjs";

import { INITIALIZE_PARAMS, createMcpSession } from "./wiki-mcp-tool-discovery-helpers.mjs";

async function listRegisteredToolNames(session, idBase) {
  const listed = await session.request(idBase, "tools/list", {});
  assert.ok(
    Array.isArray(listed.tools) && listed.tools.length > 0,
    "tools/list must return a non-empty registered tool inventory"
  );
  return listed.tools.map((tool) => tool.name);
}

test("registered agent-safe MCP tools are all owned by the raw assembled descriptor before runtime augmentation", async () => {
  const session = createMcpSession({ env: { WIKI_MCP_TOOL_PROFILE: "agent-safe" } });
  let registeredAgentSafeToolNames;
  try {
    await session.request(1, "initialize", INITIALIZE_PARAMS);
    registeredAgentSafeToolNames = await listRegisteredToolNames(session, 2);
  } finally {
    await session.close();
  }

  assert.equal(
    new Set(registeredAgentSafeToolNames).size,
    registeredAgentSafeToolNames.length,
    "agent-safe tools/list names must be unique"
  );

  const canaryNames = [
    "workspace_agent_run_wait",
    "workspace_code_index_build",
    "workspace_code_index_rebuild",
    "workspace_code_index_graph_impact_diff",
    "get_contract_manifest",
    "workspace_build_search_index"
  ];
  for (const name of canaryNames) {
    assert.ok(
      registeredAgentSafeToolNames.includes(name),
      `agent-safe tools/list must register the ${name} canary so the parity check covers it`
    );
  }

  const rawDescriptor = await loadToolDiscoveryDescriptor();
  const rawMcpToolsByName = new Map();
  for (const entry of rawDescriptor.tools) {
    if (entry && entry.kind === "mcp_tool") {
      rawMcpToolsByName.set(entry.tool_name, entry);
    }
  }

  const runtimeAugmentationInjectedNames = [
    "workspace_tools_list",
    "workspace_work_record_set_status",
    "workspace_work_record_set_task",
    "workspace_work_record_refresh_admission_metrics",
    "workspace_work_record_refresh_target_resolution_evidence"
  ];
  for (const name of runtimeAugmentationInjectedNames) {
    assert.ok(
      rawMcpToolsByName.has(name),
      `${name} must be owned by the checked-in fragment registry, not introduced only by runtime descriptor augmentation`
    );
  }

  for (const name of registeredAgentSafeToolNames) {
    const entry = rawMcpToolsByName.get(name);
    assert.ok(
      entry,
      `registered agent-safe MCP tool ${name} must be present as an mcp_tool row in the raw assembled descriptor before runtime augmentation`
    );

    assert.equal(entry.entrypoint, name, `${name} entrypoint must match its tool_name`);
    assert.ok(
      TOOL_DISCOVERY_INSTALL_STATE_VALUES.includes(entry.install_state),
      `${name} install_state must be a controlled value`
    );
    assert.ok(
      TOOL_DISCOVERY_RUNTIME_POSTURE_VALUES.includes(entry.runtime_posture),
      `${name} runtime_posture must be a controlled value`
    );
    assert.ok(
      TOOL_DISCOVERY_RECOMMENDED_ROUTE_VALUES.includes(entry.recommended_route),
      `${name} recommended_route must be a controlled value`
    );
    assert.ok(
      Number.isInteger(entry.priority) && entry.priority >= 0,
      `${name} priority must be a non-negative integer`
    );

    assert.ok(
      Array.isArray(entry.task_ids) && entry.task_ids.length > 0,
      `${name} must declare at least one task_id`
    );
    for (const taskId of entry.task_ids) {
      assert.ok(
        TOOL_DISCOVERY_CONTROLLED_TASK_IDS.includes(taskId),
        `${name} task_id ${taskId} must be a controlled task id`
      );
    }

    assert.ok(
      Array.isArray(entry.side_effects) && entry.side_effects.length > 0,
      `${name} must declare side_effects`
    );
    for (const effect of entry.side_effects) {
      assert.ok(
        TOOL_DISCOVERY_SIDE_EFFECT_VALUES.includes(effect),
        `${name} side_effect ${effect} must be a controlled value`
      );
    }

    assert.ok(
      Array.isArray(entry.authority) && entry.authority.length > 0,
      `${name} must declare authority`
    );
    for (const authority of entry.authority) {
      assert.ok(
        TOOL_DISCOVERY_AUTHORITY_VALUES.includes(authority),
        `${name} authority ${authority} must be a controlled value`
      );
    }

    assert.ok(
      Object.prototype.hasOwnProperty.call(entry, "audience"),
      `${name} must carry an explicit audience field rather than relying on runtime default audience`
    );
    assert.ok(
      Array.isArray(entry.audience) && entry.audience.length > 0,
      `${name} audience must be a non-empty array`
    );
    assert.ok(entry.audience.includes("agent"), `${name} audience must include agent`);
    for (const audience of entry.audience) {
      assert.ok(
        TOOL_DISCOVERY_AUDIENCE_VALUES.includes(audience),
        `${name} audience ${audience} must be a controlled value`
      );
    }
  }
});

const TOOL_DISCOVERY_AGGREGATE_RELATIVE_PATH =
  "packages/wiki-core/data/tool-discovery.v1.json";
const TOOL_DISCOVERY_MCP_TOOLS_FRAGMENT_RELATIVE_PATH =
  "packages/wiki-core/data/tool-discovery/mcp-tools.json";

function assertWorkspaceToolsListSourceFiles(sourceFiles, context) {
  assert.ok(
    Array.isArray(sourceFiles) && sourceFiles.length > 0,
    `${context}: workspace_tools_list source_files must be a non-empty array`
  );
  assert.equal(
    sourceFiles.includes(TOOL_DISCOVERY_AGGREGATE_RELATIVE_PATH),
    false,
    `${context}: workspace_tools_list source_files must not reintroduce the legacy aggregate ${TOOL_DISCOVERY_AGGREGATE_RELATIVE_PATH}`
  );
  assert.equal(
    sourceFiles.some((entry) => entry.includes("tool-discovery.v1.json")),
    false,
    `${context}: workspace_tools_list source_files must not reference the legacy aggregate basename`
  );
  assert.ok(
    sourceFiles.includes(TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH),
    `${context}: workspace_tools_list source_files must include the fragment manifest ${TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH}`
  );
  assert.ok(
    sourceFiles.includes(TOOL_DISCOVERY_MCP_TOOLS_FRAGMENT_RELATIVE_PATH),
    `${context}: workspace_tools_list source_files must include the owning mcp-tools fragment ${TOOL_DISCOVERY_MCP_TOOLS_FRAGMENT_RELATIVE_PATH}`
  );
}

test("workspace_tools_list source_files exclude the legacy aggregate and include the fragment manifest plus owning mcp-tools fragment", async () => {

  const rawDescriptor = await loadToolDiscoveryDescriptor();
  const rawListEntry = (rawDescriptor.tools || []).find(
    (entry) => entry && entry.tool_name === "workspace_tools_list"
  );
  assert.ok(
    rawListEntry,
    "workspace_tools_list must be present as a row in the raw assembled descriptor"
  );
  assertWorkspaceToolsListSourceFiles(rawListEntry.source_files, "raw assembled descriptor");

  const session = createMcpSession();
  try {
    await session.request(1, "initialize", INITIALIZE_PARAMS);

    const queryEnvelope = (
      await session.request(2, "tools/call", {
        name: "workspace_tools_query",
        arguments: {
          tool_name: "workspace_tools_list",
          verbose: true
        }
      })
    ).structuredContent;
    assert.equal(queryEnvelope.interface, "mcp");
    assert.equal(queryEnvelope.source_kind, "runtime_snapshot");
    assert.equal(queryEnvelope.descriptor.path, TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH);
    assert.deepEqual(queryEnvelope.query, { tool_name: "workspace_tools_list" });

    const runtimeListResult = queryEnvelope.results.find(
      (result) => result.tool_name === "workspace_tools_list"
    );
    assert.ok(
      runtimeListResult,
      "workspace_tools_query must surface the workspace_tools_list row at runtime"
    );
    assertWorkspaceToolsListSourceFiles(
      runtimeListResult.source_files,
      "runtime workspace_tools_query verbose result"
    );

    assert.deepEqual(
      runtimeListResult.source_files,
      rawListEntry.source_files,
      "runtime workspace_tools_list source_files must match the raw assembled fragment row"
    );
  } finally {
    await session.close();
  }
});
