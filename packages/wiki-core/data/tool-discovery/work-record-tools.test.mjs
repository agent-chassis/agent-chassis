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

const FRAGMENT_FILE = 'work-record-tools.json';
const LEGACY_AGGREGATE_BASENAME = 'tool-discovery.v1.json';
const fragmentUrl = new URL('./work-record-tools.json', import.meta.url);

const EXPECTED_MCP_TOOL_NAMES = [
  'workspace_create_record',
  'workspace_work_record_cleanup_derived_evidence',
  'workspace_work_record_delete_slice',
  'workspace_work_record_refresh_admission_metrics',
  'workspace_work_record_refresh_target_resolution_evidence',
  'workspace_work_record_set_acceptance',
  'workspace_work_record_set_closure',
  'workspace_work_record_set_list_field',
  'workspace_work_record_set_status',
  'workspace_work_record_set_task',
  'workspace_work_record_shape_review_unit',
  'workspace_work_record_summary',
  'workspace_work_record_upsert_slice',
  'workspace_work_record_validate',
];

const EXPECTED_CLI_COMMAND_NAMES = [
  'wiki-create-issue',
  'wiki-work-record-migration',
  'wiki-work-records-cleanup-derived-evidence',
  'wiki-work-records-delete-slice',
  'wiki-work-records-refresh-admission-metrics',
  'wiki-work-records-set-acceptance',
  'wiki-work-records-set-closure',
  'wiki-work-records-set-list-field',
  'wiki-work-records-set-status',
  'wiki-work-records-set-task',
  'wiki-work-records-shape-review-unit',
  'wiki-work-records-summary',
  'wiki-work-records-upsert-slice',
  'wiki-work-records-validate',
];

const EXPECTED_TOOL_NAMES = [...EXPECTED_MCP_TOOL_NAMES, ...EXPECTED_CLI_COMMAND_NAMES];

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function assertRichToolEntry(tool) {
  const name = tool.tool_name;
  assert.equal(typeof name === 'string' && name.length > 0, true, 'tool_name must be a non-empty string');

  assert.equal(typeof tool.display_name === 'string' && tool.display_name.length > 0, true, `${name} display_name`);
  assert.ok(['mcp_tool', 'cli_command'].includes(tool.kind), `${name} kind must be mcp_tool or cli_command`);
  assert.equal(typeof tool.entrypoint === 'string' && tool.entrypoint.length > 0, true, `${name} entrypoint`);

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

  if (tool.kind === 'mcp_tool') {

    assert.equal(tool.entrypoint, name, `${name} mcp_tool entrypoint must equal tool_name`);
    assert.ok(Array.isArray(tool.audience) && tool.audience.length > 0, `${name} must carry explicit audience`);
    assert.ok(tool.audience.includes('agent'), `${name} audience must include agent`);
  }
  if (Array.isArray(tool.audience)) {
    for (const audience of tool.audience) {
      assert.ok(TOOL_DISCOVERY_AUDIENCE_VALUES.includes(audience), `${name} audience ${audience} controlled`);
    }
  }

  for (const sourceFile of tool.source_files) {
    assert.equal(
      sourceFile.includes(LEGACY_AGGREGATE_BASENAME),
      false,
      `${name} source_files must not reference the legacy aggregate ${LEGACY_AGGREGATE_BASENAME}`,
    );
  }
}

test('work-record-tools fragment is a canonical rich tool-discovery-fragment', async () => {
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

test('work-record-tools fragment registers the expected MCP routes and CLI fallbacks', async () => {
  const fragment = await readJson(fragmentUrl);

  const mcpNames = fragment.tools.filter((tool) => tool.kind === 'mcp_tool').map((tool) => tool.tool_name).sort();
  const cliNames = fragment.tools.filter((tool) => tool.kind === 'cli_command').map((tool) => tool.tool_name).sort();
  const allNames = fragment.tools.map((tool) => tool.tool_name).sort();

  assert.deepEqual(mcpNames, [...EXPECTED_MCP_TOOL_NAMES].sort());
  assert.deepEqual(cliNames, [...EXPECTED_CLI_COMMAND_NAMES].sort());
  assert.deepEqual(allNames, [...EXPECTED_TOOL_NAMES].sort());

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

test('work-record-tools fragment entries carry full rich descriptor metadata', async () => {
  const fragment = await readJson(fragmentUrl);
  for (const tool of fragment.tools) {
    assertRichToolEntry(tool);
  }
});
