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
  TOOL_DISCOVERY_TIER_VISIBILITY_VALUES,
  TOOL_DISCOVERY_CONTROLLED_TASK_IDS,
} from '../../src/lib/tool-discovery.mjs';

const FRAGMENT_FILE = 'integration-tools.json';
const TOOL_NAME = 'workspace_integration_promote_check';
const fragmentUrl = new URL('./integration-tools.json', import.meta.url);

const NON_AUTHORITY_TOPICS = [
  'policy',
  'promotion',
  'merge',
  'rebase',
  'cleanup',
  'lifecycle',
  'ref update',
  'review-policy',
];

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function getTool(fragment) {
  const tool = fragment.tools.find((entry) => entry.tool_name === TOOL_NAME);
  assert.ok(tool, `${TOOL_NAME} must be present in the integration fragment`);
  return tool;
}

test('integration-tools fragment carries the canonical fragment identity', async () => {
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
});

test('integration-tools fragment declares exactly one tool', async () => {
  const fragment = await readJson(fragmentUrl);

  assert.equal(fragment.tool_count, 1);
  assert.ok(Array.isArray(fragment.tools), 'fragment.tools must be an array');
  assert.equal(fragment.tools.length, 1);
  assert.equal(fragment.tools.length, fragment.tool_count);

  const names = fragment.tools.map((tool) => tool.tool_name);
  assert.deepEqual(names, [TOOL_NAME]);
});

test('integration promote-check tool carries controlled rich descriptor metadata', async () => {
  const fragment = await readJson(fragmentUrl);
  const tool = getTool(fragment);

  assert.equal(typeof tool.display_name === 'string' && tool.display_name.length > 0, true, 'display_name');
  assert.equal(tool.kind, 'mcp_tool');
  assert.equal(tool.entrypoint, TOOL_NAME, 'mcp_tool entrypoint must mirror tool_name');

  assert.ok(Array.isArray(tool.task_ids) && tool.task_ids.length > 0, 'must declare task_ids');
  for (const taskId of tool.task_ids) {
    assert.ok(TOOL_DISCOVERY_CONTROLLED_TASK_IDS.includes(taskId), `task_id ${taskId} must be controlled`);
  }

  assert.ok(TOOL_DISCOVERY_INSTALL_STATE_VALUES.includes(tool.install_state), 'install_state controlled');
  assert.ok(TOOL_DISCOVERY_RUNTIME_POSTURE_VALUES.includes(tool.runtime_posture), 'runtime_posture controlled');
  assert.ok(TOOL_DISCOVERY_RECOMMENDED_ROUTE_VALUES.includes(tool.recommended_route), 'recommended_route controlled');
  assert.ok(Number.isInteger(tool.priority) && tool.priority >= 0, 'priority non-negative integer');

  assert.ok(Array.isArray(tool.audience) && tool.audience.length > 0, 'must carry explicit audience');
  for (const audience of tool.audience) {
    assert.ok(TOOL_DISCOVERY_AUDIENCE_VALUES.includes(audience), `audience ${audience} controlled`);
  }
  for (const authority of tool.authority) {
    assert.ok(TOOL_DISCOVERY_AUTHORITY_VALUES.includes(authority), `authority ${authority} controlled`);
  }
});

test('integration promote-check descriptor audience is operator-only (excluded from agent-safe exposure)', async () => {

  const fragment = await readJson(fragmentUrl);
  const tool = getTool(fragment);

  assert.deepEqual(tool.audience, ['operator'], 'promote-check must carry exactly operator-only audience');
  assert.ok(
    !tool.audience.includes('agent'),
    'promote-check must not include agent audience (would widen descriptor-derived agent-safe exposure)',
  );
});

test('integration promote-check tool is read-only local (free_local) coordination', async () => {
  const fragment = await readJson(fragmentUrl);
  const tool = getTool(fragment);

  assert.ok(Array.isArray(tool.side_effects) && tool.side_effects.length > 0, 'must declare side_effects');
  for (const effect of tool.side_effects) {
    assert.ok(TOOL_DISCOVERY_SIDE_EFFECT_VALUES.includes(effect), `side_effect ${effect} controlled`);
  }
  assert.deepEqual(tool.side_effects, ['read_only'], 'promote-check must be read_only only');

  assert.ok(Array.isArray(tool.tier_visibility) && tool.tier_visibility.length > 0, 'must declare tier_visibility');
  for (const tier of tool.tier_visibility) {
    assert.ok(TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(tier), `tier ${tier} controlled`);
  }
  assert.deepEqual(tool.tier_visibility, ['free_local'], 'promote-check must be free_local local coordination');
});

test('integration promote-check descriptor disclaims policy/promotion/merge/rebase/cleanup/lifecycle/ref-update/review-policy authority', async () => {
  const fragment = await readJson(fragmentUrl);
  const tool = getTool(fragment);

  const notes = String(tool.notes ?? '');
  const summary = String(tool.summary ?? '');
  const prose = `${summary}\n${notes}`.toLowerCase();

  assert.ok(
    prose.includes('not policy authority') || prose.includes('is not policy authority'),
    'descriptor must state it is not policy authority',
  );
  assert.ok(
    prose.includes('does not authorize') || prose.includes('not authorize'),
    'descriptor must state it does not authorize controlled actions',
  );
  for (const topic of NON_AUTHORITY_TOPICS) {
    assert.ok(prose.includes(topic), `descriptor must reference disclaimed topic "${topic}"`);
  }

  assert.ok(prose.includes('read-only'), 'descriptor must describe itself as read-only');
});

test('integration promote-check descriptor references key docs and source files', async () => {
  const fragment = await readJson(fragmentUrl);
  const tool = getTool(fragment);

  assert.ok(Array.isArray(tool.docs_refs) && tool.docs_refs.length > 0, 'must declare docs_refs');
  assert.ok(tool.docs_refs.includes('docs/tool-discovery.md'), 'docs_refs must include tool-discovery.md');
  assert.ok(
    tool.docs_refs.includes('the project documentation'),
    'docs_refs must include the branch-worktree-dispatch coordination contract',
  );

  assert.ok(Array.isArray(tool.source_files) && tool.source_files.length > 0, 'must declare source_files');
  assert.ok(
    tool.source_files.includes('packages/wiki-core/data/tool-discovery/integration-tools.json'),
    'source_files must reference the owning fragment',
  );
  assert.ok(
    tool.source_files.includes('packages/wiki-mcp/src/lib/integration-promote-check-tools.mjs'),
    'source_files must reference the registered implementation module',
  );
  assert.ok(
    tool.source_files.includes('packages/wiki-mcp/src/server.mjs'),
    'source_files must reference the MCP server registration',
  );
});
