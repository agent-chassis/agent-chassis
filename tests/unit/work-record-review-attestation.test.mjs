import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewAttestation,
  canonicalizeReviewOutcome,
  computeReviewAttestationDigest,
  isReviewAttestationExpired,
  REVIEW_ATTESTATION_AUTHORITY,
  REVIEW_ATTESTATION_DECISION_CODES,
  validateReviewAttestation
} from "../../packages/wiki-core/src/lib/work-record-review-attestation.mjs";

const REPO = "agent-chassis/agent-chassis";
const RECORD_ID = "WK-9894";
const REVIEW_RECORD_ID = "WK-9895";
const WRONG_SUBJECT_RECORD_ID = "WK-9896";
const UNIT = {
  kind: "work_item",
  address: RECORD_ID,
  record_id: RECORD_ID,
  slice_id: null
};
const SOURCE_DIGEST = `sha256:${"a".repeat(64)}`;
const REVIEWED_CONTROLS = ["max_write_file_loc", "write_scope_total_loc"];

const FIXTURE_CONTROL_IDS = [
  "write_scope_total_loc",
  "max_write_file_loc",
  "write_scope_count",
  "acceptance_criteria_count",
  "validation_command_count",
  "expected_changed_line_budget",
  "declared_runtime_mode_count",
  "artifact_kind_count"
];

const UNENUMERATED_CONTROL_IDS = [
  "write_scope_test_count",
  "unknown_control_id",
  "critical_surface_count",
  "node_engine.write_scope_count",
  "worker_admission.write_scope_count",
  "WriteScopeTotalLoc"
];
const REVIEWED_AT = "2026-06-09T12:00:00Z";
const EXPIRES_AT = "2026-06-12T12:00:00Z";

function baseReviewRun(overrides = {}) {
  return {
    run_id: "review-run-1",
    role_class: "reviewer",
    terminal_status: "succeeded",
    subject_address: UNIT.address,
    provenance_kind: "structured_dispatch_run",
    ...overrides
  };
}

function buildAttestationInput(overrides = {}) {
  return {
    attestation_id: "ra:test-review-attestation",
    repo: REPO,
    unit: UNIT,
    reviewed_controls: REVIEWED_CONTROLS,
    reviewer_role_class: "reviewer",
    review_outcome: "no_findings",
    blocking_finding_count: 0,
    medium_finding_count: 0,
    source_digest: SOURCE_DIGEST,
    reviewed_at: REVIEWED_AT,
    expires_at: EXPIRES_AT,
    review_run: baseReviewRun(),
    ...overrides
  };
}

function buildStoredAttestation(overrides = {}) {
  const result = buildReviewAttestation(buildAttestationInput(overrides));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.attestation;
}

function buildSeparateReviewUnitAttestation(overrides = {}) {
  const result = buildReviewAttestation(buildAttestationInput({
    attestation_id: "ra:test-separate-review-attestation",
    review_unit: {
      record_id: REVIEW_RECORD_ID,
      slice_id: null,
      address: REVIEW_RECORD_ID
    },
    review_run: baseReviewRun({ subject_address: REVIEW_RECORD_ID }),
    ...overrides
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.attestation;
}

function withRecomputedDigest(attestation, patch) {
  const updated = {
    ...attestation,
    ...patch
  };
  updated.attestation_digest = computeReviewAttestationDigest(updated);
  return updated;
}

function baseExpectation(overrides = {}) {
  return {
    repo: REPO,
    unit_address: UNIT.address,
    source_digest: SOURCE_DIGEST,
    required_role_class: "reviewer",
    required_controls: REVIEWED_CONTROLS,
    admitting_run_id: "implementation-run-1",
    now: "2026-06-10T12:00:00Z",
    ...overrides
  };
}

test("core canonicalizes public accepted review outcomes to private stored dispositions", () => {
  const noFindings = buildReviewAttestation(buildAttestationInput({
    review_outcome: "no_findings"
  }));
  assert.equal(noFindings.ok, true);
  assert.equal(noFindings.attestation.status, "accepted_no_findings");
  assert.equal(canonicalizeReviewOutcome("no_findings"), "accepted_no_findings");

  const nonBlocking = buildReviewAttestation(buildAttestationInput({
    attestation_id: "ra:test-review-attestation-nonblocking",
    review_outcome: "passed_no_blocking_or_medium_findings"
  }));
  assert.equal(nonBlocking.ok, true);
  assert.equal(nonBlocking.attestation.status, "accepted_with_nonblocking_findings");
  assert.equal(
    canonicalizeReviewOutcome("passed_no_blocking_or_medium_findings"),
    "accepted_with_nonblocking_findings"
  );

  assert.equal(noFindings.attestation.authority, REVIEW_ATTESTATION_AUTHORITY);
  assert.equal(noFindings.attestation.launch_authoritative, undefined);

  const findingsBearing = buildReviewAttestation(buildAttestationInput({
    attestation_id: "ra:test-review-attestation-findings-bearing-control-pass",
    review_outcome: "changes_requested",
    blocking_finding_count: 1,
    medium_finding_count: 2
  }));
  assert.equal(findingsBearing.ok, true, JSON.stringify(findingsBearing));
  assert.equal(findingsBearing.attestation.status, "accepted_control_pass_with_findings");
  assert.equal(findingsBearing.attestation.authority, REVIEW_ATTESTATION_AUTHORITY);
  assert.equal(findingsBearing.attestation.launch_authoritative, undefined);
});

test("core refuses omitted trusted finding counts unless a clean-review signal is trusted", () => {
  const missingCountsInput = buildAttestationInput();
  delete missingCountsInput.blocking_finding_count;
  delete missingCountsInput.medium_finding_count;

  const missingCounts = buildReviewAttestation(missingCountsInput);
  assert.equal(missingCounts.ok, false);
  assert.equal(
    missingCounts.decision_code,
    REVIEW_ATTESTATION_DECISION_CODES.missingTrustedReviewResultApi
  );

  const cleanSignal = buildReviewAttestation({
    ...missingCountsInput,
    trusted_clean_review: true
  });
  assert.equal(cleanSignal.ok, true, JSON.stringify(cleanSignal));
  assert.equal(cleanSignal.attestation.status, "accepted_no_findings");
});

test("core rejects unknown, blocking, and medium-finding outcomes", () => {
  for (const reviewOutcome of ["admit", "has_blocking_findings", ""]) {
    const result = buildReviewAttestation(buildAttestationInput({ review_outcome: reviewOutcome }));
    assert.equal(result.ok, false, `expected ${reviewOutcome || "<empty>"} to be refused`);
    assert.equal(result.decision_code, REVIEW_ATTESTATION_DECISION_CODES.blockingFindings);
  }

  const mediumFinding = buildReviewAttestation(buildAttestationInput({
    medium_finding_count: 1
  }));
  assert.equal(mediumFinding.ok, false);
  assert.equal(mediumFinding.decision_code, REVIEW_ATTESTATION_DECISION_CODES.blockingFindings);

  const blockingFinding = buildReviewAttestation(buildAttestationInput({
    blocking_finding_count: "1"
  }));
  assert.equal(blockingFinding.ok, false);
  assert.equal(blockingFinding.decision_code, REVIEW_ATTESTATION_DECISION_CODES.blockingFindings);

  const mediumFindingString = buildReviewAttestation(buildAttestationInput({
    medium_finding_count: "1"
  }));
  assert.equal(mediumFindingString.ok, false);
  assert.equal(mediumFindingString.decision_code, REVIEW_ATTESTATION_DECISION_CODES.blockingFindings);

  for (const invalidCount of ["not-a-number", "1.25", -1, {}]) {
    const invalidBlocking = buildReviewAttestation(buildAttestationInput({
      blocking_finding_count: invalidCount
    }));
    assert.equal(invalidBlocking.ok, false, `expected blocking ${JSON.stringify(invalidCount)} to be refused`);
    assert.equal(invalidBlocking.decision_code, REVIEW_ATTESTATION_DECISION_CODES.blockingFindings);

    const invalidMedium = buildReviewAttestation(buildAttestationInput({
      medium_finding_count: invalidCount
    }));
    assert.equal(invalidMedium.ok, false, `expected medium ${JSON.stringify(invalidCount)} to be refused`);
    assert.equal(invalidMedium.decision_code, REVIEW_ATTESTATION_DECISION_CODES.blockingFindings);
  }
});

test("validation hardening requires exact expectation binding and remains non-authoritative", () => {
  const attestation = buildStoredAttestation();

  const valid = validateReviewAttestation(attestation, baseExpectation());
  assert.equal(valid.valid, true, JSON.stringify(valid));
  assert.equal(valid.launch_authoritative, false);

  for (const expectation of [
    {},
    { repo: REPO },
    baseExpectation({ source_digest: undefined }),
    baseExpectation({ required_role_class: undefined }),
    baseExpectation({ required_controls: [] }),
    baseExpectation({ admitting_run_id: undefined })
  ]) {
    const result = validateReviewAttestation(attestation, expectation);
    assert.equal(result.valid, false, `expected missing expectation for ${JSON.stringify(expectation)}`);
    assert.equal(result.decision_code, REVIEW_ATTESTATION_DECISION_CODES.missingExpectation);
  }

  const cases = [
    [baseExpectation({ repo: "agent-chassis/other-repo" }), REVIEW_ATTESTATION_DECISION_CODES.wrongUnit],
    [baseExpectation({ unit_address: "WK-0000" }), REVIEW_ATTESTATION_DECISION_CODES.wrongUnit],
    [baseExpectation({ source_digest: `sha256:${"b".repeat(64)}` }), REVIEW_ATTESTATION_DECISION_CODES.wrongDigest],
    [baseExpectation({ required_role_class: "redteam" }), REVIEW_ATTESTATION_DECISION_CODES.wrongRole],

    [baseExpectation({ required_controls: [...REVIEWED_CONTROLS, "critical_surface_count"] }), REVIEW_ATTESTATION_DECISION_CODES.wrongControl],
    [baseExpectation({ admitting_run_id: "review-run-1" }), REVIEW_ATTESTATION_DECISION_CODES.selfAuthored]
  ];
  for (const [expectation, decisionCode] of cases) {
    const result = validateReviewAttestation(attestation, expectation);
    assert.equal(result.valid, false, decisionCode);
    assert.equal(result.decision_code, decisionCode);
  }
});

test("validation rejects redigested tamper and impossible freshness windows", () => {
  const attestation = buildStoredAttestation();

  const tampered = {
    ...attestation,
    reviewed_controls: ["write_scope_total_loc"]
  };
  const digestMismatch = validateReviewAttestation(tampered, baseExpectation());
  assert.equal(digestMismatch.valid, false);
  assert.equal(digestMismatch.decision_code, REVIEW_ATTESTATION_DECISION_CODES.digestMismatch);

  const wrongRunRole = withRecomputedDigest(attestation, {
    review_run_ref: {
      ...attestation.review_run_ref,
      role_class: "redteam"
    }
  });
  const wrongRunRoleResult = validateReviewAttestation(wrongRunRole, baseExpectation());
  assert.equal(wrongRunRoleResult.valid, false);
  assert.equal(wrongRunRoleResult.decision_code, REVIEW_ATTESTATION_DECISION_CODES.wrongRole);

  const launchAuthoritative = withRecomputedDigest(attestation, {
    launch_authoritative: true
  });
  const launchAuthoritativeResult = validateReviewAttestation(launchAuthoritative, baseExpectation());
  assert.equal(launchAuthoritativeResult.valid, true);
  assert.equal(launchAuthoritativeResult.launch_authoritative, false);

  const impossibleWindow = withRecomputedDigest(attestation, {
    reviewed_at: "2026-06-13T12:00:00Z",
    expires_at: "2026-06-12T12:00:00Z"
  });
  const impossibleResult = validateReviewAttestation(impossibleWindow, baseExpectation());
  assert.equal(impossibleResult.valid, false);
  assert.equal(impossibleResult.decision_code, REVIEW_ATTESTATION_DECISION_CODES.malformed);
  assert.equal(isReviewAttestationExpired(impossibleWindow, "2026-06-10T12:00:00Z"), true);
});

test("reviewed controls: enumerated and unenumerated control ids both attest", () => {
  const allControls = [...FIXTURE_CONTROL_IDS];

  const stored = buildStoredAttestation({ reviewed_controls: allControls });
  assert.deepEqual([...stored.reviewed_controls].sort(), [...allControls].sort());
  const validAll = validateReviewAttestation(stored, baseExpectation({ required_controls: allControls }));
  assert.equal(validAll.valid, true, JSON.stringify(validAll));

  for (const control of [...FIXTURE_CONTROL_IDS, ...UNENUMERATED_CONTROL_IDS]) {
    const single = buildStoredAttestation({ reviewed_controls: [control] });
    assert.deepEqual(single.reviewed_controls, [control], `expected ${control} to persist verbatim`);
    const result = validateReviewAttestation(single, baseExpectation({ required_controls: [control] }));
    assert.equal(result.valid, true, `expected ${control} to attest`);
  }

  const mixed = buildStoredAttestation({
    reviewed_controls: [...REVIEWED_CONTROLS, "write_scope_test_count"]
  });
  assert.deepEqual(
    [...mixed.reviewed_controls].sort(),
    [...REVIEWED_CONTROLS, "write_scope_test_count"].sort()
  );
});

test("reviewed controls: duplicate, empty, whitespace, and non-string ids still fail closed", () => {
  for (const badControls of [
    ["write_scope_total_loc", "write_scope_total_loc"],
    ["write_scope_test_count", "write_scope_test_count"],
    [""],
    ["   "],
    [42],
    [null],
    [undefined],
    [{ control_id: "write_scope_total_loc" }],
    [["write_scope_total_loc"]],
    [...REVIEWED_CONTROLS, ""],
    "write_scope_total_loc",
    []
  ]) {
    const refused = buildReviewAttestation(buildAttestationInput({ reviewed_controls: badControls }));
    assert.equal(refused.ok, false, `expected ${JSON.stringify(badControls)} to be refused`);
    assert.equal(refused.decision_code, REVIEW_ATTESTATION_DECISION_CODES.malformed);
  }
});

test("legacy persisted attestation without required_controls still validates and is digest-stable", () => {
  const attestation = buildStoredAttestation();
  assert.equal(Object.prototype.hasOwnProperty.call(attestation, "required_controls"), false);

  const result = validateReviewAttestation(attestation, baseExpectation());
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.launch_authoritative, false);

  const withStray = { ...attestation, required_controls: ["write_scope_total_loc"] };
  assert.equal(computeReviewAttestationDigest(withStray), attestation.attestation_digest);
});

test("separate review unit: core binds the target while preserving the review-run subject", () => {
  const attestation = buildSeparateReviewUnitAttestation();

  assert.equal(attestation.unit.address, RECORD_ID);
  assert.equal(attestation.review_unit.address, REVIEW_RECORD_ID);

  assert.equal(attestation.review_run_ref.subject_address, REVIEW_RECORD_ID);

  assert.equal(attestation.attestation_digest, computeReviewAttestationDigest(attestation));

  const valid = validateReviewAttestation(attestation, baseExpectation());
  assert.equal(valid.valid, true, JSON.stringify(valid));
  assert.equal(valid.launch_authoritative, false);
});

test("separate review unit: tampered stored facts fail closed", () => {
  const attestation = buildSeparateReviewUnitAttestation();

  const rewrittenSubject = {
    ...attestation,
    review_run_ref: { ...attestation.review_run_ref, subject_address: RECORD_ID }
  };
  const rewrittenResult = validateReviewAttestation(rewrittenSubject, baseExpectation());
  assert.equal(rewrittenResult.valid, false);
  assert.equal(rewrittenResult.decision_code, REVIEW_ATTESTATION_DECISION_CODES.digestMismatch);

  const collapsedReviewUnit = withRecomputedDigest(attestation, {
    review_unit: { record_id: RECORD_ID, slice_id: null, address: RECORD_ID }
  });
  const collapsedResult = validateReviewAttestation(collapsedReviewUnit, baseExpectation());
  assert.equal(collapsedResult.valid, false);
  assert.equal(collapsedResult.decision_code, REVIEW_ATTESTATION_DECISION_CODES.malformed);

  const mismatchedSubject = withRecomputedDigest(attestation, {
    review_run_ref: { ...attestation.review_run_ref, subject_address: WRONG_SUBJECT_RECORD_ID }
  });
  const mismatchedResult = validateReviewAttestation(mismatchedSubject, baseExpectation());
  assert.equal(mismatchedResult.valid, false);
  assert.equal(mismatchedResult.decision_code, REVIEW_ATTESTATION_DECISION_CODES.wrongUnit);
});

test("separate review unit: self-authored evidence fails closed", () => {
  const attestation = buildSeparateReviewUnitAttestation();

  const selfAuthored = validateReviewAttestation(
    attestation,
    baseExpectation({ admitting_run_id: attestation.review_run_ref.run_id })
  );
  assert.equal(selfAuthored.valid, false);
  assert.equal(selfAuthored.decision_code, REVIEW_ATTESTATION_DECISION_CODES.selfAuthored);
});
