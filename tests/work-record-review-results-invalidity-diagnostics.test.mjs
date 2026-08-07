

import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStructuredRoleResult } from "../packages/agent-launch-core/src/lib/dispatch-runtime.mjs";
import { STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION } from "../packages/agent-launch-core/src/lib/agent-role-result.mjs";
import {
  buildReviewResultEvidence,
  deriveStructuredResultStatusFromDiagnostics,
  REVIEW_RESULT_EVIDENCE_CLASS_VALUES,
  REVIEW_RESULT_EVIDENCE_DECISION_CODES,
  REVIEW_RESULT_STRUCTURED_STATUS_PRECEDENCE,
  validateReviewResultEvidence
} from "../packages/wiki-core/src/lib/work-record-review-results.mjs";

const REPO = "agent-chassis/agent-chassis";
const RECORD_ID = "WK-9908";
const TARGET_SLICE_ID = "SLICE-001";
const TARGET_SLICE_ADDRESS = `${RECORD_ID}#${TARGET_SLICE_ID}`;
const SOURCE_DIGEST = `sha256:${"b".repeat(64)}`;
const RECORDED_AT = "2026-07-24T12:00:00Z";

const TARGET_UNIT = Object.freeze({
  kind: "slice",
  record_id: RECORD_ID,
  address: TARGET_SLICE_ADDRESS,
  slice_id: TARGET_SLICE_ID
});

const CHANGES_REQUESTED_COUNTS = Object.freeze({
  total: 3,
  blocking: 1,
  critical: 0,
  high: 1,
  medium: 1,
  low: 1,
  info: 0
});

function trustedReviewRun(overrides = {}) {
  return {
    run_id: "review-run-narrowed",
    role_class: "reviewer",
    terminal_status: "succeeded",
    subject_address: TARGET_SLICE_ADDRESS,
    provenance_kind: "structured_dispatch_run",
    ...overrides
  };
}

function buildInput(overrides = {}) {
  return {
    evidence_id: "rr:wk1752",
    repo: REPO,
    unit: TARGET_UNIT,
    source_digest: SOURCE_DIGEST,
    recorded_at: RECORDED_AT,
    review_run: trustedReviewRun(),
    ...overrides
  };
}

function narrowedProjection(overrides = {}) {
  return {
    valid: true,
    claims: {
      reported_role: "reviewer",
      reported_subject: TARGET_SLICE_ADDRESS,
      reported_outcome: "changes_requested"
    },
    finding_counts: { ...CHANGES_REQUESTED_COUNTS },
    reviewed_control_count: 8,
    ...overrides
  };
}

function invalidProjection(diagnostics, overrides = {}) {
  return { valid: false, diagnostics, ...overrides };
}

function assertValidates(evidence, roleClass = "reviewer") {
  const validation = validateReviewResultEvidence(evidence, {
    repo: REPO,
    unit_address: TARGET_SLICE_ADDRESS,
    source_digest: SOURCE_DIGEST,
    required_role_class: roleClass
  });
  assert.equal(validation.valid, true, JSON.stringify(validation));
}

test("valid narrowed changes_requested projection classifies as changes_requested, never missing_result", () => {
  const built = buildReviewResultEvidence(
    buildInput({ structured_role_result: narrowedProjection() })
  );

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "changes_requested");
  assert.notEqual(built.evidence.evidence_class, "missing_result");
  assert.equal(built.evidence.role_result.reported_outcome, "changes_requested");
  assert.equal(Object.hasOwn(built.evidence, "runtime_result"), false);
  assertValidates(built.evidence);
});

test("narrowed changes_requested preserves the bounded finding/control metadata it carries", () => {
  const built = buildReviewResultEvidence(
    buildInput({ structured_role_result: narrowedProjection() })
  );

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.deepEqual(built.evidence.role_result.finding_counts, CHANGES_REQUESTED_COUNTS);
  assert.equal(built.evidence.role_result.reviewed_control_count, 8);

  assert.equal(Object.hasOwn(built.evidence.role_result, "findings"), false);
  assert.equal(Object.hasOwn(built.evidence.role_result, "summary"), false);
  assert.equal(Object.hasOwn(built.evidence.role_result, "reviewed_controls"), false);
  assertValidates(built.evidence);
});

test("a narrowed projection with claims but no counts still classifies as changes_requested", () => {
  const projection = narrowedProjection();
  delete projection.finding_counts;
  delete projection.reviewed_control_count;

  const built = buildReviewResultEvidence(buildInput({ structured_role_result: projection }));
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "changes_requested");
  assert.equal(Object.hasOwn(built.evidence.role_result, "finding_counts"), false);
  assertValidates(built.evidence);
});

test("the real launcher dispatch-runtime projection classifies as changes_requested", () => {

  const projection = normalizeStructuredRoleResult({
    schema_version: STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION,
    valid: true,
    claims: {
      reported_role: "reviewer",
      reported_subject: TARGET_SLICE_ADDRESS,
      reported_outcome: "changes_requested"
    },
    result: {
      finding_counts: { ...CHANGES_REQUESTED_COUNTS },
      reviewed_controls: [
        { control_id: "write_scope_total_loc", result: "fail" },
        { control_id: "max_write_file_loc", result: "pass" }
      ]
    },
    diagnostics: []
  });

  assert.equal(projection.valid, true);
  assert.equal(Object.hasOwn(projection, "findings"), false);
  assert.equal(Object.hasOwn(projection, "summary"), false);
  assert.equal(Object.hasOwn(projection, "candidate"), false);
  assert.equal(projection.claims.reported_outcome, "changes_requested");

  const built = buildReviewResultEvidence(
    buildInput({ structured_role_result: projection })
  );
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "changes_requested");
  assert.deepEqual(built.evidence.role_result.finding_counts, CHANGES_REQUESTED_COUNTS);
  assert.equal(built.evidence.role_result.reviewed_control_count, 2);
  assertValidates(built.evidence);
});

test("redteam narrowed changes_requested is classified the same way", () => {
  const built = buildReviewResultEvidence(
    buildInput({
      review_run: trustedReviewRun({ role_class: "redteam" }),
      structured_role_result: narrowedProjection({
        claims: {
          reported_role: "redteam",
          reported_subject: TARGET_SLICE_ADDRESS,
          reported_outcome: "changes_requested"
        }
      })
    })
  );

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "changes_requested");
  assert.equal(built.evidence.reviewer_role_class, "redteam");
  assertValidates(built.evidence, "redteam");
});

test("missing_result covers a run with no structured result at all", () => {
  const built = buildReviewResultEvidence(
    buildInput({
      review_run: trustedReviewRun({ terminal_status: "completed", structured_result_status: "missing" })
    })
  );

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "missing_result");
  assert.equal(built.evidence.runtime_result.structured_result_status, "missing");
  assertValidates(built.evidence);
});

test("an invalid structured result is never relabelled missing_result even when the run ref says missing", () => {

  const built = buildReviewResultEvidence(
    buildInput({
      review_run: trustedReviewRun({ structured_result_status: "missing" }),
      structured_role_result: invalidProjection([{ code: "malformed_json" }])
    })
  );

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "malformed_result");
  assert.notEqual(built.evidence.evidence_class, "missing_result");
  assert.equal(built.evidence.runtime_result.structured_result_status, "malformed");
  assertValidates(built.evidence);
});

const PRECEDENCE_CASES = [
  { status: "oversized", class: "oversized_result", code: "response_oversized" },
  { status: "oversized", class: "oversized_result", code: "payload_oversized" },
  { status: "multiple", class: "multiple_result", code: "multiple_json_candidates" },
  { status: "duplicate", class: "duplicate_result", code: "duplicate_json_key" },
  { status: "ordinary_json", class: "ordinary_json_result", code: "ordinary_json_code_block" },
  { status: "trailing_prose", class: "trailing_prose_result", code: "trailing_prose_after_result" },
  { status: "malformed", class: "malformed_result", code: "malformed_json" },
  { status: "invalid", class: "invalid_result", code: "schema_mismatch" },
  { status: "invalid", class: "invalid_result", code: "reported_subject_mismatch" },
  { status: "invalid", class: "invalid_result", code: "finding_count_mismatch" },

  { status: "invalid", class: "invalid_result", code: "missing_result" }
];

for (const { status, class: evidenceClass, code } of PRECEDENCE_CASES) {
  test(`diagnostic ${code} resolves to ${status} and evidence class ${evidenceClass}`, () => {
    assert.equal(deriveStructuredResultStatusFromDiagnostics([{ code }]), status);

    const built = buildReviewResultEvidence(
      buildInput({ structured_role_result: invalidProjection([{ code }]) })
    );
    assert.equal(built.ok, true, JSON.stringify(built));
    assert.equal(built.evidence.evidence_class, evidenceClass);
    assert.equal(built.evidence.runtime_result.structured_result_status, status);
    assert.equal(built.evidence.runtime_result.structured_role_result.valid, false);
    assertValidates(built.evidence);
  });
}

const PRECEDENCE_LADDER = [
  { code: "schema_mismatch", status: "invalid" },
  { code: "malformed_json", status: "malformed" },
  { code: "trailing_prose_after_result", status: "trailing_prose" },
  { code: "ordinary_json_code_block", status: "ordinary_json" },
  { code: "duplicate_json_key", status: "duplicate" },
  { code: "multiple_json_candidates", status: "multiple" },
  { code: "payload_oversized", status: "oversized" }
];

test("precedence is independent of diagnostic array order across every adjacent pair", () => {
  for (let index = 0; index + 1 < PRECEDENCE_LADDER.length; index += 1) {
    const weaker = PRECEDENCE_LADDER[index];
    const stronger = PRECEDENCE_LADDER[index + 1];
    const forward = [{ code: weaker.code }, { code: stronger.code }];
    const reversed = [{ code: stronger.code }, { code: weaker.code }];

    assert.equal(
      deriveStructuredResultStatusFromDiagnostics(forward),
      stronger.status,
      `${weaker.code} before ${stronger.code}`
    );
    assert.equal(
      deriveStructuredResultStatusFromDiagnostics(reversed),
      stronger.status,
      `${stronger.code} before ${weaker.code}`
    );
  }
});

test("the full mixed diagnostic set resolves to oversized in both array orders", () => {
  const ascending = PRECEDENCE_LADDER.map(({ code }) => ({ code }));
  const descending = [...ascending].reverse();

  assert.equal(deriveStructuredResultStatusFromDiagnostics(ascending), "oversized");
  assert.equal(deriveStructuredResultStatusFromDiagnostics(descending), "oversized");

  for (const diagnostics of [ascending, descending]) {
    const built = buildReviewResultEvidence(
      buildInput({ structured_role_result: invalidProjection(diagnostics) })
    );
    assert.equal(built.ok, true, JSON.stringify(built));
    assert.equal(built.evidence.evidence_class, "oversized_result");
    assert.equal(built.evidence.runtime_result.structured_result_status, "oversized");
  }
});

test("mixed diagnostics without any precedence-tier code resolve to invalid in any order", () => {
  const diagnostics = [
    { code: "unknown_field" },
    { code: "invalid_severity" },
    { code: "authority_field_forbidden" }
  ];
  assert.equal(deriveStructuredResultStatusFromDiagnostics(diagnostics), "invalid");
  assert.equal(deriveStructuredResultStatusFromDiagnostics([...diagnostics].reverse()), "invalid");
});

test("a lone weaker diagnostic is not shadowed when no stronger tier is present", () => {

  assert.equal(
    deriveStructuredResultStatusFromDiagnostics([
      { code: "trailing_prose_after_result" },
      { code: "schema_mismatch" }
    ]),
    "trailing_prose"
  );
});

test("retained diagnostics are bounded while the complete pre-bounding count is preserved", () => {
  const diagnostics = Array.from({ length: 37 }, (_entry, index) => ({
    code: index === 30 ? "duplicate_json_key" : "unknown_field",
    path: `$.findings[${index}]`
  }));

  const built = buildReviewResultEvidence(
    buildInput({ structured_role_result: invalidProjection(diagnostics) })
  );

  assert.equal(built.ok, true, JSON.stringify(built));

  assert.equal(built.evidence.evidence_class, "duplicate_result");
  const stored = built.evidence.runtime_result.structured_role_result;
  assert.equal(stored.diagnostics.length, 20);
  assert.equal(stored.diagnostic_count, 37);
  assertValidates(built.evidence);
});

test("an explicit complete diagnostic count is preserved and never clamped down", () => {
  const built = buildReviewResultEvidence(
    buildInput({
      structured_role_result: invalidProjection([{ code: "malformed_json" }], {
        diagnostic_count: 12
      })
    })
  );

  assert.equal(built.ok, true, JSON.stringify(built));
  const stored = built.evidence.runtime_result.structured_role_result;
  assert.equal(stored.diagnostics.length, 1);
  assert.equal(stored.diagnostic_count, 12);
});

test("an explicit complete count below the retained diagnostics fails closed", () => {
  const built = buildReviewResultEvidence(
    buildInput({
      structured_role_result: invalidProjection(
        [{ code: "malformed_json" }, { code: "unknown_field" }],
        { diagnostic_count: 1 }
      )
    })
  );

  assert.equal(built.ok, false);
  assert.equal(built.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.malformed);
});

test("an explicitly resolved structured-result status is honoured over the diagnostics", () => {

  const built = buildReviewResultEvidence(
    buildInput({
      structured_role_result: invalidProjection([{ code: "full_response_text_unavailable" }], {
        structured_result_status: "missing"
      })
    })
  );

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "missing_result");
  assert.equal(built.evidence.runtime_result.structured_result_status, "missing");
  assertValidates(built.evidence);
});

test("an explicit structured-result status outside the closed vocabulary fails closed", () => {
  const built = buildReviewResultEvidence(
    buildInput({
      structured_role_result: invalidProjection([{ code: "malformed_json" }], {
        structured_result_status: "totally_fine"
      })
    })
  );

  assert.equal(built.ok, false);
  assert.equal(built.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.malformed);
});

test("every distinct non-completion evidence class stays in the vocabulary", () => {
  assert.deepEqual([...REVIEW_RESULT_EVIDENCE_CLASS_VALUES].sort(), [
    "changes_requested",
    "duplicate_result",
    "invalid_result",
    "malformed_result",
    "missing_result",
    "multiple_result",
    "ordinary_json_result",
    "oversized_result",
    "runtime_failure",
    "trailing_prose_result"
  ]);
});

test("runtime failure still outranks structured-result classification", () => {
  const built = buildReviewResultEvidence(
    buildInput({
      review_run: trustedReviewRun({
        terminal_status: "failed",
        runtime_failure_code: "review.runtime_failure"
      }),
      structured_role_result: invalidProjection([{ code: "malformed_json" }])
    })
  );

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "runtime_failure");
  assertValidates(built.evidence);
});

test("accepted/no-findings authority is unchanged: clean narrowed outcomes stay attestation-only", () => {
  for (const outcome of ["no_findings", "passed_no_blocking_or_medium_findings"]) {
    const built = buildReviewResultEvidence(
      buildInput({
        structured_role_result: narrowedProjection({
          claims: {
            reported_role: "reviewer",
            reported_subject: TARGET_SLICE_ADDRESS,
            reported_outcome: outcome
          },
          finding_counts: {
            total: 0,
            blocking: 0,
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0
          }
        })
      })
    );

    assert.equal(built.ok, false, outcome);
    assert.equal(
      built.decision_code,
      REVIEW_RESULT_EVIDENCE_DECISION_CODES.completionOutcome,
      outcome
    );
    assert.equal(built.creates_review_attestation, false);
    assert.equal(built.satisfies_mandatory_review, false);
  }
});

test("blocked/failed narrowed outcomes remain unsupported rather than becoming evidence", () => {
  for (const outcome of ["blocked", "failed"]) {
    const projection = narrowedProjection({
      claims: {
        reported_role: "reviewer",
        reported_subject: TARGET_SLICE_ADDRESS,
        reported_outcome: outcome
      }
    });
    delete projection.finding_counts;

    const built = buildReviewResultEvidence(buildInput({ structured_role_result: projection }));
    assert.equal(built.ok, false, outcome);
    assert.equal(
      built.decision_code,
      REVIEW_RESULT_EVIDENCE_DECISION_CODES.unsupportedOutcome,
      outcome
    );
  }
});

test("an arbitrary narrowed outcome is malformed, not a fallback classification", () => {
  const built = buildReviewResultEvidence(
    buildInput({
      structured_role_result: narrowedProjection({
        claims: {
          reported_role: "reviewer",
          reported_subject: TARGET_SLICE_ADDRESS,
          reported_outcome: "banana"
        }
      })
    })
  );

  assert.equal(built.ok, false);
  assert.equal(built.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.malformed);
});

test("narrowed changes_requested with zero findings is malformed, not silently accepted", () => {
  const built = buildReviewResultEvidence(
    buildInput({
      structured_role_result: narrowedProjection({
        finding_counts: {
          total: 0,
          blocking: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0
        }
      })
    })
  );

  assert.equal(built.ok, false);
  assert.equal(built.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.malformed);
});

test("narrowed claims must still agree with the trusted run role and subject", () => {
  const wrongSubject = buildReviewResultEvidence(
    buildInput({
      structured_role_result: narrowedProjection({
        claims: {
          reported_role: "reviewer",
          reported_subject: "WK-9999#SLICE-001",
          reported_outcome: "changes_requested"
        }
      })
    })
  );
  assert.equal(wrongSubject.ok, false);
  assert.equal(wrongSubject.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.wrongUnit);

  const wrongRole = buildReviewResultEvidence(
    buildInput({
      structured_role_result: narrowedProjection({
        claims: {
          reported_role: "redteam",
          reported_subject: TARGET_SLICE_ADDRESS,
          reported_outcome: "changes_requested"
        }
      })
    })
  );
  assert.equal(wrongRole.ok, false);
  assert.equal(wrongRole.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.wrongRole);
});

for (const roleClass of ["reviewer", "redteam"]) {
  test(`a present ${roleClass} projection with a missing_result diagnostic classifies as invalid_result`, () => {
    const built = buildReviewResultEvidence(
      buildInput({
        review_run: trustedReviewRun({ role_class: roleClass }),
        structured_role_result: invalidProjection([{ code: "missing_result" }])
      })
    );

    assert.equal(built.ok, true, JSON.stringify(built));
    assert.equal(built.evidence.evidence_class, "invalid_result");
    assert.notEqual(built.evidence.evidence_class, "missing_result");
    assert.equal(built.evidence.runtime_result.structured_result_status, "invalid");
    assert.notEqual(built.evidence.runtime_result.structured_result_status, "missing");
    assertValidates(built.evidence, roleClass);
  });

  test(`the same present ${roleClass} missing_result diagnostic IS missing_result under a trusted launcher missing-result kind`, () => {

    const built = buildReviewResultEvidence(
      buildInput({
        review_run: trustedReviewRun({ role_class: roleClass }),
        structured_role_result: invalidProjection([{ code: "missing_result" }], {
          structured_result_status: "missing"
        })
      })
    );

    assert.equal(built.ok, true, JSON.stringify(built));
    assert.equal(built.evidence.evidence_class, "missing_result");
    assert.equal(built.evidence.runtime_result.structured_result_status, "missing");
    assertValidates(built.evidence, roleClass);
  });
}

test("structural witness: no diagnostic-precedence tier may resolve to a missing status", () => {

  for (const tier of REVIEW_RESULT_STRUCTURED_STATUS_PRECEDENCE) {
    assert.notEqual(tier.status, "missing", `tier ${tier.status} must not resolve to missing`);
    assert.notEqual(tier.status, "absent", `tier ${tier.status} must not resolve to absent`);
    assert.equal(
      tier.codes.includes("missing_result"),
      false,
      `tier ${tier.status} must not claim the missing_result diagnostic`
    );
  }

  assert.equal(deriveStructuredResultStatusFromDiagnostics([{ code: "missing_result" }]), "invalid");
  assert.equal(
    deriveStructuredResultStatusFromDiagnostics([
      { code: "missing_result" },
      { code: "malformed_json" }
    ]),
    "malformed"
  );
});

test("a stated complete count below the supplied diagnostics fails closed rather than being repaired", () => {
  const diagnostics = Array.from({ length: 24 }, (_entry, index) => ({
    code: index === 21 ? "duplicate_json_key" : "unknown_field"
  }));

  const built = buildReviewResultEvidence(
    buildInput({ structured_role_result: invalidProjection(diagnostics, { diagnostic_count: 22 }) })
  );

  assert.equal(built.ok, false);
  assert.equal(built.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.malformed);
});

const UNUSABLE_STATED_COUNTS = [
  { label: "negative", value: -1 },
  { label: "fractional", value: 3.5 },
  { label: "a string", value: "12" },
  { label: "NaN", value: Number.NaN },
  { label: "Infinity", value: Number.POSITIVE_INFINITY }
];

for (const { label, value } of UNUSABLE_STATED_COUNTS) {
  test(`a ${label} stated diagnostic count fails closed`, () => {
    const built = buildReviewResultEvidence(
      buildInput({
        structured_role_result: invalidProjection([{ code: "malformed_json" }], {
          diagnostic_count: value
        })
      })
    );

    assert.equal(built.ok, false, label);
    assert.equal(built.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.malformed, label);
  });
}

function legacyFinding(id, severity, blocking) {
  return {
    id,
    title: `${severity} finding ${id}`,
    severity,
    blocking,
    affected_paths: [{ path: "packages/wiki-core/src/lib/work-record-review-results.mjs", line: 1 }]
  };
}

function fullProjection(overrides = {}) {
  return {
    valid: true,
    result: {
      reported_role: "reviewer",
      reported_subject: TARGET_SLICE_ADDRESS,
      reported_outcome: "changes_requested",
      summary: "three findings",
      findings: [
        legacyFinding("F-1", "high", true),
        legacyFinding("F-2", "medium", false),
        legacyFinding("F-3", "low", false)
      ],
      finding_counts: { ...CHANGES_REQUESTED_COUNTS },
      reviewed_controls: [{ control_id: "write_scope_total_loc", result: "fail" }],
      ...overrides
    }
  };
}

test("a valid legacy full result still cross-checks its findings and records changes_requested", () => {
  const built = buildReviewResultEvidence(buildInput({ structured_role_result: fullProjection() }));

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "changes_requested");
  assert.equal(built.evidence.role_result.findings.length, 3);
  assert.deepEqual(built.evidence.role_result.finding_counts, CHANGES_REQUESTED_COUNTS);
  assert.equal(built.evidence.role_result.reviewed_controls.length, 1);
  assertValidates(built.evidence);
});

test("a legacy full result whose counts disagree with its findings still fails closed", () => {
  const built = buildReviewResultEvidence(
    buildInput({
      structured_role_result: fullProjection({
        finding_counts: { total: 3, blocking: 3, critical: 0, high: 1, medium: 1, low: 1, info: 0 }
      })
    })
  );

  assert.equal(built.ok, false);
  assert.equal(built.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.malformed);
});

const MALFORMED_LEGACY_FINDINGS = [
  { label: "null", value: null },
  { label: "a string", value: "not-an-array" },
  { label: "an object", value: {} },
  { label: "a number", value: 7 }
];

for (const { label, value } of MALFORMED_LEGACY_FINDINGS) {
  test(`a legacy full result whose findings is ${label} is malformed, not downgraded to narrowed evidence`, () => {
    const built = buildReviewResultEvidence(
      buildInput({ structured_role_result: fullProjection({ findings: value }) })
    );

    assert.equal(built.ok, false, label);
    assert.equal(built.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.malformed, label);
  });
}

const MALFORMED_LEGACY_RESULTS = [
  { label: "null", value: null },
  { label: "a string", value: "not-an-object" },
  { label: "a number", value: 7 },
  { label: "an array", value: [] }
];

for (const { label, value } of MALFORMED_LEGACY_RESULTS) {
  test(`a present non-object legacy result (${label}) is malformed, not a narrowed projection`, () => {
    const built = buildReviewResultEvidence(
      buildInput({
        structured_role_result: {
          valid: true,
          result: value,
          claims: {
            reported_role: "reviewer",
            reported_subject: TARGET_SLICE_ADDRESS,
            reported_outcome: "changes_requested"
          },
          finding_counts: { ...CHANGES_REQUESTED_COUNTS }
        }
      })
    );

    assert.equal(built.ok, false, label);
    assert.equal(built.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.malformed, label);
  });
}

test("a genuinely absent legacy result still takes the narrowed path", () => {
  const projection = narrowedProjection();
  assert.equal(Object.hasOwn(projection, "result"), false);

  const built = buildReviewResultEvidence(buildInput({ structured_role_result: projection }));
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "changes_requested");
  assert.equal(Object.hasOwn(built.evidence.role_result, "findings"), false);
});

test("a result object that carries no findings field at all is still narrowed evidence", () => {

  const built = buildReviewResultEvidence(
    buildInput({
      structured_role_result: {
        valid: true,
        result: {
          reported_role: "reviewer",
          reported_subject: TARGET_SLICE_ADDRESS,
          reported_outcome: "changes_requested",
          finding_counts: { ...CHANGES_REQUESTED_COUNTS }
        }
      }
    })
  );

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.evidence.evidence_class, "changes_requested");
  assert.deepEqual(built.evidence.role_result.finding_counts, CHANGES_REQUESTED_COUNTS);
  assert.equal(Object.hasOwn(built.evidence.role_result, "findings"), false);
  assertValidates(built.evidence);
});

test("stored narrowed changes_requested evidence fails validation if its digest is edited", () => {
  const built = buildReviewResultEvidence(
    buildInput({ structured_role_result: narrowedProjection() })
  );
  assert.equal(built.ok, true, JSON.stringify(built));

  const tampered = JSON.parse(JSON.stringify(built.evidence));
  tampered.role_result.reviewed_control_count = 99;
  const validation = validateReviewResultEvidence(tampered, {
    repo: REPO,
    unit_address: TARGET_SLICE_ADDRESS,
    source_digest: SOURCE_DIGEST,
    required_role_class: "reviewer"
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.decision_code, REVIEW_RESULT_EVIDENCE_DECISION_CODES.malformed);
});
