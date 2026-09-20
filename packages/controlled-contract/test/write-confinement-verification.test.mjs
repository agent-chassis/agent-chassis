

import assert from "node:assert/strict";
import test from "node:test";

import {
  WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
  WRITE_CONFINEMENT_PROFILE_ID,
  WRITE_CONFINEMENT_PROFILE_VERSION,
  WRITE_CONFINEMENT_VERIFICATION_REFUSAL_CODES as CODES,
  WRITE_CONFINEMENT_VERIFICATION_SCHEMA_VERSION,
  verifyWriteConfinementEvidence,
  verifyWriteConfinementProjection
} from "../lib/write-confinement-verification.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

function evidence(overrides = {}) {
  return {
    schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
    authority: "authenticated_observation_only",
    observation_boundary: "base_to_delivery_tree_delta",
    not_covered: ["causal_attribution", "prevention", "rollback"],
    repository: "agent-chassis/agent-chassis",
    run_id: "run-confinement",
    attempt: 1,
    record_id: "WK-2519",
    unit_address: "WK-2519#SLICE-001",
    selected_unit: "WK-2519#SLICE-001",
    frozen_write_scope: ["packages/controlled-contract/lib/", "packages/controlled-contract/test/"],
    base_commit: "a".repeat(40),
    delivery_commit: "b".repeat(40),
    delivery_tree: "c".repeat(40),
    contained: true,
    changed_paths: ["packages/controlled-contract/lib/one.mjs",
      "packages/controlled-contract/test/one.test.mjs"],
    outside_write_scope_paths: [],
    inside_write_scope_paths: ["packages/controlled-contract/lib/one.mjs",
      "packages/controlled-contract/test/one.test.mjs"],
    changed_path_count: 2,
    outside_write_scope_path_count: 0,
    inside_write_scope_path_count: 2,
    populations_complete: true,
    source_digest: digest("1"),
    result_digest: digest("2"),
    observed_at: "2026-09-06T00:00:00.000Z",
    admission_effect: "none",
    review_effect: "none",
    integration_effect: "none",
    publication_effect: "none",
    closure_effect: "none",
    proof_pack_applicability: "none",
    cce_effect: "none",
    semantic_judgment: "not_performed_coordinator_owned",
    ...overrides
  };
}

function projection(overrides = {}) {
  return {
    schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
    projected: true,
    evidence: evidence(),
    evidence_digest: digest("3"),
    state_changed: false,
    authority: "authenticated_observation_only",
    refusal: null,
    ...overrides
  };
}

function assertRefusal(result, code) {
  assert.equal(result.verified, false);
  assert.equal(result.refusal.code, code, result.refusal.reason);
  assert.equal(result.source, null);
  assert.equal(result.populations, null);
  assert.equal(result.schema_version, WRITE_CONFINEMENT_VERIFICATION_SCHEMA_VERSION);
  assert.equal(result.profile_id, WRITE_CONFINEMENT_PROFILE_ID);
  assert.equal(result.profile_version, WRITE_CONFINEMENT_PROFILE_VERSION);
  assert.equal(Object.isFrozen(result), true);
  return result.refusal;
}

test("the verification binds to one admitted pack and one launcher artifact by name", () => {
  assert.equal(WRITE_CONFINEMENT_PROFILE_ID, "proof.scope.write-confinement");
  assert.equal(WRITE_CONFINEMENT_PROFILE_VERSION, "4.0.0");
  assert.equal(WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
    "workspace-agent-write-confinement-evidence.v1");
  assert.equal(new Set(Object.values(CODES)).size, Object.keys(CODES).length);
  for (const code of Object.values(CODES)) {
    assert.match(code, /^controlled_contract\.write_confinement_verification\.[a-z_]+\.v1$/u);
  }
});

test("internally consistent evidence verifies with its populations and identities carried", () => {
  const value = evidence();
  const before = JSON.stringify(value);
  const result = verifyWriteConfinementEvidence(value);
  assert.equal(result.verified, true, JSON.stringify(result.refusal));
  assert.equal(result.refusal, null);
  assert.deepEqual(result.source, {
    repository: value.repository, run_id: value.run_id, attempt: 1,
    record_id: "WK-2519", unit_address: "WK-2519#SLICE-001",
    base_commit: value.base_commit, delivery_commit: value.delivery_commit,
    delivery_tree: value.delivery_tree, source_digest: digest("1"),
    result_digest: digest("2"), evidence_digest: null
  });
  assert.deepEqual(result.populations, {
    contained: true,
    frozen_write_scope: value.frozen_write_scope,
    changed_paths: value.changed_paths,
    inside_write_scope_paths: value.inside_write_scope_paths,
    outside_write_scope_paths: [],
    changed_path_count: 2, inside_write_scope_path_count: 2,
    outside_write_scope_path_count: 0
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(value), before);

  const escaped = verifyWriteConfinementEvidence(evidence({
    contained: false,
    changed_paths: ["docs/escape.md", "packages/controlled-contract/lib/one.mjs"],
    inside_write_scope_paths: ["packages/controlled-contract/lib/one.mjs"],
    outside_write_scope_paths: ["docs/escape.md"],
    changed_path_count: 2, inside_write_scope_path_count: 1,
    outside_write_scope_path_count: 1
  }));
  assert.equal(escaped.verified, true, JSON.stringify(escaped.refusal));
  assert.equal(escaped.populations.contained, false);
  assert.deepEqual(escaped.populations.outside_write_scope_paths, ["docs/escape.md"]);
});

test("a projected launcher envelope verifies its inner evidence and carries the evidence digest", () => {
  const result = verifyWriteConfinementProjection(projection());
  assert.equal(result.verified, true, JSON.stringify(result.refusal));
  assert.equal(result.source.evidence_digest, digest("3"));
  assert.deepEqual(result.populations, verifyWriteConfinementEvidence(evidence()).populations);
});

test("missing, malformed, foreign, and unprojected envelopes are refused", () => {
  for (const value of [undefined, null]) {
    assertRefusal(verifyWriteConfinementProjection(value), CODES.MISSING_REQUIRED_INPUT);
  }
  assertRefusal(verifyWriteConfinementProjection("envelope"), CODES.MALFORMED_ENVELOPE);
  const delivery = assertRefusal(verifyWriteConfinementProjection(projection({
    schema_version: "workspace-agent-write-confinement-delivery.v1"
  })), CODES.WRONG_LAUNCHER_ARTIFACT);
  assert.equal(delivery.detail.supplied, "workspace-agent-write-confinement-delivery.v1");
  assertRefusal(verifyWriteConfinementProjection(projection({
    schema_version: "workspace-agent-write-confinement-evidence.v2"
  })), CODES.EVIDENCE_SCHEMA_VERSION_UNSUPPORTED);

  const inner = assertRefusal(verifyWriteConfinementProjection(evidence()),
    CODES.MALFORMED_ENVELOPE);
  assert.equal(inner.detail.missing_field, "projected");
  const unprojected = assertRefusal(verifyWriteConfinementProjection(projection({
    projected: false, evidence: null, refusal: { code: "observation_unavailable" }
  })), CODES.UNPROJECTED_ENVELOPE);
  assert.deepEqual(unprojected.detail,
    { projected: false, refusal_present: true, evidence_present: false });
  assertRefusal(verifyWriteConfinementProjection(projection({ evidence_digest: "abc" })),
    CODES.MALFORMED_ENVELOPE);
});

test("evidence outside the accepted artifact, field set, or authority markers is refused", () => {
  for (const value of [undefined, null]) {
    assertRefusal(verifyWriteConfinementEvidence(value), CODES.MISSING_REQUIRED_INPUT);
  }
  assertRefusal(verifyWriteConfinementEvidence([]), CODES.MALFORMED_EVIDENCE);
  assertRefusal(verifyWriteConfinementEvidence(evidence({
    schema_version: "workspace-agent-write-confinement-receipt-binding.v1"
  })), CODES.WRONG_LAUNCHER_ARTIFACT);
  assertRefusal(verifyWriteConfinementEvidence(evidence({ schema_version: "other.v1" })),
    CODES.EVIDENCE_SCHEMA_VERSION_UNSUPPORTED);
  const extra = assertRefusal(verifyWriteConfinementEvidence(evidence({ capture_root: "/tmp" })),
    CODES.MALFORMED_EVIDENCE);
  assert.equal(extra.detail.unexpected_field, "capture_root");
  const missing = evidence();
  delete missing.result_digest;
  assert.equal(assertRefusal(verifyWriteConfinementEvidence(missing),
    CODES.MALFORMED_EVIDENCE).detail.missing_field, "result_digest");
  for (const [field, value] of [
    ["authority", "caller_asserted"],
    ["observation_boundary", "working_tree"],
    ["populations_complete", false],
    ["admission_effect", "admit"],
    ["semantic_judgment", "performed"]
  ]) {
    const refusal = assertRefusal(verifyWriteConfinementEvidence(evidence({ [field]: value })),
      CODES.EVIDENCE_AUTHORITY_UNSUPPORTED);
    assert.equal(refusal.detail.field, field);
  }
  assertRefusal(verifyWriteConfinementEvidence(evidence({ not_covered: [] })),
    CODES.EVIDENCE_AUTHORITY_UNSUPPORTED);
  for (const [field, value] of [
    ["run_id", ""], ["attempt", -1], ["attempt", 1.5], ["source_digest", "sha1:abc"],
    ["contained", "yes"], ["observed_at", 7]
  ]) {
    assert.equal(assertRefusal(verifyWriteConfinementEvidence(evidence({ [field]: value })),
      CODES.MALFORMED_EVIDENCE).detail.field, field, field);
  }
});

test("path populations are refused rather than repaired when noncanonical or inconsistent", () => {
  const unsorted = assertRefusal(verifyWriteConfinementEvidence(evidence({
    changed_paths: ["packages/controlled-contract/test/one.test.mjs",
      "packages/controlled-contract/lib/one.mjs"]
  })), CODES.POPULATION_NONCANONICAL);
  assert.equal(unsorted.detail.population, "changed_paths");
  assertRefusal(verifyWriteConfinementEvidence(evidence({
    frozen_write_scope: ["packages/controlled-contract/lib/", "packages/controlled-contract/lib/"]
  })), CODES.POPULATION_NONCANONICAL);
  assertRefusal(verifyWriteConfinementEvidence(evidence({ inside_write_scope_paths: "all" })),
    CODES.POPULATION_NONCANONICAL);
  const miscounted = assertRefusal(verifyWriteConfinementEvidence(evidence({
    changed_path_count: 3
  })), CODES.POPULATION_INCONSISTENT);
  assert.deepEqual(miscounted.detail, { population: "changed_paths", declared: 3, actual: 2 });
  assertRefusal(verifyWriteConfinementEvidence(evidence({
    outside_write_scope_paths: ["docs/stray.md"], outside_write_scope_path_count: 1
  })), CODES.POPULATION_INCONSISTENT);
  assertRefusal(verifyWriteConfinementEvidence(evidence({
    outside_write_scope_paths: ["packages/controlled-contract/lib/one.mjs"],
    outside_write_scope_path_count: 1
  })), CODES.POPULATION_INCONSISTENT);
  assertRefusal(verifyWriteConfinementEvidence(evidence({
    inside_write_scope_paths: ["packages/controlled-contract/lib/one.mjs"],
    inside_write_scope_path_count: 1
  })), CODES.POPULATION_INCONSISTENT);
  const disagreement = assertRefusal(verifyWriteConfinementEvidence(evidence({ contained: false })),
    CODES.POPULATION_INCONSISTENT);
  assert.deepEqual(disagreement.detail, { contained: false, outside_write_scope_path_count: 0 });
});

test("verification is deterministic across repeated calls", () => {
  const first = verifyWriteConfinementProjection(projection());
  const second = verifyWriteConfinementProjection(projection());
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
});
