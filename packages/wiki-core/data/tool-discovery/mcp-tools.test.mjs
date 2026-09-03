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

const FRAGMENT_EXPECTATIONS = {
  'mcp-tools.json': [
    'allocate_id',
    'bootstrap_repo',
    'build_search_index',
    'commit',
    'create_record',
    'generate_and_lint',
    'generate_views',
    'get_contract_manifest',
    'get_record',
    'lint_repo',
    'read_page',
    'search_repo',
    'sync_contract',
    'workspace_agent_faq',
    'workspace_authoring_ergonomics_report',
    'workspace_authoring_ergonomics_report_query',
    'workspace_autofix_docs_backlinks',
    'workspace_build_search_index',
    'workspace_docs_policy_validate',
    'workspace_generate_and_lint',
    'workspace_get_record',
    'workspace_lint_repo',
    'workspace_read_mcp_content_reference',
    'workspace_read_page',
    'workspace_read_tool_doc',
    'workspace_search_repo',
    'workspace_submit_for_review',
    'workspace_tools_describe',
    'workspace_tools_list',
    'workspace_tools_query',
    'workspace_tool_router_recommend',
  ],
  'mcp-work-record-tools.json': [
    'assign_work_record_to_initiative',
    'workspace_decision_amend_scalar',
    'workspace_decision_amend_section',
    'workspace_decision_create',

    'workspace_decision_reject',
    'workspace_initiative_amend_scalar',
    'workspace_initiative_amend_section',
    'workspace_initiative_create',
    'workspace_record_graph_impact_evidence',
  ],
  'mcp-launcher-tools.json': [
    'workspace_agent_dispatch_identity_contract',
    'workspace_agent_runs_list',
    'workspace_node_engine_admission_runtime_diagnostic',
    'workspace_preflight_dispatch',
    'workspace_run_validation',
    'workspace_validate_dispatch',

    'workspace_worker_run_declared_test',
  ],
  'mcp-coordination-tools.json': [
    'workspace_initiative_status',
    'workspace_integration_status',
  ],
};
const MANIFEST_RELATIVE_PATH = 'packages/wiki-core/data/tool-discovery/manifest.json';
const LEGACY_AGGREGATE_BASENAME = 'tool-discovery.v1.json';
const WK_2437_CONTROLLED_TASK_IDS = Object.freeze([
  'acceptance-gap-review',
  'mapping-repair',
  'obligation-inventory',
  'proof-obligation-map-inspection',
]);

const ALL_MCP_FRAGMENT_FILES = Object.keys(FRAGMENT_EXPECTATIONS);

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function findTool(fragment, toolName) {
  const tool = fragment.tools.find((entry) => entry.tool_name === toolName);
  assert.ok(tool, `${toolName} must be present`);
  return tool;
}

async function readFragment(fragmentFile) {
  return readJson(new URL(`./${fragmentFile}`, import.meta.url));
}

async function readMcpSplitToolsByName() {
  const toolsByName = new Map();
  for (const fragmentFile of ALL_MCP_FRAGMENT_FILES) {
    const fragment = await readFragment(fragmentFile);
    for (const tool of fragment.tools) {
      assert.equal(toolsByName.has(tool.tool_name), false, `${tool.tool_name} must have one MCP fragment owner`);
      toolsByName.set(tool.tool_name, tool);
    }
  }
  return toolsByName;
}

function assertRichToolEntry(tool) {
  const name = tool.tool_name;
  assert.equal(typeof name === 'string' && name.length > 0, true, 'tool_name must be a non-empty string');

  assert.equal(typeof tool.display_name === 'string' && tool.display_name.length > 0, true, `${name} display_name`);
  assert.equal(tool.kind, 'mcp_tool', `${name} must be an mcp_tool`);
  assert.equal(tool.entrypoint, name, `${name} entrypoint must equal tool_name`);

  assert.ok(Array.isArray(tool.task_ids), `${name} must declare task_ids`);
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

  if (Array.isArray(tool.audience)) {
    assert.ok(tool.audience.length > 0, `${name} audience, when present, must be non-empty`);
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

test('MCP split fragments are canonical rich tool-discovery-fragments', async () => {
  for (const [fragmentFile, expectedToolNames] of Object.entries(FRAGMENT_EXPECTATIONS)) {
    const fragment = await readFragment(fragmentFile);

    assert.equal(fragment.schema_version, TOOL_DISCOVERY_SCHEMA_VERSION);
    assert.equal(fragment.kind, TOOL_DISCOVERY_FRAGMENT_KIND);
    assert.equal(fragment.repository, 'agent-chassis/agent-chassis');

    assert.equal(fragment.fragment, fragmentFile);
    assert.equal(
      typeof fragment.summary === 'string' && fragment.summary.trim().length > 0,
      true,
      `${fragmentFile} must carry a summary`,
    );
    assert.equal(fragment.tool_count, expectedToolNames.length);
    assert.ok(Array.isArray(fragment.tools), `${fragmentFile}.tools must be an array`);
    assert.equal(fragment.tools.length, fragment.tool_count);
  }
});

test('MCP split fragments register exactly the supported agent-safe MCP routes', async () => {
  const allToolNames = [];

  for (const [fragmentFile, expectedToolNames] of Object.entries(FRAGMENT_EXPECTATIONS)) {
    const fragment = await readFragment(fragmentFile);
    const toolNames = fragment.tools.map((tool) => tool.tool_name).sort();

    assert.deepEqual(toolNames, [...expectedToolNames].sort(), `${fragmentFile} tool ownership`);
    allToolNames.push(...toolNames);

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
  }

  assert.deepEqual(
    allToolNames.sort(),
    Object.values(FRAGMENT_EXPECTATIONS).flat().sort(),
    'the split MCP fragments must preserve the full registered MCP descriptor set',
  );
});

test('MCP split fragment entries carry full rich descriptor metadata', async () => {
  for (const fragmentFile of ALL_MCP_FRAGMENT_FILES) {
    const fragment = await readFragment(fragmentFile);
    for (const tool of fragment.tools) {
      assertRichToolEntry(tool);
    }
  }
});

test('WK-2426 controlled-contract rows preserve the registered semantic route inventory', async () => {
  const fragment = await readJson(new URL('./controlled-contract-tools.json', import.meta.url));
  assert.equal(fragment.tool_count, 44);
  assert.equal(fragment.tools.length, 44);

  for (const taskId of WK_2437_CONTROLLED_TASK_IDS) {
    assert.ok(TOOL_DISCOVERY_CONTROLLED_TASK_IDS.includes(taskId), `${taskId} must be controlled`);
  }

  const acceptance = findTool(fragment, 'workspace_controlled_contract_acceptance_coverage_describe');
  const obligation = findTool(fragment, 'workspace_controlled_contract_obligation_coverage_describe');
  assert.deepEqual(acceptance.task_ids, [
    'controlled-contract-authoring',
    'acceptance-gap-review',
    'mapping-repair',
  ]);
  assert.deepEqual(obligation.task_ids, [
    'controlled-contract-authoring',
    'obligation-inventory',
    'proof-obligation-map-inspection',
  ]);
  for (const row of [acceptance, obligation]) {
    for (const taskId of row.task_ids) {
      assert.ok(TOOL_DISCOVERY_CONTROLLED_TASK_IDS.includes(taskId), `${row.tool_name}:${taskId}`);
    }
  }

  const verifyProof = findTool(fragment, 'workspace_verify_proof');
  assert.deepEqual(verifyProof.recommended_first_call.arguments, {
    subject: '$canonical_WK_slice_test_proof_or_obligation_id',
    repo: '$configured_workspace_alias_if_needed',
    git_sha: '$optional_exact_full_commit_for_orchestrator',
  });
  assert.deepEqual(verifyProof.side_effects, ['process_spawn', 'workspace_write']);
  assert.match(verifyProof.use_when[0], /shared authenticated private detached materialization/);
  assert.ok(verifyProof.source_files.includes(
    'packages/agent-launch-cli/src/lib/backend-immutable-candidate.mjs',
  ));
  assert.ok(verifyProof.source_files.includes(
    'packages/agent-launch-cli/src/lib/workspace-agent-orchestrator-test-proof-runtime.mjs',
  ));
  assert.ok(verifyProof.source_files.includes(
    'packages/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs',
  ));
  assert.deepEqual(verifyProof.authority, [
    'checked_in_descriptor',
    'launcher_backend',
    'runtime_env',
    'work_record',
  ]);
  assert.match(verifyProof.authoritative_for[0], /satisfied, unsatisfied, not_executable/);
  assert.match(verifyProof.authoritative_for[0], /completely preflighted proof population/);
  assert.equal(Object.hasOwn(verifyProof, 'notes'), false);
  assert.deepEqual(verifyProof.docs_refs, [
    'docs/test-proof-runtime-identity.md',
    'docs/mcp-controlled-contract-operations.md',
    'docs/mcp-operation-reference.md',
    'docs/mcp-dispatch-managed-run-lifecycle.md',
  ]);

  const policy = await readJson(new URL('./session-role-tool-access.json', import.meta.url));
  assert.deepEqual(policy.access.workspace_verify_proof, [
    'orchestrator',
    'reviewer',
    'worker',
  ]);

  const manifest = await readJson(new URL('./manifest.json', import.meta.url));
  const row = manifest.fragments.find((entry) =>
    entry.file === 'controlled-contract-tools.json');
  assert.equal(row.tool_count, fragment.tool_count);
  assert.match(row.summary, /authenticated orchestrator/);
});

test('MCP split source_files anchor on the manifest and owning fragments', async () => {
  for (const [fragmentFile, toolName] of [
    ['mcp-tools.json', 'workspace_tools_list'],
    ['mcp-work-record-tools.json', 'workspace_record_graph_impact_evidence'],
    ['mcp-launcher-tools.json', 'workspace_validate_dispatch'],
    ['mcp-coordination-tools.json', 'workspace_initiative_status'],
  ]) {
    const fragment = await readFragment(fragmentFile);
    const tool = findTool(fragment, toolName);
    const fragmentRelativePath = `packages/wiki-core/data/tool-discovery/${fragmentFile}`;

    assert.ok(
      tool.source_files.includes(MANIFEST_RELATIVE_PATH),
      `${toolName} source_files must include the fragment manifest`,
    );
    assert.ok(
      tool.source_files.includes(fragmentRelativePath),
      `${toolName} source_files must include the owning ${fragmentFile} fragment`,
    );
  }
});

test('workspace_validate_dispatch advertises only bounded ignored graph-cache writes', async () => {
  const fragment = await readFragment('mcp-launcher-tools.json');
  const tool = findTool(fragment, 'workspace_validate_dispatch');
  assert.deepEqual(tool.side_effects, ['workspace_write']);
  assert.match(tool.notes, /structural runnability floor/);
  assert.match(tool.notes, /never mutates canonical work records/);
  assert.match(tool.notes, /never launches an agent/);
  const paidNotes = tool.tier_text.paid_cce.notes;
  assert.match(paidNotes, /ignored code-index graph artifacts/);
  assert.match(paidNotes, /sibling atomic temporary files/);
  assert.match(paidNotes, /advisory build-lock file/);
  assert.match(paidNotes, /eight exclusively claimed candidate slots/);
  assert.match(paidNotes, /\.index\.json\.build-lock\.json\.slot-00\.candidate/);
  assert.match(paidNotes, /\.index\.json\.build-lock\.json\.slot-07\.candidate/);
  assert.match(paidNotes, /initial absent-lock race/);
  assert.match(paidNotes, /exhaustion falls back to an independent atomic build/);
  assert.match(paidNotes, /never mutates canonical WK\/evidence/);
  assert.match(paidNotes, /never launches an agent/);
});

test('workspace_tool_router_recommend is exposed as advisory read-only routing only', async () => {
  const fragment = await readFragment('mcp-tools.json');
  const routerEntry = findTool(fragment, 'workspace_tool_router_recommend');

  assert.deepEqual(routerEntry.side_effects, ['read_only']);
  assert.equal(routerEntry.recommended_route, 'mcp');
  assert.deepEqual(routerEntry.tier_visibility, ['free_local']);
  assert.ok(
    routerEntry.authoritative_for.includes('advisory first-tool routing'),
    'workspace_tool_router_recommend must be authoritative only for advisory routing',
  );
  assert.equal(
    routerEntry.authority.includes('launcher_dispatch'),
    false,
    'workspace_tool_router_recommend must not gain dispatch authority',
  );
  assert.equal(
    routerEntry.authority.includes('work_record_mutation'),
    false,
    'workspace_tool_router_recommend must not gain mutation authority',
  );
});

test('WK-1438 hot MCP tools carry compact routing guidance metadata', async () => {
  const toolsByName = await readMcpSplitToolsByName();

  const expectations = {
    workspace_search_repo: {
      use_when: ['docs_lookup'],
      do_not_use_when: [
        'initiative_status',
        'initiative_next_action',
        'dispatch_readiness',
        'dispatch_role_call',
      ],
      authoritative_for: ['docs_lookup:page_discovery'],
      routing_intents: ['docs_lookup'],
      recommended_arguments: { query: '$task_description' },
      requires_prior_state: ['natural-language query, docs/wiki path fragment, or durable id to search for'],
      replacement_for_misuse: [
        {
          misuse_code: 'search_used_for_status_aggregation',
          routing_intent: 'initiative_status',
          use_instead: 'workspace_initiative_status',
        },
        {
          misuse_code: 'bulk_sampling_without_lens',
          routing_intent: 'initiative_next_action',
          use_instead: 'workspace_initiative_status',
        },
        {
          misuse_code: 'dispatch_without_readiness_validation',
          routing_intent: 'dispatch_readiness',
          use_instead: 'workspace_validate_dispatch',
        },
      ],
    },
    workspace_read_page: {
      use_when: [
        'docs_lookup with known repo path',
        'selected_slice_detail with selected_slice:<slice-id>',
      ],
      do_not_use_when: [
        'initiative_status',
        'initiative_next_action',
        'dispatch_readiness',
        'dispatch_role_call',
        'selected_work_record_context first call',
      ],
      authoritative_for: [
        'docs_lookup:known_path_read',
        'selected_slice_detail:canonical_page_projection',
      ],
      routing_intents: ['docs_lookup'],
      recommended_arguments: { path: '$known_repo_relative_path' },
      requires_prior_state: [
        'known repo-relative Markdown path, exact registered canonical record path, or known WK plus selected_slice selector',
      ],
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
          routing_intent: 'initiative_status',
          use_instead: 'workspace_initiative_status',
        },
      ],
    },
    workspace_get_record: {
      use_when: [
        'selected_work_record_context after compact summary needs canonical payload',
        'selected_slice_detail after compact summary needs raw/debug payload',
      ],
      do_not_use_when: [
        'initiative_status',
        'initiative_next_action',
        'dispatch_readiness',
        'dispatch_role_call',
        'selected_work_record_context first call',
        'selected_slice_detail first call',
      ],
      authoritative_for: ['selected_work_record_context:canonical_record_payload'],
      routing_intents: ['selected_work_record_context'],
      recommended_arguments: { id: '$known_durable_id' },
      requires_prior_state: [
        'known durable WK, IN, or DEC id and context justifying canonical payload',
      ],
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
          misuse_code: 'search_used_for_status_aggregation',
          routing_intent: 'initiative_status',
          use_instead: 'workspace_initiative_status',
        },
      ],
    },
    workspace_validate_dispatch: {
      use_when: ['dispatch_readiness', 'dispatch_role_call'],
      do_not_use_when: [
        'initiative_status',
        'initiative_next_action before a unit is selected',
        'run_monitoring',
      ],
      authoritative_for: ['dispatch_readiness', 'dispatch_role_call:readiness_gate'],
      routing_intents: ['dispatch_readiness', 'dispatch_role_call'],
      recommended_arguments: {
        unit: '$unit_if_known',
        dispatch_role: '$role_if_known',
      },
      requires_prior_state: [
        'known WK-* or WK-*#SLICE-*',
        'role when validating a role-specific dispatch',
      ],
      replacement_for_misuse: [
        {
          misuse_code: 'dispatch_without_readiness_validation',
          routing_intent: 'dispatch_role_call',
          use_instead: 'workspace_validate_dispatch',
        },
        {
          misuse_code: 'ignored_required_next_action',
          routing_intent: 'dispatch_readiness',
          use_instead: 'workspace_validate_dispatch',
        },
      ],
    },
    workspace_initiative_status: {
      use_when: ['initiative_status', 'initiative_next_action'],
      do_not_use_when: [
        'selected_work_record_context after a unit is already chosen for detailed reading',
        'dispatch_readiness for a selected launch unit',
        'dispatch_role_call after readiness already returned dispatchable',
        'run_monitoring',
      ],
      authoritative_for: ['initiative_status', 'initiative_next_action'],
      routing_intents: ['initiative_status', 'initiative_next_action'],
      recommended_arguments: {
        initiative: '$initiative_if_known',
        unit: '$unit_if_known',
      },
      requires_prior_state: ['known IN-* or WK-* or WK-*#SLICE-*'],
      replacement_for_misuse: [
        {
          misuse_code: 'search_used_for_status_aggregation',
          routing_intent: 'initiative_status',
          use_instead: 'workspace_initiative_status',
        },
        {
          misuse_code: 'bulk_sampling_without_lens',
          routing_intent: 'initiative_next_action',
          use_instead: 'workspace_initiative_status',
        },
        {
          misuse_code: 'ignored_required_next_action',
          routing_intent: 'initiative_next_action',
          use_instead: 'workspace_initiative_status',
        },
      ],
    },
  };

  for (const [toolName, expectation] of Object.entries(expectations)) {
    const tool = toolsByName.get(toolName);
    assert.ok(tool, `${toolName} must be present`);

    for (const field of ['use_when', 'do_not_use_when', 'authoritative_for', 'requires_prior_state']) {
      assert.ok(Array.isArray(tool[field]), `${toolName}.${field} must be an array`);
      assert.equal(tool[field].length > 0, true, `${toolName}.${field} must not be empty`);
      for (const expected of expectation[field]) {
        assert.ok(tool[field].includes(expected), `${toolName}.${field} must include ${expected}`);
      }
    }

    assert.equal(
      tool.recommended_first_call && typeof tool.recommended_first_call === 'object',
      true,
      `${toolName} must carry recommended_first_call`,
    );
    assert.deepEqual(tool.recommended_first_call.routing_intents, expectation.routing_intents);
    assert.deepEqual(tool.recommended_first_call.arguments, expectation.recommended_arguments);
    assert.equal(tool.recommended_first_call.omit_null_arguments, true);

    assert.ok(
      Array.isArray(tool.replacement_for_misuse) && tool.replacement_for_misuse.length > 0,
      `${toolName}.replacement_for_misuse must not be empty`,
    );
    for (const replacement of tool.replacement_for_misuse) {
      assert.equal(typeof replacement.misuse_code === 'string' && replacement.misuse_code.length > 0, true);
      assert.equal(typeof replacement.routing_intent === 'string' && replacement.routing_intent.length > 0, true);
      assert.equal(typeof replacement.use_instead === 'string' && replacement.use_instead.length > 0, true);
    }
    const replacementKeys = new Set(
      tool.replacement_for_misuse.map(
        (replacement) =>
          `${replacement.misuse_code}\0${replacement.routing_intent}\0${replacement.use_instead}`,
      ),
    );
    for (const expected of expectation.replacement_for_misuse) {
      const expectedKey = `${expected.misuse_code}\0${expected.routing_intent}\0${expected.use_instead}`;
      assert.ok(
        replacementKeys.has(expectedKey),
        `${toolName} replacement_for_misuse must pin ${expected.misuse_code} -> ${expected.routing_intent} -> ${expected.use_instead}`,
      );
    }
  }
});

test('ready-slice descriptor is installed supported free-local and role policy is orchestrator/operator only', async () => {

  const fragment = await readFragment('work-record-edit-mcp-tools.json');
  const tool = findTool(fragment, 'workspace_work_record_ready_slice');
  assert.equal(fragment.tool_count, fragment.tools.length);
  assert.equal(fragment.tool_count, 10);
  assertRichToolEntry(tool);
  assert.equal(tool.install_state, 'installed');
  assert.equal(tool.runtime_posture, 'supported');
  assert.equal(tool.recommended_route, 'mcp');
  assert.deepEqual(tool.tier_visibility, ['free_local']);
  assert.deepEqual(tool.side_effects, ['workspace_write', 'record_write']);
  assert.ok(tool.docs_refs.includes('docs/mcp-operation-reference.md'));
  assert.ok(
    tool.source_files.includes(
      'packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs',
    ),
  );

  const policy = await readJson(new URL('./session-role-tool-access.json', import.meta.url));
  assert.deepEqual(policy.access.workspace_work_record_ready_slice, [
    'orchestrator',
    'operator',
  ]);
  for (const denied of ['reviewer', 'redteam', 'worker']) {
    assert.equal(policy.access.workspace_work_record_ready_slice.includes(denied), false);
  }

  const manifest = await readJson(new URL('./manifest.json', import.meta.url));
  const workRecordRow = manifest.fragments.find(
    (entry) => entry.file === 'work-record-edit-mcp-tools.json',
  );
  assert.equal(workRecordRow.tool_count, 10);

  assert.equal(
    manifest.fragments
      .filter((entry) => entry.file.startsWith('work-record-'))
      .reduce((total, entry) => total + entry.tool_count, 0),
    31,
  );
  assert.equal(
    manifest.expected_tool_count,
    manifest.fragments.reduce((total, entry) => total + entry.tool_count, 0),
  );

  assert.equal(manifest.expected_tool_count, 174);
});
