import assert from "node:assert/strict";
import test from "node:test";

import { resolveNativeContractDag } from "../../lib/native-contract-dag.mjs";

function behavior(index, modality = "MUST") {
  return { claim_id: `behavior-${index}`, kind: "behavior", modality };
}

function verification(index, modality = "MUST") {
  return { claim_id: `verification-${index}`, kind: "verification", modality };
}

function verifies(index, source, target) {
  return {
    relation_id: `verifies-${index}`,
    role: "verifies",
    source_claim_id: source,
    target_claim_id: target
  };
}

test("empty native contracts are mechanically incomplete", () => {
  const result = resolveNativeContractDag({ claims: [], relations: [], collections: [] });
  assert.deepEqual(result.diagnostics, [{ code: "empty_contract" }]);
});

test("invalid claim kinds and modalities never disappear from graph diagnostics", () => {
  const result = resolveNativeContractDag({
    claims: [
      { claim_id: "behavior-invalid-modality", kind: "behavior", modality: 1 },
      { claim_id: "claim-invalid-kind", kind: "instruction", modality: "MUST" }
    ],
    relations: [],
    collections: []
  });

  assert.deepEqual(result.diagnostics, [
    {
      code: "invalid_claim_kind",
      claim_id: "claim-invalid-kind",
      actual_kind: "instruction"
    },
    {
      code: "invalid_claim_modality",
      claim_id: "behavior-invalid-modality",
      actual_modality: 1
    }
  ]);
});

test("SLICE-018-shaped two-of-eight verification reports the six uncovered obligations", () => {
  const claims = [
    ...Array.from({ length: 8 }, (_, index) => behavior(index + 1)),
    verification(1),
    verification(2)
  ];
  const result = resolveNativeContractDag({
    claims,
    relations: [
      verifies(1, "verification-1", "behavior-1"),
      verifies(2, "verification-2", "behavior-2")
    ],
    collections: [{
      collection_id: "proof-obligations",
      collection_kind: "closed_set",
      member_claim_ids: Array.from({ length: 8 }, (_, index) => `behavior-${index + 1}`)
    }]
  });

  assert.deepEqual(
    result.facts.uncovered_mandatory_behavior_claim_ids,
    ["behavior-3", "behavior-4", "behavior-5", "behavior-6", "behavior-7", "behavior-8"]
  );
  assert.deepEqual(
    result.facts.closed_collection_coverage[0].uncovered_member_claim_ids,
    ["behavior-3", "behavior-4", "behavior-5", "behavior-6", "behavior-7", "behavior-8"]
  );
  assert.equal(
    result.facts.closed_collection_coverage[0].declared_member_coverage_complete,
    false
  );
});

test("one verifier may cover many behaviors and many verifiers may cover one behavior", () => {
  const result = resolveNativeContractDag({
    claims: [behavior(1), behavior(2), verification(1), verification(2)],
    relations: [
      verifies(1, "verification-1", "behavior-1"),
      verifies(2, "verification-1", "behavior-2"),
      verifies(3, "verification-2", "behavior-2")
    ],
    collections: []
  });

  assert.deepEqual(result.facts.uncovered_mandatory_behavior_claim_ids, []);
  assert.deepEqual(result.facts.verified_behavior_claim_ids, ["behavior-1", "behavior-2"]);
  assert.deepEqual(result.facts.unattached_mandatory_verification_claim_ids, []);
});

test("mandatory verification claims without a valid verifies edge are explicit", () => {
  const result = resolveNativeContractDag({
    claims: [verification(1)],
    relations: [],
    collections: []
  });

  assert.deepEqual(result.facts.unattached_mandatory_verification_claim_ids, [
    "verification-1"
  ]);
  assert.deepEqual(result.diagnostics, [{
    code: "mandatory_verification_unattached",
    claim_id: "verification-1"
  }]);
});

test("nonmandatory verification is supplementary and cannot discharge coverage", () => {
  const result = resolveNativeContractDag({
    claims: [behavior(1), verification(1, "SHOULD")],
    relations: [verifies(1, "verification-1", "behavior-1")],
    collections: []
  });

  assert.deepEqual(result.facts.uncovered_mandatory_behavior_claim_ids, ["behavior-1"]);
  assert.deepEqual(result.facts.traceably_verified_behavior_claim_ids, ["behavior-1"]);
  assert.deepEqual(result.facts.supplementary_verifies_relation_ids, ["verifies-1"]);
  assert.equal(result.facts.supplementary_verification_claim_count, 1);
  assert.deepEqual(result.facts.attached_supplementary_verification_claim_ids, [
    "verification-1"
  ]);
  assert.deepEqual(result.diagnostics, [
    { code: "mandatory_behavior_unverified", claim_id: "behavior-1" }
  ]);
});

test("supplementary verification does not invalidate already-covered behavior", () => {
  const result = resolveNativeContractDag({
    claims: [behavior(1), verification(1), verification(2, "SHOULD")],
    relations: [
      verifies(1, "verification-1", "behavior-1"),
      verifies(2, "verification-2", "behavior-1")
    ],
    collections: []
  });

  assert.deepEqual(result.facts.verified_behavior_claim_ids, ["behavior-1"]);
  assert.deepEqual(result.facts.qualifying_verifies_relation_ids, ["verifies-1"]);
  assert.deepEqual(result.facts.supplementary_verifies_relation_ids, ["verifies-2"]);
  assert.deepEqual(result.diagnostics, []);
});

test("MUST_NOT verification is a prohibition rather than an unattached obligation", () => {
  const result = resolveNativeContractDag({
    claims: [verification(1, "MUST_NOT")],
    relations: [],
    collections: []
  });

  assert.deepEqual(result.facts.unattached_mandatory_verification_claim_ids, []);
  assert.equal(result.facts.supplementary_verification_claim_count, 1);
  assert.deepEqual(result.facts.attached_supplementary_verification_claim_ids, []);
  assert.deepEqual(result.diagnostics, []);
});

test("declared closed proof sets report member coverage without population completeness", () => {
  const result = resolveNativeContractDag({
    claims: [behavior(1), behavior(2), verification(1), verification(2)],
    relations: [
      verifies(1, "verification-1", "behavior-1"),
      verifies(2, "verification-2", "behavior-2")
    ],
    collections: [{
      collection_id: "proof-obligations",
      collection_kind: "closed_set",
      member_claim_ids: ["behavior-1", "behavior-2"]
    }]
  });

  assert.equal(
    result.facts.closed_collection_coverage[0].declared_member_coverage_complete,
    true
  );
  assert.equal("complete" in result.facts.closed_collection_coverage[0], false);
  assert.equal("required_population_complete" in result.facts.closed_collection_coverage[0], false);
  assert.equal("allowed" in result, false);
  assert.equal("authorized" in result, false);
});

test("evidence members do not make closed-set behavior coverage incomplete", () => {
  const result = resolveNativeContractDag({
    claims: [
      behavior(1),
      verification(1),
      { claim_id: "evidence-1", kind: "evidence", modality: "MUST" }
    ],
    relations: [verifies(1, "verification-1", "behavior-1")],
    collections: [{
      collection_id: "proof-population",
      collection_kind: "closed_set",
      member_claim_ids: ["behavior-1", "evidence-1"]
    }]
  });

  assert.deepEqual(result.facts.closed_collection_coverage[0], {
    collection_id: "proof-population",
    member_claim_ids: ["behavior-1", "evidence-1"],
    verified_member_claim_ids: ["behavior-1"],
    mandatory_behavior_member_claim_ids: ["behavior-1"],
    nonbehavior_member_claim_ids: ["evidence-1"],
    uncovered_member_claim_ids: [],
    declared_member_coverage_complete: true
  });
});

test("ordered sequences cannot contain phantom claim members", () => {
  const result = resolveNativeContractDag({
    claims: [behavior(1), verification(1)],
    relations: [verifies(1, "verification-1", "behavior-1")],
    collections: [{
      collection_id: "sequence-proof",
      collection_kind: "ordered_sequence",
      member_claim_ids: ["behavior-1", "claim-phantom"]
    }]
  });
  assert.ok(result.diagnostics.some(({ code, claim_id: claimId }) =>
    code === "dangling_collection_member" && claimId === "claim-phantom"
  ));
});

test("dangling and mistyped verifies edges are explicit mechanical diagnostics", () => {
  const result = resolveNativeContractDag({
    claims: [behavior(1), verification(1)],
    relations: [
      verifies(1, "missing-verifier", "behavior-1"),
      verifies(2, "behavior-1", "verification-1")
    ],
    collections: []
  });

  assert.deepEqual(
    result.diagnostics.map(({ code }) => code),
    [
      "dangling_relation_source",
      "mandatory_behavior_unverified",
      "mandatory_verification_unattached",
      "verifies_source_type_mismatch"
    ]
  );
});

test("cycles in dependency-like relation families are reported deterministically", () => {
  const result = resolveNativeContractDag({
    claims: [behavior(1, "MAY"), behavior(2, "MAY")],
    relations: [
      {
        relation_id: "refines-1",
        role: "refines",
        source_claim_id: "behavior-1",
        target_claim_id: "behavior-2"
      },
      {
        relation_id: "refines-2",
        role: "refines",
        source_claim_id: "behavior-2",
        target_claim_id: "behavior-1"
      }
    ],
    collections: []
  });

  assert.deepEqual(
    result.diagnostics,
    [{ code: "relation_cycle", claim_path: ["behavior-1", "behavior-2", "behavior-1"] }]
  );
});

test("diagnostics and coverage facts are invariant to authored array order", () => {
  const contract = {
    claims: [behavior(1), verification(1), verification(2, "SHOULD")],
    relations: [
      verifies(1, "missing-verifier", "behavior-1"),
      verifies(2, "verification-2", "behavior-1")
    ],
    collections: []
  };
  const first = resolveNativeContractDag(contract);
  const second = resolveNativeContractDag({
    ...contract,
    claims: [...contract.claims].reverse(),
    relations: [...contract.relations].reverse()
  });
  assert.deepEqual(second, first);
});
