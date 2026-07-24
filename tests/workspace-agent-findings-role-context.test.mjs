import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
  FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
  loadWorkspaceAgentFindingsRoleContext,
  resolveFindingsOnlyAcceptanceContract,
  resolveWorkspaceAgentFindingsRoleContext,
} from '../packages/agent-launch-cli/src/lib/workspace-agent-findings-role-context.mjs';

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

const SLICE_SUBJECT = 'WK-1311#SLICE-003';

function sliceLevelFrozenContract({
  parentAcceptance,
  sliceAcceptance,
  parentStatus = 'active',
  sliceStatus = 'review',
  sliceWorkKind = 'implementation',
  reviewUnitContract,
} = {}) {
  const slice = {
    id: 'SLICE-003',
    title: 'Implementation slice under review',
    work_kind: sliceWorkKind,
    status: sliceStatus,
    acceptance: sliceAcceptance,
  };
  const parent = {
    id: 'WK-1311',
    title: 'Parent tracker',
    status: parentStatus,
    work_kind: 'tracker',
    acceptance: parentAcceptance,
    slices: [slice],
  };
  return {
    schema_version: FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
    review_subject: SLICE_SUBJECT,
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

test('slice-level review fails closed on wrong work kind, status, parent phase, and stale embedding', async () => {
  const identityCases = {
    'selected slice is not implementation work': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
      sliceWorkKind: 'review',
    },
    'selected slice is not under review': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
      sliceStatus: 'active',
    },
    'parent is itself in whole-WK review': {
      parentAcceptance: { criteria: [], validation: [] },
      sliceAcceptance: COMPLETE_SLICE_ACCEPTANCE,
      parentStatus: 'review',
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
