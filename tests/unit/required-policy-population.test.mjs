

import test from "node:test";
import assert from "node:assert/strict";
import { assessRequiredPolicies } from
  "../../packages/wiki-core/src/operations/controlled-contract/required-policy-assessment.mjs";
import {
  FAILURE_STATE, POPULATION_PATTERN_IDS, authorDeclarations, declarations as D, fieldIdentity, objectIdentities,
  populationBindings, populationPolicy
} from "../fixtures/required-policy-population.mjs";

const WK = "WK-9001";
const subject = Object.freeze({ unit: WK, wk_id: WK, selected_unit: null, focus: null });
const WHOLE = Object.freeze({ scope: "whole_unit" });
const alpha = objectIdentities("alpha");
const beta = objectIdentities("beta");
const five = Object.values(alpha.field);
const four = five.slice(0, 4);
const CAUSE = alpha.field.cause;
const EXTRA = fieldIdentity("alpha", "extra");
const ALIAS = fieldIdentity("alpha", "code-alias");
const author = (requirements, contract = null) => authorDeclarations(requirements, { wkId: WK, contract });
const policy = populationPolicy({ unit: WK, identities: alpha });
const assess = (contract, supplied = [policy]) => assessRequiredPolicies({ policies: supplied, subject, contract,
  obligations: [], selection: WHOLE });
const only = (result) => { assert.equal(result.policies.length, 1); return result.policies[0]; };
const statuses = (entry) => Object.fromEntries(entry.expectations.map((row) => [row.pattern_id, row.status]));
const expectation = (entry, id) => entry.expectations.find((row) => row.pattern_id === id);
const all = (status) => Object.fromEntries(POPULATION_PATTERN_IDS.map((id) => [id, status]));
const structural = (entry) => [...new Set(entry.authored_contract.structural_diagnostics.map(({ code }) => code))].sort();
const CLOSED = "field-population-is-complete";
const COUNT = "exactly-the-expected-member-count";
const CARDINALITY = "population-declares-cardinality";

const assertPopulation = (entry) => assert.deepEqual(entry.expectations.map((row) => row.pattern_id),
  POPULATION_PATTERN_IDS);

const complete = await author([D.association(alpha), D.contains(alpha, five), D.cardinality(alpha, 5)]);

test("POPULATION-BINDING-CLOSURE-THROUGH-ASSESSMENT", async () => {

  const whole = only(assess(complete));
  assertPopulation(whole);
  assert.deepEqual([statuses(whole), whole.matcher.satisfaction, whole.definition_coverage_complete,
    whole.bindings.field_member, whole.authored_contract.structurally_valid],
  [all("supported"), "satisfied", true, "bound", true]);
  assert.deepEqual(whole.binding_members.field_member.map((member) => [member.identity, member.state]),
    [...five].sort((left, right) => left.identity.term < right.identity.term ? -1 : 1).map((member) => [member, "bound"]));

  const none = only(assess(null));
  assertPopulation(none);
  assert.deepEqual([statuses(none), none.bindings.field_member], [all("missing"), "members_undeclared"]);

  const cases = [

    ["member omitted, referent undeclared", [D.association(alpha), D.contains(alpha, four), D.cardinality(alpha, 5)],
      { [CLOSED]: "missing", [COUNT]: "missing" }, true, []],

    ["member omitted, referent declared elsewhere", [D.association(alpha), D.contains(alpha, four),
      D.cardinality(alpha, 5), D.contains(beta, [CAUSE])], { [CLOSED]: "missing" }, true, []],
    ["cardinality omitted", [D.association(alpha), D.contains(alpha, five)],
      { [CLOSED]: "missing", [CARDINALITY]: "missing" }, true, []],
    ["sixth distinct member", [D.association(alpha), D.contains(alpha, [...five, EXTRA]), D.cardinality(alpha, 5)],
      { [CLOSED]: "missing", [CARDINALITY]: "affected" }, false, ["direct_proposition_contradiction"]],

    ["equal count with a wrong member", [D.association(alpha), D.contains(alpha, [...four, EXTRA]),
      D.cardinality(alpha, 5)], { [CLOSED]: "missing", [COUNT]: "missing" }, true, []],
    ["members and count in another scope", [D.association(alpha), D.contains(alpha, five, FAILURE_STATE),
      D.cardinality(alpha, 5, FAILURE_STATE)], { [CLOSED]: "missing", [CARDINALITY]: "missing" }, true, []]
  ];
  const observed = {};
  for (const [name, requirements, changed, valid, diagnostics] of cases) {
    const entry = only(assess(await author(requirements)));
    assertPopulation(entry);
    observed[name] = entry;
    assert.deepEqual(statuses(entry), { ...all("supported"), ...changed }, name);
    assert.equal(entry.definition_coverage_complete, false, name);
    assert.notEqual(entry.matcher.satisfaction, "satisfied", name);
    if (valid !== null) assert.deepEqual([entry.authored_contract.structurally_valid, structural(entry)],
      [valid, diagnostics], name);
  }

  const omitted = observed["member omitted, referent undeclared"];
  assert.equal(omitted.bindings.field_member, "members_undeclared");
  assert.deepEqual(expectation(omitted, CLOSED).reasons,
    ["member_referent_undeclared:field_member:alpha.error-body.field.cause"]);
  assert.deepEqual(expectation(omitted, CLOSED).reasons, expectation(omitted, COUNT).reasons);

  assert.equal(omitted.binding_members.field_member.length, 5);

  assert.deepEqual(expectation(observed["member omitted, referent declared elsewhere"], CLOSED).reasons,
    ["population_binding_not_complete", "population_membership_incomplete"]);
  assert.deepEqual(expectation(observed["cardinality omitted"], CLOSED).reasons,
    ["population_exact_cardinality_missing"]);
  assert.deepEqual(expectation(observed["cardinality omitted"], CARDINALITY).reasons, ["no_matching_authored_claim"]);
  assert.deepEqual(expectation(observed["sixth distinct member"], CLOSED).reasons,
    ["population_binding_not_complete", "population_membership_incomplete"]);

  assert.deepEqual(expectation(observed["sixth distinct member"], CARDINALITY).structural_diagnostics,
    ["direct_proposition_contradiction"]);
  assert.deepEqual(expectation(observed["members and count in another scope"], CLOSED).reasons,
    ["population_binding_not_complete", "population_definition_missing"]);

  const mirror = { ...alpha, fields: { type_term: "cc:population",
    identity: { kind: "profile_term", term: "alpha.error-body.mirror" } } };
  const equated = await author([D.association(alpha), D.contains(alpha, four), D.cardinality(alpha, 5),
    D.contains(mirror, [CAUSE]), D.equal(alpha, alpha.fields, mirror.fields)]);
  const joined = only(assess(equated));
  const mirrorId = equated.references.find((row) => row.identity.term === mirror.fields.identity.term).reference_id;
  assert.deepEqual([statuses(joined), joined.matcher.satisfaction, joined.definition_coverage_complete],
    [all("supported"), "satisfied", true]);
  assert.deepEqual([expectation(joined, CLOSED).population_sources.equated_reference_ids,
    expectation(joined, CLOSED).population_sources.membership_claim_ids.length,
    expectation(joined, CLOSED).population_sources.cardinality_claim_ids.length,
    expectation(joined, COUNT).population_sources], [[mirrorId], 2, 1, null]);

  assert.deepEqual(expectation(only(assess(complete)), CLOSED).population_sources,
    { membership_claim_ids: expectation(only(assess(complete)), CLOSED).population_sources.membership_claim_ids,
      cardinality_claim_ids: expectation(only(assess(complete)), CLOSED).population_sources.cardinality_claim_ids,
      equated_reference_ids: [] });
  assert.equal(expectation(only(assess(complete)), CLOSED).population_sources.membership_claim_ids.length, 1);

  const scopedEquality = structuredClone(equated);
  const equalityProposition = scopedEquality.propositions.find((row) => row.operator === "reference:equals");
  const failureId = (await author([D.contains(alpha, five, FAILURE_STATE)])).references.find((row) =>
    row.identity.term === FAILURE_STATE.identity.term);
  scopedEquality.references.push(structuredClone(failureId));
  equalityProposition.applicability_context = { mode: "when", operand_reference_ids: [failureId.reference_id] };
  const apart = only(assess(scopedEquality));
  assert.deepEqual([statuses(apart)[CLOSED], expectation(apart, CLOSED).population_sources.equated_reference_ids],
    ["missing", []]);

  const aliased = only(assess(await author([D.association(alpha), D.equal(alpha, ALIAS, alpha.field.code),
    D.contains(alpha, [...five, ALIAS]), D.cardinality(alpha, 5)])));
  assert.deepEqual([statuses(aliased), aliased.definition_coverage_complete], [all("supported"), true]);
  const split = only(assess(await author([D.association(alpha), D.contains(alpha, five.slice(0, 3)),
    D.contains(alpha, [five[3]]), D.memberOf(alpha, five[4]), D.cardinality(alpha, 5)])));
  assert.deepEqual([statuses(split), split.definition_coverage_complete], [all("supported"), true]);
});

test("POPULATION-BINDING-EMPTY-UNRESOLVED-AND-AMBIGUOUS", async () => {

  const emptyPolicy = populationPolicy({ unit: WK, identities: alpha, members: [], count: 0, policyId: "draft.empty" });
  const emptyContract = await author([D.association(alpha), D.cardinality(alpha, 0)]);
  const empty = only(assess(emptyContract, [emptyPolicy]));
  assert.deepEqual([statuses(empty), empty.definition_coverage_complete, empty.bindings.field_member,
    empty.binding_members.field_member], [all("supported"), true, "bound", []]);

  assert.deepEqual(statuses(only(assess(emptyContract))), { ...all("supported"), [CLOSED]: "missing", [COUNT]: "missing",
    [CARDINALITY]: "missing" });
  assert.equal(only(assess(complete, [emptyPolicy])).definition_coverage_complete, false);

  const refused = (bindings, field) => assert.throws(() => assess(complete, [{ ...policy, bindings }]), (error) => {
    assert.deepEqual([error.code, error.details.field], ["required_policy_input_invalid", field]);
    return true;
  });
  refused({ ...policy.bindings, field_member: [] }, "bindings.field_member");
  refused({ ...policy.bindings, field_member: five[0] }, "bindings.field_member");
  refused({ ...policy.bindings, field_member: [five[0], "cause"] }, "bindings.field_member");
  refused({ ...policy.bindings, body: [alpha.body] }, "bindings.body");
  refused({ ...policy.bindings, nonexistent: [] }, "bindings.nonexistent");

  const partial = only(assess(complete, [{ ...policy, bindings: populationBindings(alpha, [...four, null]) }]));
  assertPopulation(partial);
  assert.deepEqual([statuses(partial), partial.bindings.field_member, partial.definition_coverage_complete],
    [{ ...all("supported"), [CLOSED]: "unresolved", [COUNT]: "unresolved" }, "members_unavailable", false]);
  assert.deepEqual(expectation(partial, CLOSED).reasons, ["member_binding_unavailable:field_member:unavailable"]);

  const unbound = only(assess(complete, [{ ...policy, bindings: { ...policy.bindings, field_member: null } }]));
  assert.deepEqual([unbound.bindings.field_member, expectation(unbound, CLOSED).status, expectation(unbound, CLOSED).reasons],
    ["binding_unavailable", "unresolved", ["binding_unavailable:field_member"]]);

  const twice = structuredClone(complete);
  const code = twice.references.find((row) => row.identity.term === alpha.field.code.identity.term);
  twice.references.push({ ...structuredClone(code), reference_id: "ref-second-code" });
  const ambiguous = only(assess(twice));
  assert.deepEqual([ambiguous.bindings.field_member, expectation(ambiguous, CLOSED).status,
    expectation(ambiguous, CLOSED).reasons], ["members_ambiguous", "unresolved",
    ["member_referent_ambiguous:field_member:alpha.error-body.field.code"]]);
  assert.equal(ambiguous.definition_coverage_complete, false);
});

test("POPULATION-BINDING-IDENTITY-SCOPE-AND-DETERMINISM", async () => {

  const betaComplete = [D.association(beta), D.contains(beta, Object.values(beta.field)), D.cardinality(beta, 5)];
  const onlyBeta = await author(betaComplete);
  assert.deepEqual(statuses(only(assess(onlyBeta))), all("missing"));
  const betaPolicy = populationPolicy({ unit: WK, identities: beta, policyId: "draft.closed-field-population.beta" });
  const mixed = assess(await author([D.association(alpha), D.contains(alpha, four), D.cardinality(alpha, 5)], onlyBeta),
    [policy, betaPolicy]);
  const [first, second] = mixed.policies;
  assert.deepEqual([first.policy_id, statuses(first), first.definition_coverage_complete],
    [policy.policy_id, { ...all("supported"), [CLOSED]: "missing", [COUNT]: "missing" }, false]);
  assert.deepEqual([second.policy_id, statuses(second), second.definition_coverage_complete],
    [betaPolicy.policy_id, all("supported"), true]);
  assert.deepEqual(mixed.whole_unit_definition_coverage, { claimed: true, complete: false });

  const elsewhere = only(assess(complete, [populationPolicy({ unit: "WK-9002", identities: alpha })]));
  assert.deepEqual([elsewhere.status, elsewhere.reason, statuses(elsewhere)],
    ["not_assessed", "policy_scope_mismatch", all("unresolved")]);

  const baseline = assess(complete);
  const inputs = structuredClone({ policy, complete });
  const repeated = { ...policy, bindings: populationBindings(alpha, [...five, ...five].reverse()) };
  assert.deepEqual(assess(complete, [repeated]), baseline);
  assert.deepEqual(assess({ ...structuredClone(complete), references: [...complete.references].reverse(),
    claims: [...complete.claims].reverse() }, [repeated]), baseline);

  const fourTwice = { ...policy, bindings: populationBindings(alpha, [...four, four[0]]) };
  const short = only(assess(await author([D.association(alpha), D.contains(alpha, four), D.cardinality(alpha, 4)]),
    [fourTwice]));
  assert.deepEqual(statuses(short), { ...all("supported"), [COUNT]: "missing", [CARDINALITY]: "missing" });
  assert.deepEqual(expectation(short, COUNT).reasons, ["binding_constraint_unsatisfied"]);
  assert.equal(short.binding_members.field_member.length, 4);
  assert.deepEqual({ policy, complete }, inputs);
});
