

import assert from "node:assert/strict";
import test from "node:test";

import {
  DECLARED_BOUNDARY_NOT_ESTABLISHED,
  DECLARED_BOUNDARY_OBSERVATION_PROVENANCE,
  DECLARED_BOUNDARY_PROFILE_ID,
  DECLARED_BOUNDARY_PROFILE_VERSION,
  DECLARED_BOUNDARY_VERIFICATION_REFUSAL_CODES as CODES,
  DECLARED_BOUNDARY_VERIFICATION_SCHEMA_VERSION,
  canonicalDeclaredBoundaryReportJson,
  verifyDeclaredBoundaryRecordConsistency
} from "../lib/declared-boundary-verification.mjs";
import { canonicalJsonBytes } from "../lib/deterministic-projection-primitives.mjs";
import { buildBoundaryFixture } from "./proof-packs/bounded-policy-v1-fixture.mjs";

const base = buildBoundaryFixture();
const bytesOf = (document) => canonicalJsonBytes(document, { file: true });

function withPolicy(mutate) {
  const document = structuredClone(base.policy);
  mutate(document);
  return document;
}
function withObservation(mutate) {
  const document = structuredClone(base.observation);
  mutate(document);
  return document;
}
function withSubjects(mutate) {
  const document = structuredClone(base.subjects);
  mutate(document);
  return document;
}

function input(overrides = {}) {
  return { policy: base.policy, observation: base.observation, subjects: base.subjects,
    ...overrides };
}

function assertRefusal(result, code) {
  assert.equal(result.verified, false);
  assert.equal(result.refusal.code, code, result.refusal.reason);
  assert.equal(typeof result.refusal.reason, "string");
  for (const field of ["source", "report", "census"]) assert.equal(result[field], null, field);
  assert.equal(result.schema_version, DECLARED_BOUNDARY_VERIFICATION_SCHEMA_VERSION);
  assert.equal(result.profile_id, DECLARED_BOUNDARY_PROFILE_ID);
  assert.equal(result.profile_version, DECLARED_BOUNDARY_PROFILE_VERSION);
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => canonicalDeclaredBoundaryReportJson(result), TypeError);
  return result.refusal;
}

test("the verification names its pack, its one provenance, and what it never establishes", () => {
  assert.equal(DECLARED_BOUNDARY_PROFILE_ID, "proof.policy.declared-boundary-record-consistency");
  assert.equal(DECLARED_BOUNDARY_PROFILE_VERSION, "4.0.0");
  assert.equal(DECLARED_BOUNDARY_OBSERVATION_PROVENANCE, "caller_asserted");
  assert.deepEqual([...DECLARED_BOUNDARY_NOT_ESTABLISHED], [
    "execution-provenance", "policy-to-production-correspondence",
    "production-truth", "runtime-enforcement"
  ]);
  assert.equal(new Set(Object.values(CODES)).size, Object.keys(CODES).length);
  for (const code of Object.values(CODES)) {
    assert.match(code, /^controlled_contract\.declared_boundary_verification\.[a-z_]+\.v1$/u);
  }
});

test("a consistent record verifies from document objects and from canonical bytes alike", () => {
  const fromObjects = verifyDeclaredBoundaryRecordConsistency(input());
  assert.equal(fromObjects.verified, true, JSON.stringify(fromObjects.refusal));
  assert.equal(fromObjects.refusal, null);
  const fromBytes = verifyDeclaredBoundaryRecordConsistency({
    policy: base.policyBytes, observation: base.observationBytes, subjects: base.subjectsBytes
  });
  assert.deepEqual(fromBytes, fromObjects);

  assert.deepEqual(canonicalDeclaredBoundaryReportJson(fromObjects), base.reportBytes);
  assert.equal(fromObjects.source.observation_provenance, DECLARED_BOUNDARY_OBSERVATION_PROVENANCE);
  assert.match(fromObjects.source.source_set_sha256, /^[a-f0-9]{64}$/u);
  assert.match(fromObjects.source.report_bytes_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(fromObjects.source.declared_limit_count, fromObjects.report.limits.length);
  assert.equal(fromObjects.source.boundary_case_count, fromObjects.report.cases.length);
  assert.equal(fromObjects.census.authority, "caller_declaration_only");
  assert.deepEqual(fromObjects.census.not_established, [...DECLARED_BOUNDARY_NOT_ESTABLISHED]);
  assert.equal(fromObjects.census.boundary_case_count, fromObjects.report.cases.length);
  assert.equal(fromObjects.census.limits.length, fromObjects.report.limits.length);
  assert.equal(Object.isFrozen(fromObjects), true);
  assert.equal(Object.isFrozen(fromObjects.census), true);
});

test("the projected census carries the complete N-1/N/N+1 positions of every nonzero limit", () => {
  const result = verifyDeclaredBoundaryRecordConsistency(input());
  for (const limit of result.census.limits) {
    assert.equal(limit.zero_maximum, limit.limit_value === 0, limit.limit_key);
    const positions = limit.boundary_positions;
    assert.deepEqual(positions, [...positions].sort(), limit.limit_key);
    assert.equal(limit.cases.length, positions.length, limit.limit_key);
    if (!limit.zero_maximum) assert.ok(positions.length >= 3, limit.limit_key);
    for (const entry of limit.cases) {
      assert.equal(typeof entry.case_id, "string");
      assert.equal(typeof entry.subject_id, "string");
      assert.equal(typeof entry.observed_disposition, "string");
    }
  }
  const total = result.census.limits.reduce((sum, limit) => sum + limit.cases.length, 0);
  assert.equal(total, result.census.boundary_case_count);
});

test("missing and malformed input is refused before any document is read", () => {
  for (const value of [undefined, null]) {
    assertRefusal(verifyDeclaredBoundaryRecordConsistency(value), CODES.MISSING_REQUIRED_INPUT);
  }
  for (const value of ["record", 7, [base.policy, base.observation, base.subjects]]) {
    assertRefusal(verifyDeclaredBoundaryRecordConsistency(value), CODES.MALFORMED_INPUT);
  }
  const partial = assertRefusal(verifyDeclaredBoundaryRecordConsistency({
    policy: base.policy, observation: base.observation
  }), CODES.MALFORMED_INPUT);
  assert.equal(partial.detail.missing_field, "subjects");
  const overBound = assertRefusal(verifyDeclaredBoundaryRecordConsistency(
    input({ report: base.reportBytes })), CODES.MALFORMED_INPUT);
  assert.equal(overBound.detail.unexpected_field, "report");
});

test("each document slot resolves to exactly its own canonical document or refuses", () => {
  const shape = assertRefusal(verifyDeclaredBoundaryRecordConsistency(input({ policy: 7 })),
    CODES.POLICY_DOCUMENT_UNRESOLVED);
  assert.equal(shape.detail.defect, "slot_shape");
  const empty = assertRefusal(verifyDeclaredBoundaryRecordConsistency(
    input({ observation: new Uint8Array(0) })), CODES.OBSERVATION_DOCUMENT_UNRESOLVED);
  assert.equal(empty.detail.defect, "bytes_unresolved");
  const noncanonical = assertRefusal(verifyDeclaredBoundaryRecordConsistency(
    input({ subjects: Buffer.from(`${JSON.stringify(base.subjects, null, 2)}\n`) })),
  CODES.SUBJECTS_DOCUMENT_UNRESOLVED);
  assert.equal(noncanonical.detail.defect, "not_canonical_document");

  const swapped = assertRefusal(verifyDeclaredBoundaryRecordConsistency(
    input({ subjects: base.policy })), CODES.SUBJECTS_DOCUMENT_UNRESOLVED);
  assert.equal(swapped.detail.defect, "role_mismatch");
  assert.equal(swapped.detail.supplied, base.policy.schema_version);
});

test("policy, subject, and observation defects refuse under their own discriminating codes", () => {
  const unit = assertRefusal(verifyDeclaredBoundaryRecordConsistency(input({
    policy: withPolicy((document) => { document.limits[0].unit = "furlongs"; })
  })), CODES.MEASUREMENT_UNIT_UNSUPPORTED);
  assert.equal(unit.detail.supplied, "furlongs");
  assert.ok(Array.isArray(unit.detail.supported));
  const unitClass = assertRefusal(verifyDeclaredBoundaryRecordConsistency(input({
    policy: withPolicy((document) => { document.limits[0].measurement_class = "invented"; })
  })), CODES.MEASUREMENT_UNIT_UNSUPPORTED);
  assert.equal(unitClass.detail.supplied, "invented");
  const duplicate = assertRefusal(verifyDeclaredBoundaryRecordConsistency(input({
    subjects: withSubjects((document) => {
      document.subjects.push(structuredClone(document.subjects[0]));
    })
  })), CODES.SUBJECT_IDENTITY_DUPLICATE);
  assert.equal(duplicate.detail.subject_id, base.subjects.subjects[0].subject_id);
  assertRefusal(verifyDeclaredBoundaryRecordConsistency(input({
    observation: withObservation((document) => {
      document.provenance = "captured_execution_transcript";
    })
  })), CODES.OBSERVATION_PROVENANCE_UNSUPPORTED);
  assertRefusal(verifyDeclaredBoundaryRecordConsistency(input({
    observation: withObservation((document) => { document.cases.pop(); })
  })), CODES.BOUNDARY_CENSUS_INCOMPLETE);

  const arithmetic = verifyDeclaredBoundaryRecordConsistency(input({
    subjects: withSubjects((document) => {
      const subject = document.subjects.find(({ subject_id: id }) =>
        id === base.observation.cases[0].subject_id);
      subject.content_base64 = Buffer.from(
        `${Buffer.from(subject.content_base64, "base64").toString("utf8")}extra`, "utf8"
      ).toString("base64");
    })
  }));
  assert.equal(arithmetic.verified, false);
  assert.ok([CODES.BOUNDARY_ARITHMETIC_MISMATCH, CODES.BOUNDARY_DISPOSITION_MISMATCH,
    CODES.BOUNDARY_CENSUS_INCOMPLETE, CODES.SUBJECT_POPULATION_INCOMPLETE,
    CODES.BOUNDARY_CENSUS_DUPLICATE].includes(arithmetic.refusal.code),
  arithmetic.refusal.code);
});

test("verification is pure, deterministic, and never mutates its input", () => {
  const value = input({ policy: structuredClone(base.policy),
    observation: structuredClone(base.observation), subjects: structuredClone(base.subjects) });
  const before = JSON.stringify(value);
  const first = verifyDeclaredBoundaryRecordConsistency(value);
  const second = verifyDeclaredBoundaryRecordConsistency(value);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(JSON.stringify(value), before);
});
