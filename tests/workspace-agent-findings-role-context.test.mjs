import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadWorkspaceAgentFindingsRoleContext,
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
