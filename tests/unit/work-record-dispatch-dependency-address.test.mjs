import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDependencyBlockers,
  resolveDependencyEvidenceVector
} from '../../packages/wiki-core/src/lib/work-record-dispatch-dependencies.mjs';
import {
  WORK_RECORD_STATUS_VALUES,
  WORK_RECORD_WORK_KIND_VALUES
} from '../../packages/wiki-core/src/lib/work-record-schema-constants.mjs';

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

test('canonical target facts are authoritative over conflicting supplied evidence', () => {
  const record = {
    id: 'WK-1000',
    repo: 'agent-chassis/agent-chassis',
    work_kind: 'implementation',
    status: 'active',
    initiative: 'IN-0030',
    depends_on: ['WK-1001'],
    slices: []
  };
  const target = {
    id: 'WK-1001',
    work_kind: 'review',
    status: 'todo',
    initiative: 'IN-0030',
    slices: []
  };
  const evidence = resolveDependencyEvidenceVector({
    record,
    selectedUnit: null,
    dependencyStatuses: new Map([['WK-1001', { status: 'done', reason: 'stale transport' }]]),
    additionalRecords: new Map([['WK-1001', target]])
  });

  assert.deepEqual(evidence[0], {
    address: 'WK-1001',
    source: 'record',
    record_id: 'WK-1001',
    slice_id: null,
    external_repo: null,
    selected_status: 'todo',
    target_work_kind: 'review',
    target_identity: 'WK-1001',
    target_status: 'todo',
    target_initiative: 'IN-0030',
    supplied_status: 'done',
    supplied_reason: 'stale transport',
    marker: 'resolved',
    provenance: 'canonical_wk_json',
    reason: null
  });
  assert.deepEqual(collectDependencyBlockers(evidence), []);
});

test('missing canonical work kind is a typed mechanical fact failure', () => {
  const evidence = resolveDependencyEvidenceVector({
    record: { id: 'WK-1000', repo: 'agent-chassis/agent-chassis', depends_on: ['WK-1001'], slices: [] },
    selectedUnit: null,
    dependencyStatuses: new Map([['WK-1001', { status: 'done' }]]),
    additionalRecords: new Map([['WK-1001', { id: 'WK-1001', status: 'done', initiative: 'IN-0030', slices: [] }]])
  });
  assert.equal(evidence[0].marker, 'fact_resolution_failed');
  assert.equal(evidence[0].failure_code, 'missing_target_work_kind');
  assert.equal(evidence[0].refusal_limb, 'mechanical_failure');
  assert.equal(collectDependencyBlockers(evidence)[0].refusal_limb, 'mechanical_failure');
});

test('unknown canonical work kind is a typed mechanical fact failure', () => {
  const evidence = resolveDependencyEvidenceVector({
    record: { id: 'WK-1000', repo: 'agent-chassis/agent-chassis', depends_on: ['WK-1001'], slices: [] },
    selectedUnit: null,
    dependencyStatuses: new Map([['WK-1001', { status: 'done' }]]),
    additionalRecords: new Map([['WK-1001', {
      id: 'WK-1001', work_kind: 'not-a-schema-kind', status: 'done', initiative: 'IN-0030', slices: []
    }]])
  });
  assert.equal(evidence[0].marker, 'fact_resolution_failed');
  assert.equal(evidence[0].failure_code, 'unknown_target_work_kind');
  assert.equal(evidence[0].target_work_kind, null);
  assert.equal(evidence[0].target_identity, 'WK-1001');
  assert.equal(evidence[0].target_status, 'done');
  assert.equal(evidence[0].provenance, 'canonical_wk_json');
  assert.equal(collectDependencyBlockers(evidence)[0].reason_code, 'unknown_target_work_kind');
});

test('valid canonical work kinds preserve target facts for every lifecycle status', () => {
  const workKinds = WORK_RECORD_WORK_KIND_VALUES;
  const statuses = WORK_RECORD_STATUS_VALUES;
  for (const workKind of workKinds) {
    for (const status of statuses) {
      const target = {
        id: 'WK-1001',
        work_kind: workKind,
        status,
        initiative: 'IN-0030',
        slices: []
      };
      const evidence = resolveDependencyEvidenceVector({
        record: { id: 'WK-1000', repo: 'agent-chassis/agent-chassis', depends_on: ['WK-1001'], slices: [] },
        selectedUnit: null,
        dependencyStatuses: new Map([['WK-1001', { status: 'done', reason: 'conflicting supplied fact' }]]),
        additionalRecords: new Map([['WK-1001', target]])
      });
      assert.equal(evidence[0].marker, 'resolved', `${workKind}/${status}`);
      assert.equal(evidence[0].target_work_kind, workKind, `${workKind}/${status}`);
      assert.equal(evidence[0].target_status, status, `${workKind}/${status}`);
      assert.equal(evidence[0].selected_status, status, `${workKind}/${status}`);
      assert.equal(evidence[0].target_identity, 'WK-1001', `${workKind}/${status}`);
      assert.equal(evidence[0].target_initiative, 'IN-0030', `${workKind}/${status}`);
      assert.equal(evidence[0].provenance, 'canonical_wk_json', `${workKind}/${status}`);
    }
  }
});

test('malformed supplied-only addresses use canonical mechanical failure evidence', () => {
  const evidence = resolveDependencyEvidenceVector({
    record: { id: 'WK-1000', repo: 'agent-chassis/agent-chassis', depends_on: [], slices: [] },
    selectedUnit: null,
    dependencyStatuses: new Map([['WK-1000#SLICE-typo', {
      status: 'done', reason: 'arbitrary supplied reason', marker: 'arbitrary supplied marker'
    }]]),
    additionalRecords: new Map()
  });
  assert.deepEqual(evidence[0], {
    address: 'WK-1000#SLICE-typo',
    source: 'supplied',
    record_id: null,
    slice_id: null,
    external_repo: null,
    selected_status: null,
    target_work_kind: null,
    target_identity: null,
    target_status: null,
    target_initiative: null,
    supplied_status: 'done',
    supplied_reason: 'arbitrary supplied reason',
    marker: 'fact_resolution_failed',
    provenance: 'none',
    reason: 'Dependency WK-1000#SLICE-typo could not be resolved from canonical facts',
    failure_code: 'malformed_dependency_address',
    refusal_limb: 'mechanical_failure'
  });
  assert.deepEqual(collectDependencyBlockers(evidence), [{
    code: 'blocked_dependency',
    refusal_limb: 'mechanical_failure',
    reason_code: 'malformed_dependency_address',
      reason: 'Dependency WK-1000#SLICE-typo could not be resolved from canonical facts'
  }]);
});

test('syntactically valid undeclared supplied-only addresses remain analysis-only', () => {
  const evidence = resolveDependencyEvidenceVector({
    record: { id: 'WK-1000', repo: 'agent-chassis/agent-chassis', depends_on: [], slices: [] },
    selectedUnit: null,
    dependencyStatuses: new Map([['WK-1001', { status: 'done', reason: 'transport observation' }]]),
    additionalRecords: new Map()
  });

  assert.deepEqual(evidence[0], {
    address: 'WK-1001',
    source: 'supplied',
    record_id: 'WK-1001',
    slice_id: null,
    external_repo: null,
    selected_status: 'done',
    supplied_status: 'done',
    supplied_reason: 'transport observation',
    marker: 'supplied_only',
    provenance: 'supplied',
    reason: 'transport observation'
  });
  assert.deepEqual(collectDependencyBlockers(evidence), []);
});

test('selected-slice canonical target wins over supplied transport', () => {
  const record = {
    id: 'WK-1000', repo: 'agent-chassis/agent-chassis', work_kind: 'tracker',
    status: 'active', initiative: 'IN-0030', depends_on: [],
    slices: [
      {
        id: 'SLICE-001', kind: 'slice', work_kind: 'implementation', status: 'todo',
        depends_on: ['WK-1000#SLICE-002']
      },
      { id: 'SLICE-002', work_kind: 'review', status: 'done' }
    ]
  };
  const evidence = resolveDependencyEvidenceVector({
    record,
    selectedUnit: record.slices[0],
    dependencyStatuses: new Map([['WK-1000#SLICE-002', { status: 'todo', reason: 'stale' }]]),
    additionalRecords: new Map()
  });

  assert.equal(evidence[0].target_identity, 'WK-1000#SLICE-002');
  assert.equal(evidence[0].target_work_kind, 'review');
  assert.equal(evidence[0].target_status, 'done');
  assert.equal(evidence[0].selected_status, 'done');
  assert.equal(evidence[0].provenance, 'canonical_wk_json');
  assert.equal(evidence[0].reason, null);
  assert.deepEqual(collectDependencyBlockers(evidence), []);
});

test('repo-qualified external target preserves supplied reason as analysis evidence', () => {
  const evidence = resolveDependencyEvidenceVector({
    record: { id: 'WK-1000', repo: 'agent-chassis/agent-chassis', depends_on: ['other-repo:WK-1001'], slices: [] },
    selectedUnit: null,
    dependencyStatuses: new Map([['other-repo:WK-1001', { status: 'blocked', reason: 'upstream paused' }]]),
    additionalRecords: new Map()
  });

  assert.equal(evidence[0].marker, 'external_supplied');
  assert.equal(evidence[0].selected_status, 'blocked');
  assert.equal(evidence[0].supplied_reason, 'upstream paused');
  assert.equal(evidence[0].reason, 'upstream paused');
  assert.deepEqual(collectDependencyBlockers(evidence), []);
});

test('policy-shaped evidence cannot create a dependency blocker', () => {
  assert.deepEqual(collectDependencyBlockers([{
    address: 'WK-1001',
    marker: 'resolved',
    refusal_limb: 'policy_decision',
    policy_decision: { code: 'blocked_dependency', reason: 'policy-only' }
  }]), []);
});
