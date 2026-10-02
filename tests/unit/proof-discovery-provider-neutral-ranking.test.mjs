

import assert from "node:assert/strict";
import test from "node:test";

import { PROOF_VERIFICATION_CAPABILITIES, discoverProofIntents, normalizeSearchText,
  proofVerificationCapability } from
  "../../packages/controlled-contract/lib/proof-intent-discovery.mjs";
import { TEST_PROOF_PROVIDER_AUTHORING_FACTS, composeTestProofProviderFamilies,
  testProofProviderFamily } from "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";
import { TEST_PROOF_PROVIDER_FAMILIES } from
  "../../packages/controlled-contract/lib/test-proof-providers/index.mjs";
import { NATIVE_TEST_CASE_AUTHORING_GUIDANCE } from
  "../../packages/controlled-contract/lib/native-test-proof-authoring.mjs";

const TEST_VALIDITY = "proof.verification.test-validity";
const names = (result) => result.candidates.map(({ proof_name: name }) => name);
const ranked = (result) => result.candidates.map(({ proof_name: name, ranking }) =>
  [name, ranking.match_kind, ranking.relevance_score, ranking.matched_terms]);
const rank = (query, name = TEST_VALIDITY) => names(discoverProofIntents({ query })).indexOf(name);

const INCIDENT_PROPERTY = "unit test asserts lint rule reports error";
const PROVIDER_PHRASINGS = [
  ["Go", "identified", ["go-test"]],
  ["Rust", "identified", ["cargo-test"]],
  ["pytest", "identified", ["pytest"]],
  ["jest JavaScript", "identified", ["jest"]],
  ["Python", "ambiguous", ["pytest", "stestr"]],
  ["", "unspecified", []],

  ["Haskell", "unspecified", []]
];

test("one property phrased for different providers ranks identically", () => {
  const unspecified = discoverProofIntents({ query: INCIDENT_PROPERTY });
  for (const [prefix, status, families] of PROVIDER_PHRASINGS) {
    const result = discoverProofIntents({ query: `${prefix} ${INCIDENT_PROPERTY}`.trim() });
    assert.deepEqual(result.provider_context.status, status, prefix);
    assert.deepEqual(result.provider_context.families, families, prefix);
    assert.deepEqual(ranked(result), ranked(unspecified), `${prefix} changes no relevance`);
    for (const candidate of result.candidates) {
      assert.deepEqual(candidate.ranking.provider_terms, result.provider_context.provider_terms);
      assert.ok(candidate.ranking.match_reasons.every(({ matched_terms: terms }) =>
        terms.every((term) => !result.provider_context.provider_terms.includes(term))));
    }
  }
  assert.ok(rank(`Go ${INCIDENT_PROPERTY}`) < 5, "the test-verification proof is on the first page");
});

test("provider exclusion is discriminating: an excluded identity term occurs in proof text", () => {

  const holder = discoverProofIntents().candidates.filter((candidate) =>
    normalizeSearchText(JSON.stringify(candidate)).split(" ").includes("node"));
  assert.ok(holder.length > 0, "the control term really occurs in the admitted population");
  const property = "test verifies the declared answer";
  const withNode = discoverProofIntents({ query: `node ${property}` });
  assert.equal(withNode.provider_context.status, "ambiguous");
  assert.deepEqual(ranked(withNode), ranked(discoverProofIntents({ query: property })),
    "including the term in relevance would change the holder's matched terms and score");
  const onlyProvider = discoverProofIntents({ query: "go" });
  assert.equal(onlyProvider.total_match_count, 0, "a provider name alone is not a property");
  assert.deepEqual(onlyProvider.provider_context, { status: "identified",
    provider_terms: ["go"], families: ["go-test"] });
  assert.equal(discoverProofIntents({ query: "go python" }).provider_context.status, "conflicting");
});

test("test-verification questions surface the test proof; non-test properties do not", () => {
  for (const query of [
    `Go ${INCIDENT_PROPERTY}`,
    "go test verifies the config parser defaults",
    "pytest test checks parser rejects unknown level",
    "cargo test proves the function returns an error",
    "regression test for lint rule",
    "jest test covers component",
    "a unit test that fails when the behavior is broken",
    "selected test executes and falsifier is detected"
  ]) {
    const index = rank(query);
    assert.ok(index >= 0 && index < 5, `${query}: ${index}`);
  }
  for (const [query, owner] of [
    ["retry after failure converges", "proof.failure.retry-convergence"],
    ["refuse unauthorized request before side effects", "proof.authorization.refusal-before-effects"],
    ["pagination cursor returns every item", "proof.pagination.versioned-cursor-refusal"]
  ]) {
    const ordered = names(discoverProofIntents({ query }));
    assert.equal(ordered[0], owner, query);
    const index = ordered.indexOf(TEST_VALIDITY);
    assert.ok(index < 0 || index >= 5, `${query} does not steer a non-test property to test proof (${index})`);
  }
});

test("negative control: the former semantic-count order buries the test proof", () => {
  const result = discoverProofIntents({ query: `Go ${INCIDENT_PROPERTY}` });
  const tiers = { assertion_match: 0, partial_assertion_match: 1, navigation_or_exclusion_match: 2 };
  const former = [...result.candidates].sort((a, b) =>
    tiers[a.ranking.match_kind] - tiers[b.ranking.match_kind] ||
    b.ranking.semantic_terms.length - a.ranking.semantic_terms.length || (a.id < b.id ? -1 : 1));
  assert.ok(former.findIndex(({ proof_name: name }) => name === TEST_VALIDITY) >= 5,
    "the restored defect fails the first-page assertion");
  assert.ok(names(result).indexOf(TEST_VALIDITY) < 5);

  const shared = discoverProofIntents({ query: "execution" });
  assert.ok(shared.candidates.length === shared.candidate_count);
  for (const candidate of shared.candidates) {
    const sources = new Set(candidate.ranking.match_reasons.map(({ source }) => source));
    if (sources.size === 1 && sources.has("constraint")) assert.equal(candidate.ranking.relevance_score, 0);
  }
  for (const candidate of discoverProofIntents({ query: "authority grant" }).candidates) {
    if (candidate.ranking.match_reasons.every(({ source }) => source === "exclusion")) {
      assert.equal(candidate.ranking.relevance_score, 0, "matching an exclusion is not relevance");
      assert.equal(candidate.ranking.match_kind, "navigation_or_exclusion_match");
    }
  }
});

test("authoring facts and case guidance are projections of the installed families", () => {
  assert.deepEqual(TEST_PROOF_PROVIDER_AUTHORING_FACTS.map(({ family_id: id }) => id),
    TEST_PROOF_PROVIDER_FAMILIES.map(({ family_id: id }) => id));
  for (const facts of TEST_PROOF_PROVIDER_AUTHORING_FACTS) {
    const family = testProofProviderFamily(facts.selector.kind);
    assert.equal(facts.candidate_execution.provider_id, family.providers.candidate_execution.provider_id);
    assert.equal(facts.falsifier_execution.provider_id, family.providers.falsifier_execution.provider_id);
    assert.equal(facts.selector.node_id_form, family.selector_statement);
    const guidance = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.families[facts.family_id];
    assert.deepEqual(guidance.provider ?? null, facts.selector.provider_qualified
      ? { provider_id: facts.candidate_execution.provider_id,
        provider_version: facts.candidate_execution.provider_version } : null);
    const falsification = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.falsification[guidance.falsification];
    assert.deepEqual(Object.keys(falsification.strategies), facts.falsifier_execution.strategies);
    assert.equal(falsification.target_constraint, facts.falsifier_execution.target_constraint);
    assert.ok(falsification.target_constraint.refusal_codes.length > 0);
  }

  const nodeTest = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.families["node-test"];
  assert.equal(nodeTest.target_variant, "node_test");
  assert.equal(Object.hasOwn(nodeTest, "provider"), false);
  assert.deepEqual(NATIVE_TEST_CASE_AUTHORING_GUIDANCE.target_variants.node_test.fields,
    ["path", "selector.name", "selector.nesting"]);
  const moduleFault = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.falsification[nodeTest.falsification].strategies;
  assert.deepEqual(moduleFault.dependency_failure.required, ["strategy", "module_path"]);
  assert.deepEqual(moduleFault.dependency_failure.not_allowed,
    ["entry_export", "operation", "function_name", "replacement"]);
  assert.deepEqual(moduleFault.forced_invocation.required,
    ["strategy", "module_path", "entry_export", "operation"]);
  assert.ok(moduleFault.forced_invocation.server_derived.includes("invocation"));
  assert.deepEqual(NATIVE_TEST_CASE_AUTHORING_GUIDANCE.falsification.scalar_return_substitution
    .strategies.result_inversion.required, ["strategy", "module_path", "function_name", "replacement"]);
});

test("negative control: a family without its mechanism's target constraint fails closed", () => {
  const strip = (family) => {
    const { falsifier_target_constraints: _removed, ...rest } = family;
    return rest;
  };
  const goOnly = TEST_PROOF_PROVIDER_FAMILIES.filter(({ family_id: id }) => id === "go-test");
  assert.doesNotThrow(() => composeTestProofProviderFamilies(goOnly));
  assert.throws(() => composeTestProofProviderFamilies(goOnly.map(strip)),
    /must state its target constraint/u);
  const node = TEST_PROOF_PROVIDER_FAMILIES.find(({ family_id: id }) => id === "node-test");
  const conflicting = { ...goOnly[0], falsifier_target_constraints: {
    ...goOnly[0].falsifier_target_constraints,
    module_substitution: { ...node.falsifier_target_constraints.module_substitution } } };
  assert.throws(() => composeTestProofProviderFamilies([node, conflicting]),
    /exactly one target constraint/u);
});

test("the verification capability of a proof is its own profile's, not a name or language rule", async () => {
  const { loadAdmittedProofPack } = await import(
    "../../packages/controlled-contract/lib/admitted-proof-packs.mjs");
  const population = discoverProofIntents().candidates;

  for (const { proof_name: name } of population) {
    const declared = (await loadAdmittedProofPack(name)).profile.stable_capabilities?.test_validity ?? null;
    assert.equal(proofVerificationCapability(name), declared, name);
    assert.equal(Object.hasOwn(PROOF_VERIFICATION_CAPABILITIES, name), declared !== null, name);
  }
  assert.equal(proofVerificationCapability(TEST_VALIDITY), "provider_bound_test_validity.v1");
  assert.equal(proofVerificationCapability("proof.pagination.complete-traversal"), null);

  assert.equal(proofVerificationCapability("proof.fixture.unknown"), null);

  const unspecified = names(discoverProofIntents({ query: INCIDENT_PROPERTY }))
    .map((name) => proofVerificationCapability(name));
  for (const [prefix] of PROVIDER_PHRASINGS) {
    const result = discoverProofIntents({ query: `${prefix} ${INCIDENT_PROPERTY}`.trim() });
    assert.deepEqual(names(result).map((name) => proofVerificationCapability(name)), unspecified, prefix);
  }
});
