import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStableTestProofPopulation,
  evaluateStableProofPackFixtureV1,
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { TEST_PROOF_VERSION_V1 } from "../../lib/native-contract-carrier-v1.mjs";
import {
  buildSoundNegativeObservationSources,
  resign
} from "./sound-negative-observation-v1-fixture.mjs";
import {
  buildSoundNegativeObservationEvaluationInput,
  buildSoundNegativeObservationProfile
} from "./sound-negative-observation-v1-profile.mjs";

function evaluation(source, {
  mutateContract = (contract) => contract,
  mutateInput = (input) => input,
  profile = buildSoundNegativeObservationProfile()
} = {}) {
  const sourceContract = JSON.parse(source.projectionBytes.toString("utf8"));
  const contract = mutateContract({
    ...sourceContract,
    test_proof_version: TEST_PROOF_VERSION_V1,
    test_proofs: buildStableTestProofPopulation(sourceContract)
  });
  const input = mutateInput(buildSoundNegativeObservationEvaluationInput(contract), contract);
  return evaluateStableProofPackFixtureV1({ profile, contract, evaluation_input: input });
}

function source(options = {}) {
  return buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 2, observationCount: 2,
    domain: "sound-negative-profile", ...options
  });
}

function swapAssociationOperands(contract, suffix) {
  const propositions = contract.propositions.filter(({ proposition_id: id }) =>
    new RegExp(`^prop-sno-occurrence-[0-9]+-[0-9]+${suffix}$`, "u").test(id));
  assert.equal(propositions.length, 2, suffix);
  [propositions[0].operands, propositions[1].operands] =
    [propositions[1].operands, propositions[0].operands];
  return contract;
}

test("absence-only profile is schema-valid, semantic, and single-conjunctive", () => {
  const profile = buildSoundNegativeObservationProfile();
  assert.equal(validateProfileSchemaV1(profile), true);
  assert.deepEqual(validateProfileSemanticsV1(profile), []);
  assert.deepEqual(Object.keys(profile.satisfaction_expression), ["all_of"]);
  assert.equal(JSON.stringify(profile).includes("any_of"), false);
  assert.equal(JSON.stringify(profile).includes("branch_cardinality"), false);
  assert.equal(profile.reference_roles.some(({ role }) =>
    role.includes("present") || role.includes("unavailable")), false);
});

test("every satisfaction node and association edge is mechanically removal-resistant", () => {
  const profile = buildSoundNegativeObservationProfile();
  let satisfactionRemovalCount = 0;
  for (let index = 0; index < profile.satisfaction_expression.all_of.length; index += 1) {
    const mutant = structuredClone(profile);
    mutant.satisfaction_expression.all_of.splice(index, 1);
    assert.notDeepEqual(validateProfileSemanticsV1(mutant), [],
      profile.satisfaction_expression.all_of[index].pattern);
    satisfactionRemovalCount += 1;
  }
  let associationRemovalCount = 0;
  for (const [patternIndex, pattern] of profile.claim_patterns.entries()) {
    for (let associationIndex = 0;
      associationIndex < (pattern.for_each?.association_bindings?.length ?? 0);
      associationIndex += 1) {
      const mutant = structuredClone(profile);
      const associations = mutant.claim_patterns[patternIndex].for_each.association_bindings;
      associations.splice(associationIndex, 1);
      if (associations.length === 0) {
        delete mutant.claim_patterns[patternIndex].for_each.association_bindings;
      }
      assert.notDeepEqual(validateProfileSemanticsV1(mutant), [],
        `${pattern.pattern_id}:${associationIndex}`);
      associationRemovalCount += 1;
    }
  }
  assert.equal(satisfactionRemovalCount, 51);
  assert.equal(associationRemovalCount, 16);
});

test("nonempty, empty, Unicode, harmless material, and declaration reordering satisfy", () => {
  const cases = [
    source({ domain: "nonempty-distinct" }),
    source({ sourceCount: 0, observationCount: 0, domain: "empty-complete" }),
    source({ unicode: true, domain: "unicode-identities" })
  ];
  const reordered = source({ domain: "declaration-order" });
  const evidence = structuredClone(reordered.evidence);
  evidence.declared_sources.reverse();
  evidence.source_outcomes.reverse();
  cases.push(resign(evidence, "declaration-order-reversed"));
  for (const [index, captured] of cases.entries()) {
    assert.equal(evaluation(captured).satisfaction, "satisfied", index);
  }
  assert.equal(evaluation(source({ domain: "unrelated" }), {
    mutateContract(contract) {
      contract.references.push({
        reference_id: "ref-unrelated-material",
        type_term: "cc:evidence",
        identity: { kind: "durable_id", domain: "unrelated", value: "harmless" }
      });
      return contract;
    }
  }).satisfaction, "satisfied");
});

test("present, unavailable, invalid capture shapes, and endpoint drift never satisfy", () => {
  const direct = [
    buildSoundNegativeObservationSources({ conclusion: "present", domain: "present" }),
    buildSoundNegativeObservationSources({ conclusion: "unavailable", domain: "unavailable" })
  ];
  const base = source({ domain: "negative-captures" });
  const mutations = {
    "missing-endpoint": (evidence) => { evidence.source_outcomes[0].endpoints.pop(); },
    "duplicate-endpoint": (evidence) => {
      evidence.source_outcomes[0].endpoints.push(structuredClone(
        evidence.source_outcomes[0].endpoints[1]
      ));
    },
    "malformed-observation": (evidence) => {
      evidence.source_outcomes[0].observations[0] = { kind: "malformed", raw_base64: "eA==" };
    },
    "unauthenticated-observation": (evidence) => {
      evidence.source_outcomes[0].observations[0].witnesses.authentication = "e30K";
    },
    "stale-observation": (evidence) => {
      evidence.source_outcomes[0].observations[0].observed_version = structuredClone(
        evidence.source_outcomes[1].endpoints[1].version
      );
    },
    "duplicated-observation": (evidence) => {
      evidence.source_outcomes[0].observations.push(structuredClone(
        evidence.source_outcomes[0].observations[0]
      ));
      evidence.declared_observation_total += 1;
    },
    "wrong-attempt": (evidence) => {
      evidence.source_outcomes[0].observations[0].observation_attempt =
        structuredClone(evidence.interval.start);
    },
    "wrong-source": (evidence) => {
      evidence.source_outcomes[0].observations[0].assigned_source =
        structuredClone(evidence.source_outcomes[1].source);
    },
    "out-of-interval": (evidence) => {
      evidence.source_outcomes[0].observations[0].sequence = evidence.interval.end_sequence + 1;
    }
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const evidence = structuredClone(base.evidence);
    mutate(evidence);
    direct.push(resign(evidence, label));
  }
  for (const endpointVariant of ["state", "version", "both"]) {
    direct.push(source({ endpointVariant, domain: `drift-${endpointVariant}` }));
  }
  const incomplete = structuredClone(base.evidence);
  incomplete.source_outcomes.pop();
  assert.throws(() => resign(incomplete, "incomplete-source-coverage"),
    ({ code }) => code === "sound_negative_projection_result_invalid");
  for (const [index, captured] of direct.entries()) {
    assert.notEqual(evaluation(captured).satisfaction, "satisfied", index);
  }
});

test("crossed target, source, and position associations are refused", () => {
  const captured = source({ domain: "crossed-associations" });
  for (const suffix of ["-target", "-source", "-position"]) {
    const result = evaluation(captured, {
      mutateContract: (contract) => swapAssociationOperands(contract, suffix)
    });
    assert.notEqual(result.satisfaction, "satisfied", suffix);
  }
});



