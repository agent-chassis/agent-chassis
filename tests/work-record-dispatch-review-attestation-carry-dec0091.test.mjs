

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeReviewAttestationDigest,
} from '../packages/wiki-core/src/lib/work-record-review-attestation.mjs';
import {
  carryReviewAttestations,
} from '../packages/wiki-core/src/lib/review-attestation-pack-carry.mjs';

const VALID_SOURCE_DIGEST = `sha256:${'a'.repeat(64)}`;
const TRUSTED_REVIEW_CONTROLS = ['write_scope_total_loc', 'max_write_file_loc'];

const TARGET_UNIT = {
  kind: 'slice',
  address: 'WK-0991#SLICE-012',
  record_id: 'WK-0991',
  slice_id: 'SLICE-012',
};

const REVIEW_UNIT = {
  kind: 'slice',
  address: 'WK-0949#SLICE-009',
  record_id: 'WK-0949',
  slice_id: 'SLICE-009',
};

const REVIEW_RUN_REF = {
  run_id: 'wkdb_13cf3375d4690d81',
  monitor_handle: 'wkdb_13cf3375d4690d81',
  subject_address: REVIEW_UNIT.address,
};

function deepClone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function makeStoredAttestation(overrides = {}) {
  const attestation = {
    schema_version: 'review-attestation.v1',
    authority: 'portfolio_local_reference',
    record_id: 'WK-0991',
    unit: deepClone(TARGET_UNIT),
    selected_unit: deepClone(TARGET_UNIT),
    source_record_digest: VALID_SOURCE_DIGEST,
    source_digest: VALID_SOURCE_DIGEST,
    generator: {
      name: 'agent-chassis',
      version: '0.2.0',
    },
    generated_at: '2026-06-10T15:23:07.598Z',
    decision_kind: 'work_unit_atomicity',
    attestation_id: 'att-0991-slice-012',
    attestation_digest: null,
    repo: 'agent-chassis/agent-chassis',
    reviewed_controls: TRUSTED_REVIEW_CONTROLS.slice(),
    reviewed_at: '2026-06-10T15:23:07.598Z',
    expires_at: '2026-06-17T00:00:00Z',
    reviewer_role_class: 'reviewer',
    status: 'accepted_with_nonblocking_findings',
    review_run_ref: {
      ...deepClone(REVIEW_RUN_REF),
      role_class: 'reviewer',
      terminal_status: 'succeeded',
      provenance_kind: 'structured_dispatch_run',
    },
    review_unit: deepClone(REVIEW_UNIT),
    review_result: {
      outcome: 'passed_no_blocking_or_medium_findings',
      findings_count: 0,
      medium_findings_count: 0,
      blocking_findings_count: 0,
    },
    data: {
      source_digest: VALID_SOURCE_DIGEST,
    },
    local_only_notes: 'do not project',
    findings: ['local-only finding text that must not carry'],
    reviewer_prose: 'local-only reviewer prose that must not carry',
    ...overrides,
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'attestation_digest')) {
    attestation.attestation_digest = computeReviewAttestationDigest(attestation);
  }
  return attestation;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function normalizeReviewAttestations(packInput) {
  if (Array.isArray(packInput)) {
    return packInput;
  }
  return firstDefined(
    packInput?.review_attestations,
    packInput?.reviewAttestations,
    packInput?.reviewAttestation,
    []
  );
}

test('review attestation carry preserves trusted controls under a matching role binding', () => {
  for (const [roleClass, reviewRunSubject, reviewUnit] of [
    [
      'reviewer',
      'agent-chassis:WK-1012#SLICE-006',
      {
        kind: 'slice',
        address: 'agent-chassis:WK-1012#SLICE-006',
        record_id: 'WK-1012',
        slice_id: 'SLICE-006',
      },
    ],
    [
      'redteam',
      'agent-chassis:WK-1012#SLICE-007',
      {
        kind: 'slice',
        address: 'agent-chassis:WK-1012#SLICE-007',
        record_id: 'WK-1012',
        slice_id: 'SLICE-007',
      },
    ],
  ]) {
    const packInput = carryReviewAttestations(
      [
        makeStoredAttestation({
          reviewer_role_class: roleClass,
          review_run_ref: {
            ...deepClone(REVIEW_RUN_REF),
            role_class: roleClass,
            subject_address: reviewRunSubject,
            terminal_status: 'succeeded',
            provenance_kind: 'structured_dispatch_run',
          },
          review_unit: reviewUnit,
        }),
      ],
      {
        repo: 'agent-chassis/agent-chassis',
        unit_address: TARGET_UNIT.address,
        source_digest: VALID_SOURCE_DIGEST,
        required_role_class: roleClass,
        required_controls: TRUSTED_REVIEW_CONTROLS.slice(),
        admitting_run_id: 'wkadm_test_admission_transaction',
        now: '2026-06-10T16:00:00Z',
      }
    );
    const reviewAttestations = normalizeReviewAttestations(packInput);
    assert.equal(reviewAttestations.length, 1);
    assert.deepEqual(
      reviewAttestations[0].reviewed_controls.slice().sort(),
      TRUSTED_REVIEW_CONTROLS.slice().sort()
    );

    assert.equal(reviewAttestations[0].review_run_ref, undefined);
    assert.equal(reviewAttestations[0].review_unit, undefined);
  }
});

test('review attestation carry accepts either reviewer or redteam evidence for a review-role review-threshold binding on ordinary units', () => {
  for (const [attestationRole, requiredRole, reviewRunSubject, reviewUnit] of [
    [
      'reviewer',
      'redteam',
      'agent-chassis:WK-1012#SLICE-006',
      {
        kind: 'slice',
        address: 'agent-chassis:WK-1012#SLICE-006',
        record_id: 'WK-1012',
        slice_id: 'SLICE-006',
      },
    ],
    [
      'redteam',
      'reviewer',
      'agent-chassis:WK-1012#SLICE-007',
      {
        kind: 'slice',
        address: 'agent-chassis:WK-1012#SLICE-007',
        record_id: 'WK-1012',
        slice_id: 'SLICE-007',
      },
    ],
  ]) {
    const packInput = carryReviewAttestations(
      [
        makeStoredAttestation({
          reviewer_role_class: attestationRole,
          review_run_ref: {
            ...deepClone(REVIEW_RUN_REF),
            role_class: attestationRole,
            subject_address: reviewRunSubject,
            terminal_status: 'succeeded',
            provenance_kind: 'structured_dispatch_run',
          },
          review_unit: reviewUnit,
        }),
      ],
      {
        repo: 'agent-chassis/agent-chassis',
        unit_address: TARGET_UNIT.address,
        source_digest: VALID_SOURCE_DIGEST,
        required_role_class: requiredRole,
        required_controls: TRUSTED_REVIEW_CONTROLS.slice(),
        admitting_run_id: 'wkadm_test_admission_transaction',
        now: '2026-06-10T16:00:00Z',
      }
    );
    const reviewAttestations = normalizeReviewAttestations(packInput);
    assert.equal(
      reviewAttestations.length,
      1,
      `${attestationRole} attestation must satisfy a ${requiredRole}-required review-threshold binding on an ordinary unit`
    );
    assert.equal(reviewAttestations[0].reviewer_role_class, attestationRole);
    assert.deepEqual(
      reviewAttestations[0].reviewed_controls.slice().sort(),
      TRUSTED_REVIEW_CONTROLS.slice().sort()
    );

    assert.equal(reviewAttestations[0].review_run_ref, undefined);
    assert.equal(reviewAttestations[0].review_unit, undefined);
  }
});

test('review attestation carry enforces a per-control policy role requirement', () => {
  function carryWith({ attestationRole, controlRoleRequirements }) {
    const packInput = carryReviewAttestations(
      [
        makeStoredAttestation({
          reviewer_role_class: attestationRole,
          review_run_ref: {
            ...deepClone(REVIEW_RUN_REF),
            role_class: attestationRole,
            subject_address: TARGET_UNIT.address,
            terminal_status: 'succeeded',
            provenance_kind: 'structured_dispatch_run',
          },
          review_unit: undefined,
        }),
      ],
      {
        repo: 'agent-chassis/agent-chassis',
        unit_address: TARGET_UNIT.address,
        source_digest: VALID_SOURCE_DIGEST,
        required_role_class: 'reviewer',
        required_controls: TRUSTED_REVIEW_CONTROLS.slice(),
        control_role_requirements: controlRoleRequirements,
        admitting_run_id: 'wkadm_test_admission_transaction',
        now: '2026-06-10T16:00:00Z',
      }
    );
    return normalizeReviewAttestations(packInput).length;
  }

  assert.equal(carryWith({ attestationRole: 'redteam', controlRoleRequirements: { write_scope_total_loc: 'redteam' } }), 1);
  assert.equal(carryWith({ attestationRole: 'reviewer', controlRoleRequirements: { write_scope_total_loc: 'redteam' } }), 0);

  assert.equal(carryWith({ attestationRole: 'reviewer', controlRoleRequirements: undefined }), 1);
  assert.equal(carryWith({ attestationRole: 'redteam', controlRoleRequirements: undefined }), 1);
});
