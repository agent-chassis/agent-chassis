import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeReviewAttestationDigest,
} from '../packages/wiki-core/src/lib/work-record-review-attestation.mjs';
import {
  REVIEW_ATTESTATION_REQUIRED_ROLE_CLASS,
  carryReviewAttestations,
} from '../packages/wiki-core/src/lib/review-attestation-pack-carry.mjs';

const VALID_SOURCE_DIGEST = `sha256:${'a'.repeat(64)}`;
const STALE_SOURCE_DIGEST = `sha256:${'b'.repeat(64)}`;
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

function makeStoredEvidenceFixture(mutator = () => {}, { recomputeDigest = true } = {}) {
  const attestation = makeStoredAttestation();
  mutator(attestation);
  if (recomputeDigest) {
    attestation.attestation_digest = computeReviewAttestationDigest(attestation);
  }
  return {
    review_attestation: attestation,
  };
}

function reviewBinding(overrides = {}) {
  return {
    required_role_class: REVIEW_ATTESTATION_REQUIRED_ROLE_CLASS,
    required_controls: TRUSTED_REVIEW_CONTROLS.slice(),
    admitting_run_id: 'wkadm_test_admission_transaction',
    ...overrides,
  };
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

test('review attestation carry fail-closed cases do not produce review attestations', () => {
  const expectation = reviewBinding();
  const invalidCases = [
    ['wrong role', makeStoredEvidenceFixture((attestation) => {
      attestation.review_run_ref.role_class = 'worker';
    })],
    ['wrong role class', makeStoredEvidenceFixture((attestation) => {
      attestation.reviewer_role_class = 'coordinator';
    })],
    ['expired evidence', makeStoredEvidenceFixture((attestation) => {
      attestation.expires_at = '2026-06-10T15:30:00Z';
    })],
    ['wrong unit', makeStoredEvidenceFixture((attestation) => {
      attestation.unit = {
        kind: 'slice',
        address: 'WK-1012#SLICE-002',
        record_id: 'WK-1012',
        slice_id: 'SLICE-002',
      };
    })],
    ['wrong control', makeStoredEvidenceFixture((attestation) => {
      attestation.reviewed_controls = ['write_scope_total_loc'];
    })],
    ['self-authored evidence', makeStoredEvidenceFixture((attestation) => {
      attestation.review_run_ref.run_id = 'wkadm_test_admission_transaction';
    })],
    ['malformed evidence', makeStoredEvidenceFixture((attestation) => {
      attestation.review_run_ref = null;
    }, { recomputeDigest: false })],
    ['untrusted outcome', makeStoredEvidenceFixture((attestation) => {
      attestation.status = 'needs_review';
    })],
    ['untrusted provenance', makeStoredEvidenceFixture((attestation) => {
      attestation.review_run_ref.provenance_kind = 'caller_payload';
    })],
    ['digest mismatch', makeStoredEvidenceFixture((attestation) => {
      attestation.source_digest = STALE_SOURCE_DIGEST;
    }, { recomputeDigest: false })],
  ];

  for (const [label, fixture] of invalidCases) {
    const packInput = carryReviewAttestations([fixture.review_attestation], {
      repo: 'agent-chassis/agent-chassis',
      unit_address: TARGET_UNIT.address,
      source_digest: VALID_SOURCE_DIGEST,
      required_role_class: expectation.required_role_class,
      required_controls: expectation.required_controls.slice(),
      admitting_run_id: expectation.admitting_run_id,
      now: '2026-06-10T16:00:00Z',
    });
    const reviewAttestations = normalizeReviewAttestations(packInput);
    assert.equal(
      reviewAttestations.length,
      0,
      `expected no review attestations for ${label}`
    );
  }
});

test('review attestation carry omits separate-review-unit prose and identity leakage', () => {
  const packInput = carryReviewAttestations(
    [
      makeStoredAttestation({
        reviewer_role_class: 'redteam',
        review_run_ref: {
          ...deepClone(REVIEW_RUN_REF),
          role_class: 'redteam',
          subject_address: 'agent-chassis:WK-1012#SLICE-006',
          terminal_status: 'succeeded',
          provenance_kind: 'structured_dispatch_run',
        },
        review_unit: {
          kind: 'slice',
          address: 'agent-chassis:WK-1012#SLICE-006',
          record_id: 'WK-1012',
          slice_id: 'SLICE-006',
        },
        findings: ['review prose must stay local only'],
        reviewer_prose: 'separate review unit prose that must not leak',
        local_only_notes: 'review prose must stay local only',
      }),
    ],
    {
      repo: 'agent-chassis/agent-chassis',
      unit_address: TARGET_UNIT.address,
      source_digest: VALID_SOURCE_DIGEST,
      required_role_class: 'redteam',
      required_controls: TRUSTED_REVIEW_CONTROLS.slice(),
      admitting_run_id: 'wkadm_test_admission_transaction',
      now: '2026-06-10T16:00:00Z',
    }
  );
  const reviewAttestations = normalizeReviewAttestations(packInput);
  assert.equal(reviewAttestations.length, 1);

  const projectionText = JSON.stringify(reviewAttestations[0]);
  assert.equal(projectionText.includes('WK-1012#SLICE-006'), false);
  assert.equal(projectionText.includes('separate review unit prose that must not leak'), false);
  assert.equal(projectionText.includes('review prose must stay local only'), false);
  assert.equal(reviewAttestations[0].review_run_ref, undefined);
  assert.equal(reviewAttestations[0].review_unit, undefined);
  assert.deepEqual(
    reviewAttestations[0].reviewed_controls.slice().sort(),
    TRUSTED_REVIEW_CONTROLS.slice().sort()
  );
});

test('a related review unit carries separate-review-unit evidence for the target with no blocked_dependency edge', () => {
  const attestation = makeStoredAttestation();
  const packInput = carryReviewAttestations([attestation], {
    repo: 'agent-chassis/agent-chassis',
    unit_address: TARGET_UNIT.address,
    source_digest: VALID_SOURCE_DIGEST,
    required_role_class: 'reviewer',
    required_controls: TRUSTED_REVIEW_CONTROLS.slice(),
    admitting_run_id: 'wkadm_test_admission_transaction',
    now: '2026-06-10T16:00:00Z',
  });
  const reviewAttestations = normalizeReviewAttestations(packInput);
  assert.equal(reviewAttestations.length, 1, 'related review-unit evidence should carry without a blocking edge');

  assert.equal(reviewAttestations[0].unit.address, TARGET_UNIT.address);
  assert.deepEqual(
    reviewAttestations[0].reviewed_controls.slice().sort(),
    TRUSTED_REVIEW_CONTROLS.slice().sort()
  );

  assert.equal(reviewAttestations[0].review_unit, undefined);
  assert.equal(reviewAttestations[0].review_run_ref, undefined);
});

test('related review-unit carry fails closed for wrong repo, stale digest, wrong control, wrong role, and self-authored evidence', () => {
  const trustedRunRef = (overrides = {}) => ({
    ...deepClone(REVIEW_RUN_REF),
    role_class: 'reviewer',
    terminal_status: 'succeeded',
    provenance_kind: 'structured_dispatch_run',
    ...overrides,
  });
  const cases = [

    ['wrong repo id', makeStoredAttestation(), { repo: 'agent-chassis/some-other-repo' }],

    ['stale source digest', makeStoredAttestation(), { source_digest: STALE_SOURCE_DIGEST }],

    ['wrong control', makeStoredAttestation({ reviewed_controls: ['write_scope_total_loc'] }), {}],

    ['wrong role', makeStoredAttestation({
      reviewer_role_class: 'coordinator',
      review_run_ref: trustedRunRef({ role_class: 'coordinator' }),
    }), {}],

    ['self-authored', makeStoredAttestation({
      review_run_ref: trustedRunRef({ run_id: 'wkadm_test_admission_transaction' }),
    }), {}],
  ];

  for (const [label, attestation, expectationOverride] of cases) {
    const packInput = carryReviewAttestations([attestation], {
      repo: 'agent-chassis/agent-chassis',
      unit_address: TARGET_UNIT.address,
      source_digest: VALID_SOURCE_DIGEST,
      required_role_class: REVIEW_ATTESTATION_REQUIRED_ROLE_CLASS,
      required_controls: TRUSTED_REVIEW_CONTROLS.slice(),
      admitting_run_id: 'wkadm_test_admission_transaction',
      now: '2026-06-10T16:00:00Z',
      ...expectationOverride,
    });
    assert.equal(
      normalizeReviewAttestations(packInput).length,
      0,
      `expected no carried attestations for ${label}`
    );
  }
});
