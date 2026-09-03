import assert from "node:assert/strict";
import test from "node:test";

import {
  projectedEvaluationEnvelopeFor
} from "../../lib/exact-binding-capture.mjs";
import {
  createGraphSelectionTrace,
  evaluateProjectedEvaluationBinding
} from "../../lib/projected-evaluation-binding.mjs";
import {
  buildStableTestProofPopulation,
  evaluateStableProofPackFixtureV1,
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../lib/stable-v1-migration.mjs";
import {
  buildSoundNegativeObservationSources,
  resign
} from "./sound-negative-observation-v1-fixture.mjs";
import {
  buildSoundNegativeObservationEvaluationInput,
  buildSoundNegativeObservationProfile
} from "./sound-negative-observation-v1-profile.mjs";
import {
  createSoundNegativeObservationSubject
} from "./sound-negative-observation-v1-harness.mjs";

function evaluation(source, {
  mutateContract = (contract) => contract,
  mutateInput = (input) => input,
  profile = buildSoundNegativeObservationProfile()
} = {}) {
  const sourceContract = JSON.parse(source.projectionBytes.toString("utf8"));
  const contract = mutateContract(migrateControlledAcceptanceContractV02ToV1({
    contract: sourceContract,
    testProofs: buildStableTestProofPopulation(sourceContract)
  }));
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

test("exact capture proves both profile discrimination and projected graph binding", async () => {
  const subject = await createSoundNegativeObservationSubject({
    fixtureOptions: { domain: "exact-positive" }
  });
  try {
    const projected = subject.project();
    assert.equal(subject.exactBindingResult.satisfaction, "satisfied");
    assert.equal(projected.assessment.profile_discrimination, "proven");
    assert.equal(projected.assessment.exact_binding, "proven");
    assert.equal(
      projected.assessment.verification_scope.projected_evaluation_binding,
      "bound_to_deterministic_projection"
    );
  } finally {
    await subject.cleanup();
  }
});

test("omitting one evaluator association trace record defeats projected binding", async () => {
  const subject = await createSoundNegativeObservationSubject({
    fixtureOptions: { domain: "omitted-trace" }
  });
  try {
    const selection = createGraphSelectionTrace();
    const profileEvaluation = evaluateStableProofPackFixtureV1({
      profile: subject.profile,
      contract: subject.contract,
      evaluation_input: subject.evaluationInput
    }, { graphSelectionSink: selection.sink });
    assert.equal(profileEvaluation.satisfaction, "satisfied");
    const trace = selection.snapshot();
    const omitted = {
      trace_version: trace.trace_version,
      began: trace.began,
      records: trace.records.filter((record, index) =>
        record.trace_point !== "for_each_association_binding" || index !==
          trace.records.findIndex(({ trace_point: point }) =>
            point === "for_each_association_binding"))
    };
    const binding = evaluateProjectedEvaluationBinding({
      declaredOptIn: subject.declaration.projected_evaluation_binding,
      envelope: projectedEvaluationEnvelopeFor(subject.exactBindingResult),
      exactBindingResult: subject.exactBindingResult,
      expectedContext: subject.context,
      contract: subject.contract,
      profile: subject.profile,
      evaluation: profileEvaluation,
      trace: omitted
    });
    assert.ok(binding.diagnostics.some(({ code }) =>
      code === "projected_evaluation_trace_incomplete"));
  } finally {
    await subject.cleanup();
  }
});

test("projection, evaluation, source, declaration, profile, and fabricated-claim splices fail", async () => {
  const alternate = source({ domain: "splice-alternate" });
  const baseline = source({ domain: "splice-baseline" });
  const cases = [
    {
      label: "projection-result",
      options: {
        source: baseline,
        projectionBytes: alternate.projectionBytes
      }
    },
    {
      label: "evaluation-input",
      options: {
        source: baseline,
        mutateEvaluationInput(input) {
          input.reference_bindings.find(({ role }) => role === "target")
            .reference_ids = input.reference_bindings.find(
              ({ role }) => role === "observation_attempt").reference_ids;
          return input;
        }
      }
    },
    {
      label: "capture-source",
      options: {
        source: baseline,
        sourceFiles: {
          "observation-evidence.json": alternate.evidenceBytes,
          "observation-capture-proof.json": alternate.captureProofBytes,
          "observation-projection.json": baseline.projectionBytes
        }
      }
    },
    {
      label: "declaration-profile",
      options: {
        source: baseline,
        mutateDeclaration(declaration) {
          declaration.profile_digest = "0".repeat(64);
          return declaration;
        }
      }
    },
    {
      label: "fabricated-claim",
      options: {
        source: baseline,
        mutateContract(contract) {
          const claim = contract.claims.find(({ claim_id: id }) => id.endsWith("-nonmatch"));
          const proposition = contract.propositions.find(
            ({ proposition_id: id }) => id === claim.proposition_id
          );
          claim.claim_id = "claim-fabricated-nonmatch";
          proposition.proposition_id = "prop-fabricated-nonmatch";
          claim.proposition_id = proposition.proposition_id;
          const relation = contract.relations.find(
            ({ target_claim_id: id }) => id.endsWith("-nonmatch")
          );
          relation.target_claim_id = claim.claim_id;
          return contract;
        }
      }
    }
  ];
  for (const { label, options } of cases) {
    const subject = await createSoundNegativeObservationSubject(options);
    try {
      const projected = subject.project();
      assert.ok(subject.exactBindingResult.satisfaction !== "satisfied" ||
        projected.assessment.exact_binding !== "proven", label);
    } finally {
      await subject.cleanup();
    }
  }
});
