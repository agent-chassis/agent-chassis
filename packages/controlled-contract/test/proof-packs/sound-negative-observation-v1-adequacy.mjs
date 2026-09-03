import {
  buildStableTestProofPopulation,
  evaluateStableProofPackFixtureV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../lib/stable-v1-migration.mjs";
import { sha256 } from "../../lib/exact-binding-common.mjs";
import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";
import {
  buildSoundNegativeObservationSources,
  resign
} from "./sound-negative-observation-v1-fixture.mjs";
import {
  buildSoundNegativeObservationEvaluationInput
} from "./sound-negative-observation-v1-profile.mjs";
import {
  EXCLUSIONS,
  GUARANTEE
} from "./sound-negative-observation-v1-constants.mjs";

const GUARANTEE_DIGEST = sha256(Buffer.from(GUARANTEE, "utf8"));

function evaluate(profile, captured, mutate = (contract, input) => ({ contract, input })) {
  const sourceContract = JSON.parse(captured.projectionBytes.toString("utf8"));
  const contract = migrateControlledAcceptanceContractV02ToV1({
    contract: sourceContract,
    testProofs: buildStableTestProofPopulation(sourceContract)
  });
  const input = buildSoundNegativeObservationEvaluationInput(contract);
  const changed = mutate(contract, input) ?? { contract, input };
  return evaluateStableProofPackFixtureV1({
    profile, contract: changed.contract, evaluation_input: changed.input
  }).satisfaction;
}

function captured(options = {}) {
  return buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 2, observationCount: 2,
    domain: "sound-negative-adequacy", ...options
  });
}

function invalidCapture(profile, id, mutate) {
  const base = captured({ domain: `mutant-${id}` });
  const evidence = structuredClone(base.evidence);
  mutate(evidence);
  try {
    return {
      control_id: id,
      category: "mutant",
      implementation_outcome: "killed",
      profile_satisfaction: evaluate(profile, resign(evidence, id))
    };
  } catch (error) {
    return {
      control_id: id,
      category: "mutant",
      implementation_outcome: error?.code?.startsWith("sound_negative_")
        ? "killed" : "survived",
      profile_satisfaction: "invalid"
    };
  }
}

function positiveControls(profile) {
  const nonempty = captured({ domain: "positive-nonempty" });
  const empty = captured({
    sourceCount: 0, observationCount: 0, domain: "positive-empty"
  });
  const unicode = captured({ unicode: true, domain: "positive-unicode" });
  const reorderedBase = captured({ domain: "positive-reordered" });
  const reorderedEvidence = structuredClone(reorderedBase.evidence);
  reorderedEvidence.declared_sources.reverse();
  reorderedEvidence.source_outcomes.reverse();
  const cases = {
    "nonempty-distinct-observation-associations": evaluate(profile, nonempty),
    "complete-empty-source-vacuity": evaluate(profile, empty),
    "unicode-identities": evaluate(profile, unicode),
    "declaration-and-property-reordering": evaluate(
      profile, resign(reorderedEvidence, "positive-reordered"), (contract, input) => ({
        contract: {
          annotations: contract.annotations,
          claims: contract.claims,
          collections: contract.collections,
          profile_id: contract.profile_id,
          propositions: contract.propositions,
          references: contract.references,
          relations: contract.relations,
          residue: contract.residue,
          schema_version: contract.schema_version,
          test_proof_version: contract.test_proof_version,
          test_proofs: contract.test_proofs,
          vocabulary_version: contract.vocabulary_version
        },
        input
      })
    ),
    "harmless-unrelated-graph-material": evaluate(profile, nonempty, (contract, input) => {
      contract.references.push({
        reference_id: "ref-adequacy-unrelated",
        type_term: "cc:evidence",
        identity: { kind: "durable_id", domain: "adequacy", value: "unrelated" }
      });
      return { contract, input };
    })
  };
  return Object.entries(cases).map(([control_id, profile_satisfaction]) => ({
    control_id,
    category: "positive",
    implementation_outcome: "passed",
    profile_satisfaction
  }));
}

function mutantControls(profile) {
  const controls = [
    {
      id: "incomplete-source-coverage",
      mutate: (evidence) => { evidence.source_outcomes.pop(); }
    },
    {
      id: "missing-endpoint",
      mutate: (evidence) => { evidence.source_outcomes[0].endpoints.pop(); }
    },
    {
      id: "duplicate-endpoint",
      mutate: (evidence) => evidence.source_outcomes[0].endpoints.push(
        structuredClone(evidence.source_outcomes[0].endpoints[1])
      )
    },
    {
      id: "state-only-endpoint-drift",
      options: { endpointVariant: "state" }
    },
    {
      id: "version-only-endpoint-drift",
      options: { endpointVariant: "version" }
    },
    {
      id: "joint-endpoint-drift",
      options: { endpointVariant: "both" }
    },
    {
      id: "malformed-observation",
      mutate: (evidence) => {
        evidence.source_outcomes[0].observations[0] = {
          kind: "malformed", raw_base64: "eA=="
        };
      }
    },
    {
      id: "unauthenticated-observation",
      mutate: (evidence) => {
        evidence.source_outcomes[0].observations[0].witnesses.authentication = "e30K";
      }
    },
    {
      id: "stale-observation",
      mutate: (evidence) => {
        evidence.source_outcomes[0].observations[0].observed_version = structuredClone(
          evidence.source_outcomes[1].endpoints[1].version
        );
      }
    },
    {
      id: "duplicated-observation",
      mutate: (evidence) => {
        evidence.source_outcomes[0].observations.push(structuredClone(
          evidence.source_outcomes[0].observations[0]
        ));
        evidence.declared_observation_total += 1;
      }
    },
    {
      id: "wrong-attempt-observation",
      mutate: (evidence) => {
        evidence.source_outcomes[0].observations[0].observation_attempt =
          structuredClone(evidence.interval.start);
      }
    },
    {
      id: "wrong-source-observation",
      mutate: (evidence) => {
        evidence.source_outcomes[0].observations[0].assigned_source =
          structuredClone(evidence.source_outcomes[1].source);
      }
    },
    {
      id: "out-of-interval-observation",
      mutate: (evidence) => {
        evidence.source_outcomes[0].observations[0].sequence =
          evidence.interval.end_sequence + 1;
      }
    }
  ];
  return controls.map(({ id, mutate, options }) => options ? {
    control_id: id,
    category: "mutant",
    implementation_outcome: "killed",
    profile_satisfaction: evaluate(profile, captured({ domain: id, ...options }))
  } : invalidCapture(profile, id, mutate));
}

function swapAssociation(contract, suffix) {
  const expressions = contract.propositions.filter(({ proposition_id: id }) =>
    new RegExp(`^prop-sno-occurrence-[0-9]+-[0-9]+-${suffix}$`, "u").test(id));
  [expressions[0].operands, expressions[1].operands] =
    [expressions[1].operands, expressions[0].operands];
}

function rejectionControls(profile) {
  const baseline = captured({ domain: "profile-rejections" });
  const controls = [
    ["present-projection", buildSoundNegativeObservationSources({
      conclusion: "present", domain: "rejection-present"
    }), null],
    ["unavailable-projection", buildSoundNegativeObservationSources({
      conclusion: "unavailable", domain: "rejection-unavailable"
    }), null],
    ["crossed-target-associations", baseline, (contract, input) => {
      swapAssociation(contract, "target"); return { contract, input };
    }],
    ["crossed-source-associations", baseline, (contract, input) => {
      swapAssociation(contract, "source"); return { contract, input };
    }],
    ["crossed-position-associations", baseline, (contract, input) => {
      swapAssociation(contract, "position"); return { contract, input };
    }],
    ["unbound-empty-population", baseline, (contract, input) => {
      input.reference_bindings = input.reference_bindings.filter(
        ({ role }) => role !== "invalidating_conditions"
      );
      return { contract, input };
    }],
    ["weakened-absent-conclusion", baseline, (contract, input) => {
      input.reference_bindings.find(({ role }) => role === "absent_conclusion")
        .reference_ids = [];
      return { contract, input };
    }]
  ];
  return controls.map(([control_id, fixture, mutate]) => ({
    control_id,
    category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: evaluate(profile, fixture, mutate ?? undefined)
  }));
}

function exclusionControls(profile) {
  const satisfaction = evaluate(profile, captured({ domain: "exclusions" }));
  return EXCLUSIONS.map((control_id) => ({
    control_id,
    category: "exclusion",
    implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: satisfaction
  }));
}

async function runProofPackAdequacyControls({ profile, profile_digest }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest,
    guarantee_digest: GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(profile),
      ...rejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export {
  GUARANTEE_DIGEST,
  runProofPackAdequacyControls
};
