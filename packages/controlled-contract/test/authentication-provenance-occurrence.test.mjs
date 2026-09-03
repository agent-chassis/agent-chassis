import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAuthenticationProvenanceOccurrenceCapture,
  deriveAuthenticationProvenanceOccurrenceCapture
} from "../lib/authentication-provenance-occurrence-projection.mjs";
import { executeDeterministicProjection } from "../lib/deterministic-projection.mjs";
import { canonicalJsonBytes } from "../lib/exact-binding-common.mjs";
import { buildAuthenticationProvenanceSources } from
  "./proof-packs/authentication-provenance-v1-fixture.mjs";

const orderedInput = (input) => [
  input.evidenceContentBytes,
  input.targetResolutionWitnessBytes,
  input.sourceAuthenticationWitnessBytes,
  input.sourceOfRecordAssignmentWitnessBytes,
  input.attemptBindingWitnessBytes,
  input.authenticationWitnessBytes
];

test("typed occurrence capture derives one exact E/T/S/A from six closed sources", () => {
  const fixture = buildAuthenticationProvenanceSources();
  const value = assertAuthenticationProvenanceOccurrenceCapture(
    JSON.parse(fixture.resultBytes)
  );
  assert.equal(value.roles.evidence_occurrence.raw_reference_id,
    fixture.roles.evidenceOccurrence.reference_id);
  assert.equal(value.roles.target.raw_reference_id, fixture.roles.target.reference_id);
  assert.equal(value.roles.source.raw_reference_id, fixture.roles.source.reference_id);
  assert.equal(value.roles.observation_attempt.raw_reference_id,
    fixture.roles.attempt.reference_id);
  assert.equal(value.exact_normalized_applicability.mode, "during");
  assert.equal(value.acquisition_kind, "direct");
  assert.deepEqual(executeDeterministicProjection(
    "authentication-provenance-occurrence-capture.v1", orderedInput(fixture.input)
  ), fixture.resultBytes);
});

test("allowed source and attempt types, Unicode identities, and verification methods survive", () => {
  for (const [sourceType, attemptType, methods] of [
    ["cc:actor", "cc:event", ["authenticated_record_key", "authenticated_channel",
      "authenticated_catalog_assignment", "authenticated_channel_validation"]],
    ["cc:entity", "cc:process", ["signed_target_digest", "authenticated_store_read",
      "transactional_store_assignment", "trusted_store_validation"]],
    ["cc:runtime_component", "cc:event", ["verified_manifest_entry", "verified_signature",
      "signed_registry_assignment", "signature_validation"]]
  ]) {
    const fixture = buildAuthenticationProvenanceSources({
      sourceType,
      attemptType,
      targetResolutionMethod: methods[0],
      sourceAuthenticationMethod: methods[1],
      sourceOfRecordMethod: methods[2],
      authenticationMethod: methods[3],
      unicode: true
    });
    assert.equal(JSON.parse(fixture.resultBytes).roles.source.type_term, sourceType);
    assert.equal(JSON.parse(fixture.resultBytes).roles.observation_attempt.type_term,
      attemptType);
  }
});

test("equal bytes in genuinely distinct witnessed occurrences remain distinct", () => {
  const first = buildAuthenticationProvenanceSources({ occurrenceSuffix: "one" });
  const second = buildAuthenticationProvenanceSources({ occurrenceSuffix: "two" });
  const left = JSON.parse(first.resultBytes);
  const right = JSON.parse(second.resultBytes);
  assert.equal(left.evidence_content_sha256, right.evidence_content_sha256);
  assert.notEqual(left.roles.evidence_occurrence.grounded_identity_sha256,
    right.roles.evidence_occurrence.grounded_identity_sha256);
  assert.notEqual(left.roles.observation_attempt.grounded_identity_sha256,
    right.roles.observation_attempt.grounded_identity_sha256);
});

test("role, source, attempt, content, and coordinated-digest splices fail closed", () => {
  const attacks = [
    (witnesses) => { witnesses.sourceOfRecord.target.reference_id = "ref-wrong-target"; },
    (witnesses) => { witnesses.sourceOfRecord.source.reference_id = "ref-wrong-source"; },
    (witnesses) => { witnesses.sourceOfRecord.attempt.reference_id = "ref-wrong-attempt"; },
    (witnesses) => { witnesses.attemptBinding.evidence_content_sha256 = "0".repeat(64); }
  ];
  for (const mutateWitnesses of attacks) assert.throws(
    () => buildAuthenticationProvenanceSources({ mutateWitnesses }),
    (error) => /mismatch|splice/u.test(error.code)
  );
  assert.throws(() => buildAuthenticationProvenanceSources({
    recomputeAuthentication: false
  }), (error) => error.code === "authentication_witness_binding_mismatch");
});

test("self-authored keys cannot claim an unrelated grounded provenance source", () => {
  assert.throws(
    () => buildAuthenticationProvenanceSources({ dishonestSourceGrounding: true }),
    (error) => error.code === "occurrence_capture_source_authority_mismatch"
  );
});

test("derived evidence and noncanonical witness bytes cannot enter the direct-source capture", () => {
  assert.throws(() => buildAuthenticationProvenanceSources({ acquisitionKind: "derived" }),
    (error) => error.code === "derived_evidence_refused_by_direct_source_capture");
  const fixture = buildAuthenticationProvenanceSources();
  const noncanonical = {
    ...fixture.input,
    targetResolutionWitnessBytes: Buffer.from(
      JSON.stringify(fixture.witnesses.targetResolution, null, 2), "utf8"
    )
  };
  assert.throws(() => deriveAuthenticationProvenanceOccurrenceCapture(noncanonical),
    (error) => error.code === "projection_input_noncanonical");
});

test("capture is byte deterministic and does not mutate caller inputs", () => {
  const fixture = buildAuthenticationProvenanceSources();
  const before = orderedInput(fixture.input).map((bytes) => Buffer.from(bytes));
  const outputs = Array.from({ length: 20 }, () =>
    deriveAuthenticationProvenanceOccurrenceCapture(fixture.input));
  for (const output of outputs) assert.deepEqual(output, fixture.resultBytes);
  orderedInput(fixture.input).forEach((bytes, index) => assert.deepEqual(bytes, before[index]));
  assert.deepEqual(fixture.resultBytes,
    canonicalJsonBytes(JSON.parse(fixture.resultBytes), { file: true }));
});
