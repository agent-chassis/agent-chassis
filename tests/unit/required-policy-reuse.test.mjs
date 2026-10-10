

import test from "node:test";
import assert from "node:assert/strict";
import { assessRequiredPolicies } from
  "../../packages/wiki-core/src/operations/controlled-contract/required-policy-assessment.mjs";
import {
  GAUGE_EXPECTED_PATTERN_IDS, GAUGE_PATTERN_IDS, SIBLING_REQUIREMENT, compileGaugeRequirements,
  constrainedInputRequirements, differentRejectedVerification, gaugeDependencyRelations, gaugeDraftPolicy,
  verification, when
} from "../fixtures/required-policy-assessment.mjs";
import { INPUT_INVENTORY, policiesFromInventory, policyIdFor } from "../fixtures/required-policy-reuse.mjs";

const WK = "WK-9001";
const subject = Object.freeze({ unit: WK, wk_id: WK, selected_unit: null, focus: null });
const WHOLE = Object.freeze({ scope: "whole_unit" });
const [INPUT_A, INPUT_B] = INPUT_INVENTORY;
const [ID_A, ID_B] = INPUT_INVENTORY.map(policyIdFor);

const policies = policiesFromInventory(INPUT_INVENTORY, { unit: WK });
const compile = (requirements, contract = null) => compileGaugeRequirements(requirements, { wkId: WK, contract });

async function author(entry, contract = null) {
  const compiled = await compile(Object.values(constrainedInputRequirements(entry.referents)), contract);
  const [declaration, accepted, rejected] = compiled.compiled;
  const relations = gaugeDependencyRelations({ declaration: declaration.claim_id, accepted: accepted.claim_id,
    rejected: rejected.claim_id, prefix: entry.requirement_prefix });
  const content = structuredClone(compiled.content);
  content.relations.push(...relations);
  return { content, declaration, accepted, rejected, dependencies: relations.map((row) => row.relation_id) };
}
const rowsFor = (entry, { declaration, accepted, rejected }) => [["range", declaration], ["accepted", accepted],
  ["out-of-range", rejected]].map(([name, claim]) => ({ obligation_id: `OBL-${entry.input_id}-${name}`,
  wk_id: WK, focus: null, statement: `${entry.interface}: the ${name} definition holds`,
  controlled_contract_node_ids: [claim.claim_id], proof_opt_out: true }));

const onlyA = await author(INPUT_A);
const B = await author(INPUT_B, onlyA.content);
const both = B.content;
const rowsA = rowsFor(INPUT_A, onlyA);
const rowsB = rowsFor(INPUT_B, B);
const rows = [...rowsA, ...rowsB];
const verifiesOf = (target) => both.relations.find((row) => row.role === "verifies" &&
  row.target_claim_id === target).relation_id;
const without = (edits, contract = both) => {
  const next = structuredClone(contract);
  for (const [population, field, ids] of edits) next[population] = next[population].filter((row) =>
    !ids.includes(row[field]));
  return next;
};

const assess = (contract, obligations = rows, supplied = policies) => assessRequiredPolicies({ policies: supplied,
  subject, contract, obligations, selection: WHOLE });
const instance = (result, id) => {
  const found = result.policies.filter((entry) => entry.policy_id === id);
  assert.equal(found.length, 1, `exactly one result for ${id}`);
  return found[0];
};
const statuses = (entry) => Object.fromEntries(entry.expectations.map((row) => [row.pattern_id, row.status]));
const obligations = (entry) => Object.fromEntries(entry.obligation_support.map((row) => [row.pattern_id, row.status]));
const expectation = (entry, id) => entry.expectations.find((row) => row.pattern_id === id);
const obligation = (entry, id) => entry.obligation_support.find((row) => row.pattern_id === id);
const all = (status) => Object.fromEntries(GAUGE_EXPECTED_PATTERN_IDS.map((id) => [id, status]));
const allObligations = (status) => Object.fromEntries([...GAUGE_PATTERN_IDS.behaviors].sort().map((id) => [id, status]));
const OUT = Object.freeze({ behavior: "out-of-range-behavior", verification: "out-of-range-verification",
  relationship: "out-of-range-verifies", dependency: "out-of-range-depends-on-declaration" });
const LEG = [OUT.behavior, OUT.verification, OUT.relationship, OUT.dependency];

function assertPopulation(result) {
  assert.deepEqual(result.policies.map((entry) => entry.policy_id), [ID_A, ID_B]);
  for (const entry of result.policies) {
    assert.equal(entry.status, "assessed");
    assert.deepEqual(entry.expectations.map((row) => row.pattern_id), GAUGE_EXPECTED_PATTERN_IDS);
    assert.deepEqual(entry.obligation_support.map((row) => row.pattern_id), [...GAUGE_PATTERN_IDS.behaviors].sort());
  }
  assert.equal(result.policies.reduce((sum, entry) => sum + entry.expectations.length, 0), 22);
  assert.equal(result.policies.reduce((sum, entry) => sum + entry.obligation_support.length, 0), 6);
}

function assertAComplete(result) {
  const a = instance(result, ID_A);
  assert.deepEqual(statuses(a), all("supported"));
  assert.deepEqual(obligations(a), allObligations("supported"));
  assert.equal(a.definition_coverage_complete, true);
}
const assertB = (result, changed, changedObligations = {}) => {
  assertPopulation(result);
  assertAComplete(result);
  const b = instance(result, ID_B);
  assert.deepEqual(statuses(b), { ...all("supported"), ...changed });
  assert.deepEqual(obligations(b), { ...allObligations("supported"), ...changedObligations });
  assert.equal(b.definition_coverage_complete, false);
  assert.deepEqual(result.whole_unit_definition_coverage, { claimed: true, complete: false });
  return b;
};

test("REQUIRED-POLICY-REUSE-INVENTORY-AND-INSTANCES", () => {

  const template = gaugeDraftPolicy({ unit: WK });
  assert.deepEqual(INPUT_INVENTORY.map((entry) => entry.input_id), ["gauge-level", "valve-opening"]);
  assert.equal(policies.length, 2);
  assert.notEqual(ID_A, ID_B);
  for (const [index, policy] of policies.entries()) {
    assert.deepEqual(policy.profile, template.profile);
    assert.deepEqual(policy.obligation_pattern_ids, template.obligation_pattern_ids);
    assert.deepEqual(policy.bindings, INPUT_INVENTORY[index].referents);
    assert.deepEqual([policy.provenance.rule_source, policy.provenance.motivating_decision,
      policy.provenance.motivating_decision_status, policy.provenance.inventory_entry.input_id],
    [template.policy_id, "DEC-0194", "proposed", INPUT_INVENTORY[index].input_id]);
  }
  assert.deepEqual(policies[0].profile, policies[1].profile);

  for (const role of Object.keys(INPUT_A.referents)) {
    assert.notDeepEqual(INPUT_A.referents[role], INPUT_B.referents[role], role);
  }

  const none = assess(null, []);
  assertPopulation(none);
  for (const id of [ID_A, ID_B]) {
    assert.deepEqual(statuses(instance(none, id)), all("missing"));
    assert.deepEqual(obligations(instance(none, id)), allObligations("missing"));
    assert.equal(instance(none, id).definition_coverage_complete, false);
  }
  assert.deepEqual(none.whole_unit_definition_coverage, { claimed: true, complete: false });

  const first = assess(onlyA.content, rowsA);
  assertB(first, all("missing"), allObligations("missing"));
  assert.ok(Object.values(instance(first, ID_B).bindings).every((state) => state === "referent_undeclared"));

  const complete = assess(both);
  assertPopulation(complete);
  assertAComplete(complete);
  const b = instance(complete, ID_B);
  assert.deepEqual([statuses(b), obligations(b), b.definition_coverage_complete],
    [all("supported"), allObligations("supported"), true]);
  assert.deepEqual(complete.whole_unit_definition_coverage, { claimed: true, complete: true });
  assert.ok(complete.policies.every((entry) => entry.matcher.admission.kind === "unadmitted_direct" &&
    entry.authored_contract.structurally_valid === true));
  assert.ok(rows.every((row) => row.selection === undefined));

  const matched = (entry) => entry.expectations.flatMap((row) => row.matched_ids);
  assert.deepEqual(matched(instance(complete, ID_A)).filter((id) => matched(b).includes(id)), []);
});

test("REQUIRED-POLICY-REUSE-OMISSIONS-FOR-ONE-INPUT", async () => {

  const edgeless = assertB(assess(without([["relations", "relation_id", [B.dependencies[1]]]])),
    { [OUT.dependency]: "missing" });
  assert.deepEqual([expectation(edgeless, OUT.dependency).matcher_status, expectation(edgeless, OUT.dependency).reasons],
    ["unsatisfied", ["no_matching_authored_relationship"]]);
  assert.deepEqual([expectation(edgeless, OUT.behavior).status, expectation(edgeless, "range-declaration").status,
    expectation(edgeless, OUT.behavior).structural_diagnostics], ["supported", "supported", []]);
  assert.equal(edgeless.authored_contract.structurally_valid, true);

  const legless = assertB(assess(without([
    ["claims", "claim_id", [B.rejected.claim_id, B.rejected.verification_claim_id]],
    ["relations", "relation_id", [verifiesOf(B.rejected.claim_id), B.dependencies[1]]]])),
  Object.fromEntries(LEG.map((id) => [id, "missing"])), { [OUT.behavior]: "missing" });
  assert.deepEqual(expectation(legless, OUT.behavior).reasons, ["no_matching_authored_claim"]);
  assert.deepEqual(obligation(legless, OUT.behavior).reasons, ["required_claim_not_authored"]);
  assert.equal(legless.authored_contract.structurally_valid, true);

  const replaced = await compile([{ ...constrainedInputRequirements(INPUT_B.referents).rejected,
    verification: differentRejectedVerification(INPUT_B.referents, "valve.unrelated-opening-check") }],
  without([["claims", "claim_id", [B.rejected.verification_claim_id]],
    ["relations", "relation_id", [verifiesOf(B.rejected.claim_id)]]]));
  const other = assertB(assess(replaced.content), { [OUT.verification]: "missing", [OUT.relationship]: "missing" });
  assert.deepEqual([expectation(other, OUT.behavior).status, obligations(other)[OUT.behavior]],
    ["supported", "supported"]);
  assert.equal(other.authored_contract.structurally_valid, true);

  const unpaid = assertB(assess(both, rows.filter((row) => row !== rowsB[2])), {}, { [OUT.behavior]: "missing" });
  assert.deepEqual(obligation(unpaid, OUT.behavior).reasons, ["no_qualifying_same_subject_obligation"]);
  assert.equal(unpaid.matcher.satisfaction, "satisfied");

  const unverified = assertB(assess(without([["relations", "relation_id", [verifiesOf(B.rejected.claim_id)]]])),
    { [OUT.relationship]: "missing", [OUT.behavior]: "affected", [OUT.verification]: "affected" });
  assert.deepEqual([expectation(unverified, OUT.behavior).declaration_matched,
    expectation(unverified, OUT.behavior).structural_diagnostics], [true, ["mandatory_behavior_unverified"]]);
  assert.equal(unverified.authored_contract.structurally_valid, false);

  const unbound = assess(both, rows, [policies[0], { ...policies[1],
    bindings: { ...policies[1].bindings, outside_range: null } }]);
  const blind = assertB(unbound, Object.fromEntries(LEG.map((id) => [id, "unresolved"])),
    { [OUT.behavior]: "unresolved" });
  assert.equal(blind.bindings.outside_range, "binding_unavailable");
  assert.deepEqual(expectation(blind, OUT.behavior).reasons, ["binding_unavailable:outside_range"]);

  const bNodes = (population, field) => both[population].filter((row) =>
    !onlyA.content[population].some((kept) => kept[field] === row[field])).map((row) => row[field]);
  const absent = without([["references", "reference_id", bNodes("references", "reference_id")],
    ["propositions", "proposition_id", bNodes("propositions", "proposition_id")],
    ["claims", "claim_id", bNodes("claims", "claim_id")],
    ["relations", "relation_id", bNodes("relations", "relation_id")]]);
  assert.deepEqual(absent, onlyA.content);
  const gone = assertB(assess(absent), all("missing"), allObligations("missing"));
  assert.deepEqual(expectation(gone, "range-declaration").reasons, ["referent_undeclared:level"]);
});

test("REQUIRED-POLICY-REUSE-NO-CROSS-CREDIT-AND-DETERMINISM", async () => {

  const a = INPUT_A.referents, b = INPUT_B.referents;
  const borrowed = await compile([{ nature: "behavior", modality: "MUST", subject: { declare: b.operation },
    behavior: when("reference:returns", a.refusal_result, a.outside_range),
    verification: verification(b.refusal_check, b.operation,
      when("reference:writes", a.accepted_effect, a.outside_range)) }], without([
    ["claims", "claim_id", [B.rejected.claim_id, B.rejected.verification_claim_id]],
    ["relations", "relation_id", [verifiesOf(B.rejected.claim_id), B.dependencies[1]]]]));
  const candidate = borrowed.compiled[0];
  const crossed = structuredClone(borrowed.content);
  crossed.relations.push({ relation_id: "rel-valve-out-of-range-depends-on-range-declaration", role: "depends_on",
    source_claim_id: candidate.claim_id, target_claim_id: B.declaration.claim_id });
  const lent = assertB(assess(crossed, [...rowsA, rowsB[0], rowsB[1],
    { ...rowsB[2], controlled_contract_node_ids: [candidate.claim_id] }]),
  Object.fromEntries(LEG.map((id) => [id, "missing"])), { [OUT.behavior]: "missing" });
  assert.equal(lent.authored_contract.structurally_valid, true);

  const sharedLeg = assess(without([
    ["claims", "claim_id", [B.rejected.claim_id, B.rejected.verification_claim_id]],
    ["relations", "relation_id", [verifiesOf(B.rejected.claim_id), B.dependencies[1]]]]));
  assert.deepEqual(expectation(instance(sharedLeg, ID_B), OUT.behavior).matched_ids, []);

  const borrowedRows = rowsA.map((row, index) => ({ ...row, obligation_id: `OBL-valve-borrowed-${index}` }));
  const owed = assertB(assess(both, [...rowsA, ...borrowedRows]), {}, allObligations("missing"));
  assert.deepEqual(statuses(owed), all("supported"));

  const reverse = assess(both, rowsB);
  assert.deepEqual(obligations(instance(reverse, ID_A)), allObligations("missing"));
  assert.deepEqual(obligations(instance(reverse, ID_B)), allObligations("supported"));

  const baseline = assess(both);
  const withSibling = assess((await compile([SIBLING_REQUIREMENT], both)).content);
  assertPopulation(withSibling);
  assert.deepEqual(withSibling.policies.map((entry) => [statuses(entry), obligations(entry), entry.counts]),
    baseline.policies.map((entry) => [statuses(entry), obligations(entry), entry.counts]));

  const inputs = { policies: structuredClone(policies), contract: structuredClone(both), rows: structuredClone(rows) };
  assert.deepEqual(assess(both), baseline);
  const permutedContract = { ...structuredClone(both), references: [...both.references].reverse(),
    propositions: [...both.propositions].reverse(), claims: [...both.claims].reverse(),
    relations: [...both.relations].reverse() };
  const permuted = assess(permutedContract, [...rows].reverse(),
    [policies[1], policies[0], structuredClone(policies[1]), structuredClone(policies[0])]);
  assertPopulation(permuted);
  assert.deepEqual(permuted, baseline);
  assert.deepEqual({ policies, contract: both, rows }, inputs);
});
