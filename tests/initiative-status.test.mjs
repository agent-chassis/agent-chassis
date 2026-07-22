import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { loadInitiativeStatusTaxonomy } from '../packages/wiki-core/src/lib/initiative-status.mjs';
import { workspaceInitiativeStatus } from '../packages/wiki-core/src/operations/initiative-status.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const testInitiative = 'IN-TEST';

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const reasonCodeOf = (action) => (action && typeof action === 'object' ? action.reason_code ?? null : null);
const kindOf = (action) => (action && typeof action === 'object' ? action.kind ?? null : null);
const idOf = (action) => (action && typeof action === 'object' ? action.id ?? null : null);

const observedReasonCodes = (result) =>
  new Set(
    [result?.next_action, ...(Array.isArray(result?.top_actions) ? result.top_actions : [])]
      .map(reasonCodeOf)
      .filter(Boolean),
  );

const readyDispatchRecord = {
  id: 'WK-9001',
  initiative: testInitiative,
  status: 'todo',
  dispatch_intent: { target_unit: 'slice', intended_agent_role: 'worker' },
};

const reviewNeededRecord = {
  id: 'WK-9002',
  initiative: testInitiative,
  status: 'parked',
  slices: [{ id: 'SLICE-001', work_kind: 'implementation', status: 'review' }],
};

const changesRequestedRecord = {
  id: 'WK-9003',
  initiative: testInitiative,
  status: 'parked',
  slices: [
    {
      id: 'SLICE-001',
      work_kind: 'implementation',
      status: 'review',
      review_run_ref: { monitor_handle: 'wkmh_changes_requested' },
      review_result: { outcome: 'changes_requested' },
    },
  ],
};

const remediationReadyRecord = {
  id: 'WK-9004',
  initiative: testInitiative,
  status: 'parked',
  slices: [
    {
      id: 'SLICE-001',
      work_kind: 'implementation',
      status: 'review',
      review_run_ref: { monitor_handle: 'wkmh_in_flight' },
    },
  ],
};

const acceptedSliceRecord = {
  id: 'WK-9005',
  initiative: testInitiative,
  status: 'parked',
  slices: [
    {
      id: 'SLICE-001',
      work_kind: 'implementation',
      status: 'review',
      review_run_ref: { monitor_handle: 'wkmh_accepted' },
      review_result: { outcome: 'accepted' },
    },
  ],
};

const parentCloseoutRecord = {
  id: 'WK-9006',
  initiative: testInitiative,
  status: 'review',
  review_run_ref: { monitor_handle: 'wkmh_parent' },
  review_result: { outcome: 'accepted' },
};

const blockedRecord = {
  id: 'WK-9007',
  initiative: testInitiative,
  status: 'blocked',
};

const initiativeRecords = [
  readyDispatchRecord,
  reviewNeededRecord,
  changesRequestedRecord,
  remediationReadyRecord,
  acceptedSliceRecord,
  parentCloseoutRecord,
  blockedRecord,
];

const initiativeStatus = (overrides = {}) =>
  workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records: initiativeRecords,
    ...overrides,
  });

test('initiative-status taxonomy keeps the closed local reason vocabulary', () => {
  const taxonomy = loadInitiativeStatusTaxonomy({ repoRoot });
  const codes = (taxonomy.local_reason_codes ?? []).map((entry) => entry.code).filter(Boolean);
  const actions = taxonomy.action_kinds ?? [];

  assert.equal(codes.length, 20);

  for (const code of [
    'record_needs_validation',
    'review_required',
    'review_result_ready',
    'remediation_required',
    'slice_ready_to_close',
    'parent_ready_to_close',
    'scope_mismatch',
    'closed_or_inactive',
  ]) {
    assert.ok(codes.includes(code), `taxonomy should declare ${code}`);
  }

  for (const code of [
    'runtime_blocker_present',
    'graph_impact_evidence_needed',
    'admission_metrics_stale_or_missing',
    'lint_verification_needed',
  ]) {
    assert.ok(codes.includes(code), `taxonomy should reserve ${code}`);
  }

  const admissionReason = taxonomy.local_reason_codes.find(
    (entry) => entry.code === 'admission_metrics_stale_or_missing',
  );
  assert.equal(admissionReason.default_action, 'validate_dispatch');
  assert.ok(actions.some((action) => action.kind === 'validate_dispatch'));
  assert.ok(!actions.some((action) => action.kind === 'refresh_admission_metrics'));
});

test('initiative default output stays compact and truncated', () => {
  const compact = initiativeStatus();

  assert.equal(compact.schema_version, 'initiative-status.v1');
  assert.equal(compact.top_actions.length, 5);
  assert.equal(compact.truncated, true);
  assert.ok(jsonBytes(compact) < 4096, 'compact output should stay decision-sized');

  for (const action of compact.top_actions) {
    assert.ok(idOf(action), 'each action exposes a stable id');
    assert.ok(reasonCodeOf(action), 'each action exposes a reason code');
    assert.ok(kindOf(action), 'each action exposes a kind');
    assert.ok(action.target_unit, 'each action exposes a target unit');
  }

  assert.ok(compact.next_action);
  assert.ok(reasonCodeOf(compact.next_action));

  for (const banned of ['acceptance', 'validation', 'docs', 'closure', 'work_record_summary', 'agent_notes']) {
    assert.ok(!(banned in compact), `compact output must not expose ${banned}`);
  }
});

test('initiative frontier covers the implemented coordinator scenarios', () => {
  const frontier = initiativeStatus({ top_action_limit: 50 });
  const observed = observedReasonCodes(frontier);

  const expected = {
    'ready worker dispatch': 'record_needs_validation',
    'review needed': 'review_required',
    'changes-requested remediation': 'remediation_required',
    'remediation ready for review': 'review_result_ready',
    'accepted review closeout': 'slice_ready_to_close',
    'parent closeout': 'parent_ready_to_close',
  };

  for (const [scenario, reasonCode] of Object.entries(expected)) {
    assert.ok(observed.has(reasonCode), `missing coverage for ${scenario} (${reasonCode})`);
  }

  assert.ok(frontier.top_actions.length <= 50);
});

test('ready worker dispatch routes through dispatch-readiness validation', () => {
  const frontier = initiativeStatus({ top_action_limit: 50 });
  const dispatchAction = frontier.top_actions.find(
    (action) => action.target_unit === 'WK-9001',
  );

  assert.ok(dispatchAction, 'expected an action for the ready-to-dispatch record');
  assert.equal(kindOf(dispatchAction), 'validate_dispatch');
  assert.equal(dispatchAction.suggested_tool, 'workspace_validate_dispatch');
  assert.equal(reasonCodeOf(dispatchAction), 'record_needs_validation');
});

test('runtime/operator blocked unit surfaces as a blocking next action', () => {
  const frontier = initiativeStatus({ top_action_limit: 50 });
  const blockedAction = frontier.top_actions.find(
    (action) => action.target_unit === 'WK-9007',
  );

  assert.ok(blockedAction, 'expected an action for the blocked record');
  assert.equal(blockedAction.blocking, true);
  assert.equal(kindOf(blockedAction), 'inspect');
  assert.equal(blockedAction.suggested_tool, 'workspace_work_record_summary');
  assert.equal(reasonCodeOf(blockedAction), 'record_needs_validation');
});

test('selected-unit runtime blocker evidence emits the grounded runtime reason code', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    records: [
      {
        id: 'WK-9700',
        initiative: testInitiative,
        status: 'active',
        derived_evidence: [
          {
            target_unit: 'WK-9700',
            runtime_blocker_code: 'read_only_mount',
          },
        ],
      },
    ],
    unit: 'WK-9700',
  });
  const nextAction = result.next_action;

  assert.equal(reasonCodeOf(nextAction), 'runtime_blocker_present');
  assert.equal(kindOf(nextAction), 'resolve_runtime_blocker');
  assert.equal(nextAction.suggested_tool, 'workspace_runtime_blocker_taxonomy');
  assert.equal(nextAction.priority, 'critical');
  assert.equal(nextAction.blocking, true);
});

test('selected-unit graph-required evidence emits the grounded graph reason code', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    records: [
      {
        id: 'WK-9710',
        initiative: testInitiative,
        status: 'active',
        slices: [
          {
            id: 'SLICE-001',
            work_kind: 'implementation',
            status: 'todo',
            dispatch_intent: { target_unit: 'slice', intended_agent_role: 'worker' },
          },
        ],
        derived_evidence: [
          {
            target_unit: 'WK-9710#SLICE-001',
            graph_impact: { required: true },
          },
        ],
      },
    ],
    unit: 'WK-9710#SLICE-001',
  });
  const nextAction = result.next_action;

  assert.equal(reasonCodeOf(nextAction), 'graph_impact_evidence_needed');
  assert.equal(kindOf(nextAction), 'record_graph_impact_evidence');
  assert.equal(nextAction.suggested_tool, 'workspace_record_graph_impact_evidence');
  assert.equal(nextAction.blocking, true);
});

test('missing or stale admission hints rank read-only validation without recovery or dispatchability claims', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records: [
      {
        id: 'WK-9720',
        initiative: testInitiative,
        status: 'active',
        derived_evidence: [
          {
            selected_unit: 'WK-9720',
            admission_metrics: { freshness_state: 'stale' },
          },
        ],
      },
      {
        id: 'WK-9721',
        initiative: testInitiative,
        status: 'active',
        derived_evidence: [
          {
            selected_unit: 'WK-9721',
            admission_metrics: { missing_metrics: ['write_scope_count'] },
          },
        ],
      },
    ],
    top_action_limit: 50,
  });

  for (const targetUnit of ['WK-9720', 'WK-9721']) {
    const action = result.top_actions.find((candidate) => candidate.target_unit === targetUnit);
    assert.ok(action, `expected an admission-hint action for ${targetUnit}`);
    assert.equal(reasonCodeOf(action), 'admission_metrics_stale_or_missing');
    assert.equal(kindOf(action), 'validate_dispatch');
    assert.equal(action.suggested_tool, 'workspace_validate_dispatch');
    assert.equal(action.target_unit, targetUnit);
    assert.equal(action.blocking, true);
    assert.equal('recovery' in action, false);
    assert.equal('dispatchable' in action, false);
    assert.doesNotMatch(JSON.stringify(action), /recoverable|dispatchable/i);
  }

  const rendered = JSON.stringify(result);
  assert.doesNotMatch(rendered, /workspace_work_record_refresh_admission_metrics/);
  assert.doesNotMatch(rendered, /workspace_work_record_refresh_target_resolution_evidence/);
});

test('ordinary blocked units without runtime taxonomy evidence stay ordinary blocked actions', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    records: [
      {
        id: 'WK-9730',
        initiative: testInitiative,
        status: 'blocked',
        blockers: ['Waiting on coordinator scope decision.'],
      },
    ],
    unit: 'WK-9730',
  });
  const nextAction = result.next_action;

  assert.equal(reasonCodeOf(nextAction), 'record_needs_validation');
  assert.equal(kindOf(nextAction), 'inspect');
  assert.equal(nextAction.suggested_tool, 'workspace_work_record_summary');
  assert.equal(nextAction.blocking, true);
});

test('derived evidence is selected-unit aware for sibling slice evidence', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    records: [
      {
        id: 'WK-9740',
        initiative: testInitiative,
        status: 'active',
        slices: [
          { id: 'SLICE-001', work_kind: 'implementation', status: 'todo' },
          { id: 'SLICE-002', work_kind: 'implementation', status: 'todo' },
        ],
        derived_evidence: [
          {
            target_unit: 'WK-9740#SLICE-002',
            runtime_blocker_code: 'read_only_mount',
            graph_impact: { required: true },
            missing_metrics: ['artifact_kind_metadata'],
          },
        ],
      },
    ],
    unit: 'WK-9740#SLICE-001',
  });
  const nextAction = result.next_action;

  assert.equal(reasonCodeOf(nextAction), 'record_needs_validation');
  assert.equal(kindOf(nextAction), 'inspect');
  assert.notEqual(reasonCodeOf(nextAction), 'runtime_blocker_present');
  assert.notEqual(reasonCodeOf(nextAction), 'graph_impact_evidence_needed');
  assert.notEqual(reasonCodeOf(nextAction), 'admission_metrics_stale_or_missing');
});

test('derived evidence is selected-unit aware between parent and slice addresses', () => {
  const parentResult = workspaceInitiativeStatus({
    repoRoot,
    records: [
      {
        id: 'WK-9750',
        initiative: testInitiative,
        status: 'active',
        slices: [{ id: 'SLICE-001', work_kind: 'implementation', status: 'todo' }],
        derived_evidence: [
          {
            target_unit: 'WK-9750#SLICE-001',
            graph_impact: { stale: true },
          },
        ],
      },
    ],
    unit: 'WK-9750',
  });
  const sliceResult = workspaceInitiativeStatus({
    repoRoot,
    records: [
      {
        id: 'WK-9751',
        initiative: testInitiative,
        status: 'active',
        slices: [{ id: 'SLICE-001', work_kind: 'implementation', status: 'todo' }],
        derived_evidence: [
          {
            target_unit: 'WK-9751',
            missing_metrics: ['runtime_mode_metadata'],
          },
        ],
      },
    ],
    unit: 'WK-9751#SLICE-001',
  });

  assert.equal(reasonCodeOf(parentResult.next_action), 'record_needs_validation');
  assert.equal(kindOf(parentResult.next_action), 'inspect');
  assert.equal(reasonCodeOf(sliceResult.next_action), 'record_needs_validation');
  assert.equal(kindOf(sliceResult.next_action), 'inspect');
});

test('selected slice body and closure fields do not trigger reserved evidence actions', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    records: [
      {
        id: 'WK-9755',
        initiative: testInitiative,
        status: 'active',
        slices: [
          {
            id: 'SLICE-001',
            work_kind: 'implementation',
            status: 'active',
            runtime_blocker_code: 'read_only_mount',
            graph_impact: { required: true, freshness_state: 'stale' },
            admission_metrics: { freshness_state: 'stale' },
            sections: {
              closure: {
                runtime_blocker_code: 'read_only_mount',
                graph_impact: { required: true },
                missing_metrics: ['artifact_kind_metadata'],
              },
            },
          },
        ],
      },
    ],
    unit: 'WK-9755#SLICE-001',
  });
  const nextAction = result.next_action;

  assert.equal(reasonCodeOf(nextAction), 'record_needs_validation');
  assert.equal(kindOf(nextAction), 'inspect');
  assert.equal(nextAction.suggested_tool, 'workspace_work_record_summary');
  assert.equal(nextAction.blocking, false);
  assert.notEqual(reasonCodeOf(nextAction), 'runtime_blocker_present');
  assert.notEqual(reasonCodeOf(nextAction), 'graph_impact_evidence_needed');
  assert.notEqual(reasonCodeOf(nextAction), 'admission_metrics_stale_or_missing');
  assert.notEqual(kindOf(nextAction), 'resolve_runtime_blocker');
  assert.notEqual(kindOf(nextAction), 'record_graph_impact_evidence');
  assert.notEqual(kindOf(nextAction), 'validate_dispatch');
});

test('repo-wide lint evidence is not synthesized as a selected-WK blocker', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    records: [
      {
        id: 'WK-9760',
        initiative: testInitiative,
        status: 'active',
        derived_evidence: [
          {
            lint: { validation_failure: true },
            lint_verification: { required: true },
          },
        ],
      },
    ],
    unit: 'WK-9760',
  });
  const nextAction = result.next_action;

  assert.equal(reasonCodeOf(nextAction), 'record_needs_validation');
  assert.equal(kindOf(nextAction), 'inspect');
  assert.notEqual(reasonCodeOf(nextAction), 'lint_verification_needed');
  assert.notEqual(kindOf(nextAction), 'run_lint');
});

test('verbose disclosure returns more detail than compact mode', () => {
  const compact = initiativeStatus();
  const verbose = initiativeStatus({ verbose: true });

  assert.ok(jsonBytes(verbose) > jsonBytes(compact), 'verbose output should add evidence detail');
  assert.ok(verbose.evidence && typeof verbose.evidence === 'object', 'verbose output should expose evidence');
});

test('selected_action_id pulls the chosen action to the front', () => {

  const selected = initiativeStatus({ selected_action_id: 'WK-9006' });

  assert.equal(idOf(selected.top_actions[0]), 'WK-9006');
  assert.equal(reasonCodeOf(selected.top_actions[0]), 'parent_ready_to_close');
});

test('compact and selected-action disclosure work for grounded evidence actions', () => {
  const records = [
    {
      id: 'WK-9770',
      initiative: testInitiative,
      status: 'active',
      derived_evidence: [{ target_unit: 'WK-9770', runtime_blocker_code: 'read_only_mount' }],
    },
    {
      id: 'WK-9771',
      initiative: testInitiative,
      status: 'active',
      derived_evidence: [{ target_unit: 'WK-9771', graph_impact: { required: true } }],
    },
  ];
  const compact = workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records,
    top_action_limit: 1,
  });
  const selected = workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records,
    top_action_limit: 1,
    selected_action_id: 'WK-9771',
  });
  const verbose = workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records,
    selected_action_id: 'WK-9771',
    verbose: true,
  });

  assert.equal(compact.top_actions.length, 1);
  assert.equal(reasonCodeOf(compact.top_actions[0]), 'runtime_blocker_present');
  assert.equal(jsonBytes(compact) < 2048, true, 'compact evidence output should stay decision-sized');
  assert.equal(idOf(selected.top_actions[0]), 'WK-9771');
  assert.equal(reasonCodeOf(selected.top_actions[0]), 'graph_impact_evidence_needed');
  assert.ok(verbose.evidence && typeof verbose.evidence === 'object', 'verbose output should expose evidence metadata');
});

test('unit scope keeps review-required dispatch explicit', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    records: [
      {
        id: 'WK-9100',
        initiative: testInitiative,
        status: 'active',
        slices: [{ id: 'SLICE-001', work_kind: 'implementation', status: 'review' }],
      },
    ],
    unit: 'WK-9100#SLICE-001',
  });
  const nextAction = result.next_action;

  assert.equal(reasonCodeOf(nextAction), 'review_required');
  assert.equal(kindOf(nextAction), 'dispatch_review');
  assert.equal(nextAction.target_role, 'reviewer');
  assert.equal(nextAction.blocking, true);
});

test('unit scope flags an initiative/unit scope mismatch as blocking', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records: [
      {
        id: 'WK-9200',
        initiative: 'IN-OTHER',
        status: 'done',
        slices: [{ id: 'SLICE-001', work_kind: 'implementation', status: 'review' }],
      },
    ],
    unit: 'WK-9200#SLICE-001',
  });
  const nextAction = result.next_action;

  assert.equal(reasonCodeOf(nextAction), 'scope_mismatch');
  assert.equal(kindOf(nextAction), 'split_work');
  assert.equal(nextAction.blocking, true);
});

test('unit scope stays compact and closed for a terminal tracker', () => {
  const closed = workspaceInitiativeStatus({
    repoRoot,
    records: [{ id: 'WK-9300', initiative: testInitiative, status: 'done' }],
    unit: 'WK-9300',
  });

  assert.equal(closed.top_actions.length, 1);
  assert.equal(reasonCodeOf(closed.next_action), 'closed_or_inactive');
  assert.ok(jsonBytes(closed) < 2048, 'closed-unit output should stay compact');
  assert.ok(!('work_record_summary' in closed), 'unit lens must not duplicate the work-record summary');
});

const targetUnitsOf = (result) =>
  [result?.next_action, ...(Array.isArray(result?.top_actions) ? result.top_actions : [])]
    .filter(Boolean)
    .map((action) => action.target_unit);

test('open slice under a done parent is suppressed from actions and counts', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records: [
      {
        id: 'WK-9400',
        initiative: testInitiative,
        status: 'done',
        slices: [{ id: 'SLICE-001', work_kind: 'implementation', status: 'review' }],
      },
    ],
  });

  assert.ok(
    !targetUnitsOf(result).includes('WK-9400#SLICE-001'),
    'a done-parent open slice must not surface as an action',
  );
  assert.equal(result.counts.total, 0, 'a done-parent open slice must not be counted');
  assert.equal(result.counts.review, 0, 'the diverted review slice must not inflate the review count');
});

test('open slice under a cancelled parent is suppressed from actions and counts', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records: [
      {
        id: 'WK-9410',
        initiative: testInitiative,
        status: 'cancelled',
        slices: [{ id: 'SLICE-001', work_kind: 'implementation', status: 'blocked' }],
      },
    ],
  });

  assert.ok(
    !targetUnitsOf(result).includes('WK-9410#SLICE-001'),
    'a cancelled-parent open slice must not surface as an action',
  );
  assert.equal(result.counts.total, 0, 'a cancelled-parent open slice must not be counted');
  assert.equal(result.counts.blocked, 0, 'the diverted blocked slice must not inflate the blocked count');
});

test('genuinely-open records and non-terminal-parent slices still surface and count', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records: [
      {
        id: 'WK-9500',
        initiative: testInitiative,
        status: 'todo',
        dispatch_intent: { target_unit: 'slice', intended_agent_role: 'worker' },
      },
      {
        id: 'WK-9501',
        initiative: testInitiative,
        status: 'active',
        slices: [{ id: 'SLICE-001', work_kind: 'implementation', status: 'review' }],
      },
    ],
  });

  const targets = targetUnitsOf(result);
  assert.ok(targets.includes('WK-9500'), 'a genuinely-open WK-level record still surfaces');
  assert.ok(
    targets.includes('WK-9501#SLICE-001'),
    'a slice under a non-terminal (active) parent still surfaces',
  );

  assert.equal(result.counts.total, 3, 'all three genuinely-open units are counted');
  assert.equal(result.counts.review, 1, 'the non-terminal-parent review slice is still counted');
  assert.equal(result.consistency.length, 0, 'no terminal-parent slices means an empty consistency channel');
});

test('a terminal-parent open slice appears in the consistency channel', () => {
  const result = workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records: [
      {
        id: 'WK-9400',
        initiative: testInitiative,
        status: 'done',
        slices: [{ id: 'SLICE-001', work_kind: 'implementation', status: 'review' }],
      },
    ],
  });

  assert.ok(Array.isArray(result.consistency), 'scan mode always emits a consistency array');
  assert.equal(result.consistency.length, 1);
  const [entry] = result.consistency;
  assert.equal(entry.kind, 'open_slice_under_terminal_parent');
  assert.equal(entry.record_id, 'WK-9400');
  assert.equal(entry.slice_id, 'SLICE-001');
  assert.equal(entry.record_status, 'done');
});

test('a slice in two slice arrays under a terminal parent is listed in consistency once', () => {
  const sharedSlice = { id: 'SLICE-001', work_kind: 'implementation', status: 'review' };
  const result = workspaceInitiativeStatus({
    repoRoot,
    initiative: testInitiative,
    records: [
      {
        id: 'WK-9600',
        initiative: testInitiative,
        status: 'done',
        slices: [sharedSlice],
        review_slices: [sharedSlice],
      },
    ],
  });

  const matches = result.consistency.filter(
    (entry) => entry.record_id === 'WK-9600' && entry.slice_id === 'SLICE-001',
  );
  assert.equal(matches.length, 1, 'a slice present in two arrays must be deduped to a single consistency entry');
});
