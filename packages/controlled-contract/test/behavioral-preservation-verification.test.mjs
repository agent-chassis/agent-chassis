

import assert from "node:assert/strict";
import test from "node:test";

import {
  BEHAVIORAL_PRESERVATION_PROFILE_ID,
  BEHAVIORAL_PRESERVATION_PROFILE_VERSION,
  BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_SIDES,
  BEHAVIORAL_PRESERVATION_VERIFICATION_REFUSAL_CODES as CODES,
  BEHAVIORAL_PRESERVATION_VERIFICATION_SCHEMA_VERSION,
  verifyBehavioralPreservationReports
} from "../lib/behavioral-preservation-verification.mjs";

function observable(id, type = "return_value", value = "passed") {
  return { observable_id: id, observable_type: type, canonical_value: value };
}

function report({ observables = [observable("result"), observable("exit", "exit_code", "0")],
  selected = "result", count = observables.length } = {}) {
  return {
    schema_version: BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION,
    observables,
    observable_count: count,
    selected_observable_id: selected
  };
}

function pair(overrides = {}) {
  return { baseline: report(), candidate: report(), ...overrides };
}

const REFUSAL_OUTPUT_FIELDS = ["preserved", "source", "members", "differences"];

function assertRefusal(result, code) {
  assert.equal(result.verified, false);
  assert.equal(result.refusal.code, code);
  assert.equal(typeof result.refusal.reason, "string");
  for (const field of REFUSAL_OUTPUT_FIELDS) assert.equal(result[field], null, field);
  assert.equal(Object.isFrozen(result), true);
}

test("the verification binds to one admitted pack and one report family by name", () => {
  assert.equal(BEHAVIORAL_PRESERVATION_PROFILE_ID, "proof.compatibility.behavioral-preservation");
  assert.equal(BEHAVIORAL_PRESERVATION_PROFILE_VERSION, "4.0.0");
  assert.deepEqual([...BEHAVIORAL_PRESERVATION_SIDES], ["baseline", "candidate"]);
  assert.equal(Object.isFrozen(CODES), true);
  assert.equal(new Set(Object.values(CODES)).size, Object.keys(CODES).length);
  for (const code of Object.values(CODES)) {
    assert.match(code, /^controlled_contract\.behavioral_preservation_verification\.[a-z_]+\.v1$/u);
  }
});

test("equal complete populations, counts, and selected canonical values verify as preserved", () => {
  const input = pair();
  const before = JSON.stringify(input);
  const result = verifyBehavioralPreservationReports(input);
  assert.equal(result.schema_version, BEHAVIORAL_PRESERVATION_VERIFICATION_SCHEMA_VERSION);
  assert.equal(result.verified, true);
  assert.equal(result.preserved, true);
  assert.equal(result.refusal, null);
  assert.equal(result.report_schema_version, BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION);
  assert.deepEqual(result.source.sides.map(({ position }) => position), ["baseline", "candidate"]);
  for (const side of result.source.sides) {
    assert.equal(side.observable_count, 2);
    assert.equal(side.selected_observable_id, "result");
    assert.equal(side.selected_canonical_value, "passed");
  }
  assert.deepEqual(result.members.baseline, result.members.candidate);
  assert.deepEqual(result.members.baseline.map(({ observable_id: id }) => id), ["result", "exit"]);
  assert.deepEqual(result.differences, {
    baseline_population_not_subset: false, candidate_population_not_subset: false,
    only_in_baseline: [], only_in_candidate: [], count_mismatch: false,
    selection_mismatch: false, canonical_value_mismatch: false
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.differences), true);

  assert.equal(JSON.stringify(input), before);
});

test("population order never matters and every difference is named exactly", () => {
  const reordered = verifyBehavioralPreservationReports(pair({
    candidate: report({ observables: [observable("exit", "exit_code", "0"), observable("result")] })
  }));
  assert.equal(reordered.preserved, true);

  const changedValue = verifyBehavioralPreservationReports(pair({
    candidate: report({ observables: [observable("result", "return_value", "failed"),
      observable("exit", "exit_code", "0")] })
  }));
  assert.equal(changedValue.verified, true);
  assert.equal(changedValue.preserved, false);
  assert.equal(changedValue.differences.canonical_value_mismatch, true);
  assert.equal(changedValue.differences.count_mismatch, false);

  const widened = verifyBehavioralPreservationReports(pair({
    candidate: report({ observables: [observable("result"), observable("exit", "exit_code", "0"),
      observable("extra", "log_line", "x")] })
  }));
  assert.equal(widened.preserved, false);
  assert.deepEqual(widened.differences.only_in_candidate,
    [{ observable_id: "extra", observable_type: "log_line" }]);
  assert.equal(widened.differences.candidate_population_not_subset, true);
  assert.equal(widened.differences.baseline_population_not_subset, false);
  assert.equal(widened.differences.count_mismatch, true);

  const retyped = verifyBehavioralPreservationReports(pair({
    candidate: report({ observables: [observable("result", "exit_code"),
      observable("exit", "exit_code", "0")] })
  }));
  assert.deepEqual(retyped.differences.only_in_baseline,
    [{ observable_id: "result", observable_type: "return_value" }]);
  assert.deepEqual(retyped.differences.only_in_candidate,
    [{ observable_id: "result", observable_type: "exit_code" }]);

  const reselected = verifyBehavioralPreservationReports(pair({
    candidate: report({ selected: "exit" })
  }));
  assert.equal(reselected.preserved, false);
  assert.equal(reselected.differences.selection_mismatch, true);
  assert.equal(reselected.differences.canonical_value_mismatch, true);
});

test("missing and malformed input is refused without partial output", () => {
  for (const input of [undefined, null]) {
    assertRefusal(verifyBehavioralPreservationReports(input), CODES.MISSING_REQUIRED_INPUT);
  }
  for (const input of ["pair", 7, [report(), report()]]) {
    assertRefusal(verifyBehavioralPreservationReports(input), CODES.MALFORMED_INPUT);
  }
  const oneSided = verifyBehavioralPreservationReports({ baseline: report() });
  assertRefusal(oneSided, CODES.MALFORMED_INPUT);
  assert.equal(oneSided.refusal.detail.missing_field, "candidate");
  const overBound = verifyBehavioralPreservationReports({ ...pair(), receipt: {} });
  assertRefusal(overBound, CODES.MALFORMED_INPUT);
  assert.equal(overBound.refusal.detail.unexpected_field, "receipt");
});

test("a report outside the accepted family or field set is refused per side", () => {
  const foreign = verifyBehavioralPreservationReports(pair({
    candidate: { ...report(), schema_version: "some-other-report.v1" }
  }));
  assertRefusal(foreign, CODES.MALFORMED_REPORT);
  assert.deepEqual(foreign.refusal.detail, { position: "candidate",
    supplied: "some-other-report.v1",
    expected: BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION });
  for (const [label, mutate] of [
    ["not an object", (side) => "report"],
    ["extra field", (side) => ({ ...side, capture_root: "/tmp" })],
    ["missing selection", (side) => { const copy = { ...side }; delete copy.selected_observable_id; return copy; }],
    ["observables not an array", (side) => ({ ...side, observables: {} })],
    ["observable missing a field", (side) => ({ ...side,
      observables: [{ observable_id: "result", observable_type: "return_value" }] })],
    ["observable with a NUL identity", (side) => ({ ...side,
      observables: [observable("res\0ult")] })],
    ["empty selection", (side) => ({ ...side, selected_observable_id: "" })]
  ]) {
    const result = verifyBehavioralPreservationReports(pair({ baseline: mutate(report()) }));
    assertRefusal(result, CODES.MALFORMED_REPORT);
    assert.equal(result.refusal.detail.position, "baseline", label);
  }
});

test("a report whose own count or population is inconsistent is refused, never repaired", () => {
  const miscounted = verifyBehavioralPreservationReports(pair({
    baseline: report({ count: 3 })
  }));
  assertRefusal(miscounted, CODES.REPORT_POPULATION_INCONSISTENT);
  assert.deepEqual(miscounted.refusal.detail, { position: "baseline", declared: 3, actual: 2 });
  for (const count of [-1, 1.5, "2"]) {
    assertRefusal(verifyBehavioralPreservationReports(pair({ baseline: report({ count }) })),
      CODES.REPORT_POPULATION_INCONSISTENT);
  }
  const duplicated = verifyBehavioralPreservationReports(pair({
    candidate: report({ observables: [observable("result"), observable("result", "return_value", "other")] })
  }));
  assertRefusal(duplicated, CODES.REPORT_POPULATION_INCONSISTENT);
  assert.equal(duplicated.refusal.detail.observable_id, "result");
});

test("the canonical selection must resolve to exactly one observable on each side", () => {
  const unresolved = verifyBehavioralPreservationReports(pair({
    candidate: report({ selected: "absent" })
  }));
  assertRefusal(unresolved, CODES.CANONICAL_SELECTION_UNRESOLVED);
  assert.deepEqual(unresolved.refusal.detail,
    { position: "candidate", selected_observable_id: "absent" });

  const ambiguous = verifyBehavioralPreservationReports(pair({
    baseline: report({ observables: [observable("result"), observable("result", "exit_code", "0")] })
  }));
  assertRefusal(ambiguous, CODES.CANONICAL_SELECTION_AMBIGUOUS);
  assert.equal(ambiguous.refusal.detail.match_count, 2);
});

test("verification is deterministic and identical across repeated calls", () => {
  const first = verifyBehavioralPreservationReports(pair());
  const second = verifyBehavioralPreservationReports(pair());
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
});
