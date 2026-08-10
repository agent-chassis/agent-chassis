import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import {
  SINGLE_WINNER_EFFECT_V1_PROFILE,
  buildSingleWinnerEffectFixture,
  findClaim,
  findProposition,
  ref
} from "./single-winner-effect-v1-fixture.mjs";
import {
  DOMAINS,
  LEGITIMATE_VARIANTS,
  MUTATIONS,
  executeSingleWinnerEffect,
  singleWinnerEffectGuaranteeSatisfied
} from "./single-winner-effect-v1-harness.mjs";

const SINGLE_WINNER_EFFECT_V1_PROFILE_DIGEST =
  "cef87caccfe055e2343e1ed5140eb11afce7c5ade24c1e3ffbb25d14dddf9e95";
const SINGLE_WINNER_EFFECT_V1_GUARANTEE_DIGEST =
  "defcedac8d42c9dde51822e911be1f334993db004b4bb9f174e6b0f1ddc38e4c";

const evaluateFixture = ({ contract, input, evaluation_input, profile }) =>
  evaluateVerificationProfileV034({
    contract,
    profile,
    evaluation_input: evaluation_input ?? input
  }).satisfaction;

const baselineFixture = (profile = SINGLE_WINNER_EFFECT_V1_PROFILE, options = {}) =>
  buildSingleWinnerEffectFixture({ profile, ...options });

function positiveControls(profile) {
  const domains = Object.keys(DOMAINS).map((domain) => ({
    control_id: domain,
    execution: executeSingleWinnerEffect({ domain }),
    fixture: baselineFixture(profile, { domain })
  }));
  const variants = Object.keys(LEGITIMATE_VARIANTS).map((variant) => ({
    control_id: `variant-${variant}`,
    execution: executeSingleWinnerEffect({
      domain: "database-unique-insert", variant
    }),
    fixture: baselineFixture(profile, { domain: `variant-${variant}` })
  }));
  return [...domains, ...variants].map(({ control_id, execution, fixture }) => ({
    control_id,
    category: "positive",
    implementation_outcome: singleWinnerEffectGuaranteeSatisfied(execution)
      ? "passed" : "killed",
    profile_satisfaction: evaluateFixture(fixture)
  }));
}

function mutantFixture(profile, mutant) {
  if (mutant === "serialized-loser-start") return baselineFixture(profile, {
    proposition_overrides: {
      "loser-start-before-terminals": {
        operator: "reference:follows",
        operands: [ref("ref-winner-terminal")]
      }
    }
  });
  if (mutant === "both-succeed") return baselineFixture(profile, {
    modality_overrides: { "loser-not-accepted": "MUST" }
  });
  if (mutant === "both-refuse") return baselineFixture(profile, {
    modality_overrides: { "winner-not-rejected": "MUST" }
  });
  if (mutant === "duplicate-effect") return baselineFixture(profile, {
    role_id_overrides: {
      effect_occurrences: ["ref-effect-occurrence", "ref-effect-occurrence-two"]
    },
    number_value_overrides: { effect_count: 2 }
  });
  if (mutant === "wrong-winner-effect") return baselineFixture(profile, {
    proposition_overrides: {
      "winner-creates-effect": { subject_reference_id: "ref-loser-attempt" }
    }
  });
  if (mutant === "loser-state-diverges") return baselineFixture(profile, {
    proposition_overrides: {
      "loser-state-equals-winner": { operator: "reference:not_equals" }
    }
  });
  return baselineFixture(profile, {
    mutate_contract(contract) {
      contract.references.push({
        reference_id: "ref-other-resource",
        type_term: "cc:resource",
        identity: { kind: "durable_id", domain: "negative", value: "other-resource" }
      });
      findProposition(contract, "loser-observation-reads-resource").operands = [
        ref("ref-other-resource")
      ];
    }
  });
}

function mutantControls(profile) {
  return Object.keys(MUTATIONS).map((mutant) => {
    const execution = executeSingleWinnerEffect({
      domain: "database-unique-insert", mutant
    });
    return {
      control_id: mutant,
      category: "mutant",
      implementation_outcome: singleWinnerEffectGuaranteeSatisfied(execution)
        ? "passed" : "killed",
      profile_satisfaction: evaluateFixture(mutantFixture(profile, mutant))
    };
  });
}

function removeClaim(contract, patternId) {
  const claim = findClaim(contract, patternId);
  const propositionIds = new Set([
    claim?.proposition_id,
    claim?.falsifying_proposition_id
  ].filter(Boolean));
  contract.claims = contract.claims.filter(
    ({ claim_id: claimId }) => claimId !== claim?.claim_id
  );
  contract.propositions = contract.propositions.filter(
    ({ proposition_id: propositionId }) => !propositionIds.has(propositionId)
  );
  contract.relations = contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      source !== claim?.claim_id && target !== claim?.claim_id
  );
}

function profileRejectionFixtures(profile) {
  const missingClaim = (patternId) => () => baselineFixture(profile, {
    mutate_contract(contract) { removeClaim(contract, patternId); }
  });
  return {
    "missing-attempt-population-count": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaim(contract, "population-attempt-population-cardinality");
      }
    }),
    "wrong-attempt-count": () => baselineFixture(profile, {
      number_value_overrides: { attempt_count: 3 }
    }),
    "serialized-plan": () => mutantFixture(profile, "serialized-loser-start"),
    "winner-start-before-own-terminal-only": () => baselineFixture(profile, {
      proposition_overrides: {
        "winner-start-before-terminals": {
          operands: [ref("ref-winner-terminal")]
        }
      }
    }),
    "loser-start-before-own-terminal-only": () => baselineFixture(profile, {
      proposition_overrides: {
        "loser-start-before-terminals": {
          operands: [ref("ref-loser-terminal")]
        }
      }
    }),
    "missing-winner-acceptance": missingClaim("winner-terminal-accepts"),
    "missing-loser-refusal": missingClaim("loser-terminal-rejects"),
    "missing-complete-effect-population": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaim(contract, "population-effect-population-cardinality");
      }
    }),
    "duplicate-complete-effect-population": () => mutantFixture(profile, "duplicate-effect"),
    "missing-winner-effect-attribution": missingClaim("winner-creates-effect"),
    "missing-loser-noncreation": missingClaim("loser-does-not-create-effect"),
    "missing-effect-count": missingClaim("effect-count-exactly-one"),
    "missing-common-resource-read-spine": missingClaim("observations-read-resource"),
    "missing-loser-state-equality": missingClaim("loser-state-equals-winner"),
    "missing-verifies-relation": () => baselineFixture(profile, {
      mutate_contract(contract) { contract.relations = []; }
    }),
    "wrong-winner-falsifier": () => baselineFixture(profile, {
      proposition_overrides: {
        "falsifier:verify-winner-success": { operator: "reference:accepts" }
      }
    }),
    "missing-attempt-population-binding": () => baselineFixture(profile, {
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(
          ({ role }) => role !== "attempts"
        );
      }
    }),
    "collapsed-attempt-identities": () => baselineFixture(profile, {
      mutate_input(input) {
        const winner = input.reference_bindings.find(
          ({ role }) => role === "winner_attempt"
        ).reference_ids;
        input.reference_bindings.find(
          ({ role }) => role === "loser_attempt"
        ).reference_ids = [...winner];
      }
    })
  };
}

function profileRejectionControls(profile) {
  return Object.entries(profileRejectionFixtures(profile)).map(
    ([controlId, make]) => ({
      control_id: controlId,
      category: "profile_rejection",
      implementation_outcome: "not_applicable",
      profile_satisfaction: evaluateFixture(make())
    })
  );
}

const EXCLUSIONS = Object.freeze([
  "arbitrary-histories-beyond-two-attempts",
  "hidden-or-out-of-population-effects",
  "runtime-clock-or-event-order-truth",
  "runtime-grounding-or-trace-truth",
  "transient-duplicate-and-restore"
]);

function exclusionControls(profile) {
  const satisfaction = evaluateFixture(baselineFixture(profile));
  return EXCLUSIONS.map((controlId) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: satisfaction
  }));
}

async function runProofPackAdequacyControls({ profile }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: SINGLE_WINNER_EFFECT_V1_PROFILE_DIGEST,
    guarantee_digest: SINGLE_WINNER_EFFECT_V1_GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(profile),
      ...profileRejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export {
  EXCLUSIONS,
  SINGLE_WINNER_EFFECT_V1_GUARANTEE_DIGEST,
  SINGLE_WINNER_EFFECT_V1_PROFILE_DIGEST,
  baselineFixture,
  evaluateFixture,
  mutantFixture,
  profileRejectionFixtures,
  runProofPackAdequacyControls
};
