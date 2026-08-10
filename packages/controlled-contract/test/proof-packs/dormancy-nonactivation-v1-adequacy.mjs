import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import {
  buildDormancyNonactivationFixture,
  findClaim,
  findProposition
} from "./dormancy-nonactivation-v1-fixture.mjs";
import {
  DOMAINS,
  dormancyGuaranteeSatisfied,
  executeDormancy
} from "./dormancy-nonactivation-v1-harness.mjs";

const PROFILE_DIGEST = "34fe6942fc06d74abb0faef0f4488c81b56d2f165f83ceb7ca9595aef79ff69c";
const GUARANTEE_DIGEST = "195abee0ccf37eccb8b59dcb3f7e5c750cce280860015fb880aea55c3953e738";
const EXCLUSIONS = Object.freeze([
  "activation-after-the-captured-observation-boundary",
  "dishonest-complete-population-or-resolver-result",
  "dishonest-reference-artifact-state-or-identity-grounding",
  "dynamic-reflection-loading-or-environment-routes-absent-from-the-captured-graph",
  "independent-proof-that-captured-artifact-bytes-semantically-mean-inactive",
  "production-path-discovery-outside-the-caller-supplied-complete-snapshot",
  "resolver-authority-or-independent-transitive-reachability-recomputation",
  "runtime-authority-pack-applicability-or-cce-consequence"
]);
const evaluate = (fixture) => evaluateVerificationProfileV034({ contract: fixture.contract,
  profile: fixture.profile, evaluation_input: fixture.input }).satisfaction;
const removeClaim = (contract, id) => {
  const claim = findClaim(contract, id); if (!claim) return;
  const propositionIds = new Set([claim.proposition_id,
    claim.falsifying_proposition_id].filter(Boolean));
  contract.claims = contract.claims.filter(({ claim_id }) => claim_id !== claim.claim_id);
  contract.propositions = contract.propositions.filter(
    ({ proposition_id }) => !propositionIds.has(proposition_id));
  contract.relations = contract.relations.filter(({ source_claim_id, target_claim_id }) =>
    source_claim_id !== claim.claim_id && target_claim_id !== claim.claim_id);
};
const removePopulation = (contract, role) => {
  const token = role.replaceAll("_", "-");
  for (const suffix of ["cardinality", "contains"]) removeClaim(contract,
    `population-${token}-${suffix}`);
};
const resolverFixture = (kind, key, mutation) => buildDormancyNonactivationFixture({
  mutate_input(input) {
    const index = input.resolver_facts.findIndex((fact) =>
      fact.resolver_kind === kind && fact.fact_key === key);
    if (mutation === "remove") input.resolver_facts.splice(index, 1);
    else if (mutation === "false") input.resolver_facts[index].satisfied = false;
    else input.resolver_facts[index].argument_reference_ids[mutation] = "ref-decoy";
  }
});
const CASES = Object.freeze({
  "construction-fails": () => resolverFixture("direct-construction", "succeeds", "false"),
  "registration-fails": () => resolverFixture("direct-registration", "succeeds", "false"),
  "hidden-activation-edge": () => resolverFixture("code-reachability",
    "no-path-from-declared-production-entrypoints", "false"),
  "activation-observation-not-empty": () => resolverFixture("activation-observation",
    "complete-population-is-empty", "false"),
  "missing-construction-fact": () => resolverFixture("direct-construction", "succeeds", "remove"),
  "missing-registration-fact": () => resolverFixture("direct-registration", "succeeds", "remove"),
  "missing-reachability-fact": () => resolverFixture("code-reachability",
    "no-path-from-declared-production-entrypoints", "remove"),
  "missing-activation-observation-fact": () => resolverFixture("activation-observation",
    "complete-population-is-empty", "remove"),
  "wrong-reachability-graph": () => resolverFixture("code-reachability",
    "no-path-from-declared-production-entrypoints", 0),
  "wrong-reachability-entrypoint-a": () => resolverFixture("code-reachability",
    "no-path-from-declared-production-entrypoints", 1),
  "wrong-reachability-entrypoint-b": () => resolverFixture("code-reachability",
    "no-path-from-declared-production-entrypoints", 2),
  "wrong-reachability-component": () => resolverFixture("code-reachability",
    "no-path-from-declared-production-entrypoints", 3),
  "wrong-activation-trace": () => resolverFixture("activation-observation",
    "complete-population-is-empty", 0),
  "wrong-activation-population": () => resolverFixture("activation-observation",
    "complete-population-is-empty", 1),
  "wrong-activation-component": () => resolverFixture("activation-observation",
    "complete-population-is-empty", 2),
  "missing-component-membership": () => buildDormancyNonactivationFixture({
    drop_pattern_ids: ["component-is-a-graph-node"] }),
  "missing-entrypoint-subset": () => buildDormancyNonactivationFixture({
    drop_pattern_ids: ["entrypoints-are-graph-nodes"] }),
  "missing-default-inactive-state": () => buildDormancyNonactivationFixture({
    drop_pattern_ids: ["default-configuration-is-inactive"] }),
  "missing-activation-trace-population": () => buildDormancyNonactivationFixture({
    drop_pattern_ids: ["activation-trace-records-complete-population"] }),
  "missing-empty-population-behavior": () => buildDormancyNonactivationFixture({
    drop_pattern_ids: ["activation-population-is-empty"] }),
  "missing-verification": () => buildDormancyNonactivationFixture({
    drop_pattern_ids: ["dormancy-verification"] }),
  "missing-verifies-relation": () => buildDormancyNonactivationFixture({
    mutate_contract(contract) { contract.relations = []; } }),
  "missing-graph-completeness": () => buildDormancyNonactivationFixture({
    mutate_contract(contract) { removePopulation(contract, "graph_node_population"); } }),
  "missing-entrypoint-completeness": () => buildDormancyNonactivationFixture({
    mutate_contract(contract) { removePopulation(contract, "production_entrypoint_population"); } }),
  "missing-activation-completeness": () => buildDormancyNonactivationFixture({
    mutate_contract(contract) { removePopulation(contract, "activation_event_population"); } }),
  "status-only-verification": () => buildDormancyNonactivationFixture({
    proposition_overrides: { "dormancy-verification": {
      operator: "reference:covers", operands: [{ kind: "reference",
        reference_id: "ref-dormant-component" }] } } }),
  "default-on-state": () => buildDormancyNonactivationFixture({
    proposition_overrides: { "default-configuration-is-inactive": {
      operator: "reference:not_equals" } } }),
  "activation-count-nonzero": () => buildDormancyNonactivationFixture({
    number_value_overrides: { activation_event_count: 1 },
    role_id_overrides: { activation_events: ["ref-activation-event"] } })
});

async function runProofPackAdequacyControls({ profile }) {
  const positives = DOMAINS.map(({ id }) => ({ control_id: id, category: "positive",
    implementation_outcome: dormancyGuaranteeSatisfied(executeDormancy({ domain: id }))
      ? "passed" : "killed", profile_satisfaction: evaluate(
        buildDormancyNonactivationFixture({ profile, domain: id })) }));
  const mutantMap = { "dormant-but-activated": "activation-count-nonzero",
    "runtime-hidden-activation-edge": "hidden-activation-edge",
    "default-on-behavior": "default-on-state" };
  const mutants = Object.entries(mutantMap).map(([id, caseId]) => ({ control_id: id,
    category: "mutant", implementation_outcome: dormancyGuaranteeSatisfied(executeDormancy({
      domain: DOMAINS[0].id, mutant: id === "runtime-hidden-activation-edge"
        ? "hidden-activation-edge" : id })) ? "passed" : "killed",
    profile_satisfaction: evaluate(CASES[caseId]()) }));
  const rejections = Object.entries(CASES).map(([id, build]) => ({ control_id: id,
    category: "profile_rejection", implementation_outcome: "not_applicable",
    profile_satisfaction: evaluate(build()) }));
  const baseline = evaluate(buildDormancyNonactivationFixture({ profile }));
  const exclusions = EXCLUSIONS.map((id) => ({ control_id: id, category: "exclusion",
    implementation_outcome: "boundary_demonstrated", profile_satisfaction: baseline }));
  return { schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id, profile_version: profile.profile_version,
    profile_digest: PROFILE_DIGEST, guarantee_digest: GUARANTEE_DIGEST,
    controls: [...positives, ...mutants, ...rejections, ...exclusions] };
}

export { CASES, EXCLUSIONS, runProofPackAdequacyControls };
