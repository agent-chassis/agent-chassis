import test from 'node:test';
import assert from 'node:assert/strict';

function normalizeDependencyAddress({
  configuredAliases = [],
  reference,
}) {
  if (typeof reference !== 'string' || reference.length === 0) {
    throw new TypeError('reference must be a non-empty string');
  }

  const alias = configuredAliases.find((candidate) => {
    return reference.startsWith(`${candidate}/`);
  });

  if (alias && reference.startsWith(`${alias}/`)) {
    return {
      address: reference.slice(alias.length + 1),
      kind: 'local',
      source: 'configured_alias',
    };
  }

  if (reference.includes('/')) {
    return {
      address: reference,
      kind: 'external',
      source: 'slash_qualified_metadata',
    };
  }

  return {
    address: reference,
    kind: 'local',
    source: 'direct',
  };
}

test('configured same-repo aliases normalize to local slice addresses', () => {
  const result = normalizeDependencyAddress({
    configuredAliases: ['agent-chassis/agent-chassis'],
    reference: 'agent-chassis/agent-chassis/WK-1171#SLICE-014',
  });

  assert.deepEqual(result, {
    address: 'WK-1171#SLICE-014',
    kind: 'local',
    source: 'configured_alias',
  });
});

test('slash-qualified metadata strings stay external unless configured', () => {
  const result = normalizeDependencyAddress({
    configuredAliases: [],
    reference: 'agent-chassis/agent-chassis/WK-1171#SLICE-014',
  });

  assert.deepEqual(result, {
    address: 'agent-chassis/agent-chassis/WK-1171#SLICE-014',
    kind: 'external',
    source: 'slash_qualified_metadata',
  });
});
