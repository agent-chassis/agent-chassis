import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import * as producerModule from '../packages/wiki-core/src/lib/precondition-graph-producer.mjs';

const producePreconditionGraph = resolveProducer(producerModule);
const CAP = 512;

function resolveProducer(module) {
  const candidates = [
    module.buildPreconditionGraph,
    module.producePreconditionGraph,
    module.projectPreconditionGraph,
    module.createPreconditionGraph,
    module.preconditionGraphProducer,
    module.default,
  ].filter((candidate) => typeof candidate === 'function');

  assert.ok(candidates.length > 0, 'precondition graph producer export is missing');
  return candidates[0];
}

function buildRecord(id, dependsOn = [], { status = 'todo', superseded = false } = {}) {
  return {
    id,
    repo: 'agent-chassis/agent-chassis',
    record_kind: 'work_item',
    schema_version: 'work-record.v1',
    status,
    superseded,
    depends_on: dependsOn,
  };
}

function buildChain(length, { cycle = false } = {}) {
  const records = {};
  for (let index = 0; index < length; index += 1) {
    const id = `WK-${String(1000 + index).padStart(4, '0')}`;
    const nextId = index + 1 < length ? `WK-${String(1000 + index + 1).padStart(4, '0')}` : null;
    records[id] = buildRecord(
      id,
      nextId ? [nextId] : [],
      { status: index === 0 ? 'active' : 'todo' },
    );
  }

  if (cycle && length > 1) {
    const lastId = `WK-${String(1000 + length - 1).padStart(4, '0')}`;
    records[lastId].depends_on = ['WK-1000'];
  }

  return records;
}

function buildInput(target, records, overrides = {}) {
  return {
    target,
    unit: target,
    subject: target,
    record: records[target],
    work_record: records[target],
    workRecord: records[target],
    records,
    work_records: records,
    workRecords: records,
    maxNodes: CAP,
    max_nodes: CAP,
    nodeCap: CAP,
    node_cap: CAP,
    cap: CAP,
    ...overrides,
  };
}

async function callProducer(input) {
  return await Promise.resolve(producePreconditionGraph(input));
}

async function withPatchedReadFileSync(implementation, run) {
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = implementation;
  try {
    return await run();
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
}

function unwrapGraphEnvelope(result) {
  assert.ok(result && typeof result === 'object', 'producer must return a structured result');

  const graph = result.precondition_graph
    ?? result.graph
    ?? result.data?.precondition_graph
    ?? (Array.isArray(result.nodes) && Array.isArray(result.edges) ? result : null);

  assert.ok(graph, 'producer result must expose a precondition graph');
  return { result, graph };
}

function assertNodeShape(node) {
  assert.deepEqual(Object.keys(node).sort(), ['id', 'lifecycle_state', 'superseded']);
  assert.equal(typeof node.id, 'string');
  assert.equal(typeof node.lifecycle_state, 'string');
  assert.equal(typeof node.superseded, 'boolean');
}

function assertGraph(graph, expectedTarget, expectedNodeIds, expectedEdges) {
  assert.equal(graph.target, expectedTarget);
  assert.ok(Array.isArray(graph.nodes), 'graph.nodes must be an array');
  assert.ok(Array.isArray(graph.edges), 'graph.edges must be an array');
  assert.equal(graph.nodes.length, expectedNodeIds.length);
  assert.equal(graph.edges.length, expectedEdges.length);

  const nodeIds = graph.nodes.map((node) => node.id).sort();
  assert.deepEqual(nodeIds, [...expectedNodeIds].sort());
  graph.nodes.forEach(assertNodeShape);

  const edgePairs = graph.edges.map((edge) => [edge.from, edge.to]).sort((left, right) => {
    if (left[0] !== right[0]) {
      return left[0].localeCompare(right[0]);
    }
    return left[1].localeCompare(right[1]);
  });
  assert.deepEqual(edgePairs, [...expectedEdges].sort((left, right) => {
    if (left[0] !== right[0]) {
      return left[0].localeCompare(right[0]);
    }
    return left[1].localeCompare(right[1]);
  }));
  graph.edges.forEach((edge) => {
    assert.deepEqual(Object.keys(edge).sort(), ['from', 'to']);
    assert.equal(typeof edge.from, 'string');
    assert.equal(typeof edge.to, 'string');
  });
}

function assertFailClosed(result) {
  assert.ok(result && typeof result === 'object', 'producer must return a structured fail-closed result');
  const signal = result.signal ?? result.kind ?? result.status ?? result.decision ?? result.failure?.kind ?? result.failure?.code;
  assert.ok(
    signal === 'fail_closed' || signal === 'fail-closed',
    'producer must emit a fail-closed signal when the graph is over cap',
  );
  assert.ok(!result.precondition_graph, 'fail-closed result must not carry a graph payload');
  assert.ok(!result.graph, 'fail-closed result must not carry a graph payload');
  assert.ok(!result.data?.precondition_graph, 'fail-closed result must not carry a graph payload');
}

async function assertNoThrowWithinTimeout(run, timeoutMs = 1000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`producer timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(run), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

test('producer includes a 2-hop incomplete upstream in nodes and edges', async () => {
  const records = {
    'WK-1000': buildRecord('WK-1000', ['WK-1001'], { status: 'active' }),
    'WK-1001': buildRecord('WK-1001', ['WK-1002'], { status: 'active' }),
    'WK-1002': buildRecord('WK-1002', [], { status: 'todo' }),
  };

  const result = await assertNoThrowWithinTimeout(
    () => callProducer(buildInput('WK-1000', records)),
    1000,
  );
  const { graph } = unwrapGraphEnvelope(result);

  assertGraph(graph, 'WK-1000', ['WK-1000', 'WK-1001', 'WK-1002'], [
    ['WK-1000', 'WK-1001'],
    ['WK-1001', 'WK-1002'],
  ]);
});

test('producer returns a structured result for a cyclic depends_on set', async () => {
  const records = {
    'WK-1000': buildRecord('WK-1000', ['WK-1001'], { status: 'active' }),
    'WK-1001': buildRecord('WK-1001', ['WK-1002'], { status: 'active' }),
    'WK-1002': buildRecord('WK-1002', ['WK-1000'], { status: 'active' }),
  };

  const result = await assertNoThrowWithinTimeout(
    () => callProducer(buildInput('WK-1000', records)),
    1000,
  );
  const { graph } = unwrapGraphEnvelope(result);

  assertGraph(graph, 'WK-1000', ['WK-1000', 'WK-1001', 'WK-1002'], [
    ['WK-1000', 'WK-1001'],
    ['WK-1001', 'WK-1002'],
    ['WK-1002', 'WK-1000'],
  ]);
});

test('producer handles a deep acyclic chain at the published cap', async () => {
  const records = buildChain(CAP);
  const target = 'WK-1000';

  const result = await assertNoThrowWithinTimeout(
    () => callProducer(buildInput(target, records)),
    2000,
  );
  const { graph } = unwrapGraphEnvelope(result);

  assert.equal(graph.target, target);
  assert.equal(graph.nodes.length, CAP);
  assert.equal(graph.edges.length, CAP - 1);
  assert.ok(graph.nodes.some((node) => node.id === target));
  assert.ok(graph.nodes.some((node) => node.id === `WK-${String(1000 + CAP - 1).padStart(4, '0')}`));
  assert.ok(graph.edges.some((edge) => edge.from === 'WK-1000' && edge.to === 'WK-1001'));
  assert.ok(
    graph.edges.some(
      (edge) => edge.from === `WK-${String(1000 + CAP - 2).padStart(4, '0')}` && edge.to === `WK-${String(1000 + CAP - 1).padStart(4, '0')}`,
    ),
  );
  graph.nodes.forEach(assertNodeShape);
});

test('producer fails closed when the closure exceeds the cap', async () => {
  const records = buildChain(CAP + 1);
  const result = await assertNoThrowWithinTimeout(
    () => callProducer(buildInput('WK-1000', records, { maxNodes: CAP })),
    2000,
  );

  assertFailClosed(result);
});

test('producer reloads canonical record JSON instead of serving a stale process cache', async () => {
  const targetPathSuffix = '/WK-9001.json';
  const dependencyPathSuffix = '/WK-9002.json';
  let targetReadCount = 0;

  await withPatchedReadFileSync((filePath, encoding) => {
    assert.equal(encoding, 'utf8');
    const normalizedPath = String(filePath);

    if (normalizedPath.endsWith(targetPathSuffix)) {
      targetReadCount += 1;
      return targetReadCount === 1
        ? JSON.stringify(buildRecord('WK-9001', [], { status: 'active' }))
        : JSON.stringify(buildRecord('WK-9001', ['WK-9002'], { status: 'active' }));
    }

    if (normalizedPath.endsWith(dependencyPathSuffix)) {
      return JSON.stringify(buildRecord('WK-9002', [], { status: 'todo' }));
    }

    throw new Error(`unexpected read: ${normalizedPath}`);
  }, async () => {
    const first = await assertNoThrowWithinTimeout(
      () => callProducer(buildInput('WK-9001', {})),
      1000,
    );
    const firstGraph = unwrapGraphEnvelope(first).graph;
    assertGraph(firstGraph, 'WK-9001', ['WK-9001'], []);

    const second = await assertNoThrowWithinTimeout(
      () => callProducer(buildInput('WK-9001', {})),
      1000,
    );
    const secondGraph = unwrapGraphEnvelope(second).graph;
    assertGraph(secondGraph, 'WK-9001', ['WK-9001', 'WK-9002'], [
      ['WK-9001', 'WK-9002'],
    ]);
  });
});

test('producer fails loud on malformed canonical record JSON', async () => {
  await withPatchedReadFileSync(() => '{', async () => {
    await assert.rejects(
      () => callProducer(buildInput('WK-9001', {})),
      (error) => error?.code === 'invalid_json' && /Malformed canonical work record JSON/.test(error.message),
    );
  });
});

test('producer fails loud on unreadable canonical record JSON', async () => {
  await withPatchedReadFileSync(() => {
    const error = new Error('permission denied');
    error.code = 'EACCES';
    throw error;
  }, async () => {
    await assert.rejects(
      () => callProducer(buildInput('WK-9001', {})),
      (error) => error?.code === 'permission_denied' && error.cause?.code === 'EACCES',
    );
  });
});

test('producer treats missing canonical record JSON as absent', async () => {
  await withPatchedReadFileSync(() => {
    const error = new Error('missing');
    error.code = 'ENOENT';
    throw error;
  }, async () => {
    const result = await assertNoThrowWithinTimeout(
      () => callProducer(buildInput('WK-9001', {})),
      1000,
    );
    const { graph } = unwrapGraphEnvelope(result);
    assertGraph(graph, 'WK-9001', ['WK-9001'], []);
  });
});
