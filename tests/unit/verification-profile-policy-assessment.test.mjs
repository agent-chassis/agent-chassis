

import test from "node:test";
import assert from "node:assert/strict";
import {
  POLICY_PATTERN_ASSESSMENT_VERSION, assertVerificationProfileV1Result, assessPolicyPatternsExperimentalV1,
  describePopulationDeclarationExperimentalV1, evaluateVerificationProfileV1
} from "@agent-chassis/controlled-contract/verification-profile";
import { resolveClosedPopulationV1 } from "../../packages/controlled-contract/lib/population-semantics-v1.mjs";
import { authorDeclarations, declarations as D, objectIdentities } from "../fixtures/required-policy-population.mjs";
import {
  GAUGE_EXPECTED_PATTERN_IDS, GAUGE_REQUIREMENTS, compileGaugeRequirements, gaugeDependencyRelations,
  gaugeDraftPolicy
} from "../fixtures/required-policy-assessment.mjs";

const WK = "WK-9001";
const { profile } = gaugeDraftPolicy({ unit: WK });
const compiled = await compileGaugeRequirements(Object.values(GAUGE_REQUIREMENTS), { wkId: WK });
const [declaration, accepted, rejected] = compiled.compiled;
const complete = { ...structuredClone(compiled.content), relations: [
  ...structuredClone(compiled.content.relations), ...gaugeDependencyRelations({
    declaration: declaration.claim_id, accepted: accepted.claim_id, rejected: rejected.claim_id })] };
const roleOf = Object.fromEntries(profile.reference_roles.map(({ role, allowed_type_terms: [type] }) =>
  [role, type]));

const TERMS = { operation: "gauge.set-level", level: "gauge.level-input",
  inside_range: "gauge.level-inside-declared-range", outside_range: "gauge.level-outside-declared-range",
  accepted_effect: "gauge.stored-level", refusal_result: "gauge.range-error",
  accepted_check: "gauge.accepted-level-check", refusal_check: "gauge.out-of-range-level-check",
  range_check: "gauge.range-declaration-check" };
const input = (contract) => ({ input_version: "controlled-contract-verification-profile-input.v2",
  reference_bindings: Object.keys(roleOf).sort().flatMap((role) => {
    const found = contract.references.find((row) => row.identity.term === TERMS[role]);
    return found === undefined ? [] : [{ role, reference_ids: [found.reference_id] }];
  }),
  number_bindings: [], claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [],
  stable_evaluation: {} });
const payload = (contract, changes = {}) => ({ contract, profile, evaluation_input: input(contract), ...changes });
const statuses = (result) => Object.fromEntries(result.pattern_results.map((row) => [row.pattern_id, row.status]));
const codes = (result) => result.contract_structural_diagnostics.map(({ code }) => code).sort();
const empty = { ...structuredClone(complete), references: [], propositions: [], claims: [], relations: [] };
const referentsOnly = { ...structuredClone(complete), propositions: [], claims: [], relations: [] };
const dangling = { ...structuredClone(complete),
  claims: complete.claims.filter((claim) => claim.claim_id !== rejected.claim_id) };
const refusedBy = (run, code) => assert.throws(run, (error) => {
  assert.equal(error.code, code, `${error.code}: ${error.message}`);
  return true;
});

test("POLICY-PATTERN-EXPERIMENTAL-MATCH", () => {
  const whole = assessPolicyPatternsExperimentalV1(payload(complete));
  assert.equal(whole.result_version, POLICY_PATTERN_ASSESSMENT_VERSION);
  assert.equal(whole.experimental, true);
  assert.deepEqual(whole.admission.kind, "unadmitted_direct");
  assert.equal(whole.admission.adequacy_attested, false);
  assert.equal(whole.satisfaction, "satisfied");
  assert.equal(whole.contract_structurally_valid, true);
  assert.deepEqual(Object.keys(statuses(whole)).sort(), GAUGE_EXPECTED_PATTERN_IDS);
  assert.ok(Object.values(statuses(whole)).every((status) => status === "satisfied"));

  for (const contract of [empty, referentsOnly]) {
    const result = assessPolicyPatternsExperimentalV1(payload(contract));
    assert.deepEqual(codes(result), ["empty_contract"]);
    assert.equal(result.contract_structurally_valid, false);
    assert.notEqual(result.satisfaction, "satisfied");
    assert.deepEqual(Object.keys(statuses(result)).sort(), GAUGE_EXPECTED_PATTERN_IDS);
    assert.ok(Object.values(statuses(result)).every((status) => status !== "satisfied"));
  }

  const residue = assessPolicyPatternsExperimentalV1(payload(dangling));
  assert.deepEqual(codes(residue), ["dangling_relation_source", "dangling_relation_target",
    "mandatory_verification_unattached"]);
  assert.deepEqual(statuses(residue), { ...statuses(whole), "out-of-range-behavior": "unsatisfied",
    "out-of-range-verifies": "unsatisfied", "out-of-range-depends-on-declaration": "unsatisfied" });

  const edgeless = assessPolicyPatternsExperimentalV1(payload({ ...structuredClone(complete),
    relations: complete.relations.filter((row) => !(row.role === "depends_on" &&
      row.source_claim_id === rejected.claim_id)) }));
  assert.equal(edgeless.contract_structurally_valid, true);
  assert.deepEqual(statuses(edgeless), { ...statuses(whole),
    "out-of-range-depends-on-declaration": "unsatisfied" });
  assert.equal(residue.satisfaction, "unsatisfied");

  refusedBy(() => assertVerificationProfileV1Result(whole), "stable_verification_profile_result_unrecognized");
});

test("POLICY-PATTERN-STABLE-REFUSALS-RETAINED", () => {

  for (const contract of [empty, referentsOnly, dangling]) {
    refusedBy(() => evaluateVerificationProfileV1(payload(contract)), "stable_family_refused");
  }
  assert.equal(evaluateVerificationProfileV1(payload(complete)).satisfaction, "satisfied");

  const cases = [
    ["schema-invalid contract", payload({ ...structuredClone(dangling),
      claims: [{ claim_id: "claim-x" }] })],
    ["unknown contract identity", payload({ ...structuredClone(complete), schema_version: "other" })],
    ["schema-invalid profile", payload(complete, { profile: { ...profile, claim_patterns: "none" } })],
    ["schema-invalid input", payload(complete, { evaluation_input: { ...input(complete), extra: true } })],
    ["schema-invalid profile beside an empty contract", payload(empty,
      { profile: { ...profile, relation_patterns: null } })]
  ];
  for (const [name, value] of cases) {
    refusedBy(() => assessPolicyPatternsExperimentalV1(value), "stable_family_refused", name);
  }

  refusedBy(() => assessPolicyPatternsExperimentalV1(payload(complete, { profile: { ...profile,
    stable_capabilities: { semantic_mechanisms: ["association", "partition", "relation_match", "inverse",
      "transitive", "irreflexive", "adjacency", "acyclic"],
    test_validity: "provider_bound_test_validity.v1" } } })),
  "policy_pattern_assessment_member_unsupported");

  const bad = payload(dangling);
  bad.evaluation_input.reference_bindings[0].reference_ids = ["ref-not-authored"];
  const invalid = assessPolicyPatternsExperimentalV1(bad);
  assert.equal(invalid.satisfaction, "invalid");
  assert.deepEqual(invalid.pattern_results, []);
});

test("POLICY-PATTERN-POPULATION-DECLARATION-READING", async () => {

  const alpha = objectIdentities("alpha");
  const five = Object.values(alpha.field);
  const mirror = { ...alpha, fields: { type_term: "cc:population",
    identity: { kind: "profile_term", term: "alpha.error-body.mirror" } } };
  const scope = { mode: "unconditional", operand_reference_ids: [] };
  const idOf = (contract, referent) => contract.references.find((row) =>
    row.identity.term === referent.identity.term).reference_id;
  const read = (contract) => describePopulationDeclarationExperimentalV1({ contract,
    population_reference_id: idOf(contract, alpha.fields), applicability_context: scope });
  const plainContract = await authorDeclarations([D.contains(alpha, five), D.cardinality(alpha, 5)], { wkId: WK });
  const plain = read(plainContract);
  const owner = resolveClosedPopulationV1(plainContract, idOf(plainContract, alpha.fields), scope);
  assert.deepEqual([plain.membership_claim_ids, plain.cardinality_claim_ids, plain.member_reference_ids, owner.complete],
    [owner.membership_claim_ids, owner.cardinality_claim_ids, owner.member_reference_ids, true]);
  assert.deepEqual([plain.membership_claim_ids.length, plain.cardinality_claim_ids.length], [1, 1]);

  const joined = await authorDeclarations([D.contains(alpha, five.slice(0, 4)), D.cardinality(alpha, 5),
    D.contains(mirror, [five[4]]), D.equal(alpha, alpha.fields, mirror.fields)], { wkId: WK });
  const combined = read(joined);
  assert.deepEqual([combined.membership_claim_ids.length, combined.member_reference_ids.length,
    combined.equivalent(idOf(joined, alpha.fields), idOf(joined, mirror.fields)),
    resolveClosedPopulationV1(joined, idOf(joined, alpha.fields), scope).complete], [2, 5, true, true]);
});
