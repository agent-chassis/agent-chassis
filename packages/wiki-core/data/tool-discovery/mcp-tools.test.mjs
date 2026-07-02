import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  TOOL_DISCOVERY_SCHEMA_VERSION,
  TOOL_DISCOVERY_FRAGMENT_KIND,
  TOOL_DISCOVERY_INSTALL_STATE_VALUES,
  TOOL_DISCOVERY_RUNTIME_POSTURE_VALUES,
  TOOL_DISCOVERY_RECOMMENDED_ROUTE_VALUES,
  TOOL_DISCOVERY_SIDE_EFFECT_VALUES,
  TOOL_DISCOVERY_AUTHORITY_VALUES,
  TOOL_DISCOVERY_AUDIENCE_VALUES,
  TOOL_DISCOVERY_CONTROLLED_TASK_IDS,
} from '../../src/lib/tool-discovery.mjs';

const FRAGMENT_FILE = 'mcp-tools.json';
const FRAGMENT_RELATIVE_PATH = `packages/wiki-core/data/tool-discovery/${FRAGMENT_FILE}`;
const MANIFEST_RELATIVE_PATH = 'packages/wiki-core/data/tool-discovery/manifest.json';
const LEGACY_AGGREGATE_BASENAME = 'tool-discovery.v1.json';
const fragmentUrl = new URL('./mcp-tools.json', import.meta.url);

const EXPECTED_TOOL_NAMES = [
  'get_contract_manifest',
  'workspace_agent_dispatch_identity_contract',
  'workspace_agent_faq',
  'workspace_autofix_docs_backlinks',
  'workspace_build_search_index',
  'workspace_docs_policy_validate',
  'workspace_generate_and_lint',
  'workspace_get_record',
  'workspace_lint_repo',
  'workspace_node_engine_admission_runtime_diagnostic',
  'workspace_read_mcp_content_reference',
  'workspace_read_page',
  'workspace_record_graph_impact_evidence',
  'workspace_record_review_attestation',
  'workspace_record_review_result_evidence',
  'workspace_run_validation',
  'workspace_search_repo',
  'workspace_tools_describe',
  'workspace_tools_list',
  'workspace_tools_query',
  'workspace_validate_dispatch',
];

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function assertRichToolEntry(tool) {
  const name = tool.tool_name;
  assert.equal(typeof name === 'string' && name.length > 0, true, 'tool_name must be a non-empty string');

  assert.equal(typeof tool.display_name === 'string' && tool.display_name.length > 0, true, `${name} display_name`);
  assert.equal(tool.kind, 'mcp_tool', `${name} must be an mcp_tool`);
  assert.equal(tool.entrypoint, name, `${name} entrypoint must equal tool_name`);

  assert.ok(Array.isArray(tool.task_ids) && tool.task_ids.length > 0, `${name} must declare task_ids`);
  for (const taskId of tool.task_ids) {
    assert.ok(TOOL_DISCOVERY_CONTROLLED_TASK_IDS.includes(taskId), `${name} task_id ${taskId} must be controlled`);
  }

  assert.ok(TOOL_DISCOVERY_INSTALL_STATE_VALUES.includes(tool.install_state), `${name} install_state controlled`);
  assert.ok(TOOL_DISCOVERY_RUNTIME_POSTURE_VALUES.includes(tool.runtime_posture), `${name} runtime_posture controlled`);
  assert.ok(TOOL_DISCOVERY_RECOMMENDED_ROUTE_VALUES.includes(tool.recommended_route), `${name} recommended_route controlled`);
  assert.ok(Number.isInteger(tool.priority) && tool.priority >= 0, `${name} priority non-negative integer`);

  assert.ok(Array.isArray(tool.side_effects) && tool.side_effects.length > 0, `${name} must declare side_effects`);
  for (const effect of tool.side_effects) {
    assert.ok(TOOL_DISCOVERY_SIDE_EFFECT_VALUES.includes(effect), `${name} side_effect ${effect} controlled`);
  }
  assert.ok(Array.isArray(tool.authority) && tool.authority.length > 0, `${name} must declare authority`);
  for (const authority of tool.authority) {
    assert.ok(TOOL_DISCOVERY_AUTHORITY_VALUES.includes(authority), `${name} authority ${authority} controlled`);
  }
  assert.ok(Array.isArray(tool.docs_refs) && tool.docs_refs.length > 0, `${name} must declare docs_refs`);
  assert.ok(Array.isArray(tool.source_files) && tool.source_files.length > 0, `${name} must declare source_files`);

  assert.ok(Array.isArray(tool.audience) && tool.audience.length > 0, `${name} must carry explicit audience`);
  assert.ok(tool.audience.includes('agent'), `${name} audience must include agent`);
  for (const audience of tool.audience) {
    assert.ok(TOOL_DISCOVERY_AUDIENCE_VALUES.includes(audience), `${name} audience ${audience} controlled`);
  }

  for (const sourceFile of tool.source_files) {
    assert.equal(
      sourceFile.includes(LEGACY_AGGREGATE_BASENAME),
      false,
      `${name} source_files must not reference the legacy aggregate ${LEGACY_AGGREGATE_BASENAME}`,
    );
  }
}

test('mcp-tools fragment is a canonical rich tool-discovery-fragment', async () => {
  const fragment = await readJson(fragmentUrl);

  assert.equal(fragment.schema_version, TOOL_DISCOVERY_SCHEMA_VERSION);
  assert.equal(fragment.kind, TOOL_DISCOVERY_FRAGMENT_KIND);
  assert.equal(fragment.repository, 'agent-chassis/agent-chassis');

  assert.equal(fragment.fragment, FRAGMENT_FILE);
  assert.equal(
    typeof fragment.summary === 'string' && fragment.summary.trim().length > 0,
    true,
    'fragment must carry a summary',
  );
  assert.equal(fragment.tool_count, EXPECTED_TOOL_NAMES.length);
  assert.ok(Array.isArray(fragment.tools), 'fragment.tools must be an array');
  assert.equal(fragment.tools.length, fragment.tool_count);
});

test('mcp-tools fragment registers exactly the supported agent-safe MCP routes', async () => {
  const fragment = await readJson(fragmentUrl);
  const toolNames = fragment.tools.map((tool) => tool.tool_name).sort();

  assert.deepEqual(toolNames, [...EXPECTED_TOOL_NAMES].sort());

  for (const tool of fragment.tools) {
    assert.equal(
      /^workspace_(repo|write)$/.test(tool.tool_name),
      false,
      `${tool.tool_name} is an unsupported placeholder and must not be registered`,
    );
    if (tool.runtime_posture === 'supported') {
      assert.notEqual(
        tool.install_state,
        'missing',
        `${tool.tool_name} cannot be supported while install_state is missing`,
      );
    }
  }
});

test('mcp-tools fragment entries carry full rich descriptor metadata', async () => {
  const fragment = await readJson(fragmentUrl);
  for (const tool of fragment.tools) {
    assertRichToolEntry(tool);
  }
});

test('workspace_tools_list source_files anchor on the manifest and owning fragment', async () => {
  const fragment = await readJson(fragmentUrl);
  const listEntry = fragment.tools.find((tool) => tool.tool_name === 'workspace_tools_list');
  assert.ok(listEntry, 'workspace_tools_list must be present');
  assert.ok(
    listEntry.source_files.includes(MANIFEST_RELATIVE_PATH),
    'workspace_tools_list source_files must include the fragment manifest',
  );
  assert.ok(
    listEntry.source_files.includes(FRAGMENT_RELATIVE_PATH),
    'workspace_tools_list source_files must include the owning mcp-tools fragment',
  );
});
