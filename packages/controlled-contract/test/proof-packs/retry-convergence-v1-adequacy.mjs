import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import { buildRetryConvergenceFixture, findClaim, findProposition, ref }
  from "./retry-convergence-v1-fixture.mjs";
import { DOMAINS, MUTATIONS, executeRetryConvergence, retryConvergenceGuaranteeSatisfied }
  from "./retry-convergence-v1-harness.mjs";
const RETRY_CONVERGENCE_V1_PROFILE_DIGEST =
  "f468e56286091969fc516d849c85befc014103183711a85f8b70fc99f3b6fedd";
const RETRY_CONVERGENCE_V1_GUARANTEE_DIGEST =
  "88b5ff9ccadc6a3ede7fc63f49c5ad281d8c6ffc38b68c79b5934a56212f8dce";
const evaluateFixture = ({ contract, input, evaluation_input, profile }) =>
  evaluateVerificationProfileV034({ contract, profile, evaluation_input: evaluation_input ?? input }).satisfaction;
const baselineFixture = (profile, options = {}) => buildRetryConvergenceFixture({ profile, ...options });

function positiveControls(profile) {
  return Object.keys(DOMAINS).map((domain) => { const run = executeRetryConvergence({ domain });
    return { control_id: domain, category: "positive",
      implementation_outcome: retryConvergenceGuaranteeSatisfied(run) ? "passed" : "killed",
      profile_satisfaction: evaluateFixture(buildRetryConvergenceFixture({ profile, domain })) }; });
}
function mutantFixture(profile, mutant) {
  if (mutant === "retry-before-settlement") return baselineFixture(profile, {
    proposition_overrides: { "settlement-precedes-retry": { operator: "reference:follows" } } });
  if (mutant === "surviving-residue") return baselineFixture(profile, {
    role_id_overrides: { residue_members: ["ref-residue-survivor"] } });
  if (mutant === "failed-attempt-effect") return baselineFixture(profile, {
    modality_overrides: { "failed-attempt-no-final-effect": "MUST" } });
  if (mutant === "duplicate-final-effect") return baselineFixture(profile, {
    role_id_overrides: { final_effect_members: ["ref-final-effect", "ref-final-effect-2"] } });
  if (mutant === "different-input") return baselineFixture(profile, { mutate_contract(contract) {
    contract.references.push({ reference_id: "ref-other-input", type_term: "cc:artifact",
      identity: { kind: "durable_id", domain: "negative", value: "other-input" } });
    findProposition(contract, "retry-uses-same-input").operands = [ref("ref-other-input")];
  } });
  if (mutant === "wrong-state") return baselineFixture(profile, {
    proposition_overrides: { "final-state-equals-expected": { operator: "reference:not_equals" } } });
  return baselineFixture(profile, { drop_pattern_ids: ["success-accepts-retry"] });
}
function mutantControls(profile) { return Object.keys(MUTATIONS).map((mutant) => {
  const run = executeRetryConvergence({ mutant });
  return { control_id: mutant, category: "mutant",
    implementation_outcome: retryConvergenceGuaranteeSatisfied(run) ? "passed" : "killed",
    profile_satisfaction: evaluateFixture(mutantFixture(profile, mutant)) }; }); }

function removeClaim(contract, patternId) {
  const claim = findClaim(contract, patternId);
  const propositions = new Set([claim?.proposition_id, claim?.falsifying_proposition_id].filter(Boolean));
  contract.claims = contract.claims.filter(({ claim_id }) => claim_id !== claim?.claim_id);
  contract.propositions = contract.propositions.filter(({ proposition_id }) => !propositions.has(proposition_id));
  contract.relations = contract.relations.filter(({ source_claim_id, target_claim_id }) =>
    source_claim_id !== claim?.claim_id && target_claim_id !== claim?.claim_id);
}
function profileRejectionFixtures(profile) {
  const missing = (id) => () => baselineFixture(profile, { mutate_contract(contract) { removeClaim(contract, id); } });
  return {
    "missing-attempt-count": () => baselineFixture(profile, { mutate_contract(contract) {
      removeClaim(contract, "population-attempt-population-cardinality"); } }),
    "missing-residue-count": () => baselineFixture(profile, { mutate_contract(contract) {
      removeClaim(contract, "population-residue-population-cardinality"); } }),
    "missing-final-effect-count": () => baselineFixture(profile, { mutate_contract(contract) {
      removeClaim(contract, "population-final-effect-population-cardinality"); } }),
    "missing-settlement-before-retry": missing("settlement-precedes-retry"),
    "missing-empty-residue": missing("residue-empty-after-settlement"),
    "missing-failed-refusal": missing("failed-attempt-not-accepted"),
    "missing-retry-success": missing("success-accepts-retry"),
    "missing-failed-no-effect": missing("failed-attempt-no-final-effect"),
    "missing-final-effect-exactly-one": missing("final-effect-count-exactly-one"),
    "missing-final-state-equality": missing("final-state-equals-expected"),
    "missing-verification-read-spine": missing("verification-reads-spine"),
    "missing-verifies-relation": () => baselineFixture(profile, { mutate_contract(contract) { contract.relations = []; } }),
    "wrong-final-state-falsifier": () => baselineFixture(profile, { proposition_overrides: {
      "falsifier:verify-final-state": { operator: "reference:equals" } } }),
    "missing-attempts-binding": () => baselineFixture(profile, { mutate_input(input) {
      input.reference_bindings = input.reference_bindings.filter(({ role }) => role !== "attempts"); } }),
    "collapsed-attempt-identities": () => baselineFixture(profile, { mutate_input(input) {
      const failed = input.reference_bindings.find(({ role }) => role === "failed_attempt");
      input.reference_bindings.find(({ role }) => role === "retry_attempt").reference_ids = [...failed.reference_ids]; } })
  };
}
const profileRejectionControls = (profile) => Object.entries(profileRejectionFixtures(profile)).map(
  ([control_id, make]) => ({ control_id, category: "profile_rejection", implementation_outcome: "not_applicable",
    profile_satisfaction: evaluateFixture(make()) }));
const EXCLUSIONS = ["arbitrary-retry-histories", "concurrency-linearizability-or-distributed-convergence",
  "effects-or-resources-outside-declared-populations", "runtime-provenance-or-honest-grounding",
  "scheduling-retry-liveness-backoff-or-fairness", "transient-effects-between-selected-observations"];
function exclusionControls(profile) { const satisfaction = evaluateFixture(baselineFixture(profile));
  return EXCLUSIONS.map((control_id) => ({ control_id, category: "exclusion",
    implementation_outcome: "boundary_demonstrated", profile_satisfaction: satisfaction })); }
async function runProofPackAdequacyControls({ profile }) { return {
  schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION, profile_id: profile.profile_id,
  profile_version: profile.profile_version, profile_digest: RETRY_CONVERGENCE_V1_PROFILE_DIGEST,
  guarantee_digest: RETRY_CONVERGENCE_V1_GUARANTEE_DIGEST,
  controls: [...positiveControls(profile), ...mutantControls(profile),
    ...profileRejectionControls(profile), ...exclusionControls(profile)] }; }
export { RETRY_CONVERGENCE_V1_GUARANTEE_DIGEST, RETRY_CONVERGENCE_V1_PROFILE_DIGEST,
  EXCLUSIONS, baselineFixture, evaluateFixture, profileRejectionFixtures,
  runProofPackAdequacyControls };
