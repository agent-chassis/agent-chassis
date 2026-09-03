import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateStableProofPackFixtureV1 } from "../support/stable-v1-proof-pack-runtime.mjs";
import { buildBoundedIntervalNonmutationFixture, findClaim, findProposition, ref }
  from "./bounded-interval-nonmutation-v1-fixture.mjs";
import { DOMAINS, MUTATIONS, executeBoundedIntervalNonmutation,
  boundedIntervalNonmutationGuaranteeSatisfied } from "./bounded-interval-nonmutation-v1-harness.mjs";
const BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE_DIGEST =
  "8c6a652caed365b0e92292de52fa932fc6cd52b2d7de03c8c15758f616d8689b";
const BOUNDED_INTERVAL_NONMUTATION_V1_GUARANTEE_DIGEST =
  "939c6810e54a1ca2b6174e13bdd12bebec13f923159f57cd7ee6c752b4e42fee";
const EXCLUSIONS = ["actions-outside-the-declared-interval", "delete-or-create-unless-represented-as-write-or-mutation",
  "dishonest-identities-populations-intervals-or-grounding", "real-time-clock-trace-or-evidence-truth",
  "trace-omissions-or-unreported-transient-activity", "undiscovered-actors-or-protected-resources"];
const evaluateFixture = ({ contract, input, evaluation_input, profile }) =>
  evaluateStableProofPackFixtureV1({ contract, profile, evaluation_input: evaluation_input ?? input }).satisfaction;
const baselineFixture = (profile, options = {}) => buildBoundedIntervalNonmutationFixture({ profile, ...options });

function positiveControls(profile) { return Object.keys(DOMAINS).map((domain) => {
  const run = executeBoundedIntervalNonmutation({ domain });
  const resources = run.resources.map((_, index) => `ref-resource-${index + 1}`);
  return { control_id: domain, category: "positive",
    implementation_outcome: boundedIntervalNonmutationGuaranteeSatisfied(run) ? "passed" : "killed",
    profile_satisfaction: evaluateFixture(baselineFixture(profile, { domain,
      role_id_overrides: { protected_resources: resources },
      number_value_overrides: { protected_resource_count: resources.length } })) }; }); }
function mutantFixture(profile, mutant) {
  if (["during-interval-write", "mutate-then-restore"].includes(mutant)) return baselineFixture(profile, {
    modality_overrides: { "actor-does-not-write-protected-resources-during-interval": "MUST" } });
  if (mutant === "during-interval-mutation") return baselineFixture(profile, {
    modality_overrides: { "actor-does-not-mutate-protected-resources-during-interval": "MUST" } });
  if (mutant === "wrong-actor-observation") return baselineFixture(profile, { mutate_contract(contract) {
    contract.references.push({ reference_id: "ref-other-actor", type_term: "cc:actor",
      identity: { kind: "durable_id", domain: "negative", value: "other-actor" } });
    const spine = findProposition(contract, "verification-observes-exact-bounded-proof-subjects");
    spine.operands = spine.operands.map((operand) => operand.reference_id === "ref-actor"
      ? ref("ref-other-actor") : operand);
  } });
  if (mutant === "partial-protected-population") return baselineFixture(profile, {
    role_id_overrides: { protected_resources: ["ref-resource-1"] } });
  if (mutant === "collapsed-boundaries") return baselineFixture(profile, {
    role_id_overrides: { end_event: ["ref-start"] } });
  return baselineFixture(profile, { proposition_overrides: {
    "start-event-precedes-end-event": { operator: "reference:follows" } } });
}
function mutantControls(profile) { return Object.keys(MUTATIONS).map((mutant) => {
  const run = executeBoundedIntervalNonmutation({ mutant });
  return { control_id: mutant, category: "mutant",
    implementation_outcome: boundedIntervalNonmutationGuaranteeSatisfied(run) ? "passed" : "killed",
    profile_satisfaction: evaluateFixture(mutantFixture(profile, mutant)) }; }); }
function removeClaim(contract, patternId) { const claim = findClaim(contract, patternId);
  const propositions = new Set([claim?.proposition_id, claim?.falsifying_proposition_id].filter(Boolean));
  contract.claims = contract.claims.filter(({ claim_id }) => claim_id !== claim?.claim_id);
  contract.propositions = contract.propositions.filter(({ proposition_id }) => !propositions.has(proposition_id));
  contract.relations = contract.relations.filter(({ source_claim_id, target_claim_id }) =>
    source_claim_id !== claim?.claim_id && target_claim_id !== claim?.claim_id); }
function profileRejectionFixtures(profile) { const missing = (id) => () => baselineFixture(profile, {
  mutate_contract(contract) { removeClaim(contract, id); } });
  return {
    "missing-population-count": () => baselineFixture(profile, { mutate_contract(contract) {
      removeClaim(contract, "population-protected-resource-population-cardinality"); } }),
    "missing-start-boundary": missing("start-event-starts-interval"),
    "missing-end-boundary": missing("end-event-completes-interval"),
    "missing-boundary-order": missing("start-event-precedes-end-event"),
    "missing-write-prohibition": missing("actor-does-not-write-protected-resources-during-interval"),
    "missing-mutation-prohibition": missing("actor-does-not-mutate-protected-resources-during-interval"),
    "missing-verification-spine": missing("verification-observes-exact-bounded-proof-subjects"),
    "missing-write-verification": missing("verify-no-during-interval-write"),
    "missing-mutation-verification": missing("verify-no-during-interval-mutation"),
    "missing-verifies-relation": () => baselineFixture(profile, { mutate_contract(contract) { contract.relations = []; } }),
    "wrong-mutation-falsifier": () => baselineFixture(profile, { proposition_overrides: {
      "falsifier:verify-no-during-interval-mutation": { operator: "reference:writes" } } }),
    "missing-protected-resource-binding": () => baselineFixture(profile, { mutate_input(input) {
      input.reference_bindings = input.reference_bindings.filter(({ role }) => role !== "protected_resources"); } }),
    "collapsed-interval-boundaries": () => baselineFixture(profile, { mutate_input(input) {
      const start = input.reference_bindings.find(({ role }) => role === "start_event");
      input.reference_bindings.find(({ role }) => role === "end_event").reference_ids = [...start.reference_ids]; } })
  }; }
const profileRejectionControls = (profile) => Object.entries(profileRejectionFixtures(profile)).map(
  ([control_id, make]) => ({ control_id, category: "profile_rejection", implementation_outcome: "not_applicable",
    profile_satisfaction: evaluateFixture(make()) }));
function exclusionControls(profile) { const satisfaction = evaluateFixture(baselineFixture(profile));
  return EXCLUSIONS.map((control_id) => ({ control_id, category: "exclusion",
    implementation_outcome: "boundary_demonstrated", profile_satisfaction: satisfaction })); }
async function runProofPackAdequacyControls({ profile }) { return {
  schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION, profile_id: profile.profile_id,
  profile_version: profile.profile_version, profile_digest: BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE_DIGEST,
  guarantee_digest: BOUNDED_INTERVAL_NONMUTATION_V1_GUARANTEE_DIGEST,
  controls: [...positiveControls(profile), ...mutantControls(profile),
    ...profileRejectionControls(profile), ...exclusionControls(profile)] }; }
export { BOUNDED_INTERVAL_NONMUTATION_V1_GUARANTEE_DIGEST,
  BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE_DIGEST, EXCLUSIONS, baselineFixture, evaluateFixture,
  profileRejectionFixtures, runProofPackAdequacyControls };
