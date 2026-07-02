import assert from 'node:assert/strict';
import test from 'node:test';

import * as recoveryModule from '../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission-recovery.mjs';
import * as schemaConstants from '../packages/wiki-core/src/lib/work-record-schema-constants.mjs';

function textify(value, seen = new Set()) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'function') {
    return `[function ${value.name || 'anonymous'}]`;
  }

  if (seen.has(value)) {
    return '[circular]';
  }

  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((entry) => textify(entry, seen)).join('\n');
  }

  if (typeof value === 'object') {
    seen.add(value);
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${textify(entry, seen)}`)
      .join('\n');
  }

  return String(value);
}

function makeDecision(reasonCode, evidence = {}) {
  return {
    schema_version: 'worker-admission.v1',
    decision_kind: 'work_unit_atomicity',
    aggregate_decision: 'review_required',
    decision_code: reasonCode,
    decision_codes: [reasonCode],
    unit: {
      kind: 'slice',
      address: 'WK-9000#slice',
      record_id: 'WK-9000',
      slice_id: 'slice',
    },
    reason: {
      code: reasonCode,
      evidence,
    },
    reasons: [
      {
        code: reasonCode,
        evidence,
      },
    ],
  };
}

async function invoke(candidate, input) {
  const output = candidate(input);

  if (output && typeof output.then === 'function') {
    return await output;
  }

  return output;
}

function isRelevantText(text) {
  return /admit|recover|remediation|precondition|waivable/i.test(text);
}

async function discoverProjector() {
  const preferredNames = [
    'default',
    'projectWorkerAdmissionRecovery',
    'workspaceAgentWorkerAdmissionRecovery',
    'workerAdmissionRecovery',
    'projectRecovery',
    'recoveryProjector',
    'projectWorkerAdmissionRemediation',
  ];

  const candidates = [];
  for (const name of preferredNames) {
    const candidate = name === 'default' ? recoveryModule.default : recoveryModule[name];
    if (typeof candidate === 'function') {
      candidates.push([name, candidate]);
    }
  }

  for (const [name, value] of Object.entries(recoveryModule)) {
    if (typeof value === 'function' && !preferredNames.includes(name) && /recover|project|remed/i.test(name)) {
      candidates.push([name, value]);
    }
  }

  const probe = makeDecision('no_precondition_constraints', {});

  for (const [name, candidate] of candidates) {
    try {
      const result = await invoke(candidate, probe);
      const text = textify(result);
      if (isRelevantText(text)) {
        return { name, candidate };
      }
    } catch {

    }
  }

  throw new Error(
    `Could not find a recovery projector export in workspace-agent-worker-admission-recovery.mjs. ` +
      `Exports: ${Object.keys(recoveryModule).join(', ') || '(none)'}`,
  );
}

function discoverStatusLifecycleMap() {
  const statusValues = schemaConstants.WORK_RECORD_STATUS_VALUES;
  assert.ok(Array.isArray(statusValues), 'WORK_RECORD_STATUS_VALUES must be an array');

  const candidates = [];
  for (const moduleExports of [schemaConstants, recoveryModule]) {
    for (const [name, value] of Object.entries(moduleExports)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        candidates.push([name, value]);
      }
    }
  }

  for (const [name, candidate] of candidates) {
    if (statusValues.every((status) => Object.hasOwn(candidate, status))) {
      return { name, candidate };
    }
  }

  throw new Error(
    `Could not find a lifecycle mapping export covering every WORK_RECORD_STATUS_VALUES entry. ` +
      `Exports: ${[...Object.keys(schemaConstants), ...Object.keys(recoveryModule)].join(', ') || '(none)'}`,
  );
}

const { candidate: projector, name: projectorName } = await discoverProjector();
const { candidate: lifecycleMap, name: lifecycleMapName } = discoverStatusLifecycleMap();

test('recovery projector routes each precondition reject to the right remediation and keeps rejects non-waivable', async () => {
  const cases = [
    {
      code: 'unsatisfied_dependencies',
      evidence: {
        incomplete_upstream_ids: ['WK-1010'],
        unsatisfied_count: 1,
      },
      expectations: [/complete the upstream/i, /non[-_ ]?waivable/i],
    },
    {
      code: 'dependency_cycle',
      evidence: {
        cycle_ids: ['WK-2020', 'WK-2021'],
      },
      expectations: [/depends_on edges/i, /non[-_ ]?waivable/i],
    },
    {
      code: 'lifecycle_not_dispatchable',
      evidence: {
        current_status: 'review',
      },
      expectations: [/change status/i, /non[-_ ]?waivable/i],
    },
    {
      code: 'unit_superseded',
      evidence: {
        replacement_unit: 'WK-4040#replacement',
      },
      expectations: [/re-?point/i, /replacement/i, /non[-_ ]?waivable/i],
    },
    {
      code: 'precondition_graph_malformed',
      evidence: {
        malformed_field: 'edges',
      },
      expectations: [/producer defect/i, /non[-_ ]?waivable/i],
    },
  ];

  for (const { code, evidence, expectations } of cases) {
    const result = await invoke(projector, makeDecision(code, evidence));
    const text = textify(result);

    for (const expectation of expectations) {
      assert.match(
        text,
        expectation,
        `expected ${projectorName} to route ${code} to the right remediation, got:\n${text}`,
      );
    }

    assert.doesNotMatch(
      text,
      /large[- ]file refactor/i,
      `precondition remediation for ${code} must never fall back to large-file refactor guidance. Got:\n${text}`,
    );
  }
});

test('no_precondition_constraints is an admit reason, not a denial', async () => {
  const result = await invoke(
    projector,
    makeDecision('no_precondition_constraints', {
      selected_unit: 'WK-5050',
    }),
  );
  const text = textify(result);

  assert.match(
    text,
    /admit/i,
    `expected ${projectorName} to treat no_precondition_constraints as an admit reason, got:\n${text}`,
  );
  assert.doesNotMatch(
    text,
    /large[- ]file refactor/i,
    `admit output for no_precondition_constraints must not drift into large-file guidance. Got:\n${text}`,
  );
});

const REMOTE_GATE_REFUSAL_CASES = [
  {
    code: 'remote_admit_unratified',
    expectation: /ratify\/enable the Chassis Control Engine worker-admission authority binding/i,
  },
  {
    code: 'remote_enforcement_unavailable',
    expectation: /check service reachability, api key\/auth, and entitlement/i,
  },
  {
    code: 'remote_enforcement_absent',
    expectation: /configure the missing node_engine_\*/i,
  },
];

const REMOTE_GATE_REFUSAL_UNIT = {
  kind: 'slice',
  address: 'WK-0380#SLICE-003',
  record_id: 'WK-0380',
  slice_id: 'SLICE-003',
};

test('buildRemoteGateRefusalRecoveryDetail projects advisory next-steps for the three fail-closed gate codes', () => {
  const build = recoveryModule.buildRemoteGateRefusalRecoveryDetail;
  assert.equal(typeof build, 'function', 'expected buildRemoteGateRefusalRecoveryDetail export');

  for (const { code, expectation } of REMOTE_GATE_REFUSAL_CASES) {
    const recovery = build({ unit: REMOTE_GATE_REFUSAL_UNIT, remoteGateCode: code });
    assert.ok(recovery, `expected a recovery detail for ${code}`);
    assert.equal(recovery.classification, code, `classification should name the gate code for ${code}`);
    assert.equal(recovery.is_deny_or_reject, false, `${code} is a fail-closed enforcement disposition, not a deny/reject`);
    assert.equal(recovery.selected_unit_address, 'WK-0380#SLICE-003');
    assert.equal(recovery.selected_record_id, 'WK-0380');
    assert.equal(recovery.selected_slice_id, 'SLICE-003');
    assert.ok(Array.isArray(recovery.next_actions) && recovery.next_actions.length === 1, `${code} should carry one next action`);
    assert.match(recovery.next_actions[0], expectation, `${code} next action should surface its advisory guidance`);

    assert.match(recovery.authority_note, /Chassis Control Engine remains the only authority/i);
    assert.match(recovery.authority_note, /does not itself authorize a launch/i);
    assert.match(recovery.authority_note, /does not convert the refusal to admit/i);
  }
});

test('buildRemoteGateRefusalRecoveryDetail returns null for codes outside the closed set (incl. local_refusal_preserved)', () => {
  const build = recoveryModule.buildRemoteGateRefusalRecoveryDetail;
  for (const code of ['local_refusal_preserved', 'remote_needs_review', 'remote_reject', 'remote_admit', 'remote_enforcement_local_only', 'unknown_code', '', null, undefined]) {
    assert.equal(
      build({ unit: REMOTE_GATE_REFUSAL_UNIT, remoteGateCode: code }),
      null,
      `expected null for non-covered gate code ${String(code)}`,
    );
  }

  const recovery = build({ remoteGateCode: 'remote_enforcement_absent' });
  assert.ok(recovery);
  assert.equal(recovery.selected_unit_address, null);
});

test('REMOTE_GATE_REFUSAL_RECOVERY_CODES is exactly the three covered fail-closed codes', () => {
  assert.deepEqual(
    [...recoveryModule.REMOTE_GATE_REFUSAL_RECOVERY_CODES].sort(),
    ['remote_admit_unratified', 'remote_enforcement_absent', 'remote_enforcement_unavailable'],
  );
});

test('every work-record status has a lifecycle mapping entry', () => {
  const statuses = schemaConstants.WORK_RECORD_STATUS_VALUES;
  assert.ok(Array.isArray(statuses), 'WORK_RECORD_STATUS_VALUES must be an array');

  for (const status of statuses) {
    assert.ok(
      Object.hasOwn(lifecycleMap, status),
      `expected ${lifecycleMapName} to define a lifecycle mapping for status ${status}`,
    );
    assert.notEqual(
      lifecycleMap[status],
      undefined,
      `expected ${lifecycleMapName}.${status} to be defined`,
    );
  }
});
