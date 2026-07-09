import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  TOOL_DISCOVERY_SCHEMA_VERSION,
  TOOL_DISCOVERY_MANIFEST_KIND,
  TOOL_DISCOVERY_TIER_VISIBILITY_VALUES,
  loadToolDiscoveryDescriptor,
  resolveToolTierVisibility,
} from '../../src/lib/tool-discovery.mjs';

const manifestUrl = new URL('./manifest.json', import.meta.url);

const EXPECTED_FRAGMENTS = [
  ['mcp-tools.json', 15],
  ['mcp-work-record-tools.json', 3],
  ['mcp-launcher-tools.json', 4],
  ['mcp-coordination-tools.json', 2],
  ['tool-usage-audit-tools.json', 1],
  ['work-record-tools.json', 28],
  ['code-index-tools.json', 18],
  ['launcher-tools.json', 5],
  ['cli-commands.json', 10],
  ['integration-tools.json', 1],
  ['wrapper-commands.json', 0],
];
const EXPECTED_TOOL_COUNT = 87;

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

test('tool-discovery manifest is a canonical rich fragment-manifest', async () => {
  const manifest = await readJson(manifestUrl);

  assert.equal(manifest.schema_version, TOOL_DISCOVERY_SCHEMA_VERSION);

  assert.equal(manifest.kind, TOOL_DISCOVERY_MANIFEST_KIND);
  assert.equal(manifest.repository, 'agent-chassis/agent-chassis');
  assert.equal(
    typeof manifest.description === 'string' && manifest.description.trim().length > 0,
    true,
    'manifest must carry a durable description string',
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(manifest, 'fragment_directory'),
    false,
    'canonical manifest must not carry the reduced-shape fragment_directory key',
  );
});

test('tool-discovery manifest declares the full fragment corpus in canonical order', async () => {
  const manifest = await readJson(manifestUrl);
  const fragments = Array.isArray(manifest.fragments) ? manifest.fragments : [];

  assert.equal(fragments.length, EXPECTED_FRAGMENTS.length);

  fragments.forEach((fragment, index) => {

    assert.equal(
      Object.prototype.hasOwnProperty.call(fragment, 'file'),
      true,
      `fragment[${index}] must be keyed by file`,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(fragment, 'path'),
      false,
      `fragment[${index}] must not use the reduced-shape path key`,
    );
    assert.equal(
      typeof fragment.summary === 'string' && fragment.summary.trim().length > 0,
      true,
      `fragment ${fragment.file} must carry a summary`,
    );
  });

  assert.deepEqual(
    fragments.map((fragment) => [fragment.file, fragment.tool_count]),
    EXPECTED_FRAGMENTS,
  );
});

test('tool-discovery manifest expected_tool_count matches the per-fragment sum', async () => {
  const manifest = await readJson(manifestUrl);
  const declaredSum = manifest.fragments.reduce((total, entry) => total + entry.tool_count, 0);

  assert.equal(manifest.expected_tool_count, EXPECTED_TOOL_COUNT);
  assert.equal(
    declaredSum,
    EXPECTED_TOOL_COUNT,
    'per-fragment tool_count values must sum to expected_tool_count',
  );
});

test('tool-discovery manifest carries the tool_name uniqueness policy', async () => {
  const manifest = await readJson(manifestUrl);

  assert.equal(
    manifest.uniqueness && typeof manifest.uniqueness === 'object' && !Array.isArray(manifest.uniqueness),
    true,
    'canonical manifest must carry a uniqueness policy object',
  );
  assert.equal(manifest.uniqueness.key, 'tool_name');
  assert.equal(manifest.uniqueness.scope, 'assembled_corpus');
  assert.equal(
    typeof manifest.uniqueness.policy === 'string' && manifest.uniqueness.policy.trim().length > 0,
    true,
    'uniqueness policy must describe the no-last-writer-wins rule',
  );
});

test('the manifest assembles into the full corpus through the loader', async () => {

  const descriptor = await loadToolDiscoveryDescriptor();
  assert.equal(descriptor.schema_version, TOOL_DISCOVERY_SCHEMA_VERSION);
  assert.equal(descriptor.repository, 'agent-chassis/agent-chassis');
  assert.equal(descriptor.tools.length, EXPECTED_TOOL_COUNT);

  const uniqueNames = new Set(descriptor.tools.map((tool) => tool.tool_name));
  assert.equal(uniqueNames.size, descriptor.tools.length, 'assembled tool_name set must be unique');
});

test('manifest counts match each checked-in fragment file', async () => {
  const manifest = await readJson(manifestUrl);
  let actualTotal = 0;

  for (const fragment of manifest.fragments) {
    const fragmentBody = await readJson(new URL(`./${fragment.file}`, import.meta.url));
    assert.equal(fragmentBody.fragment, fragment.file);
    assert.equal(fragmentBody.tool_count, fragment.tool_count, `${fragment.file} self count must match manifest`);
    assert.equal(fragmentBody.tools.length, fragment.tool_count, `${fragment.file} tools length must match manifest`);
    actualTotal += fragmentBody.tools.length;
  }

  assert.equal(actualTotal, manifest.expected_tool_count);
});

test('WK-1377: every assembled entry carries an explicit valid tier classification', async () => {

  const descriptor = await loadToolDiscoveryDescriptor();
  for (const tool of descriptor.tools) {
    const visibility = resolveToolTierVisibility(tool);
    assert.equal(
      visibility.length > 0,
      true,
      `tool ${tool.tool_name} must declare a non-empty tier_visibility`,
    );
    for (const value of tool.tier_visibility) {
      assert.equal(
        TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(value),
        true,
        `tool ${tool.tool_name} tier_visibility value ${value} must be controlled`,
      );
    }
  }

  const byName = new Map(descriptor.tools.map((tool) => [tool.tool_name, resolveToolTierVisibility(tool)]));
  for (const paid of [
    'workspace_record_review_attestation',
    'workspace_record_review_result_evidence',
    'workspace_node_engine_admission_runtime_diagnostic',
    'workspace_work_record_refresh_admission_metrics',
    'workspace_work_record_refresh_target_resolution_evidence',
    'workspace_record_graph_impact_evidence',
    'workspace_code_index_graph_impact_paths',
  ]) {
    assert.deepEqual(byName.get(paid), ['paid_cce'], `${paid} must be paid/CCE-only`);
  }
  for (const tool of descriptor.tools) {
    if (tool.kind === 'cli_command') {
      assert.deepEqual(
        resolveToolTierVisibility(tool),
        ['operator_only'],
        `CLI fallback ${tool.tool_name} must be operator-only`,
      );
    }
  }
});
