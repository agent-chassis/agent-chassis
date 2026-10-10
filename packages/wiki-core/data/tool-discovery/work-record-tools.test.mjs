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
  { file: 'work-record-core-mcp-tools.json', mcp: [], cli: [] },
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
  { file: 'work-record-edit-mcp-tools.json', mcp: [], cli: [] },
  {
    file: 'work-record-edit-cli-tools.json',
    mcp: [],
    cli: [
      'wiki-work-records-cleanup-derived-evidence',
      'wiki-work-records-delete-slice',
      'wiki-work-records-refresh-admission-metrics',
      'wiki-work-records-set-list-field',
      'wiki-work-records-shape-review-unit',
      'wiki-work-records-upsert-slice',
    ],
  },
];

const TASK_MCP_FRAGMENT = 'mcp-tools.json';

const CURRENT_WORK_RECORD_MCP_ROUTES = [
  'workspace_read_wiki',
  'workspace_create_record',
  'save_record',
];

const RETIRED_WORK_RECORD_MCP_ROUTES = [
  'workspace_record_staleness_check',
  'workspace_work_record_entry_read',
  'workspace_work_record_entry_upsert',
  'workspace_work_record_set_closure',
  'workspace_work_record_set_status',
  'workspace_work_record_summary',
  'workspace_work_record_validate',
  'workspace_work_record_delete_slice',
  'workspace_work_record_ready_slice',
  'workspace_work_record_refresh_admission_metrics',
  'workspace_work_record_refresh_target_resolution_evidence',
  'workspace_work_record_edit',
  'workspace_work_record_shape_review_unit',
  'workspace_work_record_upsert_slice',
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

async function readManifestFragments() {
  const manifest = await readJson(new URL('./manifest.json', import.meta.url));
  return Promise.all(manifest.fragments.map(async ({ file }) => [file, await readFragment(file)]));
}

async function readTaskTool(toolName) {
  const fragment = await readFragment(TASK_MCP_FRAGMENT);
  const tool = fragment.tools.find((entry) => entry.tool_name === toolName);
  assert.ok(tool, `${toolName} must be present in ${TASK_MCP_FRAGMENT}`);
  return tool;
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

  const owners = new Map();
  for (const [file, fragment] of await readManifestFragments()) {
    for (const tool of fragment.tools) {
      owners.set(tool.tool_name, [...(owners.get(tool.tool_name) ?? []), file]);
    }
  }
  for (const route of CURRENT_WORK_RECORD_MCP_ROUTES) {
    assert.deepEqual(owners.get(route), [TASK_MCP_FRAGMENT], `${route} has one owning fragment`);
  }
  for (const retired of RETIRED_WORK_RECORD_MCP_ROUTES) {
    assert.equal(owners.has(retired), false, `${retired} is retired and must not be advertised`);
  }

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

const TASK_ROUTE_BOUNDARY = 'The request needs an ungranted role, caller-selected repository or another task.';

function taskRouteGuidance(meaning, firstCallArguments) {
  return {
    use_when: [meaning],
    do_not_use_when: [TASK_ROUTE_BOUNDARY],
    authoritative_for: [meaning],
    recommended_first_call: { operation: meaning, arguments: firstCallArguments, omit_null_arguments: true },
    requires_prior_state: undefined,
    replacement_for_misuse: undefined,
  };
}

const READ_WIKI_NOTES =
  'Read compact canonical context, then one semantic selection from its returned reference. ' +
  "A WK subject's context facts carry the advisory terminal_review_designation; a findings unit's " +
  'context facts and each inventory:"slices" member carry its effective review_purpose when one exists. ' +
  'Both are read-only observations of the saved record that grant or withhold no dispatch, admission, ' +
  'integration or handoff decision.';

const CURRENT_WORK_RECORD_ROUTE_CONTRACTS = [
  {
    toolName: 'workspace_read_wiki',
    meaning: 'Read compact canonical context, then one semantic selection from its returned reference.',
    notes: READ_WIKI_NOTES,
    firstCallArguments: { subject: '$canonical_subject' },
    task_ids: ['read-canonical'],
    side_effects: ['read_only'],
  },
  {
    toolName: 'workspace_create_record',
    meaning: 'Create one draft with explicit initial meaning and retain creation and maintenance observations.',
    firstCallArguments: { kind: '$record_kind', title: '$title', initial: '$initial' },
    task_ids: ['create-work-record'],
    side_effects: ['workspace_write'],
  },
  {
    toolName: 'save_record',
    meaning: 'Save one coherent change at the returned revision; immutable maintenance retries repeat no canonical mutation.',
    firstCallArguments: { unit: '$unit', revision: '$revision', changes: '$changes' },
    task_ids: ['contract-edit'],
    side_effects: ['workspace_write'],
  },
];

test('current work-record task routes carry routing guidance metadata', async () => {
  const fragment = await readFragment(TASK_MCP_FRAGMENT);
  assert.deepEqual(
    CURRENT_WORK_RECORD_ROUTE_CONTRACTS.map(({ toolName }) => toolName).sort(),
    [...CURRENT_WORK_RECORD_MCP_ROUTES].sort(),
    'every current work-record route is pinned',
  );
  for (const contract of CURRENT_WORK_RECORD_ROUTE_CONTRACTS) {
    assertRoutingGuidance(
      fragment.tools,
      contract.toolName,
      taskRouteGuidance(contract.meaning, contract.firstCallArguments),
    );
    const tool = await readTaskTool(contract.toolName);
    assertRichToolEntry(tool);
    assert.equal(tool.notes, contract.notes ?? contract.meaning, `${contract.toolName} notes`);
    assert.deepEqual(tool.task_ids, contract.task_ids, `${contract.toolName} task_ids`);
    assert.deepEqual(tool.side_effects, contract.side_effects, `${contract.toolName} side_effects`);
    assert.equal(tool.install_state, 'installed');
    assert.equal(tool.runtime_posture, 'supported');
    assert.equal(tool.recommended_route, 'mcp');
    assert.ok(tool.docs_refs.includes('docs/mcp-operation-reference.md'), contract.toolName);
  }

  const editOwners = [];
  for (const [, candidate] of await readManifestFragments()) {
    editOwners.push(...candidate.tools
      .filter((tool) => tool.kind === 'mcp_tool' && tool.task_ids.includes('contract-edit'))
      .map((tool) => tool.tool_name));
  }
  assert.deepEqual(editOwners, ['save_record']);
});

test('workspace_read_wiki discovery stays a read-only observation that claims no authority', async () => {
  const readTool = await readTaskTool('workspace_read_wiki');

  const notes = readTool.notes;
  assert.equal(typeof notes === 'string' && notes.length > 0, true, 'read notes must be prose');
  const published = [
    notes,
    ...readTool.use_when,
    ...readTool.do_not_use_when,
    ...readTool.authoritative_for,
    readTool.recommended_first_call.operation,
  ].join('\n');
  for (const claim of [
    'authorizes dispatch',
    'authorizes integration',
    'authorizes handoff',
    'blocks dispatch',
    'blocks integration',
    'gates admission',
  ]) {
    assert.equal(
      published.includes(claim),
      false,
      `workspace_read_wiki discovery must not claim "${claim}"`,
    );
  }

  assert.deepEqual(readTool.side_effects, ['read_only']);
  assert.equal(readTool.kind, 'mcp_tool');
  assert.equal(readTool.install_state, 'installed');
  assert.equal(readTool.runtime_posture, 'supported');
  assert.equal(readTool.recommended_route, 'mcp');
  assert.deepEqual(readTool.task_ids, ['read-canonical']);
  assert.ok(
    readTool.docs_refs.includes('docs/mcp-operation-reference.md'),
    'the durable operation reference must be discoverable',
  );

  assert.match(notes, /WK subject's context facts carry the advisory terminal_review_designation/u);
  assert.match(notes, /each inventory:"slices" member carry its effective review_purpose when one exists/u);
  assert.match(notes, /read-only observations of the saved record that grant or withhold no /u);
  assert.deepEqual(readTool.recommended_first_call.arguments, { subject: '$canonical_subject' },
    'the facts are reached from the default subject read, not from a dedicated input');

  const candidates = [...await readFamilyTools(), ...(await readFragment(TASK_MCP_FRAGMENT)).tools];
  assert.deepEqual(
    candidates.filter((tool) => String(tool.notes ?? '').includes('terminal_review_designation'))
      .map((tool) => tool.tool_name),
    ['workspace_read_wiki'],
    'only the current reader describes terminal_review_designation',
  );
});
