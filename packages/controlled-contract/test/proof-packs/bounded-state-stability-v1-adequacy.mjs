import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateStableProofPackFixtureV1 } from "../support/stable-v1-proof-pack-runtime.mjs";
import {
  BOUNDED_STATE_STABILITY_V1_PROFILE,
  buildBoundedStateStabilityFixture,
  findClaim,
  findProposition,
  ref
} from "./bounded-state-stability-v1-fixture.mjs";
import {
  DOMAINS,
  LEGITIMATE_VARIANTS,
  MUTATIONS,
  executeBoundedStateStability,
  boundedStateStabilityGuaranteeSatisfied
} from "./bounded-state-stability-v1-harness.mjs";
import {
  endpointOnlyContract,
  p8ArtifactComparisonOnlyContract,
  statusOnlyContract,
  wrongSubjectContract
} from "./bounded-state-stability-v1-independent-negatives.mjs";

const BOUNDED_STATE_STABILITY_V1_PROFILE_DIGEST =
  "291b3db05293848c9cbbd7256fbff4c7e89df0522fccec436a183b421dfeebb9";
const BOUNDED_STATE_STABILITY_V1_GUARANTEE_DIGEST =
  "f83f797c792540d6085598adc202a6f6fb603bc3bc7bd324245e454113d709cd";

const evaluateFixture = ({ contract, input, evaluation_input, profile }) =>
  evaluateStableProofPackFixtureV1({ contract, profile,
    evaluation_input: evaluation_input ?? input }).satisfaction;
const baselineFixture = (profile = BOUNDED_STATE_STABILITY_V1_PROFILE, options = {}) =>
  buildBoundedStateStabilityFixture({ profile, ...options });

function positiveControls(profile) {
  const domains = Object.entries(DOMAINS).map(([domain, definition]) => ({
    control_id: domain,
    execution: executeBoundedStateStability({ domain }),
    fixture: baselineFixture(profile, { domain, observation_count: definition.observationCount,
      subject_type: definition.subjectType })
  }));
  const variants = Object.keys(LEGITIMATE_VARIANTS).map((variant) => ({
    control_id: `variant-${variant}`,
    execution: executeBoundedStateStability({
      domain: "cancellation-survivor-window", variant
    }),
    fixture: baselineFixture(profile, { domain: `variant-${variant}`, observation_count: 3 })
  }));
  return [...domains, ...variants].map(({ control_id, execution, fixture }) => ({
    control_id, category: "positive",
    implementation_outcome: boundedStateStabilityGuaranteeSatisfied(execution)
      ? "passed" : "killed",
    profile_satisfaction: evaluateFixture(fixture)
  }));
}

function addReference(contract, id, type = "cc:state") {
  contract.references.push({ reference_id: id, type_term: type,
    identity: { kind: "durable_id", domain: "bounded-state-stability:negative",
      value: id.slice(4) } });
}

function mutantFixture(profile, mutant) {
  if (mutant === "in-population-state-regression") return baselineFixture(profile, {
    observation_count: 3,
    mutate_contract(contract) {
      addReference(contract, "ref-regressed-state");
      findProposition(contract, "each-observation-records-baseline-state", 2).operands = [
        ref("ref-regressed-state")
      ];
    }
  });
  if (mutant === "wrong-subject-observation") return baselineFixture(profile, {
    observation_count: 3,
    mutate_contract(contract) {
      addReference(contract, "ref-other-subject", "cc:resource");
      findProposition(contract, "each-observation-reads-subject", 3).operands = [
        ref("ref-other-subject")
      ];
    }
  });
  if (mutant === "observation-before-start") return baselineFixture(profile, {
    observation_count: 3,
    proposition_overrides: {
      "start-before-each-observation": { operator: "reference:follows" }
    }
  });
  if (mutant === "observation-after-end") return baselineFixture(profile, {
    observation_count: 3,
    proposition_overrides: {
      "each-observation-before-end": { operator: "reference:follows" }
    }
  });
  return baselineFixture(profile, {
    observation_count: 3,
    mutate_contract(contract) {
      findProposition(contract, "population-observation-population-contains").operands.pop();
      findProposition(contract, "population-observation-population-cardinality")
        .operands[0].value = 2;
    }
  });
}

function mutantControls(profile) {
  return Object.keys(MUTATIONS).map((mutant) => {
    const execution = executeBoundedStateStability({
      domain: "cancellation-survivor-window", mutant
    });
    return { control_id: mutant, category: "mutant",
      implementation_outcome: boundedStateStabilityGuaranteeSatisfied(execution)
        ? "passed" : "killed",
      profile_satisfaction: evaluateFixture(mutantFixture(profile, mutant)) };
  });
}

function removeClaim(contract, patternId, index) {
  const claim = findClaim(contract, patternId, index);
  if (!claim) return;
  const propositionIds = new Set([claim.proposition_id, claim.falsifying_proposition_id]
    .filter(Boolean));
  contract.claims = contract.claims.filter(({ claim_id }) => claim_id !== claim.claim_id);
  contract.propositions = contract.propositions.filter(
    ({ proposition_id }) => !propositionIds.has(proposition_id)
  );
  contract.relations = contract.relations.filter(
    ({ source_claim_id, target_claim_id }) =>
      source_claim_id !== claim.claim_id && target_claim_id !== claim.claim_id
  );
}

function independentFixture(profile, makeContract) {
  const base = baselineFixture(profile, { observation_count: 2 });
  return { contract: makeContract(), input: base.input, evaluation_input: base.input, profile };
}

function profileRejectionFixtures(profile) {
  return {
    "independent-endpoint-only": () => independentFixture(profile, endpointOnlyContract),
    "independent-wrong-subject": () => independentFixture(profile, wrongSubjectContract),
    "independent-status-only": () => independentFixture(profile, statusOnlyContract),
    "independent-p8-artifact-comparison-only": () =>
      independentFixture(profile, p8ArtifactComparisonOnlyContract),
    "zero-observation-population": () => baselineFixture(profile, {
      role_id_overrides: { observations: [] },
      number_value_overrides: { observation_count: 0 }
    }),
    "missing-baseline-at-start": () => baselineFixture(profile, {
      mutate_contract(contract) { removeClaim(contract, "subject-has-baseline-state-at-start"); }
    }),
    "unordered-boundaries": () => baselineFixture(profile, {
      proposition_overrides: { "start-precedes-end": { operator: "reference:follows" } }
    }),
    "missing-start-order-for-one-observation": () => baselineFixture(profile, {
      observation_count: 2,
      mutate_contract(contract) { removeClaim(contract, "start-before-each-observation", 2); }
    }),
    "missing-end-order-for-one-observation": () => baselineFixture(profile, {
      observation_count: 2,
      mutate_contract(contract) { removeClaim(contract, "each-observation-before-end", 2); }
    }),
    "missing-record-for-one-observation": () => baselineFixture(profile, {
      observation_count: 2,
      mutate_contract(contract) {
        removeClaim(contract, "each-observation-records-baseline-state", 2);
      }
    }),
    "missing-read-for-one-observation": () => baselineFixture(profile, {
      observation_count: 2,
      mutate_contract(contract) { removeClaim(contract, "each-observation-reads-subject", 2); }
    }),
    "missing-baseline-population-member": () => baselineFixture(profile, {
      mutate_contract(contract) { removeClaim(contract, "baseline-state-is-complete-member"); }
    }),
    "missing-population-equality": () => baselineFixture(profile, {
      mutate_contract(contract) { removeClaim(contract, "observed-states-equal-baseline-state"); }
    }),
    "missing-verification-read-spine": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaim(contract, "verification-reads-bounded-state-proof");
      }
    }),
    "missing-verifies-relation": () => baselineFixture(profile, {
      mutate_contract(contract) { contract.relations = []; }
    }),
    "wrong-regression-falsifier": () => baselineFixture(profile, {
      proposition_overrides: {
        "falsifier:bounded-state-stability-verification": { operator: "reference:equals" }
      }
    }),
    "missing-observations-binding": () => baselineFixture(profile, {
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(
          ({ role }) => role !== "observations"
        );
      }
    }),
    "collapsed-boundary-identities": () => baselineFixture(profile, {
      role_id_overrides: {
        start_boundary: ["ref-shared-boundary"], end_boundary: ["ref-shared-boundary"]
      }
    }),
    "missing-complete-observation-population": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaim(contract, "population-observation-population-cardinality");
        removeClaim(contract, "population-observation-population-contains");
      }
    })
  };
}

function profileRejectionControls(profile) {
  return Object.entries(profileRejectionFixtures(profile)).map(([controlId, make]) => ({
    control_id: controlId, category: "profile_rejection",
    implementation_outcome: "not_applicable", profile_satisfaction: evaluateFixture(make())
  }));
}

const EXCLUSIONS = Object.freeze([
  "behavior-before-start-or-after-end",
  "dishonest-identity-role-population-boundary-state-or-evidence-grounding",
  "external-actor-noninterference",
  "forever-after-stability-or-liveness",
  "observations-or-behavior-outside-the-complete-declared-population",
  "real-time-truth-or-clock-accuracy",
  "transient-state-between-declared-observations"
]);

function exclusionControls(profile) {
  const satisfaction = evaluateFixture(baselineFixture(profile));
  return EXCLUSIONS.map((controlId) => ({ control_id: controlId, category: "exclusion",
    implementation_outcome: "boundary_demonstrated", profile_satisfaction: satisfaction }));
}

async function runProofPackAdequacyControls({ profile }) {
  return { schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id, profile_version: profile.profile_version,
    profile_digest: BOUNDED_STATE_STABILITY_V1_PROFILE_DIGEST,
    guarantee_digest: BOUNDED_STATE_STABILITY_V1_GUARANTEE_DIGEST,
    controls: [...positiveControls(profile), ...mutantControls(profile),
      ...profileRejectionControls(profile), ...exclusionControls(profile)] };
}

export { BOUNDED_STATE_STABILITY_V1_GUARANTEE_DIGEST,
  BOUNDED_STATE_STABILITY_V1_PROFILE_DIGEST, EXCLUSIONS, baselineFixture,
  evaluateFixture, mutantFixture, profileRejectionFixtures,
  runProofPackAdequacyControls };
