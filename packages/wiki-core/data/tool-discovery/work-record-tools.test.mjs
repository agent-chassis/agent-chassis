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

const LEGACY_AGGREGATE_BASENAME = 'tool-discovery.v1.json';

const WORK_RECORD_FRAGMENTS = [
  {
    file: 'work-record-core-mcp-tools.json',
    mcp: [
      'workspace_create_record',
      'workspace_work_record_set_closure',
      'workspace_work_record_set_status',
      'workspace_work_record_set_task',
      'workspace_work_record_summary',
      'workspace_work_record_validate',
    ],
    cli: [],
  },
  {
    file: 'work-record-core-cli-tools.json',
    mcp: [],
    cli: [
      'wiki-create-issue',
      'wiki-work-record-migration',
      'wiki-work-records-set-closure',
      'wiki-work-records-set-status',
      'wiki-work-records-set-task',
      'wiki-work-records-summary',
      'wiki-work-records-validate',
    ],
  },
  {
    file: 'work-record-edit-mcp-tools.json',
    mcp: [
      'workspace_work_record_cleanup_derived_evidence',
      'workspace_work_record_delete_slice',
      'workspace_work_record_ready_slice',
      'workspace_work_record_refresh_admission_metrics',
      'workspace_work_record_refresh_target_resolution_evidence',
      'workspace_work_record_set_acceptance',
      'workspace_work_record_set_list_field',
      'workspace_work_record_shape_review_unit',
      'workspace_work_record_upsert_slice',
    ],
    cli: [],
  },
  {
    file: 'work-record-edit-cli-tools.json',
    mcp: [],
    cli: [
      'wiki-work-records-cleanup-derived-evidence',
      'wiki-work-records-delete-slice',
      'wiki-work-records-refresh-admission-metrics',
      'wiki-work-records-set-acceptance',
      'wiki-work-records-set-list-field',
      'wiki-work-records-shape-review-unit',
      'wiki-work-records-upsert-slice',
    ],
  },
];

const EXPECTED_MCP_TOOL_NAMES = WORK_RECORD_FRAGMENTS.flatMap((entry) => entry.mcp);

const EXPECTED_CLI_COMMAND_NAMES = WORK_RECORD_FRAGMENTS.flatMap((entry) => entry.cli);

const EXPECTED_TOOL_NAMES = [...EXPECTED_MCP_TOOL_NAMES, ...EXPECTED_CLI_COMMAND_NAMES];

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function readFragment(file) {
  return readJson(new URL(`./${file}`, import.meta.url));
}

async function readFamilyTools() {
  const tools = [];
  for (const entry of WORK_RECORD_FRAGMENTS) {
    const fragment = await readFragment(entry.file);
    tools.push(...fragment.tools);
  }
  return tools;
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

function assertRoutingGuidance(tools, toolName, expected) {
  const tool = tools.find((entry) => entry.tool_name === toolName);
  assert.ok(tool, `${toolName} must be present in the work-record fragment family`);
  assert.deepEqual(tool.use_when, expected.use_when, `${toolName} use_when`);
  assert.deepEqual(tool.do_not_use_when, expected.do_not_use_when, `${toolName} do_not_use_when`);
  assert.deepEqual(tool.authoritative_for, expected.authoritative_for, `${toolName} authoritative_for`);
  assert.deepEqual(tool.recommended_first_call, expected.recommended_first_call, `${toolName} recommended_first_call`);
  assert.deepEqual(tool.requires_prior_state, expected.requires_prior_state, `${toolName} requires_prior_state`);
  assert.deepEqual(tool.replacement_for_misuse, expected.replacement_for_misuse, `${toolName} replacement_for_misuse`);
}

test('every work-record fragment is a canonical rich tool-discovery-fragment', async () => {
  for (const entry of WORK_RECORD_FRAGMENTS) {
    const fragment = await readFragment(entry.file);
    const expectedCount = entry.mcp.length + entry.cli.length;

    assert.equal(fragment.schema_version, TOOL_DISCOVERY_SCHEMA_VERSION, entry.file);
    assert.equal(fragment.kind, TOOL_DISCOVERY_FRAGMENT_KIND, entry.file);
    assert.equal(fragment.repository, 'agent-chassis/agent-chassis', entry.file);

    assert.equal(fragment.fragment, entry.file, `${entry.file} self-id`);
    assert.equal(
      typeof fragment.summary === 'string' && fragment.summary.trim().length > 0,
      true,
      `${entry.file} must carry a summary`,
    );
    assert.equal(fragment.tool_count, expectedCount, `${entry.file} tool_count`);
    assert.ok(Array.isArray(fragment.tools), `${entry.file} tools must be an array`);
    assert.equal(fragment.tools.length, fragment.tool_count, `${entry.file} tools length`);
  }
});

test('work-record fragments register the expected MCP routes and CLI fallbacks', async () => {

  for (const entry of WORK_RECORD_FRAGMENTS) {
    const fragment = await readFragment(entry.file);
    const mcp = fragment.tools.filter((tool) => tool.kind === 'mcp_tool').map((tool) => tool.tool_name).sort();
    const cli = fragment.tools.filter((tool) => tool.kind === 'cli_command').map((tool) => tool.tool_name).sort();

    assert.deepEqual(mcp, [...entry.mcp].sort(), `${entry.file} owns exactly its mcp_tool routes`);
    assert.deepEqual(cli, [...entry.cli].sort(), `${entry.file} owns exactly its cli_command rows`);
  }

  const familyTools = await readFamilyTools();
  const mcpNames = familyTools.filter((tool) => tool.kind === 'mcp_tool').map((tool) => tool.tool_name).sort();
  const cliNames = familyTools.filter((tool) => tool.kind === 'cli_command').map((tool) => tool.tool_name).sort();
  const allNames = familyTools.map((tool) => tool.tool_name).sort();

  assert.deepEqual(mcpNames, [...EXPECTED_MCP_TOOL_NAMES].sort());
  assert.deepEqual(cliNames, [...EXPECTED_CLI_COMMAND_NAMES].sort());
  assert.deepEqual(allNames, [...EXPECTED_TOOL_NAMES].sort());

  for (const tool of familyTools) {
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

test('work-record fragment entries carry full rich descriptor metadata', async () => {
  for (const tool of await readFamilyTools()) {
    assertRichToolEntry(tool);
  }
});

test('hot work-record tools carry routing guidance metadata', async () => {
  const familyTools = await readFamilyTools();

  assertRoutingGuidance(familyTools, 'workspace_work_record_summary', {
    use_when: ['selected_work_record_context', 'selected_slice_detail'],
    do_not_use_when: ['initiative status/action', 'dispatch readiness', 'work-record mutation'],
    authoritative_for: ['compact selected_work_record_context', 'compact selected_slice_detail'],
    recommended_first_call: {
      routing_intents: ['selected_work_record_context', 'selected_slice_detail'],
      arguments: { unit: '$known_WK_or_slice_unit' },
      omit_null_arguments: true,
    },
    requires_prior_state: ['known WK-* or WK-*#SLICE-*'],
    replacement_for_misuse: [
      {
        misuse_code: 'full_read_without_selected_resource',
        routing_intent: 'selected_work_record_context',
        use_instead: 'workspace_work_record_summary',
      },
      {
        misuse_code: 'high_output_option_without_compact_first',
        routing_intent: 'selected_slice_detail',
        use_instead: 'workspace_work_record_summary',
      },
      {
        misuse_code: 'bulk_sampling_without_lens',
        routing_intent: 'initiative_frontier_lens',
        use_instead: 'workspace_initiative_status',
      },
    ],
  });

  const mutationTools = [
    ['workspace_create_record', 'create', ['record kind', 'title/scope', 'no existing WK target'], ['allocator-backed record creation']],
    ['workspace_work_record_set_status', 'status', ['unit', 'status'], ['status work-record mutations']],
    ['workspace_work_record_set_task', 'task', ['unit', 'task selector/value'], ['task work-record mutations']],
    ['workspace_work_record_set_closure', 'closure', ['unit', 'closure patch'], ['closure work-record mutations']],
    ['workspace_work_record_upsert_slice', 'slice upsert', ['WK unit', 'slice body'], ['slice upsert work-record mutations']],
    ['workspace_work_record_delete_slice', 'slice delete', ['WK unit', 'slice id'], ['slice delete work-record mutations']],
    ['workspace_work_record_set_list_field', 'list field', ['unit', 'field', 'values'], ['list-field work-record mutations']],
    ['workspace_work_record_set_acceptance', 'acceptance', ['unit', 'criteria/validation'], ['acceptance work-record mutations']],
    ['workspace_work_record_shape_review_unit', 'review unit shaping', ['unit', 'review role intent'], ['review-unit work-record mutations']],
  ];

  for (const [toolName, operation, requires_prior_state, authoritative_for] of mutationTools) {
    assertRoutingGuidance(familyTools, toolName, {
      use_when: ['work_record_mutation', `mutation_operation=${operation}`],
      do_not_use_when:
        toolName === 'workspace_create_record'
          ? ['existing WK/slice update', 'read-only context']
          : ['read-only context', 'different mutation route'],
      authoritative_for,
      recommended_first_call: { routing_intents: ['work_record_mutation'], operation },
      requires_prior_state,
      replacement_for_misuse: [
        {
          misuse_code: 'ignored_required_next_action',
          routing_intent: 'work_record_mutation',
          use_instead: toolName,
        },
      ],
    });
  }
});
