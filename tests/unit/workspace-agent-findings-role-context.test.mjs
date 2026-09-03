import assert from 'node:assert/strict';
import test from 'node:test';

import { computeWorkRecordSourceDigest } from '@agent-chassis/wiki-core';
import {
  createTrustedAdvisoryReviewPresentation,
  createTrustedFrozenStandaloneFindingsContract,
} from
  '../../packages/agent-launch-cli/src/lib/backend-review-identity.mjs';
import { digestTrustedExactReviewEvidence } from
  '../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs';
import {
  FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
  FROZEN_STANDALONE_FINDINGS_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
  FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
  classifyFindingsAcceptanceSection,
  loadWorkspaceAgentFindingsRoleContext,
  resolveFindingsOnlyAcceptanceContract,
  resolveWorkspaceAgentFindingsRoleContext,
} from '../../packages/agent-launch-cli/src/lib/workspace-agent-findings-role-context.mjs';

function createWorkRecord() {
  return {
    id: 'WK-1037',
    title: 'Refactor family executors into thin launcher adapters before prompt convergence',
    status: 'active',
    work_kind: 'tracker',
    acceptance: {
      criteria: ['tracker criterion one', 'tracker criterion two'],
      validation: ['validation step one', 'validation step two'],
    },
    slices: [
      {
        id: 'SLICE-003',
        title: 'Define shared findings-role subject contract context helper',
        status: 'active',
        acceptance: {
          criteria: ['slice criterion one', 'slice criterion two'],
          validation: ['slice validation one', 'slice validation two'],
        },
      },
      {
        id: 'parser-slice',
        title: 'Grandfathered semantic slice',
        status: 'active',
        acceptance: {
          criteria: ['semantic slice criterion one'],
          validation: ['semantic slice validation one'],
        },
      },
    ],
  };
}

test('advisory presentation accepts only the canonical dispatch role vocabulary', async () => {
  const subject = 'WK-1037#SLICE-003';
  const parent = createWorkRecord();
  const selected = parent.slices[0];
  const presentation = createTrustedAdvisoryReviewPresentation({
    role: 'reviewer',
    subject,
    canonicalParentWkContract: JSON.stringify(parent),
    reviewUnitContract: JSON.stringify(selected),
  });

  const resolved = await resolveFindingsOnlyAcceptanceContract({
    role: 'reviewer',
    subject,
    frozenReviewContract: presentation,
  });
  assert.deepEqual(resolved, {
    acceptanceCriteria: [
      'tracker criterion one',
      'tracker criterion two',
      'slice criterion one',
      'slice criterion two',
    ],
    acceptanceValidation: [
      'validation step one',
      'validation step two',
      'slice validation one',
      'slice validation two',
    ],
  });

  await assert.rejects(
    resolveFindingsOnlyAcceptanceContract({
      role: 'review',
      subject,
      frozenReviewContract: presentation,
    }),
    (error) => error?.code === 'advisory_review_presentation_invalid',
  );
});

test('resolves whole WK subject context', () => {
  const result = resolveWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037',
    selectedUnit: 'WK-1037',
    workRecord: createWorkRecord(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.acceptanceCriteria, ['tracker criterion one', 'tracker criterion two']);
  assert.deepEqual(result.validation, ['validation step one', 'validation step two']);
  assert.equal(result.record.id, 'WK-1037');
  assert.equal(result.slice, null);
  assert.equal(result.renderContext.subjectAddress, 'WK-1037');
});

test('resolves canonical slice subject context', () => {
  const result = resolveWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037#SLICE-003',
    selectedUnit: { address: 'WK-1037#SLICE-003' },
    workRecord: createWorkRecord(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.acceptanceCriteria, ['slice criterion one', 'slice criterion two']);
  assert.deepEqual(result.validation, ['slice validation one', 'slice validation two']);
  assert.equal(result.slice.id, 'SLICE-003');
  assert.equal(result.renderContext.selectedUnitAddress, 'WK-1037#SLICE-003');
});

test('resolves grandfathered semantic slice subject context', () => {
  const result = resolveWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037#parser-slice',
    selectedUnit: { recordId: 'WK-1037', sliceId: 'parser-slice' },
    workRecord: createWorkRecord(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.acceptanceCriteria, ['semantic slice criterion one']);
  assert.deepEqual(result.validation, ['semantic slice validation one']);
  assert.equal(result.slice.id, 'parser-slice');
  assert.equal(result.renderContext.subjectAddress, 'WK-1037#parser-slice');
});

test('fails closed when selected-unit context is missing', () => {
  const result = resolveWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037',
    workRecord: createWorkRecord(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'missing_selected_unit');
  assert.equal(result.error.diagnostics.reason, 'missing_selected_unit');
});

test('fails closed when selected-unit context is malformed', () => {
  const result = resolveWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037',
    selectedUnit: 'WK-1037#bad id',
    workRecord: createWorkRecord(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_selected_unit');
  assert.equal(result.error.diagnostics.reason, 'invalid_selected_unit');
});

test('fails closed when selected-unit context mismatches subject', () => {
  const result = resolveWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037#SLICE-003',
    selectedUnit: 'WK-1037',
    workRecord: createWorkRecord(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'selected_unit_mismatch');
  assert.equal(result.error.diagnostics.reason, 'selected_unit_mismatch');
});

test('fails closed when the subject cannot be resolved', async () => {
  const result = await loadWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037#SLICE-003',
    selectedUnit: 'WK-1037#SLICE-003',
    readWorkRecord: async () => null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'subject_unresolved');
  assert.equal(result.error.diagnostics.reason, 'subject_unresolved');
});

test('fails closed when the record is unreadable', async () => {
  const result = await loadWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037#SLICE-003',
    selectedUnit: 'WK-1037#SLICE-003',
    readWorkRecord: async () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'subject_unreadable');
  assert.equal(result.error.diagnostics.reason, 'subject_unreadable');
});

test('fails closed when the record shape is invalid', () => {
  const result = resolveWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037#SLICE-003',
    selectedUnit: 'WK-1037#SLICE-003',
    workRecord: {
      id: 'WK-1037',
      title: 'Broken record',
      status: 'active',
      slices: [
        {
          id: 'SLICE-003',
          acceptance: {
            criteria: ['present'],
            validation: [],
          },
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'record_invalid');
  assert.equal(result.error.diagnostics.reason, 'record_invalid');
});

test('fails closed on invalid subject text', () => {
  const result = resolveWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037#bad id',
    selectedUnit: 'WK-1037',
    workRecord: createWorkRecord(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_subject');
  assert.equal(result.error.diagnostics.reason, 'invalid_subject');
});

test('accepts the canonical slice-id grammar forms', () => {
  for (const sliceId of ['SLICE-003', 'parser-slice', 's1', 'a-b-c']) {
    const subject = `WK-1037#${sliceId}`;
    const parsed = resolveWorkspaceAgentFindingsRoleContext({
      subject,
      selectedUnit: subject,

    });

    assert.equal(parsed.ok, false, `${sliceId} should be grammatically accepted`);
    assert.equal(
      parsed.error.code,
      'subject_unresolved',
      `${sliceId} should pass grammar and fail only on missing record source`,
    );
  }
});

test('rejects slice ids outside the canonical grammar', () => {

  for (const sliceId of ['FOO', 'SLICE-0030', 'SLICE-03', 'slice_003', 'slice.003', 'Parser-Slice', '-leading']) {
    const subject = `WK-1037#${sliceId}`;
    const result = resolveWorkspaceAgentFindingsRoleContext({
      subject,
      selectedUnit: subject,
      workRecord: createWorkRecord(),
    });

    assert.equal(result.ok, false, `${sliceId} should be rejected`);
    assert.equal(result.error.code, 'invalid_subject', `${sliceId} should be an invalid subject`);
  }
});

test('rejects non-canonical slice ids supplied via selected-unit fields', () => {
  const result = resolveWorkspaceAgentFindingsRoleContext({
    subject: 'WK-1037#SLICE-003',
    selectedUnit: { recordId: 'WK-1037', sliceId: 'SLICE_003' },
    workRecord: createWorkRecord(),
  });

  assert.equal(result.ok, false);

  assert.ok(['invalid_selected_unit', 'selected_unit_mismatch'].includes(result.error.code));
});

test('frozen whole-WK reviewer contract combines parent and selected review-unit authority without reading the WK worktree', async () => {
  const parent = createWorkRecord();
  parent.status = 'review';
  const reviewUnit = parent.slices[0];
  let worktreeLoads = 0;
  const result = await resolveFindingsOnlyAcceptanceContract({
    role: 'review',
    subject: 'WK-1037#SLICE-003',
    workspaceDir: '/stale/wk-worktree',
    loadWorkRecord: async () => {
      worktreeLoads += 1;
      throw new Error('stale WK worktree contract must not be consulted');
    },
    frozenReviewContract: {
      schema_version: FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
      review_subject: 'WK-1037#SLICE-003',
      canonical_parent_wk_contract: JSON.stringify(parent),
      review_unit_contract: JSON.stringify(reviewUnit),
    },
  });

  assert.equal(worktreeLoads, 0);
  assert.deepEqual(result.acceptanceCriteria, [
    'tracker criterion one',
    'tracker criterion two',
    'slice criterion one',
    'slice criterion two',
  ]);
  assert.deepEqual(result.acceptanceValidation, [
    'validation step one',
    'validation step two',
    'slice validation one',
    'slice validation two',
  ]);
});

test('frozen whole-WK reviewer contract fails closed on subject, parent, and selected-unit mismatch', async () => {
  const parent = createWorkRecord();
  parent.status = 'review';
  const reviewUnit = parent.slices[0];
  const contract = {
    schema_version: FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
    review_subject: 'WK-1037#SLICE-003',
    canonical_parent_wk_contract: JSON.stringify(parent),
    review_unit_contract: JSON.stringify(reviewUnit),
  };
  const mutations = [
    { ...contract, review_subject: 'WK-1037#parser-slice' },
    { ...contract, canonical_parent_wk_contract: JSON.stringify({ ...parent, status: 'active' }) },
    { ...contract, review_unit_contract: JSON.stringify({ ...reviewUnit, id: 'SLICE-004' }) },
  ];
  for (const frozenReviewContract of mutations) {
    await assert.rejects(
      resolveFindingsOnlyAcceptanceContract({
        role: 'review',
        subject: 'WK-1037#SLICE-003',
        frozenReviewContract,
      }),
      (error) => error?.code === 'frozen_findings_only_contract_invalid',
    );
  }
});

const STANDALONE_SUBJECT = 'WK-2296#SLICE-001';
const STANDALONE_TARGET_COMMIT = 'a'.repeat(40);

function standaloneFrozenContract({
  status = 'inbox',
  workKind = 'review',
  intendedRole = workKind === 'review' ? 'reviewer' : 'redteam',
  writeScope = [],
  reviewPurpose = 'standalone',
  parentAcceptance = {
    criteria: ['Preserve the complete parent reviewer prose without truncation.'],
    validation: ['node --test parent.test.mjs'],
  },
  sliceAcceptance = {
    criteria: ['Report advisory findings only; do not turn findings into a veto.'],
    validation: [
      { operation: 'node_test', target: 'selected.test.mjs', verification_ids: ['V-2', 'V-1'] },
      'node --check selected.mjs',
    ],
  },
} = {}) {
  const slice = {
    id: 'SLICE-001',
    title: 'Standalone findings review',
    work_kind: workKind,
    status: 'todo',
    write_scope: writeScope,
    review_purpose: reviewPurpose,
    dispatch_intent: { intended_agent_role: intendedRole, target_unit: 'slice' },
    acceptance: sliceAcceptance,
  };
  const parent = {
    schema_version: 'work-record.v1',
    id: 'WK-2296',
    repo: 'agent-chassis/agent-chassis',
    initiative: 'IN-0029',
    status,
    acceptance: parentAcceptance,
    slices: [slice],
  };
  const canonicalParent = JSON.stringify(parent);
  return createTrustedFrozenStandaloneFindingsContract({
    repository: parent.repo,
    record_id: parent.id,
    initiative: parent.initiative,
    subject: STANDALONE_SUBJECT,
    slice_id: slice.id,
    work_kind: slice.work_kind,
    intended_agent_role: slice.dispatch_intent.intended_agent_role,
    review_purpose: slice.review_purpose,
    canonical_parent_wk_contract: canonicalParent,
    canonical_parent_wk_contract_digest: digestTrustedExactReviewEvidence(canonicalParent),
    review_unit_contract: JSON.stringify(slice),
    review_unit_contract_digest: digestTrustedExactReviewEvidence(JSON.stringify(slice)),
    target_ref: 'refs/heads/main',
    target_commit: STANDALONE_TARGET_COMMIT,
    canonical_source_digest: computeWorkRecordSourceDigest(parent),
  });
}

function bareStandaloneFrozenContract({
  workKind = 'review',
  acceptance = {
    criteria: ['The selected whole-WK review contract is complete.'],
    validation: ['node --test whole-wk-review.test.mjs'],
  },
} = {}) {
  const role = workKind === 'review' ? 'reviewer' : 'redteam';
  const parent = {
    schema_version: 'work-record.v1',
    id: 'WK-2296',
    repo: 'agent-chassis/agent-chassis',
    initiative: 'IN-0029',
    status: 'inbox',
    work_kind: workKind,
    write_scope: [],
    review_purpose: 'standalone',
    dispatch_intent: { intended_agent_role: role, target_unit: 'record' },
    acceptance,
    slices: [],
  };
  const canonicalParent = JSON.stringify(parent);
  return createTrustedFrozenStandaloneFindingsContract({
    repository: parent.repo,
    record_id: parent.id,
    initiative: parent.initiative,
    subject: parent.id,
    slice_id: null,
    work_kind: parent.work_kind,
    intended_agent_role: role,
    review_purpose: parent.review_purpose,
    canonical_parent_wk_contract: canonicalParent,
    canonical_parent_wk_contract_digest: digestTrustedExactReviewEvidence(canonicalParent),
    review_unit_contract: canonicalParent,
    review_unit_contract_digest: digestTrustedExactReviewEvidence(canonicalParent),
    target_ref: 'refs/heads/main',
    target_commit: STANDALONE_TARGET_COMMIT,
    canonical_source_digest: computeWorkRecordSourceDigest(parent),
  });
}

test('standalone frozen findings contract has a distinct launcher-owned discriminator and exact bindings', () => {
  const contract = standaloneFrozenContract();
  assert.equal(
    contract.schema_version,
    FROZEN_STANDALONE_FINDINGS_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
  );
  assert.notEqual(contract.schema_version, FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION);
  assert.notEqual(contract.schema_version, FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION);
  assert.equal(contract.repository, 'agent-chassis/agent-chassis');
  assert.equal(contract.record_id, 'WK-2296');
  assert.equal(contract.initiative, 'IN-0029');
  assert.equal(contract.review_subject, STANDALONE_SUBJECT);
  assert.equal(contract.review_slice_id, 'SLICE-001');
  assert.equal(contract.review_purpose, 'standalone');
  assert.deepEqual(contract.write_scope, []);
  assert.equal(contract.target_ref, 'refs/heads/main');
  assert.equal(contract.target_commit, STANDALONE_TARGET_COMMIT);
  assert.match(contract.canonical_source_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.write_scope), true);
});

test('standalone resolver ignores parent lifecycle status and preserves mixed validation and advisory prose', async () => {
  for (const status of ['inbox', 'todo', 'active', 'review']) {
    const result = await resolveFindingsOnlyAcceptanceContract({
      role: 'reviewer',
      subject: STANDALONE_SUBJECT,
      frozenReviewContract: standaloneFrozenContract({ status }),
    });
    assert.deepEqual(result.acceptanceCriteria, [
      'Preserve the complete parent reviewer prose without truncation.',
      'Report advisory findings only; do not turn findings into a veto.',
    ]);
    assert.deepEqual(result.acceptanceValidation, [
      'node --test parent.test.mjs',
      '{"operation":"node_test","target":"selected.test.mjs","verification_ids":["V-1","V-2"]}',
      'node --check selected.mjs',
    ]);
  }
});

test('standalone resolver supports the canonical redteam findings shape', async () => {
  const result = await resolveFindingsOnlyAcceptanceContract({
    role: 'redteam',
    subject: STANDALONE_SUBJECT,
    frozenReviewContract: standaloneFrozenContract({ workKind: 'redteam' }),
  });
  assert.equal(result.acceptanceCriteria.length, 2);
});

test('WK-2414 draft parent criteria with intentionally empty validation admit its complete review slice', async () => {
  const result = await resolveFindingsOnlyAcceptanceContract({
    role: 'reviewer',
    subject: STANDALONE_SUBJECT,
    frozenReviewContract: standaloneFrozenContract({
      parentAcceptance: {
        criteria: ['Draft parent material exists for the DRY review.'],
        validation: [],
      },
    }),
  });
  assert.deepEqual(result.acceptanceCriteria, [
    'Draft parent material exists for the DRY review.',
    'Report advisory findings only; do not turn findings into a veto.',
  ]);
  assert.deepEqual(result.acceptanceValidation, [
    '{"operation":"node_test","target":"selected.test.mjs","verification_ids":["V-1","V-2"]}',
    'node --check selected.mjs',
  ]);
});

test('bare-WK findings keep complete selected-unit acceptance strict', async () => {
  for (const workKind of ['review', 'redteam']) {
    await assert.rejects(
      resolveFindingsOnlyAcceptanceContract({
        role: workKind === 'review' ? 'reviewer' : 'redteam',
        subject: 'WK-2296',
        frozenReviewContract: bareStandaloneFrozenContract({
          workKind,
          acceptance: {
            criteria: ['Draft whole-WK material is not executable acceptance.'],
            validation: [],
          },
        }),
      }),
      (error) => error?.code === 'frozen_standalone_findings_contract_invalid' &&
        error?.detail?.contract_side === 'parent' &&
        error?.detail?.mismatch_class === 'acceptance_invalid',
    );
  }
});

test('standalone resolver closes malformed, cross-schema, identity, movement, and write-scope evidence', async () => {
  const base = standaloneFrozenContract();
  const parent = JSON.parse(base.canonical_parent_wk_contract);
  const slice = JSON.parse(base.review_unit_contract);
  const cases = {
    'cross-schema discriminator': {
      contract: { ...base, schema_version: FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION },
      side: 'envelope',
      mismatch: 'malformed',
    },
    'subject mismatch': {
      contract: { ...base, review_subject: 'WK-2296#SLICE-002' },
      side: 'envelope',
      mismatch: 'subject_mismatch',
    },
    'selected-unit movement': {
      contract: { ...base, review_unit_contract: JSON.stringify({ ...slice, title: 'Moved' }) },
      side: 'selected_unit',
      mismatch: 'contract_moved',
    },
    'parent contract movement': {
      contract: { ...base, canonical_parent_wk_contract: JSON.stringify({ ...parent, title: 'Moved' }) },
      side: 'parent',
      mismatch: 'contract_moved',
    },
    'source digest movement': {
      contract: { ...base, canonical_source_digest: `sha256:${'b'.repeat(64)}` },
      side: 'envelope',
      mismatch: 'binding_mismatch',
    },
    'target movement': {
      contract: { ...base, target_commit: 'b'.repeat(40) },
      side: 'envelope',
      mismatch: 'binding_mismatch',
    },
    'nonempty write scope': {
      contract: standaloneFrozenContract({ writeScope: ['feature.txt'] }),
      side: 'selected_unit',
      mismatch: 'findings_shape_mismatch',
    },
  };
  for (const [label, entry] of Object.entries(cases)) {
    await assert.rejects(
      resolveFindingsOnlyAcceptanceContract({
        role: 'reviewer',
        subject: STANDALONE_SUBJECT,
        frozenReviewContract: entry.contract,
      }),
      (error) => {
        assert.equal(error?.code, 'frozen_standalone_findings_contract_invalid', label);
        assert.equal(error?.detail?.contract_side, entry.side, label);
        assert.equal(error?.detail?.mismatch_class, entry.mismatch, label);
        assert.doesNotMatch(error.message, /sha256|refs\/|Moved|feature\.txt/u, label);
        return true;
      },
    );
  }
});

const SLICE_SUBJECT = 'WK-1311#SLICE-003';

function sliceLevelFrozenContract({
  parentAcceptance,
  sliceAcceptance,
  parentStatus = 'active',
  sliceStatus = 'active',
  sliceWorkKind = 'implementation',
  reviewUnitContract,
  reviewSubject = SLICE_SUBJECT,
  parentId = 'WK-1311',
  sliceId = 'SLICE-003',
} = {}) {
  const slice = {
    id: sliceId,
    title: 'Implementation slice under review',
    work_kind: sliceWorkKind,
    status: sliceStatus,
    acceptance: sliceAcceptance,
  };
  const parent = {
    id: parentId,
    title: 'Parent tracker',
    status: parentStatus,
    work_kind: 'tracker',
    acceptance: parentAcceptance,
    slices: [slice],
  };
  return {
    schema_version: FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
    review_subject: reviewSubject,
    canonical_parent_wk_contract: JSON.stringify(parent),
    review_unit_contract: reviewUnitContract ?? JSON.stringify(slice),
  };
}

function resolveSliceLevel(overrides) {
  return resolveFindingsOnlyAcceptanceContract({
    role: 'review',
    subject: SLICE_SUBJECT,
    frozenReviewContract: sliceLevelFrozenContract(overrides),
  });
}

const COMPLETE_SLICE_ACCEPTANCE = {
  criteria: ['slice criterion one', 'slice criterion two'],
  validation: ['slice validation one'],
};

test('slice-level review inherits an empty parent as zero entries and keeps the slice mandatory', async () => {
  const result = await resolveSliceLevel({
    parentAcceptance: { criteria: [], validation: [] },
    sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
  });
  assert.deepEqual(result.acceptanceCriteria, ['slice criterion one', 'slice criterion two']);
  assert.deepEqual(result.acceptanceValidation, ['slice validation one']);
});

test('slice-level review composes a complete parent before the selected slice in order', async () => {
  const result = await resolveSliceLevel({
    parentAcceptance: { criteria: ['parent criterion'], validation: ['parent validation'] },
    sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
  });
  assert.deepEqual(result.acceptanceCriteria, [
    'parent criterion',
    'slice criterion one',
    'slice criterion two',
  ]);
  assert.deepEqual(result.acceptanceValidation, ['parent validation', 'slice validation one']);
});

test('slice-level findings acceptance is invariant across parent and implementation status', async () => {
  const expected = await resolveSliceLevel({
    parentAcceptance: { criteria: ['parent criterion'], validation: ['parent validation'] },
    sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
  });
  for (const parentStatus of ['active', 'todo', 'review', 'done']) {
    for (const sliceStatus of ['active', 'todo', 'review', 'done']) {
      const actual = await resolveSliceLevel({
        parentAcceptance: { criteria: ['parent criterion'], validation: ['parent validation'] },
        sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
        parentStatus,
        sliceStatus,
      });
      assert.deepEqual(actual, expected, `${parentStatus}/${sliceStatus}`);
    }
  }
});

test('slice-level review renders structured object criteria by their canonical text', async () => {
  const result = await resolveSliceLevel({
    parentAcceptance: {
      criteria: [{ text: 'parent object criterion', verification_method: 'inspection' }],
      validation: ['parent validation'],
    },
    sliceAcceptance: {
      criteria: [{ text: 'slice object criterion', evidence_target: 'tests/foo.test.mjs' }],
      validation: ['slice validation'],
    },
  });
  assert.deepEqual(result.acceptanceCriteria, ['parent object criterion', 'slice object criterion']);
  assert.deepEqual(result.acceptanceValidation, ['parent validation', 'slice validation']);
});

test('slice-level review preserves valid mixed string/object criteria in stable order', async () => {
  const result = await resolveSliceLevel({
    parentAcceptance: {
      criteria: ['parent str', { text: 'parent object' }],
      validation: ['parent validation'],
    },
    sliceAcceptance: {
      criteria: [{ text: 'slice object' }, 'slice str'],
      validation: ['slice validation'],
    },
  });
  assert.deepEqual(result.acceptanceCriteria, [
    'parent str',
    'parent object',
    'slice object',
    'slice str',
  ]);
});

test('slice-level review fails closed on invalid, malformed, and missing acceptance shapes', async () => {
  const invalidCases = {
    'asymmetric parent (criteria without validation)': {
      parentAcceptance: { criteria: ['parent criterion'], validation: [] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
    },
    'asymmetric parent (validation without criteria)': {
      parentAcceptance: { criteria: [], validation: ['parent validation'] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
    },
    'malformed parent acceptance (criteria not an array)': {
      parentAcceptance: { criteria: 'not-an-array', validation: [] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
    },
    'malformed parent acceptance (not an object)': {
      parentAcceptance: 'not-an-object',
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
    },
    'invalid mixed parent criteria (object without text)': {
      parentAcceptance: {
        criteria: ['parent str', { verification_method: 'inspection' }],
        validation: ['parent validation'],
      },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
    },
    'invalid mixed slice criteria (empty-string entry)': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: { criteria: ['slice str', ''], validation: ['slice validation'] },
    },
    'empty selected slice criteria': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: { criteria: [], validation: ['slice validation'] },
    },
    'empty selected slice validation': {
      parentAcceptance: { criteria: ['parent criterion'], validation: ['parent validation'] },
      sliceAcceptance: { criteria: ['slice criterion'], validation: [] },
    },
    'both selected slice arrays empty': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: { criteria: [], validation: [] },
    },
    'malformed selected slice acceptance (not an object)': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: null,
    },
    'non-string selected slice validation entry': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: { criteria: ['slice criterion'], validation: [42] },
    },
  };
  for (const [label, overrides] of Object.entries(invalidCases)) {
    await assert.rejects(
      resolveSliceLevel(overrides),
      (error) => error?.code === 'frozen_slice_level_findings_only_contract_invalid',
      `expected ${label} to fail closed`,
    );
  }
});

test('slice-level review fails closed on wrong subject, record, slice, work kind, and stale embedding', async () => {
  const identityCases = {
    'frozen subject differs from the requested subject': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
      reviewSubject: 'WK-1311#SLICE-004',
    },
    'frozen parent record differs from the requested record': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
      parentId: 'WK-1312',
    },
    'frozen selected slice differs from the requested slice': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
      sliceId: 'SLICE-004',
    },
    'selected slice is not implementation work': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
      sliceWorkKind: 'review',
    },
    'frozen review-unit contract does not byte-match the embedded slice': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
      reviewUnitContract: JSON.stringify({
        id: 'SLICE-003',
        title: 'Tampered slice',
        work_kind: 'implementation',
        status: 'review',
        acceptance: COMPLETE_SLICE_ACCEPTANCE,
      }),
    },
  };
  for (const [label, overrides] of Object.entries(identityCases)) {
    await assert.rejects(
      resolveSliceLevel(overrides),
      (error) => error?.code === 'frozen_slice_level_findings_only_contract_invalid',
      `expected ${label} to fail closed`,
    );
  }
});

test('slice-level review admits a fully-specified canonical structured criterion', async () => {
  const result = await resolveSliceLevel({
    parentAcceptance: {
      criteria: [{ text: 'parent full criterion', verification_method: 'inspection', evidence_target: null }],
      validation: ['parent validation'],
    },
    sliceAcceptance: {
      criteria: [
        {
          text: 'slice full criterion',
          verification_method: 'test_execution',
          evidence_target: 'tests/example.test.mjs',
          facet_provenance: { text: 'authored_record' },
        },
      ],
      validation: ['slice validation'],
    },
  });
  assert.deepEqual(result.acceptanceCriteria, ['parent full criterion', 'slice full criterion']);
  assert.deepEqual(result.acceptanceValidation, ['parent validation', 'slice validation']);
});

test('slice-level review fails closed on canonically-invalid structured criteria despite nonempty text', async () => {
  const invalidObjectCases = {
    'invalid verification_method enum': {
      criteria: [{ text: 'nonempty text', verification_method: 'not-a-method' }],
      validation: ['slice validation'],
    },
    'invalid evidence_target type': {
      criteria: [{ text: 'nonempty text', evidence_target: 42 }],
      validation: ['slice validation'],
    },
    'invalid facet_provenance value': {
      criteria: [{ text: 'nonempty text', facet_provenance: { text: 'not-a-provenance' } }],
      validation: ['slice validation'],
    },
  };
  for (const [label, sliceAcceptance] of Object.entries(invalidObjectCases)) {
    await assert.rejects(
      resolveSliceLevel({ parentAcceptance: { criteria: [], validation: [] }, sliceAcceptance }),
      (error) => error?.code === 'frozen_slice_level_findings_only_contract_invalid',
      `expected ${label} to fail closed`,
    );

    await assert.rejects(
      resolveSliceLevel({ parentAcceptance: sliceAcceptance, sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE }),
      (error) => error?.code === 'frozen_slice_level_findings_only_contract_invalid',
      `expected ${label} at parent scope to fail closed`,
    );
  }
});

const STRUCTURED_VALIDATION_ENTRY = {
  operation: 'node_test',
  target: 'tests/unit/workspace-agent-findings-role-context.test.mjs',
  verification_ids: ['V-1', 'V-2', 'V-3'],
};
const STRUCTURED_VALIDATION_RENDERED =
  '{"operation":"node_test","target":"tests/unit/workspace-agent-findings-role-context.test.mjs",'
  + '"verification_ids":["V-1","V-2","V-3"]}';

function resolveUnfrozenFindingsAcceptance(role, validation) {
  const record = createWorkRecord();
  record.acceptance = {
    criteria: ['tracker criterion'],
    validation,
  };
  return resolveFindingsOnlyAcceptanceContract({
    role,
    subject: record.id,
    workspaceDir: '/canonical/repo',
    loadWorkRecord: async () => ({ valid: true, record }),
  });
}

test('non-frozen redteam accepts all-structured validation without loss', async () => {
  const result = await resolveUnfrozenFindingsAcceptance('redteam', [
    STRUCTURED_VALIDATION_ENTRY,
  ]);
  assert.deepEqual(result.acceptanceCriteria, ['tracker criterion']);
  assert.deepEqual(result.acceptanceValidation, [STRUCTURED_VALIDATION_RENDERED]);
  assert.deepEqual(JSON.parse(result.acceptanceValidation[0]), STRUCTURED_VALIDATION_ENTRY);
});

test('non-frozen redteam preserves mixed validation entries in stored order', async () => {
  const result = await resolveUnfrozenFindingsAcceptance('redteam', [
    '  node --test tests/legacy-a.test.mjs  ',
    STRUCTURED_VALIDATION_ENTRY,
    'node --test tests/legacy-b.test.mjs',
  ]);
  assert.deepEqual(result.acceptanceValidation, [
    'node --test tests/legacy-a.test.mjs',
    STRUCTURED_VALIDATION_RENDERED,
    'node --test tests/legacy-b.test.mjs',
  ]);
});

test('non-frozen reviewer accepts all-structured validation without loss', async () => {
  const result = await resolveUnfrozenFindingsAcceptance('review', [
    STRUCTURED_VALIDATION_ENTRY,
  ]);
  assert.deepEqual(result.acceptanceValidation, [STRUCTURED_VALIDATION_RENDERED]);
  const rendered = JSON.parse(result.acceptanceValidation[0]);
  assert.equal(rendered.target, STRUCTURED_VALIDATION_ENTRY.target);
  assert.deepEqual(rendered.verification_ids, ['V-1', 'V-2', 'V-3']);
});

test('non-frozen reviewer preserves mixed validation entries in stored order', async () => {
  const structured = {
    operation: 'node_test',
    target: 'tests/a.test.mjs',
    verification_ids: ['V-3', 'V-1', 'V-2'],
  };
  const result = await resolveUnfrozenFindingsAcceptance('review', [
    '  node --test tests/legacy.test.mjs  ',
    structured,
  ]);
  assert.equal(result.acceptanceValidation[0], 'node --test tests/legacy.test.mjs');
  const rendered = JSON.parse(result.acceptanceValidation[1]);
  assert.equal(rendered.target, 'tests/a.test.mjs');
  assert.deepEqual(rendered.verification_ids, ['V-1', 'V-2', 'V-3']);
});

test('non-frozen findings resolution reports canonical invalid validation detail', async () => {
  await assert.rejects(
    resolveUnfrozenFindingsAcceptance('redteam', [
      { command: '   ', verification_ids: ['V-1'] },
    ]),
    (error) => {
      assert.equal(error?.code, 'record_invalid');
      assert.match(error.message, /acceptance_validation_invalid/);
      assert.doesNotMatch(error.message, /missing required acceptance/i);
      assert.deepEqual(error.detail?.diagnostics?.details, ['acceptance_validation_invalid']);
      return true;
    },
  );
});

const WHOLE_WK_SUBJECT = 'WK-1311#SLICE-003';

function wholeWkFrozenContract({ parentAcceptance, sliceAcceptance } = {}) {
  const slice = {
    id: 'SLICE-003',
    title: 'Selected review unit',
    work_kind: 'implementation',
    status: 'review',
    acceptance: sliceAcceptance,
  };
  const parent = {
    id: 'WK-1311',
    title: 'Parent tracker in whole-WK review',
    status: 'review',
    work_kind: 'tracker',
    acceptance: parentAcceptance,
    slices: [slice],
  };
  return {
    schema_version: FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
    review_subject: WHOLE_WK_SUBJECT,
    canonical_parent_wk_contract: JSON.stringify(parent),
    review_unit_contract: JSON.stringify(slice),
  };
}

function resolveWholeWk(overrides) {
  return resolveFindingsOnlyAcceptanceContract({
    role: 'review',
    subject: WHOLE_WK_SUBJECT,
    frozenReviewContract: wholeWkFrozenContract(overrides),
  });
}

const FINDINGS_SURFACES = [
  {
    label: 'exact-slice',
    resolve: resolveSliceLevel,
    refusalCode: 'frozen_slice_level_findings_only_contract_invalid',
  },
  {
    label: 'terminal whole-WK',
    resolve: resolveWholeWk,
    refusalCode: 'frozen_findings_only_contract_invalid',
  },
];

test('both findings-only surfaces admit notes, declarations, and mixed validation sections', async () => {
  const sections = {
    'text notes': {
      input: ['  node --test tests/a.test.mjs  ', 'node --test tests/b.test.mjs'],
      rendered: ['node --test tests/a.test.mjs', 'node --test tests/b.test.mjs'],
    },
    'structured entries': {
      input: [STRUCTURED_VALIDATION_ENTRY],
      rendered: [STRUCTURED_VALIDATION_RENDERED],
    },
    'mixed notes and structured entries in stored order': {
      input: ['node --test tests/a.test.mjs', STRUCTURED_VALIDATION_ENTRY],
      rendered: ['node --test tests/a.test.mjs', STRUCTURED_VALIDATION_RENDERED],
    },
  };
  for (const { label, resolve } of FINDINGS_SURFACES) {
    for (const [sectionLabel, { input, rendered }] of Object.entries(sections)) {
      const result = await resolve({
        parentAcceptance: { criteria: ['parent criterion'], validation: input },
        sliceAcceptance: { criteria: ['slice criterion'], validation: input },
      });
      assert.deepEqual(
        result.acceptanceValidation,
        [...rendered, ...rendered],
        `${label} / ${sectionLabel}`,
      );

      assert.deepEqual(
        result.acceptanceCriteria,
        ['parent criterion', 'slice criterion'],
        `${label} / ${sectionLabel}`,
      );
    }
  }
});

test('both findings-only surfaces render a structured entry as deterministic compact JSON', async () => {
  for (const { label, resolve } of FINDINGS_SURFACES) {
    const result = await resolve({
      parentAcceptance: {
        criteria: ['parent criterion'],
        validation: [STRUCTURED_VALIDATION_ENTRY],
      },
      sliceAcceptance: {
        criteria: ['slice criterion'],
        validation: [STRUCTURED_VALIDATION_ENTRY],
      },
    });
    for (const rendered of result.acceptanceValidation) {
      assert.equal(rendered, STRUCTURED_VALIDATION_RENDERED, label);

      assert.deepEqual(JSON.parse(rendered), {
        operation: STRUCTURED_VALIDATION_ENTRY.operation,
        target: STRUCTURED_VALIDATION_ENTRY.target,
        verification_ids: STRUCTURED_VALIDATION_ENTRY.verification_ids,
      });
      assert.deepEqual(Object.keys(JSON.parse(rendered)),
        ['operation', 'target', 'verification_ids']);
    }
  }
});

test('both findings-only surfaces preserve the target and sort verification identities', async () => {
  const orderings = [
    ['V-1', 'V-2', 'V-3'],
    ['V-3', 'V-1', 'V-2'],
    ['V-2', 'V-3', 'V-1'],
  ];
  for (const { label, resolve } of FINDINGS_SURFACES) {
    for (const verificationIds of orderings) {
      const section = {
        criteria: ['criterion'],
        validation: [{ operation: 'node_test', target: 'tests/a.test.mjs',
          verification_ids: verificationIds }],
      };
      const result = await resolve({ parentAcceptance: section, sliceAcceptance: section });
      const parsed = result.acceptanceValidation.map((entry) => JSON.parse(entry));
      for (const entry of parsed) {
        assert.equal(entry.target, 'tests/a.test.mjs', label);
        assert.deepEqual(entry.verification_ids, [...verificationIds].sort(), label);
        assert.equal(entry.verification_ids.length, verificationIds.length, label);
      }
    }
  }
});

test('exact-slice review keeps its optional-empty parent while admitting a structured slice section', async () => {
  const result = await resolveSliceLevel({
    parentAcceptance: { criteria: [], validation: [] },
    sliceAcceptance: {
      criteria: ['slice criterion'],
      validation: ['node --test tests/a.test.mjs', STRUCTURED_VALIDATION_ENTRY],
    },
  });
  assert.deepEqual(result.acceptanceCriteria, ['slice criterion']);
  assert.deepEqual(result.acceptanceValidation, [
    'node --test tests/a.test.mjs',
    STRUCTURED_VALIDATION_RENDERED,
  ]);
});

test('terminal whole-WK review keeps both sections mandatory and complete', async () => {

  for (const emptySide of ['parentAcceptance', 'sliceAcceptance']) {
    await assert.rejects(
      resolveWholeWk({
        parentAcceptance: { criteria: ['parent criterion'], validation: ['node --test a'] },
        sliceAcceptance: { criteria: ['slice criterion'], validation: ['node --test b'] },
        [emptySide]: { criteria: [], validation: [] },
      }),
      (error) => error?.code === 'frozen_findings_only_contract_invalid',
      `expected an empty ${emptySide} to fail closed`,
    );
  }
});

test('both findings-only surfaces reject an asymmetric acceptance section on either side', async () => {
  const asymmetric = [
    { criteria: ['criterion'], validation: [] },
    { criteria: [], validation: ['node --test tests/a.test.mjs'] },
  ];
  const complete = {
    criteria: ['criterion'],
    validation: [STRUCTURED_VALIDATION_ENTRY],
  };
  for (const { label, resolve, refusalCode } of FINDINGS_SURFACES) {
    for (const section of asymmetric) {
      for (const side of ['parentAcceptance', 'sliceAcceptance']) {
        await assert.rejects(
          resolve({
            parentAcceptance: complete,
            sliceAcceptance: complete,
            [side]: section,
          }),
          (error) => error?.code === refusalCode,
          `expected ${label} to fail closed on an asymmetric ${side}`,
        );
      }
    }
  }
});

const NON_ARRAY_VALIDATION_SECTIONS = {
  'string section': 'node --test tests/a.test.mjs',
  'object section': { command: 'node --test tests/a.test.mjs' },
  'null section': null,
  'absent section': undefined,
};

const MALFORMED_VALIDATION_SECTIONS = {
  'blank legacy command': ['   '],
  'empty legacy command': [''],
  'numeric entry': [42],
  'null entry': [null],
  'nested array entry': [['node --test tests/a.test.mjs']],
  'blank structured command': [{ command: '   ', verification_ids: ['V-1'] }],
  'missing structured command': [{ verification_ids: ['V-1'] }],
  'non-string structured command': [{ command: 42, verification_ids: ['V-1'] }],
  'missing verification_ids': [{ command: 'node --test tests/a.test.mjs' }],
  'empty verification_ids': [{ command: 'node --test tests/a.test.mjs', verification_ids: [] }],
  'non-array verification_ids': [
    { command: 'node --test tests/a.test.mjs', verification_ids: 'V-1' },
  ],
  'non-string verification identity': [
    { command: 'node --test tests/a.test.mjs', verification_ids: ['V-1', 42] },
  ],
  'blank verification identity': [
    { command: 'node --test tests/a.test.mjs', verification_ids: ['  '] },
  ],
  'duplicate identity inside one entry': [
    { command: 'node --test tests/a.test.mjs', verification_ids: ['V-1', 'V-1'] },
  ],
  'duplicate identity across separate entries': [
    { command: 'node --test tests/a.test.mjs', verification_ids: ['V-1'] },
    { command: 'node --test tests/b.test.mjs', verification_ids: ['V-1'] },
  ],
  'unsupported structured field': [
    { command: 'node --test tests/a.test.mjs', verification_ids: ['V-1'], notes: 'extra' },
  ],
};

test('both findings-only surfaces fail closed on every malformed validation section and name the contributor', async () => {
  const complete = { criteria: ['criterion'], validation: [STRUCTURED_VALIDATION_ENTRY] };
  const contributors = {
    parentAcceptance: 'parent',
    sliceAcceptance: 'selected_review_unit',
  };
  for (const { label, resolve, refusalCode } of FINDINGS_SURFACES) {
    for (const [sectionLabel, validation] of Object.entries(MALFORMED_VALIDATION_SECTIONS)) {
      for (const [side, contributor] of Object.entries(contributors)) {
        await assert.rejects(
          resolve({
            parentAcceptance: complete,
            sliceAcceptance: complete,
            [side]: { criteria: ['criterion'], validation },
          }),
          (error) => {
            assert.equal(error?.code, refusalCode, `${label} / ${sectionLabel} / ${side}`);

            assert.match(
              error.message,
              new RegExp(`\\(${contributor}: acceptance_validation_invalid\\)`),
              `${label} / ${sectionLabel} / ${side}: ${error.message}`,
            );
            return true;
          },
          `expected ${label} / ${sectionLabel} / ${side} to fail closed`,
        );
      }
    }
  }
});

test('both findings-only surfaces fail closed on a non-array validation section and name the contributor', async () => {
  const complete = { criteria: ['criterion'], validation: [STRUCTURED_VALIDATION_ENTRY] };
  const contributors = {
    parentAcceptance: 'parent',
    sliceAcceptance: 'selected_review_unit',
  };
  for (const { label, resolve, refusalCode } of FINDINGS_SURFACES) {
    for (const [sectionLabel, validation] of Object.entries(NON_ARRAY_VALIDATION_SECTIONS)) {
      for (const [side, contributor] of Object.entries(contributors)) {
        await assert.rejects(
          resolve({
            parentAcceptance: complete,
            sliceAcceptance: complete,
            [side]: { criteria: ['criterion'], validation },
          }),
          (error) => {
            assert.equal(error?.code, refusalCode, `${label} / ${sectionLabel} / ${side}`);
            assert.match(
              error.message,
              new RegExp(`\\(${contributor}: acceptance_section_malformed\\)`),
              `${label} / ${sectionLabel} / ${side}: ${error.message}`,
            );
            return true;
          },
          `expected ${label} / ${sectionLabel} / ${side} to fail closed`,
        );
      }
    }
  }
});

test('a present canonical validation field is never reported as missing', async () => {

  const validation = [
    { operation: 'node_test', target: 'tests/a.test.mjs', verification_ids: ['V-1'] },
    { operation: 'node_test', target: 'tests/b.test.mjs', verification_ids: ['V-1'] },
  ];
  for (const { label, resolve, refusalCode } of FINDINGS_SURFACES) {
    await assert.rejects(
      resolve({
        parentAcceptance: { criteria: ['criterion'], validation },
        sliceAcceptance: { criteria: ['criterion'], validation: [STRUCTURED_VALIDATION_ENTRY] },
      }),
      (error) => {
        assert.equal(error?.code, refusalCode, label);
        assert.match(error.message, /\(parent: acceptance_validation_invalid\)/, label);
        assert.doesNotMatch(error.message, /command/, label);
        assert.doesNotMatch(error.message, /verification_ids/, label);
        return true;
      },
      label,
    );
  }
});

test('the shared classifier is the one owner of validation classification and rendering', () => {
  assert.deepEqual(
    classifyFindingsAcceptanceSection({
      criteria: ['criterion'],
      validation: ['  node --test tests/a.test.mjs  ', STRUCTURED_VALIDATION_ENTRY],
    }),
    {
      state: 'valid',
      criteria: ['criterion'],
      validation: ['node --test tests/a.test.mjs', STRUCTURED_VALIDATION_RENDERED],
    },
  );
  assert.deepEqual(
    classifyFindingsAcceptanceSection({ criteria: [], validation: [] }),
    { state: 'empty' },
  );
  for (const [label, validation] of Object.entries(MALFORMED_VALIDATION_SECTIONS)) {
    assert.deepEqual(
      classifyFindingsAcceptanceSection({ criteria: ['criterion'], validation }),
      { state: 'invalid', detail: 'acceptance_validation_invalid' },
      label,
    );
  }
  for (const [label, validation] of Object.entries(NON_ARRAY_VALIDATION_SECTIONS)) {
    assert.deepEqual(
      classifyFindingsAcceptanceSection({ criteria: ['criterion'], validation }),
      { state: 'invalid', detail: 'acceptance_section_malformed' },
      label,
    );
  }
});

test('non-JSON object shapes are rejected by the shared declaration owner', () => {

  const nullPrototypeEntry = Object.create(null);
  nullPrototypeEntry.operation = 'node_test';
  nullPrototypeEntry.target = 'tests/a.test.mjs';
  nullPrototypeEntry.verification_ids = ['V-1'];

  const hiddenStateEntry = { operation: 'node_test', target: 'tests/a.test.mjs',
    verification_ids: ['V-1'] };
  Object.defineProperty(hiddenStateEntry, 'proof_id', { value: 'P-1', enumerable: false });

  for (const entry of [nullPrototypeEntry, hiddenStateEntry]) {
    const classified = classifyFindingsAcceptanceSection({
      criteria: ['criterion'],
      validation: [entry],
    });
    assert.deepEqual(classified, {
      state: 'invalid',
      detail: 'acceptance_validation_invalid',
    });
  }

  const rejected = classifyFindingsAcceptanceSection({
    criteria: ['criterion'],
    validation: [{ command: '   ', verification_ids: ['V-1'] }],
  });
  assert.equal(rejected.detail, 'acceptance_validation_invalid');
});

test('the shared classifier never filters, coerces, or stringifies entries before canonical validation', () => {

  const wouldSurviveFiltering = {
    'a filtered-away blank string beside a valid command': [
      'node --test tests/a.test.mjs',
      '',
    ],
    'a filtered-away structured entry beside a valid command': [
      'node --test tests/a.test.mjs',
      { command: 'node --test tests/b.test.mjs' },
    ],
    'a stringified non-string entry': ['node --test tests/a.test.mjs', 42],
  };
  for (const [label, validation] of Object.entries(wouldSurviveFiltering)) {
    assert.deepEqual(
      classifyFindingsAcceptanceSection({ criteria: ['criterion'], validation }),
      { state: 'invalid', detail: 'acceptance_validation_invalid' },
      label,
    );
  }

  const structuredOnly = classifyFindingsAcceptanceSection({
    criteria: ['criterion'],
    validation: [
      { operation: 'node_test', target: 'tests/a.test.mjs', verification_ids: ['V-1'] },
      { operation: 'node_test', target: 'tests/b.test.mjs', verification_ids: ['V-2'] },
    ],
  });
  assert.equal(structuredOnly.state, 'valid');
  assert.deepEqual(structuredOnly.validation, [
    '{"operation":"node_test","target":"tests/a.test.mjs","verification_ids":["V-1"]}',
    '{"operation":"node_test","target":"tests/b.test.mjs","verification_ids":["V-2"]}',
  ]);
});

test('terminal whole-WK identity checks, role behavior, and refusal codes are unchanged', async () => {
  const complete = { criteria: ['criterion'], validation: [STRUCTURED_VALIDATION_ENTRY] };
  const base = wholeWkFrozenContract({
    parentAcceptance: complete,
    sliceAcceptance: complete,
  });
  const parent = JSON.parse(base.canonical_parent_wk_contract);
  const slice = JSON.parse(base.review_unit_contract);

  assert.equal(
    await resolveFindingsOnlyAcceptanceContract({
      role: 'worker',
      subject: WHOLE_WK_SUBJECT,
      frozenReviewContract: base,
    }),
    null,
  );

  const identityMutations = {
    'subject mismatch': { ...base, review_subject: 'WK-1311#SLICE-004' },
    'parent not in whole-WK review': {
      ...base,
      canonical_parent_wk_contract: JSON.stringify({ ...parent, status: 'active' }),
    },
    'review unit is not the addressed slice': {
      ...base,
      review_unit_contract: JSON.stringify({ ...slice, id: 'SLICE-004' }),
    },
    'review unit does not byte-match the embedded slice': {
      ...base,
      review_unit_contract: JSON.stringify({ ...slice, title: 'Tampered' }),
    },
    'wrong frozen schema version': { ...base, schema_version: 'not-a-frozen-contract.v1' },
  };
  for (const [label, frozenReviewContract] of Object.entries(identityMutations)) {
    await assert.rejects(
      resolveFindingsOnlyAcceptanceContract({
        role: 'review',
        subject: WHOLE_WK_SUBJECT,
        frozenReviewContract,
      }),
      (error) => error?.code === 'frozen_findings_only_contract_invalid',
      `expected ${label} to fail closed`,
    );
  }
});
