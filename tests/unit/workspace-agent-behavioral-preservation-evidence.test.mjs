

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  forwardedRefusal,
  mintBehavioralPreservationPair,
  mintBehavioralPreservationSide,
  pairRefusal
} from "../helpers/workspace-agent-behavioral-preservation-fixture.mjs";
import {
  BEHAVIORAL_PRESERVATION_PAIR_EVIDENCE_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_PAIR_INVARIANTS,
  BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES,
  BEHAVIORAL_PRESERVATION_PAIR_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_PUBLICATION_REFUSAL_CODES,
  BEHAVIORAL_PRESERVATION_PUBLICATION_SCHEMA_VERSION,
  assertBehavioralPreservationPublication,
  buildBehavioralPreservationEvidencePair,
  buildBehavioralPreservationPublication
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-behavioral-preservation-evidence.mjs";
import {
  digestTestProofEvidence,
  stableRuntimeTestId
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-evidence.mjs";

const CODES = BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES;
const PUBLICATION_CODES = BEHAVIORAL_PRESERVATION_PUBLICATION_REFUSAL_CODES;

function observableReport(pair, position) {
  const binding = pair.pair_evidence.sides.find((side) => side.position === position);
  const reportBytes = JSON.stringify({
    schema_version: "controlled-contract-behavioral-preservation-report.v1",
    observables: [{ observable_id: "observable-test-result",
      observable_type: "return_value", canonical_value: "passed" }],
    observable_count: 1,
    selected_observable_id: "observable-test-result"
  });
  return {
    evidence_id: binding.evidence_id,
    evidence_digest: binding.evidence_digest,
    relative_path: `reports/${position}.json`,
    report_bytes: reportBytes,
    report_digest: `sha256:${createHash("sha256").update(reportBytes).digest("hex")}`
  };
}

function reshapedAttempt(attempt, mutate) {
  const clone = structuredClone(attempt);
  mutate(clone);
  return clone;
}

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) for (const child of value) collectKeys(child, keys);
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

test("binds two authenticated sides into one ordered content-addressed pair", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const pair = buildBehavioralPreservationEvidencePair({ baseline, candidate });
  assert.equal(pair.schema_version, BEHAVIORAL_PRESERVATION_PAIR_SCHEMA_VERSION);
  assert.equal(pair.pair_evidence.schema_version,
    BEHAVIORAL_PRESERVATION_PAIR_EVIDENCE_SCHEMA_VERSION);
  assert.equal(Object.isFrozen(pair), true);
  assert.equal(Object.isFrozen(pair.pair_evidence), true);
  assert.equal(Object.isFrozen(pair.pair_evidence.sides[0]), true);

  assert.equal(pair.pair_evidence.repository, baseline.context.authority.main_repo);
  assert.deepEqual(pair.pair_evidence.sides.map(({ position }) => position),
    ["baseline", "candidate"]);

  assert.deepEqual(Object.keys(pair.pair_evidence.shared_invariants).sort(),
    [...BEHAVIORAL_PRESERVATION_PAIR_INVARIANTS].sort());
  for (const field of BEHAVIORAL_PRESERVATION_PAIR_INVARIANTS) {
    assert.equal(pair.pair_evidence.shared_invariants[field],
      baseline.context.evidence_identity[field]);
    assert.equal(pair.pair_evidence.shared_invariants[field],
      candidate.context.evidence_identity[field]);
  }

  const [baselineSide, candidateSide] = pair.pair_evidence.sides;
  assert.equal(baselineSide.run_id, "run-baseline");
  assert.equal(candidateSide.run_id, "run-candidate");
  assert.notEqual(baselineSide.source_snapshot_digest, candidateSide.source_snapshot_digest);
  for (const [side, bundle] of [[baselineSide, baseline], [candidateSide, candidate]]) {
    assert.equal(side.source_snapshot_digest,
      bundle.context.evidence_identity.source_snapshot_digest);
    assert.equal(side.attempt, bundle.context.evidence_identity.attempt);

    assert.equal(side.evidence_digest, bundle.attempt.evidence_digest);
    assert.equal(side.evidence_id, bundle.attempt.evidence.evidence_identity.evidence_id);
    assert.deepEqual(side.artifacts, bundle.attempt.evidence.artifacts.map(
      ({ artifact_id: artifactId, kind, digest }) => ({ artifact_id: artifactId, kind, digest })
    ));
    assert.equal(side.inventory_change_count, 0);
  }

  assert.match(pair.pair_id, /^pair-[0-9a-f]{64}$/u);
  assert.equal(pair.pair_evidence.pair_identity.pair_id, pair.pair_id);
  assert.equal(pair.body_digest, digestTestProofEvidence(pair.pair_evidence));
  assert.equal(pair.body_bytes.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(pair.body_bytes), pair.pair_evidence);

  assert.equal(pair.advisory, true);
  assert.equal(pair.semantic_judgment, "not_performed_coordinator_owned");
  for (const effect of ["admission_effect", "review_effect", "integration_effect",
    "publication_effect", "proof_credit_effect", "applicability_effect",
    "behavioral_equivalence_effect", "business_semantic_effect", "policy_effect"]) {
    assert.equal(pair[effect], "none", effect);
  }
});

test("issues one branded ordered publication with exact owner-projected reports", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const pair = buildBehavioralPreservationEvidencePair({ baseline, candidate });
  const baselineReport = observableReport(pair, "baseline");
  const candidateReport = observableReport(pair, "candidate");
  const publication = buildBehavioralPreservationPublication({
    pair, baselineReport, candidateReport
  });
  assert.equal(publication.schema_version,
    BEHAVIORAL_PRESERVATION_PUBLICATION_SCHEMA_VERSION);
  assert.equal(Object.isFrozen(publication), true);
  assert.equal(Object.isFrozen(publication.reports), true);
  assert.deepEqual(publication.reports.baseline, baselineReport);
  assert.deepEqual(publication.reports.candidate, candidateReport);
  assert.equal(assertBehavioralPreservationPublication(publication), publication);

  for (const forged of [
    structuredClone(publication),
    Object.freeze(structuredClone(publication)),
    Object.freeze({ ...publication, reports: publication.reports })
  ]) {
    assert.throws(() => assertBehavioralPreservationPublication(forged),
      pairRefusal(PUBLICATION_CODES.PUBLICATION_UNTRUSTED));
  }
});

test("refuses forged, side-swapped, incomplete, and independently over-bound reports",
  async (t) => {
    const { baseline, candidate } = await mintBehavioralPreservationPair(t);
    const pair = buildBehavioralPreservationEvidencePair({ baseline, candidate });
    const baselineReport = observableReport(pair, "baseline");
    const candidateReport = observableReport(pair, "candidate");
    assert.throws(() => buildBehavioralPreservationPublication({
      pair, baselineReport: candidateReport, candidateReport: baselineReport
    }), pairRefusal(PUBLICATION_CODES.REPORT_MISBOUND));
    assert.throws(() => buildBehavioralPreservationPublication({
      pair, baselineReport, candidateReport: { ...candidateReport,
        report_digest: `sha256:${"0".repeat(64)}` }
    }), pairRefusal(PUBLICATION_CODES.REPORT_INVALID));
    assert.throws(() => buildBehavioralPreservationPublication({ pair, baselineReport }),
      pairRefusal(PUBLICATION_CODES.INPUT_MALFORMED));
    assert.throws(() => buildBehavioralPreservationPublication({
      pair, baselineReport: { ...baselineReport, authority: "caller" }, candidateReport
    }), pairRefusal(PUBLICATION_CODES.INPUT_OVER_BOUND));
  });

test("core pair evidence carries no production time", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const pair = buildBehavioralPreservationEvidencePair({ baseline, candidate });
  const keys = collectKeys(pair);
  for (const key of ["produced_at", "producedAt", "timestamp", "created_at", "generated_at",
    "time", "now", "clock", "epoch_ms"]) {
    assert.equal(keys.has(key), false, key);
  }
  assert.doesNotMatch(pair.body_bytes, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u);
});

test("requires the attempt identity the bound context minted, field for field", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const mutants = {
    run_id: "run-elsewhere",
    source_snapshot_digest: `sha256:${"b".repeat(64)}`,
    attempt: 2,
    test_id: stableRuntimeTestId("other.test.mjs :: 0 :: other"),
    command_target: "other-target.test.mjs",
    wk_id: "WK-9999",
    selected_unit: "WK-9999#SLICE-001",
    controlled_contract_generation: `sha256:${"c".repeat(64)}`,
    verification_id: "claim-verify-other",
    command_id: `command-${"d".repeat(64)}`
  };
  for (const [field, value] of Object.entries(mutants)) {
    const attempt = reshapedAttempt(baseline.attempt, (clone) => {
      clone.evidence.evidence_identity[field] = value;
    });
    assert.throws(() => buildBehavioralPreservationEvidencePair({
      baseline: { context: baseline.context, attempt }, candidate
    }), pairRefusal(CODES.SIDE_IDENTITY_MISMATCH), field);
  }

  for (const mutate of [
    (clone) => { clone.evidence.evidence_identity.extra_identity = "caller-supplied"; },
    (clone) => { delete clone.evidence.evidence_identity.command_target; },
    (clone) => { delete clone.evidence.evidence_identity.evidence_id; }
  ]) {
    assert.throws(() => buildBehavioralPreservationEvidencePair({
      baseline: { context: baseline.context, attempt: reshapedAttempt(baseline.attempt, mutate) },
      candidate
    }), pairRefusal(CODES.SIDE_IDENTITY_MISMATCH));
  }
});

test("refuses inequality within each named authenticated invariant", async (t) => {
  const cases = [
    ["wk_id", { wkId: "WK-2065" }],
    ["selected_unit", { sliceId: "SLICE-007" }],
    ["controlled_contract_generation", { contractBytes: "{\"variant\":true}\n" }],
    ["verification_id", { verificationId: "claim-verify-slice-007" }],
    ["command_id", { target: "other-target.test.mjs" }]
  ];
  for (const [invariant, overrides] of cases) {
    const { baseline, candidate } = await mintBehavioralPreservationPair(t, overrides);
    assert.throws(() => buildBehavioralPreservationEvidencePair({ baseline, candidate }),
      (error) => pairRefusal(CODES.INVARIANT_INEQUALITY)(error) &&
        error.detail.invariant === invariant, invariant);
  }
});

test("refuses an exact duplicate side and cross-repository binding", async (t) => {
  const { root, baseline, candidate } = await mintBehavioralPreservationPair(t);
  assert.throws(() => buildBehavioralPreservationEvidencePair({
    baseline, candidate: baseline
  }), pairRefusal(CODES.SIDE_DUPLICATE));
  assert.throws(() => buildBehavioralPreservationEvidencePair({
    baseline: candidate, candidate
  }), pairRefusal(CODES.SIDE_DUPLICATE));
  const foreign = await mintBehavioralPreservationSide(root, {
    name: "foreign", runId: "run-foreign", repoName: "other-main"
  });
  assert.throws(() => buildBehavioralPreservationEvidencePair({
    baseline, candidate: foreign
  }), (error) => pairRefusal(CODES.CROSS_BOUNDARY_BINDING)(error) &&
    error.detail.baseline !== error.detail.candidate);
});

test("refuses malformed, one-sided, over-bound, and unsupported input", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  for (const input of [undefined, null, "pair", 7, [baseline, candidate]]) {
    assert.throws(() => buildBehavioralPreservationEvidencePair(input),
      pairRefusal(CODES.INPUT_MALFORMED));
  }
  for (const input of [{ baseline, candidate: "candidate" }, { baseline: 1, candidate }]) {
    assert.throws(() => buildBehavioralPreservationEvidencePair(input),
      pairRefusal(CODES.INPUT_MALFORMED));
  }
  for (const input of [{ baseline }, { candidate }, { baseline, candidate: null }]) {
    assert.throws(() => buildBehavioralPreservationEvidencePair(input),
      pairRefusal(CODES.INPUT_ONE_SIDED));
  }

  for (const extra of ["report", "receipt", "pair_id", "body_digest", "produced_at",
    "source_snapshot", "dependency_proof", "complete", "authority", "preservation"]) {
    assert.throws(() => buildBehavioralPreservationEvidencePair({
      baseline, candidate, [extra]: {}
    }), (error) => pairRefusal(CODES.INPUT_OVER_BOUND)(error) &&
      error.detail.unexpected_key === extra, extra);
  }
  for (const extra of ["report", "evidence", "produced_at", "authority"]) {
    assert.throws(() => buildBehavioralPreservationEvidencePair({
      baseline: { ...baseline, [extra]: {} }, candidate
    }), pairRefusal(CODES.INPUT_OVER_BOUND), extra);
  }
  assert.throws(() => buildBehavioralPreservationEvidencePair(
    { baseline, candidate }, { producedAt: "2026-08-18T00:00:00.000Z" }
  ), pairRefusal(CODES.INPUT_OVER_BOUND));
  for (const member of ["context", "attempt"]) {
    const partial = { ...baseline };
    delete partial[member];
    assert.throws(() => buildBehavioralPreservationEvidencePair({
      baseline: partial, candidate
    }), pairRefusal(CODES.SIDE_MEMBER_MISSING), member);
  }
  for (const mutate of [
    (clone) => { clone.evidence.schema_version = "test-proof-runtime-evidence.v1"; },
    (clone) => { clone.evidence.authority = "authoritative_execution_facts"; }
  ]) {
    assert.throws(() => buildBehavioralPreservationEvidencePair({
      baseline: { context: baseline.context, attempt: reshapedAttempt(baseline.attempt, mutate) },
      candidate
    }), pairRefusal(CODES.ASSEMBLY_UNSUPPORTED));
  }
});

test("forwards owner refusals for an untrusted context or unauthenticated attempt", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  for (const context of [
    { ...baseline.context },
    Object.freeze(structuredClone(baseline.context)),
    { evidence_identity: baseline.context.evidence_identity }
  ]) {
    assert.throws(() => buildBehavioralPreservationEvidencePair({
      baseline: { context, attempt: baseline.attempt }, candidate
    }), forwardedRefusal("test_proof_attempt_context_untrusted"));
  }
  for (const attempt of [
    { evidence: baseline.attempt.evidence },
    reshapedAttempt(baseline.attempt, (clone) => { clone.schema_version = "other.v1"; }),
    reshapedAttempt(baseline.attempt, (clone) => { delete clone.evidence_digest; })
  ]) {
    assert.throws(() => buildBehavioralPreservationEvidencePair({
      baseline: { context: baseline.context, attempt }, candidate
    }), forwardedRefusal("test_proof_receipt_projection_invalid"));
  }
});

test("emits no partial pair evidence and stays deterministic across refusals", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const first = buildBehavioralPreservationEvidencePair({ baseline, candidate });
  let refused = null;
  try {
    buildBehavioralPreservationEvidencePair({ baseline, candidate: baseline });
  } catch (error) {
    refused = error;
  }
  assert.equal(refused?.code, CODES.SIDE_DUPLICATE);
  for (const key of ["pair_id", "pair_evidence", "body_bytes", "body_digest", "sides"]) {
    assert.equal(Object.hasOwn(refused, key), false, key);
    assert.equal(Object.hasOwn(refused.detail ?? {}, "body_bytes"), false);
  }
  const second = buildBehavioralPreservationEvidencePair({ baseline, candidate });
  assert.equal(second.body_bytes, first.body_bytes);
  assert.equal(second.body_digest, first.body_digest);
  assert.equal(second.pair_id, first.pair_id);
  assert.notEqual(second, first);
});

test("ordering and any changed side stay distinguishable in the body digest", async (t) => {
  const { root, baseline, candidate } = await mintBehavioralPreservationPair(t);
  const forward = buildBehavioralPreservationEvidencePair({ baseline, candidate });
  const reversed = buildBehavioralPreservationEvidencePair({
    baseline: candidate, candidate: baseline
  });
  assert.notEqual(reversed.body_digest, forward.body_digest);
  assert.notEqual(reversed.pair_id, forward.pair_id);
  assert.deepEqual(reversed.pair_evidence.sides.map(({ run_id: runId }) => runId),
    ["run-candidate", "run-baseline"]);
  const changed = await mintBehavioralPreservationSide(root, { name: "candidate-changed", runId: "run-candidate-2" });
  const altered = buildBehavioralPreservationEvidencePair({ baseline, candidate: changed });
  assert.notEqual(altered.body_digest, forward.body_digest);
  assert.equal(altered.pair_evidence.shared_invariants.wk_id,
    forward.pair_evidence.shared_invariants.wk_id);
});
