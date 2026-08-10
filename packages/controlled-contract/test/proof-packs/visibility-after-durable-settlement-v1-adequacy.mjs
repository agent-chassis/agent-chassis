import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import { buildVisibilityAfterDurableSettlementFixture, findClaim, findProposition, ref }
  from "./visibility-after-durable-settlement-v1-fixture.mjs";
import { DOMAINS, MUTATIONS, executeVisibilityAfterDurableSettlement,
  visibilityAfterDurableSettlementGuaranteeSatisfied }
  from "./visibility-after-durable-settlement-v1-harness.mjs";

const VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE_DIGEST =
  "1c764fe711c13484c5c43a6600b79c29ecc3f5fb848262689fc313547583d6fc";
const VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_GUARANTEE_DIGEST =
  "04ce2d798103d1c8c32829cffd34c148c3ca710c0c0f4a016ee1d1945863351c";

const referenceId = (value) => `ref-${value.replaceAll(/[^a-zA-Z0-9-]/gu, "-")}`;
const evaluateFixture = ({ contract, input, evaluation_input, profile }) =>
  evaluateVerificationProfileV034({ contract, profile, evaluation_input: evaluation_input ?? input }).satisfaction;

function fixtureForExecution(profile, execution, extra = {}) {
  const durable = execution.durable.map(referenceId);
  const settled = execution.settled.map(referenceId);
  const failure = execution.failureVisibility.map(referenceId);
  const options = { profile, domain: execution.domain, role_id_overrides: {
    durable_effects: durable, settled_effects: settled, failure_visibility_events: failure
  }, number_value_overrides: { effect_count: durable.length }, ...extra };
  return buildVisibilityAfterDurableSettlementFixture(options);
}

const baselineFixture = (profile, options = {}) => fixtureForExecution(
  profile, executeVisibilityAfterDurableSettlement(), options);

function positiveControls(profile) {
  return Object.keys(DOMAINS).map((domain) => {
    const execution = executeVisibilityAfterDurableSettlement({ domain });
    return { control_id: domain, category: "positive",
      implementation_outcome: visibilityAfterDurableSettlementGuaranteeSatisfied(execution) ? "passed" : "killed",
      profile_satisfaction: evaluateFixture(fixtureForExecution(profile, execution)) };
  });
}

function mutantFixture(profile, mutant) {
  const execution = executeVisibilityAfterDurableSettlement({ domain: "workflow-ack", mutant });
  if (mutant === "ack-before-settlement") return fixtureForExecution(profile, execution, {
    modality_overrides: { "visibility-does-not-precede-settlement": "MUST" }
  });
  if (mutant === "stale-observation") return fixtureForExecution(profile, execution, {
    proposition_overrides: { "post-visibility-state-current": { operator: "reference:not_equals" } }
  });
  if (mutant === "wrong-subject") return fixtureForExecution(profile, execution, {
    mutate_contract(contract) {
      contract.references.push({ reference_id: "ref-other-population", type_term: "cc:population",
        identity: { kind: "durable_id", domain: "negative", value: "other-population" } });
      findProposition(contract, "post-observation-reads-effects").operands = [ref("ref-other-population")];
    }
  });
  if (mutant === "status-only") return fixtureForExecution(profile, execution, {
    mutate_contract(contract) {
      contract.references.push({ reference_id: "ref-success-status", type_term: "cc:state",
        identity: { kind: "profile_term", term: "success" } });
      findProposition(contract, "verification-reads-complete-proof").operands = [ref("ref-success-status")];
    }
  });
  return fixtureForExecution(profile, execution);
}

function mutantControls(profile) {
  return Object.keys(MUTATIONS).map((mutant) => {
    const execution = executeVisibilityAfterDurableSettlement({ domain: "workflow-ack", mutant });
    return { control_id: mutant, category: "mutant",
      implementation_outcome: visibilityAfterDurableSettlementGuaranteeSatisfied(execution) ? "passed" : "killed",
      profile_satisfaction: evaluateFixture(mutantFixture(profile, mutant)) };
  });
}

function removeClaim(contract, patternId) {
  const claim = findClaim(contract, patternId);
  const propositionIds = new Set([claim?.proposition_id, claim?.falsifying_proposition_id].filter(Boolean));
  contract.claims = contract.claims.filter(({ claim_id }) => claim_id !== claim?.claim_id);
  contract.propositions = contract.propositions.filter(({ proposition_id }) => !propositionIds.has(proposition_id));
  contract.relations = contract.relations.filter(({ source_claim_id, target_claim_id }) =>
    source_claim_id !== claim?.claim_id && target_claim_id !== claim?.claim_id);
}

function profileRejectionFixtures(profile) {
  const missingClaim = (id) => () => baselineFixture(profile, {
    mutate_contract(contract) { removeClaim(contract, id); }
  });
  return {
    "missing-durable-population-count": () => baselineFixture(profile, { mutate_contract(contract) {
      removeClaim(contract, "population-durable-effect-population-cardinality");
    } }),
    "missing-settled-population-count": () => baselineFixture(profile, { mutate_contract(contract) {
      removeClaim(contract, "population-settled-effect-population-cardinality");
    } }),
    "missing-durable-subset-behavior": missingClaim("durable-effects-within-settled-effects"),
    "missing-settled-subset-behavior": missingClaim("settled-effects-within-durable-effects"),
    "missing-per-effect-settlement-state": () => baselineFixture(profile, { mutate_contract(contract) {
      const claim = contract.claims.find(({ claim_id }) =>
        claim_id.startsWith("claim-each-settled-effect-has-selected-state-"));
      const propositionIds = new Set([claim?.proposition_id].filter(Boolean));
      contract.claims = contract.claims.filter(({ claim_id }) => claim_id !== claim?.claim_id);
      contract.propositions = contract.propositions.filter(
        ({ proposition_id }) => !propositionIds.has(proposition_id));
    } }),
    "missing-visibility-order": missingClaim("visibility-does-not-precede-settlement"),
    "missing-observation-order": missingClaim("post-observation-does-not-precede-visibility"),
    "missing-current-state": missingClaim("post-visibility-state-current"),
    "missing-failure-empty": missingClaim("failure-visibility-population-empty"),
    "missing-read-spine": missingClaim("verification-reads-complete-proof"),
    "missing-verifies-relation": () => baselineFixture(profile, { mutate_contract(contract) { contract.relations = []; } }),
    "wrong-visibility-falsifier": () => baselineFixture(profile, { proposition_overrides: {
      "falsifier:visibility-order-verification": { operator: "reference:not_precedes" }
    } }),
    "unscoped-visibility-falsifier": () => baselineFixture(profile, { proposition_overrides: {
      "falsifier:visibility-order-verification": { applicability_context: { mode: "unconditional", operand_reference_ids: [] } }
    } }),
    "missing-durable-effects-binding": () => baselineFixture(profile, { mutate_input(input) {
      input.reference_bindings = input.reference_bindings.filter(({ role }) => role !== "durable_effects");
    } }),
    "missing-settled-effects-binding": () => baselineFixture(profile, { mutate_input(input) {
      input.reference_bindings = input.reference_bindings.filter(({ role }) => role !== "settled_effects");
    } }),
    "collapsed-event-identities": () => baselineFixture(profile, { mutate_input(input) {
      const settlement = input.reference_bindings.find(({ role }) => role === "settlement_event");
      input.reference_bindings.find(({ role }) => role === "visibility_event").reference_ids = [...settlement.reference_ids];
    } })
  };
}

const profileRejectionControls = (profile) => Object.entries(profileRejectionFixtures(profile)).map(
  ([control_id, make]) => ({ control_id, category: "profile_rejection",
    implementation_outcome: "not_applicable", profile_satisfaction: evaluateFixture(make()) }));

function exclusionControls(profile) {
  const satisfaction = evaluateFixture(baselineFixture(profile));
  return ["dishonest-grounding-or-self-authored-evidence", "eventual-visibility-liveness",
    "heterogeneous-arbitrary-effect-to-state-pairing", "runtime-clock-or-event-order-truth",
    "runtime-identity-or-population-truth", "runtime-state-or-observation-truth"].map((control_id) => ({
      control_id, category: "exclusion", implementation_outcome: "boundary_demonstrated",
      profile_satisfaction: satisfaction
    }));
}

async function runProofPackAdequacyControls({ profile }) {
  return { schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION, profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE_DIGEST,
    guarantee_digest: VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_GUARANTEE_DIGEST,
    controls: [...positiveControls(profile), ...mutantControls(profile),
      ...profileRejectionControls(profile), ...exclusionControls(profile)] };
}

export { VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_GUARANTEE_DIGEST,
  VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE_DIGEST, baselineFixture,
  evaluateFixture, fixtureForExecution, profileRejectionFixtures,
  runProofPackAdequacyControls };
