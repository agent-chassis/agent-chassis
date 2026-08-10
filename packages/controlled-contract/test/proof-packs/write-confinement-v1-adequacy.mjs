import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import {
  buildWriteConfinementFixture,
  findClaim,
  findProposition,
  ref
} from "./write-confinement-v1-fixture.mjs";
import {
  MUTATIONS,
  executeWriteConfinement,
  writeConfinementGuaranteeSatisfied
} from "./write-confinement-v1-harness.mjs";

const WRITE_CONFINEMENT_V1_PROFILE_DIGEST =
  "907b7802d28b7798efc2b2826ac2886ad46983a714ad577434e0a9655b9229a1";
const WRITE_CONFINEMENT_V1_GUARANTEE_DIGEST =
  "d9c43a7ea270def76b5255705d0dbf7285b0a93343fdfa5e80c8cb0ebfb07134";

const targetReferenceId = (target) =>
  `ref-${target.replaceAll(/[^a-zA-Z0-9-]/gu, "-")}`;

function evaluateFixture({ contract, input, evaluation_input: evaluationInput, profile }) {
  return evaluateVerificationProfileV034({
    contract,
    profile,
    evaluation_input: evaluationInput ?? input
  }).satisfaction;
}

function fixtureForExecution(profile, execution, options = {}) {
  return buildWriteConfinementFixture({
    profile,
    domain: execution.domain,
    observed: execution.declaredObserved.map(targetReferenceId),
    authorized: execution.declaredAuthorized.map(targetReferenceId),
    observed_count: execution.observedCount,
    authorized_count: execution.authorizedCount,
    ...options
  });
}

function baselineExecution(domain = "filesystem") {
  return executeWriteConfinement({ domain });
}

function baselineFixture(profile, options = {}) {
  return fixtureForExecution(profile, baselineExecution(), options);
}

function positiveControls(profile) {
  const controls = ["filesystem", "database", "kubernetes"].map((domain) => {
    const execution = baselineExecution(domain);
    return {
      control_id: `${domain}-declared-population`,
      category: "positive",
      implementation_outcome: writeConfinementGuaranteeSatisfied(execution)
        ? "passed"
        : "killed",
      profile_satisfaction: evaluateFixture(fixtureForExecution(profile, execution))
    };
  });
  const emptyObserved = {
    domain: "empty-observed",
    observed: [], authorized: ["target:allowed"],
    declaredObserved: [], declaredAuthorized: ["target:allowed"],
    observedCount: 0, authorizedCount: 1
  };
  const bothEmpty = {
    domain: "both-empty",
    observed: [], authorized: [], declaredObserved: [], declaredAuthorized: [],
    observedCount: 0, authorizedCount: 0
  };
  for (const [controlId, execution] of [
    ["empty-observed-population", emptyObserved],
    ["both-populations-empty", bothEmpty]
  ]) controls.push({
    control_id: controlId,
    category: "positive",
    implementation_outcome: writeConfinementGuaranteeSatisfied(execution)
      ? "passed"
      : "killed",
    profile_satisfaction: evaluateFixture(fixtureForExecution(profile, execution))
  });
  return controls;
}

function mutantControls(profile) {
  return Object.keys(MUTATIONS).map((mutant) => {
    const execution = executeWriteConfinement({
      domain: mutant.includes("authorized") ? "database" : "filesystem",
      mutant
    });
    return {
      control_id: mutant,
      category: "mutant",
      implementation_outcome: writeConfinementGuaranteeSatisfied(execution)
        ? "passed"
        : "killed",
      profile_satisfaction: evaluateFixture(fixtureForExecution(profile, execution))
    };
  });
}

function removeClaimAndProposition(contract, claimId) {
  const claim = contract.claims.find(({ claim_id: id }) => id === claimId);
  const propositionIds = new Set([
    claim?.proposition_id,
    claim?.falsifying_proposition_id
  ].filter(Boolean));
  contract.claims = contract.claims.filter(({ claim_id: id }) => id !== claimId);
  contract.propositions = contract.propositions.filter(
    ({ proposition_id: id }) => !propositionIds.has(id)
  );
}

function profileRejectionFixtures(profile) {
  return {
    "missing-observed-population-count": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaimAndProposition(contract, "claim-observed-population-count");
      }
    }),
    "missing-authorized-population-count": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaimAndProposition(contract, "claim-authorized-scope-count");
      }
    }),
    "missing-execution-population-link": () => baselineFixture(profile, {
      drop_pattern_ids: ["execution-emits-observed-population"]
    }),
    "wrong-execution-population-link": () => baselineFixture(profile, {
      role_id_overrides: { execution: ["ref-execution"] },
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-other-execution",
          type_term: "cc:process",
          identity: { kind: "durable_id", domain: "negative", value: "other-execution" }
        });
        findProposition(contract, "execution-emits-observed-population")
          .subject_reference_id = "ref-other-execution";
      }
    }),
    "missing-subset-behavior": () => baselineFixture(profile, {
      drop_pattern_ids: ["observed-mutations-within-authorized-scope"]
    }),
    "subset-replaced-by-equality": () => baselineFixture(profile, {
      proposition_overrides: {
        "observed-mutations-within-authorized-scope": { operator: "reference:equals" }
      }
    }),
    "missing-verification-read-spine": () => baselineFixture(profile, {
      drop_pattern_ids: ["verification-reads-execution-and-populations"]
    }),
    "status-only-verification": () => baselineFixture(profile, {
      mutate_contract(contract) {
        const proposition = findProposition(
          contract, "verification-reads-execution-and-populations"
        );
        contract.references.push({
          reference_id: "ref-success-status",
          type_term: "cc:state",
          identity: { kind: "profile_term", term: "success" }
        });
        proposition.operands = [ref("ref-success-status")];
      }
    }),
    "missing-write-confinement-verification": () => baselineFixture(profile, {
      drop_pattern_ids: ["write-confinement-verification"]
    }),
    "missing-verifies-relation": () => baselineFixture(profile, {
      mutate_contract(contract) { contract.relations = []; }
    }),
    "wrong-falsifier-operator": () => baselineFixture(profile, {
      proposition_overrides: {
        "falsifier:write-confinement-verification": { operator: "reference:subset_of" }
      }
    }),
    "unscoped-falsifier": () => baselineFixture(profile, {
      proposition_overrides: {
        "falsifier:write-confinement-verification": {
          applicability_context: { mode: "unconditional", operand_reference_ids: [] }
        }
      }
    }),
    "missing-execution-binding": () => baselineFixture(profile, {
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(
          ({ role }) => role !== "execution"
        );
      }
    }),
    "missing-observed-population-binding": () => baselineFixture(profile, {
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(
          ({ role }) => role !== "observed_population"
        );
      }
    }),
    "missing-authorized-scope-binding": () => baselineFixture(profile, {
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(
          ({ role }) => role !== "authorized_scope"
        );
      }
    }),
    "collapsed-population-identities": () => baselineFixture(profile, {
      mutate_input(input) {
        const observed = input.reference_bindings.find(
          ({ role }) => role === "observed_population"
        );
        input.reference_bindings.find(
          ({ role }) => role === "authorized_scope"
        ).reference_ids = [...observed.reference_ids];
      }
    }),
    "missing-condition-binding": () => baselineFixture(profile, {
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(
          ({ role }) => role !== "unauthorized_mutation_condition"
        );
      }
    })
  };
}

function profileRejectionControls(profile) {
  return Object.entries(profileRejectionFixtures(profile)).map(
    ([controlId, makeFixture]) => ({
      control_id: controlId,
      category: "profile_rejection",
      implementation_outcome: "not_applicable",
      profile_satisfaction: evaluateFixture(makeFixture())
    })
  );
}

function exclusionControls(profile) {
  const baseline = baselineFixture(profile);
  const satisfaction = evaluateFixture(baseline);
  const declaredObserved = ["target:allowed"];
  const hiddenObserved = ["target:allowed", "target:hidden-or-transient"];
  const authorized = new Set(["target:allowed"]);
  const localIsSatisfied = declaredObserved.every((target) => authorized.has(target));
  const hiddenWouldFail = !hiddenObserved.every((target) => authorized.has(target));
  const demonstrations = {
    "observation-completeness-beyond-caller-declaration":
      satisfaction === "satisfied" && localIsSatisfied && hiddenWouldFail,
    "snapshot-producer-provenance":
      satisfaction === "satisfied" && baseline.input.delivered_evidence.length === 0,
    "causal-attribution-of-mutations-to-execution": satisfaction === "satisfied",
    "undiscovered-transient-reverted-or-concurrent-mutations":
      satisfaction === "satisfied" && hiddenWouldFail,
    "runtime-target-existence-or-truth": satisfaction === "satisfied",
    "authorized-population-authenticity-and-completeness": satisfaction === "satisfied",
    "prevention-or-rollback-of-unauthorized-mutation": satisfaction === "satisfied",
    "exact-binding-or-launcher-owned-observation":
      satisfaction === "satisfied" && baseline.input.resolver_facts.length === 0
  };
  return Object.entries(demonstrations).map(([controlId, demonstrated]) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: demonstrated ? "boundary_demonstrated" : "not_applicable",
    profile_satisfaction: satisfaction
  }));
}

async function runProofPackAdequacyControls({ profile }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: WRITE_CONFINEMENT_V1_PROFILE_DIGEST,
    guarantee_digest: WRITE_CONFINEMENT_V1_GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(profile),
      ...profileRejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export {
  WRITE_CONFINEMENT_V1_GUARANTEE_DIGEST,
  WRITE_CONFINEMENT_V1_PROFILE_DIGEST,
  baselineFixture,
  evaluateFixture,
  fixtureForExecution,
  profileRejectionFixtures,
  runProofPackAdequacyControls
};
