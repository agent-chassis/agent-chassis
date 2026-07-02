

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeNormalizedRequestOutputHash,
  resolveDerivedEvidenceGeneratedAt,
  systemUtcClock,
  DerivedEvidenceContractError,
  NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER
} from "./work-record-admission-derived-evidence-time.mjs";

const VALID_ISO = "2026-05-19T00:00:00Z";

test("resolveDerivedEvidenceGeneratedAt accepts a parseable ISO timestamp verbatim", () => {
  assert.equal(resolveDerivedEvidenceGeneratedAt(VALID_ISO), VALID_ISO);
});

test("resolveDerivedEvidenceGeneratedAt accepts a valid Date and an injected clock", () => {
  assert.equal(
    resolveDerivedEvidenceGeneratedAt(new Date("2026-05-19T00:00:00.000Z")),
    "2026-05-19T00:00:00.000Z"
  );
  assert.equal(resolveDerivedEvidenceGeneratedAt(undefined, { clock: () => VALID_ISO }), VALID_ISO);
  assert.match(resolveDerivedEvidenceGeneratedAt(undefined, { clock: systemUtcClock }), /^\d{4}-.*Z$/);
});

test("resolveDerivedEvidenceGeneratedAt rejects a non-empty string that is not a date", () => {
  for (const bad of ["not-a-date", "definitely not a timestamp", "2026-13-99T99:99:99Z"]) {
    assert.throws(
      () => resolveDerivedEvidenceGeneratedAt(bad),
      (error) =>
        error instanceof DerivedEvidenceContractError && error.code === "generated_at_invalid",
      `expected generated_at_invalid for ${JSON.stringify(bad)}`
    );
  }
});

test("resolveDerivedEvidenceGeneratedAt rejects an empty/whitespace string", () => {
  for (const bad of ["", "   "]) {
    assert.throws(
      () => resolveDerivedEvidenceGeneratedAt(bad),
      (error) =>
        error instanceof DerivedEvidenceContractError && error.code === "generated_at_invalid"
    );
  }
});

test("resolveDerivedEvidenceGeneratedAt rejects a clock that returns a non-date string", () => {
  for (const badClock of [() => "not-a-date", () => "nope", () => "2026-13-99"]) {
    assert.throws(
      () => resolveDerivedEvidenceGeneratedAt(undefined, { clock: badClock }),
      (error) =>
        error instanceof DerivedEvidenceContractError && error.code === "generated_at_clock_invalid",
      "expected generated_at_clock_invalid for a clock returning a non-date string"
    );
  }
});

test("resolveDerivedEvidenceGeneratedAt rejects a clock that returns an empty string", () => {
  assert.throws(
    () => resolveDerivedEvidenceGeneratedAt(undefined, { clock: () => "" }),
    (error) =>
      error instanceof DerivedEvidenceContractError && error.code === "generated_at_clock_invalid"
  );
});

test("resolveDerivedEvidenceGeneratedAt requires a timestamp or clock when none is supplied", () => {
  assert.throws(
    () => resolveDerivedEvidenceGeneratedAt(undefined),
    (error) => error instanceof DerivedEvidenceContractError && error.code === "generated_at_required"
  );
  assert.throws(
    () => resolveDerivedEvidenceGeneratedAt(null),
    (error) => error instanceof DerivedEvidenceContractError && error.code === "generated_at_required"
  );
});

test("computeNormalizedRequestOutputHash rejects non-object input with a stable contract error", () => {
  for (const bad of [null, undefined, "x", 7, true, [1, 2, 3]]) {
    assert.throws(
      () => computeNormalizedRequestOutputHash(bad),
      (error) =>
        error instanceof DerivedEvidenceContractError &&
        error.code === "normalized_request_output_hash_input_not_object"
    );
  }
});

test("computeNormalizedRequestOutputHash digests a well-formed normalized request deterministically", () => {
  const body = { artifact_refs: [], preparation_audit_refs: [] };
  const first = computeNormalizedRequestOutputHash(body);
  assert.match(first, /^sha256:[0-9a-f]{64}$/);
  assert.equal(computeNormalizedRequestOutputHash({ ...body }), first);
  assert.notEqual(NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER, first);
});
